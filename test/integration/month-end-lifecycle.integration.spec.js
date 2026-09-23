/**
 * Month-end ledger lifecycle, driven end-to-end through the Express app.
 *
 * One fresh customer on the fixture account (9001) goes through two billing
 * cycles the way the office does it: log work → Create Invoice (finalize) →
 * partial payment → write-off → next month's finalize (rolling balance) →
 * payment against the absorbed statement → overpayment split → NSF reversal →
 * delete of the reversal. After every mutation the spec asserts BOTH the HTTP
 * body and the raw ledger rows, and at the checkpoints it asserts that the
 * three balance views (billing engine, Account Audit, Accounts Receivable)
 * agree with the chain's latest snapshot.
 *
 * Every route in this app answers HTTP 200 and signals failure with
 * `{ status: 500, message }` in the body, so `expectOk` checks both.
 *
 * Time travel: `newInvoiceObject` hard-codes invoice_date = today, so a real
 * "month 2" cannot be produced by the API alone. After month 1 is finalized the
 * spec re-dates that parent row 31 days back (the same thing the calendar would
 * have done); the payment/write-off snapshots that follow copy the parent's
 * invoice_date, so the ledger ends up shaped exactly like a real two-month
 * history. This is the only place the spec writes ledger rows directly.
 *
 * Skipped when the DB is unreachable (see _setup.requireDb).
 */
const dotenv = require('dotenv');

// test/setup.js (mocha --require) seeds S3_* with placeholder values BEFORE
// _setup.js loads the env file with override:false, so the placeholders win and
// every S3 write in the finalize path would target http://localhost/test-bucket.
// Re-apply the env file's S3 settings so the invoice zip lands in the sandbox
// MinIO and getObject can read it back. Must run before ../../src/app is
// required, because src/utils/s3.js reads config at module load.
{
   const parsed = dotenv.config({ path: process.env.DS2_ENV_FILE || '.env.dev', override: false }).parsed || {};
   ['S3_BUCKET_NAME', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].forEach(key => {
      if (parsed[key]) process.env[key] = parsed[key];
   });
}

const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const supertest = global.supertest || require('supertest');
const app = require('../../src/app');
const config = require('../../config');
const { getObject, deleteObject } = require('../../src/utils/s3');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const { incrementAnInvoiceOrQuote } = require('../../src/endpoints/invoice/sharedInvoiceFunctions');
const { auditCustomerLedger } = require('../../src/endpoints/accountAudit/account-audit-logic');
const accountAuditService = require('../../src/endpoints/accountAudit/account-audit-service');
const accountsReceivableService = require('../../src/endpoints/accountsReceivable/accounts-receivable-service');
const { getCurrentChainTargets } = require('../../src/endpoints/payments/payment-logic');

const A = TEST_ACCOUNT_ID;
const U = TEST_ADMIN_USER_ID;
const ADMIN_EMAIL = 'admin+test@example.com'; // users.user_id 90013 in test/fixtures/seed.sql
const EMPLOYEE_ID = 90011; // Eliza Smith — logged_for_user on the time entries
const JOB_TYPE_ID = 900201; // '1040 Individual Return' (category 90001)
const GWD_ID = 90031; // 'Tax Return Preparation'
const MONTH_GAP_DAYS = 31;
const INVOICE_NUMBER_RE = /^INV-\d{4}-\d{5}$/;

const num = v => Number(v);
const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ymdLocal = d => dayjs(d).format('YYYY-MM-DD');
const daysAgo = n => dayjs().subtract(n, 'day').format('YYYY-MM-DD');

// Month 1 work: two time entries + one charge (billable) and one non-billable
// time entry that must be listed on the bill but never charged.
const M1 = {
   time1: { transactionType: 'Time', quantity: 2, unitCost: 150, billable: true, date: daysAgo(MONTH_GAP_DAYS + 9), desc: 'Prepared 1040 draft' },
   time2: { transactionType: 'Time', quantity: 1.5, unitCost: 100, billable: true, date: daysAgo(MONTH_GAP_DAYS + 7), desc: 'Reviewed schedules' },
   charge: { transactionType: 'Charge', quantity: 1, unitCost: 75, billable: true, date: daysAgo(MONTH_GAP_DAYS + 5), desc: 'E-file fee' },
   nonBillable: { transactionType: 'Time', quantity: 0.5, unitCost: 100, billable: false, date: daysAgo(MONTH_GAP_DAYS + 4), desc: 'Internal admin (no charge)' }
};
const M1_BILLABLE_TOTAL = 300 + 150 + 75; // 525
const M1_ALL_TOTAL = M1_BILLABLE_TOTAL + 50; // 575 — job totals include non-billable work
const PAYMENT_1 = 200; // partial payment on month 1
const WRITEOFF_1 = 25; // courtesy adjustment on month 1
const M1_REMAINING = M1_BILLABLE_TOTAL - PAYMENT_1 - WRITEOFF_1; // 300
const M2 = { transactionType: 'Time', quantity: 2, unitCost: 100, billable: true, date: daysAgo(10), desc: 'Amended return' };
const M2_CHARGES = 200;
const M2_TOTAL = M1_REMAINING + M2_CHARGES; // 500
const PAYMENT_2 = 100; // referencing the absorbed month-1 statement
const OVERPAY_EXCESS = 100;

describe('integration: month-end ledger lifecycle (HTTP)', function () {
   this.timeout(180_000);

   let db;
   let token;
   let createdAccountInfoId = null;
   let accountColumnsToRestore = null; // original NULL statement/template columns on the fixture account
   const s3Keys = [];

   // Ledger state carried between steps.
   const createdCustomerIds = []; // every customer this spec creates — all removed in `after`
   let customerId;
   let jobId;
   const txnIds = {}; // key → transaction_id
   let inv1; // month-1 parent row (re-read after each mutation)
   let inv2; // month-2 parent row
   let payment1Id;
   let writeoff1Id;
   let payment2Id;
   let overpayId;
   let prepaymentRetainerId;
   let reversalId;
   let reversalSnapshotId;
   let parentAfterOverpay;
   let overpayNoteBeforeReversal;

   // ── helpers ────────────────────────────────────────────────────────────────
   const authed = req => req.set('Authorization', `Bearer ${token}`);
   const post = (url, body) => authed(supertest(app).post(url).send(body));
   const get = url => authed(supertest(app).get(url));
   const del = (url, body) => authed(supertest(app).delete(url).send(body));

   const expectOk = (res, label) => {
      expect(res.status, `${label}: HTTP status`).to.equal(200);
      expect(res.body.status, `${label}: body.status — ${res.body.message}`).to.equal(200);
      return res.body;
   };

   const parentsFor = () =>
      db('customer_invoices').where({ account_id: A, customer_id: customerId }).whereNull('parent_invoice_id').orderBy('customer_invoice_id', 'asc');
   const childrenOf = parentId =>
      db('customer_invoices').where({ account_id: A, parent_invoice_id: parentId }).orderBy([{ column: 'created_at', order: 'asc' }, { column: 'customer_invoice_id', order: 'asc' }]);
   const invoiceRow = id => db('customer_invoices').where({ customer_invoice_id: id }).first();
   const paymentRow = id => db('customer_payments').where({ account_id: A, payment_id: id }).first();
   const customerTxns = () => db('customer_transactions').where({ account_id: A, customer_id: customerId }).orderBy('transaction_id', 'asc');
   const customerRetainers = () => db('customer_retainers_and_prepayments').where({ account_id: A, customer_id: customerId }).orderBy('retainer_id', 'asc');

   // The billing engine exactly as invoice-router / account-audit-router call it.
   const engineFor = async () => {
      const invoicesToCreate = [{ customer_id: customerId, showWriteOffs: false }];
      const invoicesToCreateMap = { [customerId]: invoicesToCreate[0] };
      const queryData = await fetchInitialQueryItems(db, invoicesToCreateMap, A);
      const [calc] = calculateInvoices(invoicesToCreate, queryData);
      return {
         invoiceTotal: money(calc.invoiceTotal),
         outstandingInvoiceTotal: money(calc.outstandingInvoices.outstandingInvoiceTotal),
         transactionsTotal: money(calc.transactions.transactionsTotal),
         paymentTotal: money(calc.payments.paymentTotal),
         writeOffTotal: money(calc.writeOffs.writeOffTotal),
         retainerTotal: money(calc.retainers.retainerTotal)
      };
   };

   // The audit engine exactly as account-audit-router.runAuditBatch feeds it.
   const auditFor = async () => {
      const [customer, invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
         accountAuditService.getCustomer(db, A, customerId),
         accountAuditService.getInvoices(db, A, customerId),
         accountAuditService.getPayments(db, A, customerId),
         accountAuditService.getWriteoffs(db, A, customerId),
         accountAuditService.getTransactions(db, A, customerId),
         accountAuditService.getRetainers(db, A, customerId)
      ]);
      return auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });
   };

   const arRowFor = async () => {
      const { rows } = await accountsReceivableService.getAging(db, A, { search: String(customerId), limit: 50, offset: 0 });
      return rows.find(r => Number(r.customer_id) === Number(customerId)) || null;
   };

   const chainRemaining = async () => {
      const targets = await getCurrentChainTargets(db, A, customerId);
      expect(targets, 'current-chain targets').to.have.lengthOf(1);
      return money(targets[0].remaining);
   };

   // Assert the three balance views all report `expected` as the customer's debt.
   const expectThreeViewsAgree = async (expected, label) => {
      const [engine, audit, ar, chain] = await Promise.all([engineFor(), auditFor(), arRowFor(), chainRemaining()]);
      expect(chain, `${label}: current chain remaining`).to.equal(expected);
      expect(engine.outstandingInvoiceTotal, `${label}: engine outstandingInvoiceTotal`).to.equal(expected);
      expect(money(audit.totals.outstanding_invoices), `${label}: audit outstanding_invoices`).to.equal(expected);
      if (expected > 0) {
         expect(ar, `${label}: AR aging row present`).to.not.equal(null);
         expect(money(ar.total_outstanding), `${label}: AR total_outstanding`).to.equal(expected);
      } else {
         expect(ar, `${label}: AR excludes settled customers`).to.equal(null);
      }
      return { engine, audit, ar };
   };

   // POST /customer/createCustomer (+ mailing address) then POST /jobs/createJob,
   // asserting both bodies and both tables. Mirrors formObjectForCustomerPost /
   // formObjectForJobPost plus the NewCustomer form fields.
   const createCustomerWithJob = async label => {
      const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
      const name = `MonthEnd Lifecycle ${label} ${stamp}`;

      const body = expectOk(
         await post(`/customer/createCustomer/${A}/${U}`, {
            customer: {
               accountID: A,
               userID: U,
               loggedByUserID: U,
               customerBusinessName: name,
               customerName: 'Lifecycle Tester',
               isCommercialCustomer: true,
               isCustomerActive: true,
               isCustomerBillable: true,
               isCustomerRecurring: false,
               customerStreet: '1 Ledger Lane',
               customerCity: 'Mesa',
               customerState: 'AZ',
               customerZip: '85201',
               customerEmail: `lifecycle+${stamp}@example.test`,
               customerPhone: '5550101234',
               isCustomerAddressActive: true,
               isCustomerPhysicalAddress: true,
               isCustomerBillingAddress: true,
               isCustomerMailingAddress: true
            }
         }),
         `createCustomer (${label})`
      );
      const listed = body.customersList.activeCustomerData.activeCustomers.find(c => c.display_name === name);
      expect(listed, `${label}: new customer appears in the returned active-customers list`).to.exist;
      const id = listed.customer_id;
      createdCustomerIds.push(id);

      const customer = await db('customers').where({ account_id: A, customer_id: id }).first();
      expect(customer.is_customer_active).to.equal(true);
      expect(customer.is_billable).to.equal(true);
      expect(customer.display_name).to.equal(name);

      const info = await db('customer_information').where({ account_id: A, customer_id: id });
      expect(info, `${label}: exactly one address row`).to.have.lengthOf(1);
      expect(info[0].is_customer_mailing_address, 'mailing address (required by getCustomerInformation)').to.equal(true);
      expect(info[0].is_this_address_active).to.equal(true);

      const jobBody = expectOk(
         await post(`/jobs/createJob/${A}/${U}`, {
            job: {
               accountID: A,
               userID: U,
               loggedByUserID: U,
               customerID: id,
               jobTypeID: JOB_TYPE_ID,
               quoteAmount: 0,
               agreedJobAmount: 0,
               currentJobTotal: 0,
               jobStatus: null,
               isJobComplete: false,
               isQuote: false,
               note: 'lifecycle spec'
            }
         }),
         `createJob (${label})`
      );
      const job = jobBody.accountJobsList.activeJobData.activeJobs.find(j => j.customer_id === id && j.parent_job_id === null);
      expect(job, `${label}: new job appears in the returned jobs list`).to.exist;

      const jobRows = await db('customer_jobs').where({ account_id: A, customer_id: id });
      expect(jobRows).to.have.lengthOf(1);
      expect(jobRows[0].job_type_id).to.equal(JOB_TYPE_ID);
      expect(num(jobRows[0].current_job_total)).to.equal(0);

      return { customerId: id, customerName: name, jobId: job.customer_job_id };
   };

   // POST /transactions/createTransaction for `target` (defaults to the main
   // customer), asserting the body and the inserted row.
   const createTransaction = async (key, spec, target = null) => {
      const tgt = target || { customerId, jobId };
      const totalTransaction = (spec.quantity * spec.unitCost).toFixed(2);
      // Mirrors SharedPostObjects.formObjectForTransactionPost.
      const body = expectOk(
         await post(`/transactions/createTransaction/${A}/${U}`, {
            transaction: {
               accountID: A,
               customerID: tgt.customerId,
               customerJobID: tgt.jobId,
               selectedJobID: tgt.jobId,
               selectedRetainerID: null,
               customerInvoicesID: null,
               loggedByUserID: U,
               loggedForUserID: EMPLOYEE_ID,
               selectedGeneralWorkDescriptionID: GWD_ID,
               detailedJobDescription: spec.desc,
               transactionDate: spec.date,
               transactionType: spec.transactionType,
               quantity: spec.quantity,
               unitCost: spec.unitCost,
               totalTransaction,
               isTransactionBillable: spec.billable,
               isInAdditionToMonthlyCharge: false,
               note: '',
               timesheetEntryID: null,
               aiSuggestion: null,
               minutes: null,
               entity: null,
               category: null
            }
         }),
         `createTransaction ${key}`
      );
      expect(body.transactionsList.activeTransactionsData.activeTransactions, `createTransaction ${key}: grid payload`).to.be.an('array');

      const rows = await db('customer_transactions').where({ account_id: A, customer_id: tgt.customerId }).orderBy('transaction_id', 'asc');
      const created = rows.find(r => !Object.values(txnIds).includes(r.transaction_id));
      expect(created, `createTransaction ${key}: row inserted`).to.exist;
      txnIds[key] = created.transaction_id;

      expect(num(created.quantity), `${key} quantity`).to.equal(spec.quantity);
      expect(num(created.unit_cost), `${key} unit_cost`).to.equal(spec.unitCost);
      expect(num(created.total_transaction), `${key} total_transaction = quantity × unit_cost`).to.equal(money(spec.quantity * spec.unitCost));
      expect(created.transaction_type, `${key} transaction_type`).to.equal(spec.transactionType);
      expect(created.is_transaction_billable, `${key} is_transaction_billable`).to.equal(spec.billable);
      expect(created.customer_invoice_id, `${key} starts unbilled`).to.equal(null);
      expect(created.customer_job_id, `${key} tied to the job`).to.equal(tgt.jobId);
      expect(ymdLocal(created.transaction_date), `${key} transaction_date`).to.equal(spec.date);
      return created;
   };

   const finalize = async (label, invoiceNote, forCustomerId = null) =>
      expectOk(
         await post(`/invoices/createInvoice/${A}/${U}`, {
            invoiceConfiguration: {
               invoicesToCreate: [{ customer_id: forCustomerId || customerId, showWriteOffs: false, invoiceNote }],
               invoiceCreationSettings: { isFinalized: true, isRoughDraft: false, isCsvOnly: false, globalInvoiceNote: 'Thank you for your business.' }
            }
         }),
         label
      );

   const paymentPayload = overrides => ({
      // Mirrors SharedPostObjects.formObjectForPaymentPost + Payment.js flags.
      accountID: A,
      customerID: customerId,
      selectedJobID: null,
      selectedRetainerID: null,
      loggedForUserID: null,
      loggedByUserID: U,
      transactionDate: daysAgo(1),
      formOfPayment: 'Check',
      paymentReferenceNumber: '1001',
      isTransactionBillable: true,
      note: null,
      foundInvoiceID: null,
      holdAsPrepayment: false,
      captureOverpayment: false,
      ...overrides
   });

   // ── lifecycle ──────────────────────────────────────────────────────────────
   before(async function () {
      db = await requireDb.call(this);
      app.set('db', db);

      token = jwt.sign({ user_id: U }, config.JWT_SECRET, { subject: ADMIN_EMAIL, expiresIn: '2h', algorithm: 'HS256' });

      // Sibling specs hand-insert invoices numbered 'TEST-REG-001',
      // 'INV-TEST-NSF-1', 'TEST-CASCADE-RECOMPUTE' on the fixture customers and
      // billing-regression never deletes its row. invoiceService.getLastInvoiceNumber
      // picks the account's lexicographically largest invoice_number with no
      // format guard, so any such leftover sorts above 'INV-2026-…' and every
      // finalize on the account dies in incrementAnInvoiceOrQuote with
      // "Invalid invoiceNumber format". Clear those fixture artifacts (and the
      // payments/write-offs hanging off them) so this spec's finalize path can run
      // regardless of suite order. Real invoices always match the production
      // format, so nothing this spec creates is touched here.
      const offending = await db('customer_invoices')
         .where({ account_id: A })
         .whereRaw(`invoice_number !~ '^[A-Z]+-[0-9]{4}-[0-9]{5}$'`)
         .pluck('customer_invoice_id');
      if (offending.length) {
         await db('customer_payments').where({ account_id: A }).whereIn('customer_invoice_id', offending).del();
         await db('customer_writeoffs').where({ account_id: A }).whereIn('customer_invoice_id', offending).del();
         await db('customer_transactions').where({ account_id: A }).whereIn('customer_invoice_id', offending).update({ customer_invoice_id: null });
         await db('customer_invoices').where({ account_id: A }).whereIn('customer_invoice_id', offending).whereNotNull('parent_invoice_id').del();
         await db('customer_invoices').where({ account_id: A }).whereIn('customer_invoice_id', offending).del();
      }

      // accountService.getAccount INNER JOINs account_information; the fixture
      // seed has no row for 9001, which makes the finalize path throw before it
      // reaches S3 ("Account name is required…"). Seed one for this run only.
      const existingInfo = await db('account_information').where({ account_id: A }).first();
      if (!existingInfo) {
         const [row] = await db('account_information')
            .insert({
               account_id: A,
               account_street: '100 Fixture Way',
               account_city: 'Phoenix',
               account_state: 'AZ',
               account_zip: '85001',
               account_email: 'billing+test@example.com',
               account_phone: '5550100000',
               is_this_address_active: true,
               is_account_physical_address: true,
               is_account_billing_address: true,
               is_account_mailing_address: true
            })
            .returning('account_info_id');
         createdAccountInfoId = row.account_info_id || row;
      }

      // The invoice PDF template dereferences the account's statement texts
      // (templateOneNotes.js: `account_interest_statement.length`) and the seed
      // leaves them NULL on 9001, so a finalize dies with "Cannot read
      // properties of null (reading 'length')". Give the fixture account the
      // same shape as the production account for this run and restore the
      // original values in `after`.
      const account = await db('accounts').where({ account_id: A }).first();
      const patch = {};
      // Same wording as the production account so the PDF exercises real text.
      if (account.account_statement == null) patch.account_statement = 'Please reference invoice number on payment.';
      if (account.account_interest_statement == null) patch.account_interest_statement = 'Balances unpaid for 30 days accrue interest at the rate of 18% per annum.';
      if (account.account_invoice_interest_rate == null) patch.account_invoice_interest_rate = 1.5;
      if (account.account_invoice_template_option == null) patch.account_invoice_template_option = 'template_one';
      if (Object.keys(patch).length) {
         accountColumnsToRestore = Object.keys(patch).reduce((acc, key) => ({ ...acc, [key]: account[key] }), {});
         await db('accounts').where({ account_id: A }).update(patch);
      }
   });

   after(async () => {
      if (db) {
         for (const id of createdCustomerIds) {
            const where = { account_id: A, customer_id: id };
            const myTxnIds = await db('customer_transactions').where(where).pluck('transaction_id');
            if (myTxnIds.length) {
               await db('ai_category_training_examples').whereIn('transaction_id', myTxnIds).del().catch(() => {});
            }
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
      for (const key of s3Keys) {
         await deleteObject(key).catch(() => {});
      }
      if (db && createdAccountInfoId) {
         await db('account_information').where({ account_info_id: createdAccountInfoId, account_id: A }).del();
      }
      if (db && accountColumnsToRestore) {
         await db('accounts').where({ account_id: A }).update(accountColumnsToRestore);
      }
      await closeDb();
   });

   // 1 ───────────────────────────────────────────────────────────────────────
   it('1. creates a customer with a mailing address and a job for it', async () => {
      const created = await createCustomerWithJob('main');
      customerId = created.customerId;
      jobId = created.jobId;
      expect(customerId).to.be.a('number');
      expect(jobId).to.be.a('number');
   });

   // 2 ───────────────────────────────────────────────────────────────────────
   it('2. logs two time entries, one charge and one non-billable entry (total = quantity × unit_cost)', async () => {
      await createTransaction('time1', M1.time1);
      await createTransaction('time2', M1.time2);
      await createTransaction('charge', M1.charge);
      await createTransaction('nonBillable', M1.nonBillable);

      const rows = await customerTxns();
      expect(rows).to.have.lengthOf(4);
      const billable = rows.filter(r => r.is_transaction_billable).reduce((a, r) => a + num(r.total_transaction), 0);
      expect(money(billable)).to.equal(M1_BILLABLE_TOTAL);

      // Every transaction rolls a new child job row carrying the running total
      // of ALL work on the job (billable and non-billable alike).
      const jobFamily = await db('customer_jobs').where({ account_id: A, customer_id: customerId }).orderBy('customer_job_id', 'desc');
      expect(jobFamily.length, 'parent job + one rolling child per transaction').to.equal(5);
      expect(num(jobFamily[0].current_job_total), 'latest job snapshot carries Σ(all transactions)').to.equal(M1_ALL_TOTAL);
      expect(jobFamily[0].parent_job_id).to.equal(jobId);
   });

   // 3 ───────────────────────────────────────────────────────────────────────
   it('3. Create Invoice eligibility lists the customer with the billable total and the engine total', async () => {
      const body = expectOk(await get(`/invoices/createInvoice/AccountsWithBalance/${A}/${U}`), 'AccountsWithBalance');
      const row = body.outstandingBalanceList.activeOutstandingBalancesData.activeOutstandingBalances.find(c => c.customer_id === customerId);
      expect(row, 'customer is eligible for invoicing').to.exist;
      expect(row.transaction_count).to.equal(4);
      expect(money(row.billable_transactions_total), 'billable_transactions_total excludes the non-billable entry').to.equal(M1_BILLABLE_TOTAL);
      expect(money(row.outstanding_invoice_total), 'no prior invoice').to.equal(0);
      expect(row.invoice_count).to.equal(0);

      const engine = await engineFor();
      expect(engine.transactionsTotal).to.equal(M1_BILLABLE_TOTAL);
      expect(engine.outstandingInvoiceTotal).to.equal(0);
      expect(engine.invoiceTotal).to.equal(M1_BILLABLE_TOTAL);
      expect(money(row.invoice_total), 'invoice_total equals the engine total').to.equal(engine.invoiceTotal);

      // The grid the UI renders must carry the same figures.
      const gridRow = body.outstandingBalanceList.activeOutstandingBalancesData.grid.rows.find(r => r.customer_id === customerId);
      expect(gridRow, 'grid row present').to.exist;
      expect(money(gridRow.invoice_total)).to.equal(M1_BILLABLE_TOTAL);
   });

   // 4 ───────────────────────────────────────────────────────────────────────
   it('4. month 1 finalize creates one parent invoice, stamps the transactions and stores the PDF zip in S3', async () => {
      const body = await finalize('finalize month 1', 'Month 1 statement');

      expect(body.fileLocation, 'final_invoices zip key returned').to.be.a('string').and.not.equal('');
      s3Keys.push(body.fileLocation);
      expect(body.invoicesWithDetail).to.have.lengthOf(1);
      const detail = body.invoicesWithDetail[0];
      expect(detail.customer_id).to.equal(customerId);
      expect(detail.invoiceNumber).to.match(INVOICE_NUMBER_RE);
      expect(money(detail.transactions.transactionsTotal)).to.equal(M1_BILLABLE_TOTAL);
      expect(money(detail.outstandingInvoices.outstandingInvoiceTotal)).to.equal(0);
      expect(money(detail.payments.paymentTotal)).to.equal(0);
      expect(money(detail.writeOffs.writeOffTotal)).to.equal(0);
      expect(money(detail.invoiceTotal)).to.equal(M1_BILLABLE_TOTAL);
      // Non-billable work is listed on the statement but not charged.
      expect(detail.transactions.allTransactionRecords).to.have.lengthOf(4);

      const parents = await parentsFor();
      expect(parents, 'exactly one parent invoice').to.have.lengthOf(1);
      [inv1] = parents;
      expect(inv1.invoice_number).to.equal(detail.invoiceNumber);
      expect(inv1.invoice_number).to.match(INVOICE_NUMBER_RE);
      expect(num(inv1.beginning_balance)).to.equal(0);
      expect(num(inv1.total_charges)).to.equal(M1_BILLABLE_TOTAL);
      expect(num(inv1.total_payments)).to.equal(0);
      expect(num(inv1.total_write_offs)).to.equal(0);
      expect(num(inv1.total_retainers)).to.equal(0);
      expect(num(inv1.total_amount_due)).to.equal(M1_BILLABLE_TOTAL);
      expect(num(inv1.remaining_balance_on_invoice)).to.equal(M1_BILLABLE_TOTAL);
      expect(inv1.is_invoice_paid_in_full).to.equal(false);
      expect(inv1.fully_paid_date).to.equal(null);
      expect(ymdLocal(inv1.invoice_date)).to.equal(ymdLocal(new Date()));
      expect(inv1.customer_info_id, 'linked to the mailing address').to.be.a('number');
      expect(inv1.invoice_file_location, 'per-customer invoice image key').to.be.a('string').and.not.equal('');
      s3Keys.push(inv1.invoice_file_location);
      expect(inv1.notes).to.equal(null);
      expect(await childrenOf(inv1.customer_invoice_id)).to.have.lengthOf(0);

      const txns = await customerTxns();
      expect(txns).to.have.lengthOf(4);
      txns.forEach(t => expect(t.customer_invoice_id, `transaction ${t.transaction_id} stamped with the new invoice`).to.equal(inv1.customer_invoice_id));

      // The zip really landed in S3 (MinIO) at the recorded key.
      const zipMagic = Buffer.from('PK');
      const image = await getObject(inv1.invoice_file_location);
      expect(Buffer.isBuffer(image.body)).to.equal(true);
      expect(image.body.length).to.be.greaterThan(0);
      expect(image.body.subarray(0, 2).equals(zipMagic), 'invoice_file_location is a zip archive').to.equal(true);
      expect(image.metadata.contentType).to.equal('application/zip');
      const batch = await getObject(body.fileLocation);
      expect(batch.body.subarray(0, 2).equals(zipMagic), 'fileLocation is a zip archive').to.equal(true);

      // The returned invoices grid includes the new parent.
      const listed = body.invoicesList.activeInvoiceData.activeInvoices.find(i => i.customer_invoice_id === inv1.customer_invoice_id);
      expect(listed, 'new invoice in the returned invoices list').to.exist;
   });

   it('4b. time-travel: re-dates the month-1 statement 31 days back so the next finalize is a real month 2', async () => {
      // See the file header. Only the parent is touched; the snapshots created
      // by the following payment/write-off copy invoice_date from the parent.
      const updated = await db('customer_invoices')
         .where({ account_id: A, customer_id: customerId, customer_invoice_id: inv1.customer_invoice_id })
         .update({
            invoice_date: db.raw(`invoice_date - ?::int`, [MONTH_GAP_DAYS]),
            due_date: db.raw(`due_date - ?::int`, [MONTH_GAP_DAYS]),
            start_date: db.raw(`start_date - ?::int`, [MONTH_GAP_DAYS]),
            end_date: db.raw(`end_date - ?::int`, [MONTH_GAP_DAYS]),
            created_at: db.raw(`created_at - (? || ' days')::interval`, [MONTH_GAP_DAYS])
         });
      expect(updated).to.equal(1);
      inv1 = await invoiceRow(inv1.customer_invoice_id);
      expect(ymdLocal(inv1.invoice_date)).to.equal(daysAgo(MONTH_GAP_DAYS));
      expect(num(inv1.remaining_balance_on_invoice)).to.equal(M1_BILLABLE_TOTAL);
   });

   // 5 ───────────────────────────────────────────────────────────────────────
   it('5. partial payment inserts a child snapshot and mirrors remaining / total_payments onto the parent', async () => {
      const body = expectOk(
         await post(`/payments/createPayment/${A}/${U}`, {
            payment: paymentPayload({ selectedInvoiceID: inv1.customer_invoice_id, unitCost: PAYMENT_1, paymentReferenceNumber: '1001', note: 'partial payment', transactionDate: daysAgo(12) })
         }),
         'createPayment (partial)'
      );
      expect(body.message, 'no remap or split happened').to.equal('Successfully created payment.');

      const children = await childrenOf(inv1.customer_invoice_id);
      expect(children, 'one snapshot row').to.have.lengthOf(1);
      const [snap] = children;
      expect(snap.parent_invoice_id).to.equal(inv1.customer_invoice_id);
      expect(snap.invoice_number).to.equal(inv1.invoice_number);
      expect(ymdLocal(snap.invoice_date), 'snapshot copies the parent invoice_date').to.equal(ymdLocal(inv1.invoice_date));
      expect(num(snap.remaining_balance_on_invoice)).to.equal(M1_BILLABLE_TOTAL - PAYMENT_1);
      expect(snap.is_invoice_paid_in_full).to.equal(false);
      expect(num(snap.total_amount_due)).to.equal(M1_BILLABLE_TOTAL);

      inv1 = await invoiceRow(inv1.customer_invoice_id);
      expect(num(inv1.remaining_balance_on_invoice), 'parent mirror remaining').to.equal(M1_BILLABLE_TOTAL - PAYMENT_1);
      expect(inv1.is_invoice_paid_in_full).to.equal(false);
      expect(num(inv1.total_payments), 'total_payments is a negative net').to.equal(-PAYMENT_1);
      expect(num(inv1.total_amount_due), 'total_amount_due untouched by payments').to.equal(M1_BILLABLE_TOTAL);

      const payments = await db('customer_payments').where({ account_id: A, customer_id: customerId });
      expect(payments).to.have.lengthOf(1);
      const [payment] = payments;
      payment1Id = payment.payment_id;
      expect(num(payment.payment_amount), 'payments are stored negative').to.equal(-PAYMENT_1);
      expect(payment.customer_invoice_id, 'payment points at the NEW snapshot, not the parent').to.equal(snap.customer_invoice_id);
      expect(payment.form_of_payment).to.equal('Check');
      expect(payment.payment_reference_number).to.equal('1001');
      expect(payment.note).to.equal('partial payment');

      const listed = body.paymentsList.activePaymentsData.activePayments.find(p => p.payment_id === payment1Id);
      expect(listed, 'payment in the returned payments list').to.exist;
      expect(num(listed.payment_amount)).to.equal(-PAYMENT_1);
   });

   // 6 ───────────────────────────────────────────────────────────────────────
   it('6. write-off of part of the remainder inserts a snapshot and mirrors remaining / total_write_offs onto the parent', async () => {
      // Mirrors SharedPostObjects.formObjectForWriteOffPost (customerInvoiceID = picked open invoice).
      const body = expectOk(
         await post(`/writeOffs/createWriteOffs/${A}/${U}`, {
            writeOff: {
               accountID: A,
               customerID: customerId,
               loggedByUserID: U,
               loggedForUserID: null,
               selectedJobID: null,
               customerInvoiceID: inv1.customer_invoice_id,
               selectedDate: daysAgo(11),
               unitCost: WRITEOFF_1,
               writeOffReason: 'Courtesy adjustment',
               writeoffReason: 'Courtesy adjustment',
               note: 'goodwill'
            }
         }),
         'createWriteOffs'
      );

      const children = await childrenOf(inv1.customer_invoice_id);
      expect(children, 'payment snapshot + write-off snapshot').to.have.lengthOf(2);
      const snap = children[1];
      expect(snap.parent_invoice_id).to.equal(inv1.customer_invoice_id);
      expect(num(snap.remaining_balance_on_invoice)).to.equal(M1_REMAINING);
      expect(snap.is_invoice_paid_in_full).to.equal(false);

      inv1 = await invoiceRow(inv1.customer_invoice_id);
      expect(num(inv1.remaining_balance_on_invoice), 'parent mirror remaining').to.equal(M1_REMAINING);
      expect(num(inv1.total_write_offs), 'total_write_offs is a negative net').to.equal(-WRITEOFF_1);
      expect(num(inv1.total_payments), 'total_payments unchanged by the write-off').to.equal(-PAYMENT_1);
      expect(inv1.is_invoice_paid_in_full).to.equal(false);

      const writeoffs = await db('customer_writeoffs').where({ account_id: A, customer_id: customerId });
      expect(writeoffs).to.have.lengthOf(1);
      const [wo] = writeoffs;
      writeoff1Id = wo.writeoff_id;
      expect(num(wo.writeoff_amount), 'write-offs are stored negative').to.equal(-WRITEOFF_1);
      expect(wo.customer_invoice_id, 'write-off points at its snapshot').to.equal(snap.customer_invoice_id);
      expect(wo.writeoff_reason).to.equal('Courtesy adjustment');

      const listed = body.writeOffsList.activeWriteOffsData.activeWriteOffs.find(w => w.writeoff_id === writeoff1Id);
      expect(listed, 'write-off in the returned list').to.exist;
   });

   // 7 ───────────────────────────────────────────────────────────────────────
   it('7. billing engine, Account Audit and Accounts Receivable agree on the month-1 remaining', async () => {
      const { engine, audit, ar } = await expectThreeViewsAgree(M1_REMAINING, 'after payment + write-off');

      // Nothing new is billable, and the current-chain write-off must be
      // single-counted (already inside the remaining), so the engine's next-bill
      // total IS the outstanding.
      expect(engine.transactionsTotal).to.equal(0);
      expect(engine.paymentTotal, 'invoice-linked payment is not re-applied').to.equal(0);
      expect(engine.writeOffTotal, 'current-chain write-off is not re-credited').to.equal(0);
      expect(engine.invoiceTotal).to.equal(M1_REMAINING);
      expect(money(audit.totals.audit_balance), 'audit_balance matches the engine total').to.equal(engine.invoiceTotal);
      expect(money(audit.totals.total_paid)).to.equal(PAYMENT_1);
      expect(money(audit.totals.total_writeoffs)).to.equal(WRITEOFF_1);
      expect(audit.discrepancies.filter(d => d.severity !== 'info'), `no non-info discrepancies: ${JSON.stringify(audit.discrepancies)}`).to.have.lengthOf(0);

      expect(ar.oldest_days, 'aged from the month-1 invoice date').to.be.within(MONTH_GAP_DAYS - 1, MONTH_GAP_DAYS + 1);
      expect(money(ar.bucket_31_60), 'sits in the 31–60 bucket').to.equal(M1_REMAINING);
      expect(money(ar.last_payment_amount)).to.equal(PAYMENT_1);
   });

   // 8 ───────────────────────────────────────────────────────────────────────
   it('8a. month 2 finalize rolls the remaining forward as beginning_balance and zeroes the absorbed month-1 rows', async () => {
      await createTransaction('m2', M2);

      const body = await finalize('finalize month 2', 'Month 2 statement');
      s3Keys.push(body.fileLocation);
      const detail = body.invoicesWithDetail[0];
      expect(money(detail.outstandingInvoices.outstandingInvoiceTotal), 'prior remaining rolls forward').to.equal(M1_REMAINING);
      expect(money(detail.transactions.transactionsTotal), 'only the new work is charged').to.equal(M2_CHARGES);
      expect(money(detail.payments.paymentTotal)).to.equal(0);
      expect(money(detail.writeOffs.writeOffTotal), 'month-1 write-off is already inside the remaining').to.equal(0);
      expect(money(detail.invoiceTotal)).to.equal(M2_TOTAL);

      const parents = await parentsFor();
      expect(parents, 'two parent invoices now').to.have.lengthOf(2);
      inv2 = parents[1];
      s3Keys.push(inv2.invoice_file_location);
      expect(inv2.invoice_number).to.equal(incrementAnInvoiceOrQuote(inv1.invoice_number, 0));
      expect(inv2.invoice_number).to.equal(detail.invoiceNumber);
      expect(num(inv2.beginning_balance), 'beginning_balance = prior chain remaining').to.equal(M1_REMAINING);
      expect(num(inv2.total_charges)).to.equal(M2_CHARGES);
      expect(num(inv2.total_payments)).to.equal(0);
      expect(num(inv2.total_write_offs)).to.equal(0);
      expect(num(inv2.total_amount_due)).to.equal(M2_TOTAL);
      expect(num(inv2.remaining_balance_on_invoice), 'remaining = bb + charges').to.equal(M2_TOTAL);
      expect(inv2.is_invoice_paid_in_full).to.equal(false);
      expect(ymdLocal(inv2.invoice_date)).to.equal(ymdLocal(new Date()));
      expect(ymdLocal(inv2.start_date), 'statement period starts at the prior invoice date').to.equal(ymdLocal(inv1.invoice_date));
      expect(inv2.notes).to.equal(null);

      // Month-1 chain: parent + both snapshots zeroed and stamped.
      const markerPrefix = `[absorbed_by:${inv2.invoice_number}@`;
      inv1 = await invoiceRow(inv1.customer_invoice_id);
      const m1Rows = [inv1, ...(await childrenOf(inv1.customer_invoice_id))];
      expect(m1Rows).to.have.lengthOf(3);
      m1Rows.forEach(row => {
         expect(num(row.remaining_balance_on_invoice), `month-1 row ${row.customer_invoice_id} zeroed`).to.equal(0);
         expect(row.notes || '', `month-1 row ${row.customer_invoice_id} carries the absorbed marker`).to.include('[absorbed_by:');
         expect(row.notes, `month-1 row ${row.customer_invoice_id} marker names the new invoice`).to.include(markerPrefix);
      });
      expect(num(inv1.total_amount_due), 'historic totals untouched').to.equal(M1_BILLABLE_TOTAL);
      expect(num(inv1.total_payments)).to.equal(-PAYMENT_1);
      expect(num(inv1.total_write_offs)).to.equal(-WRITEOFF_1);

      // Transactions: the new one stamped with month 2, the four old ones untouched.
      const txns = await customerTxns();
      expect(txns).to.have.lengthOf(5);
      const m2Txn = txns.find(t => t.transaction_id === txnIds.m2);
      expect(m2Txn.customer_invoice_id).to.equal(inv2.customer_invoice_id);
      ['time1', 'time2', 'charge', 'nonBillable'].forEach(key => {
         const t = txns.find(r => r.transaction_id === txnIds[key]);
         expect(t.customer_invoice_id, `${key} still on month 1`).to.equal(inv1.customer_invoice_id);
         expect(num(t.total_transaction), `${key} amount untouched`).to.equal(money(M1[key].quantity * M1[key].unitCost));
      });

      // The month-1 payment and write-off rows were not re-pointed.
      expect((await paymentRow(payment1Id)).customer_invoice_id).to.equal(m1Rows[1].customer_invoice_id);
      expect((await db('customer_writeoffs').where({ writeoff_id: writeoff1Id }).first()).customer_invoice_id).to.equal(m1Rows[2].customer_invoice_id);
   });

   it('8b. the three views agree on the month-2 remaining and the audit reports no stale rolled-forward rows', async () => {
      const { audit } = await expectThreeViewsAgree(M2_TOTAL, 'after month-2 finalize');
      const stale = audit.discrepancies.filter(d => d.kind === 'stale_rolled_forward_balance');
      expect(stale, 'absorbed rows were zeroed, so nothing is stale').to.have.lengthOf(0);
      expect(audit.invoice_breakdown.find(r => r.invoice_number === inv1.invoice_number).was_absorbed).to.equal(true);
      expect(audit.invoice_breakdown.find(r => r.invoice_number === inv2.invoice_number).was_absorbed).to.equal(false);
      const ar = await arRowFor();
      // AR computes days_old from the DB clock (UTC) against the invoice's local
      // calendar date, so a statement issued this evening already reads as one
      // day old once UTC has rolled past midnight.
      expect(ar.oldest_days, 'AR now ages from the month-2 invoice').to.be.within(0, 1);
      expect(money(ar.bucket_0_30)).to.equal(M2_TOTAL);
   });

   // DEFECT (write-off credited twice): invoice-service.getWriteOffsByCustomerID
   // (src/endpoints/invoice/invoice-service.js:272) pulls write-offs with
   // `created_at >= lastBillDate`, but lastBillDate is the DATE of the newest
   // parent invoice, so a write-off entered on billing day BEFORE the run is
   // pulled again after it. writeOffCalculations.isAbsorbedChainCredit
   // (src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:911-915)
   // then sees the write-off's chain root (month 1) dated before lastBillDate and
   // counts it as a next-bill credit, although month 1's remaining — and so month
   // 2's beginning_balance — already contains it.
   // Observed right after the month-2 finalize (statement just issued for $500):
   //   { outstandingInvoiceTotal: 500, transactionsTotal: 0, paymentTotal: 0,
   //     writeOffTotal: -25, retainerTotal: 0, invoiceTotal: 475 }
   // Expected: writeOffTotal 0 and invoiceTotal 500. Month 3 would credit the $25
   // a second time. account-audit-logic.js:672-693 applies the same rule
   // (audit_balance 475), so drift-check cannot see it. Payments are unaffected
   // because groupAndTotalPayments drops invoice-linked rows.
   // DEFECT (regression, invoice-service.js edit of 2026-09-22 23:11): see
   // finalize-engine.integration.spec.js 4b-iii — zeroOutAbsorbedInvoices stamps
   // `@${String(invoice_date).slice(0, 10)}` on a JS Date, producing
   // '[absorbed_by:INV-…@Tue Sep 22]' instead of the documented '@YYYY-MM-DD'.
   it('8d. the absorbed marker on the month-1 rows carries the statement date as YYYY-MM-DD', async () => {
      const marker = `[absorbed_by:${inv2.invoice_number}@${ymdLocal(inv2.invoice_date)}]`;
      const m1Rows = [await invoiceRow(inv1.customer_invoice_id), ...(await childrenOf(inv1.customer_invoice_id))];
      expect(m1Rows).to.have.lengthOf(3);
      m1Rows.forEach(row => expect(row.notes, `month-1 row ${row.customer_invoice_id}`).to.include(marker));
   });

   it('8c. right after the month-2 finalize the engine has nothing new to bill (no re-credited write-off)', async () => {
      const engine = await engineFor();
      expect(engine, 'nothing new since the statement: next-bill total must equal the outstanding').to.deep.equal({
         outstandingInvoiceTotal: M2_TOTAL,
         transactionsTotal: 0,
         paymentTotal: 0,
         writeOffTotal: 0,
         retainerTotal: 0,
         invoiceTotal: M2_TOTAL
      });
   });

   // 9 ───────────────────────────────────────────────────────────────────────
   it('9. a payment referencing the ABSORBED month-1 statement is remapped to the current chain and annotated', async () => {
      const body = expectOk(
         await post(`/payments/createPayment/${A}/${U}`, {
            payment: paymentPayload({ selectedInvoiceID: inv1.customer_invoice_id, unitCost: PAYMENT_2, paymentReferenceNumber: '1002', note: 'paid against old statement', transactionDate: daysAgo(2) })
         }),
         'createPayment (absorbed reference)'
      );
      expect(body.message).to.include(`Applied to current invoice ${inv2.invoice_number}`);
      expect(body.message).to.include(`the referenced invoice ${inv1.invoice_number} was already rolled into it`);

      const children = await childrenOf(inv2.customer_invoice_id);
      expect(children, 'snapshot lands on the month-2 chain').to.have.lengthOf(1);
      const [snap] = children;
      expect(num(snap.remaining_balance_on_invoice)).to.equal(M2_TOTAL - PAYMENT_2);
      expect(snap.is_invoice_paid_in_full).to.equal(false);

      const payments = await db('customer_payments').where({ account_id: A, customer_id: customerId }).orderBy('payment_id', 'desc');
      expect(payments).to.have.lengthOf(2);
      const payment = payments[0];
      payment2Id = payment.payment_id;
      expect(num(payment.payment_amount)).to.equal(-PAYMENT_2);
      expect(payment.customer_invoice_id, 'payment points at the month-2 snapshot').to.equal(snap.customer_invoice_id);
      expect(payment.note).to.include('paid against old statement');
      expect(payment.note).to.include(`[applied to ${inv2.invoice_number}; customer referenced ${inv1.invoice_number}]`);

      inv2 = await invoiceRow(inv2.customer_invoice_id);
      expect(num(inv2.remaining_balance_on_invoice)).to.equal(M2_TOTAL - PAYMENT_2);
      expect(num(inv2.total_payments)).to.equal(-PAYMENT_2);
      expect(inv2.is_invoice_paid_in_full).to.equal(false);

      // Month-1 rows stay settled.
      inv1 = await invoiceRow(inv1.customer_invoice_id);
      const m1Rows = [inv1, ...(await childrenOf(inv1.customer_invoice_id))];
      expect(m1Rows).to.have.lengthOf(3);
      m1Rows.forEach(row => expect(num(row.remaining_balance_on_invoice), `month-1 row ${row.customer_invoice_id} still 0`).to.equal(0));
      expect(num(inv1.total_payments), 'month-1 total_payments not touched').to.equal(-PAYMENT_1);

      await expectThreeViewsAgree(M2_TOTAL - PAYMENT_2, 'after remapped payment');
   });

   // 10 ──────────────────────────────────────────────────────────────────────
   it('10. an overpayment with captureOverpayment settles the chain and banks the excess as a Prepayment retainer', async () => {
      const remainingBefore = M2_TOTAL - PAYMENT_2; // 400
      const tendered = remainingBefore + OVERPAY_EXCESS; // 500

      const body = expectOk(
         await post(`/payments/createPayment/${A}/${U}`, {
            payment: paymentPayload({ selectedInvoiceID: inv2.customer_invoice_id, unitCost: tendered, paymentReferenceNumber: '1003', note: 'paid in full plus extra', transactionDate: daysAgo(1), captureOverpayment: true })
         }),
         'createPayment (overpayment)'
      );
      expect(body.message).to.include(`Applied $${remainingBefore.toFixed(2)} to ${inv2.invoice_number}; $${OVERPAY_EXCESS.toFixed(2)} held as a prepayment retainer.`);

      const children = await childrenOf(inv2.customer_invoice_id);
      expect(children).to.have.lengthOf(2);
      const snap = children[1];
      expect(num(snap.remaining_balance_on_invoice)).to.equal(0);
      expect(snap.is_invoice_paid_in_full).to.equal(true);
      expect(snap.fully_paid_date).to.not.equal(null);

      const payments = await db('customer_payments').where({ account_id: A, customer_id: customerId }).orderBy('payment_id', 'desc');
      expect(payments).to.have.lengthOf(3);
      const payment = payments[0];
      overpayId = payment.payment_id;
      expect(num(payment.payment_amount), 'only the remaining is applied to the invoice').to.equal(-remainingBefore);
      expect(payment.customer_invoice_id).to.equal(snap.customer_invoice_id);
      expect(payment.note).to.include('paid in full plus extra');
      expect(payment.note).to.include(`[overpayment split: $${remainingBefore.toFixed(2)} to ${inv2.invoice_number}, $${OVERPAY_EXCESS.toFixed(2)} to prepayment]`);
      overpayNoteBeforeReversal = payment.note;

      inv2 = await invoiceRow(inv2.customer_invoice_id);
      expect(num(inv2.remaining_balance_on_invoice)).to.equal(0);
      expect(inv2.is_invoice_paid_in_full).to.equal(true);
      expect(ymdLocal(inv2.fully_paid_date)).to.equal(ymdLocal(new Date()));
      expect(num(inv2.total_payments), 'negative net of both month-2 payments').to.equal(-(PAYMENT_2 + remainingBefore));
      parentAfterOverpay = {
         remaining_balance_on_invoice: num(inv2.remaining_balance_on_invoice),
         is_invoice_paid_in_full: inv2.is_invoice_paid_in_full,
         fully_paid_date: ymdLocal(inv2.fully_paid_date),
         total_payments: num(inv2.total_payments),
         total_write_offs: num(inv2.total_write_offs),
         total_amount_due: num(inv2.total_amount_due)
      };

      const retainers = await customerRetainers();
      expect(retainers, 'one prepayment retainer').to.have.lengthOf(1);
      const [retainer] = retainers;
      prepaymentRetainerId = retainer.retainer_id;
      expect(retainer.parent_retainer_id).to.equal(null);
      expect(retainer.type_of_hold).to.equal('Prepayment');
      expect(num(retainer.starting_amount), 'retainers are stored negative').to.equal(-OVERPAY_EXCESS);
      expect(num(retainer.current_amount)).to.equal(-OVERPAY_EXCESS);
      expect(retainer.is_retainer_active).to.equal(true);
      expect(retainer.form_of_payment).to.equal('Check');
      expect(retainer.payment_reference_number).to.equal('1003');
      expect(retainer.note).to.include(`[overpayment excess from payment on ${inv2.invoice_number}]`);

      const listedRetainer = body.accountRetainersList.activeRetainerData.activeRetainers.find(r => r.retainer_id === prepaymentRetainerId);
      expect(listedRetainer, 'retainer in the returned retainers list').to.exist;

      // Settled: engine/audit report 0 and the customer drops off AR.
      const { audit } = await expectThreeViewsAgree(0, 'after overpayment');
      expect(money(audit.totals.retainer_available)).to.equal(OVERPAY_EXCESS);
   });

   // 11 ──────────────────────────────────────────────────────────────────────
   it('11. reversing the overpayment (NSF) restores the chain remaining with a positive payment row', async () => {
      const restored = M2_TOTAL - PAYMENT_2; // 400 — the applied amount, not the tendered 500

      const body = expectOk(
         await post(`/payments/reversePayment/${A}/${U}`, { payment: { paymentID: overpayId, reason: 'NSF — check #1003 returned' } }),
         'reversePayment'
      );
      expect(body.message).to.equal(`Reversed payment #${overpayId}: $${restored.toFixed(2)} restored to ${inv2.invoice_number}.`);

      const children = await childrenOf(inv2.customer_invoice_id);
      expect(children).to.have.lengthOf(3);
      const snap = children[2];
      reversalSnapshotId = snap.customer_invoice_id;
      expect(num(snap.remaining_balance_on_invoice)).to.equal(restored);
      expect(snap.is_invoice_paid_in_full).to.equal(false);
      expect(snap.fully_paid_date).to.equal(null);

      const payments = await db('customer_payments').where({ account_id: A, customer_id: customerId }).orderBy('payment_id', 'desc');
      expect(payments).to.have.lengthOf(4);
      const reversal = payments[0];
      reversalId = reversal.payment_id;
      expect(num(reversal.payment_amount), 'reversal is a POSITIVE payment row').to.equal(restored);
      expect(reversal.form_of_payment).to.equal('Reversal');
      expect(reversal.customer_invoice_id).to.equal(reversalSnapshotId);
      expect(reversal.note).to.include(`[reversal of payment #${overpayId}]`);
      expect(reversal.note).to.include('NSF — check #1003 returned');
      expect(reversal.retainer_id).to.equal(null);

      const original = await paymentRow(overpayId);
      expect(original.note, 'original is cross-annotated').to.include('[reversed ');
      expect(num(original.payment_amount), 'original amount untouched').to.equal(-restored);

      inv2 = await invoiceRow(inv2.customer_invoice_id);
      expect(num(inv2.remaining_balance_on_invoice)).to.equal(restored);
      expect(inv2.is_invoice_paid_in_full).to.equal(false);
      expect(inv2.fully_paid_date).to.equal(null);
      expect(num(inv2.total_payments), 'net payments shrink by the reversed amount').to.equal(-PAYMENT_2);

      const { audit } = await expectThreeViewsAgree(restored, 'after reversal');
      expect(money(audit.totals.total_paid), 'audit nets the reversal against the payments').to.equal(PAYMENT_1 + PAYMENT_2);

      // Precondition for 12c: the prepayment retainer is still on the books
      // going into the delete (reversePayment has no retainer logic).
      const retainers = await customerRetainers();
      expect(retainers.map(r => r.retainer_id)).to.deep.equal([prepaymentRetainerId]);
   });

   // 12 ──────────────────────────────────────────────────────────────────────
   it('12a. deleting the reversal (latest snapshot) restores the chain exactly to its post-overpayment state', async () => {
      // Mirrors DeletePayment.js — the row's own fields sent back as the payload.
      const body = expectOk(
         await del(`/payments/deletePayment/${A}/${U}`, {
            payment: {
               paymentID: reversalId,
               accountID: A,
               customerID: customerId,
               selectedInvoiceID: reversalSnapshotId,
               selectedJobID: null,
               selectedRetainerID: null,
               transactionDate: daysAgo(0),
               unitCost: M2_TOTAL - PAYMENT_2,
               formOfPayment: 'Reversal',
               paymentReferenceNumber: '1003',
               isTransactionBillable: true,
               loggedByUserID: U,
               note: null
            }
         }),
         'deletePayment (reversal)'
      );
      expect(body.message).to.equal('Successfully deleted payment.');

      expect(await paymentRow(reversalId), 'reversal row deleted').to.equal(undefined);
      expect(await invoiceRow(reversalSnapshotId), 'reversal snapshot deleted').to.equal(undefined);

      const children = await childrenOf(inv2.customer_invoice_id);
      expect(children, 'back to the two payment snapshots').to.have.lengthOf(2);
      expect(num(children[1].remaining_balance_on_invoice), 'latest snapshot is the settled overpayment snapshot').to.equal(0);
      expect(children[1].is_invoice_paid_in_full).to.equal(true);

      inv2 = await invoiceRow(inv2.customer_invoice_id);
      const parentNow = {
         remaining_balance_on_invoice: num(inv2.remaining_balance_on_invoice),
         is_invoice_paid_in_full: inv2.is_invoice_paid_in_full,
         fully_paid_date: ymdLocal(inv2.fully_paid_date),
         total_payments: num(inv2.total_payments),
         total_write_offs: num(inv2.total_write_offs),
         total_amount_due: num(inv2.total_amount_due)
      };
      expect(parentNow, 'parent mirror round-trips exactly').to.deep.equal(parentAfterOverpay);

      const payments = await db('customer_payments').where({ account_id: A, customer_id: customerId });
      expect(payments).to.have.lengthOf(3);
      expect(payments.every(p => num(p.payment_amount) < 0), 'no positive rows remain').to.equal(true);

      await expectThreeViewsAgree(0, 'after deleting the reversal');
   });

   // DEFECT: payment-logic.reversePayment (src/endpoints/payments/payment-logic.js:702-706)
   // stamps the ORIGINAL payment's note with `[reversed <utc date>: <reason>]`, and
   // reversePayment refuses any payment whose note contains '[reversed ' (line 663).
   // payments-router deletePayment (src/endpoints/payments/payments-router.js:330-403)
   // removes the reversal row + snapshot and restores the chain, but never strips
   // that marker. Observed after deleting the reversal, original.note =
   //   'paid in full plus extra [overpayment split: $400.00 to INV-2026-00002,
   //    $100.00 to prepayment] [reversed 2026-09-23: NSF — check #1003 returned]'
   // so the payment can never be reversed again although no reversal exists.
   // Expected: the note returns to its pre-reversal value (create→delete
   // round-trip exactness). Side note: the marker date is UTC (toISOString)
   // while every other date on the ledger is local.
   it('12b. deleting the reversal restores the original payment note (it must be reversible again)', async () => {
      const original = await paymentRow(overpayId);
      expect(original.note).to.equal(overpayNoteBeforeReversal);
      expect(original.note).to.not.include('[reversed ');
   });

   // DEFECT (data loss): payment-logic.checkIfPaymentIsAttachedToInvoice
   // (src/endpoints/payments/payment-logic.js:540) calls
   // retainer-service.getRetainerBySameTime(db, account, paymentRecord.retainer_id, created_at)
   // (src/endpoints/retainer/retainer-service.js:29-34) for EVERY payment. For a
   // non-retainer payment retainer_id is null, and knex renders
   // `.andWhere('parent_retainer_id', null)` as `parent_retainer_id IS NULL`, so the
   // query returns every ROOT retainer on the account created before the payment.
   // payments-router.js:357-359 then deletes whichever row comes back first
   // ("Retainer used on payment, delete retainer"). The comment on line 354 claiming
   // it "matches nothing for non-retainer payments" is wrong. Observed: deleting the
   // Reversal row (retainer_id NULL) deleted the customer's $100 Prepayment retainer
   // from step 10 — customerRetainers() went from [<id>] to []. On the production
   // account every root retainer created before the payment is a candidate, and
   // the first row returned (no ORDER BY) is the one that dies.
   // Expected: deleting a payment with retainer_id NULL touches no retainer rows.
   // (The prod copy already holds one orphaned retainer snapshot — retainer_id 2
   // whose parent 1 is gone — consistent with this path having fired.)
   it('12c. deleting a non-retainer payment leaves unrelated retainers untouched', async () => {
      const retainers = await customerRetainers();
      expect(retainers.map(r => r.retainer_id), 'prepayment retainer survives an unrelated delete').to.deep.equal([prepaymentRetainerId]);
      expect(num(retainers[0].current_amount)).to.equal(-OVERPAY_EXCESS);
   });

   // 13 ──────────────────────────────────────────────────────────────────────
   // TODO(DEFECT): there is no same-day re-run guard anywhere in the finalize
   // path. invoice-router POST /createInvoice (src/endpoints/invoice/invoice-router.js:154-203)
   // never checks whether the customer already has a parent invoice dated today,
   // dataInsertionOrchestrator.newInvoiceObject always inserts a fresh parent with
   // beginning_balance = the current outstanding, and zeroOutAbsorbedInvoices
   // (invoice-service.js:440-451) only zeroes rows dated STRICTLY before today, so
   // the just-issued statement keeps its remaining. A second click on the same day
   // therefore produces two live parents carrying the same dollars: the engine and
   // the audit sum same-day parents (2×), while AR's DISTINCT ON picks one (1×) —
   // the three views disagree and next month's beginning_balance would double.
   // Observed for a fresh customer with one $50 charge, finalized twice today:
   //   { parent_invoices: 2, engine_outstanding: 100, audit_outstanding: 100, ar_outstanding: 50 }
   // Expected: { parent_invoices: 1, engine_outstanding: 50, audit_outstanding: 50, ar_outstanding: 50 }
   // — the second finalize should be rejected (or reuse the existing statement).
   it('13. finalizing the same customer twice on the same day does not create a second parent or double the outstanding', async () => {
      // A second, isolated customer keeps this check free of the main ledger's
      // history: one $50 charge, billed, then billed again the same day.
      const other = await createCustomerWithJob('rerun');
      await createTransaction('rerunCharge', { transactionType: 'Charge', quantity: 1, unitCost: 50, billable: true, date: daysAgo(0), desc: 'Late fee' }, other);

      const first = await finalize('finalize (first run)', 'First run', other.customerId);
      s3Keys.push(first.fileLocation);
      const parentsAfterFirst = await db('customer_invoices').where({ account_id: A, customer_id: other.customerId }).whereNull('parent_invoice_id');
      expect(parentsAfterFirst).to.have.lengthOf(1);
      s3Keys.push(parentsAfterFirst[0].invoice_file_location);
      const outstanding = num(parentsAfterFirst[0].remaining_balance_on_invoice);
      expect(outstanding).to.equal(50);

      const again = await finalize('finalize (same-day re-run)', 'Re-run', other.customerId);
      s3Keys.push(again.fileLocation);
      const parentsAfterRerun = await db('customer_invoices').where({ account_id: A, customer_id: other.customerId }).whereNull('parent_invoice_id');
      parentsAfterRerun.forEach(p => p.invoice_file_location && s3Keys.push(p.invoice_file_location));

      // The customer must still have ONE statement and every view must still
      // report the same 1× outstanding.
      const invoicesToCreate = [{ customer_id: other.customerId, showWriteOffs: false }];
      const queryData = await fetchInitialQueryItems(db, { [other.customerId]: invoicesToCreate[0] }, A);
      const [calc] = calculateInvoices(invoicesToCreate, queryData);
      const [customer, invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
         accountAuditService.getCustomer(db, A, other.customerId),
         accountAuditService.getInvoices(db, A, other.customerId),
         accountAuditService.getPayments(db, A, other.customerId),
         accountAuditService.getWriteoffs(db, A, other.customerId),
         accountAuditService.getTransactions(db, A, other.customerId),
         accountAuditService.getRetainers(db, A, other.customerId)
      ]);
      const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });
      const { rows: arRows } = await accountsReceivableService.getAging(db, A, { search: String(other.customerId), limit: 50, offset: 0 });
      const ar = arRows.find(r => Number(r.customer_id) === Number(other.customerId)) || null;

      const observed = {
         parent_invoices: parentsAfterRerun.length,
         engine_outstanding: money(calc.outstandingInvoices.outstandingInvoiceTotal),
         audit_outstanding: money(audit.totals.outstanding_invoices),
         ar_outstanding: ar ? money(ar.total_outstanding) : null
      };
      expect(observed, 'same-day re-run must not duplicate the statement or double the balance').to.deep.equal({
         parent_invoices: 1,
         engine_outstanding: outstanding,
         audit_outstanding: outstanding,
         ar_outstanding: outstanding
      });
   });
});
