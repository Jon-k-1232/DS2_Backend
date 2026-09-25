const { buildFakeDb } = require('./_fakeDb');
const shared = require('../../../src/endpoints/transactions/sharedTransactionFunctions');
const transactionsService = require('../../../src/endpoints/transactions/transactions-service');
const aiCategoryTrainingService = require('../../../src/endpoints/aiIntegration/ai-category-training-service');

const baseJob = () => ({
   customer_job_id: 501,
   account_id: 1,
   customer_id: 100,
   parent_job_id: null,
   current_job_total: 0,
   is_job_complete: false,
   is_quote: false,
   job_status: null,
   job_type_id: 1,
   job_quote_amount: 0,
   agreed_job_amount: 0,
   created_by_user_id: 21,
   notes: null
});

const otherCustomerJob = () => ({ customer_job_id: 601, account_id: 1, customer_id: 200, parent_job_id: null, current_job_total: 0 });

// The ledger lock (SELECT … FOR UPDATE on the customer row) needs the customers.
const baseCustomers = () => [
   { customer_id: 100, account_id: 1 },
   { customer_id: 200, account_id: 1 }
];

const baseTransactionPayload = overrides => ({
   accountID: 1,
   customerID: 100,
   customerJobID: 501,
   loggedForUserID: 21,
   selectedGeneralWorkDescriptionID: 7,
   detailedJobDescription: 'work',
   transactionDate: '2026-04-01',
   transactionType: 'charge',
   quantity: 1,
   unitCost: 100,
   totalTransaction: 100,
   isTransactionBillable: true,
   isInAdditionToMonthlyCharge: false,
   loggedByUserID: 21,
   note: '',
   ...overrides
});

const rejection = async promise => {
   try {
      await promise;
   } catch (e) {
      return e;
   }
   return null;
};

// A deep copy of every table, for "nothing was written" assertions.
const snapshotStore = db => structuredClone(db._store);

describe('sharedTransactionFunctions.assertJobBelongsToCustomer', () => {
   it('returns the job when it belongs to the given customer', async () => {
      const db = buildFakeDb({ customer_jobs: [baseJob()] });
      const job = await shared.assertJobBelongsToCustomer(db, 501, 100, 1);
      expect(job.customer_job_id).to.equal(501);
   });

   it('throws a clear error when the job belongs to a different customer', async () => {
      const db = buildFakeDb({ customer_jobs: [baseJob(), otherCustomerJob()] });
      let caught = null;
      try {
         await shared.assertJobBelongsToCustomer(db, 601, 100, 1);
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
      expect(caught.message).to.match(/does not belong to this customer/);
   });

   it('throws a clear error when the job does not exist', async () => {
      const db = buildFakeDb({ customer_jobs: [] });
      let caught = null;
      try {
         await shared.assertJobBelongsToCustomer(db, 999999, 100, 1);
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
      expect(caught.message).to.match(/was not found/);
   });
});

describe('sharedTransactionFunctions.differenceBetweenOldAndNewTransaction', () => {
   const origTxn = () => ({
      transaction_id: 1,
      account_id: 1,
      customer_id: 100,
      customer_job_id: 501,
      total_transaction: 100,
      retainer_id: null,
      customer_invoice_id: null,
      transaction_date: '2026-04-01'
   });

   it('throws a clean "not found" Error (not a TypeError) when the transaction does not exist', async () => {
      const db = buildFakeDb({ customer_transactions: [origTxn()] });
      let caught = null;
      try {
         await shared.differenceBetweenOldAndNewTransaction(db, { account_id: 1, customer_id: 100, transaction_id: 999999, total_transaction: 50, customer_job_id: 501 });
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an.instanceOf(Error);
      expect(caught).to.not.be.an.instanceOf(TypeError);
      expect(caught.message).to.match(/Transaction was not found/);
   });

   it('flags an amount change on the same job', async () => {
      const db = buildFakeDb({ customer_transactions: [origTxn()] });
      const diff = await shared.differenceBetweenOldAndNewTransaction(db, { account_id: 1, customer_id: 100, transaction_id: 1, total_transaction: 150, customer_job_id: 501 });
      expect(diff.areAmountsDifferent).to.equal(true);
      expect(diff.isJobDifferent).to.equal(false);
      expect(diff.transactionTotalDifference).to.equal(50);
      expect(diff.originalTransactionTotal).to.equal(100);
      expect(diff.updatedTransactionTotal).to.equal(150);
   });

   it('flags a job change even when the amount is identical (previously silently ignored)', async () => {
      const db = buildFakeDb({ customer_transactions: [origTxn()] });
      const diff = await shared.differenceBetweenOldAndNewTransaction(db, { account_id: 1, customer_id: 100, transaction_id: 1, total_transaction: 100, customer_job_id: 999 });
      expect(diff.areAmountsDifferent).to.equal(false);
      expect(diff.isJobDifferent).to.equal(true);
   });

   it('never reports isJobDifferent for a delete', async () => {
      const db = buildFakeDb({ customer_transactions: [origTxn()] });
      const diff = await shared.differenceBetweenOldAndNewTransaction(db, { account_id: 1, customer_id: 100, transaction_id: 1, total_transaction: 100, customer_job_id: 501 }, 'delete');
      expect(diff.isJobDifferent).to.equal(false);
      expect(diff.transactionTotalDifference).to.equal(-100);
   });
});

describe('sharedTransactionFunctions.updateRecentJobTotal', () => {
   it('throws a clean "not found" Error (not a TypeError) when the job does not exist', async () => {
      const db = buildFakeDb({ customer_jobs: [] });
      let caught = null;
      try {
         await shared.updateRecentJobTotal(db, 999999, 1, 50);
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an.instanceOf(Error);
      expect(caught).to.not.be.an.instanceOf(TypeError);
      expect(caught.message).to.match(/Job was not found/);
   });

   it('sums existing job transactions plus the delta into a new version row', async () => {
      const db = buildFakeDb({
         customer_jobs: [baseJob()],
         customer_transactions: [
            { transaction_id: 1, account_id: 1, customer_job_id: 501, total_transaction: 40 },
            { transaction_id: 2, account_id: 1, customer_job_id: 501, total_transaction: 60 }
         ]
      });
      const updated = await shared.updateRecentJobTotal(db, 501, 1, 25);
      expect(updated.current_job_total).to.equal(125); // 40 + 60 + 25
      expect(updated.parent_job_id).to.equal(501); // root's own id becomes the family's parent_job_id
   });

   // A4-4 (2026-09 review round 4): the total must sum the WHOLE version
   // family, not just the one customerJobID passed in. A prior total change
   // appends a NEW customer_jobs row (parent_job_id = root); transactions
   // logged against an earlier version never move to the newest one.
   it('A4-4: sums the whole version family, not just the version id passed in — $50 on the root + $50 on a new version totals $100 on the newest version', async () => {
      const version2 = {
         customer_job_id: 502,
         account_id: 1,
         customer_id: 100,
         parent_job_id: 501,
         current_job_total: 50,
         is_job_complete: false,
         is_quote: false,
         job_status: null,
         job_type_id: 1,
         job_quote_amount: 0,
         agreed_job_amount: 0,
         created_by_user_id: 21,
         notes: null
      };
      const db = buildFakeDb({
         customer_jobs: [baseJob(), version2],
         // $50 already recorded against the ROOT (version 501). No
         // transaction has moved onto the newest version (502) yet.
         customer_transactions: [{ transaction_id: 1, account_id: 1, customer_job_id: 501, total_transaction: 50 }]
      });

      // A NEW $50 entry lands on the newest version (502): updateRecentJobTotal
      // is called with 502 and must still find the root's $50 — the whole
      // FAMILY, not just transactions already stamped with customer_job_id=502
      // (which is what the old getAllSpecificCustomerJobTransactions(…, 502)
      // call would have matched — none — undercounting the total by $50).
      const updated = await shared.updateRecentJobTotal(db, 502, 1, 50);
      expect(updated.current_job_total, 'family total: $50 already on the root plus the $50 new entry, not just the $50 new entry').to.equal(100);
      expect(updated.parent_job_id, 'new version rows always reference the true ROOT').to.equal(501);
   });
});

describe('sharedTransactionFunctions retainer-payment linkage', () => {
   const retainerRoot = () => ({ retainer_id: 10, account_id: 1, customer_id: 100, parent_retainer_id: null, current_amount: -500, is_retainer_active: true });
   const retainerSnapshot = () => ({ retainer_id: 11, account_id: 1, customer_id: 100, parent_retainer_id: 10, current_amount: -400, is_retainer_active: true });
   // The transaction stores the snapshot's id (11) post draw-down; the
   // auto-created payment kept the id the user originally selected (10) -
   // both belong to the same chain (root 10).
   const txn = () => ({ account_id: 1, customer_id: 100, retainer_id: 11, transaction_date: '2026-04-01', total_transaction: 100 });
   const linkedPayment = overrides => ({
      payment_id: 900,
      account_id: 1,
      customer_id: 100,
      retainer_id: 10,
      form_of_payment: 'Retainer',
      payment_amount: -100,
      payment_date: '2026-04-01',
      customer_invoice_id: null,
      ...overrides
   });

   it('matches the payment across differing retainer_id values in the same chain', async () => {
      const db = buildFakeDb({ customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()], customer_payments: [linkedPayment()] });
      const matches = await shared.findLinkedRetainerPayments(db, txn());
      expect(matches).to.have.lengthOf(1);
      expect(matches[0].payment_id).to.equal(900);
   });

   it('excludes payments that differ on customer, amount, date, or form_of_payment', async () => {
      const db = buildFakeDb({
         customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()],
         customer_payments: [
            linkedPayment({ payment_id: 901, customer_id: 999 }),
            linkedPayment({ payment_id: 902, payment_amount: -999 }),
            linkedPayment({ payment_id: 903, payment_date: '2020-01-01' }),
            linkedPayment({ payment_id: 904, form_of_payment: 'Check' })
         ]
      });
      const matches = await shared.findLinkedRetainerPayments(db, txn());
      expect(matches).to.have.lengthOf(0);
   });

   it('returns a warning (no throw) when no candidate payment is found', async () => {
      const db = buildFakeDb({ customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()], customer_payments: [] });
      const result = await shared.resolveLinkedRetainerPayment(db, txn(), {});
      expect(result.payment).to.equal(null);
      expect(result.warning).to.match(/no matching retainer payment/);
   });

   it('resolves cleanly to the single unbilled match', async () => {
      const db = buildFakeDb({ customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()], customer_payments: [linkedPayment()] });
      const result = await shared.resolveLinkedRetainerPayment(db, txn(), {});
      expect(result.payment.payment_id).to.equal(900);
      expect(result.warning).to.equal(null);
   });

   it('refuses with the given message when the single match is already billed', async () => {
      const db = buildFakeDb({
         customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()],
         customer_payments: [linkedPayment({ customer_invoice_id: 5000 })]
      });
      let caught = null;
      try {
         await shared.resolveLinkedRetainerPayment(db, txn(), { refuseIfBilledMessage: 'already billed, contact support' });
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
      expect(caught.message).to.equal('already billed, contact support');
   });

   it('refuses when more than one candidate payment matches, regardless of billed status', async () => {
      const db = buildFakeDb({
         customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()],
         customer_payments: [linkedPayment(), linkedPayment({ payment_id: 905 })]
      });
      let caught = null;
      try {
         await shared.resolveLinkedRetainerPayment(db, txn(), {});
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
      expect(caught.message).to.match(/Multiple candidate retainer payments/);
   });

   it('is a no-op for a transaction with no retainer_id', async () => {
      const db = buildFakeDb({ customer_payments: [] });
      const result = await shared.resolveLinkedRetainerPayment(db, { ...txn(), retainer_id: null }, {});
      expect(result.payment).to.equal(null);
      expect(result.warning).to.equal(null);
   });

   it('prefers the exact [retainer_draw:<id>] marker over amount/date matching', async () => {
      const db = buildFakeDb({
         customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()],
         customer_payments: [
            // Legacy look-alike (same chain / amount / date) and the exactly linked one.
            linkedPayment({ payment_id: 906 }),
            linkedPayment({ payment_id: 907, payment_date: '2026-05-09', note: shared.retainerDrawMarker(11) })
         ]
      });
      const result = await shared.resolveAutoRetainerPayment(db, txn());
      expect(result.exact).to.equal(true);
      expect(result.payment.payment_id).to.equal(907);
   });

   it('never treats a payment carrying ANOTHER draw marker as a legacy match', async () => {
      const db = buildFakeDb({
         customer_retainers_and_prepayments: [retainerRoot(), retainerSnapshot()],
         customer_payments: [linkedPayment({ note: shared.retainerDrawMarker(12) })]
      });
      const result = await shared.resolveAutoRetainerPayment(db, txn());
      expect(result.payment).to.equal(null);
      expect(result.warning).to.match(/no matching retainer payment/);
   });

   it('parses and builds the draw marker symmetrically', () => {
      expect(shared.retainerDrawMarker(42)).to.equal('[retainer_draw:42]');
      expect(shared.parseRetainerDrawId('hand note [retainer_draw:42]')).to.equal(42);
      expect(shared.parseRetainerDrawId('no marker')).to.equal(null);
      expect(shared.parseRetainerDrawId(null)).to.equal(null);
   });
});

describe('sharedTransactionFunctions.decideFundingAction', () => {
   const decide = args => shared.decideFundingAction({ isFunded: false, isBillable: true, requestedRetainerId: 10, amount: 100, ...args });

   it('funds an unfunded billable entry that selects a retainer', () => {
      expect(decide({})).to.equal('fund');
   });

   it('never funds a non-billable, $0 or retainer-less entry', () => {
      expect(decide({ isBillable: false })).to.equal('none');
      expect(decide({ amount: 0 })).to.equal('none');
      expect(decide({ requestedRetainerId: null })).to.equal('none');
   });

   it('unfunds a funded entry that becomes non-billable or $0, whatever retainer the form still shows', () => {
      expect(decide({ isFunded: true, isBillable: false })).to.equal('unfund');
      expect(decide({ isFunded: true, amount: 0 })).to.equal('unfund');
      expect(decide({ isFunded: true, isBillable: false, requestedRetainerId: null })).to.equal('unfund');
   });

   it('keeps a funded billable entry funded while a retainer is selected', () => {
      expect(decide({ isFunded: true })).to.equal('retain');
   });

   it('refuses silently dropping the retainer from a funded billable entry', () => {
      expect(() => decide({ isFunded: true, requestedRetainerId: null })).to.throw(/Removing the retainer/);
   });
});

describe('sharedTransactionFunctions.addNewTransaction', () => {
   const rootRetainer = overrides => ({
      retainer_id: 10,
      account_id: 1,
      customer_id: 100,
      parent_retainer_id: null,
      display_name: 'Retainer',
      type_of_hold: 'Retainer',
      starting_amount: -500,
      current_amount: -500,
      is_retainer_active: true,
      created_by_user_id: 21,
      ...overrides
   });
   const fixture = (extra = {}) =>
      buildFakeDb({
         users: [{ user_id: 21, account_id: 1 }],
         customer_general_work_descriptions: [{ general_work_description_id: 7, account_id: 1 }],
         customers: baseCustomers(),
         customer_jobs: [baseJob(), otherCustomerJob()],
         customer_transactions: [],
         customer_retainers_and_prepayments: [rootRetainer()],
         customer_payments: [],
         ...extra
      });

   it('refuses (before any writes) when the selected job belongs to a different customer', async () => {
      const db = fixture();
      const before = snapshotStore(db);
      let caught = null;
      try {
         await shared.addNewTransaction(db, baseTransactionPayload({ customerID: 200 })); // job 501 belongs to customer 100
      } catch (e) {
         caught = e;
      }
      expect(caught).to.be.an('error');
      expect(caught.message).to.match(/does not belong to this customer/);
      expect(db._store).to.deep.equal(before);
   });

   it('refuses a customer of another account (tenancy) before any writes', async () => {
      const db = fixture({ customers: [{ customer_id: 100, account_id: 2 }] });
      const before = snapshotStore(db);
      const err = await rejection(shared.addNewTransaction(db, baseTransactionPayload()));
      expect(err && err.message).to.match(/Customer not found for this account/);
      expect(db._store).to.deep.equal(before);
   });

   it('does not draw down a retainer or create a Retainer payment for a NON-billable transaction', async () => {
      const db = fixture();

      const created = await shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10, isTransactionBillable: false }));

      expect(created.retainer_id).to.equal(null);
      expect(db._store.customer_payments).to.have.lengthOf(0);
      expect(db._store.customer_retainers_and_prepayments).to.have.lengthOf(1); // untouched
   });

   it('does not fund a $0 entry', async () => {
      const db = fixture();
      const created = await shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10, unitCost: 0, totalTransaction: 0 }));
      expect(created.retainer_id).to.equal(null);
      expect(db._store.customer_payments).to.have.lengthOf(0);
      expect(db._store.customer_retainers_and_prepayments).to.have.lengthOf(1);
   });

   it('draws down the retainer and links transaction → draw ← payment exactly', async () => {
      const db = fixture();

      const created = await shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10, isTransactionBillable: true }));

      const retainers = db._store.customer_retainers_and_prepayments;
      expect(retainers).to.have.lengthOf(2); // original + new draw-down snapshot
      const draw = retainers[1];
      expect(draw.parent_retainer_id).to.equal(10);
      expect(draw.current_amount).to.equal(-400);
      expect(draw.is_retainer_active).to.equal(true);
      expect(created.retainer_id).to.equal(draw.retainer_id); // tied to the new draw-down ledger row

      expect(db._store.customer_payments).to.have.lengthOf(1);
      const [payment] = db._store.customer_payments;
      expect(payment.form_of_payment).to.equal('Retainer');
      expect(payment.payment_amount).to.equal(-100);
      expect(payment.payment_date).to.equal('2026-04-01');
      expect(payment.customer_id).to.equal(100);
      expect(payment.customer_invoice_id).to.equal(null);
      expect(payment.retainer_id).to.equal(10); // the chain root
      expect(payment.note).to.equal(`[retainer_draw:${draw.retainer_id}]`);
      expect(payment.created_at).to.deep.include({ __raw: 'clock_timestamp()' });
   });

   // A3 (2026-09 review): the auto payment used to stamp created_by_user_id
   // from transaction.logged_for_user_id (the employee the work is logged
   // FOR), not whoever actually recorded the entry — "admin logs time for
   // Eliza" attributed the payment event to Eliza. The draw snapshot's
   // creator likewise must be the actor, not copied forward from the
   // retainer chain's own creator.
   it('A3: the transaction, its retainer draw and its auto payment are all attributed to loggedByUserID (the actor), not loggedForUserID (the employee)', async () => {
      const db = fixture();
      const created = await shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10, loggedByUserID: 90013, loggedForUserID: 21 }));

      expect(created.created_by_user_id).to.equal(90013);
      expect(created.logged_for_user_id, 'logged_for_user_id itself still records whose work this is').to.equal(21);
      const draw = db._store.customer_retainers_and_prepayments[1];
      expect(draw.created_by_user_id).to.equal(90013);
      const [payment] = db._store.customer_payments;
      expect(payment.created_by_user_id).to.equal(90013);
   });

   it('draws from the chain LATEST balance when the picker hands an older snapshot id', async () => {
      const db = fixture({
         customer_retainers_and_prepayments: [rootRetainer(), rootRetainer({ retainer_id: 11, parent_retainer_id: 10, current_amount: -150 })]
      });
      await shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10 }));
      expect(db._store.customer_retainers_and_prepayments[2].current_amount).to.equal(-50);
   });

   it("refuses another customer's retainer before any write (cross-customer draw)", async () => {
      const db = fixture({
         customer_retainers_and_prepayments: [
            rootRetainer(),
            rootRetainer({ retainer_id: 20, customer_id: 200 }),
            rootRetainer({ retainer_id: 21, customer_id: 200, parent_retainer_id: 20, current_amount: -450 })
         ]
      });
      const before = snapshotStore(db);

      for (const selectedRetainerID of [20, 21]) {
         const err = await rejection(shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID })));
         expect(err && err.message).to.match(/belongs to a different customer/);
      }
      expect(db._store).to.deep.equal(before);
   });

   it("refuses a draw larger than the retainer's latest balance, with no writes", async () => {
      const db = fixture({ customer_retainers_and_prepayments: [rootRetainer(), rootRetainer({ retainer_id: 11, parent_retainer_id: 10, current_amount: -60 })] });
      const before = snapshotStore(db);
      const err = await rejection(shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10 })));
      expect(err && err.message).to.match(/not have enough balance.*Available: \$60\.00/);
      expect(db._store).to.deep.equal(before);
   });

   it('never trusts a client-sent invoice link on a new entry', async () => {
      const db = fixture();
      const created = await shared.addNewTransaction(db, baseTransactionPayload({ customerInvoicesID: 5000 }));
      expect(created.customer_invoice_id).to.equal(null);
   });

   it('rolls back the draw, payment and job total when the transaction insert fails', async () => {
      const db = fixture();
      const before = snapshotStore(db);
      const original = transactionsService.createTransaction;
      transactionsService.createTransaction = async () => {
         throw new Error('insert failed');
      };
      try {
         const err = await rejection(shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10 })));
         expect(err && err.message).to.equal('insert failed');
      } finally {
         transactionsService.createTransaction = original;
      }
      expect(db._store).to.deep.equal(before);
   });

   it("joins a caller's transaction: the caller's later failure rolls the entry back too", async () => {
      const db = fixture();
      const before = snapshotStore(db);
      const err = await rejection(
         db.transaction(async trx => {
            await shared.addNewTransaction(trx, baseTransactionPayload({ selectedRetainerID: 10 }));
            throw new Error('caller failed after the insert');
         })
      );
      expect(err && err.message).to.equal('caller failed after the insert');
      expect(db._store).to.deep.equal(before);
   });

   it('a failing AI training insert neither fails nor rolls back the entry', async () => {
      const db = fixture();
      const original = aiCategoryTrainingService.insert;
      aiCategoryTrainingService.insert = async () => {
         throw new Error('training table missing');
      };
      let created;
      try {
         created = await shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10 }));
      } finally {
         aiCategoryTrainingService.insert = original;
      }
      expect(created.transaction_id).to.be.a('number');
      expect(db._store.customer_transactions).to.have.lengthOf(1);
      expect(db._store.customer_payments).to.have.lengthOf(1);
   });
});

describe('sharedTransactionFunctions.updateTransactionCore / deleteTransactionCore', () => {
   const root = (id, customerId, amount) => ({
      retainer_id: id,
      account_id: 1,
      customer_id: customerId,
      parent_retainer_id: null,
      display_name: `Retainer ${id}`,
      type_of_hold: 'Retainer',
      starting_amount: -amount,
      current_amount: -amount,
      is_retainer_active: true,
      created_by_user_id: 21
   });
   const fixture = (retainers = [root(10, 100, 500)]) =>
      buildFakeDb({
         users: [{ user_id: 21, account_id: 1 }],
         customer_general_work_descriptions: [{ general_work_description_id: 7, account_id: 1 }],
         customers: baseCustomers(),
         customer_jobs: [baseJob(), { ...baseJob(), customer_job_id: 502 }, otherCustomerJob()],
         customer_transactions: [],
         customer_retainers_and_prepayments: retainers,
         customer_payments: []
      });
   const create = (db, overrides) => shared.addNewTransaction(db, baseTransactionPayload({ selectedRetainerID: 10, ...overrides }));
   // What EditTransaction / DeleteTimeOrCharge send back: the stored row as a form.
   const formFor = (row, overrides) => ({
      transactionID: row.transaction_id,
      customerID: row.customer_id,
      customerJobID: row.customer_job_id,
      selectedRetainerID: row.retainer_id,
      loggedForUserID: 21,
      selectedGeneralWorkDescriptionID: 7,
      detailedJobDescription: 'work',
      transactionDate: row.transaction_date,
      transactionType: 'Charge',
      quantity: 1,
      unitCost: row.total_transaction,
      totalTransaction: row.total_transaction,
      isTransactionBillable: row.is_transaction_billable,
      isInAdditionToMonthlyCharge: false,
      loggedByUserID: 21,
      note: '',
      ...overrides
   });
   const update = (db, row, overrides) => shared.updateTransactionCore(db, { accountId: 1, transaction: formFor(row, overrides) });
   const remove = (db, row) => shared.deleteTransactionCore(db, { accountId: 1, transaction: formFor(row) });
   const retainerRow = (db, id) => db._store.customer_retainers_and_prepayments.find(r => r.retainer_id === id);
   const txnRow = (db, id) => db._store.customer_transactions.find(t => t.transaction_id === id);
   const paymentFor = (db, drawId) => db._store.customer_payments.find(p => p.note === shared.retainerDrawMarker(drawId));

   it('billable → non-billable gives back exactly its own draw and deletes its own payment; later draws keep their size', async () => {
      const db = fixture();
      const first = await create(db, { totalTransaction: 100 });
      const second = await create(db, { totalTransaction: 50, unitCost: 50 });
      expect(retainerRow(db, second.retainer_id).current_amount).to.equal(-350);

      const result = await update(db, first, { isTransactionBillable: false });
      expect(result.action).to.equal('unfund');

      expect(retainerRow(db, first.retainer_id), 'its draw row is gone').to.equal(undefined);
      expect(retainerRow(db, second.retainer_id).current_amount, 'the later draw still draws $50 from $500').to.equal(-450);
      expect(retainerRow(db, 10).current_amount).to.equal(-500);
      expect(paymentFor(db, first.retainer_id)).to.equal(undefined);
      expect(paymentFor(db, second.retainer_id).payment_amount).to.equal(-50);

      const stored = txnRow(db, first.transaction_id);
      expect(stored.is_transaction_billable).to.equal(false);
      expect(stored.retainer_id).to.equal(null);
   });

   it('refuses making an entry non-billable once its payment is billed — nothing changes', async () => {
      const db = fixture();
      const funded = await create(db);
      paymentFor(db, funded.retainer_id).customer_invoice_id = 7000;
      const before = snapshotStore(db);

      const err = await rejection(update(db, funded, { isTransactionBillable: false }));
      expect(err && err.message).to.match(/already been billed/);
      expect(db._store).to.deep.equal(before);
   });

   it('non-billable → billable with a retainer creates the draw and its linked payment', async () => {
      const db = fixture();
      const entry = await create(db, { isTransactionBillable: false });
      expect(entry.retainer_id).to.equal(null);

      const result = await update(db, entry, { isTransactionBillable: true, selectedRetainerID: 10 });
      expect(result.action).to.equal('fund');

      const stored = txnRow(db, entry.transaction_id);
      const draw = retainerRow(db, stored.retainer_id);
      expect(draw.parent_retainer_id).to.equal(10);
      expect(draw.current_amount).to.equal(-400);
      const payment = paymentFor(db, draw.retainer_id);
      expect(payment.payment_amount).to.equal(-100);
      expect(payment.retainer_id).to.equal(10);
   });

   // A3 (2026-09 review): writeRetainerDraw copied the retainer chain's own
   // creator forward, and the auto payment stamped transaction.logged_for_user_id
   // (the entry's logged-for employee) — neither is who actually performed
   // THIS edit. Both must record the actorId the router passes (req.user.user_id).
   it('A3: a "fund" edit attributes the new draw and its auto payment to the actor performing the edit, and preserves the entry\'s original creator', async () => {
      const db = fixture();
      const entry = await create(db, { isTransactionBillable: false, loggedByUserID: 21 }); // created by user 21, unfunded
      expect(txnRow(db, entry.transaction_id).created_by_user_id).to.equal(21);

      const result = await shared.updateTransactionCore(db, {
         accountId: 1,
         actorId: 90013, // a DIFFERENT user is the one performing THIS edit
         transaction: formFor(entry, { isTransactionBillable: true, selectedRetainerID: 10 })
      });
      expect(result.action).to.equal('fund');

      const stored = txnRow(db, entry.transaction_id);
      expect(stored.created_by_user_id, "the entry's own original creator survives the edit").to.equal(21);
      const draw = retainerRow(db, stored.retainer_id);
      expect(draw.created_by_user_id, 'the NEW draw records the actor making THIS edit').to.equal(90013);
      const payment = paymentFor(db, draw.retainer_id);
      expect(payment.created_by_user_id, "the auto payment's creator is the acting editor, not the entry's original creator").to.equal(90013);
   });

   it('A3: without an explicit actorId, a "fund" edit falls back to the stored transaction\'s own creator (internal callers with no request identity)', async () => {
      const db = fixture();
      const entry = await create(db, { isTransactionBillable: false, loggedByUserID: 77 });
      const result = await shared.updateTransactionCore(db, { accountId: 1, transaction: formFor(entry, { isTransactionBillable: true, selectedRetainerID: 10 }) });
      expect(result.action).to.equal('fund');
      const draw = retainerRow(db, txnRow(db, entry.transaction_id).retainer_id);
      expect(draw.created_by_user_id).to.equal(77);
   });

   it('a date-only edit moves the linked payment date (no retainer movement)', async () => {
      const db = fixture();
      const funded = await create(db);
      const retainersBefore = structuredClone(db._store.customer_retainers_and_prepayments);

      await update(db, funded, { transactionDate: '2026-04-15' });

      expect(paymentFor(db, funded.retainer_id).payment_date).to.equal('2026-04-15');
      expect(paymentFor(db, funded.retainer_id).payment_amount).to.equal(-100);
      expect(db._store.customer_retainers_and_prepayments).to.deep.equal(retainersBefore);
   });

   it('an amount edit re-prices its draw in place (later draws keep their size) and the payment', async () => {
      const db = fixture();
      const first = await create(db, { totalTransaction: 100 });
      const second = await create(db, { totalTransaction: 50, unitCost: 50 });

      await update(db, first, { totalTransaction: 150, unitCost: 150 });

      expect(retainerRow(db, first.retainer_id).current_amount).to.equal(-350);
      expect(retainerRow(db, second.retainer_id).current_amount).to.equal(-300);
      expect(paymentFor(db, first.retainer_id).payment_amount).to.equal(-150);
      expect(paymentFor(db, second.retainer_id).payment_amount).to.equal(-50);
      expect(txnRow(db, first.transaction_id).retainer_id, 'the link does not move').to.equal(first.retainer_id);
   });

   it('refuses an increase the retainer cannot cover — nothing changes', async () => {
      const db = fixture([root(10, 100, 120)]);
      const funded = await create(db);
      const before = snapshotStore(db);
      const err = await rejection(update(db, funded, { totalTransaction: 150, unitCost: 150 }));
      expect(err && err.message).to.match(/greater than the current retainer balance.*at most \$20\.00/);
      expect(db._store).to.deep.equal(before);
   });

   it("a job move shifts the totals between jobs and the payment's job", async () => {
      const db = fixture();
      const funded = await create(db);
      await update(db, funded, { customerJobID: 502 });
      expect(paymentFor(db, funded.retainer_id).customer_job_id).to.equal(502);
      const versions = db._store.customer_jobs.filter(j => j.parent_job_id === 502);
      expect(versions.pop().current_job_total).to.equal(100);
   });

   it("refuses switching a funded entry to a different retainer chain, or dropping its retainer", async () => {
      const db = fixture([root(10, 100, 500), root(30, 100, 500)]);
      const funded = await create(db);
      const before = snapshotStore(db);
      expect((await rejection(update(db, funded, { selectedRetainerID: 30 }))).message).to.match(/Retainer\/ Prepayment change not allowed/);
      expect((await rejection(update(db, funded, { selectedRetainerID: null }))).message).to.match(/Removing the retainer/);
      expect(db._store).to.deep.equal(before);
      // Re-selecting the same retainer through a different row of its chain is not a change.
      await update(db, funded, { selectedRetainerID: 10, detailedJobDescription: 'reworded' });
   });

   it("refuses funding an update from another customer's retainer", async () => {
      const db = fixture([root(10, 100, 500), root(20, 200, 500)]);
      const entry = await create(db, { isTransactionBillable: false });
      const before = snapshotStore(db);
      const err = await rejection(update(db, entry, { isTransactionBillable: true, selectedRetainerID: 20 }));
      expect(err && err.message).to.match(/belongs to a different customer/);
      expect(db._store).to.deep.equal(before);
   });

   it("refuses updating or deleting an entry whose stored draw sits on another customer's retainer", async () => {
      // The pre-fix create path wrote exactly this: customer 100's entry drawing on customer 200's chain.
      const db = fixture([root(10, 100, 500), root(20, 200, 500), { ...root(21, 200, 500), parent_retainer_id: 20, current_amount: -400 }]);
      db._store.customer_transactions.push({
         transaction_id: 77,
         account_id: 1,
         customer_id: 100,
         customer_job_id: 501,
         retainer_id: 21,
         customer_invoice_id: null,
         transaction_date: '2026-04-01',
         total_transaction: 100,
         is_transaction_billable: true
      });
      db._store.customer_payments.push({ payment_id: 1, account_id: 1, customer_id: 100, retainer_id: 20, payment_amount: -100, payment_date: '2026-04-01', form_of_payment: 'Retainer', customer_invoice_id: null, note: null });
      const stored = txnRow(db, 77);
      const before = snapshotStore(db);

      expect((await rejection(update(db, stored, { totalTransaction: 90, unitCost: 90 }))).message).to.match(/belongs to a different customer/);
      expect((await rejection(update(db, stored, { isTransactionBillable: false }))).message).to.match(/belongs to a different customer/);
      expect((await rejection(remove(db, stored))).message).to.match(/belongs to a different customer/);
      expect(db._store).to.deep.equal(before);
   });

   it("refuses (via the payments module's resolver) when the marker names a row that is not a draw", async () => {
      // An entry pointing at the retainer ROOT, with a payment marker naming it:
      // resolveRetainerDrawForPayment refuses rather than move the retainer itself.
      const db = fixture();
      db._store.customer_transactions.push({
         transaction_id: 66,
         account_id: 1,
         customer_id: 100,
         customer_job_id: 501,
         retainer_id: 10,
         customer_invoice_id: null,
         transaction_date: '2026-04-01',
         total_transaction: 100,
         is_transaction_billable: true
      });
      db._store.customer_payments.push({ payment_id: 1, account_id: 1, customer_id: 100, retainer_id: 10, payment_amount: -100, payment_date: '2026-04-01', form_of_payment: 'Retainer', customer_invoice_id: null, note: '[retainer_draw:10]' });
      const before = snapshotStore(db);

      const err = await rejection(update(db, txnRow(db, 66), { totalTransaction: 90, unitCost: 90 }));
      expect(err && err.code).to.equal('RETAINER_DRAW_MISMATCH');
      expect((await rejection(remove(db, txnRow(db, 66)))).code).to.equal('RETAINER_DRAW_MISMATCH');
      expect(db._store).to.deep.equal(before);
   });

   it('keeps the stored-row guards: not found, billed, and customer moves', async () => {
      const db = fixture();
      const entry = await create(db);
      expect((await rejection(update(db, { ...entry, transaction_id: 999 }))).message).to.match(/Transaction was not found/);
      expect((await rejection(remove(db, { ...entry, transaction_id: 999 }))).message).to.match(/Transaction was not found/);
      expect((await rejection(update(db, entry, { customerID: 200 }))).message).to.match(/different customer is not supported/);
      expect((await rejection(update(db, entry, { customerJobID: 601 }))).message).to.match(/does not belong to this customer/);
      expect((await rejection(update(db, entry, { transactionType: 'bogus' }))).message).to.match(/Invalid transaction_type/);

      txnRow(db, entry.transaction_id).customer_invoice_id = 7000;
      expect((await rejection(update(db, entry))).message).to.match(/attached to an invoice and cannot be updated/);
      expect((await rejection(remove(db, entry))).message).to.match(/attached to an invoice and cannot be deleted/);
   });

   it('delete removes exactly its own draw and payment when two entries share retainer, date and amount', async () => {
      const db = fixture();
      const first = await create(db);
      const second = await create(db);
      // Amount/date matching alone cannot tell these two apart.
      expect(db._store.customer_payments.map(p => [p.payment_amount, p.payment_date])).to.deep.equal([
         [-100, '2026-04-01'],
         [-100, '2026-04-01']
      ]);

      await remove(db, first);

      expect(txnRow(db, first.transaction_id)).to.equal(undefined);
      expect(retainerRow(db, first.retainer_id)).to.equal(undefined);
      expect(paymentFor(db, first.retainer_id)).to.equal(undefined);
      expect(retainerRow(db, second.retainer_id).current_amount).to.equal(-400);
      expect(paymentFor(db, second.retainer_id).payment_amount).to.equal(-100);
      expect(db._store.customer_payments).to.have.lengthOf(1);

      await remove(db, second);
      expect(db._store.customer_retainers_and_prepayments.map(r => r.retainer_id)).to.deep.equal([10]);
      expect(db._store.customer_payments).to.have.lengthOf(0);
   });

   it('delete of a legacy entry (no marker) deletes its single matching payment and compensates the retainer', async () => {
      const db = fixture([root(10, 100, 500), { ...root(11, 100, 500), parent_retainer_id: 10, current_amount: -400 }]);
      db._store.customer_transactions.push({
         transaction_id: 88,
         account_id: 1,
         customer_id: 100,
         customer_job_id: 501,
         retainer_id: 11,
         customer_invoice_id: null,
         transaction_date: '2026-04-01',
         total_transaction: 100,
         is_transaction_billable: true
      });
      db._store.customer_payments.push({ payment_id: 1, account_id: 1, customer_id: 100, retainer_id: 10, payment_amount: -100, payment_date: '2026-04-01', form_of_payment: 'Retainer', customer_invoice_id: null, note: null });

      await remove(db, txnRow(db, 88));

      expect(db._store.customer_payments).to.have.lengthOf(0);
      const chain = db._store.customer_retainers_and_prepayments;
      expect(chain.map(r => r.current_amount)).to.deep.equal([-500, -400, -500]);
      expect(chain[2].parent_retainer_id).to.equal(10);
   });

   it('refuses deleting an entry whose payment is billed — nothing changes', async () => {
      const db = fixture();
      const funded = await create(db);
      paymentFor(db, funded.retainer_id).customer_invoice_id = 7000;
      const before = snapshotStore(db);
      const err = await rejection(remove(db, funded));
      expect(err && err.message).to.match(/already been billed and cannot be removed/);
      expect(db._store).to.deep.equal(before);
   });

   it('rolls every write back when the final write fails', async () => {
      const db = fixture();
      const funded = await create(db);
      const before = snapshotStore(db);
      const original = transactionsService.deleteTransaction;
      transactionsService.deleteTransaction = async () => {
         throw new Error('delete failed');
      };
      try {
         expect((await rejection(remove(db, funded))).message).to.equal('delete failed');
      } finally {
         transactionsService.deleteTransaction = original;
      }
      expect(db._store).to.deep.equal(before);
   });
});
