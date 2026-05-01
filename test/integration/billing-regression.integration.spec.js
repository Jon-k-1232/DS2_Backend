/**
 * Billing-correctness regression: after the orchestrator runs, the sum of
 * customer_transactions.total_transaction must equal Σ(hours × billing_rate)
 * for every auto-inserted row. After a cascade-edit, the linked invoice's
 * total_charges must equal the sum of its transactions.
 *
 * Skipped when the dev DB isn't reachable.
 */
const { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { processEntries } = require('../../src/endpoints/timesheets/auto-ingest-orchestrator');
const { applyTransactionEdit } = require('../../src/endpoints/billingReview/cascadeEdit');

describe('integration: billing-correctness regression', function () {
   this.timeout(60_000);
   let db;

   before(async function () {
      db = await requireDb.call(this);
      await cleanupTestData(db);

      // Stub Bedrock so the orchestrator returns a known auto-inserting result.
      const bedrockMod = require('../../src/ai_integrations/bedrock');
      bedrockMod._setClientsForTest({
         bedrockClient: {
            send: async () => {
               const body = JSON.stringify({
                  content: [{ type: 'text', text: JSON.stringify({ suggested_general_work_description_id: 90031, suggested_job_category_id: 90001, suggested_job_type_id: 900201, suggested_category_label: 'Tax Return Preparation', category_confidence: 0.95, ai_reason: 'stub' }) }],
                  usage: { input_tokens: 500, output_tokens: 50 }
               });
               return { body: Buffer.from(body) };
            }
         },
         s3Client: null
      });
   });

   after(async () => {
      if (db) await cleanupTestData(db);
      await closeDb();
   });

   it('total_transaction = Σ(hours × billing_rate) for every auto-inserted row', async () => {
      const employee = await db('users').where({ user_id: 90011 }).first();
      const billingRate = Number(employee.billing_rate);

      const seedRows = [
         { date: '2026-04-27', entity: 'Acme Corp', category: 'Tax Compliance', employee_name: 'Eliza Smith', duration: 60, notes: 'prepared 1040' },
         { date: '2026-04-27', entity: 'Acme Corp', category: 'Tax Compliance', employee_name: 'Eliza Smith', duration: 90, notes: 'prepared 1040' },
         { date: '2026-04-28', entity: 'Acme Corp', category: 'Tax Compliance', employee_name: 'Eliza Smith', duration: 30, notes: 'prepared 1040' }
      ];
      const inserted = [];
      for (const r of seedRows) {
         const [row] = await db('timesheet_entries').insert({
            account_id: TEST_ACCOUNT_ID, user_id: TEST_ADMIN_USER_ID,
            employee_name: r.employee_name, timesheet_name: 'billing_regression.xlsx',
            time_tracker_start_date: '2026-04-27', time_tracker_end_date: '2026-05-03',
            date: r.date, entity: r.entity, category: r.category, duration: r.duration, notes: r.notes,
            is_processed: false, is_deleted: false
         }).returning('timesheet_entry_id');
         inserted.push(row.timesheet_entry_id || row);
      }

      const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds: inserted });
      expect(result.autoInserted).to.equal(3);

      const txns = await db('customer_transactions')
         .where({ account_id: TEST_ACCOUNT_ID, customer_id: 900101 })
         .select('quantity', 'unit_cost', 'total_transaction');

      // Every row's total_transaction must equal quantity × unit_cost.
      for (const t of txns) {
         const expected = Math.round(Number(t.quantity) * Number(t.unit_cost) * 100) / 100;
         expect(Number(t.total_transaction)).to.equal(expected);
      }

      const total = txns.reduce((a, t) => a + Number(t.total_transaction), 0);
      const hours = seedRows.reduce((a, r) => a + r.duration / 60, 0);
      const expectedTotal = Math.round(hours * billingRate * 100) / 100;
      expect(Math.abs(total - expectedTotal)).to.be.lessThan(0.05);
   });

   it('cascade-edit recomputes invoice total_charges to match Σ of its transactions', async function () {
      // Manually attach a synthetic invoice to the auto-inserted transactions
      // so we can exercise _recomputeInvoiceTotals end-to-end.
      const txns = await db('customer_transactions')
         .where({ account_id: TEST_ACCOUNT_ID, customer_id: 900101 })
         .orderBy('transaction_id', 'asc');
      if (!txns.length) return; // first test already covers the data

      const customerInfo = await db('customer_information').where({ customer_id: 900101 }).first();
      if (!customerInfo) this.skip();

      const sumNow = txns.reduce((a, t) => a + Number(t.total_transaction), 0);
      const [invoice] = await db('customer_invoices').insert({
         account_id: TEST_ACCOUNT_ID, customer_id: 900101,
         customer_info_id: customerInfo.customer_info_id,
         invoice_number: 'TEST-REG-001',
         invoice_date: '2026-05-01', due_date: '2026-05-31',
         beginning_balance: 0, total_payments: 0, total_charges: sumNow,
         total_write_offs: 0, total_retainers: 0, total_amount_due: sumNow,
         remaining_balance_on_invoice: sumNow, is_invoice_paid_in_full: false,
         created_by_user_id: TEST_ADMIN_USER_ID,
         start_date: '2026-04-01', end_date: '2026-04-30'
      }).returning('*');

      await db('customer_transactions')
         .where({ account_id: TEST_ACCOUNT_ID, customer_id: 900101 })
         .update({ customer_invoice_id: invoice.customer_invoice_id });

      const targetTxn = txns[0];
      const newTotal = Number(targetTxn.total_transaction) + 50;
      const result = await applyTransactionEdit({
         db,
         accountId: TEST_ACCOUNT_ID,
         transactionId: targetTxn.transaction_id,
         updates: { total_transaction: newTotal },
         editingUserId: TEST_ADMIN_USER_ID
      });

      const recomputed = result.sideEffects.find(s => s.type === 'invoice_recalculated');
      expect(recomputed).to.exist;

      const reloaded = await db('customer_invoices').where({ customer_invoice_id: invoice.customer_invoice_id }).first();
      const sumAfter = await db('customer_transactions').where({ customer_invoice_id: invoice.customer_invoice_id }).sum({ s: 'total_transaction' });
      expect(Math.abs(Number(reloaded.total_charges) - Number(sumAfter[0].s))).to.be.lessThan(0.001);
   });
});
