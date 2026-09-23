/**
 * HTTP-level route coverage for src/endpoints/transactions/**, retainer/** and
 * writeOffs/** (2026-09 full-audit review, branch review/full-audit-2026-09).
 *
 * Runs the real Express app via test/integration/_http.js (bootHttp) against
 * the sandbox DB selected by DS2_ENV_FILE. Every scenario creates its own
 * customer(s)/job(s)/retainer(s)/invoice(s) with uniqueName() and cleans them
 * up in `after`, in FK-safe order. superAdmin (account 1) is used read-only
 * for cross-tenant 403 checks — its URL target is always the fixture account
 * (9001), so account 1 is never read or written. Never touches account 1,
 * never wipes a table, never modifies src/**.
 *
 * Sign conventions (DS2_REVIEW_CONTEXT.md): customer_payments.payment_amount,
 * customer_writeoffs.writeoff_amount and retainer current/starting_amount are
 * stored NEGATIVE (credits). customer_transactions.quantity is hours;
 * total_transaction is always stored as Math.abs(...) (positive); unit_cost is
 * stored as sent (can be negative for a credit-style charge).
 *
 * ROLE GATE: matching /invoices and /accountsReceivable, the /transactions,
 * /retainers and /writeOffs routers are mounted with requireAuth AND
 * requireManagerOrAdmin (app.js) — previously requireAuth only, no role
 * check at all. This matches the DS2 frontend, which wraps the WHOLE
 * /transactions/* route tree (which also renders the Retainers and
 * Write-offs grids) in ManagerAndAdminProtectedAccessRoute
 * (DS2_Frontend/src/Routes/PrimaryRouter.js), restricted to accessLevel
 * admin/manager/super admin — a plain 'employee'/'User' role has no UI path
 * to any of these actions or grids, and now gets a 403 from the API too.
 * Each describe block below proves this with a real employee-token call
 * that is refused, rather than repeating the finding at length every time.
 */
const dayjs = require('dayjs');
const { bootHttp, uniqueName, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const { TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');

const A = TEST_ACCOUNT_ID; // 9001
const U = TEST_ADMIN_USER_ID; // 90013 admin+test@example.com
const EMPLOYEE_ID = 90011; // eliza+test@example.com, access_level 'employee'
const OTHER_TENANT_ACCOUNT_ID = 1; // superAdmin's real account — URL target for 403 checks only
const JOB_TYPE_ID = 900201; // seed: '1040 Individual Return'
const JOB_TYPE_ID_2 = 900204; // seed: 'General Consulting'
const GWD_ID = 90031; // seed: 'Tax Return Preparation'

describe('integration: transactions / retainers / write-offs route coverage', function () {
   this.timeout(120_000);

   let h;
   let db;

   const num = v => Number(v);
   const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
   const today = () => dayjs().format('YYYY-MM-DD');
   const daysAgo = n => dayjs().subtract(n, 'day').format('YYYY-MM-DD');
   const ymd = d => dayjs(d).format('YYYY-MM-DD');

   const createdCustomerIds = [];

   // ── fixture builders ────────────────────────────────────────────────────
   const makeCustomer = async label => {
      const displayName = uniqueName(`COV-${label}`);
      const [c] = await db('customers')
         .insert({
            account_id: A,
            customer_name: `Coverage ${label}`,
            display_name: displayName,
            is_commercial_customer: false,
            is_customer_active: true,
            is_billable: true,
            is_recurring: false
         })
         .returning('customer_id');
      const customerId = c.customer_id || c;
      createdCustomerIds.push(customerId);
      const [info] = await db('customer_information')
         .insert({
            account_id: A,
            customer_id: customerId,
            customer_street: '1 Coverage Way',
            customer_city: 'Mesa',
            customer_state: 'AZ',
            customer_zip: '85201',
            is_this_address_active: true,
            is_customer_physical_address: true,
            is_customer_billing_address: true,
            is_customer_mailing_address: true,
            created_by_user_id: U
         })
         .returning('customer_info_id');
      return { customerId, infoId: info.customer_info_id || info, label, displayName };
   };

   const makeJob = async (cust, jobTypeId = JOB_TYPE_ID) => {
      const [row] = await db('customer_jobs')
         .insert({ account_id: A, customer_id: cust.customerId, job_type_id: jobTypeId, current_job_total: 0, is_quote: false, is_job_complete: false, created_by_user_id: U })
         .returning('customer_job_id');
      return row.customer_job_id || row;
   };

   const makeParentInvoice = async (cust, { date, total, remaining = total, bb = 0, notes = null }) => {
      const [row] = await db('customer_invoices')
         .insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_info_id: cust.infoId,
            invoice_number: `A-COV-${cust.customerId}-${uniqueName('INV')}`,
            invoice_date: date,
            due_date: date,
            beginning_balance: bb,
            total_payments: 0,
            total_charges: total - bb,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: total,
            remaining_balance_on_invoice: remaining,
            is_invoice_paid_in_full: remaining === 0,
            created_by_user_id: U,
            notes
         })
         .returning('*');
      return row;
   };

   const makeRetainerRow = async (cust, amount, extra = {}) => {
      const [row] = await db('customer_retainers_and_prepayments')
         .insert({
            parent_retainer_id: null,
            customer_id: cust.customerId,
            account_id: A,
            display_name: `Coverage retainer ${cust.label}`,
            type_of_hold: 'Retainer',
            starting_amount: -amount,
            current_amount: -amount,
            form_of_payment: 'Check',
            payment_reference_number: 'R-COV-1',
            is_retainer_active: true,
            created_by_user_id: U,
            ...extra
         })
         .returning('*');
      return row;
   };

   // ── payload builders (mirror DS2_Frontend SharedPostObjects.js) ─────────
   const txnPayload = (cust, jobId, overrides = {}) => {
      const quantity = overrides.quantity ?? 1;
      const unitCost = overrides.unitCost ?? 100;
      return {
         accountID: A,
         customerID: cust.customerId,
         customerJobID: jobId,
         selectedJobID: jobId,
         selectedRetainerID: null,
         customerInvoicesID: null,
         loggedByUserID: U,
         loggedForUserID: EMPLOYEE_ID,
         selectedGeneralWorkDescriptionID: GWD_ID,
         detailedJobDescription: 'coverage txn',
         transactionDate: today(),
         transactionType: 'Time',
         quantity,
         unitCost,
         totalTransaction: (quantity * unitCost).toFixed(2),
         isTransactionBillable: true,
         isInAdditionToMonthlyCharge: false,
         note: '',
         timesheetEntryID: null,
         aiSuggestion: null,
         minutes: null,
         entity: null,
         category: null,
         ...overrides
      };
   };

   // Rebuild an update/delete body FROM a stored row, the way the frontend
   // re-sends the grid row's own data (see transactionsObjects.js mapper).
   const fromStoredTxn = (row, overrides = {}) => ({
      transactionID: row.transaction_id,
      accountID: A,
      customerID: row.customer_id,
      customerJobID: row.customer_job_id,
      selectedJobID: row.customer_job_id,
      selectedRetainerID: row.retainer_id,
      customerInvoicesID: row.customer_invoice_id,
      loggedForUserID: row.logged_for_user_id,
      selectedGeneralWorkDescriptionID: row.general_work_description_id,
      detailedJobDescription: row.detailed_work_description,
      transactionDate: ymd(row.transaction_date),
      transactionType: row.transaction_type,
      quantity: num(row.quantity),
      unitCost: num(row.unit_cost),
      totalTransaction: num(row.total_transaction).toFixed(2),
      isTransactionBillable: row.is_transaction_billable,
      isInAdditionToMonthlyCharge: row.is_excess_to_subscription,
      loggedByUserID: U,
      note: row.note,
      ...overrides
   });

   const retainerPayload = (cust, overrides = {}) => ({
      accountID: A,
      customerID: cust.customerId,
      displayName: `Coverage retainer ${uniqueName('RET')}`,
      typeOfHold: 'Retainer',
      unitCost: 200,
      formOfPayment: 'Check',
      paymentReferenceNumber: 'R-COV-1',
      loggedByUserID: U,
      note: null,
      ...overrides
   });

   const fromStoredRetainer = (row, overrides = {}) => ({
      retainerID: row.retainer_id,
      accountID: A,
      customerID: row.customer_id,
      displayName: row.display_name,
      typeOfHold: row.type_of_hold,
      unitCost: Math.abs(num(row.starting_amount)),
      formOfPayment: row.form_of_payment,
      paymentReferenceNumber: row.payment_reference_number,
      loggedByUserID: U,
      note: row.note,
      ...overrides
   });

   const writeOffPayload = (cust, overrides = {}) => ({
      accountID: A,
      customerID: cust.customerId,
      loggedByUserID: U,
      loggedForUserID: null,
      selectedJobID: null,
      customerInvoiceID: null,
      selectedDate: today(),
      unitCost: 25,
      writeoffReason: 'Courtesy',
      writeOffReason: 'Courtesy',
      note: null,
      ...overrides
   });

   const fromStoredWriteOff = (row, overrides = {}) => ({
      writeoffID: row.writeoff_id,
      accountID: A,
      customerID: row.customer_id,
      customerInvoiceID: row.customer_invoice_id,
      selectedJobID: row.customer_job_id,
      selectedDate: ymd(row.writeoff_date),
      unitCost: Math.abs(num(row.writeoff_amount)),
      writeoffReason: row.writeoff_reason,
      writeOffReason: row.writeoff_reason,
      loggedByUserID: U,
      note: row.note,
      ...overrides
   });

   // ── route paths ──────────────────────────────────────────────────────────
   const routes = {
      createTransaction: (acct = A) => `/transactions/createTransaction/${acct}/${U}`,
      updateTransaction: (acct = A) => `/transactions/updateTransaction/${acct}/${U}`,
      deleteTransaction: (acct = A) => `/transactions/deleteTransaction/${acct}/${U}`,
      getTransactions: (acct = A) => `/transactions/getTransactions/${acct}/${U}`,
      exportTransactions: (acct = A) => `/transactions/exportTransactions/${acct}/${U}`,
      getSingleTransaction: (customerId, transactionId, acct = A) => `/transactions/getSingleTransaction/${customerId}/${transactionId}/${acct}/${U}`,
      fetchEmployeeTransactions: (start, end, acct = A) => `/transactions/fetchEmployeeTransactions/${start}/${end}/${acct}/${U}`,
      createRetainer: (acct = A) => `/retainers/createRetainer/${acct}/${U}`,
      updateRetainer: (acct = A) => `/retainers/updateRetainer/${acct}/${U}`,
      deleteRetainer: (retainerId, acct = A) => `/retainers/deleteRetainer/${retainerId}/${acct}/${U}`,
      getSingleRetainer: (retainerId, acct = A) => `/retainers/getSingleRetainer/${retainerId}/${acct}/${U}`,
      getActiveRetainers: (customerId, acct = A) => `/retainers/getActiveRetainers/${customerId}/${acct}/${U}`,
      createWriteOffs: (acct = A) => `/writeOffs/createWriteOffs/${acct}/${U}`,
      updateWriteOffs: (acct = A) => `/writeOffs/updateWriteOffs/${acct}/${U}`,
      deleteWriteOffs: (acct = A) => `/writeOffs/deleteWriteOffs/${acct}/${U}`,
      getSingleWriteOff: (writeOffId, acct = A) => `/writeOffs/getSingleWriteOff/${writeOffId}/${acct}/${U}`,
      getWriteOffs: (acct = A) => `/writeOffs/getWriteOffs/${acct}/${U}`
   };

   // ── DB lookups ───────────────────────────────────────────────────────────
   const txnRow = id => db('customer_transactions').where({ account_id: A, transaction_id: id }).first();
   const latestTxnFor = custId => db('customer_transactions').where({ account_id: A, customer_id: custId }).orderBy('transaction_id', 'desc').first();
   const retainerRowById = id => db('customer_retainers_and_prepayments').where({ account_id: A, retainer_id: id }).first();
   const retainerChain = rootId =>
      db('customer_retainers_and_prepayments')
         .where({ account_id: A })
         .andWhere(b => b.where('retainer_id', rootId).orWhere('parent_retainer_id', rootId))
         .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'retainer_id', order: 'asc' }]);
   const writeOffRowById = id => db('customer_writeoffs').where({ account_id: A, writeoff_id: id }).first();
   const latestWriteOffFor = custId => db('customer_writeoffs').where({ account_id: A, customer_id: custId }).orderBy('writeoff_id', 'desc').first();
   const paymentsFor = custId => db('customer_payments').where({ account_id: A, customer_id: custId });
   const invoiceRow = id => db('customer_invoices').where({ account_id: A, customer_invoice_id: id }).first();
   const childrenOf = parentId => db('customer_invoices').where({ account_id: A, parent_invoice_id: parentId }).orderBy([{ column: 'created_at', order: 'asc' }, { column: 'customer_invoice_id', order: 'asc' }]);
   // Job "family" = the root job row + every version row updateRecentJobTotal
   // appended on a total change (parent_job_id = root). The newest one by
   // (created_at, customer_job_id) carries the authoritative current_job_total.
   const latestJobVersion = async rootJobId => {
      const family = await db('customer_jobs')
         .where({ account_id: A })
         .andWhere(b => b.where('customer_job_id', rootJobId).orWhere('parent_job_id', rootJobId))
         .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'customer_job_id', order: 'desc' }]);
      return family[0];
   };

   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
   });

   after(async () => {
      if (db) {
         for (const id of createdCustomerIds) {
            const where = { account_id: A, customer_id: id };
            await db('customer_payments').where(where).del();
            await db('customer_writeoffs').where(where).del();
            await db('customer_retainers_and_prepayments').where(where).del();
            await db('customer_transactions').where(where).del();
            await db('customer_invoices').where(where).whereNotNull('parent_invoice_id').del();
            await db('customer_invoices').where(where).del();
            await db('customer_jobs').where(where).del();
            await db('customer_information').where(where).del();
            await db('customers').where(where).del();
         }
      }
      await h.close();
   });

   // ─────────────────────────────────────────────────────────────────────────
   // POST /transactions/createTransaction/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('POST /transactions/createTransaction/:accountID/:userID', () => {
      it('happy path: creates a Time transaction, normalizes lowercase type, keeps decimal precision, and updates the job total', async () => {
         const cust = await makeCustomer('txn-create');
         const jobId = await makeJob(cust);

         const res = await h.as('admin').post(routes.createTransaction()).send({
            transaction: txnPayload(cust, jobId, { quantity: 0.25, unitCost: 75, totalTransaction: (0.25 * 75).toFixed(2), transactionType: 'time', detailedJobDescription: 'quarter hour' })
         });
         const body = expectEnvelopeOk(res, 'createTransaction happy path');
         expect(body.transactionsList.activeTransactionsData.activeTransactions).to.be.an('array');

         const row = await latestTxnFor(cust.customerId);
         expect(row, 'transaction row inserted').to.exist;
         expect(num(row.quantity)).to.equal(0.25);
         expect(num(row.unit_cost)).to.equal(75);
         expect(num(row.total_transaction), '0.25h x $75 stays decimal (18.75), not rounded').to.equal(18.75);
         expect(row.transaction_type, "lowercase 'time' normalizes to 'Time'").to.equal('Time');
         expect(row.is_transaction_billable).to.equal(true);
         expect(row.customer_invoice_id, 'starts unbilled').to.equal(null);
         expect(row.customer_job_id).to.equal(jobId);

         const jobFamily = await latestJobVersion(jobId);
         expect(num(jobFamily.current_job_total), 'newest job-family row carries the running total').to.equal(18.75);
      });

      it('validation failure: an unrecognized transaction_type is refused', async () => {
         const cust = await makeCustomer('txn-badtype');
         const jobId = await makeJob(cust);
         const res = await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { transactionType: 'invoice' }) });
         const body = expectEnvelopeRefused(res, /Invalid transaction_type/, 'createTransaction bad type');
         expect(body.message).to.include('Must be "Time" or "Charge"');
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.post(routes.createTransaction()).send({});
         expect(anon.status).to.equal(401);

         const cross = await h.as('superAdmin').post(routes.createTransaction()).send({});
         expect(cross.status).to.equal(403);

         const employeeRes = await h.as('employee').post(routes.createTransaction()).send({});
         expect(employeeRes.status).to.equal(403);
      });

      it('not-found: a nonexistent job id is refused', async () => {
         const cust = await makeCustomer('txn-nojob');
         const res = await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, 999999999) });
         expectEnvelopeRefused(res, /Selected job was not found/, 'createTransaction missing job');
      });

      it('cross-customer job refused: a job belonging to a different customer cannot be used', async () => {
         const custA = await makeCustomer('txn-crossA');
         const custB = await makeCustomer('txn-crossB');
         const jobB = await makeJob(custB);
         const res = await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(custA, jobB) });
         expectEnvelopeRefused(res, /does not belong to this customer/, 'createTransaction cross-customer job');
         expect(await latestTxnFor(custA.customerId)).to.equal(undefined);
      });

      it('a non-billable transaction never draws a retainer, even when one is selected', async () => {
         const cust = await makeCustomer('txn-nonbillable');
         const jobId = await makeJob(cust);
         const retainer = await makeRetainerRow(cust, 100);

         const res = await h.as('admin').post(routes.createTransaction()).send({
            transaction: txnPayload(cust, jobId, { isTransactionBillable: false, selectedRetainerID: retainer.retainer_id, quantity: 1, unitCost: 40, totalTransaction: '40.00' })
         });
         expectEnvelopeOk(res, 'createTransaction non-billable');

         const row = await latestTxnFor(cust.customerId);
         expect(row.retainer_id, 'the retainer link is dropped for a non-billable transaction').to.equal(null);
         expect(row.is_transaction_billable).to.equal(false);

         const chain = await retainerChain(retainer.retainer_id);
         expect(chain, 'no draw-down snapshot was created').to.have.lengthOf(1);
         expect(num(chain[0].current_amount), 'retainer balance untouched').to.equal(-100);
         expect(await paymentsFor(cust.customerId)).to.have.lengthOf(0);
      });

      it('a retainer-funded billable transaction draws the chain and creates the auto "Retainer" payment', async () => {
         const cust = await makeCustomer('txn-retainerfund');
         const jobId = await makeJob(cust);
         const retainer = await makeRetainerRow(cust, 200);

         const res = await h.as('admin').post(routes.createTransaction()).send({
            transaction: txnPayload(cust, jobId, { selectedRetainerID: retainer.retainer_id, quantity: 1, unitCost: 50, totalTransaction: '50.00' })
         });
         expectEnvelopeOk(res, 'createTransaction retainer-funded');

         const row = await latestTxnFor(cust.customerId);
         expect(row.retainer_id, 'stored retainer_id is the NEW draw-down snapshot, not the root').to.not.equal(retainer.retainer_id);

         const chain = await retainerChain(retainer.retainer_id);
         expect(chain, 'root + one draw-down snapshot').to.have.lengthOf(2);
         expect(num(chain[0].current_amount)).to.equal(-200);
         expect(num(chain[1].current_amount), 'drawn by the $50 transaction').to.equal(-150);
         expect(chain[1].retainer_id).to.equal(row.retainer_id);

         const payments = await paymentsFor(cust.customerId);
         expect(payments, 'one auto-created Retainer payment').to.have.lengthOf(1);
         expect(payments[0].form_of_payment).to.equal('Retainer');
         expect(num(payments[0].payment_amount), 'payments are stored negative').to.equal(-50);
         expect(payments[0].retainer_id, 'payment keeps the id the client originally selected (the root)').to.equal(retainer.retainer_id);
         expect(payments[0].customer_invoice_id).to.equal(null);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // PUT /transactions/updateTransaction/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('PUT /transactions/updateTransaction/:accountID/:userID', () => {
      it('happy path: updates fields and the DB reflects the new values', async () => {
         const cust = await makeCustomer('txn-update');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { quantity: 1, unitCost: 100, totalTransaction: '100.00' }) });
         const created = await latestTxnFor(cust.customerId);

         const res = await h
            .as('admin')
            .put(routes.updateTransaction())
            .send({ transaction: fromStoredTxn(created, { quantity: 2, unitCost: 100, totalTransaction: '200.00', detailedJobDescription: 'updated desc', transactionType: 'charge' }) });
         const body = expectEnvelopeOk(res, 'updateTransaction happy path');
         expect(body.message).to.equal('Successful.');

         const updated = await txnRow(created.transaction_id);
         expect(num(updated.quantity)).to.equal(2);
         expect(num(updated.total_transaction)).to.equal(200);
         expect(updated.transaction_type, "lowercase 'charge' normalizes to 'Charge'").to.equal('Charge');
         expect(updated.detailed_work_description).to.equal('updated desc');
      });

      it('validation failure: an unrecognized transaction_type is refused and nothing changes', async () => {
         const cust = await makeCustomer('txn-update-badtype');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId) });
         const created = await latestTxnFor(cust.customerId);

         const res = await h.as('admin').put(routes.updateTransaction()).send({ transaction: fromStoredTxn(created, { transactionType: 'nope' }) });
         expectEnvelopeRefused(res, /Invalid transaction_type/, 'updateTransaction bad type');
         const unchanged = await txnRow(created.transaction_id);
         expect(unchanged.transaction_type).to.equal('Time');
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.put(routes.updateTransaction()).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').put(routes.updateTransaction()).send({});
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').put(routes.updateTransaction()).send({});
         expect(res.status).to.equal(403);
      });

      it('not-found: a nonexistent transaction id is refused', async () => {
         const cust = await makeCustomer('txn-update-notfound');
         const jobId = await makeJob(cust);
         const res = await h.as('admin').put(routes.updateTransaction()).send({ transaction: fromStoredTxn({ transaction_id: 999999999, customer_id: cust.customerId, customer_job_id: jobId, logged_for_user_id: EMPLOYEE_ID, general_work_description_id: GWD_ID, transaction_date: today(), transaction_type: 'Time', quantity: 1, unit_cost: 1, total_transaction: 1, is_transaction_billable: true, is_excess_to_subscription: false, retainer_id: null, note: null }) });
         expectEnvelopeRefused(res, /Transaction was not found/, 'updateTransaction missing row');
      });

      it('cross-customer job refused on update too', async () => {
         const custA = await makeCustomer('txn-update-crossA');
         const custB = await makeCustomer('txn-update-crossB');
         const jobA = await makeJob(custA);
         const jobB = await makeJob(custB);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(custA, jobA) });
         const created = await latestTxnFor(custA.customerId);

         const res = await h.as('admin').put(routes.updateTransaction()).send({ transaction: fromStoredTxn(created, { customerJobID: jobB, selectedJobID: jobB }) });
         expectEnvelopeRefused(res, /does not belong to this customer/, 'updateTransaction cross-customer job');
         expect((await txnRow(created.transaction_id)).customer_job_id).to.equal(jobA);
      });

      it('an unbilled transaction cannot have its invoice link set via update (customerInvoicesID is not a mapped field)', async () => {
         const cust = await makeCustomer('txn-update-nolinkset');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId) });
         const created = await latestTxnFor(cust.customerId);
         expect(created.customer_invoice_id).to.equal(null);

         const res = await h.as('admin').put(routes.updateTransaction()).send({ transaction: fromStoredTxn(created, { customerInvoicesID: 999999, quantity: 3, unitCost: 100, totalTransaction: '300.00' }) });
         expectEnvelopeOk(res, 'updateTransaction sneaky invoice link');

         const after = await txnRow(created.transaction_id);
         expect(after.customer_invoice_id, 'the link stays null no matter what the body sends').to.equal(null);
         expect(num(after.total_transaction), 'the rest of the update still applied').to.equal(300);
      });

      it('a billed transaction (customer_invoice_id set directly) cannot be updated, and the link cannot be cleared', async () => {
         const cust = await makeCustomer('txn-update-billed');
         const jobId = await makeJob(cust);
         const invoice = await makeParentInvoice(cust, { date: today(), total: 100 });
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { quantity: 1, unitCost: 100, totalTransaction: '100.00' }) });
         const created = await latestTxnFor(cust.customerId);
         await db('customer_transactions').where({ transaction_id: created.transaction_id }).update({ customer_invoice_id: invoice.customer_invoice_id });

         const res = await h.as('admin').put(routes.updateTransaction()).send({ transaction: fromStoredTxn({ ...created, customer_invoice_id: invoice.customer_invoice_id }, { customerInvoicesID: null, quantity: 5, unitCost: 100, totalTransaction: '500.00' }) });
         expectEnvelopeRefused(res, /attached to an invoice and cannot be updated/, 'updateTransaction billed');

         const after = await txnRow(created.transaction_id);
         expect(num(after.total_transaction), 'nothing changed').to.equal(100);
         expect(after.customer_invoice_id, 'the link cannot be cleared by the refused request').to.equal(invoice.customer_invoice_id);
      });

      it('job totals follow the newest job-family row through create, amount edit, move to another job, and delete', async () => {
         const cust = await makeCustomer('txn-jobtotals');
         const jobA = await makeJob(cust, JOB_TYPE_ID);
         const jobB = await makeJob(cust, JOB_TYPE_ID_2);

         // Create on job A.
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobA, { quantity: 1, unitCost: 100, totalTransaction: '100.00' }) });
         const created = await latestTxnFor(cust.customerId);
         expect(num((await latestJobVersion(jobA)).current_job_total)).to.equal(100);
         expect(num((await latestJobVersion(jobB)).current_job_total)).to.equal(0);

         // Move to job B, same amount.
         let res = await h.as('admin').put(routes.updateTransaction()).send({ transaction: fromStoredTxn(created, { customerJobID: jobB, selectedJobID: jobB }) });
         expectEnvelopeOk(res, 'move to job B');
         expect(num((await latestJobVersion(jobA)).current_job_total), 'job A gives back the moved total').to.equal(0);
         expect(num((await latestJobVersion(jobB)).current_job_total), 'job B picks up the moved total').to.equal(100);

         // Amount-only edit on job B.
         const afterMove = await txnRow(created.transaction_id);
         res = await h.as('admin').put(routes.updateTransaction()).send({ transaction: fromStoredTxn(afterMove, { quantity: 1, unitCost: 150, totalTransaction: '150.00' }) });
         expectEnvelopeOk(res, 'amount-only edit');
         expect(num((await latestJobVersion(jobB)).current_job_total)).to.equal(150);

         // Delete removes it from job B's total.
         const afterAmount = await txnRow(created.transaction_id);
         res = await h.as('admin').delete(routes.deleteTransaction()).send({ transaction: fromStoredTxn(afterAmount) });
         expectEnvelopeOk(res, 'delete after moves');
         expect(num((await latestJobVersion(jobB)).current_job_total), 'job B nets back to 0').to.equal(0);
         expect(await txnRow(created.transaction_id)).to.equal(undefined);
      });

      it('A4-4: an edit that moves a transaction between VERSIONS of the SAME job family applies its amount delta exactly once', async () => {
         const cust = await makeCustomer('txn-jobfamily-move');
         const jobA = await makeJob(cust, JOB_TYPE_ID); // family root

         // $50 on the root creates the family's first version (V1).
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobA, { quantity: 1, unitCost: 50, totalTransaction: '50.00' }) });
         const first = await latestTxnFor(cust.customerId);
         const v1 = await latestJobVersion(jobA);
         expect(num(v1.current_job_total)).to.equal(50);
         expect(v1.customer_job_id, 'a NEW version row, not the root itself').to.not.equal(jobA);

         // A second, independent $50 entry created directly on the newest
         // version (V1) — the family total is now $100 across two job ids.
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, v1.customer_job_id, { quantity: 1, unitCost: 50, totalTransaction: '50.00' }) });
         const second = await latestTxnFor(cust.customerId);
         expect(num((await latestJobVersion(jobA)).current_job_total), 'family total after both entries').to.equal(100);

         // Move the FIRST entry from the root (jobA) onto V1 — a job change,
         // but within the SAME family — while ALSO changing its amount from
         // 50 to 80. If the edit double-counted (the old two-call "-oldTotal
         // on the old family, +newTotal on the new family" logic applied
         // across what is really one shared family), the result would
         // overshoot to 180 instead of the correct 130 (80 + the second
         // entry's unchanged 50).
         const res = await h
            .as('admin')
            .put(routes.updateTransaction())
            .send({ transaction: fromStoredTxn(first, { customerJobID: v1.customer_job_id, selectedJobID: v1.customer_job_id, quantity: 1, unitCost: 80, totalTransaction: '80.00' }) });
         expectEnvelopeOk(res, 'move within the same job family + amount edit');

         const newest = await latestJobVersion(jobA);
         expect(num(newest.current_job_total), 'the delta is applied exactly once across the shared family, not double-counted').to.equal(130);
         const firstNow = await txnRow(first.transaction_id);
         expect(num(firstNow.total_transaction)).to.equal(80);
         expect(firstNow.customer_job_id, 'the move itself was persisted — the entry now points at V1, not the root it started on').to.equal(v1.customer_job_id);
         expect(num((await txnRow(second.transaction_id)).total_transaction), "the second entry's own amount is untouched").to.equal(50);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // DELETE /transactions/deleteTransaction/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('DELETE /transactions/deleteTransaction/:accountID/:userID', () => {
      it('happy path: deletes the row and decrements the job total', async () => {
         const cust = await makeCustomer('txn-delete');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { quantity: 1, unitCost: 80, totalTransaction: '80.00' }) });
         const created = await latestTxnFor(cust.customerId);
         expect(num((await latestJobVersion(jobId)).current_job_total)).to.equal(80);

         const res = await h.as('admin').delete(routes.deleteTransaction()).send({ transaction: fromStoredTxn(created) });
         const body = expectEnvelopeOk(res, 'deleteTransaction happy path');
         expect(body.message).to.equal('Successful.');

         expect(await txnRow(created.transaction_id)).to.equal(undefined);
         expect(num((await latestJobVersion(jobId)).current_job_total)).to.equal(0);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.delete(routes.deleteTransaction()).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').delete(routes.deleteTransaction()).send({});
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').delete(routes.deleteTransaction()).send({});
         expect(res.status).to.equal(403);
      });

      it('not-found: a nonexistent transaction id is refused', async () => {
         const cust = await makeCustomer('txn-delete-notfound');
         const jobId = await makeJob(cust);
         const res = await h
            .as('admin')
            .delete(routes.deleteTransaction())
            .send({ transaction: fromStoredTxn({ transaction_id: 999999999, customer_id: cust.customerId, customer_job_id: jobId, logged_for_user_id: EMPLOYEE_ID, general_work_description_id: GWD_ID, transaction_date: today(), transaction_type: 'Time', quantity: 1, unit_cost: 1, total_transaction: 1, is_transaction_billable: true, is_excess_to_subscription: false, retainer_id: null, note: null }) });
         expectEnvelopeRefused(res, /Transaction was not found/, 'deleteTransaction missing row');
      });

      it('validation failure: an unrecognized transaction_type on the delete payload is refused', async () => {
         // deleteTransactionCore maps the whole body through
         // restoreDataTypesTransactionsTableOnUpdate before it ever touches the
         // DB, so a bad transaction_type is refused up front — and, unlike the
         // job id, the job used to decrement the total now always comes from
         // the STORED row (sharedTransactionFunctions.js loadStoredTransactionForWrite),
         // not the request body, so a bogus customerJobID in the delete body is
         // silently ignored rather than refused.
         const cust = await makeCustomer('txn-delete-badtype');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId) });
         const created = await latestTxnFor(cust.customerId);

         const res = await h.as('admin').delete(routes.deleteTransaction()).send({ transaction: fromStoredTxn(created, { transactionType: 'nope' }) });
         expectEnvelopeRefused(res, /Invalid transaction_type/, 'deleteTransaction bad type');
         expect(await txnRow(created.transaction_id), 'refused before the row was removed').to.exist;
      });

      it('a billed transaction (customer_invoice_id set directly) cannot be deleted', async () => {
         const cust = await makeCustomer('txn-delete-billed');
         const jobId = await makeJob(cust);
         const invoice = await makeParentInvoice(cust, { date: today(), total: 60 });
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { quantity: 1, unitCost: 60, totalTransaction: '60.00' }) });
         const created = await latestTxnFor(cust.customerId);
         await db('customer_transactions').where({ transaction_id: created.transaction_id }).update({ customer_invoice_id: invoice.customer_invoice_id });

         const res = await h.as('admin').delete(routes.deleteTransaction()).send({ transaction: fromStoredTxn({ ...created, customer_invoice_id: invoice.customer_invoice_id }) });
         expectEnvelopeRefused(res, /attached to an invoice and cannot be deleted/, 'deleteTransaction billed');
         expect(await txnRow(created.transaction_id), 'row survives the refused delete, still linked').to.exist;
         expect((await txnRow(created.transaction_id)).customer_invoice_id).to.equal(invoice.customer_invoice_id);
      });

      it('deleting a retainer-funded transaction removes its auto "Retainer" payment and restores the retainer balance', async () => {
         const cust = await makeCustomer('txn-delete-retainerfund');
         const jobId = await makeJob(cust);
         const retainer = await makeRetainerRow(cust, 200);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { selectedRetainerID: retainer.retainer_id, quantity: 1, unitCost: 50, totalTransaction: '50.00' }) });
         const created = await latestTxnFor(cust.customerId);
         const paymentBefore = (await paymentsFor(cust.customerId))[0];
         expect(paymentBefore, 'auto payment exists before delete').to.exist;

         const res = await h.as('admin').delete(routes.deleteTransaction()).send({ transaction: fromStoredTxn(created) });
         expectEnvelopeOk(res, 'deleteTransaction retainer-funded');

         expect(await txnRow(created.transaction_id)).to.equal(undefined);
         expect(await paymentsFor(cust.customerId), 'the auto payment was deleted with the transaction').to.have.lengthOf(0);

         // reverseFundedDraw's exact-link path deletes the draw-down row itself
         // (sharedTransactionFunctions.js reverseFundedDraw) rather than adding a
         // compensating snapshot, so an exactly-linked draw with nothing else on
         // the chain leaves only the root — restored to its original balance.
         const chain = await retainerChain(retainer.retainer_id);
         expect(chain, 'the draw-down row is removed, leaving only the root').to.have.lengthOf(1);
         expect(num(chain[0].current_amount), 'balance restored to the original $200').to.equal(-200);
         expect(chain[0].is_retainer_active).to.equal(true);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /transactions/getTransactions/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /transactions/getTransactions/:accountID/:userID', () => {
      it('happy path: paginated list finds a row by a unique search term', async () => {
         const cust = await makeCustomer('txn-list');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId) });

         const res = await h.as('admin').get(`${routes.getTransactions()}?page=1&limit=20&search=${encodeURIComponent(cust.displayName)}`);
         const body = expectEnvelopeOk(res, 'getTransactions happy path');
         const rows = body.transactionsList.activeTransactionsData.activeTransactions;
         expect(rows.some(r => Number(r.customer_id) === cust.customerId), 'the new row is found by its unique customer name').to.equal(true);
         expect(body.transactionsList.activeTransactionsData.pagination).to.include({ page: 1, limit: 20 });
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.get(routes.getTransactions());
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.getTransactions());
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.getTransactions());
         expect(employeeRes.status).to.equal(403);
      });

      it('validation failure: a non-positive limit is refused with HTTP 400', async () => {
         const res = await h.as('admin').get(`${routes.getTransactions()}?limit=0`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.include('Invalid pagination');
      });

      it('not-found-equivalent: a search matching nothing returns an empty list, not an error', async () => {
         const res = await h.as('admin').get(`${routes.getTransactions()}?search=${encodeURIComponent(uniqueName('NO-SUCH-CUSTOMER'))}`);
         const body = expectEnvelopeOk(res, 'getTransactions empty search');
         expect(body.transactionsList.activeTransactionsData.activeTransactions).to.deep.equal([]);
         expect(body.transactionsList.activeTransactionsData.pagination.totalItems).to.equal(0);
      });

      it('pagination: a limit over 500 is capped at 500', async () => {
         const res = await h.as('admin').get(`${routes.getTransactions()}?limit=10000&page=1`);
         const body = expectEnvelopeOk(res, 'getTransactions capped limit');
         expect(body.transactionsList.activeTransactionsData.pagination.limit).to.equal(500);
      });

      it('search containing quotes, semicolons and -- returns cleanly (parameterized, no 500)', async () => {
         const res = await h.as('admin').get(`${routes.getTransactions()}?search=${encodeURIComponent(`O'Reilly"; DROP TABLE customer_transactions; --`)}`);
         const body = expectEnvelopeOk(res, 'getTransactions injection-shaped search');
         expect(body.transactionsList.activeTransactionsData.activeTransactions).to.be.an('array');
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /transactions/exportTransactions/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /transactions/exportTransactions/:accountID/:userID', () => {
      const EXPORT_HEADER =
         'transaction_id,customer_id,customer_name,transaction_type,quantity,unit_cost,total_transaction,customer_invoice_id,retainer_id,is_transaction_billable,is_excess_to_subscription,transaction_date,created_at,logged_for_user_name,job_description,general_work_description,detailed_work_description';

      it('happy path: CSV has the header row, and a negative unit_cost stays intact', async () => {
         const cust = await makeCustomer('txn-export');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { quantity: 1, unitCost: -18.75, totalTransaction: '-18.75' }) });
         const created = await latestTxnFor(cust.customerId);

         const res = await h.as('admin').get(`${routes.exportTransactions()}?search=${encodeURIComponent(cust.displayName)}`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('text/csv');
         const lines = res.text.split('\n');
         expect(lines[0]).to.equal(EXPORT_HEADER);
         const myLine = lines.find(l => l.startsWith(`${created.transaction_id},`));
         expect(myLine, 'exported row for the created transaction').to.exist;
         const cells = myLine.split(',');
         expect(cells[5], 'unit_cost column stays a plain, unquoted negative number').to.equal('-18.75');
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.get(routes.exportTransactions());
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.exportTransactions());
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.exportTransactions());
         expect(employeeRes.status).to.equal(403);
      });

      it('search containing quotes, semicolons and -- returns a clean CSV (no 500)', async () => {
         const res = await h.as('admin').get(`${routes.exportTransactions()}?search=${encodeURIComponent(`x' OR '1'='1"; --`)}`);
         expect(res.status).to.equal(200);
         expect(res.text.split('\n')[0]).to.equal(EXPORT_HEADER);
      });

      // FIXED: the export used to write a detailed_work_description of '=1+1'
      // (or a real payload like '=cmd|\' /C calc\'!A1') byte-for-byte, so it
      // executed as a formula on open in Excel/Sheets/LibreOffice. Cells now go
      // through the shared src/endpoints/analytics/csv-util.js csvRow/csvCell,
      // which prefix a leading = + - @ TAB CR with an apostrophe while leaving
      // numeric strings such as '-18.75' untouched (see the happy path above).
      it('neutralizes a detailed_work_description starting with "=" so it cannot execute as a formula on open', async () => {
         const cust = await makeCustomer('txn-export-formula');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { detailedJobDescription: '=1+1' }) });
         const created = await latestTxnFor(cust.customerId);

         const res = await h.as('admin').get(`${routes.exportTransactions()}?search=${encodeURIComponent(cust.displayName)}`);
         const myLine = res.text.split('\n').find(l => l.startsWith(`${created.transaction_id},`));
         const lastCell = myLine.split(',').pop();
         expect(lastCell, 'a leading apostrophe guards the formula char').to.equal("'=1+1");
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID', () => {
      it('happy path: returns the transaction', async () => {
         const cust = await makeCustomer('txn-single');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId) });
         const created = await latestTxnFor(cust.customerId);

         const res = await h.as('admin').get(routes.getSingleTransaction(cust.customerId, created.transaction_id));
         const body = expectEnvelopeOk(res, 'getSingleTransaction happy path');
         expect(body.activeTransactionsData.transactionData).to.have.lengthOf(1);
         expect(body.activeTransactionsData.transactionData[0].transaction_id).to.equal(created.transaction_id);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('txn-single-gate');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId) });
         const created = await latestTxnFor(cust.customerId);

         const anon = await h.anonymous.get(routes.getSingleTransaction(cust.customerId, created.transaction_id));
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.getSingleTransaction(cust.customerId, created.transaction_id));
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.getSingleTransaction(cust.customerId, created.transaction_id));
         expect(employeeRes.status).to.equal(403);
      });

      it('not-found: a nonexistent transaction id is refused in the app envelope ({ status: 404 }), like getSingleRetainer', async () => {
         const cust = await makeCustomer('txn-single-notfound');
         const res = await h.as('admin').get(routes.getSingleTransaction(cust.customerId, 999999999));
         expect(res.status).to.equal(200);
         const body = expectEnvelopeRefused(res, /No matching transaction record found/, 'getSingleTransaction missing row');
         expect(body.status).to.equal(404);
         expect(body.activeTransactionsData).to.equal(undefined);
      });

      it('validation failure: a non-numeric transaction id is the same clean 404 refusal, not a raw HTTP 500', async () => {
         const cust = await makeCustomer('txn-single-badid');
         const res = await h.as('admin').get(routes.getSingleTransaction(cust.customerId, 'not-a-number'));
         expect(res.status).to.equal(200);
         const body = expectEnvelopeRefused(res, /No matching transaction record found/, 'getSingleTransaction non-numeric id');
         expect(body.status).to.equal(404);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID', () => {
      it("happy path: attributes a Time transaction's hours to the logged-for employee within the date range", async () => {
         const cust = await makeCustomer('txn-fetchemp');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { quantity: 2.5, unitCost: 100, totalTransaction: '250.00', loggedForUserID: EMPLOYEE_ID }) });

         const res = await h.as('admin').get(routes.fetchEmployeeTransactions(daysAgo(1), today()));
         const body = expectEnvelopeOk(res, 'fetchEmployeeTransactions happy path');
         const entry = body.userTime.find(e => Number(e.user.user_id) === EMPLOYEE_ID);
         expect(entry, 'employee entry present').to.exist;
         const customerEntry = entry.customers.find(c => c.customer === cust.displayName);
         expect(customerEntry, "scoped to this test's own customer to avoid cross-suite interference").to.exist;
         expect(customerEntry.time).to.equal(2.5);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.get(routes.fetchEmployeeTransactions(daysAgo(1), today()));
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.fetchEmployeeTransactions(daysAgo(1), today()));
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.fetchEmployeeTransactions(daysAgo(1), today()));
         expect(employeeRes.status).to.equal(403);
      });

      it('not-found-equivalent: a date range with nothing logged still returns 200 with a zeroed roster', async () => {
         const res = await h.as('admin').get(routes.fetchEmployeeTransactions(daysAgo(3650), daysAgo(3649)));
         const body = expectEnvelopeOk(res, 'fetchEmployeeTransactions empty range');
         expect(body.userTime).to.be.an('array');
         const entry = body.userTime.find(e => Number(e.user.user_id) === EMPLOYEE_ID);
         expect(entry.time).to.equal(0);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // POST /retainers/createRetainer/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('POST /retainers/createRetainer/:accountID/:userID', () => {
      it('happy path: stores starting_amount and current_amount NEGATIVE from a positive unitCost', async () => {
         const cust = await makeCustomer('ret-create');
         const res = await h.as('admin').post(routes.createRetainer()).send({ retainer: retainerPayload(cust, { unitCost: 250 }) });
         const body = expectEnvelopeOk(res, 'createRetainer happy path');
         expect(body.message).to.equal('Successfully created new retainer.');

         const rows = await db('customer_retainers_and_prepayments').where({ account_id: A, customer_id: cust.customerId });
         expect(rows).to.have.lengthOf(1);
         expect(num(rows[0].starting_amount)).to.equal(-250);
         expect(num(rows[0].current_amount)).to.equal(-250);
         expect(rows[0].is_retainer_active).to.equal(true);
         expect(rows[0].parent_retainer_id).to.equal(null);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.post(routes.createRetainer()).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').post(routes.createRetainer()).send({});
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').post(routes.createRetainer()).send({});
         expect(res.status).to.equal(403);
      });

      it('validation failure: a $0 amount is refused', async () => {
         const cust = await makeCustomer('ret-create-zero');
         const res = await h.as('admin').post(routes.createRetainer()).send({ retainer: retainerPayload(cust, { unitCost: 0 }) });
         expectEnvelopeRefused(res, /greater than \$0\.00/, 'createRetainer $0');
      });

      it('not-found: a nonexistent customer id is refused', async () => {
         const res = await h.as('admin').post(routes.createRetainer()).send({ retainer: retainerPayload({ customerId: 900199999 }) });
         expectEnvelopeRefused(res, /Customer not found for this account/, 'createRetainer missing customer');
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // PUT /retainers/updateRetainer/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('PUT /retainers/updateRetainer/:accountID/:userID', () => {
      it('happy path: re-prices the whole chain by the starting-amount delta and keeps draw-down history', async () => {
         const cust = await makeCustomer('ret-update');
         const root = await makeRetainerRow(cust, 300);
         const [draw] = await db('customer_retainers_and_prepayments')
            .insert({ ...root, retainer_id: undefined, created_at: undefined, parent_retainer_id: root.retainer_id, current_amount: -180 })
            .returning('*');

         const res = await h.as('admin').put(routes.updateRetainer()).send({ retainer: fromStoredRetainer(root, { unitCost: 400, displayName: 'Renamed coverage retainer' }) });
         const body = expectEnvelopeOk(res, 'updateRetainer happy path');
         expect(body.message).to.equal('Successfully updated retainer.');

         const chain = await retainerChain(root.retainer_id);
         expect(chain.map(r => num(r.starting_amount))).to.deep.equal([-400, -400]);
         expect(chain.map(r => num(r.current_amount)), 'the $120 already drawn stays drawn on the snapshot').to.deep.equal([-400, -280]);
         expect(chain.map(r => r.display_name)).to.deep.equal(['Renamed coverage retainer', 'Renamed coverage retainer']);
         expect(draw.retainer_id).to.be.a('number');
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.put(routes.updateRetainer()).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').put(routes.updateRetainer()).send({});
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').put(routes.updateRetainer()).send({});
         expect(res.status).to.equal(403);
      });

      it('validation failure: a $0 amount is refused', async () => {
         const cust = await makeCustomer('ret-update-zero');
         const root = await makeRetainerRow(cust, 100);
         const res = await h.as('admin').put(routes.updateRetainer()).send({ retainer: fromStoredRetainer(root, { unitCost: 0 }) });
         expectEnvelopeRefused(res, /greater than \$0\.00/, 'updateRetainer $0');
      });

      it('not-found: a nonexistent retainer id is refused', async () => {
         const cust = await makeCustomer('ret-update-notfound');
         const res = await h.as('admin').put(routes.updateRetainer()).send({ retainer: fromStoredRetainer({ retainer_id: 999999999, customer_id: cust.customerId, display_name: 'x', type_of_hold: 'Retainer', starting_amount: -1, form_of_payment: 'Check', payment_reference_number: null, note: null }) });
         expectEnvelopeRefused(res, /No matching retainer record found/, 'updateRetainer missing row');
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID', () => {
      it('happy path: deletes an unused retainer', async () => {
         const cust = await makeCustomer('ret-delete');
         const root = await makeRetainerRow(cust, 100);
         const res = await h.as('admin').delete(routes.deleteRetainer(root.retainer_id));
         const body = expectEnvelopeOk(res, 'deleteRetainer happy path');
         expect(body.message).to.equal('Successfully deleted retainer.');
         expect(await retainerRowById(root.retainer_id)).to.equal(undefined);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const custGate = await makeCustomer('ret-delete-gate');
         const retGate = await makeRetainerRow(custGate, 100);
         const anon = await h.anonymous.delete(routes.deleteRetainer(retGate.retainer_id));
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').delete(routes.deleteRetainer(retGate.retainer_id));
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').delete(routes.deleteRetainer(retGate.retainer_id));
         expect(res.status).to.equal(403);
         expect(await retainerRowById(retGate.retainer_id), 'employee token cannot delete it').to.exist;
      });

      it('not-found: a nonexistent retainer id is refused', async () => {
         const res = await h.as('admin').delete(routes.deleteRetainer(999999999));
         expectEnvelopeRefused(res, /No matching retainer record found/, 'deleteRetainer missing row');
      });

      it('refused when referenced: a retainer already drawn on cannot be deleted', async () => {
         const cust = await makeCustomer('ret-delete-referenced');
         const root = await makeRetainerRow(cust, 200);
         await db('customer_retainers_and_prepayments').insert({ ...root, retainer_id: undefined, created_at: undefined, parent_retainer_id: root.retainer_id, current_amount: -150 });

         const res = await h.as('admin').delete(routes.deleteRetainer(root.retainer_id));
         expectEnvelopeRefused(res, /already been drawn on/, 'deleteRetainer drawn-on');
         expect(await retainerRowById(root.retainer_id), 'not deleted').to.exist;
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID', () => {
      it('happy path: returns the retainer', async () => {
         const cust = await makeCustomer('ret-single');
         const root = await makeRetainerRow(cust, 100);
         const res = await h.as('admin').get(routes.getSingleRetainer(root.retainer_id));
         const body = expectEnvelopeOk(res, 'getSingleRetainer happy path');
         expect(body.activeRetainerData.activeRetainer).to.have.lengthOf(1);
         expect(body.activeRetainerData.activeRetainer[0].retainer_id).to.equal(root.retainer_id);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('ret-single-gate');
         const root = await makeRetainerRow(cust, 100);
         const anon = await h.anonymous.get(routes.getSingleRetainer(root.retainer_id));
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.getSingleRetainer(root.retainer_id));
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.getSingleRetainer(root.retainer_id));
         expect(employeeRes.status).to.equal(403);
      });

      it('not-found: a nonexistent retainer id returns a clean 404 envelope', async () => {
         const res = await h.as('admin').get(routes.getSingleRetainer(999999999));
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(404);
         expect(res.body.message).to.equal('No matching retainer record found.');
      });

      it('not-found: a malformed retainer id is refused before any SQL runs (no driver text leaks)', async () => {
         const res = await h.as('admin').get(routes.getSingleRetainer('not-a-number'));
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(404);
         expect(res.body.message).to.equal('No matching retainer record found.');
         expect(JSON.stringify(res.body)).to.not.match(/invalid input syntax|select|from "/i);
      });

      it('not-found: another tenant\'s retainer id is a 404, not a leak', async () => {
         const foreign = await db('customer_retainers_and_prepayments').where('account_id', 1).whereNull('parent_retainer_id').orderBy('retainer_id').first();
         if (!foreign) return this.skip();
         const res = await h.as('admin').get(routes.getSingleRetainer(foreign.retainer_id));
         expect(res.body.status).to.equal(404);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /retainers/getActiveRetainers/:customerID/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /retainers/getActiveRetainers/:customerID/:accountID/:userID', () => {
      it('happy path: lists a live retainer for the customer', async () => {
         const cust = await makeCustomer('ret-active');
         const root = await makeRetainerRow(cust, 120);
         const res = await h.as('admin').get(routes.getActiveRetainers(cust.customerId));
         const body = expectEnvelopeOk(res, 'getActiveRetainers happy path');
         expect(body.activeRetainerData.activeRetainers.map(r => r.retainer_id)).to.deep.equal([root.retainer_id]);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('ret-active-gate');
         const anon = await h.anonymous.get(routes.getActiveRetainers(cust.customerId));
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.getActiveRetainers(cust.customerId));
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.getActiveRetainers(cust.customerId));
         expect(employeeRes.status).to.equal(403);
      });

      it('not-found-equivalent: a customer with none returns an empty array', async () => {
         const cust = await makeCustomer('ret-active-none');
         const res = await h.as('admin').get(routes.getActiveRetainers(cust.customerId));
         const body = expectEnvelopeOk(res, 'getActiveRetainers empty');
         expect(body.activeRetainerData.activeRetainers).to.deep.equal([]);
      });

      it('an exhausted retainer (drawn to $0) is not offered', async () => {
         const cust = await makeCustomer('ret-active-exhausted');
         const jobId = await makeJob(cust);
         const root = await makeRetainerRow(cust, 40);
         await h.as('admin').post(routes.createTransaction()).send({ transaction: txnPayload(cust, jobId, { selectedRetainerID: root.retainer_id, quantity: 1, unitCost: 40, totalTransaction: '40.00' }) });

         const chain = await retainerChain(root.retainer_id);
         expect(num(chain[chain.length - 1].current_amount), 'fully drawn').to.equal(0);
         expect(chain[chain.length - 1].is_retainer_active, 'a $0 balance is inactive').to.equal(false);

         const res = await h.as('admin').get(routes.getActiveRetainers(cust.customerId));
         const body = expectEnvelopeOk(res, 'getActiveRetainers exhausted');
         expect(body.activeRetainerData.activeRetainers, 'the exhausted chain is not offered').to.deep.equal([]);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // POST /writeOffs/createWriteOffs/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('POST /writeOffs/createWriteOffs/:accountID/:userID', () => {
      it('happy path: a job-level write-off (no invoice) stores a NEGATIVE amount', async () => {
         const cust = await makeCustomer('wo-create');
         const jobId = await makeJob(cust);
         const res = await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId, unitCost: 15 }) });
         const body = expectEnvelopeOk(res, 'createWriteOffs happy path');
         expect(body.message).to.equal('Successfully created write-off.');

         const row = await latestWriteOffFor(cust.customerId);
         expect(num(row.writeoff_amount)).to.equal(-15);
         expect(row.customer_invoice_id).to.equal(null);
         expect(row.customer_job_id).to.equal(jobId);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.post(routes.createWriteOffs()).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').post(routes.createWriteOffs()).send({});
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').post(routes.createWriteOffs()).send({});
         expect(res.status).to.equal(403);
      });

      it('validation failure: a $0 amount is refused', async () => {
         const cust = await makeCustomer('wo-create-zero');
         const jobId = await makeJob(cust);
         const res = await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId, unitCost: 0 }) });
         expectEnvelopeRefused(res, /greater than \$0\.00/, 'createWriteOffs $0');
      });

      it('not-found: a nonexistent invoice id is refused', async () => {
         const cust = await makeCustomer('wo-create-noinvoice');
         const res = await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { customerInvoiceID: 999999999 }) });
         expectEnvelopeRefused(res, /No matching invoice record found/, 'createWriteOffs missing invoice');
      });

      it('applies directly to the customer\'s current chain', async () => {
         const cust = await makeCustomer('wo-create-current');
         const parent = await makeParentInvoice(cust, { date: today(), total: 300 });
         const res = await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { customerInvoiceID: parent.customer_invoice_id, unitCost: 40 }) });
         const body = expectEnvelopeOk(res, 'createWriteOffs current chain');
         expect(body.message).to.equal('Successfully created write-off.');

         const wo = await latestWriteOffFor(cust.customerId);
         expect(num(wo.writeoff_amount)).to.equal(-40);
         const children = await childrenOf(parent.customer_invoice_id);
         expect(children).to.have.lengthOf(1);
         expect(wo.customer_invoice_id).to.equal(children[0].customer_invoice_id);
         expect(num(children[0].remaining_balance_on_invoice)).to.equal(260);

         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(260);
         expect(num(parentNow.total_write_offs)).to.equal(-40);
      });

      it('remaps a reference to an absorbed chain onto the current chain and annotates the note', async () => {
         const cust = await makeCustomer('wo-create-absorbed');
         const absorbed = await makeParentInvoice(cust, { date: daysAgo(40), total: 300, remaining: 0, notes: '[absorbed_by:A-COV-X@2026-01-01]' });
         const current = await makeParentInvoice(cust, { date: daysAgo(5), total: 300, bb: 300 });

         const res = await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { customerInvoiceID: absorbed.customer_invoice_id, unitCost: 50, note: 'goodwill' }) });
         const body = expectEnvelopeOk(res, 'createWriteOffs absorbed remap');
         expect(body.message).to.include(`Applied to current invoice ${current.invoice_number}`);
         expect(body.message).to.include('was already rolled into it');

         const wo = await latestWriteOffFor(cust.customerId);
         expect(num(wo.writeoff_amount)).to.equal(-50);
         expect(wo.note).to.equal(`goodwill [applied to ${current.invoice_number}; referenced ${absorbed.invoice_number}]`);
         const [snap] = await childrenOf(current.customer_invoice_id);
         expect(wo.customer_invoice_id, 'linked to a snapshot of the CURRENT chain').to.equal(snap.customer_invoice_id);

         const currentNow = await invoiceRow(current.customer_invoice_id);
         expect(num(currentNow.remaining_balance_on_invoice)).to.equal(250);
         const absorbedNow = await invoiceRow(absorbed.customer_invoice_id);
         expect(num(absorbedNow.remaining_balance_on_invoice), 'absorbed chain untouched').to.equal(0);
         expect(await childrenOf(absorbed.customer_invoice_id)).to.have.lengthOf(0);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // PUT /writeOffs/updateWriteOffs/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('PUT /writeOffs/updateWriteOffs/:accountID/:userID', () => {
      it('happy path: updating an unbilled invoice-linked write-off re-prices its snapshot and the parent mirror', async () => {
         const cust = await makeCustomer('wo-update');
         const parent = await makeParentInvoice(cust, { date: today(), total: 300 });
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { customerInvoiceID: parent.customer_invoice_id, unitCost: 40 }) });
         const created = await latestWriteOffFor(cust.customerId);

         const res = await h.as('admin').put(routes.updateWriteOffs()).send({ writeOff: fromStoredWriteOff(created, { unitCost: 70, note: 'bigger courtesy' }) });
         const body = expectEnvelopeOk(res, 'updateWriteOffs happy path');
         expect(body.message).to.equal('Successfully updated write-off.');

         const updated = await writeOffRowById(created.writeoff_id);
         expect(num(updated.writeoff_amount)).to.equal(-70);
         expect(updated.note).to.equal('bigger courtesy');
         const snap = await invoiceRow(created.customer_invoice_id);
         expect(num(snap.remaining_balance_on_invoice)).to.equal(230);
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(230);
         expect(num(parentNow.total_write_offs)).to.equal(-70);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.put(routes.updateWriteOffs()).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').put(routes.updateWriteOffs()).send({});
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').put(routes.updateWriteOffs()).send({});
         expect(res.status).to.equal(403);
      });

      it('validation failure: a $0 amount is refused', async () => {
         const cust = await makeCustomer('wo-update-zero');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId, unitCost: 10 }) });
         const created = await latestWriteOffFor(cust.customerId);
         const res = await h.as('admin').put(routes.updateWriteOffs()).send({ writeOff: fromStoredWriteOff(created, { unitCost: 0 }) });
         expectEnvelopeRefused(res, /greater than \$0\.00/, 'updateWriteOffs $0');
      });

      it('not-found: a nonexistent write-off id is refused', async () => {
         const res = await h.as('admin').put(routes.updateWriteOffs()).send({ writeOff: fromStoredWriteOff({ writeoff_id: 999999999, customer_id: 900101, customer_invoice_id: null, customer_job_id: null, writeoff_date: today(), writeoff_amount: -1, writeoff_reason: 'x', note: null }) });
         expectEnvelopeRefused(res, /Unable to find write-off record/, 'updateWriteOffs missing row');
      });

      it('a billed write-off is immutable', async () => {
         const cust = await makeCustomer('wo-update-billed');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId, unitCost: 20 }) });
         const created = await latestWriteOffFor(cust.customerId);
         // Simulate a bill run landing after the write-off (created_at defaults to now(), which is later).
         await makeParentInvoice(cust, { date: today(), total: 50 });

         const res = await h.as('admin').put(routes.updateWriteOffs()).send({ writeOff: fromStoredWriteOff(created, { unitCost: 25 }) });
         expectEnvelopeRefused(res, /already been billed and cannot be deleted or modified/, 'updateWriteOffs billed');
         expect(num((await writeOffRowById(created.writeoff_id)).writeoff_amount), 'unchanged').to.equal(-20);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // DELETE /writeOffs/deleteWriteOffs/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('DELETE /writeOffs/deleteWriteOffs/:accountID/:userID', () => {
      it('happy path: symmetric delete removes the snapshot and restores the parent remaining', async () => {
         const cust = await makeCustomer('wo-delete');
         const parent = await makeParentInvoice(cust, { date: today(), total: 300 });
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { customerInvoiceID: parent.customer_invoice_id, unitCost: 40 }) });
         const created = await latestWriteOffFor(cust.customerId);

         const res = await h.as('admin').delete(routes.deleteWriteOffs()).send({ writeOff: fromStoredWriteOff(created) });
         const body = expectEnvelopeOk(res, 'deleteWriteOffs happy path');
         expect(body.message).to.equal('Successfully deleted write-off.');

         expect(await writeOffRowById(created.writeoff_id)).to.equal(undefined);
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(300);
         expect(num(parentNow.total_write_offs)).to.equal(0);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.delete(routes.deleteWriteOffs()).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').delete(routes.deleteWriteOffs()).send({});
         expect(cross.status).to.equal(403);

         const res = await h.as('employee').delete(routes.deleteWriteOffs()).send({});
         expect(res.status).to.equal(403);
      });

      it('not-found: a nonexistent write-off id is refused', async () => {
         const res = await h.as('admin').delete(routes.deleteWriteOffs()).send({ writeOff: fromStoredWriteOff({ writeoff_id: 999999999, customer_id: 900101, customer_invoice_id: null, customer_job_id: null, writeoff_date: today(), writeoff_amount: -1, writeoff_reason: 'x', note: null }) });
         expectEnvelopeRefused(res, /Unable to find write-off record/, 'deleteWriteOffs missing row');
      });

      it('a billed write-off cannot be deleted', async () => {
         const cust = await makeCustomer('wo-delete-billed');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId, unitCost: 20 }) });
         const created = await latestWriteOffFor(cust.customerId);
         await makeParentInvoice(cust, { date: today(), total: 50 });

         const res = await h.as('admin').delete(routes.deleteWriteOffs()).send({ writeOff: fromStoredWriteOff(created) });
         expectEnvelopeRefused(res, /already been billed and cannot be deleted or modified/, 'deleteWriteOffs billed');
         expect(await writeOffRowById(created.writeoff_id), 'not deleted').to.exist;
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID', () => {
      it('happy path: returns the write-off', async () => {
         const cust = await makeCustomer('wo-single');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId }) });
         const created = await latestWriteOffFor(cust.customerId);

         const res = await h.as('admin').get(routes.getSingleWriteOff(created.writeoff_id));
         const body = expectEnvelopeOk(res, 'getSingleWriteOff happy path');
         expect(body.activeWriteOffsData.activeWriteOffs).to.have.lengthOf(1);
         expect(body.activeWriteOffsData.activeWriteOffs[0].writeoff_id).to.equal(created.writeoff_id);
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('wo-single-gate');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId }) });
         const created = await latestWriteOffFor(cust.customerId);

         const anon = await h.anonymous.get(routes.getSingleWriteOff(created.writeoff_id));
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.getSingleWriteOff(created.writeoff_id));
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.getSingleWriteOff(created.writeoff_id));
         expect(employeeRes.status).to.equal(403);
      });

      it('not-found: a nonexistent write-off id returns a clean 404 envelope (same contract as getSingleRetainer)', async () => {
         const res = await h.as('admin').get(routes.getSingleWriteOff(999999999));
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(404);
         expect(res.body.message).to.equal('No matching write-off record found.');
      });

      it('not-found: a malformed write-off id is refused before any SQL runs (no driver text leaks)', async () => {
         const res = await h.as('admin').get(routes.getSingleWriteOff('abc'));
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(404);
         expect(JSON.stringify(res.body)).to.not.match(/invalid input syntax|select|from "/i);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // GET /writeOffs/getWriteOffs/:accountID/:userID
   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /writeOffs/getWriteOffs/:accountID/:userID', () => {
      it('happy path: paginated list finds a row by a unique search term', async () => {
         const cust = await makeCustomer('wo-list');
         const jobId = await makeJob(cust);
         await h.as('admin').post(routes.createWriteOffs()).send({ writeOff: writeOffPayload(cust, { selectedJobID: jobId }) });

         const res = await h.as('admin').get(`${routes.getWriteOffs()}?page=1&limit=20&search=${encodeURIComponent(cust.displayName)}`);
         const body = expectEnvelopeOk(res, 'getWriteOffs happy path');
         const rows = body.writeOffsList.activeWriteOffsData.activeWriteOffs;
         expect(rows.some(r => Number(r.customer_id) === cust.customerId)).to.equal(true);
         expect(body.writeOffsList.activeWriteOffsData.pagination).to.include({ page: 1, limit: 20 });
      });

      it('401 without a token, 403 for another tenant URL, 403 for an employee (manager+ required)', async () => {
         const anon = await h.anonymous.get(routes.getWriteOffs());
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(routes.getWriteOffs());
         expect(cross.status).to.equal(403);
         const employeeRes = await h.as('employee').get(routes.getWriteOffs());
         expect(employeeRes.status).to.equal(403);
      });

      it('validation failure: a non-positive limit is refused with HTTP 400', async () => {
         const res = await h.as('admin').get(`${routes.getWriteOffs()}?limit=-5`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.include('Invalid pagination');
      });

      it('pagination: a limit over 500 is capped at 500', async () => {
         const res = await h.as('admin').get(`${routes.getWriteOffs()}?limit=10000&page=1`);
         const body = expectEnvelopeOk(res, 'getWriteOffs capped limit');
         expect(body.writeOffsList.activeWriteOffsData.pagination.limit).to.equal(500);
      });

      it('search containing quotes, semicolons and -- returns cleanly (parameterized, no 500)', async () => {
         const res = await h.as('admin').get(`${routes.getWriteOffs()}?search=${encodeURIComponent(`'; DROP TABLE customer_writeoffs; --`)}`);
         const body = expectEnvelopeOk(res, 'getWriteOffs injection-shaped search');
         expect(body.writeOffsList.activeWriteOffsData.activeWriteOffs).to.be.an('array');
      });
   });
});
