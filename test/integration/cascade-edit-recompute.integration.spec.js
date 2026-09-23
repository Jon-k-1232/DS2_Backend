/**
 * Billing Review cascade edit — ledger contract against a real Postgres.
 *
 * A billed transaction's BILLABLE-amount change is posted to its invoice chain
 * as a delta: a NEW adjustment snapshot (copied from the chain's latest row,
 * remaining += Δ) plus the parent mirror (total_charges / total_amount_due /
 * remaining += Δ). total_payments is never read or written (legacy parents
 * store it as a POSITIVE magnitude). Non-financial edits never touch invoice
 * rows; statements rolled into a newer one refuse amount changes; a customer
 * change keeps the reviewer's job for the new customer. After every edit the
 * billing engine, the Account Audit and AR (parent mirror) must agree.
 *
 * Uses its OWN customers (created + removed here) so it cannot collide with the
 * other integration specs that share the fixture customers.
 *
 * The "concurrent saves" block runs two ledger writers on SEPARATE connections:
 * the first holds the customer ledger lock in a manual transaction, the second
 * is started and verified (pg_blocking_pids) to be waiting on that lock before
 * the first commits.
 */
const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { applyTransactionEdit, ERRORS, MESSAGES } = require('../../src/endpoints/billingReview/cascadeEdit');
const billingReviewService = require('../../src/endpoints/billingReview/billingReview-service');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const auditSvc = require('../../src/endpoints/accountAudit/account-audit-service');
const { auditCustomerLedger } = require('../../src/endpoints/accountAudit/account-audit-logic');
const accountsReceivableService = require('../../src/endpoints/accountsReceivable/accounts-receivable-service');
const invoiceService = require('../../src/endpoints/invoice/invoice-service');
const paymentLogic = require('../../src/endpoints/payments/payment-logic');
const { lockCustomerLedger } = require('../../src/endpoints/payments/ledger-helpers');

const A = TEST_ACCOUNT_ID;
const USER = TEST_ADMIN_USER_ID;
const JOB_TYPE_ID = 900201;
const GWD_ID = 90031;
const GWD_ID_2 = 90032;
const NAME_PREFIX = 'Cascade Delta Spec';

const round2 = n => Math.round(Number(n) * 100) / 100;
const num = v => Number(v);

describe('integration: cascadeEdit delta posting (billing review)', function () {
   this.timeout(120_000);
   let db;
   const ids = { customers: [], jobs: {}, info: {}, txns: {}, invoices: {}, entry: null };

   const removeSpecRows = async () => {
      const customers = await db('customers').where({ account_id: A }).andWhere('display_name', 'like', `${NAME_PREFIX}%`).select('customer_id');
      const customerIds = customers.map(c => c.customer_id);
      if (!customerIds.length) return;
      const txnIds = (await db('customer_transactions').whereIn('customer_id', customerIds).select('transaction_id')).map(r => r.transaction_id);
      if (txnIds.length) {
         await db('ai_reviewer_corrections').whereIn('transaction_id', txnIds).del();
         await db('ai_category_training_examples').whereIn('transaction_id', txnIds).del();
      }
      const entryIds = (await db('timesheet_entries').where({ account_id: A }).andWhere('timesheet_name', 'like', `${NAME_PREFIX}%`).select('timesheet_entry_id')).map(
         r => r.timesheet_entry_id
      );
      if (entryIds.length) await db('ai_category_training_examples').whereIn('timesheet_entry_id', entryIds).del();
      await db('customer_payments').whereIn('customer_id', customerIds).del();
      await db('customer_transactions').whereIn('customer_id', customerIds).del();
      await db('customer_invoices').whereIn('customer_id', customerIds).del();
      if (entryIds.length) await db('timesheet_entries').whereIn('timesheet_entry_id', entryIds).del();
      await db('customer_jobs').whereIn('customer_id', customerIds).del();
      await db('customer_information').whereIn('customer_id', customerIds).del();
      await db('customers').whereIn('customer_id', customerIds).del();
   };

   const createCustomer = async label => {
      const [c] = await db('customers')
         .insert({
            account_id: A,
            business_name: `${NAME_PREFIX} ${label} LLC`,
            customer_name: `${NAME_PREFIX} ${label}`,
            display_name: `${NAME_PREFIX} ${label}`,
            is_commercial_customer: true,
            is_customer_active: true,
            is_billable: true,
            is_recurring: false
         })
         .returning('customer_id');
      const customerId = c.customer_id || c;
      const [info] = await db('customer_information')
         .insert({
            account_id: A,
            customer_id: customerId,
            customer_street: '1 Ledger Way',
            customer_city: 'Phoenix',
            customer_state: 'AZ',
            customer_zip: '85001',
            customer_email: 'ledger@example.test',
            customer_phone: '5550100000',
            is_this_address_active: true,
            is_customer_physical_address: true,
            is_customer_billing_address: true,
            is_customer_mailing_address: true,
            created_by_user_id: USER
         })
         .returning('customer_info_id');
      const [job] = await db('customer_jobs')
         .insert({ account_id: A, customer_id: customerId, job_type_id: JOB_TYPE_ID, current_job_total: 0, is_quote: false, is_job_complete: false, created_by_user_id: USER })
         .returning('customer_job_id');
      ids.customers.push(customerId);
      ids.info[customerId] = info.customer_info_id || info;
      ids.jobs[customerId] = job.customer_job_id || job;
      return customerId;
   };

   const insertInvoice = async row => {
      const [inv] = await db('customer_invoices')
         .insert({
            account_id: A,
            customer_info_id: ids.info[row.customer_id],
            due_date: '2026-07-30',
            beginning_balance: 0,
            total_payments: 0,
            total_charges: 0,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: 0,
            remaining_balance_on_invoice: 0,
            is_invoice_paid_in_full: false,
            created_by_user_id: USER,
            ...row
         })
         .returning('*');
      return inv;
   };

   const insertTxn = async row => {
      const [t] = await db('customer_transactions')
         .insert({
            account_id: A,
            logged_for_user_id: 90011,
            general_work_description_id: GWD_ID,
            created_by_user_id: USER,
            is_excess_to_subscription: false,
            detailed_work_description: '',
            note: '',
            transaction_type: 'Time',
            ...row
         })
         .returning('*');
      return t;
   };

   const chainRows = async rootId =>
      db('customer_invoices')
         .where(function () {
            this.where('customer_invoice_id', rootId).orWhere('parent_invoice_id', rootId);
         })
         .orderBy('customer_invoice_id', 'asc');

   // The three views that must agree: billing engine, Account Audit, AR (parent mirror).
   const views = async customerId => {
      const map = { [customerId]: { customer_id: customerId, showWriteOffs: false, invoiceNote: null } };
      const queryData = await fetchInitialQueryItems(db, map, A);
      const [engineRow] = calculateInvoices([{ customer_id: customerId, showWriteOffs: false }], queryData);
      const [customer, invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
         auditSvc.getCustomer(db, A, customerId),
         auditSvc.getInvoices(db, A, customerId),
         auditSvc.getPayments(db, A, customerId),
         auditSvc.getWriteoffs(db, A, customerId),
         auditSvc.getTransactions(db, A, customerId),
         auditSvc.getRetainers(db, A, customerId)
      ]);
      const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });
      const newestParent = await db('customer_invoices')
         .where({ account_id: A, customer_id: customerId })
         .whereNull('parent_invoice_id')
         .orderBy([
            { column: 'invoice_date', order: 'desc' },
            { column: 'created_at', order: 'desc' }
         ])
         .first();
      return {
         engine: round2(engineRow.invoiceTotal),
         audit: round2(audit.totals.audit_balance),
         ar: round2(newestParent ? newestParent.remaining_balance_on_invoice : 0)
      };
   };

   const edit = (transactionId, updates, extra = {}) =>
      applyTransactionEdit({ db, accountId: A, transactionId, updates, editingUserId: USER, ...extra });

   const rejects = async promise => {
      try {
         await promise;
      } catch (e) {
         return e;
      }
      throw new Error('expected the edit to be refused');
   };

   let customerA;
   let customerB;
   let parent; // customer A's statement (current until the absorbed test)
   let paymentSnapshot;

   before(async function () {
      db = await requireDb.call(this);
      await removeSpecRows();

      customerA = await createCustomer('A');
      customerB = await createCustomer('B');

      // June statement: bb 100 + billable 800 + 57 = 957 due. Non-billable $45 is
      // listed but not charged. A $900 payment brought it to $57. The parent row
      // stores total_payments as a legacy POSITIVE magnitude (+900).
      parent = await insertInvoice({
         customer_id: customerA,
         invoice_number: 'TEST-CASCADE-DELTA-06',
         invoice_date: '2026-06-30',
         start_date: '2026-06-01',
         end_date: '2026-06-30',
         beginning_balance: 100,
         total_charges: 857,
         total_amount_due: 957,
         total_payments: 900,
         remaining_balance_on_invoice: 57,
         created_at: '2026-07-01 12:00:00'
      });
      paymentSnapshot = await insertInvoice({
         customer_id: customerA,
         parent_invoice_id: parent.customer_invoice_id,
         invoice_number: parent.invoice_number,
         invoice_date: '2026-06-30',
         start_date: '2026-06-01',
         end_date: '2026-06-30',
         beginning_balance: 100,
         total_charges: 857,
         total_amount_due: 957,
         total_payments: 0,
         remaining_balance_on_invoice: 57,
         created_at: '2026-07-05 12:00:00'
      });
      await db('customer_payments').insert({
         account_id: A,
         customer_id: customerA,
         customer_invoice_id: paymentSnapshot.customer_invoice_id,
         payment_date: '2026-07-05',
         payment_amount: -900,
         form_of_payment: 'Check',
         created_by_user_id: USER
      });

      const base = { customer_id: customerA, customer_job_id: ids.jobs[customerA], customer_invoice_id: parent.customer_invoice_id, is_transaction_billable: true };
      ids.txns.time = (await insertTxn({ ...base, transaction_date: '2026-06-02', quantity: 2, unit_cost: 400, total_transaction: 800 })).transaction_id;
      ids.txns.charge = (await insertTxn({ ...base, transaction_date: '2026-06-03', transaction_type: 'Charge', quantity: 1, unit_cost: 57, total_transaction: 57 })).transaction_id;
      ids.txns.nonBillable = (await insertTxn({ ...base, transaction_date: '2026-06-04', quantity: 0.3, unit_cost: 150, total_transaction: 45, is_transaction_billable: false }))
         .transaction_id;
      // Legacy row dated OUTSIDE its statement window (the UI re-sends that date on every save).
      ids.txns.outsideWindow = (await insertTxn({ ...base, transaction_date: '2026-05-20', quantity: 0, unit_cost: 150, total_transaction: 0 })).transaction_id;

      // Provenance for the lateral-join check: the AI auto-insert example (tied to
      // the tracker line) plus a later reviewer edit row (no tracker link).
      const [entry] = await db('timesheet_entries')
         .insert({
            account_id: A,
            user_id: 90011,
            employee_name: 'Eliza Smith',
            timesheet_name: `${NAME_PREFIX} tracker.xlsx`,
            time_tracker_start_date: '2026-06-01',
            time_tracker_end_date: '2026-06-30',
            date: '2026-06-02',
            entity: 'JFK&A',
            duration: 120,
            notes: 'Prepared return',
            is_processed: true
         })
         .returning('timesheet_entry_id');
      ids.entry = entry.timesheet_entry_id || entry;
      await db('ai_category_training_examples').insert([
         { account_id: A, timesheet_entry_id: ids.entry, transaction_id: ids.txns.time, final_category: 'Tax Return Preparation', ai_source: 'ai_auto_insert', created_at: '2026-06-02 10:00:00' },
         { account_id: A, timesheet_entry_id: null, transaction_id: ids.txns.time, final_category: 'Bookkeeping Reconciliation', ai_source: 'reviewer_edit', created_at: '2026-06-10 10:00:00' }
      ]);
   });

   after(async () => {
      if (db) await removeSpecRows();
      await closeDb();
   });

   it('the three views agree before any edit (sanity)', async () => {
      const v = await views(customerA);
      expect(v).to.deep.equal({ engine: 57, audit: 57, ar: 57 });
   });

   it('posts a billable delta to the parent AND a new adjustment snapshot; views move together', async () => {
      const { sideEffects } = await edit(ids.txns.time, { unit_cost: 450 }); // 2 × 450 = 900 (was 800) → Δ +100

      const effect = sideEffects.find(s => s.type === 'invoice_recalculated');
      expect(effect).to.include({ mode: 'delta', delta: 100, totalCharges: 957, totalAmountDue: 1057, remainingBalance: 157 });

      const rows = await chainRows(parent.customer_invoice_id);
      const p = rows.find(r => r.customer_invoice_id === parent.customer_invoice_id);
      expect(num(p.total_charges)).to.equal(957);
      expect(num(p.total_amount_due)).to.equal(1057);
      expect(num(p.remaining_balance_on_invoice)).to.equal(157);
      expect(num(p.total_payments)).to.equal(900); // legacy positive magnitude untouched
      expect(p.is_invoice_paid_in_full).to.equal(false);

      const oldSnap = rows.find(r => r.customer_invoice_id === paymentSnapshot.customer_invoice_id);
      expect(num(oldSnap.remaining_balance_on_invoice)).to.equal(57); // payment snapshot left intact

      const adj = rows.find(r => r.customer_invoice_id === effect.snapshotInvoiceId);
      expect(adj.parent_invoice_id).to.equal(parent.customer_invoice_id);
      expect(num(adj.remaining_balance_on_invoice)).to.equal(157);
      expect(adj.notes).to.equal(`[adjustment: transaction #${ids.txns.time} Δ+100.00]`);
      expect(new Date(adj.created_at).getTime()).to.be.greaterThan(new Date(oldSnap.created_at).getTime());

      expect(await views(customerA)).to.deep.equal({ engine: 157, audit: 157, ar: 157 });
   });

   it('ignores non-billable rows (no invoice rows touched)', async () => {
      const before = JSON.stringify(await chainRows(parent.customer_invoice_id));
      const { diff, sideEffects } = await edit(ids.txns.nonBillable, { total_transaction: 60 });
      expect(Object.keys(diff)).to.deep.equal(['total_transaction']);
      expect(sideEffects.some(s => s.type === 'invoice_recalculated')).to.equal(false);
      expect(JSON.stringify(await chainRows(parent.customer_invoice_id))).to.equal(before);
   });

   it('a note edit sent as the full grid row does not touch the invoice', async () => {
      const row = await db('customer_transactions').where({ transaction_id: ids.txns.charge }).first();
      const before = JSON.stringify(await chainRows(parent.customer_invoice_id));
      const { diff } = await edit(ids.txns.charge, {
         customer_id: row.customer_id,
         customer_job_id: row.customer_job_id,
         general_work_description_id: row.general_work_description_id,
         transaction_date: '2026-06-03',
         quantity: Number(row.quantity),
         unit_cost: Number(row.unit_cost),
         total_transaction: Number(row.total_transaction),
         is_transaction_billable: true,
         note: 'filing fee per IRS notice'
      });
      expect(Object.keys(diff)).to.deep.equal(['note']);
      expect(JSON.stringify(await chainRows(parent.customer_invoice_id))).to.equal(before);
      expect((await db('customer_transactions').where({ transaction_id: ids.txns.charge }).first()).note).to.equal('filing fee per IRS notice');
      // AI learning row written inside a SAVEPOINT of the same transaction
      const corrections = await db('ai_reviewer_corrections').where({ transaction_id: ids.txns.charge, field_name: 'note' });
      expect(corrections).to.have.lengthOf(1);
      expect(corrections[0].final_value).to.equal('filing fee per IRS notice');
   });

   it('an unchanged out-of-period date does not 409', async () => {
      const { diff } = await edit(ids.txns.outsideWindow, { transaction_date: '2026-05-20', note: 'legacy date kept' });
      expect(Object.keys(diff)).to.deep.equal(['note']);
      const err = await rejects(edit(ids.txns.outsideWindow, { transaction_date: '2026-07-15' }));
      expect(err.code).to.equal(ERRORS.DATE_OUTSIDE_INVOICE);
   });

   it('lists each transaction once even with several AI training examples (lateral join)', async () => {
      // A work-description edit adds another reviewer_edit example row.
      await edit(ids.txns.time, { general_work_description_id: GWD_ID_2 });
      const exampleCount = await db('ai_category_training_examples').where({ transaction_id: ids.txns.time }).count({ n: '*' }).first();
      expect(Number(exampleCount.n)).to.be.at.least(3);

      const list = await billingReviewService.listConsolidatedTransactions(db, A, { startDate: '2026-05-01', endDate: '2026-06-30', customerId: customerA });
      const timeRows = list.transactions.filter(t => t.transaction_id === ids.txns.time);
      expect(timeRows).to.have.lengthOf(1);
      expect(timeRows[0].tracker_id).to.equal(ids.entry); // provenance row preferred over reviewer edits
      expect(timeRows[0].ai_source).to.equal('ai_auto_insert');
      expect(list.totalCount).to.equal(4);
      expect(list.totalSum).to.equal(round2(900 + 57 + 60 + 0));

      const aiOnly = await billingReviewService.listConsolidatedTransactions(db, A, { startDate: '2026-05-01', endDate: '2026-06-30', customerId: customerA, aiOnly: true });
      expect(aiOnly.transactions.map(t => t.transaction_id)).to.deep.equal([ids.txns.time]);
   });

   it('refuses a customer change without a job for the new customer', async () => {
      const err = await rejects(edit(ids.txns.charge, { customer_id: customerB }, { confirmCustomerChange: true }));
      expect(err.code).to.equal(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE);
      const oldJob = await rejects(edit(ids.txns.charge, { customer_id: customerB, customer_job_id: ids.jobs[customerA] }, { confirmCustomerChange: true }));
      expect(oldJob.code).to.equal(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE);
      const row = await db('customer_transactions').where({ transaction_id: ids.txns.charge }).first();
      expect(row.customer_id).to.equal(customerA);
   });

   it('a customer change keeps the new job, unbills the row and takes it off the old statement', async () => {
      const before = await views(customerA);
      const { sideEffects } = await edit(ids.txns.charge, { customer_id: customerB, customer_job_id: ids.jobs[customerB] }, { confirmCustomerChange: true });

      const moved = await db('customer_transactions').where({ transaction_id: ids.txns.charge }).first();
      expect(moved.customer_id).to.equal(customerB);
      expect(moved.customer_job_id).to.equal(ids.jobs[customerB]);
      expect(moved.customer_invoice_id).to.equal(null);

      const effect = sideEffects.find(s => s.type === 'old_invoice_recalculated_after_customer_change');
      expect(effect.delta).to.equal(-57);
      expect(await views(customerA)).to.deep.equal({ engine: round2(before.engine - 57), audit: round2(before.audit - 57), ar: round2(before.ar - 57) });

      // The work now bills to customer B on B's next statement.
      const bViews = await views(customerB);
      expect(bViews.engine).to.equal(57);
   });

   it('locks amount changes once the statement is rolled into a newer one (absorbed)', async () => {
      const current = await views(customerA);
      // July statement absorbs June's balance into its beginning_balance.
      await insertInvoice({
         customer_id: customerA,
         invoice_number: 'TEST-CASCADE-DELTA-07',
         invoice_date: '2026-07-31',
         start_date: '2026-07-01',
         end_date: '2026-07-31',
         beginning_balance: current.ar,
         total_amount_due: current.ar,
         remaining_balance_on_invoice: current.ar,
         created_at: '2026-08-01 12:00:00'
      });
      const before = JSON.stringify(await chainRows(parent.customer_invoice_id));

      const err = await rejects(edit(ids.txns.time, { total_transaction: 1000 }));
      expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
      expect(err.message).to.equal(MESSAGES.ABSORBED);
      expect(err.absorbedBy).to.equal('TEST-CASCADE-DELTA-07');
      expect(JSON.stringify(await chainRows(parent.customer_invoice_id))).to.equal(before);
      expect(num((await db('customer_transactions').where({ transaction_id: ids.txns.time }).first()).total_transaction)).to.equal(900);

      // Notes stay editable on the absorbed statement.
      const { diff } = await edit(ids.txns.time, { note: 'reviewed after close' });
      expect(Object.keys(diff)).to.deep.equal(['note']);
      expect(JSON.stringify(await chainRows(parent.customer_invoice_id))).to.equal(before);
   });
   describe('concurrent saves (two connections, customer ledger lock)', () => {
      // Barrier: resolves once another backend is blocked on a lock held by `holderPid`.
      const waitUntilBlockedBy = async (holderPid, timeoutMs = 15_000) => {
         const deadline = Date.now() + timeoutMs;
         for (;;) {
            const { rows } = await db.raw('SELECT count(*)::int AS n FROM pg_stat_activity WHERE ? = ANY (pg_blocking_pids(pid))', [holderPid]);
            if (rows[0].n > 0) return;
            if (Date.now() > deadline) throw new Error(`no session blocked on backend ${holderPid} within ${timeoutMs}ms`);
            await new Promise(resolve => setTimeout(resolve, 25));
         }
      };

      // Its own customer with one $100 statement billing one $100 charge.
      const billedStatement = async label => {
         const customerId = await createCustomer(label);
         const statement = await insertInvoice({
            customer_id: customerId,
            invoice_number: `TEST-CASCADE-${label.toUpperCase().replace(/\W+/g, '-')}`,
            invoice_date: '2026-08-31',
            start_date: '2026-08-01',
            end_date: '2026-08-31',
            total_charges: 100,
            total_amount_due: 100,
            remaining_balance_on_invoice: 100,
            created_at: '2026-09-01 12:00:00'
         });
         const txn = await insertTxn({
            customer_id: customerId,
            customer_job_id: ids.jobs[customerId],
            customer_invoice_id: statement.customer_invoice_id,
            is_transaction_billable: true,
            transaction_date: '2026-08-15',
            quantity: 1,
            unit_cost: 100,
            total_transaction: 100
         });
         return { customerId, statement, txn };
      };

      const arOutstanding = async customerId => {
         const { rows } = await accountsReceivableService.getAging(db, A, { search: String(customerId), limit: 50 });
         const row = rows.find(r => Number(r.customer_id) === Number(customerId));
         return row ? round2(row.total_outstanding) : 0;
      };

      it('two overlapping saves of one row serialize: A plans $150, B saves $200 first → A posts -$50 on top of B', async () => {
         const { customerId, statement, txn } = await billedStatement('Race Same Row');
         const holder = await db.transaction();
         let saveA = null;
         try {
            const {
               rows: [{ pid }]
            } = await holder.raw('SELECT pg_backend_pid() AS pid');
            // B takes the customer ledger lock and saves $200 — not committed yet.
            const saveB = await applyTransactionEdit({ db: holder, accountId: A, transactionId: txn.transaction_id, updates: { total_transaction: 200 }, editingUserId: USER });
            expect(saveB.sideEffects.find(s => s.type === 'invoice_recalculated').delta).to.equal(100);

            // A reads the committed $100 row (plans +$50 on what it saw) and must wait on B's lock.
            saveA = applyTransactionEdit({ db, accountId: A, transactionId: txn.transaction_id, updates: { total_transaction: 150 }, editingUserId: USER });
            saveA.catch(() => {}); // settled by the await below
            await waitUntilBlockedBy(pid);
            await holder.commit();
         } finally {
            if (!holder.isCompleted()) await holder.rollback();
         }

         const resultA = await saveA;
         // Diff and delta come from the row as re-read under the lock (B's $200), not A's stale $100.
         expect(resultA.diff.total_transaction).to.deep.equal({ from: '200.00', to: 150 });
         const effectA = resultA.sideEffects.find(s => s.type === 'invoice_recalculated');
         expect(effectA).to.include({ delta: -50, totalCharges: 150, remainingBalance: 150 });

         const row = await db('customer_transactions').where({ transaction_id: txn.transaction_id }).first();
         expect(num(row.total_transaction)).to.equal(150);
         const parentRowAfter = await db('customer_invoices').where({ customer_invoice_id: statement.customer_invoice_id }).first();
         expect(num(parentRowAfter.total_charges)).to.equal(150);
         expect(num(parentRowAfter.remaining_balance_on_invoice)).to.equal(150); // not 250
         const latest = await paymentLogic.getLatestChainRow(db, A, statement.customer_invoice_id);
         expect(latest.customer_invoice_id).to.equal(effectA.snapshotInvoiceId);
         expect(num(latest.remaining_balance_on_invoice)).to.equal(150);

         expect(await views(customerId)).to.deep.equal({ engine: 150, audit: 150, ar: 150 });
      });

      it('an adjustment that waited on the lock while a payment committed sorts AFTER that payment snapshot', async () => {
         const { customerId, statement, txn } = await billedStatement('Race Payment');
         const holder = await db.transaction();
         let reviewerSave = null;
         let payment;
         try {
            const {
               rows: [{ pid }]
            } = await holder.raw('SELECT pg_backend_pid() AS pid');
            await lockCustomerLedger(holder, A, customerId);

            // The reviewer's transaction BEGINs (now() is fixed from here) and waits on the lock...
            reviewerSave = applyTransactionEdit({ db, accountId: A, transactionId: txn.transaction_id, updates: { total_transaction: 110 }, editingUserId: USER });
            reviewerSave.catch(() => {}); // settled by the await below
            await waitUntilBlockedBy(pid);

            // ...while a $50 payment is posted and committed (its snapshot is stamped clock_timestamp()).
            payment = await paymentLogic.createPaymentCore(holder, {
               paymentFields: {
                  account_id: A,
                  customer_id: customerId,
                  customer_invoice_id: statement.customer_invoice_id,
                  payment_amount: -50,
                  payment_date: '2026-09-10',
                  form_of_payment: 'Check',
                  created_by_user_id: USER
               }
            });
            await holder.commit();
         } finally {
            if (!holder.isCompleted()) await holder.rollback();
         }

         const result = await reviewerSave;
         const effect = result.sideEffects.find(s => s.type === 'invoice_recalculated');
         expect(effect).to.include({ delta: 10, remainingBalance: 60 }); // payment snapshot 50 + 10

         const {
            rows: [order]
         } = await db.raw(
            `SELECT adj.created_at > pay.created_at AS adjustment_is_later, adj.customer_invoice_id > pay.customer_invoice_id AS adjustment_id_is_higher
               FROM customer_invoices adj, customer_invoices pay
              WHERE adj.customer_invoice_id = ? AND pay.customer_invoice_id = ?`,
            [effect.snapshotInvoiceId, payment.snapshot.customer_invoice_id]
         );
         expect(order).to.deep.equal({ adjustment_is_later: true, adjustment_id_is_higher: true });

         // Every latest-snapshot reader picks the adjustment.
         expect((await paymentLogic.getLatestChainRow(db, A, statement.customer_invoice_id)).customer_invoice_id).to.equal(effect.snapshotInvoiceId);
         expect((await invoiceService.getLatestChildInvoice(db, A, statement.customer_invoice_id)).customer_invoice_id).to.equal(effect.snapshotInvoiceId);
         const parentRowAfter = await db('customer_invoices').where({ customer_invoice_id: statement.customer_invoice_id }).first();
         expect(num(parentRowAfter.remaining_balance_on_invoice)).to.equal(60);
         expect(await arOutstanding(customerId)).to.equal(60);
         // Engine (getOutstandingInvoices), Account Audit (chain sort) and AR (parent mirror) agree.
         expect(await views(customerId)).to.deep.equal({ engine: 60, audit: 60, ar: 60 });
      });
   });
});
