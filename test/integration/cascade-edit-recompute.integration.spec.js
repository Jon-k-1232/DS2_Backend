/**
 * cascadeEdit invoice recompute — sign-convention contract.
 *
 * customer_invoices stores total_payments / total_write_offs / total_retainers
 * as NEGATIVE nets (matching the raw customer_payments / customer_writeoffs
 * rows and the billing engine). The recompute must ADD those nets, never
 * subtract them — the old subtraction form inflated the remaining balance
 * (due − (−903) = due + 903). Runs against the dev-DB fixture account.
 */
const { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { applyTransactionEdit, _recomputeInvoiceTotals } = require('../../src/endpoints/billingReview/cascadeEdit');

const CUSTOMER_ID = 900101;

describe('integration: cascadeEdit invoice recompute (negative-net totals)', function () {
   this.timeout(30_000);
   let db;
   let invoiceId;
   let txnIds = [];

   before(async function () {
      db = await requireDb.call(this);
      await cleanupTestData(db);

      const info = await db('customer_information').where({ customer_id: CUSTOMER_ID }).first();

      const [inv] = await db('customer_invoices')
         .insert({
            account_id: TEST_ACCOUNT_ID,
            customer_id: CUSTOMER_ID,
            customer_info_id: info.customer_info_id,
            invoice_number: 'TEST-CASCADE-RECOMPUTE',
            invoice_date: '2026-06-01',
            due_date: '2026-07-01',
            beginning_balance: 100,
            // Negative nets, exactly as the billing engine writes them:
            // $903 received in payments, $50 written off.
            total_payments: -903,
            total_charges: 0,
            total_write_offs: -50,
            total_retainers: 0,
            total_amount_due: 0,
            // Seeded deliberately wrong so the test proves the recompute fixes it.
            remaining_balance_on_invoice: 9999,
            is_invoice_paid_in_full: false,
            created_by_user_id: TEST_ADMIN_USER_ID
         })
         .returning('customer_invoice_id');
      invoiceId = inv.customer_invoice_id || inv;

      const base = {
         account_id: TEST_ACCOUNT_ID,
         customer_id: CUSTOMER_ID,
         customer_job_id: 9001001,
         customer_invoice_id: invoiceId,
         logged_for_user_id: 90011,
         general_work_description_id: 90031,
         created_by_user_id: TEST_ADMIN_USER_ID,
         is_transaction_billable: true,
         is_excess_to_subscription: false,
         detailed_work_description: ''
      };
      const inserted = await db('customer_transactions')
         .insert([
            { ...base, transaction_date: '2026-06-02', transaction_type: 'Time', quantity: 2, unit_cost: 400, total_transaction: 800 },
            { ...base, transaction_date: '2026-06-03', transaction_type: 'Charge', quantity: 1, unit_cost: 57, total_transaction: 57 }
         ])
         .returning('transaction_id');
      txnIds = inserted.map(r => r.transaction_id || r);
   });

   after(async () => {
      if (db) {
         await db('ai_reviewer_corrections').where({ account_id: TEST_ACCOUNT_ID }).del();
         await db('customer_transactions').where({ account_id: TEST_ACCOUNT_ID }).del();
         await db('customer_invoices').where({ customer_invoice_id: invoiceId }).del();
      }
      await closeDb();
   });

   it('_recomputeInvoiceTotals adds the negative nets instead of subtracting them', async () => {
      const result = await db.transaction(trx => _recomputeInvoiceTotals(trx, TEST_ACCOUNT_ID, invoiceId));

      // charges 800 + 57 = 857; due = 100 + 857 + (−50) + 0 = 907; remaining = 907 + (−903) = 4
      expect(result.totalCharges).to.equal(857);
      expect(result.totalAmountDue).to.equal(907);
      expect(result.remainingBalance).to.equal(4);

      const row = await db('customer_invoices').where({ customer_invoice_id: invoiceId }).first();
      expect(Number(row.total_charges)).to.equal(857);
      expect(Number(row.total_amount_due)).to.equal(907);
      expect(Number(row.remaining_balance_on_invoice)).to.equal(4);
   });

   it('applyTransactionEdit cascades a re-priced transaction into the invoice sign-aware', async () => {
      const { sideEffects } = await applyTransactionEdit({
         db,
         accountId: TEST_ACCOUNT_ID,
         transactionId: txnIds[0],
         updates: { unit_cost: 450 }, // 2 × 450 = 900 (was 800)
         editingUserId: TEST_ADMIN_USER_ID
      });

      const recalc = sideEffects.find(s => s.type === 'invoice_recalculated');
      expect(recalc, 'invoice recalculated side effect present').to.exist;
      // charges 900 + 57 = 957; due = 100 + 957 − 50 = 1007; remaining = 1007 − 903 = 104
      expect(recalc.totalCharges).to.equal(957);
      expect(recalc.totalAmountDue).to.equal(1007);
      expect(recalc.remainingBalance).to.equal(104);

      const row = await db('customer_invoices').where({ customer_invoice_id: invoiceId }).first();
      expect(Number(row.remaining_balance_on_invoice)).to.equal(104);
   });
});
