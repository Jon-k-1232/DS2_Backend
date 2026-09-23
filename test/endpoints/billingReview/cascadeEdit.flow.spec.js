const { applyTransactionEdit, _applyInvoiceDelta, ERRORS, MESSAGES } = require('../../../src/endpoints/billingReview/cascadeEdit');
const { buildStubDb, caught } = require('./_stubDb');

const ACCOUNT = 9001;

describe('cascadeEdit applyTransactionEdit (flow)', () => {
   const baseTxn = {
      transaction_id: 1,
      account_id: ACCOUNT,
      customer_id: 100,
      customer_job_id: 200,
      customer_invoice_id: 300,
      retainer_id: null,
      logged_for_user_id: 7,
      general_work_description_id: 50,
      detailed_work_description: '',
      transaction_date: '2026-04-15',
      transaction_type: 'Time',
      quantity: '1.00',
      unit_cost: '100.00',
      total_transaction: '100.00',
      is_transaction_billable: true,
      note: ''
   };

   // Parent (root) of the current chain. total_payments deliberately POSITIVE:
   // legacy parents store a magnitude, so any formula that read it would be wrong.
   const baseInvoice = {
      customer_invoice_id: 300,
      parent_invoice_id: null,
      account_id: ACCOUNT,
      customer_id: 100,
      customer_info_id: 1,
      invoice_number: 'INV-2026-00300',
      invoice_date: '2026-04-30',
      due_date: '2026-05-30',
      beginning_balance: '0.00',
      total_payments: '250.00',
      total_charges: '100.00',
      total_write_offs: '0.00',
      total_retainers: '0.00',
      total_amount_due: '100.00',
      remaining_balance_on_invoice: '100.00',
      is_invoice_paid_in_full: false,
      fully_paid_date: null,
      created_at: new Date('2026-04-30T18:00:00Z'),
      created_by_user_id: 7,
      start_date: '2026-04-01',
      end_date: '2026-04-30',
      notes: null
   };

   // A payment snapshot on the same chain (customer paid $60 of $100).
   const paymentSnapshot = {
      ...baseInvoice,
      customer_invoice_id: 301,
      parent_invoice_id: 300,
      remaining_balance_on_invoice: '40.00',
      created_at: new Date('2026-05-05T18:00:00Z')
   };

   const baseJob = { customer_job_id: 200, account_id: ACCOUNT, customer_id: 100, job_type_id: 1, current_job_total: 100 };
   const otherCustomerJob = { customer_job_id: 201, account_id: ACCOUNT, customer_id: 999, job_type_id: 1, current_job_total: 0 };
   const customers = [
      { customer_id: 100, account_id: ACCOUNT, display_name: 'Acme' },
      { customer_id: 999, account_id: ACCOUNT, display_name: 'Globex' },
      { customer_id: 555, account_id: 1234, display_name: 'Other tenant' }
   ];
   const gwds = [
      { general_work_description_id: 50, account_id: ACCOUNT, general_work_description: 'Old Description' },
      { general_work_description_id: 51, account_id: ACCOUNT, general_work_description: 'New Description' },
      { general_work_description_id: 77, account_id: 1234, general_work_description: 'Other tenant' }
   ];

   const makeDb = ({ txn = {}, invoices = [{ ...baseInvoice }], jobs = [{ ...baseJob }, { ...otherCustomerJob }] } = {}) =>
      buildStubDb({
         customer_transactions: [{ ...baseTxn, ...txn }],
         customer_invoices: invoices,
         customer_jobs: jobs,
         customers,
         customer_general_work_descriptions: gwds,
         ai_category_training_examples: [],
         ai_reviewer_corrections: []
      });

   const edit = (db, updates, extra = {}) => applyTransactionEdit({ db, accountId: ACCOUNT, transactionId: 1, updates, editingUserId: 7, ...extra });

   // What the Billing Review grid sends on every save: every field, unchanged
   // values included (dates as YYYY-MM-DD, amounts as numbers).
   const fullRowPayload = (overrides = {}) => ({
      customer_id: 100,
      customer_job_id: 200,
      general_work_description_id: 50,
      transaction_date: '2026-04-15',
      quantity: 1,
      unit_cost: 100,
      total_transaction: 100,
      is_transaction_billable: true,
      note: '',
      ...overrides
   });

   const invoiceRows = db => db._store.customer_invoices;
   const parentRow = db => invoiceRows(db).find(r => r.customer_invoice_id === 300);
   const adjustmentRows = db => invoiceRows(db).filter(r => /\[adjustment:/.test(r.notes || ''));

   describe('no-op and non-financial edits', () => {
      it('returns no-op when nothing actually changes', async () => {
         const db = makeDb();
         const result = await edit(db, { customer_id: 100, note: '' });
         expect(result.diff).to.deep.equal({});
         expect(result.sideEffects).to.deep.equal([]);
      });

      it('treats a full-row payload with a pg Date / numeric strings as unchanged', async () => {
         const db = makeDb({ txn: { transaction_date: new Date(2026, 3, 15) } });
         const result = await edit(db, fullRowPayload());
         expect(result.diff).to.deep.equal({});
         expect(result.sideEffects).to.deep.equal([]);
      });

      it('a note edit never touches invoice rows (full-row payload)', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice }, { ...paymentSnapshot }] });
         const before = JSON.stringify(invoiceRows(db));
         const result = await edit(db, fullRowPayload({ note: 'called client about K-1' }));
         expect(Object.keys(result.diff)).to.deep.equal(['note']);
         expect(JSON.stringify(invoiceRows(db))).to.equal(before);
         expect(result.sideEffects.some(s => /invoice/.test(s.type))).to.equal(false);
         expect(db._store.customer_transactions[0].note).to.equal('called client about K-1');
         // ...and never reads or locks them either.
         expect(db._calls.queries.filter(q => q.table === 'customer_invoices')).to.have.lengthOf(0);
      });

      it('allows a note edit on a statement that is paid in full', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, is_invoice_paid_in_full: true, remaining_balance_on_invoice: '0.00' }] });
         const result = await edit(db, fullRowPayload({ note: 'paid by check 1042' }));
         expect(Object.keys(result.diff)).to.deep.equal(['note']);
         expect(adjustmentRows(db)).to.have.lengthOf(0);
      });

      it('an unchanged date outside the statement period does not 409', async () => {
         // Legacy row dated outside its invoice window; the UI re-sends the same date.
         const db = makeDb({ txn: { transaction_date: new Date(2026, 2, 28) } });
         const result = await edit(db, fullRowPayload({ transaction_date: '2026-03-28', note: 'fixed typo' }));
         expect(Object.keys(result.diff)).to.deep.equal(['note']);
      });

      it('a date change inside the statement period does not touch invoice rows', async () => {
         const db = makeDb();
         const before = JSON.stringify(invoiceRows(db));
         const result = await edit(db, fullRowPayload({ transaction_date: '2026-04-20' }));
         expect(result.diff).to.deep.equal({ transaction_date: { from: '2026-04-15', to: '2026-04-20' } });
         expect(JSON.stringify(invoiceRows(db))).to.equal(before);
         expect(db._store.customer_transactions[0].transaction_date).to.equal('2026-04-20');
      });

      it('rejects transaction_date when it falls outside the linked invoice period', async () => {
         const db = makeDb();
         const err = await caught(edit(db, { transaction_date: '2026-06-15' }));
         expect(err.code).to.equal(ERRORS.DATE_OUTSIDE_INVOICE);
         expect(err.invoiceId).to.equal(300);
         expect(db._store.customer_transactions[0].transaction_date).to.equal('2026-04-15');
      });

      it('writes a training-example row when general_work_description_id changes', async () => {
         const db = makeDb();
         const result = await edit(db, { general_work_description_id: 51 });
         const trainingEffect = result.sideEffects.find(s => s.type === 'training_example_written');
         expect(trainingEffect).to.exist;
         const trainingRows = db._store.ai_category_training_examples;
         expect(trainingRows).to.have.lengthOf(1);
         expect(trainingRows[0].original_category).to.equal('Old Description');
         expect(trainingRows[0].final_category).to.equal('New Description');
         expect(trainingRows[0].ai_source).to.equal('reviewer_edit');
         expect(db._store.ai_reviewer_corrections.map(r => r.field_name)).to.deep.equal(['general_work_description_id']);
         expect(adjustmentRows(db)).to.have.lengthOf(0);
      });

      it("rejects another account's work description", async () => {
         const db = makeDb();
         const err = await caught(edit(db, { general_work_description_id: 77 }));
         expect(err.code).to.equal(ERRORS.INVALID_FIELD_VALUE);
         expect(err.field).to.equal('general_work_description_id');
      });

      it('rejects retainer_id edits via this endpoint', async () => {
         const db = makeDb();
         const err = await caught(edit(db, { retainer_id: 5 }));
         expect(err.code).to.equal(ERRORS.RETAINER_NOT_EDITABLE_HERE);
      });

      it('rejects blank amounts instead of letting the DB throw', async () => {
         const db = makeDb();
         const err = await caught(edit(db, fullRowPayload({ quantity: null })));
         expect(err.code).to.equal(ERRORS.INVALID_FIELD_VALUE);
         expect(err.field).to.equal('quantity');
      });
   });

   describe('billable-amount delta', () => {
      it('posts the delta to the parent and a NEW adjustment snapshot (chain without snapshots)', async () => {
         const db = makeDb();
         const result = await edit(db, fullRowPayload({ total_transaction: 250 }));

         const parent = parentRow(db);
         expect(parent.total_charges).to.equal(250);
         expect(parent.total_amount_due).to.equal(250);
         expect(parent.remaining_balance_on_invoice).to.equal(250);
         expect(parent.is_invoice_paid_in_full).to.equal(false);

         const [adj] = adjustmentRows(db);
         expect(adj.parent_invoice_id).to.equal(300);
         expect(adj.remaining_balance_on_invoice).to.equal(250);
         expect(adj.invoice_number).to.equal('INV-2026-00300');
         // chain rows were re-read FOR UPDATE inside the transaction
         expect(db._calls.queries.some(q => q.table === 'customer_invoices' && q.forUpdate)).to.equal(true);
         expect(adj.notes).to.equal('[adjustment: transaction #1 Δ+150.00]');
         // Stamped with clock_timestamp() (ledgerNow) at INSERT, like payment /
         // write-off snapshots — never the column default now() (transaction BEGIN).
         expect(db._calls.raws).to.deep.equal([{ table: 'customer_invoices', column: 'created_at', sql: 'clock_timestamp()' }]);
         expect(adj.created_at).to.be.an.instanceOf(Date);

         const effect = result.sideEffects.find(s => s.type === 'invoice_recalculated');
         expect(effect).to.include({ mode: 'delta', delta: 150, totalCharges: 250, totalAmountDue: 250, remainingBalance: 250, invoiceId: 300 });
         expect(effect.snapshotInvoiceId).to.equal(adj.customer_invoice_id);

         const jobEffect = result.sideEffects.find(s => s.type === 'old_job_recalculated');
         expect(jobEffect.total).to.equal(250);
      });

      it('builds on the latest payment snapshot and leaves earlier snapshots untouched', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, remaining_balance_on_invoice: '40.00' }, { ...paymentSnapshot }] });
         await edit(db, fullRowPayload({ total_transaction: 250 }));

         expect(invoiceRows(db).find(r => r.customer_invoice_id === 301).remaining_balance_on_invoice).to.equal('40.00');
         const [adj] = adjustmentRows(db);
         expect(adj.parent_invoice_id).to.equal(300);
         expect(adj.remaining_balance_on_invoice).to.equal(190); // 40 + 150
         expect(parentRow(db).remaining_balance_on_invoice).to.equal(190); // parent mirror
      });

      it('never reads or writes total_payments (legacy POSITIVE value survives)', async () => {
         const db = makeDb();
         await edit(db, fullRowPayload({ total_transaction: 130 }));
         expect(parentRow(db).total_payments).to.equal('250.00');
         expect(adjustmentRows(db)[0].total_payments).to.equal('250.00'); // copied verbatim, not recomputed
         // A formula using total_payments would have produced 130 ± 250; the delta path gives 130.
         expect(parentRow(db).remaining_balance_on_invoice).to.equal(130);
      });

      it('re-prices from quantity when the total sent is the stale original', async () => {
         const db = makeDb();
         const result = await edit(db, fullRowPayload({ quantity: 2.5 }));
         expect(result.diff.total_transaction).to.deep.equal({ from: '100.00', to: 250 });
         expect(db._store.customer_transactions[0].total_transaction).to.equal(250);
         expect(parentRow(db).total_charges).to.equal(250);
      });

      it('ignores non-billable rows (no invoice change)', async () => {
         const db = makeDb({ txn: { is_transaction_billable: false } });
         const before = JSON.stringify(invoiceRows(db));
         const result = await edit(db, fullRowPayload({ total_transaction: 400, is_transaction_billable: false }));
         expect(Object.keys(result.diff)).to.deep.equal(['total_transaction']);
         expect(JSON.stringify(invoiceRows(db))).to.equal(before);
         expect(result.sideEffects.find(s => s.type === 'old_job_recalculated').total).to.equal(400);
      });

      it('flipping billable -> non-billable removes the amount (statement reaching $0 is then paid/locked)', async () => {
         const db = makeDb();
         await edit(db, fullRowPayload({ is_transaction_billable: false }));
         expect(parentRow(db).total_charges).to.equal(0);
         expect(parentRow(db).remaining_balance_on_invoice).to.equal(0);
         expect(parentRow(db).is_invoice_paid_in_full).to.equal(true);
         expect(adjustmentRows(db)[0].notes).to.equal('[adjustment: transaction #1 Δ-100.00]');
         // $0 balance ⇒ paid in full ⇒ further amount changes are locked.
         const err = await caught(edit(db, fullRowPayload({ is_transaction_billable: true })));
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
         expect(err.reason).to.equal('paid_in_full');
      });

      it('flipping non-billable -> billable adds the full amount', async () => {
         const db = makeDb({ txn: { is_transaction_billable: false } });
         const result = await edit(db, fullRowPayload({ is_transaction_billable: true }));
         expect(result.sideEffects.find(s => s.type === 'invoice_recalculated').delta).to.equal(100);
         expect(parentRow(db).total_charges).to.equal(200);
         expect(parentRow(db).remaining_balance_on_invoice).to.equal(200);
      });

      it('marks both rows paid (with a fully_paid_date) when the balance reaches zero', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, remaining_balance_on_invoice: '40.00' }, { ...paymentSnapshot }] });
         await edit(db, fullRowPayload({ total_transaction: 60 })); // -40 → remaining 0
         const [adj] = adjustmentRows(db);
         expect(adj.remaining_balance_on_invoice).to.equal(0);
         expect(adj.is_invoice_paid_in_full).to.equal(true);
         expect(adj.fully_paid_date).to.match(/^\d{4}-\d{2}-\d{2}$/);
         expect(parentRow(db).is_invoice_paid_in_full).to.equal(true);
         expect(parentRow(db).fully_paid_date).to.equal(adj.fully_paid_date);
      });

      it('refuses a reduction that would leave a credit balance (engine would drop it)', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, remaining_balance_on_invoice: '40.00' }, { ...paymentSnapshot }] });
         const err = await caught(edit(db, fullRowPayload({ total_transaction: 10 }))); // -90 vs 40 remaining
         expect(err.code).to.equal(ERRORS.EDIT_WOULD_CREATE_CREDIT);
         expect(db._store.customer_transactions[0].total_transaction).to.equal('100.00');
         expect(adjustmentRows(db)).to.have.lengthOf(0);
      });

      it('rejects amount edits when the statement is paid in full', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, is_invoice_paid_in_full: true, remaining_balance_on_invoice: '0.00' }] });
         const err = await caught(edit(db, { total_transaction: 200 }));
         expect(err).to.be.an('error');
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
         expect(err.message).to.equal(MESSAGES.PAID_IN_FULL);
         expect(err.invoiceId).to.equal(300);
         expect(db._store.customer_transactions[0].total_transaction).to.equal('100.00');
      });

      it('treats the chain as paid when the latest snapshot says so (parent mirror stale)', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice }, { ...paymentSnapshot, remaining_balance_on_invoice: '0.00', is_invoice_paid_in_full: true }] });
         const err = await caught(edit(db, { total_transaction: 200 }));
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
      });
   });

   describe('absorbed (rolled-forward) statements', () => {
      const newerParent = {
         ...baseInvoice,
         customer_invoice_id: 400,
         invoice_number: 'INV-2026-00400',
         invoice_date: '2026-05-31',
         created_at: new Date('2026-05-31T18:00:00Z'),
         beginning_balance: '100.00',
         total_charges: '0.00',
         total_amount_due: '100.00',
         remaining_balance_on_invoice: '100.00',
         start_date: '2026-05-01',
         end_date: '2026-05-31'
      };

      it('locks amount edits when a newer parent statement exists', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, remaining_balance_on_invoice: '0.00' }, { ...newerParent }] });
         const before = JSON.stringify(invoiceRows(db));
         const err = await caught(edit(db, fullRowPayload({ total_transaction: 250 })));
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
         expect(err.message).to.equal(
            'This transaction was billed on a statement that has already been rolled into a newer one; post an adjustment on the current statement instead.'
         );
         expect(err.reason).to.equal('absorbed');
         expect(err.absorbedBy).to.equal('INV-2026-00400');
         expect(JSON.stringify(invoiceRows(db))).to.equal(before);
         expect(db._store.customer_transactions[0].total_transaction).to.equal('100.00');
      });

      it('locks amount edits when the chain carries an [absorbed_by:] marker', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, remaining_balance_on_invoice: '0.00', notes: '[absorbed_by:INV-2026-00400@2026-05-31]' }] });
         const err = await caught(edit(db, { is_transaction_billable: false }));
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
         expect(err.reason).to.equal('absorbed');
      });

      it('locks a same-day duplicate parent that was created earlier', async () => {
         const sameDayLater = { ...newerParent, invoice_date: '2026-04-30', created_at: new Date('2026-04-30T18:05:00Z') };
         const db = makeDb({ invoices: [{ ...baseInvoice }, sameDayLater] });
         const err = await caught(edit(db, { total_transaction: 90 }));
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
      });

      it('still allows non-financial edits on an absorbed statement', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, remaining_balance_on_invoice: '0.00' }, { ...newerParent }] });
         const result = await edit(db, fullRowPayload({ note: 'clarified scope', general_work_description_id: 51 }));
         expect(Object.keys(result.diff).sort()).to.deep.equal(['general_work_description_id', 'note']);
         expect(adjustmentRows(db)).to.have.lengthOf(0);
      });

      it("does not treat another customer's newer invoice as absorbing this one", async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice }, { ...newerParent, customer_id: 999 }] });
         await edit(db, { total_transaction: 120 });
         expect(parentRow(db).total_charges).to.equal(120);
      });
   });

   describe('customer / job changes', () => {
      it('rejects customer_id changes without confirm flag', async () => {
         const db = makeDb();
         const err = await caught(edit(db, { customer_id: 999 }, { confirmCustomerChange: false }));
         expect(err.code).to.equal(ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM);
      });

      it('requires a job when the customer changes', async () => {
         const db = makeDb();
         const err = await caught(edit(db, { customer_id: 999 }, { confirmCustomerChange: true }));
         expect(err.code).to.equal(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE);
         expect(err.message).to.equal(MESSAGES.JOB_MISSING_FOR_CUSTOMER_CHANGE);
         expect(db._store.customer_transactions[0].customer_id).to.equal(100);
      });

      it("refuses the OLD customer's job on a customer change (what the grid sends if no new job is picked)", async () => {
         const db = makeDb();
         const err = await caught(edit(db, fullRowPayload({ customer_id: 999 }), { confirmCustomerChange: true }));
         expect(err.code).to.equal(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE);
         expect(err.message).to.match(/does not belong to the new customer/);
      });

      it("refuses a customer in another account", async () => {
         const db = makeDb();
         const err = await caught(edit(db, { customer_id: 555, customer_job_id: 201 }, { confirmCustomerChange: true }));
         expect(err.code).to.equal(ERRORS.INVALID_FIELD_VALUE);
         expect(err.field).to.equal('customer_id');
      });

      it('keeps the supplied job, unbills the row and takes its amount off the old statement', async () => {
         const db = makeDb();
         const result = await edit(db, fullRowPayload({ customer_id: 999, customer_job_id: 201 }), { confirmCustomerChange: true });
         const updated = db._store.customer_transactions[0];
         expect(updated.customer_id).to.equal(999);
         expect(updated.customer_job_id).to.equal(201);
         expect(updated.customer_invoice_id).to.equal(null);

         expect(parentRow(db).total_charges).to.equal(0);
         expect(parentRow(db).remaining_balance_on_invoice).to.equal(0);
         expect(adjustmentRows(db)[0].notes).to.equal('[adjustment: transaction #1 Δ-100.00]');
         expect(result.sideEffects.some(s => s.type === 'old_invoice_recalculated_after_customer_change' && s.delta === -100)).to.equal(true);
         expect(result.sideEffects.some(s => s.type === 'transaction_unlinked_from_invoice' && s.invoiceId === 300)).to.equal(true);
         expect(result.sideEffects.some(s => s.type === 'new_job_recalculated' && s.customerJobId === 201)).to.equal(true);
      });

      it('a customer change on an absorbed statement is refused (it would move billed money)', async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, notes: '[absorbed_by:INV-2026-00400@2026-05-31]' }] });
         const err = await caught(edit(db, { customer_id: 999, customer_job_id: 201 }, { confirmCustomerChange: true }));
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
         expect(db._store.customer_transactions[0].customer_id).to.equal(100);
      });

      it("refuses a job that belongs to a different customer (job-only change)", async () => {
         const db = makeDb();
         const err = await caught(edit(db, { customer_job_id: 201 }));
         expect(err.code).to.equal(ERRORS.INVALID_FIELD_VALUE);
         expect(err.field).to.equal('customer_job_id');
      });

      it('refuses unlinking the job', async () => {
         const db = makeDb();
         const err = await caught(edit(db, { customer_job_id: null }));
         expect(err.code).to.equal(ERRORS.INVALID_FIELD_VALUE);
         expect(err.message).to.equal(MESSAGES.JOB_REQUIRED);
      });

      it('unbilled rows change customer without any invoice side effects', async () => {
         const db = makeDb({ txn: { customer_invoice_id: null } });
         const before = JSON.stringify(invoiceRows(db));
         const result = await edit(db, { customer_id: 999, customer_job_id: 201 }, { confirmCustomerChange: true });
         expect(JSON.stringify(invoiceRows(db))).to.equal(before);
         expect(result.sideEffects.some(s => /invoice/.test(s.type))).to.equal(false);
      });
   });

   describe('ledger locking (concurrent saves)', () => {
      // Customer ids whose ledger rows were locked (SELECT … FOR UPDATE on customers), in order.
      const customerLocks = db => db._calls.queries.filter(q => q.table === 'customers' && q.forUpdate).map(q => q.filters[0].customer_id);

      // Run `steps` (one per ledger-transaction attempt) right before each of
      // the edit's transactions starts — i.e. AFTER its unlocked preview read,
      // which is exactly where a competing save can land.
      const beforeEachAttempt = (db, ...steps) => {
         const run = db.transaction;
         db.transaction = async cb => {
            const step = steps.shift();
            if (step) await step();
            return run(cb);
         };
         return db;
      };

      it('takes the customer ledger lock first, then re-reads the row FOR UPDATE', async () => {
         const db = makeDb();
         await edit(db, fullRowPayload({ total_transaction: 120 }));
         const q = db._calls.queries;
         const lockAt = q.findIndex(x => x.table === 'customers' && x.forUpdate);
         const rereadAt = q.findIndex(x => x.table === 'customer_transactions' && x.forUpdate);
         const chainAt = q.findIndex(x => x.table === 'customer_invoices');
         expect(customerLocks(db)).to.deep.equal([100]);
         expect(lockAt).to.be.greaterThan(-1);
         expect(rereadAt).to.be.greaterThan(lockAt);
         expect(chainAt).to.be.greaterThan(rereadAt);
         // The only read before the lock is the unlocked preview of the row.
         expect(q.slice(0, lockAt).map(x => `${x.table}:${x.forUpdate}`)).to.deep.equal(['customer_transactions:false']);
      });

      it('locks both customers of a customer change in ascending id order', async () => {
         const up = makeDb();
         await edit(up, fullRowPayload({ customer_id: 999, customer_job_id: 201 }), { confirmCustomerChange: true });
         expect(customerLocks(up)).to.deep.equal([100, 999]);

         const down = makeDb({ txn: { customer_id: 999, customer_job_id: 201, customer_invoice_id: null } });
         await edit(down, fullRowPayload({ customer_id: 100, customer_job_id: 200 }), { confirmCustomerChange: true });
         expect(customerLocks(down)).to.deep.equal([100, 999]);
         expect(down._store.customer_transactions[0].customer_id).to.equal(100);
      });

      it("recomputes the diff and delta from the locked row: A plans $150, B saves $200 first → A posts -$50 on B's result", async () => {
         const db = makeDb();
         let saveB;
         beforeEachAttempt(db, async () => {
            saveB = await edit(db, fullRowPayload({ total_transaction: 200 }));
         });
         const saveA = await edit(db, fullRowPayload({ total_transaction: 150 }));

         expect(saveB.sideEffects.find(s => s.type === 'invoice_recalculated').delta).to.equal(100);
         expect(saveA.diff.total_transaction).to.deep.equal({ from: 200, to: 150 });
         expect(saveA.sideEffects.find(s => s.type === 'invoice_recalculated')).to.include({ delta: -50, remainingBalance: 150, totalCharges: 150 });

         expect(db._store.customer_transactions[0].total_transaction).to.equal(150);
         expect(parentRow(db)).to.include({ total_charges: 150, total_amount_due: 150, remaining_balance_on_invoice: 150 });
         // A's adjustment was copied from B's snapshot (notes carry both markers) and sorts after it.
         expect(adjustmentRows(db).map(r => r.notes)).to.deep.equal([
            '[adjustment: transaction #1 Δ+100.00]',
            '[adjustment: transaction #1 Δ+100.00] [adjustment: transaction #1 Δ-50.00]'
         ]);
         const [adjB, adjA] = adjustmentRows(db);
         expect(adjA.remaining_balance_on_invoice).to.equal(150);
         expect(adjA.created_at.getTime()).to.be.greaterThan(adjB.created_at.getTime());
      });

      it('a competing save of the same value turns the edit into a no-op (no second adjustment)', async () => {
         const db = makeDb();
         beforeEachAttempt(db, () => edit(db, fullRowPayload({ total_transaction: 150 })));
         const result = await edit(db, fullRowPayload({ total_transaction: 150 }));
         expect(result.diff).to.deep.equal({});
         expect(result.sideEffects).to.deep.equal([]);
         expect(adjustmentRows(db)).to.have.lengthOf(1);
         expect(parentRow(db).remaining_balance_on_invoice).to.equal(150);
      });

      it('refuses on the locked chain state even when the preview looked fine (B paid the statement off first)', async () => {
         const db = makeDb();
         // B marks the only charge non-billable → statement at $0 → paid / locked.
         beforeEachAttempt(db, () => edit(db, fullRowPayload({ is_transaction_billable: false })));
         const err = await caught(edit(db, fullRowPayload({ total_transaction: 150 })));
         expect(err.code).to.equal(ERRORS.INVOICE_LOCKED);
         expect(err.reason).to.equal('paid_in_full');
         expect(db._store.customer_transactions[0].total_transaction).to.equal('100.00');
      });

      it('re-locks (rollback + retry) when the row moved to another customer after the preview', async () => {
         const db = makeDb();
         beforeEachAttempt(db, () => edit(db, fullRowPayload({ customer_id: 999, customer_job_id: 201 }), { confirmCustomerChange: true }));
         const result = await edit(db, { note: 'double-checked hours' });

         expect(Object.keys(result.diff)).to.deep.equal(['note']);
         // B locked [100, 999]; A's first attempt locked only 100, saw the row now
         // belongs to 999, rolled back and retried holding [100, 999].
         expect(customerLocks(db)).to.deep.equal([100, 999, 100, 100, 999]);
         const row = db._store.customer_transactions[0];
         expect(row).to.include({ customer_id: 999, note: 'double-checked hours', customer_invoice_id: null });
      });

      it('a full-row save built on the old customer becomes an (unconfirmed) customer change after a competing move', async () => {
         const db = makeDb();
         beforeEachAttempt(db, () => edit(db, fullRowPayload({ customer_id: 999, customer_job_id: 201 }), { confirmCustomerChange: true }));
         const err = await caught(edit(db, fullRowPayload({ note: 'stale grid row' })));
         expect(err.code).to.equal(ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM);
         expect(db._store.customer_transactions[0]).to.include({ customer_id: 999, note: '' });
      });

      it('gives up with concurrent_edit when the row keeps changing customer', async () => {
         const moving = [101, 102, 103];
         const db = buildStubDb({
            customer_transactions: [{ ...baseTxn, customer_invoice_id: null }],
            customer_invoices: [{ ...baseInvoice }],
            customer_jobs: [{ ...baseJob }],
            customers: [...customers, ...moving.map(id => ({ customer_id: id, account_id: ACCOUNT, display_name: `Moving ${id}` }))],
            customer_general_work_descriptions: gwds,
            ai_category_training_examples: [],
            ai_reviewer_corrections: []
         });
         beforeEachAttempt(db, ...moving.map(id => () => (db._store.customer_transactions[0].customer_id = id)));
         const err = await caught(edit(db, { note: 'never lands' }));
         expect(err.code).to.equal(ERRORS.CONCURRENT_EDIT);
         expect(err.message).to.equal(MESSAGES.CONCURRENT_EDIT);
         expect(db._store.customer_transactions[0].note).to.equal('');
         expect(db._store.ai_reviewer_corrections).to.have.lengthOf(0);
      });

      it("locks the statement's own customer when a legacy row is billed on another customer's statement", async () => {
         const db = makeDb({ invoices: [{ ...baseInvoice, customer_id: 999 }] });
         const result = await edit(db, fullRowPayload({ total_transaction: 130 }));
         expect(result.sideEffects.find(s => s.type === 'invoice_recalculated').delta).to.equal(30);
         expect(customerLocks(db)).to.deep.equal([100, 100, 999]);
         expect(parentRow(db).remaining_balance_on_invoice).to.equal(130);
      });

      it("refuses cleanly when the row's own customer is not in this account", async () => {
         const db = makeDb({ txn: { customer_id: 555, customer_invoice_id: null } });
         const err = await caught(edit(db, { note: 'x' }));
         expect(err.code).to.equal(ERRORS.NOT_FOUND);
         expect(err.message).to.equal(MESSAGES.CUSTOMER_MISSING);
      });
   });

   describe('retainer-funded transactions', () => {
      it('refuses amount / billable / customer changes but allows notes', async () => {
         const db = makeDb({ txn: { retainer_id: 12 } });
         for (const updates of [{ total_transaction: 90 }, { is_transaction_billable: false }]) {
            const err = await caught(edit(db, updates));
            expect(err.code, JSON.stringify(updates)).to.equal(ERRORS.RETAINER_NOT_EDITABLE_HERE);
         }
         const err = await caught(edit(db, { customer_id: 999, customer_job_id: 201 }, { confirmCustomerChange: true }));
         expect(err.code).to.equal(ERRORS.RETAINER_NOT_EDITABLE_HERE);
         const ok = await edit(db, { note: 'retainer draw verified' });
         expect(Object.keys(ok.diff)).to.deep.equal(['note']);
      });
   });
});

describe('cascadeEdit _applyInvoiceDelta', () => {
   const root = {
      customer_invoice_id: 10,
      parent_invoice_id: null,
      account_id: 9001,
      customer_id: 1,
      invoice_number: 'INV-2026-00010',
      beginning_balance: '20.00',
      total_payments: '-30.00',
      total_charges: '80.00',
      total_write_offs: '0.00',
      total_retainers: '0.00',
      total_amount_due: '100.00',
      remaining_balance_on_invoice: '70.00',
      is_invoice_paid_in_full: false,
      fully_paid_date: null,
      created_by_user_id: 2,
      created_at: new Date('2026-06-01T00:00:00Z'),
      notes: 'June statement'
   };
   const latest = { ...root, customer_invoice_id: 11, parent_invoice_id: 10, remaining_balance_on_invoice: '70.00', created_at: new Date('2026-06-05T00:00:00Z') };

   it('inserts an adjustment snapshot copied from the latest row and mirrors the parent', async () => {
      const db = buildStubDb({ customer_invoices: [{ ...root }, { ...latest }] });
      const out = await _applyInvoiceDelta(db, { accountId: 9001, chain: { root, latest }, delta: -25.5, transactionId: 42, editingUserId: 9 });

      expect(out).to.include({ invoiceId: 10, delta: -25.5, totalCharges: 54.5, totalAmountDue: 74.5, remainingBalance: 44.5, parentRemainingBalance: 44.5, isPaidInFull: false });
      const rows = db._store.customer_invoices;
      expect(rows).to.have.lengthOf(3);
      const snap = rows[2];
      expect(snap.customer_invoice_id).to.equal(out.snapshotInvoiceId);
      expect(snap).to.include({ parent_invoice_id: 10, remaining_balance_on_invoice: 44.5, total_payments: '-30.00', beginning_balance: '20.00', created_by_user_id: 9 });
      expect(snap.notes).to.equal('June statement [adjustment: transaction #42 Δ-25.50]');
      // created_at = clock_timestamp() at INSERT, so it sorts after the latest row it copied.
      expect(db._calls.raws).to.deep.equal([{ table: 'customer_invoices', column: 'created_at', sql: 'clock_timestamp()' }]);
      expect(snap.created_at.getTime()).to.be.greaterThan(latest.created_at.getTime());
      expect(rows[1].remaining_balance_on_invoice).to.equal('70.00'); // previous snapshot untouched
      expect(rows[0]).to.include({ total_charges: 54.5, total_amount_due: 74.5, remaining_balance_on_invoice: 44.5, total_payments: '-30.00' });
   });
});
