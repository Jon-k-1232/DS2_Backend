/**
 * Finalize-engine integration spec (HTTP) — companion to month-end-lifecycle.
 *
 * Exercises the Create Invoice engine changes of 2026-09-23 end to end through
 * the Express app with supertest, on fresh customers of the fixture account:
 *   1. finalize stamps ONLY customer_invoice_id — fractional hours, cents and
 *      NULL notes survive the statement run untouched
 *   2. deleteInvoice guards — a parent that rolled a prior balance is refused
 *      ('rolled'), a payment snapshot row is refused ('snapshot'), a fresh
 *      zero-history parent deletes cleanly
 *   3. getInvoiceDetails reads the whole statement chain (payments/write-offs
 *      tagged to snapshots) and lists only this customer's retainers
 *   4. same-day re-run: skipped by default (skippedCustomers[]), and with
 *      allowSameDayRebill the new statement absorbs today's by chain identity
 *   5. invoice numbering ignores non-conforming invoice_number rows
 *   6. AccountsWithBalance: billed_today, and write_off_count counts only
 *      write-offs entered after the newest statement
 *
 * Every route answers HTTP 200 and signals failure with `{ status: 500 }` in
 * the body, so `expectOk` checks both.
 *
 * Time travel (documented where used): `newInvoiceObject` hard-codes
 * invoice_date = today, so a real second month is produced by re-dating the
 * first statement's parent row 31 days back; retainers "established mid-cycle"
 * are likewise back-dated 20 days so they fall inside the statement window.
 * Those are the only direct ledger writes besides the NULL-note setup in (1).
 */
const dotenv = require('dotenv');

// test/setup.js seeds S3_* placeholders before _setup.js loads the env file with
// override:false; re-apply the env file's S3 settings so the finalize path
// writes to the sandbox MinIO. Must precede ../../src/app (s3.js reads config
// at module load).
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
const { deleteObject } = require('../../src/utils/s3');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const { auditCustomerLedger } = require('../../src/endpoints/accountAudit/account-audit-logic');
const accountAuditService = require('../../src/endpoints/accountAudit/account-audit-service');
const accountsReceivableService = require('../../src/endpoints/accountsReceivable/accounts-receivable-service');

const A = TEST_ACCOUNT_ID;
const U = TEST_ADMIN_USER_ID;
const ADMIN_EMAIL = 'admin+test@example.com'; // users.user_id 90013 in test/fixtures/seed.sql
const EMPLOYEE_ID = 90011;
const JOB_TYPE_ID = 900201;
const GWD_ID = 90031;
const MONTH_GAP_DAYS = 31;
const INVOICE_NUMBER_RE = /^INV-\d{4}-\d{5}$/;

const num = v => Number(v);
const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ymdLocal = d => dayjs(d).format('YYYY-MM-DD');
const daysAgo = n => dayjs().subtract(n, 'day').format('YYYY-MM-DD');
const today = () => ymdLocal(new Date());

// Main customer's month-1 work.
const QUARTER_HOUR = { transactionType: 'Time', quantity: 0.25, unitCost: 75, billable: true, date: daysAgo(MONTH_GAP_DAYS + 6), desc: 'Quarter-hour client call' }; // 18.75
const FULL_HOUR = { transactionType: 'Time', quantity: 1, unitCost: 100, billable: true, date: daysAgo(MONTH_GAP_DAYS + 5), desc: 'Return preparation' }; // 100
const NON_BILLABLE = { transactionType: 'Time', quantity: 0.5, unitCost: 80, billable: false, date: daysAgo(MONTH_GAP_DAYS + 4), desc: 'Internal review (no charge)' }; // 40, never charged
const JOB_WRITEOFF_BEFORE = 10; // job-level write-off entered before the first statement — nets against the job's charges
const M1_CHARGES = 18.75 + 100 - JOB_WRITEOFF_BEFORE; // 108.75
const JOB_WRITEOFF_AFTER = 5; // job-level write-off entered after the first statement — nets against the job's NEXT charges
const PAYMENT_1 = 50;
const WRITEOFF_1 = 8.75;
const M1_REMAINING = M1_CHARGES - PAYMENT_1 - WRITEOFF_1; // 50
const M2_WORK = { transactionType: 'Time', quantity: 1, unitCost: 50, billable: true, date: daysAgo(9), desc: 'Amended schedule' }; // 50
const M2_CHARGES = 50 - JOB_WRITEOFF_AFTER; // 45
const M2_TOTAL = M1_REMAINING + M2_CHARGES; // 95
const PAYMENT_2 = 20;
const RETAINER_MAIN = 200;
const RETAINER_PEER = 300;
const RERUN_CHARGE = 60;

describe('integration: finalize engine (HTTP)', function () {
   this.timeout(180_000);

   let db;
   let token;
   let createdAccountInfoId = null;
   let accountColumnsToRestore = null;
   const s3Keys = [];
   const createdCustomerIds = [];

   // Customers.
   let main; // { customerId, jobId }
   let peer; // holds a retainer + the non-conforming invoice_number row
   let empty; // zero-history statement → deletable
   let rerun; // same-day re-bill + 'rolled' delete guard

   // Ledger state.
   const txnIds = {};
   let mainRowsBeforeFinalize;
   let inv1; // main month-1 parent
   let inv2; // main month-2 parent
   let snapshot1Id; // main payment snapshot on inv1
   let payment1Id;
   let payment2Id;
   let writeoff1Id;
   let retainerMainId;
   let retainerPeerId;
   let rerunParent1;
   let rerunParent2;

   // ── helpers ────────────────────────────────────────────────────────────────
   const authed = req => req.set('Authorization', `Bearer ${token}`);
   const post = (url, body) => authed(supertest(app).post(url).send(body));
   const get = url => authed(supertest(app).get(url));
   const del = url => authed(supertest(app).delete(url));

   const expectOk = (res, label) => {
      expect(res.status, `${label}: HTTP status`).to.equal(200);
      expect(res.body.status, `${label}: body.status — ${res.body.message}`).to.equal(200);
      return res.body;
   };
   const expectRefused = (res, label) => {
      expect(res.status, `${label}: HTTP status`).to.equal(409);
      expect(res.body.status, `${label}: body.status`).to.equal(409);
      return res.body;
   };

   const invoiceRow = id => db('customer_invoices').where({ customer_invoice_id: id }).first();
   const parentsFor = customerId => db('customer_invoices').where({ account_id: A, customer_id: customerId }).whereNull('parent_invoice_id').orderBy('customer_invoice_id', 'asc');
   const childrenOf = parentId => db('customer_invoices').where({ account_id: A, parent_invoice_id: parentId }).orderBy([{ column: 'created_at', order: 'asc' }, { column: 'customer_invoice_id', order: 'asc' }]);
   const txnsFor = customerId => db('customer_transactions').where({ account_id: A, customer_id: customerId }).orderBy('transaction_id', 'asc');
   const retainersFor = customerId => db('customer_retainers_and_prepayments').where({ account_id: A, customer_id: customerId }).orderBy('retainer_id', 'asc');
   // Payment / write-off rows also carry customer_invoice_id (their snapshot
   // link), so each entity gets its own id picker.
   const paymentIds = rows => rows.map(r => r.payment_id);
   const writeoffIds = rows => rows.map(r => r.writeoff_id);
   const retainerIds = rows => rows.map(r => r.retainer_id);
   const transactionIds = rows => rows.map(r => r.transaction_id);

   const engineFor = async customerId => {
      const invoicesToCreate = [{ customer_id: customerId, showWriteOffs: false }];
      const queryData = await fetchInitialQueryItems(db, { [customerId]: invoicesToCreate[0] }, A);
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
   const auditFor = async customerId => {
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
   const arRowFor = async customerId => {
      const { rows } = await accountsReceivableService.getAging(db, A, { search: String(customerId), limit: 50, offset: 0 });
      return rows.find(r => Number(r.customer_id) === Number(customerId)) || null;
   };
   const expectThreeViewsAgree = async (customerId, expected, label) => {
      const [engine, audit, ar] = await Promise.all([engineFor(customerId), auditFor(customerId), arRowFor(customerId)]);
      expect(engine.outstandingInvoiceTotal, `${label}: engine outstandingInvoiceTotal`).to.equal(expected);
      expect(money(audit.totals.outstanding_invoices), `${label}: audit outstanding_invoices`).to.equal(expected);
      if (expected > 0) {
         expect(ar, `${label}: AR row present`).to.not.equal(null);
         expect(money(ar.total_outstanding), `${label}: AR total_outstanding`).to.equal(expected);
      } else {
         expect(ar, `${label}: AR excludes settled customers`).to.equal(null);
      }
      return { engine, audit, ar };
   };

   // Next conforming statement number, computed independently of the product's
   // incrementAnInvoiceOrQuote: highest INV-YYYY-NNNNN on the account by (year,
   // sequence) as numbers, +1 in the same year, else 00001.
   const nextConformingNumber = async () => {
      const numbers = await db('customer_invoices').where({ account_id: A }).whereRaw(`invoice_number ~ '^INV-[0-9]{4}-[0-9]{5}$'`).pluck('invoice_number');
      const year = new Date().getFullYear();
      const best = numbers.reduce((acc, n) => {
         const [, y, s] = n.match(/^INV-(\d{4})-(\d{5})$/);
         const candidate = { year: Number(y), seq: Number(s) };
         if (!acc || candidate.year > acc.year || (candidate.year === acc.year && candidate.seq > acc.seq)) return candidate;
         return acc;
      }, null);
      const seq = best && best.year === year ? best.seq + 1 : 1;
      return `INV-${year}-${String(seq).padStart(5, '0')}`;
   };

   const createCustomerWithJob = async label => {
      const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
      const name = `FinalizeEngine ${label} ${stamp}`;
      const body = expectOk(
         await post(`/customer/createCustomer/${A}/${U}`, {
            customer: {
               accountID: A,
               userID: U,
               loggedByUserID: U,
               customerBusinessName: name,
               customerName: 'Engine Tester',
               isCommercialCustomer: true,
               isCustomerActive: true,
               isCustomerBillable: true,
               isCustomerRecurring: false,
               customerStreet: '2 Ledger Lane',
               customerCity: 'Mesa',
               customerState: 'AZ',
               customerZip: '85201',
               customerEmail: `engine+${stamp}@example.test`,
               customerPhone: '5550105678',
               isCustomerAddressActive: true,
               isCustomerPhysicalAddress: true,
               isCustomerBillingAddress: true,
               isCustomerMailingAddress: true
            }
         }),
         `createCustomer (${label})`
      );
      const listed = body.customersList.activeCustomerData.activeCustomers.find(c => c.display_name === name);
      expect(listed, `${label}: customer listed`).to.exist;
      const customerId = listed.customer_id;
      createdCustomerIds.push(customerId);

      const jobBody = expectOk(
         await post(`/jobs/createJob/${A}/${U}`, {
            job: { accountID: A, userID: U, loggedByUserID: U, customerID: customerId, jobTypeID: JOB_TYPE_ID, quoteAmount: 0, agreedJobAmount: 0, currentJobTotal: 0, jobStatus: null, isJobComplete: false, isQuote: false, note: 'finalize-engine spec' }
         }),
         `createJob (${label})`
      );
      const job = jobBody.accountJobsList.activeJobData.activeJobs.find(j => j.customer_id === customerId && j.parent_job_id === null);
      expect(job, `${label}: job listed`).to.exist;
      const info = await db('customer_information').where({ account_id: A, customer_id: customerId }).first();
      return { customerId, jobId: job.customer_job_id, customerInfoId: info.customer_info_id, name };
   };

   const createTransaction = async (key, target, spec) => {
      expectOk(
         await post(`/transactions/createTransaction/${A}/${U}`, {
            transaction: {
               accountID: A,
               customerID: target.customerId,
               customerJobID: target.jobId,
               selectedJobID: target.jobId,
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
               totalTransaction: (spec.quantity * spec.unitCost).toFixed(2),
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
      const rows = await txnsFor(target.customerId);
      const created = rows.find(r => !Object.values(txnIds).includes(r.transaction_id));
      expect(created, `createTransaction ${key}: row inserted`).to.exist;
      txnIds[key] = created.transaction_id;
      expect(num(created.total_transaction), `${key} total_transaction`).to.equal(money(spec.quantity * spec.unitCost));
      expect(created.customer_invoice_id, `${key} starts unbilled`).to.equal(null);
      return created;
   };

   const finalize = async (label, customerIds, settings = {}) =>
      expectOk(
         await post(`/invoices/createInvoice/${A}/${U}`, {
            invoiceConfiguration: {
               invoicesToCreate: customerIds.map(customer_id => ({ customer_id, showWriteOffs: false, invoiceNote: label })),
               invoiceCreationSettings: { isFinalized: true, isRoughDraft: false, isCsvOnly: false, globalInvoiceNote: 'Thank you for your business.', ...settings }
            }
         }),
         label
      );

   const paymentPayload = (customerId, overrides) => ({
      accountID: A,
      customerID: customerId,
      selectedJobID: null,
      selectedRetainerID: null,
      loggedForUserID: null,
      loggedByUserID: U,
      transactionDate: daysAgo(1),
      formOfPayment: 'Check',
      paymentReferenceNumber: '3001',
      isTransactionBillable: true,
      note: null,
      foundInvoiceID: null,
      holdAsPrepayment: false,
      captureOverpayment: false,
      ...overrides
   });

   const writeOffPayload = (customerId, overrides) => ({
      accountID: A,
      customerID: customerId,
      loggedByUserID: U,
      loggedForUserID: null,
      selectedJobID: null,
      customerInvoiceID: null,
      selectedDate: daysAgo(1),
      writeOffReason: 'Courtesy adjustment',
      writeoffReason: 'Courtesy adjustment',
      note: 'goodwill',
      ...overrides
   });

   const accountsWithBalanceRow = async customerId => {
      const body = expectOk(await get(`/invoices/createInvoice/AccountsWithBalance/${A}/${U}`), 'AccountsWithBalance');
      const data = body.outstandingBalanceList.activeOutstandingBalancesData;
      return {
         row: data.activeOutstandingBalances.find(c => c.customer_id === customerId) || null,
         gridRow: data.grid.rows.find(r => r.customer_id === customerId) || null
      };
   };

   // ── fixture ────────────────────────────────────────────────────────────────
   before(async function () {
      db = await requireDb.call(this);
      app.set('db', db);
      token = jwt.sign({ user_id: U }, config.JWT_SECRET, { subject: ADMIN_EMAIL, expiresIn: '2h', algorithm: 'HS256' });

      // accountService.getAccount INNER JOINs account_information and the seed
      // has no row for 9001 — the finalize path needs one.
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
      // The PDF template dereferences the account statement texts; the seed
      // leaves them NULL. Patch for this run, restore in `after`.
      const account = await db('accounts').where({ account_id: A }).first();
      const patch = {};
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
         await require('./_sent-fixture').unseal(db,A,createdCustomerIds);
         for (const id of createdCustomerIds) {
            const where = { account_id: A, customer_id: id };
            const myTxnIds = await db('customer_transactions').where(where).pluck('transaction_id');
            if (myTxnIds.length) await db('ai_category_training_examples').whereIn('transaction_id', myTxnIds).del().catch(() => {});
            (await db('customer_invoices').where(where).whereNotNull('invoice_file_location').pluck('invoice_file_location')).forEach(key => s3Keys.push(key));
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
      for (const key of new Set(s3Keys)) {
         await deleteObject(key).catch(() => {});
      }
      if (db && createdAccountInfoId) await db('account_information').where({ account_info_id: createdAccountInfoId, account_id: A }).del();
      if (db && accountColumnsToRestore) await db('accounts').where({ account_id: A }).update(accountColumnsToRestore);
      await closeDb();
   });

   // ── 1. decimals survive finalize ───────────────────────────────────────────
   it('1a. sets up four customers and month-1 work including a quarter-hour row and a pre-statement job write-off', async () => {
      main = await createCustomerWithJob('main');
      peer = await createCustomerWithJob('peer');
      empty = await createCustomerWithJob('empty');
      rerun = await createCustomerWithJob('rerun');

      await createTransaction('quarter', main, QUARTER_HOUR);
      await createTransaction('hour', main, FULL_HOUR);
      await createTransaction('nonBillable', main, NON_BILLABLE);
      await createTransaction('rerunCharge', rerun, { transactionType: 'Charge', quantity: 1, unitCost: RERUN_CHARGE, billable: true, date: daysAgo(3), desc: 'Filing fee' });

      // The form always stores a string in `note` ('' here); rows that arrive
      // through the tracker-ingest path carry NULL. Give the quarter-hour row a
      // NULL note so the statement run is proven to leave NULL alone.
      await db('customer_transactions').where({ transaction_id: txnIds.quarter, account_id: A }).update({ note: null });
      const quarter = await db('customer_transactions').where({ transaction_id: txnIds.quarter }).first();
      expect(num(quarter.quantity)).to.equal(0.25);
      expect(num(quarter.total_transaction)).to.equal(18.75);
      expect(quarter.note).to.equal(null);

      // Job-level write-off entered BEFORE any statement: nets against the job on
      // the first bill and must NOT count as a pending write-off afterwards.
      expectOk(await post(`/writeOffs/createWriteOffs/${A}/${U}`, { writeOff: writeOffPayload(main.customerId, { selectedJobID: main.jobId, unitCost: JOB_WRITEOFF_BEFORE, selectedDate: daysAgo(MONTH_GAP_DAYS + 2), writeOffReason: 'Scope adjustment', writeoffReason: 'Scope adjustment' }) }), 'createWriteOffs (job, pre-statement)');
      const writeoffs = await db('customer_writeoffs').where({ account_id: A, customer_id: main.customerId });
      expect(writeoffs).to.have.lengthOf(1);
      expect(writeoffs[0].customer_job_id).to.equal(main.jobId);
      expect(writeoffs[0].customer_invoice_id).to.equal(null);

      // Eligibility before any statement: unbilled work, not billed today, and
      // the pre-statement write-off is pending (no statement exists yet).
      const { row } = await accountsWithBalanceRow(main.customerId);
      expect(row, 'main is eligible').to.exist;
      expect(row.billed_today).to.equal(false);
      expect(row.last_invoice_number).to.equal(null);
      expect(row.last_invoice_date).to.equal(null);
      expect(row.transaction_count).to.equal(3);
      expect(row.write_off_count).to.equal(1);
      expect(money(row.billable_transactions_total)).to.equal(118.75);
      expect(money(row.invoice_total), 'engine nets the job write-off').to.equal(M1_CHARGES);

      mainRowsBeforeFinalize = await txnsFor(main.customerId);
      expect(mainRowsBeforeFinalize).to.have.lengthOf(3);
   });

   it('1b. month-1 finalize stamps only customer_invoice_id — 0.25 h / $18.75 / NULL note survive', async () => {
      const body = await finalize('Month 1', [main.customerId]);
      s3Keys.push(body.fileLocation);
      expect(body.message).to.equal('Finalized 1 invoice(s).');
      expect(body.skippedCustomers).to.deep.equal([]);
      expect(body.invoicesWithDetail).to.have.lengthOf(1);
      expect(money(body.invoicesWithDetail[0].transactions.transactionsTotal)).to.equal(M1_CHARGES);
      expect(money(body.invoicesWithDetail[0].invoiceTotal)).to.equal(M1_CHARGES);

      const parents = await parentsFor(main.customerId);
      expect(parents).to.have.lengthOf(1);
      [inv1] = parents;
      expect(inv1.invoice_number).to.match(INVOICE_NUMBER_RE);
      expect(num(inv1.beginning_balance)).to.equal(0);
      expect(num(inv1.total_charges), 'charges = Σ billable − job write-off').to.equal(M1_CHARGES);
      expect(num(inv1.total_amount_due)).to.equal(M1_CHARGES);
      expect(num(inv1.remaining_balance_on_invoice)).to.equal(M1_CHARGES);
      expect(inv1.is_invoice_paid_in_full).to.equal(false);
      expect(inv1.fully_paid_date).to.equal(null);
      expect(ymdLocal(inv1.invoice_date)).to.equal(today());
      expect(ymdLocal(inv1.start_date), 'first statement: period starts today').to.equal(today());
      expect(ymdLocal(inv1.end_date)).to.equal(today());
      expect(inv1.notes).to.equal(null);

      // Every transaction row is byte-for-byte what it was, except the linkage.
      const after = await txnsFor(main.customerId);
      const expected = mainRowsBeforeFinalize.map(row => ({ ...row, customer_invoice_id: inv1.customer_invoice_id }));
      expect(after, 'rows unchanged except customer_invoice_id').to.deep.equal(expected);

      const quarter = after.find(r => r.transaction_id === txnIds.quarter);
      expect(num(quarter.quantity)).to.equal(0.25);
      expect(num(quarter.unit_cost)).to.equal(75);
      expect(num(quarter.total_transaction)).to.equal(18.75);
      expect(quarter.note).to.equal(null);
      expect(quarter.customer_invoice_id).to.equal(inv1.customer_invoice_id);
      const nonBillable = after.find(r => r.transaction_id === txnIds.nonBillable);
      expect(nonBillable.customer_invoice_id, 'non-billable work is listed on (stamped with) the statement').to.equal(inv1.customer_invoice_id);
   });

   // ── 6. AccountsWithBalance: billed_today + write_off_count ────────────────
   it('6. AccountsWithBalance flags billed_today and counts only write-offs entered after the newest statement', async () => {
      const first = await accountsWithBalanceRow(main.customerId);
      expect(first.row, 'main still listed (open balance)').to.exist;
      expect(first.row.billed_today).to.equal(true);
      expect(first.row.last_invoice_number).to.equal(inv1.invoice_number);
      expect(first.row.last_invoice_date).to.equal(today());
      expect(first.row.write_off_count, 'pre-statement write-off no longer pending').to.equal(0);
      expect(first.row.transaction_count).to.equal(0);
      expect(money(first.row.billable_transactions_total)).to.equal(0);
      expect(first.row.invoice_count).to.equal(1);
      expect(money(first.row.outstanding_invoice_total)).to.equal(M1_CHARGES);
      expect(money(first.row.invoice_total)).to.equal(M1_CHARGES);
      expect(first.gridRow, 'grid row present').to.exist;
      expect(first.gridRow.billed_today).to.equal(true);
      expect(first.gridRow.last_invoice_number).to.equal(inv1.invoice_number);

      // A write-off entered AFTER the statement is pending for the next one.
      expectOk(await post(`/writeOffs/createWriteOffs/${A}/${U}`, { writeOff: writeOffPayload(main.customerId, { selectedJobID: main.jobId, unitCost: JOB_WRITEOFF_AFTER, selectedDate: daysAgo(0), writeOffReason: 'Post-statement adjustment', writeoffReason: 'Post-statement adjustment' }) }), 'createWriteOffs (job, post-statement)');
      const second = await accountsWithBalanceRow(main.customerId);
      expect(second.row.write_off_count).to.equal(1);
      expect(second.row.billed_today).to.equal(true);

      // The rerun customer has unbilled work and no statement yet.
      const rerunRow = (await accountsWithBalanceRow(rerun.customerId)).row;
      expect(rerunRow).to.exist;
      expect(rerunRow.billed_today).to.equal(false);
      expect(money(rerunRow.billable_transactions_total)).to.equal(RERUN_CHARGE);
   });

   // ── 4a + 5. default same-day guard, mixed batch, numbering ────────────────
   it('4a/5. a same-day re-run is skipped by default, the rest of the batch finalizes, and a non-conforming invoice_number is ignored', async () => {
      // Non-conforming legacy/test row on the peer customer — the numbering
      // query must skip it instead of throwing "Invalid invoiceNumber format".
      await db('customer_invoices').insert({
         account_id: A,
         customer_id: peer.customerId,
         customer_info_id: peer.customerInfoId,
         invoice_number: 'TEST-XYZ-1',
         invoice_date: daysAgo(400),
         due_date: daysAgo(384),
         beginning_balance: 0,
         total_payments: 0,
         total_charges: 0,
         total_write_offs: 0,
         total_retainers: 0,
         total_amount_due: 0,
         remaining_balance_on_invoice: 0,
         is_invoice_paid_in_full: true,
         fully_paid_date: daysAgo(384),
         created_by_user_id: U
      });
      const expectedNumber = await nextConformingNumber();
      expect(expectedNumber, 'sequence continues from the conforming maximum').to.not.equal(inv1.invoice_number);

      const body = await finalize('Mixed batch', [main.customerId, rerun.customerId]);
      s3Keys.push(body.fileLocation);
      expect(body.message).to.equal('Finalized 1 invoice(s). Skipped 1 customer(s) (see details).');
      expect(body.skippedCustomers).to.have.lengthOf(1);
      expect(body.skippedCustomers[0].customer_id).to.equal(main.customerId);
      expect(body.skippedCustomers[0].invoice_number).to.equal(inv1.invoice_number);
      expect(body.skippedCustomers[0].reason).to.include(`Already finalized today as ${inv1.invoice_number}`);
      expect(body.invoicesWithDetail).to.have.lengthOf(1);
      expect(body.invoicesWithDetail[0].customer_id).to.equal(rerun.customerId);
      expect(body.invoicesWithDetail[0].invoiceNumber).to.equal(expectedNumber);

      // main untouched by the skip
      expect(await parentsFor(main.customerId)).to.have.lengthOf(1);
      inv1 = await invoiceRow(inv1.customer_invoice_id);
      expect(num(inv1.remaining_balance_on_invoice)).to.equal(M1_CHARGES);
      expect(inv1.notes).to.equal(null);

      // rerun got its first statement with the next conforming number
      const rerunParents = await parentsFor(rerun.customerId);
      expect(rerunParents).to.have.lengthOf(1);
      [rerunParent1] = rerunParents;
      expect(rerunParent1.invoice_number).to.equal(expectedNumber);
      expect(rerunParent1.invoice_number).to.match(INVOICE_NUMBER_RE);
      expect(num(rerunParent1.total_charges)).to.equal(RERUN_CHARGE);
      expect(num(rerunParent1.remaining_balance_on_invoice)).to.equal(RERUN_CHARGE);
      const rerunTxn = (await txnsFor(rerun.customerId))[0];
      expect(rerunTxn.customer_invoice_id).to.equal(rerunParent1.customer_invoice_id);

      // A full same-day re-run creates nothing and says so.
      const skippedOnly = await finalize('Same day again', [main.customerId, rerun.customerId]);
      expect(skippedOnly.message).to.equal('No invoices created — 2 customer(s) skipped (see details).');
      expect(skippedOnly.invoicesWithDetail).to.deep.equal([]);
      expect(skippedOnly.fileLocation).to.equal('');
      expect(skippedOnly.skippedCustomers.map(s => s.customer_id).sort()).to.deep.equal([main.customerId, rerun.customerId].sort());
      expect(await parentsFor(main.customerId)).to.have.lengthOf(1);
      expect(await parentsFor(rerun.customerId)).to.have.lengthOf(1);
   });

   // ── 4b. allowSameDayRebill absorbs today's statement ──────────────────────
   it('4b. allowSameDayRebill creates a second parent that absorbs the first by chain identity, and every view reports the balance once', async () => {
      const expectedNumber = await nextConformingNumber();
      const body = await finalize('Same-day re-bill', [rerun.customerId], { allowSameDayRebill: true });
      s3Keys.push(body.fileLocation);
      expect(body.message).to.equal('Finalized 1 invoice(s).');
      expect(body.skippedCustomers).to.deep.equal([]);
      expect(money(body.invoicesWithDetail[0].outstandingInvoices.outstandingInvoiceTotal)).to.equal(RERUN_CHARGE);
      expect(money(body.invoicesWithDetail[0].transactions.transactionsTotal)).to.equal(0);

      const parents = await parentsFor(rerun.customerId);
      expect(parents).to.have.lengthOf(2);
      rerunParent2 = parents[1];
      expect(rerunParent2.invoice_number).to.equal(expectedNumber);
      expect(num(rerunParent2.beginning_balance), 'beginning_balance = first statement remaining').to.equal(RERUN_CHARGE);
      expect(num(rerunParent2.total_charges)).to.equal(0);
      expect(num(rerunParent2.total_amount_due)).to.equal(RERUN_CHARGE);
      expect(num(rerunParent2.remaining_balance_on_invoice)).to.equal(RERUN_CHARGE);
      expect(rerunParent2.is_invoice_paid_in_full).to.equal(false);
      expect(ymdLocal(rerunParent2.invoice_date)).to.equal(today());
      expect(rerunParent2.notes).to.equal(null);

      rerunParent1 = await invoiceRow(rerunParent1.customer_invoice_id);
      expect(num(rerunParent1.remaining_balance_on_invoice), 'issued parent unchanged').to.equal(RERUN_CHARGE);
      expect(rerunParent1.notes).to.equal(null);
      const closing = (await childrenOf(rerunParent1.customer_invoice_id)).at(-1);
      expect(num(closing.remaining_balance_on_invoice)).to.equal(0);
      expect(closing.notes).to.include(`[absorbed_by:${rerunParent2.invoice_number}@`);
      expect(num(rerunParent1.total_charges), 'historic totals untouched').to.equal(RERUN_CHARGE);

      // The transaction stays on the statement that billed it.
      const rerunTxn = (await txnsFor(rerun.customerId))[0];
      expect(rerunTxn.customer_invoice_id).to.equal(rerunParent1.customer_invoice_id);

      const { engine, audit } = await expectThreeViewsAgree(rerun.customerId, RERUN_CHARGE, 'after same-day re-bill');
      expect(engine.invoiceTotal, 'nothing new to bill beyond the rolled balance').to.equal(RERUN_CHARGE);
      expect(audit.discrepancies.filter(d => d.kind === 'stale_rolled_forward_balance')).to.have.lengthOf(0);
      expect(audit.invoice_breakdown.find(r => r.invoice_number === rerunParent1.invoice_number).was_absorbed).to.equal(true);
   });

   // Regression guard: the audit used to list the deliberately absorbed same-day
   // statement (remaining 0, '[absorbed_by:…]') as a medium-severity
   // 'duplicate_same_day_parent_invoices' ("If these are duplicates, delete the
   // extras") — observed 2026-09-22 before account-audit-logic.js excluded absorbed
   // chains from the duplicate check.
   it('4b-ii. …and the audit does not report the absorbed same-day statement as a live duplicate', async () => {
      const audit = await auditFor(rerun.customerId);
      const dupes = audit.discrepancies.filter(d => d.kind === 'duplicate_same_day_parent_invoices');
      expect(dupes, JSON.stringify(dupes)).to.have.lengthOf(0);
   });

   // DEFECT (regression, invoice-service.js edit of 2026-09-22 23:11):
   // invoiceService.zeroOutAbsorbedInvoices now builds the marker as
   // `[absorbed_by:${invoice_number}@${String(invoice_date).slice(0, 10)}]`, but the
   // `newParent` it receives is the row returned by createInvoice(...).returning('*'),
   // whose invoice_date is a JS Date — String(Date) is 'Tue Sep 22 2026 00:00:00 …',
   // so the stamped marker reads '[absorbed_by:INV-2026-00003@Tue Sep 22]'.
   // Expected the documented '@YYYY-MM-DD' (e.g. '@2026-09-22'). The prefix
   // still matches countRowsAbsorbedBy / the audit's was_absorbed regex, so only
   // the human-readable date is wrong.
   it('4b-iii. …and the absorbed marker carries the statement date as YYYY-MM-DD', async () => {
      const absorbed = (await childrenOf(rerunParent1.customer_invoice_id)).at(-1);
      expect(absorbed.notes).to.include(`[absorbed_by:${rerunParent2.invoice_number}@${ymdLocal(rerunParent2.invoice_date)}]`);
   });

   // ── 2a. deleteInvoice: rolled parent ──────────────────────────────────────
   it('2a. deleteInvoice refuses a parent that rolled a prior balance into its beginning_balance', async () => {
      const body = expectRefused(await del(`/invoices/deleteInvoice/${A}/${rerunParent2.customer_invoice_id}`), 'deleteInvoice (rolled parent)');
      expect(body.message).to.include('locked: part of sent invoice');
      expect(body.message).to.include(rerunParent2.invoice_number);

      const still = await invoiceRow(rerunParent2.customer_invoice_id);
      expect(still, 'rolled parent still exists').to.exist;
      expect(num(still.remaining_balance_on_invoice)).to.equal(RERUN_CHARGE);
      expect(num((await invoiceRow(rerunParent1.customer_invoice_id)).remaining_balance_on_invoice), 'issued parent preserved').to.equal(RERUN_CHARGE);
      await expectThreeViewsAgree(rerun.customerId, RERUN_CHARGE, 'after refused delete');
   });

   // ── 3. getInvoiceDetails ──────────────────────────────────────────────────
   it('3a. getInvoiceDetails preserves issued items and exposes the current balance separately', async () => {
      // Time travel: month 1 becomes last month so a real month 2 can follow.
      // Everything that was on the ledger when that statement ran moves back
      // with it — the parent row AND the pre-statement job write-off (the engine
      // gates write-offs on created_at relative to the newest parent, so a
      // write-off left "after" the statement would legitimately be credited again).
      const shifted = await require('./_sent-fixture').fixtureMaintenance(db,A, async trx => { return await trx('customer_invoices')
         .where({ account_id: A, customer_id: main.customerId, customer_invoice_id: inv1.customer_invoice_id })
         .update({
            invoice_date: trx.raw(`invoice_date - ?::int`, [MONTH_GAP_DAYS]),
            due_date: trx.raw(`due_date - ?::int`, [MONTH_GAP_DAYS]),
            start_date: trx.raw(`start_date - ?::int`, [MONTH_GAP_DAYS]),
            end_date: trx.raw(`end_date - ?::int`, [MONTH_GAP_DAYS]),
            created_at: trx.raw(`created_at - (? || ' days')::interval`, [MONTH_GAP_DAYS])
         }); });
      expect(shifted).to.equal(1);
      inv1 = await invoiceRow(inv1.customer_invoice_id);
      const preStatementWriteOffs = await require('./_sent-fixture').fixtureMaintenance(db,A,async trx => { return await trx('customer_writeoffs')
         .where({ account_id: A, customer_id: main.customerId })
         .andWhere('writeoff_amount', -JOB_WRITEOFF_BEFORE)
         .update({ created_at: trx.raw(`created_at - (? || ' days')::interval`, [MONTH_GAP_DAYS + 1]) }); });
      expect(preStatementWriteOffs).to.equal(1);
      await require('./_sent-fixture').fixtureMaintenance(db,A, trx => trx('customer_transactions')
         .where({ account_id: A, customer_id: main.customerId, customer_invoice_id: inv1.customer_invoice_id })
         .update({ created_at: trx.raw(`created_at - (? || ' days')::interval`, [MONTH_GAP_DAYS + 1]) }));

      // Partial payment, then an invoice-level write-off, on month 1.
      const payBody = expectOk(await post(`/payments/createPayment/${A}/${U}`, { payment: paymentPayload(main.customerId, { selectedInvoiceID: inv1.customer_invoice_id, unitCost: PAYMENT_1, transactionDate: daysAgo(12) }) }), 'createPayment (month 1)');
      expect(payBody.message).to.equal('Successfully created payment.');
      expectOk(await post(`/writeOffs/createWriteOffs/${A}/${U}`, { writeOff: writeOffPayload(main.customerId, { customerInvoiceID: inv1.customer_invoice_id, unitCost: WRITEOFF_1, selectedDate: daysAgo(11) }) }), 'createWriteOffs (invoice, month 1)');

      const children = await childrenOf(inv1.customer_invoice_id);
      expect(children, 'payment snapshot + write-off snapshot').to.have.lengthOf(2);
      snapshot1Id = children[0].customer_invoice_id;
      expect(num(children[0].remaining_balance_on_invoice)).to.equal(M1_CHARGES - PAYMENT_1);
      expect(num(children[1].remaining_balance_on_invoice)).to.equal(M1_REMAINING);
      const payment = await db('customer_payments').where({ account_id: A, customer_id: main.customerId }).first();
      payment1Id = payment.payment_id;
      expect(payment.customer_invoice_id, 'payment tagged to its snapshot').to.equal(snapshot1Id);
      const invoiceWriteOff = await db('customer_writeoffs').where({ account_id: A, customer_id: main.customerId }).whereNotNull('customer_invoice_id').first();
      writeoff1Id = invoiceWriteOff.writeoff_id;
      expect(invoiceWriteOff.customer_invoice_id).to.equal(children[1].customer_invoice_id);
      inv1 = await invoiceRow(inv1.customer_invoice_id);
      expect(num(inv1.remaining_balance_on_invoice)).to.equal(M1_CHARGES);

      // Details for the PARENT: chain-wide payments / write-offs / transactions.
      const details = expectOk(await get(`/invoices/getInvoiceDetails/${inv1.customer_invoice_id}/${A}/${U}`), 'getInvoiceDetails (parent)');
      expect(details.invoiceDetails.customer_invoice_id).to.equal(inv1.customer_invoice_id);
      expect(num(details.invoiceDetails.remaining_balance_on_invoice), 'issued balance').to.equal(M1_CHARGES);
      expect(num(details.invoiceDetails.current_remaining_balance), 'latest snapshot').to.equal(M1_REMAINING);
      expect(details.invoicePaymentsData.invoicePayments).to.deep.equal([]);
      expect(details.invoiceWriteoffsData.invoiceWriteoffs.map(r => num(r.writeoff_amount))).to.deep.equal([-JOB_WRITEOFF_BEFORE]);
      expect(transactionIds(details.invoiceTransactionsData.invoiceTransactions).sort()).to.deep.equal([txnIds.quarter, txnIds.hour, txnIds.nonBillable].sort());
      expect(details.invoicePaymentsData.grid.rows).to.have.lengthOf(0);
      details.invoiceRetainersData.invoiceRetainers.forEach(r => expect(r.customer_id, 'only this customer\'s retainers').to.equal(main.customerId));

      // Details for a SNAPSHOT row resolve to the same chain.
      const snapDetails = expectOk(await get(`/invoices/getInvoiceDetails/${snapshot1Id}/${A}/${U}`), 'getInvoiceDetails (snapshot)');
      expect(snapDetails.invoiceDetails.parent_invoice_id).to.equal(inv1.customer_invoice_id);
      expect(snapDetails.invoicePaymentsData.invoicePayments).to.deep.equal([]);
      expect(snapDetails.invoiceWriteoffsData.invoiceWriteoffs.map(r => num(r.writeoff_amount))).to.deep.equal([-JOB_WRITEOFF_BEFORE]);

      await expectThreeViewsAgree(main.customerId, M1_REMAINING, 'after month-1 payment + write-off');
   });

   // Regression guard: getInvoiceDetails used to look the remaining up by the row
   // the user opened, so an intermediate snapshot reported its own stale value
   // (58.75 here) instead of the chain's latest (50) — observed 2026-09-22 before
   // invoice-router.js resolved the chain root first.
   it('3a-ii. getInvoiceDetails on a snapshot row reports the chain\'s latest remaining', async () => {
      const snapDetails = expectOk(await get(`/invoices/getInvoiceDetails/${snapshot1Id}/${A}/${U}`), 'getInvoiceDetails (snapshot)');
      expect(num(snapDetails.invoiceDetails.current_remaining_balance)).to.equal(M1_REMAINING);
   });

   it('3b. getInvoiceDetails lists only this customer\'s retainers for the statement window, and the month-2 chain\'s own payments', async () => {
      // Retainers for main and peer, established mid-cycle (created_at −20d) so
      // they fall inside month 2's statement window [month-1 date, today].
      for (const [target, amount, ref] of [[main, RETAINER_MAIN, '2001'], [peer, RETAINER_PEER, '2002']]) {
         const body = expectOk(
            await post(`/retainers/createRetainer/${A}/${U}`, {
               // Retainer balances are stored NEGATIVE (credit) — same convention as payments.
               retainer: { accountID: A, customerID: target.customerId, loggedByUserID: U, displayName: `Prepaid season ${target.name}`, typeOfHold: 'Retainer', unitCost: -amount, formOfPayment: 'Check', paymentReferenceNumber: ref, note: 'retainer' }
            }),
            `createRetainer (${target.name})`
         );
         const listed = body.accountRetainersList.activeRetainerData.activeRetainers.find(r => r.customer_id === target.customerId);
         expect(listed, `${target.name}: retainer listed`).to.exist;
         expect(num(listed.current_amount)).to.equal(-amount);
      }
      retainerMainId = (await retainersFor(main.customerId))[0].retainer_id;
      retainerPeerId = (await retainersFor(peer.customerId))[0].retainer_id;
      await db('customer_retainers_and_prepayments').whereIn('retainer_id', [retainerMainId, retainerPeerId]).update({ created_at: db.raw(`created_at - interval '20 days'`) });

      // Month 2 for main: new work, statement rolls the month-1 remaining.
      await createTransaction('m2', main, M2_WORK);
      const body = await finalize('Month 2', [main.customerId]);
      s3Keys.push(body.fileLocation);
      expect(body.message).to.equal('Finalized 1 invoice(s).');
      expect(money(body.invoicesWithDetail[0].transactions.transactionsTotal), 'post-statement job write-off nets against the new work').to.equal(M2_CHARGES);
      expect(money(body.invoicesWithDetail[0].outstandingInvoices.outstandingInvoiceTotal)).to.equal(M1_REMAINING);
      const parents = await parentsFor(main.customerId);
      expect(parents).to.have.lengthOf(2);
      inv2 = parents[1];
      expect(num(inv2.beginning_balance)).to.equal(M1_REMAINING);
      expect(num(inv2.total_charges)).to.equal(M2_CHARGES);
      expect(num(inv2.total_amount_due)).to.equal(M2_TOTAL);
      expect(num(inv2.remaining_balance_on_invoice)).to.equal(M2_TOTAL);
      expect(num(inv2.total_retainers), 'retainer balance is printed for information (negative net) and not subtracted from the amount due').to.equal(-RETAINER_MAIN);
      expect(ymdLocal(inv2.start_date)).to.equal(ymdLocal(inv1.invoice_date));
      expect(ymdLocal(inv2.end_date)).to.equal(today());
      // One closing snapshot absorbs the chain without rewriting issued evidence.
      const m1Rows = [await invoiceRow(inv1.customer_invoice_id), ...(await childrenOf(inv1.customer_invoice_id))];
      expect(m1Rows.map(row => num(row.remaining_balance_on_invoice))).to.deep.equal([M1_CHARGES, M1_CHARGES - PAYMENT_1, M1_REMAINING, 0]);
      expect(m1Rows[3].notes).to.include(`[absorbed_by:${inv2.invoice_number}@`);
      expect(m1Rows[0].notes).to.equal(null);
      const m2Txn = (await txnsFor(main.customerId)).find(t => t.transaction_id === txnIds.m2);
      expect(m2Txn.customer_invoice_id).to.equal(inv2.customer_invoice_id);

      // Issued month-2 detail contains exactly the work, receipts and credits printed at issuance.
      const details = expectOk(await get(`/invoices/getInvoiceDetails/${inv2.customer_invoice_id}/${A}/${U}`), 'getInvoiceDetails (month 2)');
      expect(retainerIds(details.invoiceRetainersData.invoiceRetainers), 'peer retainer (same window) is excluded').to.deep.equal([retainerMainId]);
      expect(details.invoiceRetainersData.invoiceRetainers[0].customer_id).to.equal(main.customerId);
      expect(transactionIds(details.invoiceTransactionsData.invoiceTransactions)).to.deep.equal([txnIds.m2]);
      expect(paymentIds(details.invoicePaymentsData.invoicePayments)).to.deep.equal([payment1Id]);
      expect(details.invoiceWriteoffsData.invoiceWriteoffs.map(r => num(r.writeoff_amount)).sort((a,b)=>a-b)).to.deep.equal([-WRITEOFF_1,-JOB_WRITEOFF_AFTER].sort((a,b)=>a-b));
      expect(num(details.invoiceDetails.remaining_balance_on_invoice)).to.equal(M2_TOTAL);

      // A payment on month 2 shows up on month 2's details — and not on month 1's.
      expectOk(await post(`/payments/createPayment/${A}/${U}`, { payment: paymentPayload(main.customerId, { selectedInvoiceID: inv2.customer_invoice_id, unitCost: PAYMENT_2, paymentReferenceNumber: '3002', transactionDate: daysAgo(0) }) }), 'createPayment (month 2)');
      payment2Id = (await db('customer_payments').where({ account_id: A, customer_id: main.customerId }).orderBy('payment_id', 'desc').first()).payment_id;
      const detailsAfter = expectOk(await get(`/invoices/getInvoiceDetails/${inv2.customer_invoice_id}/${A}/${U}`), 'getInvoiceDetails (month 2, after payment)');
      expect(paymentIds(detailsAfter.invoicePaymentsData.invoicePayments)).to.deep.equal([payment1Id]);
      expect(num(detailsAfter.invoiceDetails.remaining_balance_on_invoice)).to.equal(M2_TOTAL);
      expect(num(detailsAfter.invoiceDetails.current_remaining_balance)).to.equal(M2_TOTAL - PAYMENT_2);
      const m1Details = expectOk(await get(`/invoices/getInvoiceDetails/${inv1.customer_invoice_id}/${A}/${U}`), 'getInvoiceDetails (month 1, after month 2)');
      expect(m1Details.invoicePaymentsData.invoicePayments).to.deep.equal([]);
      expect(num(m1Details.invoiceDetails.current_remaining_balance)).to.equal(0);

      // Engine after month 2: the bill-day write-off is not re-credited and the
      // three views agree on the new remaining.
      const { engine } = await expectThreeViewsAgree(main.customerId, M2_TOTAL - PAYMENT_2, 'after month-2 payment');
      expect(engine.writeOffTotal, 'month-1 write-off not credited again').to.equal(0);
      expect(engine.transactionsTotal).to.equal(0);
      expect(engine.invoiceTotal).to.equal(M2_TOTAL - PAYMENT_2);
   });

   it('3c. the audit balance agrees with the engine total after a bill-day write-off', async () => {
      const [engine, audit] = await Promise.all([engineFor(main.customerId), auditFor(main.customerId)]);
      expect(money(audit.totals.outstanding_invoices)).to.equal(engine.outstandingInvoiceTotal);
      expect(money(audit.totals.audit_balance), 'audit_balance must match what the app would bill next').to.equal(engine.invoiceTotal);
   });

   // ── 2b. deleteInvoice: snapshot row ───────────────────────────────────────
   it('2b. deleteInvoice refuses a payment snapshot row', async () => {
      const body = expectRefused(await del(`/invoices/deleteInvoice/${A}/${snapshot1Id}`), 'deleteInvoice (snapshot)');
      expect(body.message).to.be.a('string').and.not.equal('');
      expect(await invoiceRow(snapshot1Id), 'snapshot still exists').to.exist;
      expect((await db('customer_payments').where({ payment_id: payment1Id }).first()).customer_invoice_id, 'payment linkage intact').to.equal(snapshot1Id);
   });

   // DEFECT (guard order): invoice-router deleteInvoice
   // (src/endpoints/invoice/invoice-router.js:58-64) checks for rows linked to the
   // target id BEFORE it looks at the row type (line 70-77). A payment snapshot
   // always has its payment tagged to it, so the generic "Cannot delete invoice
   // with transactions, retainers, payments, or writeoffs." fires and the
   // specific guidance "This row is a payment/write-off snapshot. Delete or
   // reverse the payment or write-off instead." is unreachable for real
   // snapshots. Observed message: 'Cannot delete invoice with transactions,
   // retainers, payments, or writeoffs.'; expected a message containing
   // 'snapshot'. The refusal itself is correct (see 2b).
   it('2b-ii. …and identifies the sent statement lock', async () => {
      const body = expectRefused(await del(`/invoices/deleteInvoice/${A}/${snapshot1Id}`), 'deleteInvoice (snapshot)');
      expect(body.message).to.include('locked: part of sent invoice');
   });

   // ── 2c. deleteInvoice: fresh zero-history parent ──────────────────────────
   it('2c. an issued zero-history parent with no stamped rows is still locked', async () => {
      const expectedNumber = await nextConformingNumber();
      const body = await finalize('Zero activity', [empty.customerId]);
      s3Keys.push(body.fileLocation);
      expect(body.message).to.equal('Finalized 1 invoice(s).');
      expect(money(body.invoicesWithDetail[0].invoiceTotal)).to.equal(0);

      const parents = await parentsFor(empty.customerId);
      expect(parents).to.have.lengthOf(1);
      const [zero] = parents;
      s3Keys.push(zero.invoice_file_location);
      expect(zero.invoice_number).to.equal(expectedNumber);
      expect(num(zero.beginning_balance)).to.equal(0);
      expect(num(zero.total_charges)).to.equal(0);
      expect(num(zero.total_amount_due)).to.equal(0);
      expect(num(zero.remaining_balance_on_invoice)).to.equal(0);
      expect(zero.is_invoice_paid_in_full, 'a $0 statement is born settled').to.equal(true);
      expect(ymdLocal(zero.fully_paid_date)).to.equal(today());
      expect(await txnsFor(empty.customerId)).to.have.lengthOf(0);
      expect(await childrenOf(zero.customer_invoice_id)).to.have.lengthOf(0);
      expect(await db('customer_invoices').where({ account_id: A, customer_id: empty.customerId }).whereNotNull('notes')).to.have.lengthOf(0);

      const refused = expectRefused(await del(`/invoices/deleteInvoice/${A}/${zero.customer_invoice_id}`), 'deleteInvoice (issued zero parent)');
      expect(refused.message).to.include('locked: part of sent invoice');
      expect(await invoiceRow(zero.customer_invoice_id)).to.deep.equal(zero);
      expect(await parentsFor(empty.customerId)).to.have.lengthOf(1);
      expect(await arRowFor(empty.customerId)).to.equal(null);
   });
});
