const billingReviewService = require('../../../src/endpoints/billingReview/billingReview-service');
const sharedTransactionFunctions = require('../../../src/endpoints/transactions/sharedTransactionFunctions');
const orchestrator = require('../../../src/endpoints/timesheets/auto-ingest-orchestrator');
const internalCustomers = require('../../../src/endpoints/timesheets/internal-customers');
const { buildStubDb, caught } = require('./_stubDb');

const ACCOUNT = 9001;

describe('billingReview-service applyHeldEntry', () => {
   let realAddNewTransaction;
   let realIsInternalCustomer;
   let addCalls;
   let internalIds;

   beforeEach(() => {
      realAddNewTransaction = sharedTransactionFunctions.addNewTransaction;
      realIsInternalCustomer = internalCustomers.isInternalCustomer;
      addCalls = [];
      internalIds = new Set();
      sharedTransactionFunctions.addNewTransaction = async (trx, fields) => {
         addCalls.push(fields);
         return { transaction_id: 500 + addCalls.length, total_transaction: fields.totalTransaction };
      };
      internalCustomers.isInternalCustomer = async (db, accountId, customerId) => internalIds.has(Number(customerId));
   });
   afterEach(() => {
      sharedTransactionFunctions.addNewTransaction = realAddNewTransaction;
      internalCustomers.isInternalCustomer = realIsInternalCustomer;
   });

   const makeDb = (entry = {}) =>
      buildStubDb({
         timesheet_entries: [{ timesheet_entry_id: 11, account_id: ACCOUNT, is_processed: false, is_deleted: false, duration: 20, category: 'Tax', ...entry }],
         customers: [
            { customer_id: 100, account_id: ACCOUNT },
            { customer_id: 101, account_id: ACCOUNT }
         ],
         customer_jobs: [
            { customer_job_id: 200, account_id: ACCOUNT, customer_id: 100 },
            { customer_job_id: 201, account_id: ACCOUNT, customer_id: 101 }
         ],
         users: [
            { user_id: 7, account_id: ACCOUNT, billing_rate: '150.00' },
            { user_id: 8, account_id: 1234, billing_rate: '999.00' }
         ],
         // 50: this account's own work description (used by default in `edits()`
         // below). 1: another tenant's — a valid FK, but not this account's own
         // (C8: "account 1's GWD id 1 from account 9001").
         customer_general_work_descriptions: [
            { general_work_description_id: 50, account_id: ACCOUNT },
            { general_work_description_id: 1, account_id: 1 }
         ],
         ai_time_tracker_transaction_suggestions: [{ timesheet_entry_id: 11, status: 'pending' }]
      });

   const edits = (overrides = {}) => ({
      customer_id: 100,
      customer_job_id: 200,
      general_work_description_id: 50,
      transaction_date: '2026-09-10',
      logged_for_user_id: 7,
      ...overrides
   });

   it("writes transaction_type 'Time' (capitalised) and prices in 6-minute increments rounded UP", async () => {
      const db = makeDb();
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ transaction_type: 'time', total_transaction: 50 }), 7);
      const [fields] = addCalls;
      expect(fields.transactionType).to.equal('Time');
      // 20 min -> ceil(20/6) = ceil(3.333) = 4 sixths -> 0.4h; 0.4 × 150 = 60.00
      // (client's 50.00 from unrounded hours is ignored).
      expect(fields.quantity).to.equal(0.4);
      expect(fields.unitCost).to.equal(150);
      expect(fields.totalTransaction).to.equal(60);
      expect(Math.round(fields.quantity * fields.unitCost * 100) / 100).to.equal(fields.totalTransaction);
      expect(fields.minutes).to.equal(20);
      expect(fields.customerInvoicesID).to.equal(null);
   });

   it("defaults to 'Time' when no type is sent and keeps 'Charge' spelled canonically", async () => {
      const db = makeDb();
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7);
      expect(addCalls[0].transactionType).to.equal('Time');
      const db2 = makeDb();
      await billingReviewService.applyHeldEntry(db2, ACCOUNT, 11, edits({ transaction_type: 'CHARGE' }), 7);
      expect(addCalls[1].transactionType).to.equal('Charge');
   });

   it('uses the reviewer-supplied minutes and rate', async () => {
      const db = makeDb();
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ duration_minutes: 90, unit_cost: 120 }), 7);
      expect(addCalls[0]).to.include({ quantity: 1.5, unitCost: 120, totalTransaction: 180 });
   });

   it('rejects a zero or negative duration with a clear error', async () => {
      for (const duration_minutes of [0, -15]) {
         const db = makeDb();
         const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ duration_minutes }), 7));
         expect(err.code, String(duration_minutes)).to.equal('INVALID_FIELD');
         expect(err.field).to.equal('duration_minutes');
         expect(err.message).to.equal('Duration must be greater than zero minutes.');
         expect(db._store.timesheet_entries[0].is_processed).to.equal(false);
      }
      const db = makeDb({ duration: 0 });
      const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7));
      expect(err.code).to.equal('INVALID_FIELD');
      expect(addCalls).to.have.lengthOf(0);
   });

   it("refuses a job that belongs to another customer, and another account's employee", async () => {
      const db = makeDb();
      const jobErr = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ customer_job_id: 201 }), 7));
      expect(jobErr.code).to.equal('INVALID_FIELD');
      expect(jobErr.field).to.equal('customer_job_id');
      const userErr = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ logged_for_user_id: 8 }), 7));
      expect(userErr.field).to.equal('logged_for_user_id');
      expect(addCalls).to.have.lengthOf(0);
   });

   it('reports a missing required field with a readable message', async () => {
      const db = makeDb();
      const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ customer_job_id: null }), 7));
      expect(err.code).to.equal('MISSING_FIELD');
      expect(err.field).to.equal('customer_job_id');
      expect(err.message).to.equal('Job is required before this entry can be applied.');
   });

   it('claims the entry so a second submit cannot create a duplicate transaction', async () => {
      const db = makeDb();
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7);
      expect(db._store.timesheet_entries[0].is_processed).to.equal(true);
      const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7));
      expect(err.code).to.equal('NOT_FOUND');
      expect(addCalls).to.have.lengthOf(1);
   });

   it('rolls the claim back when the transaction insert fails', async () => {
      const db = makeDb();
      sharedTransactionFunctions.addNewTransaction = async () => {
         throw new Error('Job was not found.');
      };
      const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7));
      expect(err.message).to.equal('Job was not found.');
      expect(db._store.timesheet_entries[0].is_processed).to.equal(false);
   });

   it('claims the entry (UPDATE … WHERE is_processed = false RETURNING) in the SAME transaction, before the insert', async () => {
      const db = makeDb();
      let seenAtInsert = null;
      sharedTransactionFunctions.addNewTransaction = async (trx, fields) => {
         seenAtInsert = { inTransaction: trx.isTransaction === true, claimed: db._store.timesheet_entries[0].is_processed };
         addCalls.push(fields);
         return { transaction_id: 501 };
      };
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7);
      expect(seenAtInsert).to.deep.equal({ inTransaction: true, claimed: true });
      expect(db._store.timesheet_entries[0]).to.include({ is_processed: true, hold_reason: null, matched_user_id: 7, suggested_customer_id: 100 });
   });

   it('a submit whose claim loses the race (entry applied after its pre-read) inserts nothing', async () => {
      const db = makeDb();
      const run = db.transaction;
      db.transaction = async cb => {
         db._store.timesheet_entries[0].is_processed = true; // the other submit committed first
         return run(cb);
      };
      const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7));
      expect(err.code).to.equal('NOT_FOUND');
      expect(addCalls).to.have.lengthOf(0);
   });

   it('prices in 6-minute increments rounded UP — same rule as the AI auto-insert path (orchestrator _computeTimeAmounts)', async () => {
      // 68 min @ $137.50: ceil(68/6) = ceil(11.333) = 12 sixths -> 1.2h; 1.2 × 137.50 = $165.00.
      const db = makeDb({ duration: 68 });
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ unit_cost: 137.5 }), 7);
      expect(addCalls[0]).to.include({ quantity: 1.2, unitCost: 137.5, totalTransaction: 165, minutes: 68 });

      // Every expected value below is hand-computed independently of
      // _computeTimeAmounts: quantity = ceil(minutes / 6) / 10 hours, total =
      // round2(quantity × rate).
      const cases = [
         // minutes, rate, quantity, total — arithmetic
         [333, 1.5, 5.6, 8.4], // ceil(333/6)=ceil(55.5)=56 -> 5.6h; 5.6 × 1.5 = 8.40
         [20, 150, 0.4, 60], // ceil(20/6)=ceil(3.333)=4 -> 0.4h; 0.4 × 150 = 60.00
         [7, 99.99, 0.2, 20], // ceil(7/6)=ceil(1.167)=2 -> 0.2h; 0.2 × 99.99 = 19.998 -> 20.00
         [98, 137.5, 1.7, 233.75], // ceil(98/6)=ceil(16.333)=17 -> 1.7h; 1.7 × 137.50 = 233.75
         [45, 262.5, 0.8, 210] // ceil(45/6)=ceil(7.5)=8 -> 0.8h; 0.8 × 262.50 = 210.00
      ];
      for (const [minutes, rate, quantity, total] of cases) {
         const caseDb = makeDb();
         await billingReviewService.applyHeldEntry(caseDb, ACCOUNT, 11, edits({ duration_minutes: minutes, unit_cost: rate }), 7);
         const { quantity: q, unitCost: u, totalTransaction: t } = addCalls[addCalls.length - 1];
         expect({ quantity: q, unitCost: u, totalTransaction: t }, `${minutes} min @ ${rate}`).to.deep.equal({ quantity, unitCost: rate, totalTransaction: total });
      }
   });

   it('rejects a rate with more than 2 decimal places instead of silently rounding it', async () => {
      const db = makeDb();
      const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ unit_cost: 1.005 }), 7));
      expect(err.code).to.equal('INVALID_FIELD');
      expect(err.field).to.equal('unit_cost');
      expect(err.message).to.match(/2 decimal/);
      expect(addCalls).to.have.lengthOf(0);
      expect(db._store.timesheet_entries[0].is_processed).to.equal(false);
   });

   it("a held Doctor Appointment for an external customer is applied non-billable ($0 billable) even though the reviewer left is_transaction_billable unset/true (C4)", async () => {
      const db = makeDb({ category: 'Doctor Appointment', notes: 'annual physical', duration: 60 });
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits(), 7);
      expect(addCalls[0]).to.include({ isTransactionBillable: false, quantity: 1, totalTransaction: 150 }); // hours/value still recorded

      const db2 = makeDb({ category: 'Doctor Appointment', notes: 'annual physical', duration: 60 });
      await billingReviewService.applyHeldEntry(db2, ACCOUNT, 11, edits({ is_transaction_billable: true }), 7);
      expect(addCalls[1]).to.include({ isTransactionBillable: false });
   });

   it('a held Vacation row is applied non-billable from the STORED category, even if the reviewer edited detailed_work_description to look like client work (C4)', async () => {
      const db = makeDb({ category: 'Vacation', notes: 'Vacation day - approved PTO', duration: 480 });
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ is_transaction_billable: true, detailed_work_description: 'Prepared corporate tax return' }), 7);
      expect(addCalls[0]).to.include({ isTransactionBillable: false });
   });

   it("refuses another tenant's general_work_description_id (400/INVALID_FIELD), nothing written (C8)", async () => {
      const db = makeDb();
      const err = await caught(billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ general_work_description_id: 1 }), 7));
      expect(err.code).to.equal('INVALID_FIELD');
      expect(err.field).to.equal('general_work_description_id');
      expect(addCalls).to.have.lengthOf(0);
      expect(db._store.timesheet_entries[0].is_processed).to.equal(false);
   });

   it("writes an internal customer's work as non-billable even when the reviewer left it billable", async () => {
      internalIds.add(100);
      const db = makeDb();
      await billingReviewService.applyHeldEntry(db, ACCOUNT, 11, edits({ is_transaction_billable: true, duration_minutes: 90 }), 7);
      expect(addCalls[0]).to.include({ isTransactionBillable: false, quantity: 1.5, totalTransaction: 225 }); // hours still recorded
   });

   it("keeps the reviewer's billable flag for a client (non-internal) customer", async () => {
      internalIds.add(101);
      await billingReviewService.applyHeldEntry(makeDb(), ACCOUNT, 11, edits(), 7);
      await billingReviewService.applyHeldEntry(makeDb(), ACCOUNT, 11, edits({ is_transaction_billable: 'false' }), 7);
      expect(addCalls.map(c => c.isTransactionBillable)).to.deep.equal([true, false]);
   });
});

describe('billingReview-service reprocessHeldEntryWithOverrides', () => {
   let realProcessEntries;
   let processCalls;

   beforeEach(() => {
      realProcessEntries = orchestrator.processEntries;
      processCalls = [];
      orchestrator.processEntries = async args => {
         processCalls.push(args);
         return { autoInserted: 0, held: 1, perEntry: [{ entryId: args.entryIds[0], decision: 'hold', reason: 'low_ai_confidence' }] };
      };
   });
   afterEach(() => {
      orchestrator.processEntries = realProcessEntries;
   });

   const makeDb = ({ entry = {}, examples = [], transactions = [] } = {}) =>
      buildStubDb({
         timesheet_entries: [{ timesheet_entry_id: 21, account_id: ACCOUNT, is_processed: true, is_deleted: false, hold_reason: null, ai_attempted_at: new Date(), ...entry }],
         ai_category_training_examples: examples,
         customer_transactions: transactions
      });

   it('refuses to reset an entry that already produced a live transaction', async () => {
      const db = makeDb({
         examples: [{ training_id: 1, account_id: ACCOUNT, timesheet_entry_id: 21, transaction_id: 900 }],
         transactions: [{ transaction_id: 900, account_id: ACCOUNT }]
      });
      const err = await caught(billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7));
      expect(err.code).to.equal('ENTRY_ALREADY_APPLIED');
      expect(err.transactionId).to.equal(900);
      expect(err.message).to.match(/already applied as transaction #900/);
      expect(db._store.timesheet_entries[0].is_processed).to.equal(true);
      expect(processCalls).to.have.lengthOf(0);
   });

   it('re-runs AI when the earlier transaction no longer exists', async () => {
      const db = makeDb({
         // FK is ON DELETE SET NULL: a deleted transaction leaves transaction_id NULL
         examples: [
            { training_id: 1, account_id: ACCOUNT, timesheet_entry_id: 21, transaction_id: null },
            { training_id: 2, account_id: ACCOUNT, timesheet_entry_id: 21, transaction_id: 901 }
         ],
         transactions: []
      });
      const result = await billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, { customer_id: 100 }, 7);
      expect(result).to.include({ decision: 'hold', reason: 'low_ai_confidence' });
      expect(processCalls).to.have.lengthOf(1);
      expect(processCalls[0].overridesByEntryId).to.deep.equal({ 21: { customer_id: 100 } });
      expect(db._store.timesheet_entries[0]).to.include({ is_processed: false, hold_reason: null, ai_attempted_at: null });
   });

   it('re-runs AI for a normal held entry', async () => {
      const db = makeDb({ entry: { is_processed: false, hold_reason: 'low_ai_confidence' } });
      await billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7);
      expect(processCalls).to.have.lengthOf(1);
   });

   it('ignores links owned by another account', async () => {
      const db = makeDb({
         examples: [{ training_id: 1, account_id: 1234, timesheet_entry_id: 21, transaction_id: 900 }],
         transactions: [{ transaction_id: 900, account_id: 1234 }]
      });
      await billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7);
      expect(processCalls).to.have.lengthOf(1);
   });

   it('404s a deleted or unknown entry', async () => {
      const db = makeDb({ entry: { is_deleted: true } });
      const err = await caught(billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7));
      expect(err.code).to.equal('NOT_FOUND');
      const missing = await caught(billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 999, {}, 7));
      expect(missing.code).to.equal('NOT_FOUND');
      expect(processCalls).to.have.lengthOf(0);
   });

   it('checks for a live transaction under the entry row lock, in the same transaction as the reset', async () => {
      // A reviewer's apply commits after this request started but before the reset.
      const db = makeDb({ entry: { is_processed: false, hold_reason: 'low_ai_confidence' } });
      const run = db.transaction;
      db.transaction = async cb => {
         Object.assign(db._store.timesheet_entries[0], { is_processed: true, hold_reason: null });
         db._store.ai_category_training_examples.push({ training_id: 3, account_id: ACCOUNT, timesheet_entry_id: 21, transaction_id: 905 });
         db._store.customer_transactions.push({ transaction_id: 905, account_id: ACCOUNT });
         return run(cb);
      };
      const err = await caught(billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7));
      expect(err.code).to.equal('ENTRY_ALREADY_APPLIED');
      expect(err.transactionId).to.equal(905);
      expect(db._store.timesheet_entries[0].is_processed).to.equal(true); // never reset
      expect(processCalls).to.have.lengthOf(0);
      expect(db._calls.queries.some(q => q.table === 'timesheet_entries' && q.forUpdate)).to.equal(true);
   });

   it("surfaces the orchestrator's 'skip' unchanged (processed concurrently) and points at the transaction it produced", async () => {
      const db = makeDb({ entry: { is_processed: false, hold_reason: 'low_ai_confidence' } });
      orchestrator.processEntries = async args => {
         processCalls.push(args);
         // A concurrent apply claimed the entry first; the orchestrator's own claim found nothing.
         Object.assign(db._store.timesheet_entries[0], { is_processed: true, hold_reason: null });
         db._store.ai_category_training_examples.push({ training_id: 4, account_id: ACCOUNT, timesheet_entry_id: 21, transaction_id: 906 });
         db._store.customer_transactions.push({ transaction_id: 906, account_id: ACCOUNT });
         return { autoInserted: 0, held: 0, skipped: 1, perEntry: [{ entryId: 21, decision: 'skip', reason: 'already_processed', costUsd: 0 }] };
      };
      const result = await billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7);
      expect(result).to.include({ decision: 'skip', reason: 'already_processed', transactionId: 906, autoInserted: 0, held: 0 });
      expect(db._store.timesheet_entries[0].is_processed).to.equal(true); // not reset afterwards
   });

   it('reports an entry processed before the AI pass loaded it as skip, not unknown', async () => {
      const db = makeDb({ entry: { is_processed: false, hold_reason: 'low_ai_confidence' } });
      orchestrator.processEntries = async args => {
         processCalls.push(args);
         db._store.timesheet_entries[0].is_processed = true; // claimed by another run first
         return { processed: 0, autoInserted: 0, held: 0, skipped: 0, perEntry: [] };
      };
      const result = await billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7);
      expect(result).to.include({ decision: 'skip', reason: 'already_processed' });
   });

   it('passes the new hold reasons through unchanged', async () => {
      for (const reason of ['ambiguous_customer_match', 'missing_current_year_job']) {
         const db = makeDb({ entry: { is_processed: false, hold_reason: 'no_matching_customer' } });
         orchestrator.processEntries = async args => {
            processCalls.push(args);
            return { autoInserted: 0, held: 1, perEntry: [{ entryId: 21, decision: 'hold', reason }] };
         };
         const result = await billingReviewService.reprocessHeldEntryWithOverrides(db, ACCOUNT, 21, {}, 7);
         expect(result, reason).to.include({ decision: 'hold', reason, held: 1 });
         expect(result).to.not.have.property('transactionId');
      }
   });
});

describe('billingReview-service listPendingHeldEntries', () => {
   // Real knex SQL compiler with no connection: every query records its SQL and
   // resolves canned rows (the stub DB has no queryBuilder()).
   const sqlDb = rows => {
      const compiler = require('knex')({ client: 'pg' });
      const sql = [];
      return {
         sql,
         queryBuilder: () => {
            const qb = compiler.queryBuilder();
            qb.then = (resolve, reject) => {
               const compiled = qb.toSQL().sql;
               sql.push(compiled);
               return Promise.resolve(/^select count\(/i.test(compiled) ? [{ count: rows.length }] : rows).then(resolve, reject);
            };
            return qb;
         }
      };
   };

   it('returns timesheet_entries.ai_payload (the hold detail the Review dialog reads) untouched', async () => {
      const payload = {
         suggestion: null,
         customer: { tier: 'needs_review', candidates: [{ id: 5, score: 0.71 }, { id: 9, score: 0.7 }] },
         hold: { requested_tax_year: 2025 }
      };
      const db = sqlDb([{ timesheet_entry_id: 31, hold_reason: 'ambiguous_customer_match', ai_payload: payload, ai_payload_suggestion: { stale: true } }]);
      const result = await billingReviewService.listPendingHeldEntries(db, ACCOUNT, { holdReason: 'ambiguous_customer_match' });

      const [entriesSql] = db.sql;
      // The entry's own ai_payload column is selected...
      expect(/"te"\.\*|"te"\."ai_payload"/.test(entriesSql), entriesSql).to.equal(true);
      // ...and the suggestion's payload is aliased, so it can never overwrite it.
      expect(entriesSql).to.include('"s"."ai_payload" as "ai_payload_suggestion"');
      expect(/"s"\."ai_payload"(?! as)/.test(entriesSql)).to.equal(false);

      expect(result.total).to.equal(1);
      expect(result.entries[0].ai_payload).to.deep.equal(payload);
   });
});

describe('billingReview-service earliestUnbilledMonth', () => {
   const today = new Date(2026, 8, 22); // 2026-09-22 local

   const run = rows => billingReviewService.earliestUnbilledMonth(buildStubDb({ customer_transactions: rows }), ACCOUNT, { today });

   it('starts at the month of the OLDEST unbilled transaction, even before the latest invoice', async () => {
      const start = await run([
         { transaction_id: 1, account_id: ACCOUNT, customer_invoice_id: null, transaction_date: '2026-09-02' },
         { transaction_id: 2, account_id: ACCOUNT, customer_invoice_id: null, transaction_date: '2025-11-17' },
         { transaction_id: 3, account_id: ACCOUNT, customer_invoice_id: 55, transaction_date: '2024-01-05' }
      ]);
      expect(start).to.equal('2025-11-01');
   });

   it('handles pg Date values (local midnight)', async () => {
      const start = await run([{ transaction_id: 1, account_id: ACCOUNT, customer_invoice_id: null, transaction_date: new Date(2026, 1, 1) }]);
      expect(start).to.equal('2026-02-01');
   });

   it('ignores future-dated typos and other accounts', async () => {
      const start = await run([
         { transaction_id: 1, account_id: ACCOUNT, customer_invoice_id: null, transaction_date: '2058-01-01' },
         { transaction_id: 2, account_id: 1234, customer_invoice_id: null, transaction_date: '2020-01-01' }
      ]);
      expect(start).to.equal('2026-09-01');
   });

   it('falls back to the current month when everything is billed', async () => {
      const start = await run([{ transaction_id: 1, account_id: ACCOUNT, customer_invoice_id: 9, transaction_date: '2026-01-01' }]);
      expect(start).to.equal('2026-09-01');
   });
});
