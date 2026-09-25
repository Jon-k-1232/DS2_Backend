/**
 * END-TO-END: the time-tracker Excel pipeline, driven through the real Express
 * app wherever a route exists.
 *
 *   (1) GET  /time-tracking/template/latest      — the REAL template (MinIO tracker_versions/)
 *   (2) fill THAT downloaded workbook for Eliza Smith (test/fixtures/buildTrackerFromTemplate.js)
 *   (3) POST /time-tracking/upload               — admin uploads on Eliza's behalf (raw body + x-file-name)
 *   (4) identical re-upload -> 409; cumulative re-upload -> only the new row
 *   (5) processEntries (the auto-ingest orchestrator) with stubbed Bedrock + Comprehend
 *   (6) POST /invoices/createInvoice (finalize) -> GET /invoices/downloadFile zip -> pdftotext
 *       -> the statement figures, and billing engine / Account Audit / AR agree
 *   (7) POST /timesheets/moveToTransactions      — legacy manual apply of a HELD row
 *   (8) DELETE /timesheets/deleteTimesheetEntry  — unprocessed vs processed entry
 *   + upload validation / authorization cases.
 *
 *   DS2_ENV_FILE=.env.local npx mocha --require test/setup.js \
 *     test/integration/tracker-excel-end-to-end.integration.spec.js --exit --timeout 180000
 *
 * Fixture account 9001 (test/fixtures/seed.sql): Eliza Smith 90011 ($75/h),
 * Bob Jones 90012, admin 90013. The spec creates its OWN billed customers
 * (Alpha / Beta, unique names) plus a customer named exactly like the firm's
 * entity ('James F. Kimmel & Associates', registered through
 * INTERNAL_CUSTOMER_IDS for the run) and two duplicate records of one
 * individual ('Ambler-XXXXX, Pat' / 'Ambler-XXXXX Pat') for the ambiguous hold.
 * The fixture individual 'Smith, John' (900103) is matched by First/Last Name;
 * its one auto-inserted transaction (and the rolling child job row) is removed
 * in `after`, and it is never invoiced because other suites share it.
 *
 * Why not 'J. Smith' vs the fixture Smiths for the ambiguous line: the fuzzy
 * scorer is catalog-order dependent (see the DEFECT test in the orchestrator
 * block), so that line flips between an ambiguous hold and a Bedrock tie-break.
 *
 * The tracker week is last Mon–Fri (relative to the run date), so every date is
 * inside the upload window; the "current" tax year is that week's year - 1
 * (the orchestrator's rule), and the year-bearing job type is created for it.
 *
 * No AWS is ever reached: Bedrock + Comprehend are replaced by the shared
 * stubs (installStubbedAws), and SES (the "tracker ready for billing" email the
 * upload route sends) is stubbed on SESClient.prototype.send and captured.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const XLSX = require('xlsx');
const dayjs = require('dayjs');
const unzipper = require('unzipper');
const { expect } = require('chai');
const { SESClient } = require('@aws-sdk/client-ses');
const { bootHttp, expectEnvelopeOk } = require('./_http');
const { buildTrackerFromTemplate, readTrackerRows, HEADERS } = require('../fixtures/buildTrackerFromTemplate');
const { installStubbedAws, installFailClosedAws, SEED_GWD_ID } = require('../fixtures/integrationHelpers');
const { processEntries, HOLD_REASONS, _computeTimeAmounts } = require('../../src/endpoints/timesheets/auto-ingest-orchestrator');
const { getObject, deleteObject, listObjects } = require('../../src/utils/s3');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const { auditCustomerLedger } = require('../../src/endpoints/accountAudit/account-audit-logic');
const accountAuditService = require('../../src/endpoints/accountAudit/account-audit-service');
const accountsReceivableService = require('../../src/endpoints/accountsReceivable/accounts-receivable-service');
const { getCurrentChainTargets } = require('../../src/endpoints/payments/payment-logic');
const { scoreCandidates } = require('../../src/utils/fuzzyMatch');
const timesheetsService = require('../../src/endpoints/timesheets/timesheets-service');

const A = 9001;
const ADMIN = 90013;
const ELIZA = 90011;
const BOB = 90012;
const INACTIVE_USER = 90014;
// The tracker_versions/<latest> S3 object is a single firm-wide key with no
// per-object owner recorded; timeTracking-router.js treats account 1 as its
// owner (the key lives under its slug) and only ever passes its raw bytes
// through to THAT account — every other account gets a rebuild instead. Used
// only to fetch the REAL byte-for-byte template in step (1) below (read-only
// against the account-1 production copy); the rest of this file's pipeline
// still runs entirely as account 9001.
const FOREIGN_ACCOUNT = 1;
const SUPER_ADMIN = 21;
const RATE = 75; // Eliza's billing_rate
const JOHN_SMITH = 900103;
const JOHN_SMITH_JOB = 9001003; // '1040 Individual Return' (year-less)
const JOB_TYPE_GENERAL_CONSULTING = 900204; // 'General Consulting' (year-less)
const CATEGORY_TAX_COMPLIANCE = 90001;
const ENTITY_JKA = 'James F. Kimmel & Associates';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TRACKER_VERSIONS_ROOT = 'James_F__Kimmel___Associates/time_tracking/tracker_versions';
// Account-AND-OWNER-scoped processed prefix (timeTracking-router.js
// buildProcessedPrefixes, C6): processed/<account_name_slug>_<accountID>/user_<ownerId>/
// — keyed by immutable numeric user id, never by name (two same-named
// employees in one account used to share the name-keyed folder this replaced;
// see the C6 same-named-employee-isolation coverage in
// coverage-timetracking-timesheets.integration.spec.js). account 9001's
// account_name is 'TEST FIXTURE ACCOUNT' (test/fixtures/seed.sql) -> sanitizeSegment
// -> 'TEST_FIXTURE_ACCOUNT_9001'.
const PROCESSED_PREFIX_ELIZA = `James_F__Kimmel___Associates/time_tracking/processed/TEST_FIXTURE_ACCOUNT_9001/user_${ELIZA}/`;
const PDFTOTEXT = process.env.PDFTOTEXT_BIN || '/opt/homebrew/bin/pdftotext';
const INVOICE_NUMBER_RE = /^INV-\d{4}-\d{5}$/;

// ── dates: last Mon–Fri, all in one calendar year ────────────────────────────
const TODAY = dayjs().startOf('day');
let WEEK_MONDAY = TODAY.subtract((TODAY.day() + 6) % 7, 'day').subtract(7, 'day');
if (WEEK_MONDAY.year() !== WEEK_MONDAY.add(4, 'day').year()) WEEK_MONDAY = WEEK_MONDAY.subtract(7, 'day');
const DAY = i => WEEK_MONDAY.add(i, 'day').format('YYYY-MM-DD');
const WEEK_START = DAY(0);
const WEEK_END = DAY(4);
const TAX_YEAR = WEEK_MONDAY.year() - 1; // orchestrator: transaction year - 1
const YEAR_WITHOUT_JOB = TAX_YEAR - 3;
const YEAR_JOB_DESCRIPTION = `${TAX_YEAR} Corporate Tax Return`;

// ── naming (unique per run; digits never form a 20xx token) ──────────────────
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, d => 'abcdefghij'[Number(d)]).toUpperCase();
const ALPHA_NAME = `Tracker E2E Alpha ${RUN}`;
const BETA_NAME = `Tracker E2E Beta ${RUN}`;
const INTERNAL_NAME = ENTITY_JKA; // the firm's own entity, exactly as staff type it in Company Name
// Two records for the SAME individual (typed with and without the comma). The
// tracker names her 'Pat Ambler-XXXX': no exact display-name match, two
// canonical matches -> needs_review (deterministic; no fuzzy scoring involved).
const AMBLER_LAST = `Ambler-${RUN.slice(0, 5)}`;
const AMBLER_RECORD_1 = `${AMBLER_LAST}, Pat`;
const AMBLER_RECORD_2 = `${AMBLER_LAST} Pat`;

// ── helpers ──────────────────────────────────────────────────────────────────
const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const fmt = n => Number(n).toFixed(2);
const ymd = d => (d == null ? null : dayjs(d).format('YYYY-MM-DD'));
const flat = text => text.replace(/\s+/g, ' ');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Expected Time amounts computed independently of the product: the firm bills
// in 6-minute increments, ROUNDED UP (0.1h units) — quantity =
// ceil(minutes / 6) / 10 hours, total from the SAME rounded hours (integer
// cents). Matches src/endpoints/timesheets/auto-ingest-orchestrator.js
// _computeTimeAmounts and the frontend's TimeTrackingIncrements.js.
const expectedAmounts = minutes => {
   const tenths = Math.ceil(minutes / 6);
   return { quantity: tenths / 10, unitCost: RATE, total: Math.round((tenths * 10 * RATE * 100) / 100) / 100 };
};
const binaryParser = (res, cb) => {
   const chunks = [];
   res.on('data', chunk => chunks.push(Buffer.from(chunk)));
   res.on('end', () => cb(null, Buffer.concat(chunks)));
};

// Rewrite cells of an already-built tracker (the builder always writes the
// canonical headers and numeric durations).
const patchTrackerCells = (buffer, patches) => {
   const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
   const ws = wb.Sheets.Time;
   Object.entries(patches).forEach(([addr, value]) => {
      ws[addr] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) };
   });
   return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

// SES is the only AWS client the upload route reaches directly; replace its send().
const sesSends = [];
const stubSes = () => {
   const own = Object.prototype.hasOwnProperty.call(SESClient.prototype, 'send');
   const original = SESClient.prototype.send;
   SESClient.prototype.send = async function stubbedSesSend(command) {
      sesSends.push(command.input);
      return { MessageId: `stub-${sesSends.length}` };
   };
   return () => {
      if (own) SESClient.prototype.send = original;
      else delete SESClient.prototype.send;
   };
};

const setEnv = vars => {
   const previous = {};
   Object.entries(vars).forEach(([key, value]) => {
      previous[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
   });
   return () =>
      Object.entries(previous).forEach(([key, value]) => {
         if (value === undefined) delete process.env[key];
         else process.env[key] = value;
      });
};

// ── the tracker (12 lines; the Lunch line is dropped at upload) ──────────────
// expect: { customer: 'alpha'|'beta'|'john'|'internal', job: 'A1'|'A2'|'B1'|'JOHN'|'I1',
//           billable, quantity, total } | { hold } | 'dropped'
const REF = RUN.slice(0, 6); // keeps the individual rows unique per run
// expect.quantity/total below are hand-computed per the C1 six-minute-ceiling
// rule (quantity = ceil(minutes / 6) / 10 hours, total = round2(quantity ×
// $75)), independently of expectedAmounts()/product code — see the arithmetic
// comment on each row.
const ROWS = [
   { key: 'alphaWorkpapers', day: 0, category: 'Tax Return Preparation', company: ALPHA_NAME, duration: 45, timeRange: '0800-0845', notes: 'Prepared corporate return workpapers and trial balance tie-out', expect: { customer: 'alpha', job: 'A1', billable: true, quantity: 0.8, total: 60 } }, // ceil(45/6)=8 -> 0.8h; 0.8 × 75 = 60.00
   { key: 'betaCall', day: 0, category: 'Phone Call', company: BETA_NAME, duration: 20, timeRange: '0900-0920', notes: 'Call with the controller about estimated payments', expect: { customer: 'beta', job: 'B1', billable: true, quantity: 0.4, total: 30 } }, // ceil(20/6)=4 -> 0.4h; 0.4 × 75 = 30.00
   { key: 'alphaFinalize', day: 1, category: 'Tax Return Preparation', company: ALPHA_NAME, duration: 205, timeRange: '0800-1125', notes: `Finalized the ${TAX_YEAR} Form 1120 corporate return for e-file`, expect: { customer: 'alpha', job: 'A1', billable: true, quantity: 3.5, total: 262.5 } }, // ceil(205/6)=ceil(34.167)=35 -> 3.5h; 3.5 × 75 = 262.50
   { key: 'johnSmith', day: 1, category: 'Phone Call', first: 'John', last: 'Smith', duration: 30, timeRange: '1300-1330', notes: `Answered W-2 withholding question (ref ${REF})`, expect: { customer: 'john', job: 'JOHN', billable: true, quantity: 0.5, total: 37.5 } }, // ceil(30/6)=5 -> 0.5h; 0.5 × 75 = 37.50 (30 is already a 6-min multiple)
   { key: 'alphaConsulting', day: 2, category: 'Client Meeting', company: ALPHA_NAME, duration: 50, timeRange: '0800-0850', notes: 'General consulting call on entity restructuring', expect: { customer: 'alpha', job: 'A2', billable: true, quantity: 0.9, total: 67.5 } }, // ceil(50/6)=ceil(8.333)=9 -> 0.9h; 0.9 × 75 = 67.50
   { key: 'internal', day: 2, category: 'Staff Meeting', company: INTERNAL_NAME, duration: 60, timeRange: '0900-1000', notes: 'Internal staff meeting on workflow', expect: { customer: 'internal', job: 'I1', billable: false, quantity: 1, total: 75 } }, // ceil(60/6)=10 -> 1.0h; 1.0 × 75 = 75.00 (non-billable; hours/value still recorded)
   { key: 'lunch', day: 2, category: 'Lunch', duration: 30, timeRange: '1200-1230', notes: 'Lunch', expect: 'dropped' },
   { key: 'betaMissingYear', day: 2, category: 'Tax Notice', company: BETA_NAME, duration: 45, timeRange: '1300-1345', notes: `Reviewed the ${YEAR_WITHOUT_JOB} amended return notice`, expect: { hold: 'missing_current_year_job' } }, // held now; applied manually in step (7) at ceil(45/6)=8 -> 0.8h, $60.00 (same as alphaWorkpapers, also 45 min)
   { key: 'vacation', day: 3, category: 'Vacation', company: ALPHA_NAME, duration: 480, timeRange: '0800-1600', notes: 'Vacation day - approved PTO', expect: { customer: 'alpha', job: 'A2', billable: false, quantity: 8, total: 600 } }, // ceil(480/6)=80 -> 8.0h; 8.0 × 75 = 600.00 (non-billable; already a 6-min multiple)
   { key: 'betaFootnotes', day: 3, category: 'Tax Return Preparation', company: BETA_NAME, duration: 100, timeRange: '0800-0940', notes: 'Drafted corporate return footnotes', expect: { customer: 'beta', job: 'B1', billable: true, quantity: 1.7, total: 127.5 } }, // ceil(100/6)=ceil(16.667)=17 -> 1.7h; 1.7 × 75 = 127.50
   { key: 'alphaEmail', day: 4, category: 'Email', company: ALPHA_NAME, duration: 15, timeRange: '0800-0815', notes: 'Emailed client the corporate return extension confirmation', expect: { customer: 'alpha', job: 'A1', billable: true, quantity: 0.3, total: 22.5 } }, // ceil(15/6)=ceil(2.5)=3 -> 0.3h; 0.3 × 75 = 22.50
   { key: 'ambiguous', day: 4, category: 'Tax Return Preparation', first: 'Pat', last: AMBLER_LAST, duration: 45, timeRange: '0900-0945', notes: `Prepared the household return (ref ${REF})`, expect: { hold: 'ambiguous_customer_match' } }
];
// Added by the cumulative re-upload in step (4).
const NEW_ROW = { key: 'betaCopy', day: 4, category: 'Email', company: BETA_NAME, duration: 25, timeRange: '1000-1025', notes: 'Sent the signed corporate return copy to the controller', expect: { customer: 'beta', job: 'B1', billable: true, quantity: 0.5, total: 37.5 } }; // ceil(25/6)=ceil(4.167)=5 -> 0.5h; 0.5 × 75 = 37.50

const toBuilderRow = row => ({
   date: DAY(row.day),
   entity: ENTITY_JKA,
   category: row.category,
   companyName: row.company || '',
   firstName: row.first || '',
   lastName: row.last || '',
   duration: row.duration,
   timeRange: row.timeRange,
   notes: row.notes
});
const sheetRowOf = key => 6 + ROWS.findIndex(r => r.key === key);
const INSERTED_ROWS = ROWS.filter(r => r.expect !== 'dropped');
const ALL_INGESTED = [...INSERTED_ROWS, NEW_ROW];

// Hand-computed statement figures (the product is never consulted for these).
// Job A1: alphaWorkpapers 60.00 + alphaFinalize 262.50 + alphaEmail 22.50.
const ALPHA_A1_TOTAL = 60 + 262.5 + 22.5; // 345.00
const ALPHA_A2_TOTAL = 67.5; // alphaConsulting only; + 600.00 vacation, NOT billable
const ALPHA_TOTAL = ALPHA_A1_TOTAL + ALPHA_A2_TOTAL; // 412.50
// Job B1: betaCall 30.00 + betaFootnotes 127.50 + betaCopy (cumulative re-upload) 37.50.
const BETA_B1_TOTAL = 30 + 127.5 + 37.5; // 195.00 (held 45-min row excluded)
const BETA_TOTAL = BETA_B1_TOTAL;

describe('tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001)', function () {
   this.timeout(180_000);

   let h;
   let db;
   let aws;
   let restoreSes = () => {};
   let restoreEnv = () => {};
   let scratchDir;

   const created = { customers: [], jobTypes: [], s3Keys: [], timesheetNames: [], entryIds: [], sharedChildJobs: [] };

   const customers = {}; // alpha / beta / internal -> customers row
   const jobs = {}; // A1 / A2 / B1 / I1 / JOHN -> customer_job_id
   let templateBuffer;
   let templateFileName;
   let trackerBuffer;
   let firstUpload; // response body of step (3)
   let cumulativeUpload; // response body of step (4b)
   let lastUploadSecond = 0;
   const entryIdByKey = {};
   let orchestratorResult;
   let finalizeBody;
   const invoiceByCustomer = {};

   // ── http helpers ────────────────────────────────────────────────────────────
   const upload = (identity, submitterId, buffer, { owner = null, fileName = `Eliza_Smith_week_${WEEK_START}.xlsx`, fileType = XLSX_MIME, headers = {} } = {}) => {
      let req = h.as(identity).post(`/time-tracking/upload/${A}/${submitterId}`);
      if (owner != null) req = req.query({ ownerUserID: owner });
      req = req.set('Content-Type', 'application/octet-stream').set('x-file-type', fileType);
      if (fileName !== null) req = req.set('x-file-name', encodeURIComponent(fileName));
      Object.entries(headers).forEach(([k, v]) => {
         req = req.set(k, v);
      });
      return req.send(buffer);
   };
   const recordUpload = body => {
      if (body && body.storedKey) created.s3Keys.push(body.storedKey);
      if (body && body.fileName) created.timesheetNames.push(body.fileName);
      lastUploadSecond = Math.floor(Date.now() / 1000);
   };
   // The stored name carries a one-second timestamp; keep successful uploads for
   // the same employee in distinct seconds so each keeps its own S3 object.
   const waitForNextSecond = async () => {
      while (Math.floor(Date.now() / 1000) <= lastUploadSecond) await sleep(50);
   };

   const buildTracker = (rows, { employeeName = 'Eliza Smith', startDate = WEEK_START, endDate = WEEK_END } = {}) =>
      buildTrackerFromTemplate({ templateBuffer, employeeName, startDate, endDate, rows });

   const entriesFor = (userId, extra = {}) => db('timesheet_entries').where({ account_id: A, user_id: userId, ...extra });

   const transactionsByEntry = async entryIds => {
      const rows = await db('ai_category_training_examples as a')
         .join('customer_transactions as t', 't.transaction_id', 'a.transaction_id')
         .where('a.account_id', A)
         .whereIn('a.timesheet_entry_id', entryIds)
         .select('a.timesheet_entry_id', 't.*');
      const map = new Map(entryIds.map(id => [id, []]));
      rows.forEach(r => map.get(r.timesheet_entry_id).push(r));
      return map;
   };

   // ── the three balance views, exactly as the lifecycle spec wires them ──────
   const engineFor = async customerId => {
      const invoicesToCreate = [{ customer_id: customerId, showWriteOffs: false }];
      const queryData = await fetchInitialQueryItems(db, { [customerId]: invoicesToCreate[0] }, A);
      const [calc] = calculateInvoices(invoicesToCreate, queryData);
      return {
         invoiceTotal: money(calc.invoiceTotal),
         outstandingInvoiceTotal: money(calc.outstandingInvoices.outstandingInvoiceTotal),
         transactionsTotal: money(calc.transactions.transactionsTotal)
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
      const [engine, audit, ar, targets] = await Promise.all([engineFor(customerId), auditFor(customerId), arRowFor(customerId), getCurrentChainTargets(db, A, customerId)]);
      expect(targets, `${label}: one current chain`).to.have.lengthOf(1);
      expect(money(targets[0].remaining), `${label}: current chain remaining`).to.equal(expected);
      expect(engine.outstandingInvoiceTotal, `${label}: engine outstandingInvoiceTotal`).to.equal(expected);
      expect(money(audit.totals.outstanding_invoices), `${label}: audit outstanding_invoices`).to.equal(expected);
      expect(ar, `${label}: AR aging row`).to.not.equal(null);
      expect(money(ar.total_outstanding), `${label}: AR total_outstanding`).to.equal(expected);
      return { engine, audit, ar };
   };

   // ── setup through the real routes ───────────────────────────────────────────
   const createCustomer = async (displayName, label, { individual = false } = {}) => {
      const stamp = `${RUN.toLowerCase()}${label}`;
      expectEnvelopeOk(
         await h
            .as('admin')
            .post(`/customer/createCustomer/${A}/${ADMIN}`)
            .send({
               customer: {
                  accountID: A,
                  userID: ADMIN,
                  loggedByUserID: ADMIN,
                  customerBusinessName: individual ? null : displayName,
                  customerName: individual ? displayName : 'Tracker Tester',
                  isCommercialCustomer: !individual,
                  isCustomerActive: true,
                  isCustomerBillable: true,
                  isCustomerRecurring: false,
                  customerStreet: '1 Tracker Way',
                  customerCity: 'Mesa',
                  customerState: 'AZ',
                  customerZip: '85201',
                  customerEmail: `tracker+${stamp}@example.test`,
                  customerPhone: '5550107777',
                  isCustomerAddressActive: true,
                  isCustomerPhysicalAddress: true,
                  isCustomerBillingAddress: true,
                  isCustomerMailingAddress: true
               }
            }),
         `createCustomer ${label}`
      );
      const row = await db('customers').where({ account_id: A, display_name: displayName }).orderBy('customer_id', 'desc').first();
      expect(row, `customer ${label} created`).to.exist;
      created.customers.push(row.customer_id);
      expect(row.business_name).to.equal(individual ? null : displayName);
      return row;
   };
   const createJob = async (customerId, jobTypeId, label) => {
      expectEnvelopeOk(
         await h
            .as('admin')
            .post(`/jobs/createJob/${A}/${ADMIN}`)
            .send({
               job: {
                  accountID: A,
                  userID: ADMIN,
                  loggedByUserID: ADMIN,
                  customerID: customerId,
                  jobTypeID: jobTypeId,
                  quoteAmount: 0,
                  agreedJobAmount: 0,
                  currentJobTotal: 0,
                  jobStatus: null,
                  isJobComplete: false,
                  isQuote: false,
                  note: `tracker e2e ${label}`
               }
            }),
         `createJob ${label}`
      );
      const job = await db('customer_jobs').where({ account_id: A, customer_id: customerId, job_type_id: jobTypeId }).whereNull('parent_job_id').first();
      expect(job, `job ${label} created`).to.exist;
      return job.customer_job_id;
   };

   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
      scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-tracker-e2e-'));
      restoreSes = stubSes();
      aws = installStubbedAws();

      // Customers + jobs through the app.
      customers.alpha = await createCustomer(ALPHA_NAME, 'alpha');
      customers.beta = await createCustomer(BETA_NAME, 'beta');
      const clash = await db('customers').where({ account_id: A, display_name: INTERNAL_NAME });
      expect(clash, `account ${A} must not already hold a customer named '${INTERNAL_NAME}'`).to.have.lengthOf(0);
      customers.internal = await createCustomer(INTERNAL_NAME, 'internal');
      customers.ambler1 = await createCustomer(AMBLER_RECORD_1, 'ambler1', { individual: true });
      customers.ambler2 = await createCustomer(AMBLER_RECORD_2, 'ambler2', { individual: true });

      const maxJobType = await db('customer_job_types').max({ id: 'job_type_id' }).first();
      expectEnvelopeOk(
         await h
            .as('admin')
            .post(`/jobTypes/createJobType/${A}/${ADMIN}`)
            .send({ jobType: { accountID: A, userID: ADMIN, customerJobCategory: CATEGORY_TAX_COMPLIANCE, jobDescription: YEAR_JOB_DESCRIPTION, bookRate: RATE, estimatedStraightTime: 240, isActive: true } }),
         'createJobType'
      );
      const yearJobType = await db('customer_job_types').where({ account_id: A, job_description: YEAR_JOB_DESCRIPTION }).where('job_type_id', '>', maxJobType.id || 0).first();
      expect(yearJobType, 'year job type created').to.exist;
      created.jobTypes.push(yearJobType.job_type_id);

      // Alpha: the year job FIRST, then General Consulting (so the latter is the
      // "most recent parent job" the picker falls back to).
      jobs.A1 = await createJob(customers.alpha.customer_id, yearJobType.job_type_id, 'A1');
      jobs.A2 = await createJob(customers.alpha.customer_id, JOB_TYPE_GENERAL_CONSULTING, 'A2');
      jobs.B1 = await createJob(customers.beta.customer_id, yearJobType.job_type_id, 'B1'); // Beta: ONLY a year job
      jobs.I1 = await createJob(customers.internal.customer_id, JOB_TYPE_GENERAL_CONSULTING, 'I1');
      jobs.JOHN = JOHN_SMITH_JOB;

      // Deterministic environment for the run: no background auto-ingest on
      // upload (the spec runs the orchestrator itself) and the internal entity
      // registered by id.
      restoreEnv = setEnv({ TIME_TRACKER_AI_FEATURE_FLAG: 'off', INTERNAL_CUSTOMER_IDS: String(customers.internal.customer_id) });
   });

   after(async () => {
      restoreEnv();
      restoreSes();
      installFailClosedAws();
      if (db) {
         const entryIds = created.timesheetNames.length
            ? await db('timesheet_entries').where({ account_id: A }).whereIn('timesheet_name', created.timesheetNames).pluck('timesheet_entry_id')
            : [];
         const allEntryIds = [...new Set([...entryIds, ...created.entryIds])];
         const customerIds = created.customers;
         const txnIds = [
            ...(customerIds.length ? await db('customer_transactions').where({ account_id: A }).whereIn('customer_id', customerIds).pluck('transaction_id') : []),
            ...(allEntryIds.length ? await db('ai_category_training_examples').where({ account_id: A }).whereIn('timesheet_entry_id', allEntryIds).whereNotNull('transaction_id').pluck('transaction_id') : [])
         ];
         const uniqueTxnIds = [...new Set(txnIds)];
         if (allEntryIds.length) {
            await db('ai_category_training_examples').where({ account_id: A }).whereIn('timesheet_entry_id', allEntryIds).del();
            await db('ai_call_log').where({ account_id: A }).whereIn('timesheet_entry_id', allEntryIds).del();
            await db('ai_time_tracker_transaction_suggestions').where({ account_id: A }).whereIn('timesheet_entry_id', allEntryIds).del();
            await db('timesheet_entries').where({ account_id: A }).whereIn('timesheet_entry_id', allEntryIds).del();
         }
         if (uniqueTxnIds.length) {
            await db('ai_category_training_examples').whereIn('transaction_id', uniqueTxnIds).del();
            await db('customer_transactions').where({ account_id: A }).whereIn('transaction_id', uniqueTxnIds).del();
         }
         // The rolling child job row addNewTransaction added to the shared fixture job.
         if (created.sharedChildJobs.length) await db('customer_jobs').where({ account_id: A, parent_job_id: JOHN_SMITH_JOB }).whereIn('customer_job_id', created.sharedChildJobs).del();

         if (customerIds.length) {
            const invoices = await db('customer_invoices').where({ account_id: A }).whereIn('customer_id', customerIds).select('invoice_file_location');
            invoices.forEach(i => i.invoice_file_location && created.s3Keys.push(i.invoice_file_location));
            await db('customer_payments').where({ account_id: A }).whereIn('customer_id', customerIds).del();
            await db('customer_writeoffs').where({ account_id: A }).whereIn('customer_id', customerIds).del();
            await db('customer_invoices').where({ account_id: A }).whereIn('customer_id', customerIds).whereNotNull('parent_invoice_id').del();
            await db('customer_invoices').where({ account_id: A }).whereIn('customer_id', customerIds).del();
            await db('customer_jobs').where({ account_id: A }).whereIn('customer_id', customerIds).del();
            await db('customer_information').where({ account_id: A }).whereIn('customer_id', customerIds).del();
            await db('customers').where({ account_id: A }).whereIn('customer_id', customerIds).del();
         }
         if (created.jobTypes.length) await db('customer_job_types').where({ account_id: A }).whereIn('job_type_id', created.jobTypes).del();
         // Astra round 13 (P2): every real tracker upload through the route
         // now also writes a tracker_file_owners row (migrations/021,
         // trackerOwners.js) in the same transaction as its timesheet_entries
         // rows — sweep it the same way created.s3Keys already is (harmless
         // no-op for the non-tracker keys, e.g. invoice locations, also in
         // that array).
         if (created.s3Keys.length) await db('tracker_file_owners').whereIn('s3_key', created.s3Keys).del();
      }
      for (const key of [...new Set(created.s3Keys)]) {
         await deleteObject(key).catch(() => {});
      }
      if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
      if (h) await h.close();
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /time-tracking/template/latest/:accountID/:userID', () => {
      it('(1) returns the REAL template from tracker_versions/ byte-for-byte (xlsx with Time / Employee Names / Instructions / Categories / Entity sheets)', async () => {
         // Fetched as the template's OWNING account (1) — byte-for-byte
         // passthrough is reserved for that account (see FOREIGN_ACCOUNT
         // above); account 9001 (A) would now get a per-tenant rebuild
         // instead, which is exercised separately in
         // coverage-timetracking-timesheets.integration.spec.js. The rest of
         // this pipeline (fill -> upload -> auto-ingest -> invoice) still
         // runs entirely as account 9001 below.
         const res = await h.as('superAdmin').get(`/time-tracking/template/latest/${FOREIGN_ACCOUNT}/${SUPER_ADMIN}`).buffer(true).parse(binaryParser);
         expect(res.status).to.equal(200);
         templateFileName = res.headers['x-tracker-filename'];
         expect(templateFileName).to.match(/^timeTracker_.*\.xlsx$/);
         expect(res.headers['content-disposition']).to.equal(`attachment; filename="${templateFileName}"`);

         // It is the newest template object in the bucket, and the bytes are that object's bytes.
         const versions = (await listObjects(`${TRACKER_VERSIONS_ROOT}/`)).filter(o => /^timetracker_/i.test(path.basename(o.Key)));
         versions.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
         expect(path.basename(versions[0].Key)).to.equal(templateFileName);
         const stored = await getObject(versions[0].Key);
         templateBuffer = res.body;
         expect(templateBuffer.subarray(0, 2).toString()).to.equal('PK');
         expect(sha256(templateBuffer)).to.equal(sha256(stored.body));

         const wb = XLSX.read(templateBuffer, { type: 'buffer' });
         expect(wb.SheetNames[0], 'the upload validator reads the FIRST sheet').to.equal('Time');
         expect(wb.SheetNames).to.include.members(['Time', 'Employee Names', 'Instructions', 'Categories', 'Entity']);
         const grid = XLSX.utils.sheet_to_json(wb.Sheets.Time, { header: 1, defval: '' });
         expect(grid[0][0]).to.equal('Employee Name');
         expect(grid[1][0]).to.equal('Time Tracker Start Date');
         expect(grid[2][0]).to.equal('Time Tracker End Date');
         expect(grid[4].slice(0, HEADERS.length)).to.deep.equal(HEADERS);
         const entities = XLSX.utils.sheet_to_json(wb.Sheets.Entity, { header: 1 }).map(r => r[0]);
         expect(entities).to.include(ENTITY_JKA);
         const categories = XLSX.utils.sheet_to_json(wb.Sheets.Categories, { header: 1 }).map(r => r[0]);
         expect(categories).to.include.members(['Tax Return Preparation', 'Phone Call', 'Email', 'Client Meeting', 'Staff Meeting', 'Tax Notice', 'Lunch']);
      });

      it('(2) a dummy tracker for Eliza Smith is filled INTO that downloaded workbook (quarter-hour and odd durations, 12 lines over one week)', () => {
         trackerBuffer = buildTracker(ROWS.map(toBuilderRow));
         const readBack = readTrackerRows(trackerBuffer);
         expect(readBack.employeeName).to.equal('Eliza Smith');
         expect(readBack.headers.slice(0, HEADERS.length)).to.deep.equal(HEADERS);
         expect(readBack.rows).to.have.lengthOf(ROWS.length);
         expect(readBack.rows.map(r => Number(r[6]))).to.deep.equal(ROWS.map(r => r.duration));
         expect(ROWS.map(r => r.duration)).to.include.members([15, 45, 50, 205]);
         const wb = XLSX.read(trackerBuffer, { type: 'buffer' });
         expect(wb.SheetNames.slice(0, 5)).to.deep.equal(['Time', 'Employee Names', 'Instructions', 'Categories', 'Entity']);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('POST /time-tracking/upload/:accountID/:userID', () => {
      it('(3) admin upload on behalf of Eliza (?ownerUserID) -> 201; every non-lunch line lands in timesheet_entries (duration = minutes) and the gzip copy in S3', async () => {
         const s3Before = (await listObjects(PROCESSED_PREFIX_ELIZA)).length;
         const res = await upload('admin', ADMIN, trackerBuffer, { owner: ELIZA });
         expect(res.status, JSON.stringify(res.body).slice(0, 400)).to.equal(201);
         recordUpload(res.body);
         firstUpload = res.body;

         expect(firstUpload.message).to.match(/^Time tracker validated and uploaded successfully\./);
         expect(firstUpload.inserted_count).to.equal(INSERTED_ROWS.length); // Lunch line dropped
         expect(firstUpload.duplicates_skipped).to.deep.equal([]);
         expect(firstUpload.non_billable_rows).to.deep.equal([{ row: sheetRowOf('vacation'), reason: 'category:vacation' }]);
         expect(firstUpload.message).to.include('1 row looks like non-work time');
         expect(firstUpload.fileName).to.match(/^Smith_Eliza_.*\.xlsx$/);
         expect(firstUpload.storedKey).to.equal(`${PROCESSED_PREFIX_ELIZA}${firstUpload.fileName}.gz`);
         expect(firstUpload.metadata).to.include({
            employeeName: 'Eliza Smith',
            userId: ELIZA,
            submittedForUserId: ELIZA,
            submittedByUserId: ADMIN,
            startDate: dayjs(WEEK_START).format('MM-DD-YYYY'),
            endDate: dayjs(WEEK_END).format('MM-DD-YYYY')
         });

         const rows = await entriesFor(ELIZA, { timesheet_name: firstUpload.fileName }).orderBy('timesheet_entry_id', 'asc');
         expect(rows).to.have.lengthOf(INSERTED_ROWS.length);
         INSERTED_ROWS.forEach((spec, i) => {
            const row = rows[i];
            entryIdByKey[spec.key] = row.timesheet_entry_id;
            created.entryIds.push(row.timesheet_entry_id);
            expect(row.user_id, spec.key).to.equal(ELIZA);
            expect(row.employee_name).to.equal('Eliza Smith');
            expect(ymd(row.date), `${spec.key} date`).to.equal(DAY(spec.day));
            expect(ymd(row.time_tracker_start_date)).to.equal(WEEK_START);
            expect(ymd(row.time_tracker_end_date)).to.equal(WEEK_END);
            expect(row.entity).to.equal(ENTITY_JKA);
            expect(row.category, `${spec.key} category`).to.equal(spec.category);
            expect(row.company_name, `${spec.key} company`).to.equal(spec.company || null);
            expect(row.first_name).to.equal(spec.first || null);
            expect(row.last_name).to.equal(spec.last || null);
            expect(row.duration, `${spec.key} duration is whole MINUTES`).to.equal(spec.duration);
            expect(row.notes).to.equal(spec.notes);
            expect(row.is_processed).to.equal(false);
            expect(row.is_deleted).to.equal(false);
            expect(row.hold_reason).to.equal(null);
         });
         expect(await entriesFor(ELIZA).where({ notes: 'Lunch', timesheet_name: firstUpload.fileName }), 'Lunch line never stored').to.have.lengthOf(0);

         // The original workbook is stored gzip-compressed under the employee's folder.
         const stored = await getObject(firstUpload.storedKey);
         expect(sha256(zlib.gunzipSync(stored.body))).to.equal(sha256(trackerBuffer));
         expect(stored.metadata.userMetadata['original-content-type']).to.equal(XLSX_MIME);
         expect((await listObjects(PROCESSED_PREFIX_ELIZA)).length).to.equal(s3Before + 1);

         // Billing staff are told the tracker is ready (SES stubbed).
         const mail = sesSends.find(m => m.Message.Subject.Data === 'Time Tracker Ready for Billing: Eliza Smith');
         expect(mail, 'ready-for-billing email').to.exist;
         expect(mail.Destination.ToAddresses).to.include('admin+test@example.com');
         expect(mail.Message.Body.Html.Data).to.include(firstUpload.fileName).and.include(`(${INSERTED_ROWS.length} entries)`);
      });

      it('(4a) re-uploading the identical file -> 409 duplicate_of the first upload; no rows and no S3 object added', async () => {
         const before = await entriesFor(ELIZA, { time_tracker_start_date: WEEK_START, time_tracker_end_date: WEEK_END }).count({ n: '*' }).first();
         const s3Before = (await listObjects(PROCESSED_PREFIX_ELIZA)).length;
         const res = await upload('admin', ADMIN, trackerBuffer, { owner: ELIZA, fileName: `Eliza_Smith_week_${WEEK_START}_again.xlsx` });
         expect(res.status).to.equal(409);
         expect(res.body.duplicate_of).to.include({ timesheet_name: firstUpload.fileName, row_count: INSERTED_ROWS.length });
         expect(res.body.message).to.include(`already uploaded as "${firstUpload.fileName}"`);
         const afterCount = await entriesFor(ELIZA, { time_tracker_start_date: WEEK_START, time_tracker_end_date: WEEK_END }).count({ n: '*' }).first();
         expect(Number(afterCount.n)).to.equal(Number(before.n));
         expect((await listObjects(PROCESSED_PREFIX_ELIZA)).length).to.equal(s3Before);
      });

      it('(4b) a cumulative tracker (old lines + one new line) -> 201 inserting ONLY the new line; the rest reported in duplicates_skipped', async () => {
         await waitForNextSecond();
         const cumulative = buildTracker([...ROWS, NEW_ROW].map(toBuilderRow));
         const res = await upload('admin', ADMIN, cumulative, { owner: ELIZA, fileName: `Eliza_Smith_week_${WEEK_START}_v2.xlsx` });
         expect(res.status, JSON.stringify(res.body).slice(0, 400)).to.equal(201);
         recordUpload(res.body);
         cumulativeUpload = res.body;
         expect(cumulativeUpload.fileName).to.not.equal(firstUpload.fileName);
         expect(cumulativeUpload.inserted_count).to.equal(1);
         expect(cumulativeUpload.duplicates_skipped_count).to.equal(INSERTED_ROWS.length);
         expect(cumulativeUpload.duplicates_skipped.map(d => d.row)).to.deep.equal(INSERTED_ROWS.map(r => sheetRowOf(r.key)));
         cumulativeUpload.duplicates_skipped.forEach(d => expect(d.duplicate_of.timesheet_name).to.equal(firstUpload.fileName));
         expect(cumulativeUpload.non_billable_rows, 'the vacation line was a duplicate, not re-inserted').to.deep.equal([]);
         expect(cumulativeUpload.message).to.include(`${INSERTED_ROWS.length} rows were already uploaded earlier and were skipped as duplicates.`);

         const newRows = await entriesFor(ELIZA, { timesheet_name: cumulativeUpload.fileName });
         expect(newRows).to.have.lengthOf(1);
         expect(newRows[0]).to.include({ notes: NEW_ROW.notes, duration: NEW_ROW.duration, company_name: BETA_NAME });
         entryIdByKey[NEW_ROW.key] = newRows[0].timesheet_entry_id;
         created.entryIds.push(newRows[0].timesheet_entry_id);
         const weekRows = await entriesFor(ELIZA, { time_tracker_start_date: WEEK_START, time_tracker_end_date: WEEK_END, is_deleted: false });
         expect(weekRows.filter(r => [firstUpload.fileName, cumulativeUpload.fileName].includes(r.timesheet_name))).to.have.lengthOf(ALL_INGESTED.length);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('processEntries — auto-ingest orchestrator (src/endpoints/timesheets/auto-ingest-orchestrator.js)', () => {
      it('(5) stubbed classifier: 10 lines auto-inserted, the missing-year and ambiguous lines HELD; every transaction = ceil(min/6)/10 h (6-min increments, rounded UP) × $75', async () => {
         const entryIds = ALL_INGESTED.map(r => entryIdByKey[r.key]);
         const johnChildJobs = () => db('customer_jobs').where({ account_id: A, parent_job_id: JOHN_SMITH_JOB }).pluck('customer_job_id');
         const childJobsBefore = await johnChildJobs();
         orchestratorResult = await processEntries({ db, accountId: A, userId: ADMIN, entryIds });
         created.sharedChildJobs.push(...(await johnChildJobs()).filter(id => !childJobsBefore.includes(id)));
         expect(created.sharedChildJobs.length, 'a rolling child row on the shared John Smith job').to.be.at.least(1);
         expect(orchestratorResult).to.include({ processed: ALL_INGESTED.length, autoInserted: 10, held: 2, skipped: 0 });
         expect(aws.categoryPrompts().length, 'one categorization call per matched line').to.equal(10 + 1); // + the missing-year line (it matches Beta before it is held)
         expect(aws.customerMatchPrompts().map(p => p.text.split('\n')[0]), 'exact / canonical / needs_review never reach the LLM tiebreak').to.deep.equal([]);

         const customerIdOf = { alpha: customers.alpha.customer_id, beta: customers.beta.customer_id, internal: customers.internal.customer_id, john: JOHN_SMITH };
         const entries = await db('timesheet_entries').whereIn('timesheet_entry_id', entryIds).select('*');
         const byId = new Map(entries.map(e => [e.timesheet_entry_id, e]));
         const txns = await transactionsByEntry(entryIds);
         const suggestions = await db('ai_time_tracker_transaction_suggestions').whereIn('timesheet_entry_id', entryIds).select('timesheet_entry_id', 'status');
         const statusOf = new Map(suggestions.map(s => [s.timesheet_entry_id, s.status]));

         for (const spec of ALL_INGESTED) {
            const id = entryIdByKey[spec.key];
            const entry = byId.get(id);
            const linked = txns.get(id);
            if (spec.expect.hold) {
               expect(entry.is_processed, `${spec.key} stays unprocessed`).to.equal(false);
               expect(entry.hold_reason, `${spec.key} hold_reason`).to.equal(spec.expect.hold);
               expect(Object.values(HOLD_REASONS)).to.include(entry.hold_reason);
               expect(linked, `${spec.key} produced no transaction`).to.have.lengthOf(0);
               expect(statusOf.get(id)).to.equal('pending_review');
               continue;
            }
            expect(entry.is_processed, `${spec.key} marked processed`).to.equal(true);
            expect(entry.hold_reason).to.equal(null);
            expect(entry.matched_user_id).to.equal(ELIZA);
            expect(entry.suggested_customer_id).to.equal(customerIdOf[spec.expect.customer]);
            expect(statusOf.get(id)).to.equal('auto_applied');
            expect(linked, `${spec.key}: exactly one transaction`).to.have.lengthOf(1);
            const [txn] = linked;
            const calc = expectedAmounts(spec.duration);
            expect(calc, `${spec.key}: hand table matches the formula`).to.deep.equal({ quantity: spec.expect.quantity, unitCost: RATE, total: spec.expect.total });
            expect(_computeTimeAmounts(spec.duration, RATE)).to.deep.equal({ quantity: calc.quantity, unitCost: RATE, totalTransaction: calc.total });
            expect(txn.transaction_type, spec.key).to.equal('Time');
            expect(Number(txn.quantity), `${spec.key} quantity (hours)`).to.equal(spec.expect.quantity);
            expect(Number(txn.unit_cost), `${spec.key} unit_cost = billing_rate`).to.equal(RATE);
            expect(Number(txn.total_transaction), `${spec.key} total = round2(q × rate)`).to.equal(spec.expect.total);
            expect(cents(txn.total_transaction)).to.equal(Math.round(cents(txn.quantity) * RATE));
            expect(txn.customer_id, `${spec.key} customer`).to.equal(customerIdOf[spec.expect.customer]);
            expect(txn.customer_job_id, `${spec.key} job`).to.equal(jobs[spec.expect.job]);
            expect(txn.is_transaction_billable, `${spec.key} billable`).to.equal(spec.expect.billable);
            expect(txn.logged_for_user_id).to.equal(ELIZA);
            expect(txn.created_by_user_id).to.equal(ADMIN);
            expect(txn.general_work_description_id).to.equal(SEED_GWD_ID);
            expect(txn.detailed_work_description).to.equal(spec.notes);
            expect(ymd(txn.transaction_date), `${spec.key} transaction_date`).to.equal(DAY(spec.day));
            expect(txn.customer_invoice_id).to.equal(null);
            expect(txn.retainer_id).to.equal(null);
         }

         // Hold details are PII-free and name the years / candidates.
         const missingYear = byId.get(entryIdByKey.betaMissingYear);
         expect(missingYear.ai_payload.hold).to.deep.equal({
            reason: 'no_job_for_year_named_in_notes',
            requested_tax_year: String(YEAR_WITHOUT_JOB),
            year_source: 'notes',
            fallback_job_id: jobs.B1,
            fallback_job_year: String(TAX_YEAR)
         });
         expect(missingYear.suggested_customer_id).to.equal(customers.beta.customer_id);
         const ambiguous = byId.get(entryIdByKey.ambiguous);
         expect(ambiguous.suggested_customer_id, 'an ambiguous hold never pre-selects a customer').to.equal(null);
         expect(ambiguous.ai_payload.customer).to.include({ tier: 'needs_review', reason: 'duplicate_canonical_name', customerId: null });
         expect(ambiguous.ai_payload.customer.candidates.map(c => c.id).sort()).to.deep.equal([customers.ambler1.customer_id, customers.ambler2.customer_id].sort());
         expect(JSON.stringify(ambiguous.ai_payload), 'ai_payload stays PII-free').to.not.match(/ambler|smith|pat\b/i);

         // Nothing is left for a reviewer except the two holds.
         const pending = await entriesFor(ELIZA).whereIn('timesheet_entry_id', entryIds).where({ is_processed: false, is_deleted: false }).pluck('timesheet_entry_id');
         expect(pending.sort()).to.deep.equal([entryIdByKey.betaMissingYear, entryIdByKey.ambiguous].sort());
      });

      // The batch inserts up to 8 lines concurrently (AUTO_INGEST_CONCURRENCY); the
      // rolling job snapshot must still end at the full sum for every job touched.
      it('(5b) each job’s newest rolling child row carries Σ(all its transactions) after the batch', async () => {
         for (const [label, jobId] of [['A1', jobs.A1], ['A2', jobs.A2], ['B1', jobs.B1], ['I1', jobs.I1]]) {
            const sum = await db('customer_transactions').where({ account_id: A, customer_job_id: jobId }).sum({ s: 'total_transaction' }).first();
            const latest = await db('customer_jobs').where({ account_id: A, parent_job_id: jobId }).orderBy('customer_job_id', 'desc').first();
            expect(latest, `${label}: rolling child job exists`).to.exist;
            expect(money(latest.current_job_total), `${label}: latest current_job_total = Σ transactions`).to.equal(money(sum.s));
         }
      });

      // FIXED (was DEFECT): src/utils/fuzzyMatch.js scoreCandidates() used to score the
      // catalog with fuzzball.extract(query, labels, { scorer: fuzzball.WRatio }); in the
      // installed fuzzball 2.2.6 WRatio leaked state through the options object extract
      // shares across iterations, so a candidate's score depended on which rows precede
      // it (verified: 'J. Smith' vs [Smith, John; Smith, Jane] scored 0.79/0.79 alone but
      // 0.95/0.95 once 'Globex Industries' preceded them). scoreCandidates now scores each
      // candidate with its own fuzzball.WRatio() call and a fresh options object every
      // time, so no state can leak between candidates. The orchestrator's catalog load
      // (auto-ingest-orchestrator.js _loadCatalogs) also now sorts by customer_id so the
      // AI payload's candidate order is stable across runs regardless of physical row order.
      it('fuzzy customer scores do not depend on the order of the customer catalog', () => {
         const john = { id: JOHN_SMITH, label: 'Smith, John' };
         const jane = { id: 900104, label: 'Smith, Jane' };
         const scoresIn = list => Object.fromEntries(scoreCandidates('J. Smith', list).map(c => [c.id, c.score]));
         const baseline = scoresIn([john, jane]);
         expect(scoresIn([{ id: 1, label: 'Globex Industries' }, john, jane])).to.deep.equal(baseline);
         const mixed = scoresIn([{ id: 2, label: 'Acme Corp' }, john, { id: 1, label: 'Globex Industries' }, jane]);
         expect(mixed[john.id]).to.equal(mixed[jane.id]);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('POST /invoices/createInvoice/:accountID/:userID', () => {
      it('(6a) finalize Alpha + Beta: one parent statement each = Σ auto-inserted BILLABLE time; non-billable lines stamped but not charged', async () => {
         finalizeBody = expectEnvelopeOk(
            await h
               .as('admin')
               .post(`/invoices/createInvoice/${A}/${ADMIN}`)
               .send({
                  invoiceConfiguration: {
                     invoicesToCreate: [
                        { customer_id: customers.alpha.customer_id, showWriteOffs: false, invoiceNote: `Tracker week ${WEEK_START}` },
                        { customer_id: customers.beta.customer_id, showWriteOffs: false, invoiceNote: `Tracker week ${WEEK_START}` }
                     ],
                     invoiceCreationSettings: { isFinalized: true, isRoughDraft: false, isCsvOnly: false, globalInvoiceNote: 'Thank you for your business.' }
                  }
               }),
            'finalize'
         );
         created.s3Keys.push(finalizeBody.fileLocation);
         expect(finalizeBody.skippedCustomers).to.deep.equal([]);
         expect(finalizeBody.invoicesWithDetail).to.have.lengthOf(2);

         const expected = {
            [customers.alpha.customer_id]: { total: ALPHA_TOTAL, lines: 5, jobs: { [jobs.A1]: ALPHA_A1_TOTAL, [jobs.A2]: ALPHA_A2_TOTAL } },
            [customers.beta.customer_id]: { total: BETA_TOTAL, lines: 3, jobs: { [jobs.B1]: BETA_B1_TOTAL } }
         };
         for (const detail of finalizeBody.invoicesWithDetail) {
            const exp = expected[detail.customer_id];
            expect(detail.invoiceNumber).to.match(INVOICE_NUMBER_RE);
            expect(money(detail.outstandingInvoices.outstandingInvoiceTotal)).to.equal(0);
            expect(money(detail.transactions.transactionsTotal)).to.equal(money(exp.total));
            expect(money(detail.invoiceTotal)).to.equal(money(exp.total));
            expect(detail.transactions.allTransactionRecords, 'non-billable lines are LISTED on the statement').to.have.lengthOf(exp.lines);
            const jobTotals = Object.fromEntries(detail.transactions.transactionRecords.map(r => [r.jobID, money(r.jobTotal)]));
            expect(jobTotals).to.deep.equal(Object.fromEntries(Object.entries(exp.jobs).map(([k, v]) => [Number(k), money(v)])));

            const parents = await db('customer_invoices').where({ account_id: A, customer_id: detail.customer_id }).whereNull('parent_invoice_id');
            expect(parents, 'exactly one parent statement').to.have.lengthOf(1);
            const [parent] = parents;
            invoiceByCustomer[detail.customer_id] = parent;
            if (parent.invoice_file_location) created.s3Keys.push(parent.invoice_file_location);
            expect(parent.invoice_number).to.equal(detail.invoiceNumber);
            expect(Number(parent.beginning_balance)).to.equal(0);
            expect(money(parent.total_charges)).to.equal(money(exp.total));
            expect(money(parent.total_amount_due)).to.equal(money(exp.total));
            expect(money(parent.remaining_balance_on_invoice)).to.equal(money(exp.total));
            expect(parent.is_invoice_paid_in_full).to.equal(false);

            const txns = await db('customer_transactions').where({ account_id: A, customer_id: detail.customer_id });
            expect(txns).to.have.lengthOf(exp.lines);
            txns.forEach(t => expect(t.customer_invoice_id, `transaction ${t.transaction_id} stamped`).to.equal(parent.customer_invoice_id));
            const billable = txns.filter(t => t.is_transaction_billable).reduce((acc, t) => acc + cents(t.total_transaction), 0) / 100;
            expect(billable, 'statement = Σ billable auto-inserted time').to.equal(money(exp.total));
         }
         // The two HELD lines never reached a statement.
         const heldTxns = await transactionsByEntry([entryIdByKey.betaMissingYear, entryIdByKey.ambiguous]);
         heldTxns.forEach(list => expect(list).to.have.lengthOf(0));
      });

      it('(6b) GET /invoices/downloadFile zip -> pdftotext: invoice number, Bill To, each job line, Total New Charges and Balance Due', async () => {
         if (!fs.existsSync(PDFTOTEXT)) throw new Error(`pdftotext not found at ${PDFTOTEXT} (set PDFTOTEXT_BIN)`);
         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${ADMIN}`).query({ fileLocation: finalizeBody.fileLocation }).buffer(true).parse(binaryParser);
         expect(res.status).to.equal(200);
         expect(res.body.subarray(0, 2).toString(), 'zip magic').to.equal('PK');
         const directory = await unzipper.Open.buffer(res.body);
         const files = {};
         for (const entry of directory.files) files[entry.path] = await entry.buffer();
         expect(Object.keys(files), 'ZIP member names are unique').to.have.lengthOf(directory.files.length);
         const pdfText = buffer => {
            const file = path.join(scratchDir, `statement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
            fs.writeFileSync(file, buffer);
            return flat(execFileSync(PDFTOTEXT, ['-layout', file, '-'], { encoding: 'utf8' }));
         };
         const dueDate = dayjs().add(16, 'day').format('MM/DD/YYYY');
         const statements = [
            {
               customer: customers.alpha,
               lines: [`${jobs.A1} ${YEAR_JOB_DESCRIPTION} ${fmt(ALPHA_A1_TOTAL)}`, `${jobs.A2} General Consulting ${fmt(ALPHA_A2_TOTAL)}`],
               total: ALPHA_TOTAL,
               // the 8h vacation line ($600.00) is non-billable: listed nowhere as a charge
               absent: ['600.00', fmt(ALPHA_TOTAL + 600), fmt(ALPHA_A2_TOTAL + 600)]
            },
            {
               customer: customers.beta,
               lines: [`${jobs.B1} ${YEAR_JOB_DESCRIPTION} ${fmt(BETA_B1_TOTAL)}`],
               total: BETA_TOTAL,
               // the HELD 45-minute missing-year line (ceil(45/6)/10=0.8h, $60.00) is not on the statement
               absent: ['60.00', fmt(BETA_TOTAL + 60)]
            }
         ];
         const asserted = [];
         for (const st of statements) {
            const pdfName = `${st.customer.display_name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}_customer_${st.customer.customer_id}.pdf`;
            expect(files[pdfName], `${pdfName} in the zip (${Object.keys(files).join(', ')})`).to.exist;
            const text = pdfText(files[pdfName]);
            const invoiceNumber = invoiceByCustomer[st.customer.customer_id].invoice_number;
            const expectedLines = [
               invoiceNumber,
               `Bill To: ${st.customer.business_name}`,
               'Beginning Balance: 0.00',
               ...st.lines,
               `Total New Charges: ${fmt(st.total)}`,
               `Balance Due: ${fmt(st.total)}`,
               `Payment Due Date: ${dueDate}`
            ];
            expectedLines.forEach(line => expect(text, `${pdfName}: "${line}"`).to.include(line));
            st.absent.forEach(fragment => expect(text, `${pdfName}: must not show ${fragment}`).to.not.include(fragment));
            expect(text, `${pdfName}: no other customer's line on the statement`).to.not.include('Smith').and.not.include(AMBLER_LAST);
            asserted.push({ pdf: pdfName, lines: expectedLines });
         }
         // Printed so the run log carries the exact statement lines that were checked.
         console.log(`[tracker-e2e] PDF lines asserted: ${JSON.stringify(asserted, null, 1)}`);
      });

      it('(6c) billing engine, Account Audit and Accounts Receivable agree with each new statement', async () => {
         const alpha = await expectThreeViewsAgree(customers.alpha.customer_id, money(ALPHA_TOTAL), 'Alpha');
         expect(alpha.engine.transactionsTotal, 'Alpha: nothing left unbilled').to.equal(0);
         expect(alpha.engine.invoiceTotal).to.equal(money(ALPHA_TOTAL));
         const beta = await expectThreeViewsAgree(customers.beta.customer_id, money(BETA_TOTAL), 'Beta');
         expect(beta.engine.transactionsTotal).to.equal(0);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('POST /timesheets/moveToTransactions/:accountID/:userID', () => {
      // C5-3: quantity/unitCost/totalTransaction below are DELIBERATELY STALE
      // (the pre-C1 hundredth-hour formula: 45 min -> round(45*100/60)/100 =
      // 0.75h; 0.75 × 75 = 56.25) — never the correct six-minute-ceiling
      // values. The server must ignore them and recompute from the STORED
      // minutes and the employee's own rate, proving the legacy manual-apply
      // path can no longer be used to persist stale/hand-typed pricing.
      const STALE_QUANTITY = 0.75;
      const STALE_TOTAL = 56.25;
      const payloadFor = (entryId, minutes, overrides = {}) => ({
         entry: {
            timesheetEntryID: entryId,
            customerID: customers.beta.customer_id,
            customerJobID: jobs.B1,
            selectedRetainerID: null,
            customerInvoicesID: null,
            loggedForUserID: ELIZA,
            loggedByUserID: ADMIN,
            selectedGeneralWorkDescriptionID: SEED_GWD_ID,
            detailedJobDescription: ROWS.find(r => r.key === 'betaMissingYear').notes,
            transactionDate: DAY(ROWS.find(r => r.key === 'betaMissingYear').day),
            transactionType: 'Time',
            quantity: STALE_QUANTITY,
            unitCost: RATE,
            totalTransaction: STALE_TOTAL,
            isTransactionBillable: true,
            isInAdditionToMonthlyCharge: false,
            note: '',
            minutes,
            entity: ENTITY_JKA,
            category: 'Tax Notice',
            ...overrides
         }
      });

      it('(7) a reviewer applies the HELD missing-year line with explicit ids: stale hundredth-hour input is ignored and recomputed server-side; inserted exactly once (second call 409), same math as the auto path, lands on Beta’s NEXT statement', async () => {
         const entryId = entryIdByKey.betaMissingYear;
         const first = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(payloadFor(entryId, 45));
         expect(first.status, JSON.stringify(first.body)).to.equal(200);
         expect(first.body).to.include({ status: 200, message: 'Successfully moved timesheet entry to transactions.' });

         const second = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(payloadFor(entryId, 45));
         expect(second.status).to.equal(409);
         expect(second.body.message).to.match(/already moved to transactions/);

         const linked = (await transactionsByEntry([entryId])).get(entryId);
         expect(linked, 'exactly one transaction for the line').to.have.lengthOf(1);
         const [txn] = linked;
         const autoTwin = (await transactionsByEntry([entryIdByKey.alphaWorkpapers])).get(entryIdByKey.alphaWorkpapers)[0]; // also 45 min, auto path
         // ceil(45/6)=8 -> 0.8h; 0.8 × 75 = 60.00 — NOT the stale 0.75h/$56.25 submitted above.
         expect({ q: Number(txn.quantity), c: Number(txn.unit_cost), t: Number(txn.total_transaction) }, 'stale client input must be ignored and recomputed').to.deep.equal({ q: 0.8, c: RATE, t: 60 });
         expect({ q: Number(txn.quantity), c: Number(txn.unit_cost), t: Number(txn.total_transaction) }).to.deep.equal({ q: Number(autoTwin.quantity), c: Number(autoTwin.unit_cost), t: Number(autoTwin.total_transaction) });
         expect(txn).to.include({ customer_id: customers.beta.customer_id, customer_job_id: jobs.B1, transaction_type: 'Time', is_transaction_billable: true, customer_invoice_id: null, logged_for_user_id: ELIZA });

         const entry = await db('timesheet_entries').where({ timesheet_entry_id: entryId }).first();
         expect(entry).to.include({ is_processed: true, hold_reason: null });
         const suggestion = await db('ai_time_tracker_transaction_suggestions').where({ timesheet_entry_id: entryId }).first();
         expect(suggestion.status).to.equal('applied');

         // Billed statement untouched; the late line is next month's charge.
         // 45 min -> ceil(45/6)/10 = 0.8h; 0.8 × 75 = 60.00.
         const engine = await engineFor(customers.beta.customer_id);
         expect(engine).to.deep.equal({ outstandingInvoiceTotal: money(BETA_TOTAL), transactionsTotal: 60, invoiceTotal: money(BETA_TOTAL + 60) });
         const parent = await db('customer_invoices').where({ customer_invoice_id: invoiceByCustomer[customers.beta.customer_id].customer_invoice_id }).first();
         expect(money(parent.remaining_balance_on_invoice)).to.equal(money(BETA_TOTAL));
      });

      // C5-3: a sub-cent rate override is refused (400), not silently rounded
      // — same rule the held-apply path already enforces. The claim rolls
      // back inside the same transaction, so the entry stays pending.
      it('(7b) a sub-cent rate override on a manual Time apply is refused (400) and the claim rolls back', async () => {
         const [raceEntry] = await db('timesheet_entries')
            .insert({
               account_id: A,
               user_id: ELIZA,
               employee_name: 'Eliza Smith',
               timesheet_name: `subcent-check_${RUN}.xlsx`,
               time_tracker_start_date: WEEK_START,
               time_tracker_end_date: WEEK_END,
               date: WEEK_START,
               entity: ENTITY_JKA,
               category: 'Phone Call',
               company_name: BETA_NAME,
               duration: 45,
               notes: `C5-3 sub-cent rate check (ref ${REF})`,
               is_processed: false,
               is_deleted: false
            })
            .returning('*');
         created.entryIds.push(raceEntry.timesheet_entry_id);

         const res = await h.as('admin').post(`/timesheets/moveToTransactions/${A}/${ADMIN}`).send(payloadFor(raceEntry.timesheet_entry_id, 45, { unitCost: 1.005 }));
         expect(res.status, JSON.stringify(res.body)).to.equal(400);
         expect(res.body.message).to.match(/2 decimal/);

         const after = await db('timesheet_entries').where({ timesheet_entry_id: raceEntry.timesheet_entry_id }).select('is_processed', 'is_deleted').first();
         expect(after, 'claim rolled back — still pending').to.deep.equal({ is_processed: false, is_deleted: false });
         const linked = (await transactionsByEntry([raceEntry.timesheet_entry_id])).get(raceEntry.timesheet_entry_id);
         expect(linked).to.have.lengthOf(0);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID', () => {
      it('(8a) an UNPROCESSED (held) entry is soft-deleted and leaves the review queue', async () => {
         const entryId = entryIdByKey.ambiguous;
         const res = await h.as('admin').delete(`/timesheets/deleteTimesheetEntry/${entryId}/${A}/${ADMIN}`);
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('Successfully deleted timesheet entry.');
         const row = await db('timesheet_entries').where({ timesheet_entry_id: entryId }).first();
         expect(row).to.include({ is_deleted: true, is_processed: false });
         const queue = await h.as('admin').get(`/timesheets/getTimesheetEntriesByUserID/${ELIZA}/${A}/${ADMIN}`).query({ limit: 500 });
         expect(queue.status).to.equal(200);
         expect(queue.body.outstandingTimesheetEntries.map(e => e.timesheet_entry_id)).to.not.include(entryId);
         expect((await transactionsByEntry([entryId])).get(entryId)).to.have.lengthOf(0);
      });

      // FIXED (was DEFECT): timesheets-router.js's deleteTimesheetEntry used to load
      // the row and set is_deleted = true with NO is_processed check, so an entry that
      // was already turned into a (here: already INVOICED) transaction was "deleted"
      // with HTTP 200 while its transaction stayed billed; trackerDuplicates.js only
      // compared against is_deleted = false rows, so re-uploading the same tracker
      // afterwards re-inserted that line and auto-ingest billed the work a second time.
      // deleteTimesheetEntry now refuses (409) a processed entry, and
      // findTrackerDuplicates no longer filters on is_deleted at all (a soft-deleted
      // row's work may already be billed and must still count as "already uploaded").
      it('(8b) a PROCESSED entry (already billed) is refused and stays live', async () => {
         const entryId = entryIdByKey.alphaWorkpapers;
         const res = await h.as('admin').delete(`/timesheets/deleteTimesheetEntry/${entryId}/${A}/${ADMIN}`);
         expect(res.status, JSON.stringify(res.body)).to.be.oneOf([400, 409]);
         const row = await db('timesheet_entries').where({ timesheet_entry_id: entryId }).first();
         expect(row.is_deleted).to.equal(false);
      });

      // C3 (P1): 8a/8b above are sequential (read-then-check-then-write, no
      // interleaving). This test reproduces the reviewer's exact race: mark
      // the row processed AFTER it would have been read (as an intervening
      // apply/auto-ingest would) and BEFORE the delete's own write runs. The
      // fixed deleteTimesheetEntryIfPending is a single conditional UPDATE …
      // WHERE is_processed = false AND is_deleted = false … RETURNING, so it
      // must see the now-live state and refuse — never blindly write back a
      // stale `is_processed:false` snapshot, which would corrupt the row into
      // {is_processed:false, is_deleted:true} while a transaction now exists
      // for it (exactly the shape race-probe.log demonstrated against the
      // pre-fix code).
      it('(8c) an entry that becomes processed between being read and being deleted (concurrent-apply interleaving) is refused, never corrupted', async () => {
         const [raceEntry] = await db('timesheet_entries')
            .insert({
               account_id: A,
               user_id: ELIZA,
               employee_name: 'Eliza Smith',
               timesheet_name: `race-check_${RUN}.xlsx`,
               time_tracker_start_date: WEEK_START,
               time_tracker_end_date: WEEK_END,
               date: WEEK_START,
               entity: ENTITY_JKA,
               category: 'Phone Call',
               company_name: ALPHA_NAME,
               duration: 30,
               notes: `Delete-race probe (ref ${REF})`,
               is_processed: false,
               is_deleted: false
            })
            .returning('*');
         created.entryIds.push(raceEntry.timesheet_entry_id);

         // What a client displaying the "Delete" button would have read.
         const asRead = await db('timesheet_entries').where({ timesheet_entry_id: raceEntry.timesheet_entry_id }).first();
         expect(asRead.is_processed).to.equal(false);

         // An intervening apply (auto-ingest or a reviewer) claims it.
         await db('timesheet_entries').where({ timesheet_entry_id: raceEntry.timesheet_entry_id }).update({ is_processed: true });

         // The delete now runs — its own conditional UPDATE must see the LIVE
         // row, not the stale `asRead` snapshot, and affect zero rows.
         const deleted = await timesheetsService.deleteTimesheetEntryIfPending(db, A, raceEntry.timesheet_entry_id);
         expect(deleted, 'the conditional UPDATE claims nothing once the row is processed').to.have.lengthOf(0);

         const after = await db('timesheet_entries').where({ timesheet_entry_id: raceEntry.timesheet_entry_id }).select('is_processed', 'is_deleted').first();
         expect(after, 'never corrupted into {is_processed:false, is_deleted:true}').to.deep.equal({ is_processed: true, is_deleted: false });

         // The real HTTP route reaches the identical outcome: its OWN fast-path
         // read now also sees is_processed=true and answers 409/400, not 200.
         const res = await h.as('admin').delete(`/timesheets/deleteTimesheetEntry/${raceEntry.timesheet_entry_id}/${A}/${ADMIN}`);
         expect(res.status).to.be.oneOf([400, 409]);
         const final = await db('timesheet_entries').where({ timesheet_entry_id: raceEntry.timesheet_entry_id }).select('is_processed', 'is_deleted').first();
         expect(final).to.deep.equal({ is_processed: true, is_deleted: false });
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('POST /time-tracking/upload/:accountID/:userID (validation and authorization)', () => {
      const oneRow = overrides => [
         toBuilderRow({ key: 'v', day: 1, category: 'Phone Call', company: ALPHA_NAME, duration: 30, timeRange: '1400-1430', notes: `Validation probe ${RUN} ${Math.random().toString(36).slice(2, 7)}`, ...overrides })
      ];
      const expectRejected = async (res, status, pattern, label) => {
         expect(res.status, `${label}: ${JSON.stringify(res.body).slice(0, 400)}`).to.equal(status);
         const text = [res.body.message, ...(res.body.errors || [])].join(' | ');
         if (pattern) expect(text, label).to.match(pattern);
         return res.body;
      };
      const countEliza = async () => Number((await entriesFor(ELIZA).count({ n: '*' }).first()).n);

      it('a header renamed "Duration" -> "Minutes" -> 400 naming the missing header (nothing stored)', async () => {
         const before = await countEliza();
         const buffer = patchTrackerCells(buildTracker(oneRow()), { G5: 'Minutes' });
         const body = await expectRejected(await upload('admin', ADMIN, buffer, { owner: ELIZA }), 400, /missing required column: "Duration"/, 'header');
         expect(body.errors[0]).to.include('"Minutes"');
         expect(body.message).to.match(/failed validation\. The file was not saved/);
         expect(await countEliza()).to.equal(before);
      });

      it('a negative duration -> 400 naming the row', async () => {
         const before = await countEliza();
         const body = await expectRejected(await upload('admin', ADMIN, buildTracker(oneRow({ duration: -30 })), { owner: ELIZA }), 400, /row 6/, 'negative');
         expect(body.errors.join(' ')).to.include('Duration must be greater than 0 minutes (got "-30")');
         expect(await countEliza()).to.equal(before);
      });

      it('an entry dated before the tracker window (Start Date - 7 days) -> 400', async () => {
         const buffer = buildTracker([{ ...oneRow()[0], date: WEEK_MONDAY.subtract(10, 'day').format('YYYY-MM-DD') }]);
         const body = await expectRejected(await upload('admin', ADMIN, buffer, { owner: ELIZA }), 400, /at row 6 is outside the allowed range/, 'before window');
         expect(body.errors.join(' ')).to.include(`${WEEK_MONDAY.subtract(7, 'day').format('MM/DD/YYYY')} to ${dayjs(WEEK_END).format('MM/DD/YYYY')}`);
      });

      it('an entry dated in the future (tracker window extends past today) -> 400', async () => {
         const tomorrow = TODAY.add(1, 'day').format('YYYY-MM-DD');
         const buffer = buildTracker([{ ...oneRow()[0], date: tomorrow }], { startDate: TODAY.subtract(2, 'day').format('YYYY-MM-DD'), endDate: TODAY.add(5, 'day').format('YYYY-MM-DD') });
         const body = await expectRejected(await upload('admin', ADMIN, buffer, { owner: ELIZA }), 400, /outside the allowed range/, 'future');
         expect(body.errors.join(' ')).to.include(`to ${TODAY.format('MM/DD/YYYY')}`);
      });

      it('"1.5h" in the Duration column is accepted and stored as 90 minutes', async () => {
         await waitForNextSecond();
         const notes = `Hours-unit probe ${RUN}`;
         const buffer = patchTrackerCells(buildTracker(oneRow({ notes })), { G6: '1.5h' });
         const res = await upload('admin', ADMIN, buffer, { owner: ELIZA, fileName: 'hours_unit.xlsx' });
         expect(res.status, JSON.stringify(res.body).slice(0, 300)).to.equal(201);
         recordUpload(res.body);
         const rows = await entriesFor(ELIZA, { timesheet_name: res.body.fileName });
         expect(rows).to.have.lengthOf(1);
         expect(rows[0]).to.include({ notes, duration: 90 });
      });

      // DEFECT fix regression: the stored file name (and therefore the S3 key) used
      // to be computed from the upload timestamp BEFORE the per-employee advisory
      // lock was acquired, so two uploads for the same employee inside the same
      // second raced to the identical name and the second one's S3 PutObject
      // silently clobbered the first's object (both DB inserts still succeeded).
      // No waitForNextSecond() here on purpose — this is exactly the race the fix
      // targets.
      it('two uploads for the same employee within the same second get distinct stored file names (no S3 overwrite)', async () => {
         const notesA = `Concurrent probe A ${RUN} ${Math.random().toString(36).slice(2, 7)}`;
         const notesB = `Concurrent probe B ${RUN} ${Math.random().toString(36).slice(2, 7)}`;
         const bufferA = buildTracker(oneRow({ notes: notesA }));
         const bufferB = buildTracker(oneRow({ notes: notesB }));
         const [resA, resB] = await Promise.all([
            upload('admin', ADMIN, bufferA, { owner: ELIZA, fileName: 'concurrent-a.xlsx' }),
            upload('admin', ADMIN, bufferB, { owner: ELIZA, fileName: 'concurrent-b.xlsx' })
         ]);
         expect(resA.status, JSON.stringify(resA.body).slice(0, 300)).to.equal(201);
         expect(resB.status, JSON.stringify(resB.body).slice(0, 300)).to.equal(201);
         recordUpload(resA.body);
         recordUpload(resB.body);
         expect(resA.body.fileName, 'distinct stored file names').to.not.equal(resB.body.fileName);
         expect(resA.body.storedKey, 'distinct S3 keys').to.not.equal(resB.body.storedKey);

         const [rowsA, rowsB] = await Promise.all([entriesFor(ELIZA, { timesheet_name: resA.body.fileName }), entriesFor(ELIZA, { timesheet_name: resB.body.fileName })]);
         expect(rowsA).to.have.lengthOf(1);
         expect(rowsB).to.have.lengthOf(1);
         expect(rowsA[0].notes).to.equal(notesA);
         expect(rowsB[0].notes).to.equal(notesB);

         // Both S3 objects independently exist with their OWN correct content — the
         // second upload never overwrote the first's object.
         const [storedA, storedB] = await Promise.all([getObject(resA.body.storedKey), getObject(resB.body.storedKey)]);
         expect(sha256(zlib.gunzipSync(storedA.body))).to.equal(sha256(bufferA));
         expect(sha256(zlib.gunzipSync(storedB.body))).to.equal(sha256(bufferB));
      });

      it('"7.5" (hours typed into the minutes column) -> 400 naming the row', async () => {
         const buffer = buildTracker(oneRow({ duration: 7.5 }));
         const body = await expectRejected(await upload('admin', ADMIN, buffer, { owner: ELIZA }), 400, /row 6/, '7.5');
         expect(body.errors.join(' ')).to.include('Duration "7.5" is not a whole number of minutes');
      });

      it('an Apple Numbers file name -> 400 before any parsing', async () => {
         await expectRejected(await upload('admin', ADMIN, buildTracker(oneRow()), { owner: ELIZA, fileName: 'Eliza tracker.numbers' }), 400, /Apple Numbers files are not supported/, 'numbers');
      });

      // C11: decodeURIComponent(x-file-name) used to throw uncaught on invalid
      // percent-encoding, reaching the generic catch as an unannotated 500.
      // The route now catches it and answers 400. fileName: null skips the
      // helper's own (safely-encoded) x-file-name set so the raw malformed
      // header value below is the only one sent.
      it('invalid percent-encoding in x-file-name -> 400, not a 500', async () => {
         const before = await countEliza();
         await expectRejected(await upload('admin', ADMIN, buildTracker(oneRow()), { owner: ELIZA, fileName: null, headers: { 'x-file-name': '%ZZ' } }), 400, /[Ii]nvalid file name encoding/, 'bad percent-encoding');
         expect(await countEliza()).to.equal(before);
      });

      it('a file larger than 1 MB -> 400', async () => {
         const big = Buffer.concat([buildTracker(oneRow()), Buffer.alloc(1024 * 1024)]);
         await expectRejected(await upload('admin', ADMIN, big, { owner: ELIZA }), 400, /exceeds the 1MB size limit/, '>1MB');
      });

      it('an employee token uploading for another owner -> 403 (both the ?ownerUserID and the :userID form)', async () => {
         const before = Number((await entriesFor(BOB).count({ n: '*' }).first()).n);
         const bobTracker = buildTracker(oneRow(), { employeeName: 'Bob Jones' });
         await expectRejected(await upload('employee', ELIZA, bobTracker, { owner: BOB }), 403, /Only managers or admins can submit trackers for other users/, 'ownerUserID');
         await expectRejected(await upload('employee', BOB, bobTracker), 403, /Access denied for this user/, ':userID');
         expect(Number((await entriesFor(BOB).count({ n: '*' }).first()).n)).to.equal(before);
      });

      // C7: the B1 name lookup is now scoped to the OWNER's own record only
      // (validateUploadedTracker.js filters the active-user roster down to
      // :userID/ownerUserID before building the name map), so a B1 name that
      // isn't the intended owner's own display name is refused as "not valid
      // or not found" — it no longer even reaches the separate
      // metadata.userId-mismatch check (whose "belongs to a different user"
      // message this test used to expect), since name-block validation itself
      // now fails first.
      it('a tracker whose B1 names a different employee than the owner -> 400', async () => {
         const bobTracker = buildTracker(oneRow(), { employeeName: 'Bob Jones' });
         await expectRejected(await upload('admin', ADMIN, bobTracker, { owner: ELIZA }), 400, /Employee Name.*not valid or not found/, 'B1 mismatch');
      });

      it('an inactive owner -> 400; missing x-file-name -> 400; empty body -> 400', async () => {
         await expectRejected(await upload('admin', ADMIN, buildTracker(oneRow()), { owner: INACTIVE_USER }), 400, /inactive and cannot receive/, 'inactive');
         await expectRejected(await upload('admin', ADMIN, buildTracker(oneRow()), { owner: ELIZA, fileName: null }), 400, /include the original file name/, 'no name');
         await expectRejected(await upload('admin', ADMIN, Buffer.alloc(0), { owner: ELIZA }), 400, /empty or missing/, 'empty');
      });

      it('no token -> 401; a token for another tenant -> 403', async () => {
         const anon = await h.anonymous.post(`/time-tracking/upload/${A}/${ADMIN}`).set('Content-Type', 'application/octet-stream').set('x-file-name', 't.xlsx').send(buildTracker(oneRow()));
         expect(anon.status).to.equal(401);
         const foreign = await h.as('admin').post(`/time-tracking/upload/1/${ADMIN}`).set('Content-Type', 'application/octet-stream').set('x-file-name', 't.xlsx').send(buildTracker(oneRow()));
         expect(foreign.status).to.equal(403);
         expect(foreign.body.message).to.equal('Account access denied');
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   // Astra finding 2 follow-up: step (1) above only ever proves the OWNER's
   // byte-for-byte passthrough works end to end — it says nothing about the
   // REBUILT workbook every other account actually downloads
   // (template-builder.js buildTemplate; the tenant-isolation coverage in
   // coverage-timetracking-timesheets.integration.spec.js checks that
   // rebuilt buffer for leaked account-1 names but never fills, uploads, or
   // bills off of it). This block drives that same rebuilt workbook through
   // the complete fill -> upload -> auto-ingest -> finalize pipeline, on its
   // own dedicated customer/job so it can't perturb the Alpha/Beta figures
   // asserted earlier in this file. Kept self-contained (its own it()s) and
   // cleaned up the same way everything else in this spec is: created.customers
   // / created.entryIds / created.timesheetNames / created.s3Keys feed the
   // existing generic after() above, so no new teardown code is needed here.
   describe('non-owner rebuilt template round trip (account 9001)', () => {
      const NON_OWNER_NAME = `Tracker E2E NonOwner ${RUN}`;
      const NON_OWNER_ROWS = [
         { day: 0, category: 'Phone Call', duration: 30, timeRange: '0930-1000', notes: `Non-owner rebuild round trip call (ref ${REF})` },
         { day: 1, category: 'Email', duration: 50, timeRange: '1400-1450', notes: `Non-owner rebuild round trip email (ref ${REF})` }
      ];
      const NON_OWNER_EXPECTED = NON_OWNER_ROWS.map(r => expectedAmounts(r.duration));
      const NON_OWNER_TOTAL = money(NON_OWNER_EXPECTED.reduce((sum, a) => sum + a.total, 0));

      let nonOwnerCustomer;
      let nonOwnerJobId;
      let nonOwnerTemplateBuffer;
      let nonOwnerUpload;

      it('download: account 9001 receives a REBUILT workbook (never the owner’s raw bytes), scoped to its own catalogs', async () => {
         nonOwnerCustomer = await createCustomer(NON_OWNER_NAME, 'nonOwner');
         nonOwnerJobId = await createJob(nonOwnerCustomer.customer_id, JOB_TYPE_GENERAL_CONSULTING, 'nonOwner');

         const res = await h.as('admin').get(`/time-tracking/template/latest/${A}/${ADMIN}`).buffer(true).parse(binaryParser);
         expect(res.status).to.equal(200);
         expect(res.headers['x-tracker-customers'], 'a non-owner account always gets a rebuild').to.not.equal(undefined);
         expect(sha256(res.body)).to.not.equal(sha256(templateBuffer), 'never the owner’s raw bytes');
         nonOwnerTemplateBuffer = res.body;

         const wb = XLSX.read(nonOwnerTemplateBuffer, { type: 'buffer' });
         expect(wb.SheetNames[0], 'the upload validator reads the FIRST sheet').to.equal('Time');
         expect(wb.SheetNames).to.include.members(['Time', 'Employee Names', 'Instructions', 'Categories', 'Entity']);
         const sheetValues = name => (wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : []);
         const employeeNames = sheetValues('Employee Names').map(r => r[0]).filter(Boolean);
         expect(employeeNames, 'account 9001’s own roster is what fills the visible sheet').to.include('Eliza Smith');
         const flatText = wb.SheetNames.map(n => sheetValues(n).flat().join(' | ')).join(' \n ');
         expect(flatText, 'no account-1 staff name leaks anywhere in the rebuilt workbook').to.not.match(/Jim Kimmel|Kasi Kimmel|Marsha Johnson|Kati Strough|Kirsten Knight|Sabraya Clay/);
      });

      it('fill -> upload: the rebuilt workbook fills and uploads exactly like the owner template', async () => {
         const trackerBuffer = buildTrackerFromTemplate({
            templateBuffer: nonOwnerTemplateBuffer,
            employeeName: 'Eliza Smith',
            startDate: WEEK_START,
            endDate: WEEK_END,
            rows: NON_OWNER_ROWS.map(r => ({ date: DAY(r.day), entity: ENTITY_JKA, category: r.category, companyName: NON_OWNER_NAME, duration: r.duration, timeRange: r.timeRange, notes: r.notes }))
         });
         await waitForNextSecond();
         const res = await upload('admin', ADMIN, trackerBuffer, { owner: ELIZA, fileName: `Eliza_Smith_nonowner_rebuild_${RUN}.xlsx` });
         expect(res.status, JSON.stringify(res.body).slice(0, 400)).to.equal(201);
         recordUpload(res.body);
         nonOwnerUpload = res.body;
         expect(nonOwnerUpload.inserted_count).to.equal(NON_OWNER_ROWS.length);
         expect(nonOwnerUpload.duplicates_skipped).to.deep.equal([]);
      });

      it('auto-ingest -> finalize: transactions and the statement total match the independently-computed 6-minute-rounded figures', async () => {
         const rows = await entriesFor(ELIZA, { timesheet_name: nonOwnerUpload.fileName }).orderBy('timesheet_entry_id', 'asc');
         expect(rows).to.have.lengthOf(NON_OWNER_ROWS.length);
         const entryIds = rows.map(r => r.timesheet_entry_id);
         created.entryIds.push(...entryIds);

         const result = await processEntries({ db, accountId: A, userId: ADMIN, entryIds });
         expect(result).to.include({ processed: NON_OWNER_ROWS.length, autoInserted: NON_OWNER_ROWS.length, held: 0, skipped: 0 });

         const txns = await transactionsByEntry(entryIds);
         entryIds.forEach((id, i) => {
            const linked = txns.get(id);
            expect(linked, `entry ${id} produced exactly one transaction`).to.have.lengthOf(1);
            const [txn] = linked;
            expect(Number(txn.quantity), `row ${i} quantity (hours)`).to.equal(NON_OWNER_EXPECTED[i].quantity);
            expect(Number(txn.unit_cost)).to.equal(RATE);
            expect(money(txn.total_transaction), `row ${i} total`).to.equal(NON_OWNER_EXPECTED[i].total);
            expect(txn.customer_id).to.equal(nonOwnerCustomer.customer_id);
            expect(txn.customer_job_id).to.equal(nonOwnerJobId);
            expect(txn.is_transaction_billable).to.equal(true);
         });

         const finalize = expectEnvelopeOk(
            await h
               .as('admin')
               .post(`/invoices/createInvoice/${A}/${ADMIN}`)
               .send({
                  invoiceConfiguration: {
                     invoicesToCreate: [{ customer_id: nonOwnerCustomer.customer_id, showWriteOffs: false, invoiceNote: `Non-owner rebuild round trip ${RUN}` }],
                     invoiceCreationSettings: { isFinalized: true, isRoughDraft: false, isCsvOnly: false, globalInvoiceNote: 'Thank you for your business.' }
                  }
               }),
            'finalize nonOwner'
         );
         if (finalize.fileLocation) created.s3Keys.push(finalize.fileLocation);
         expect(finalize.skippedCustomers).to.deep.equal([]);
         expect(finalize.invoicesWithDetail).to.have.lengthOf(1);
         const [detail] = finalize.invoicesWithDetail;
         expect(money(detail.invoiceTotal)).to.equal(NON_OWNER_TOTAL);
         expect(money(detail.transactions.transactionsTotal)).to.equal(NON_OWNER_TOTAL);

         const parent = await db('customer_invoices').where({ account_id: A, customer_id: nonOwnerCustomer.customer_id }).whereNull('parent_invoice_id').first();
         expect(money(parent.remaining_balance_on_invoice)).to.equal(NON_OWNER_TOTAL);
         expect(money(parent.total_amount_due)).to.equal(NON_OWNER_TOTAL);

         await expectThreeViewsAgree(nonOwnerCustomer.customer_id, NON_OWNER_TOTAL, 'non-owner rebuild round trip');
      });
   });
});

function cents(v) {
   return Math.round(Number(v) * 100);
}
