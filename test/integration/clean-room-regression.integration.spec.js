/**
 * CLEAN-ROOM regression — three statement cycles on a fresh database.
 *
 * Runs ONLY against the sandbox database `ds2_clean` (schema-only snapshot +
 * test/fixtures/clean-room-seed.sql). The run resets the database first
 * (TRUNCATE every table, RESTART IDENTITY, reseed) so it is repeatable, and
 * leaves the end state in place for inspection.
 *
 *   npm run test:cleanroom
 *   DS2_ENV_FILE=.env.clean mocha --require test/setup.js test/integration/clean-room-regression.integration.spec.js --exit --timeout 180000
 *
 * Everything is driven through the Express app with supertest and a Bearer JWT
 * for the seeded Super Admin (sa@clean.test, user 1). The EXPECTED ledger is
 * kept in this file as plain numbers, computed by hand from the entries the
 * spec makes — never from the engine — and after every step the DB rows, the
 * billing engine, the Account Audit and the Accounts Receivable view are all
 * checked against it. Statement PDFs are downloaded from the run zip, unzipped
 * and read back with pdftotext; the CSV report is compared line by line.
 *
 * Time travel: the API always stamps statements with today's (America/Phoenix)
 * date, so between cycles the spec moves every committed ledger row back 31
 * days (advanceCalendar) — the same thing the calendar would have done. Dates
 * given to the API are always relative to "now" and recede with each shift.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');

// test/setup.js seeds S3_* placeholders before any env file is read; re-apply
// the env file's S3 settings so PDFs land in (and are read back from) the
// clean-room MinIO bucket. Must precede ../../src/app (s3.js reads config at load).
const ENV_FILE = process.env.DS2_ENV_FILE || '.env.clean';
{
   const parsed = dotenv.config({ path: ENV_FILE, override: false }).parsed || {};
   ['S3_BUCKET_NAME', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'DATABASE_NAME'].forEach(key => {
      if (parsed[key]) process.env[key] = parsed[key];
   });
}

const knex = require('knex');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const unzipper = require('unzipper');
const supertest = global.supertest || require('supertest');
const app = require('../../src/app');
const config = require('../../config');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const { auditCustomerLedger } = require('../../src/endpoints/accountAudit/account-audit-logic');
const accountAuditService = require('../../src/endpoints/accountAudit/account-audit-service');
const accountsReceivableService = require('../../src/endpoints/accountsReceivable/accounts-receivable-service');

// The audit job asks Bedrock for an optional narrative; keep the clean room off
// AWS (the audit itself does not depend on it).
try {
   const bedrockMod = require('../../src/ai_integrations/bedrock');
   if (typeof bedrockMod._setClientsForTest === 'function') {
      bedrockMod._setClientsForTest({
         bedrockClient: {
            send: async () => {
               throw new Error('clean room: Bedrock disabled');
            }
         },
         s3Client: null
      });
   }
} catch (e) {
   // no test hook — the narrative step is try/catch'd server side
}

const CLEAN_DB = 'ds2_clean';
const SEED_PATH = path.join(__dirname, '..', 'fixtures', 'clean-room-seed.sql');
const PDFTOTEXT = process.env.PDFTOTEXT_BIN || '/opt/homebrew/bin/pdftotext';
const BILLING_TZ = process.env.BILLING_TIMEZONE || 'America/Phoenix';
const MONTH_GAP_DAYS = 31;

const A = 1; // account
const SA = { id: 1, email: 'sa@clean.test', display: 'Sam Superadmin', rate: 200 };
const ADMIN = { id: 2, email: 'admin@clean.test', rate: 150 };
const STAFF = { id: 3, email: 'staff@clean.test', rate: 100 };
const JOB_TYPE = { form1040: 1, form1120s: 2, bookkeeping: 3, payroll: 4 };
const GWD = { taxPrep: 1, meeting: 2, bookkeeping: 3, admin: 4 };
const CATEGORY = { tax: 1, accounting: 2 };
const SEED_RETAINER_ID = 1; // C's $1,000 retainer (stored -1000)

// Customers as seeded (ids are what RESTART IDENTITY + seed produce).
// display_name is business_name || customer_name (updateCustomer recomputes it that way).
const CUST = {
   A: { id: 1, display: 'Alice Anderson', billTo: 'Alice Anderson', infoId: 1, jobs: { form1040: 1 } },
   B: { id: 2, display: 'Baxter Brewing LLC', billTo: 'Baxter Brewing LLC', infoId: 2, jobs: { form1120s: 2, bookkeeping: 3 } },
   C: { id: 3, display: 'Carver Consulting Inc', billTo: 'Carver Consulting Inc', infoId: 3, jobs: { form1120s: 4, bookkeeping: 5 } },
   D: { id: 4, display: 'Dana Delgado', billTo: 'Dana Delgado', infoId: 4, jobs: { form1040: 6, payroll: 7 } },
   E: { id: 5, display: 'Eastside Dental PC', billTo: 'Eastside Dental PC', infoId: 5, jobs: { bookkeeping: 8 } },
   F: { id: 6, display: 'Frank Foster', billTo: 'Frank Foster', infoId: 6, jobs: { form1040: 9, payroll: 10 } }
};
const ALL_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

// ── EXPECTED LEDGER (hand-computed; see the entries each step makes) ──────────
// Month 1
//   A  time 1.25h×200=250 + 0.5h×100=50 + charge 45 (+ 0.75h×150=112.50 NON-billable) → 345
//   B  2h×150=300 + 3.5h×100=350 + charge 30 → 680
//   C  2h×150=300 retainer-funded (payment -300) + 1h×200=200 → charges 500, payments -300, due 200; retainer 1000-300=700
//   D  2h×150=300 − job write-down 50 + charge 75 → 325
//   E  4h×100=400 + 0.25h×200=50 (left unbilled)           F  1.5h×200=300 (left unbilled) + $40 write-down on a job with no time (credited on F's first statement)
const M1 = {
   A: { bb: 0, charges: 345, payments: 0, writeoffs: 0, retainers: 0, total: 345 },
   B: { bb: 0, charges: 680, payments: 0, writeoffs: 0, retainers: 0, total: 680 },
   // Statement summary for the retainer customer: bb + charges = 500 before the
   // retainer draw, 300 drawn from the retainer, 700 left on it, 200 due.
   C: { bb: 0, charges: 500, payments: -300, writeoffs: 0, retainers: -700, total: 200, beforeRetainer: 500, retainerApplied: -300 },
   D: { bb: 0, charges: 325, payments: 0, writeoffs: 0, retainers: 0, total: 325 }
};
// Between months 1 and 2: A pays 345 (then NSF reversal, then the reversal is
// deleted → paid), B pays 400 → 280 left, C pays 300 on a 200 balance with
// captureOverpayment → 0 left + $100 prepayment, D unchanged until bill day
// (invoice-linked write-off 25 → 300), E's unbilled work is edited to 450 + 50.
const AFTER_M1 = { A: 0, B: 280, C: 0, D: 325 };
const D_BILL_DAY_WRITEOFF = 25;
// Month 2 new work: A 1h×200, B 2h×100, C 1h×150, D 0.5h×100, E none (450+50 old work)
const M2 = {
   A: { bb: 0, charges: 200, payments: 0, writeoffs: 0, retainers: 0, total: 200 },
   B: { bb: 280, charges: 200, payments: 0, writeoffs: 0, retainers: 0, total: 480 },
   C: { bb: 0, charges: 150, payments: 0, writeoffs: 0, retainers: -800, total: 150 },
   D: { bb: 300, charges: 50, payments: 0, writeoffs: 0, retainers: 0, total: 350 },
   E: { bb: 0, charges: 500, payments: 0, writeoffs: 0, retainers: 0, total: 500 }
};
// Between months 2 and 3: B pays 100 against the absorbed month-1 statement
// (remapped) → 380, E pays 500 → 0.
const AFTER_M2 = { A: 200, B: 380, C: 150, D: 350, E: 0 };
// Month 3 new work: A 0.5h×200, B 1h×150, C 2h×100, D none, E 1h×100 with a
// $150 job write-down (credit → skipped), F 1h×100 on top of its 300 less the
// $40 write-down entered in month 1 on F's payroll job (a job with no time —
// the credit still belongs to the customer): 300 + 100 − 40 = 360.
const M3 = {
   A: { bb: 200, charges: 100, payments: 0, writeoffs: 0, retainers: 0, total: 300 },
   B: { bb: 380, charges: 150, payments: 0, writeoffs: 0, retainers: 0, total: 530 },
   C: { bb: 150, charges: 200, payments: 0, writeoffs: 0, retainers: -800, total: 350 },
   D: { bb: 350, charges: 0, payments: 0, writeoffs: 0, retainers: 0, total: 350 },
   F: { bb: 0, charges: 360, payments: 0, writeoffs: 0, retainers: 0, total: 360 }
};
const E_CREDIT_BALANCE = -50;
const END_OUTSTANDING = { A: 300, B: 530, C: 350, D: 350, E: 0, F: 360 };

const num = v => Number(v);
const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const todayBilling = () => dayjs().tz(BILLING_TZ).format('YYYY-MM-DD');
const daysAgo = n => dayjs().tz(BILLING_TZ).subtract(n, 'day').format('YYYY-MM-DD');
const ymd = d => (d == null ? null : dayjs(d).format('YYYY-MM-DD'));
const YEAR = todayBilling().slice(0, 4);
const invNo = n => `INV-${YEAR}-${String(n).padStart(5, '0')}`;
const fmt = n => Number(n).toFixed(2);
const flat = text => text.replace(/\s+/g, ' ');
const binaryParser = (res, cb) => {
   const chunks = [];
   res.on('data', chunk => chunks.push(chunk));
   res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('clean-room regression: three statement cycles on ds2_clean', function () {
   this.timeout(180_000);

   let db;
   let token;
   let scratchDir;

   // Rows created along the way (ids), by key.
   const txn = {};
   const invoice = {}; // e.g. invoice.A1 = parent row of A's month-1 statement
   const payment = {};
   const writeoff = {};
   const pdfTexts = {}; // flattened pdftotext output per statement, e.g. pdfTexts.C1
   let prepaymentRetainerId;
   let ePayrollJobId;

   // ── HTTP helpers ───────────────────────────────────────────────────────────
   const authed = req => req.set('Authorization', `Bearer ${token}`);
   const post = (url, body) => authed(supertest(app).post(url).send(body));
   const put = (url, body) => authed(supertest(app).put(url).send(body));
   const get = url => authed(supertest(app).get(url));
   const del = (url, body) => (body === undefined ? authed(supertest(app).delete(url)) : authed(supertest(app).delete(url).send(body)));
   const expectOk = (res, label) => {
      expect(res.status, `${label}: HTTP status`).to.equal(200);
      expect(res.body.status, `${label}: body.status — ${res.body.message}`).to.equal(200);
      return res.body;
   };
   // Legacy routers answer HTTP 200 + body.status 500; the user router speaks
   // real HTTP codes. Both mean "refused".
   const expectRefused = (res, label, includes) => {
      const refused = (res.status === 200 && res.body.status === 500) || res.status >= 400;
      expect(refused, `${label}: expected a refusal, got HTTP ${res.status} body.status ${res.body.status} — ${res.body.message}`).to.equal(true);
      if (includes) expect(res.body.message, `${label}: message`).to.include(includes);
      return res.body;
   };

   // ── DB helpers ─────────────────────────────────────────────────────────────
   const parentsFor = customerId => db('customer_invoices').where({ account_id: A, customer_id: customerId }).whereNull('parent_invoice_id').orderBy([{ column: 'invoice_date', order: 'asc' }, { column: 'customer_invoice_id', order: 'asc' }]);
   const childrenOf = parentId => db('customer_invoices').where({ account_id: A, parent_invoice_id: parentId }).orderBy([{ column: 'created_at', order: 'asc' }, { column: 'customer_invoice_id', order: 'asc' }]);
   const invoiceRow = id => db('customer_invoices').where({ customer_invoice_id: id }).first();
   const txnRow = id => db('customer_transactions').where({ transaction_id: id }).first();
   const paymentRow = id => db('customer_payments').where({ payment_id: id }).first();
   // The customer's current statement chain: newest parent(s) by date, latest snapshot.
   const chainState = async customerId => {
      const parents = await db('customer_invoices').where({ account_id: A, customer_id: customerId }).whereNull('parent_invoice_id').orderBy([{ column: 'invoice_date', order: 'desc' }, { column: 'customer_invoice_id', order: 'desc' }]);
      if (!parents.length) return { parent: null, latest: null, remaining: 0 };
      const parent = parents[0];
      const kids = await childrenOf(parent.customer_invoice_id);
      const latest = kids.length ? kids[kids.length - 1] : parent;
      return { parent, latest, remaining: money(latest.remaining_balance_on_invoice) };
   };
   const jobFamilyTotal = async rootJobId => {
      const rows = await db('customer_jobs').where({ account_id: A }).andWhere(b => b.where('customer_job_id', rootJobId).orWhere('parent_job_id', rootJobId)).orderBy('customer_job_id', 'desc');
      return money(rows[0].current_job_total);
   };

   // Move every committed ledger row `days` back — the calendar advances.
   const advanceCalendar = async days => {
      const iv = `${days} days`;
      await db.raw(
         `UPDATE customer_invoices SET invoice_date = invoice_date - ?::int, due_date = due_date - ?::int, start_date = start_date - ?::int, end_date = end_date - ?::int, fully_paid_date = fully_paid_date - ?::int, created_at = created_at - ?::interval WHERE account_id = ?`,
         [days, days, days, days, days, iv, A]
      );
      await db.raw(`UPDATE customer_payments SET payment_date = payment_date - ?::int, created_at = created_at - ?::interval WHERE account_id = ?`, [days, iv, A]);
      await db.raw(`UPDATE customer_writeoffs SET writeoff_date = writeoff_date - ?::int, created_at = created_at - ?::interval WHERE account_id = ?`, [days, iv, A]);
      await db.raw(`UPDATE customer_retainers_and_prepayments SET created_at = created_at - ?::interval WHERE account_id = ?`, [iv, A]);
      await db.raw(`UPDATE customer_transactions SET transaction_date = transaction_date - ?::int, created_at = created_at - ?::interval WHERE account_id = ?`, [days, iv, A]);
      await db.raw(`UPDATE customer_jobs SET created_at = created_at - ?::interval WHERE account_id = ?`, [iv, A]);
   };

   // ── the three balance views ────────────────────────────────────────────────
   const engineFor = async customerId => {
      const invoicesToCreate = [{ customer_id: customerId, showWriteOffs: false }];
      const queryData = await fetchInitialQueryItems(db, { [customerId]: invoicesToCreate[0] }, A, { billingDate: todayBilling() });
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
   const expectThreeViewsAgree = async (key, expected, label) => {
      const customerId = CUST[key].id;
      const [engine, audit, ar, chain] = await Promise.all([engineFor(customerId), auditFor(customerId), arRowFor(customerId), chainState(customerId)]);
      expect(chain.remaining, `${label} ${key}: chain remaining`).to.equal(expected);
      expect(engine.outstandingInvoiceTotal, `${label} ${key}: engine outstanding`).to.equal(expected);
      expect(money(audit.totals.outstanding_invoices), `${label} ${key}: audit outstanding`).to.equal(expected);
      if (expected > 0) {
         expect(ar, `${label} ${key}: AR row present`).to.not.equal(null);
         expect(money(ar.total_outstanding), `${label} ${key}: AR total_outstanding`).to.equal(expected);
      } else {
         expect(ar, `${label} ${key}: AR excludes settled customers`).to.equal(null);
      }
      return { engine, audit, ar, chain };
   };

   // ── API actions ────────────────────────────────────────────────────────────
   const logEntry = async (key, custKey, { type, qty, rate, user, jobId, desc, billable = true, retainerId = null, date = daysAgo(2) }) => {
      const cust = CUST[custKey];
      const before = await db('customer_transactions').where({ account_id: A, customer_id: cust.id }).pluck('transaction_id');
      expectOk(
         await post(`/transactions/createTransaction/${A}/${SA.id}`, {
            transaction: {
               accountID: A,
               customerID: cust.id,
               customerJobID: jobId,
               selectedJobID: jobId,
               selectedRetainerID: retainerId,
               customerInvoicesID: null,
               loggedByUserID: SA.id,
               loggedForUserID: user.id,
               selectedGeneralWorkDescriptionID: type === 'Charge' ? GWD.admin : GWD.taxPrep,
               detailedJobDescription: desc,
               transactionDate: date,
               transactionType: type,
               quantity: qty,
               unitCost: rate,
               totalTransaction: (qty * rate).toFixed(2),
               isTransactionBillable: billable,
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
      const rows = await db('customer_transactions').where({ account_id: A, customer_id: cust.id }).whereNotIn('transaction_id', before);
      expect(rows, `${key}: one row inserted`).to.have.lengthOf(1);
      const [row] = rows;
      txn[key] = row.transaction_id;
      expect(num(row.quantity), `${key} quantity`).to.equal(qty);
      expect(num(row.unit_cost), `${key} unit_cost`).to.equal(rate);
      expect(num(row.total_transaction), `${key} total = qty × rate`).to.equal(money(qty * rate));
      expect(row.is_transaction_billable, `${key} billable`).to.equal(billable);
      expect(row.customer_invoice_id, `${key} unbilled`).to.equal(null);
      expect(row.customer_job_id, `${key} job`).to.equal(jobId);
      return row;
   };

   const paymentPayload = (custKey, overrides) => ({
      accountID: A,
      customerID: CUST[custKey].id,
      selectedJobID: null,
      selectedRetainerID: null,
      loggedForUserID: null,
      loggedByUserID: SA.id,
      transactionDate: daysAgo(1),
      formOfPayment: 'Check',
      paymentReferenceNumber: '100',
      isTransactionBillable: true,
      note: null,
      foundInvoiceID: null,
      holdAsPrepayment: false,
      captureOverpayment: false,
      ...overrides
   });
   const pay = async (key, custKey, overrides, label) => {
      const before = await db('customer_payments').where({ account_id: A, customer_id: CUST[custKey].id }).pluck('payment_id');
      const body = expectOk(await post(`/payments/createPayment/${A}/${SA.id}`, { payment: paymentPayload(custKey, overrides) }), label || `createPayment ${key}`);
      const rows = await db('customer_payments').where({ account_id: A, customer_id: CUST[custKey].id }).whereNotIn('payment_id', before);
      expect(rows, `${key}: one payment row inserted`).to.have.lengthOf(1);
      payment[key] = rows[0].payment_id;
      return { body, row: rows[0] };
   };
   const writeOffPayload = (custKey, overrides) => ({
      accountID: A,
      customerID: CUST[custKey].id,
      loggedByUserID: SA.id,
      loggedForUserID: null,
      selectedJobID: null,
      customerInvoiceID: null,
      selectedDate: daysAgo(1),
      writeOffReason: 'Adjustment',
      writeoffReason: 'Adjustment',
      note: null,
      ...overrides
   });
   const writeOff = async (key, custKey, overrides, label) => {
      const before = await db('customer_writeoffs').where({ account_id: A, customer_id: CUST[custKey].id }).pluck('writeoff_id');
      const body = expectOk(await post(`/writeOffs/createWriteOffs/${A}/${SA.id}`, { writeOff: writeOffPayload(custKey, overrides) }), label || `createWriteOffs ${key}`);
      const rows = await db('customer_writeoffs').where({ account_id: A, customer_id: CUST[custKey].id }).whereNotIn('writeoff_id', before);
      expect(rows, `${key}: one write-off row inserted`).to.have.lengthOf(1);
      writeoff[key] = rows[0].writeoff_id;
      return { body, row: rows[0] };
   };

   const finalize = async (label, keys, settings = {}) =>
      expectOk(
         await post(`/invoices/createInvoice/${A}/${SA.id}`, {
            invoiceConfiguration: {
               invoicesToCreate: keys.map(k => ({ customer_id: CUST[k].id, showWriteOffs: false, invoiceNote: `${label} — ${k}` })),
               // isCsvOnly alongside isFinalized puts the CSV report in the run zip.
               invoiceCreationSettings: { isFinalized: true, isRoughDraft: false, isCsvOnly: true, globalInvoiceNote: 'Thank you for your business.', ...settings }
            }
         }),
         label
      );

   const downloadZip = async fileLocation => {
      const res = await authed(supertest(app).get(`/invoices/downloadFile/${A}/${SA.id}`).query({ fileLocation })).buffer(true).parse(binaryParser);
      expect(res.status, `downloadFile ${fileLocation}`).to.equal(200);
      expect(Buffer.isBuffer(res.body)).to.equal(true);
      expect(res.body.subarray(0, 2).toString(), 'zip magic').to.equal('PK');
      const directory = await unzipper.Open.buffer(res.body);
      const files = {};
      for (const entry of directory.files) files[entry.path] = await entry.buffer();
      return files;
   };
   const pdfText = buffer => {
      const file = path.join(scratchDir, `statement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
      fs.writeFileSync(file, buffer);
      try {
         return flat(execFileSync(PDFTOTEXT, ['-layout', file, '-'], { encoding: 'utf8' }));
      } finally {
         fs.unlinkSync(file);
      }
   };
   const pdfNameFor = key => `${CUST[key].display.replace(/ /g, '_')}.pdf`;
   const csvRowFor = (key, exp) => `${CUST[key].id},${CUST[key].display.replace(/,/g, '')},${exp.bb},${exp.payments},${exp.charges},${exp.writeoffs},${exp.retainers},${exp.total}`;

   // Record the newest parent statement of each customer under a slot name
   // BEFORE anything is asserted about it, so a PDF/CSV mismatch in one
   // statement cannot cascade into later steps.
   const recordParents = async slots => {
      for (const [key, slot] of Object.entries(slots)) {
         const parents = await parentsFor(CUST[key].id);
         invoice[slot] = parents[parents.length - 1];
      }
   };

   // Assert one statement: DB parent row + PDF text + CSV row.
   const expectStatement = async (key, exp, { number, files, csvLines, pdfExtras = [] }) => {
      const parents = await parentsFor(CUST[key].id);
      const parent = parents[parents.length - 1];
      expect(parent.invoice_number, `${key}: invoice number`).to.equal(number);
      expect(num(parent.beginning_balance), `${key}: beginning_balance`).to.equal(exp.bb);
      expect(num(parent.total_charges), `${key}: total_charges`).to.equal(exp.charges);
      expect(num(parent.total_payments), `${key}: total_payments`).to.equal(exp.payments);
      expect(num(parent.total_write_offs), `${key}: total_write_offs`).to.equal(exp.writeoffs);
      expect(num(parent.total_retainers), `${key}: total_retainers`).to.equal(exp.retainers);
      expect(num(parent.total_amount_due), `${key}: total_amount_due`).to.equal(exp.total);
      expect(num(parent.remaining_balance_on_invoice), `${key}: remaining`).to.equal(exp.total);
      expect(parent.is_invoice_paid_in_full, `${key}: paid flag`).to.equal(exp.total === 0);
      expect(ymd(parent.invoice_date), `${key}: invoice_date`).to.equal(todayBilling());
      expect(parent.notes, `${key}: fresh statement has no notes`).to.equal(null);
      expect(parent.invoice_file_location, `${key}: invoice image key`).to.be.a('string');

      const pdf = files[pdfNameFor(key)];
      expect(pdf, `${key}: ${pdfNameFor(key)} in the run zip (${Object.keys(files).join(', ')})`).to.exist;
      const text = pdfText(pdf);
      expect(text, `${key}: PDF invoice number`).to.include(number);
      expect(text, `${key}: PDF Bill To`).to.include(`Bill To: ${CUST[key].billTo}`);
      expect(text, `${key}: PDF beginning balance`).to.include(`Beginning Balance: ${fmt(exp.bb)}`);
      expect(text, `${key}: PDF new charges`).to.include(`Total New Charges: ${fmt(exp.charges)}`);
      expect(text, `${key}: PDF balance due`).to.include(`Balance Due: ${fmt(exp.total)}`);
      expect(text, `${key}: PDF due date`).to.include(`Payment Due Date: ${dayjs(todayBilling()).add(16, 'day').format('MM/DD/YYYY')}`);
      pdfExtras.forEach(extra => expect(text, `${key}: PDF ${extra}`).to.include(extra));

      expect(csvLines, `${key}: CSV row`).to.include(csvRowFor(key, exp));
      return { parent, text };
   };

   const accountsWithBalance = async () => {
      const body = expectOk(await get(`/invoices/createInvoice/AccountsWithBalance/${A}/${SA.id}`), 'AccountsWithBalance');
      return body.outstandingBalanceList.activeOutstandingBalancesData.activeOutstandingBalances;
   };

   const customerUpdatePayload = (key, overrides) => {
      const c = CUST[key];
      const seed = {
         A: { name: 'Alice Anderson', business: null, street: '11 Aspen Ct', city: 'Mesa', zip: '85201', email: 'alice@clean.test', phone: '480-555-0101' },
         D: { name: 'Dana Delgado', business: null, street: '44 Desert Ln', city: 'Chandler', zip: '85224', email: 'dana@clean.test', phone: '480-555-0104' },
         F: { name: 'Frank Foster', business: null, street: '66 Foothill Dr', city: 'Phoenix', zip: '85018', email: 'frank@clean.test', phone: '480-555-0106' }
      }[key];
      return {
         accountID: A,
         userID: SA.id,
         customerID: c.id,
         customerInfoID: c.infoId,
         customerBusinessName: seed.business,
         customerName: seed.name,
         isCommercialCustomer: false,
         isCustomerActive: true,
         isCustomerBillable: true,
         isCustomerRecurring: false,
         recurringCustomerID: null,
         customerStreet: seed.street,
         customerCity: seed.city,
         customerState: 'AZ',
         customerZip: seed.zip,
         customerEmail: seed.email,
         customerPhone: seed.phone,
         isCustomerAddressActive: true,
         isCustomerPhysicalAddress: true,
         isCustomerBillingAddress: true,
         isCustomerMailingAddress: true,
         ...overrides
      };
   };

   // ── setup ──────────────────────────────────────────────────────────────────
   before(async function () {
      if (process.env.DATABASE_NAME !== CLEAN_DB) {
         throw new Error(`Refusing to run: DATABASE_NAME is '${process.env.DATABASE_NAME}', the clean room only runs against '${CLEAN_DB}' (DS2_ENV_FILE=.env.clean).`);
      }
      if (!fs.existsSync(PDFTOTEXT)) throw new Error(`pdftotext not found at ${PDFTOTEXT}`);
      db = knex({
         client: 'postgres',
         connection: {
            host: process.env.DB_DEV_HOST,
            port: Number(process.env.DB_DEV_PORT || 5432),
            user: process.env.DATABASE_USER,
            password: process.env.DATABASE_PASSWORD,
            database: CLEAN_DB,
            ssl: String(process.env.DB_SSL_DISABLE).toLowerCase() === 'true' ? false : { rejectUnauthorized: false }
         },
         pool: { min: 0, max: 6 }
      });
      const { rows } = await db.raw('SELECT current_database() AS db');
      expect(rows[0].db).to.equal(CLEAN_DB);
      app.set('db', db);
      token = jwt.sign({ user_id: SA.id }, config.JWT_SECRET, { subject: SA.email, expiresIn: '2h', algorithm: 'HS256' });
      scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-clean-room-'));

      // Reset: wipe every table, restart identities, reseed.
      const tables = (await db.raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map(r => `"${r.table_name}"`);
      await db.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
      await db.raw(fs.readFileSync(SEED_PATH, 'utf8'));
   });

   after(async () => {
      if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
      if (db) await db.destroy();
   });

   // ═══════════════════════════════════════════════════════════════════════════
   // 0. seed sanity
   // ═══════════════════════════════════════════════════════════════════════════
   it('0. the clean room starts from the seed alone', async () => {
      expect(await db('customers').where({ account_id: A }).count({ c: '*' }).first().then(r => Number(r.c))).to.equal(6);
      expect(await db('customer_jobs').count({ c: '*' }).first().then(r => Number(r.c))).to.equal(10);
      expect(await db('customer_invoices').count({ c: '*' }).first().then(r => Number(r.c))).to.equal(0);
      expect(await db('customer_transactions').count({ c: '*' }).first().then(r => Number(r.c))).to.equal(0);
      const retainer = await db('customer_retainers_and_prepayments').where({ retainer_id: SEED_RETAINER_ID }).first();
      expect(num(retainer.current_amount)).to.equal(-1000);
      const me = expectOk(await get(`/user/fetchSingleUser/${A}/${SA.id}`), 'fetchSingleUser');
      expect(me.activeUserData.activeUser.access_level).to.equal('Super Admin');
      expect(await accountsWithBalance(), 'nothing to bill yet').to.deep.equal([]);
   });

   // ═══════════════════════════════════════════════════════════════════════════
   // 1. month 1
   // ═══════════════════════════════════════════════════════════════════════════
   it('1a. month-1 work: quarter hours at mixed rates, charges, a non-billable entry, a retainer-funded entry, job write-downs', async () => {
      await logEntry('a1', 'A', { type: 'Time', qty: 1.25, rate: SA.rate, user: SA, jobId: CUST.A.jobs.form1040, desc: 'Return preparation', date: daysAgo(9) });
      await logEntry('a2', 'A', { type: 'Time', qty: 0.5, rate: STAFF.rate, user: STAFF, jobId: CUST.A.jobs.form1040, desc: 'Document intake', date: daysAgo(8) });
      await logEntry('a3', 'A', { type: 'Charge', qty: 1, rate: 45, user: SA, jobId: CUST.A.jobs.form1040, desc: 'E-file fee', date: daysAgo(7) });
      await logEntry('a4', 'A', { type: 'Time', qty: 0.75, rate: ADMIN.rate, user: ADMIN, jobId: CUST.A.jobs.form1040, desc: 'Internal review (no charge)', billable: false, date: daysAgo(6) });
      expect(await jobFamilyTotal(CUST.A.jobs.form1040), 'job totals include non-billable work').to.equal(457.5);

      await logEntry('b1', 'B', { type: 'Time', qty: 2, rate: ADMIN.rate, user: ADMIN, jobId: CUST.B.jobs.form1120s, desc: 'S-corp return', date: daysAgo(9) });
      await logEntry('b2', 'B', { type: 'Time', qty: 3.5, rate: STAFF.rate, user: STAFF, jobId: CUST.B.jobs.bookkeeping, desc: 'Monthly reconciliation', date: daysAgo(8) });
      await logEntry('b3', 'B', { type: 'Charge', qty: 1, rate: 30, user: SA, jobId: CUST.B.jobs.bookkeeping, desc: 'Software fee', date: daysAgo(7) });

      // C: retainer-funded 2h × 150 draws 300 from the $1,000 retainer and books a 'Retainer' payment.
      await logEntry('c1', 'C', { type: 'Time', qty: 2, rate: ADMIN.rate, user: ADMIN, jobId: CUST.C.jobs.form1120s, desc: 'S-corp return (retainer)', retainerId: SEED_RETAINER_ID, date: daysAgo(9) });
      const retainerChain = await db('customer_retainers_and_prepayments').where({ account_id: A, customer_id: CUST.C.id }).orderBy('retainer_id', 'asc');
      expect(retainerChain).to.have.lengthOf(2);
      expect(retainerChain[1].parent_retainer_id).to.equal(SEED_RETAINER_ID);
      expect(num(retainerChain[1].current_amount), 'retainer drawn to 700').to.equal(-700);
      const retainerPayments = await db('customer_payments').where({ account_id: A, customer_id: CUST.C.id });
      expect(retainerPayments).to.have.lengthOf(1);
      expect(retainerPayments[0].form_of_payment).to.equal('Retainer');
      expect(num(retainerPayments[0].payment_amount)).to.equal(-300);
      expect(retainerPayments[0].customer_invoice_id, 'auto payment awaits the statement').to.equal(null);
      payment.c1 = retainerPayments[0].payment_id;
      await logEntry('c2', 'C', { type: 'Time', qty: 1, rate: SA.rate, user: SA, jobId: CUST.C.jobs.form1120s, desc: 'Partner review', date: daysAgo(8) });

      await logEntry('d1', 'D', { type: 'Time', qty: 2, rate: ADMIN.rate, user: ADMIN, jobId: CUST.D.jobs.form1040, desc: 'Return preparation', date: daysAgo(9) });
      await writeOff('wd1', 'D', { selectedJobID: CUST.D.jobs.form1040, unitCost: 50, writeOffReason: 'Scope reduction', writeoffReason: 'Scope reduction' });
      await logEntry('d2', 'D', { type: 'Charge', qty: 1, rate: 75, user: SA, jobId: CUST.D.jobs.payroll, desc: 'Payroll filing', date: daysAgo(7) });

      await logEntry('e1', 'E', { type: 'Time', qty: 4, rate: STAFF.rate, user: STAFF, jobId: CUST.E.jobs.bookkeeping, desc: 'Books cleanup', date: daysAgo(9) });
      await logEntry('e2', 'E', { type: 'Time', qty: 0.25, rate: SA.rate, user: SA, jobId: CUST.E.jobs.bookkeeping, desc: 'Quarter-hour call', date: daysAgo(8) });

      await logEntry('f1', 'F', { type: 'Time', qty: 1.5, rate: SA.rate, user: SA, jobId: CUST.F.jobs.form1040, desc: 'Return preparation', date: daysAgo(9) });
      // Job-level write-down on a job with NO time (see the DEFECT test in month 3).
      await writeOff('wf1', 'F', { selectedJobID: CUST.F.jobs.payroll, unitCost: 40, writeOffReason: 'Courtesy', writeoffReason: 'Courtesy' });

      // No statement exists yet, so an invoice-linked credit cannot be entered.
      expectRefused(await post(`/writeOffs/createWriteOffs/${A}/${SA.id}`, { writeOff: writeOffPayload('A', { customerInvoiceID: 999999, unitCost: 5 }) }), 'invoice-linked write-off before any statement', 'No matching invoice');

      const eligible = await accountsWithBalance();
      const byId = Object.fromEntries(eligible.map(r => [r.customer_id, r]));
      expect(Object.keys(byId).map(Number).sort()).to.deep.equal([1, 2, 3, 4, 5, 6]);
      expect(money(byId[CUST.A.id].billable_transactions_total)).to.equal(345);
      expect(money(byId[CUST.A.id].invoice_total)).to.equal(M1.A.total);
      expect(money(byId[CUST.C.id].invoice_total), 'retainer payment nets the retainer-funded entry').to.equal(M1.C.total);
      expect(money(byId[CUST.D.id].invoice_total), 'job write-down nets against its job').to.equal(M1.D.total);
      expect(byId[CUST.F.id].write_off_count, 'F write-down pending').to.equal(1);
      eligible.forEach(r => expect(r.billed_today, `${r.display_name} not billed yet`).to.equal(false));
   });

   it('1b. month-1 finalize A–D: numbers 00001–00004, PDFs and CSV match the ledger, rows stamped, E and F untouched', async () => {
      const body = await finalize('Month 1', ['A', 'B', 'C', 'D']);
      expect(body.message).to.equal('Finalized 4 invoice(s).');
      expect(body.skippedCustomers).to.deep.equal([]);
      expect(body.invoicesWithDetail.map(i => i.invoiceNumber)).to.deep.equal([invNo(1), invNo(2), invNo(3), invNo(4)]);
      expect(body.fileLocation).to.be.a('string').and.not.equal('');

      await recordParents({ A: 'A1', B: 'B1', C: 'C1', D: 'D1' });
      const files = await downloadZip(body.fileLocation);
      const csv = files['Monthly_CSV_Report.csv'];
      expect(csv, 'CSV report in the run zip').to.exist;
      const csvLines = csv.toString('utf8').split('\n');
      expect(csvLines[0]).to.equal('Customer ID,Customer Name,Beginning Balance,Payment Total,Transactions Total,Write Off Total,Retainer Total,Invoice Total,Hold,Send,Mail,Email,Add Note To Invoice,Adjustment Amount,Adjustment Reason');
      expect(csvLines).to.have.lengthOf(5);

      // Sections the template only draws when it has records (Revisions,
      // Retainers) are asserted where they must appear — and asserted ABSENT
      // where nothing should print.
      const a = await expectStatement('A', M1.A, { number: invNo(1), files, csvLines, pdfExtras: ['Total Payments Received: 0.00'] });
      expect(a.text).to.not.include('Retainers And Pre-Payments');
      await expectStatement('B', M1.B, { number: invNo(2), files, csvLines });
      const c = await expectStatement('C', M1.C, {
         number: invNo(3),
         files,
         csvLines,
         pdfExtras: [
            'Retainers And Pre-Payments',
            'Retainer -1000.00 -700.00',
            `Retainer/ Pre-Payment Total: ${fmt(M1.C.retainers)}`,
            `Invoice Total Before Retainer/ Pre-Payment: ${fmt(M1.C.beforeRetainer)}`,
            `Retainer/ Pre-Payment Applied to Invoice: ${fmt(M1.C.retainerApplied)}`,
            'Total Payments Received: -300.00'
         ]
      });
      pdfTexts.C1 = c.text;
      const d = await expectStatement('D', M1.D, { number: invNo(4), files, csvLines });
      expect(d.text, 'job-level write-down is netted into the job line, not listed as a revision').to.not.include('Revisions');
      expect(ymd(invoice.A1.start_date), 'first statement: period starts on the statement date').to.equal(todayBilling());

      // Stamps: every listed transaction (billable or not) and C's retainer payment.
      for (const [key, inv] of [['a1', 'A1'], ['a2', 'A1'], ['a3', 'A1'], ['a4', 'A1'], ['b1', 'B1'], ['b2', 'B1'], ['b3', 'B1'], ['c1', 'C1'], ['c2', 'C1'], ['d1', 'D1'], ['d2', 'D1']]) {
         expect((await txnRow(txn[key])).customer_invoice_id, `${key} stamped`).to.equal(invoice[inv].customer_invoice_id);
      }
      expect((await paymentRow(payment.c1)).customer_invoice_id, 'retainer payment stamped with C1').to.equal(invoice.C1.customer_invoice_id);
      const a1 = await txnRow(txn.a1);
      expect(num(a1.quantity), 'fractional hours survive the statement').to.equal(1.25);
      expect(num(a1.total_transaction)).to.equal(250);
      // E and F untouched and still eligible
      for (const key of ['e1', 'e2', 'f1']) expect((await txnRow(txn[key])).customer_invoice_id, `${key} still unbilled`).to.equal(null);
      const eligible = await accountsWithBalance();
      const byId = Object.fromEntries(eligible.map(r => [r.customer_id, r]));
      expect(byId[CUST.E.id].billed_today).to.equal(false);
      expect(money(byId[CUST.E.id].billable_transactions_total)).to.equal(450);
      expect(byId[CUST.F.id].billed_today).to.equal(false);
      expect(money(byId[CUST.F.id].billable_transactions_total)).to.equal(300);
      for (const key of ['A', 'B', 'C', 'D']) {
         expect(byId[CUST[key].id].billed_today, `${key} billed today`).to.equal(true);
         expect(byId[CUST[key].id].last_invoice_number).to.equal(invoice[`${key}1`].invoice_number);
      }
      for (const key of ['A', 'B', 'C', 'D']) await expectThreeViewsAgree(key, M1[key].total, 'after month 1');
   });

   it("1c. C's statement prints the remaining retainer the ledger shows (1,000 − 300 drawn = 700)", () => {
      expect(pdfTexts.C1, 'C1 PDF text captured').to.be.a('string');
      expect(pdfTexts.C1).to.match(/Remaining Retainer\/ Pre-Payment: -?700\.00/);
   });

   // ═══════════════════════════════════════════════════════════════════════════
   // 2. between months 1 and 2
   // ═══════════════════════════════════════════════════════════════════════════
   it('2a. the calendar advances a month; A pays in full, an NSF reversal restores the debt, deleting the reversal restores the payment', async () => {
      await advanceCalendar(MONTH_GAP_DAYS);
      invoice.A1 = await invoiceRow(invoice.A1.customer_invoice_id);
      expect(ymd(invoice.A1.invoice_date)).to.equal(daysAgo(MONTH_GAP_DAYS));

      const { body, row } = await pay('a_full', 'A', { selectedInvoiceID: invoice.A1.customer_invoice_id, unitCost: 345, paymentReferenceNumber: '1101' });
      expect(body.message).to.equal('Successfully created payment.');
      expect(num(row.payment_amount)).to.equal(-345);
      let chain = await chainState(CUST.A.id);
      expect(chain.remaining).to.equal(0);
      expect(chain.latest.is_invoice_paid_in_full).to.equal(true);
      expect(chain.parent.is_invoice_paid_in_full).to.equal(true);
      expect(num(chain.parent.total_payments)).to.equal(-345);
      expect(row.customer_invoice_id, 'payment tagged to its snapshot').to.equal(chain.latest.customer_invoice_id);
      await expectThreeViewsAgree('A', 0, 'A paid');

      const rev = expectOk(await post(`/payments/reversePayment/${A}/${SA.id}`, { payment: { paymentID: payment.a_full, reason: 'NSF — check #1101 returned' } }), 'reversePayment');
      expect(rev.message).to.equal(`Reversed payment #${payment.a_full}: $345.00 restored to ${invoice.A1.invoice_number}.`);
      const reversal = await db('customer_payments').where({ account_id: A, customer_id: CUST.A.id }).andWhere('payment_amount', '>', 0).first();
      expect(reversal, 'positive reversal row').to.exist;
      expect(reversal.form_of_payment).to.equal('Reversal');
      chain = await chainState(CUST.A.id);
      expect(chain.remaining).to.equal(345);
      expect(chain.parent.is_invoice_paid_in_full).to.equal(false);
      expect(num(chain.parent.total_payments)).to.equal(0);
      expect((await paymentRow(payment.a_full)).note).to.include('[reversed ');
      await expectThreeViewsAgree('A', 345, 'A reversed');

      const delBody = expectOk(await del(`/payments/deletePayment/${A}/${SA.id}`, { payment: { paymentID: reversal.payment_id, accountID: A, customerID: CUST.A.id } }), 'deletePayment (reversal)');
      expect(delBody.message).to.equal('Successfully deleted payment.');
      expect(await paymentRow(reversal.payment_id)).to.equal(undefined);
      chain = await chainState(CUST.A.id);
      expect(chain.remaining, 'back to paid').to.equal(0);
      expect(chain.parent.is_invoice_paid_in_full).to.equal(true);
      expect(num(chain.parent.total_payments)).to.equal(-345);
      expect((await childrenOf(invoice.A1.customer_invoice_id)).length, 'reversal snapshot removed').to.equal(1);
      // The payment was entered with no note, so undoing the reversal must leave
      // it with no note again (null) — in particular no '[reversed …]' marker.
      expect((await paymentRow(payment.a_full)).note, 'original payment note restored (reversible again)').to.equal(null);
      await expectThreeViewsAgree('A', AFTER_M1.A, 'A after reversal deleted');
   });

   it('2b. B pays part, C overpays with captureOverpayment (prepayment retainer), payments on statements agree everywhere', async () => {
      invoice.B1 = await invoiceRow(invoice.B1.customer_invoice_id);
      invoice.C1 = await invoiceRow(invoice.C1.customer_invoice_id);

      const b = await pay('b_part', 'B', { selectedInvoiceID: invoice.B1.customer_invoice_id, unitCost: 400, paymentReferenceNumber: '2201' });
      expect(b.body.message).to.equal('Successfully created payment.');
      let chain = await chainState(CUST.B.id);
      expect(chain.remaining).to.equal(AFTER_M1.B);
      expect(num(chain.parent.total_payments)).to.equal(-400);
      await expectThreeViewsAgree('B', AFTER_M1.B, 'B partial');

      const c = await pay('c_over', 'C', { selectedInvoiceID: invoice.C1.customer_invoice_id, unitCost: 300, paymentReferenceNumber: '3301', captureOverpayment: true });
      expect(c.body.message).to.include(`Applied $200.00 to ${invoice.C1.invoice_number}; $100.00 held as a prepayment retainer.`);
      expect(num(c.row.payment_amount), 'only the remaining is applied').to.equal(-200);
      expect(c.row.note).to.include(`[overpayment split: $200.00 to ${invoice.C1.invoice_number}, $100.00 to prepayment]`);
      const prepayments = await db('customer_retainers_and_prepayments').where({ account_id: A, customer_id: CUST.C.id, type_of_hold: 'Prepayment' });
      expect(prepayments).to.have.lengthOf(1);
      prepaymentRetainerId = prepayments[0].retainer_id;
      expect(num(prepayments[0].current_amount)).to.equal(-100);
      expect(prepayments[0].is_retainer_active).to.equal(true);
      expect(c.row.note).to.include(`[prepayment_retainer:${prepaymentRetainerId}]`);
      chain = await chainState(CUST.C.id);
      expect(chain.remaining).to.equal(0);
      expect(chain.parent.is_invoice_paid_in_full).to.equal(true);
      expect(num(chain.parent.total_payments), 'retainer payment -300 and applied -200').to.equal(-500);
      const { audit } = await expectThreeViewsAgree('C', AFTER_M1.C, 'C overpaid');
      expect(money(audit.totals.retainer_available), 'audit sees 700 retainer + 100 prepayment').to.equal(800);
   });

   it('2c. transaction rules: billed rows are immutable, unbilled edits move job totals, cross-customer jobs are refused, charges can be deleted', async () => {
      const a1 = await txnRow(txn.a1);
      const editPayload = (row, overrides) => ({
         transactionID: row.transaction_id,
         accountID: A,
         customerID: row.customer_id,
         customerJobID: row.customer_job_id,
         selectedRetainerID: null,
         loggedForUserID: row.logged_for_user_id,
         selectedGeneralWorkDescriptionID: row.general_work_description_id,
         detailedJobDescription: row.detailed_work_description,
         transactionDate: ymd(row.transaction_date),
         transactionType: row.transaction_type,
         quantity: num(row.quantity),
         unitCost: num(row.unit_cost),
         totalTransaction: num(row.total_transaction).toFixed(2),
         isTransactionBillable: row.is_transaction_billable,
         isInAdditionToMonthlyCharge: false,
         loggedByUserID: SA.id,
         note: row.note || '',
         ...overrides
      });

      // Billed: refused for edit and delete, row untouched.
      expectRefused(await put(`/transactions/updateTransaction/${A}/${SA.id}`, { transaction: editPayload(a1, { quantity: 9, totalTransaction: '1800.00' }) }), 'edit billed transaction', 'attached to an invoice and cannot be updated');
      expectRefused(await del(`/transactions/deleteTransaction/${A}/${SA.id}`, { transaction: editPayload(a1) }), 'delete billed transaction', 'attached to an invoice and cannot be deleted');
      const a1After = await txnRow(txn.a1);
      expect(num(a1After.quantity)).to.equal(1.25);
      expect(a1After.customer_invoice_id).to.equal(invoice.A1.customer_invoice_id);

      // Unbilled edit: 4h → 4.5h, job total follows.
      const e1 = await txnRow(txn.e1);
      expectOk(await put(`/transactions/updateTransaction/${A}/${SA.id}`, { transaction: editPayload(e1, { quantity: 4.5, totalTransaction: '450.00' }) }), 'edit e1');
      expect(num((await txnRow(txn.e1)).total_transaction)).to.equal(450);
      expect(await jobFamilyTotal(CUST.E.jobs.bookkeeping)).to.equal(500);

      // New job for E, move e2 onto it; both job totals recomputed.
      const jobBody = expectOk(
         await post(`/jobs/createJob/${A}/${SA.id}`, {
            job: { accountID: A, userID: SA.id, customerID: CUST.E.id, jobTypeID: JOB_TYPE.payroll, quoteAmount: 0, agreedJobAmount: 0, currentJobTotal: 0, jobStatus: null, isJobComplete: false, isQuote: false, notes: 'E payroll' }
         }),
         'createJob (E payroll)'
      );
      const eJob = jobBody.accountJobsList.activeJobData.activeJobs.find(j => j.customer_id === CUST.E.id && j.job_type_id === JOB_TYPE.payroll && j.parent_job_id === null);
      expect(eJob, 'new job listed').to.exist;
      ePayrollJobId = eJob.customer_job_id;
      expectRefused(await post(`/jobs/createJob/${A}/${SA.id}`, { job: { accountID: A, userID: SA.id, customerID: CUST.E.id, jobTypeID: JOB_TYPE.payroll, quoteAmount: 0, agreedJobAmount: 0, currentJobTotal: 0, isJobComplete: false, isQuote: false } }), 'duplicate job', 'Duplicate job');

      const e2 = await txnRow(txn.e2);
      expectOk(await put(`/transactions/updateTransaction/${A}/${SA.id}`, { transaction: editPayload(e2, { customerJobID: ePayrollJobId }) }), 'move e2 to the payroll job');
      expect((await txnRow(txn.e2)).customer_job_id).to.equal(ePayrollJobId);
      expect(await jobFamilyTotal(CUST.E.jobs.bookkeeping), 'source job loses the moved entry').to.equal(450);
      expect(await jobFamilyTotal(ePayrollJobId), 'target job gains it').to.equal(50);

      // Cross-customer job: refused, nothing moved.
      expectRefused(await put(`/transactions/updateTransaction/${A}/${SA.id}`, { transaction: editPayload(await txnRow(txn.e2), { customerJobID: CUST.A.jobs.form1040 }) }), 'move to another customer job', 'does not belong to this customer');
      expect((await txnRow(txn.e2)).customer_job_id).to.equal(ePayrollJobId);

      // Add then delete a charge.
      await logEntry('e3', 'E', { type: 'Charge', qty: 1, rate: 20, user: SA, jobId: ePayrollJobId, desc: 'Temporary fee', date: daysAgo(1) });
      expect(await jobFamilyTotal(ePayrollJobId)).to.equal(70);
      const e3 = await txnRow(txn.e3);
      expectOk(await del(`/transactions/deleteTransaction/${A}/${SA.id}`, { transaction: editPayload(e3) }), 'delete e3');
      expect(await txnRow(txn.e3)).to.equal(undefined);
      expect(await jobFamilyTotal(ePayrollJobId)).to.equal(50);

      // Job CRUD: update persists, delete guarded by linked work, an unused job deletes.
      const rootJob = await db('customer_jobs').where({ customer_job_id: ePayrollJobId }).first();
      expectOk(
         await put(`/jobs/updateJob/${A}/${SA.id}`, {
            job: { customerJobID: ePayrollJobId, parentJobID: null, accountID: A, customerID: CUST.E.id, jobTypeID: JOB_TYPE.payroll, quoteAmount: num(rootJob.job_quote_amount), agreedJobAmount: 999, currentJobTotal: num(rootJob.current_job_total), jobStatus: null, isJobComplete: false, isQuote: false, userID: SA.id, notes: 'E payroll (agreed)' }
         }),
         'updateJob'
      );
      expect(num((await db('customer_jobs').where({ customer_job_id: ePayrollJobId }).first()).agreed_job_amount)).to.equal(999);
      expectRefused(await del(`/jobs/deleteJob/${CUST.E.jobs.bookkeeping}/${A}/${SA.id}`), 'delete job with transactions', 'Transactions are linked to this job');
      const spareBody = expectOk(await post(`/jobs/createJob/${A}/${SA.id}`, { job: { accountID: A, userID: SA.id, customerID: CUST.E.id, jobTypeID: JOB_TYPE.form1120s, quoteAmount: 0, agreedJobAmount: 0, currentJobTotal: 0, isJobComplete: false, isQuote: false } }), 'createJob (spare)');
      const spare = spareBody.accountJobsList.activeJobData.activeJobs.find(j => j.customer_id === CUST.E.id && j.job_type_id === JOB_TYPE.form1120s);
      expectOk(await del(`/jobs/deleteJob/${spare.customer_job_id}/${A}/${SA.id}`), 'delete unused job');
      expect(await db('customer_jobs').where({ customer_job_id: spare.customer_job_id }).first()).to.equal(undefined);
   });

   it('2d. reference data CRUD: work descriptions, job types and categories (deactivate=false persists, in-use deletes refused)', async () => {
      // Work description
      expectOk(await post(`/workDescriptions/createWorkDescription/${A}/${SA.id}`, { workDescription: { generalWorkDescription: 'Clean Room Review', estimatedTime: 45, isGeneralWorkDescriptionActive: true } }), 'createWorkDescription');
      const wd = await db('customer_general_work_descriptions').where({ account_id: A, general_work_description: 'Clean Room Review' }).first();
      expect(wd).to.exist;
      expectOk(
         await put(`/workDescriptions/updateWorkDescription/${A}/${SA.id}`, {
            workDescription: { generalWorkDescriptionID: wd.general_work_description_id, accountID: A, generalWorkDescription: 'Clean Room Review (retired)', estimatedTime: 45, isGeneralWorkDescriptionActive: false, createdByUserID: SA.id }
         }),
         'updateWorkDescription'
      );
      const wdAfter = await db('customer_general_work_descriptions').where({ general_work_description_id: wd.general_work_description_id }).first();
      expect(wdAfter.is_general_work_description_active, 'deactivate persists').to.equal(false);
      expect(wdAfter.general_work_description).to.equal('Clean Room Review (retired)');
      expectRefused(await del(`/workDescriptions/deleteWorkDescription/${GWD.taxPrep}/${A}/${SA.id}`), 'delete in-use work description', 'in use');
      expectOk(await del(`/workDescriptions/deleteWorkDescription/${wd.general_work_description_id}/${A}/${SA.id}`), 'delete unused work description');
      expect(await db('customer_general_work_descriptions').where({ general_work_description_id: wd.general_work_description_id }).first()).to.equal(undefined);

      // Job type
      expectOk(await post(`/jobTypes/createJobType/${A}/${SA.id}`, { jobType: { accountID: A, customerJobCategory: CATEGORY.accounting, jobDescription: 'Sales Tax Filing', bookRate: 120, estimatedStraightTime: 45, isActive: true, userID: SA.id } }), 'createJobType');
      const jt = await db('customer_job_types').where({ account_id: A, job_description: 'Sales Tax Filing' }).first();
      expect(jt).to.exist;
      expectOk(await put(`/jobTypes/updateJobType/${A}/${SA.id}`, { jobType: { jobTypeID: jt.job_type_id, accountID: A, customerJobCategory: CATEGORY.accounting, jobDescription: 'Sales Tax Filing', bookRate: 125, estimatedStraightTime: 45, isActive: false, userID: SA.id } }), 'updateJobType');
      const jtAfter = await db('customer_job_types').where({ job_type_id: jt.job_type_id }).first();
      expect(jtAfter.is_job_type_active, 'deactivate persists').to.equal(false);
      expect(num(jtAfter.book_rate)).to.equal(125);
      expectRefused(await del(`/jobTypes/deleteJobType/${JOB_TYPE.form1040}/${A}/${SA.id}`), 'delete in-use job type', 'in use');
      expectOk(await del(`/jobTypes/deleteJobType/${jt.job_type_id}/${A}/${SA.id}`), 'delete unused job type');
      expect(await db('customer_job_types').where({ job_type_id: jt.job_type_id }).first()).to.equal(undefined);

      // Category
      expectOk(await post(`/jobCategories/createJobCategory/${A}/${SA.id}`, { jobCategory: { accountID: A, category: 'Advisory', isActive: true, createdBy: SA.id } }), 'createJobCategory');
      const cat = await db('customer_job_categories').where({ account_id: A, customer_job_category: 'Advisory' }).first();
      expect(cat).to.exist;
      expectOk(await put(`/jobCategories/updateJobCategory/${A}/${SA.id}`, { jobCategory: { customerJobCategoryID: cat.customer_job_category_id, accountID: A, selectedNewJobCategory: 'Advisory Services', isJobCategoryActive: false, createdByUserID: SA.id } }), 'updateJobCategory');
      const catAfter = await db('customer_job_categories').where({ customer_job_category_id: cat.customer_job_category_id }).first();
      expect(catAfter.is_job_category_active, 'deactivate persists').to.equal(false);
      expect(catAfter.customer_job_category).to.equal('Advisory Services');
      expectRefused(await del(`/jobCategories/deleteJobCategory/${CATEGORY.tax}/${A}/${SA.id}`), 'delete category with job types', 'in use by Job Types');
      expectOk(await del(`/jobCategories/deleteJobCategory/${cat.customer_job_category_id}/${A}/${SA.id}`), 'delete unused category');
      expect(await db('customer_job_categories').where({ customer_job_category_id: cat.customer_job_category_id }).first()).to.equal(undefined);
   });

   it('2e. customer update warns on deactivation with debt or unbilled work; user role guards hold', async () => {
      // D owes 325 → deactivation warns, then is reactivated.
      const deactivateD = expectOk(await put(`/customer/updateCustomer/${A}/${SA.id}`, { customer: customerUpdatePayload('D', { isCustomerActive: false, customerPhone: '480-555-4444' }) }), 'deactivate D');
      expect(deactivateD.warnings).to.deep.equal([`Customer has an open balance of $${fmt(AFTER_M1.D)}.`]);
      expect((await db('customers').where({ customer_id: CUST.D.id }).first()).is_customer_active).to.equal(false);
      expect((await db('customer_information').where({ customer_info_id: CUST.D.infoId }).first()).customer_phone).to.equal('480-555-4444');
      const reactivateD = expectOk(await put(`/customer/updateCustomer/${A}/${SA.id}`, { customer: customerUpdatePayload('D', { customerPhone: '480-555-0104' }) }), 'reactivate D');
      expect(reactivateD.warnings).to.deep.equal([]);
      expect((await db('customers').where({ customer_id: CUST.D.id }).first()).is_customer_active).to.equal(true);
      // F has unbilled work → warning names it; reactivate.
      const deactivateF = expectOk(await put(`/customer/updateCustomer/${A}/${SA.id}`, { customer: customerUpdatePayload('F', { isCustomerActive: false }) }), 'deactivate F');
      expect(deactivateF.warnings).to.deep.equal(['Customer has 1 unbilled billable transaction(s).']);
      expectOk(await put(`/customer/updateCustomer/${A}/${SA.id}`, { customer: customerUpdatePayload('F') }), 'reactivate F');
      expect((await db('customers').where({ customer_id: CUST.F.id }).first()).is_customer_active).to.equal(true);

      // Users: the last Super Admin cannot be demoted or deactivate themselves; promotions persist; unknown roles are refused.
      const userPayload = (id, overrides) => ({ userID: id, accountID: A, ...overrides });
      expectRefused(await put(`/user/updateUser/${A}/${SA.id}`, { user: userPayload(SA.id, { accessLevel: 'Admin' }) }), 'demote last super admin', 'Cannot remove the last active Super Admin');
      expectRefused(await put(`/user/updateUser/${A}/${SA.id}`, { user: userPayload(SA.id, { accessLevel: 'Super Admin', isUserActive: false }) }), 'self-deactivate', 'cannot deactivate your own user account');
      expectRefused(await put(`/user/updateUser/${A}/${SA.id}`, { user: userPayload(STAFF.id, { accessLevel: 'Owner' }) }), 'unknown access level', 'Invalid access level');
      expectOk(await put(`/user/updateUser/${A}/${SA.id}`, { user: userPayload(STAFF.id, { accessLevel: 'Admin', billingRate: 110 }) }), 'promote staff to Admin');
      const staff = await db('users').where({ user_id: STAFF.id }).first();
      expect(staff.access_level).to.equal('Admin');
      expect(num(staff.billing_rate)).to.equal(110);
      expect((await db('users').where({ user_id: SA.id }).first()).access_level, 'super admin unchanged').to.equal('Super Admin');
   });

   // ═══════════════════════════════════════════════════════════════════════════
   // 3. month 2
   // ═══════════════════════════════════════════════════════════════════════════
   it('3a. month-2 finalize A–E: balances roll forward, month-1 rows absorbed, numbers continue, PDFs/CSV match', async () => {
      await logEntry('a5', 'A', { type: 'Time', qty: 1, rate: SA.rate, user: SA, jobId: CUST.A.jobs.form1040, desc: 'Amended schedule', date: daysAgo(6) });
      await logEntry('b4', 'B', { type: 'Time', qty: 2, rate: STAFF.rate, user: STAFF, jobId: CUST.B.jobs.bookkeeping, desc: 'Monthly reconciliation', date: daysAgo(6) });
      await logEntry('c3', 'C', { type: 'Time', qty: 1, rate: ADMIN.rate, user: ADMIN, jobId: CUST.C.jobs.bookkeeping, desc: 'Books review', date: daysAgo(6) });
      await logEntry('d3', 'D', { type: 'Time', qty: 0.5, rate: STAFF.rate, user: STAFF, jobId: CUST.D.jobs.payroll, desc: 'Payroll question', date: daysAgo(6) });

      // Bill-day credit on D's month-1 statement, entered right before the run.
      invoice.D1 = await invoiceRow(invoice.D1.customer_invoice_id);
      const wd2 = await writeOff('wd2', 'D', { customerInvoiceID: invoice.D1.customer_invoice_id, unitCost: D_BILL_DAY_WRITEOFF, writeOffReason: 'Bill-day courtesy', writeoffReason: 'Bill-day courtesy' });
      expect(num(wd2.row.writeoff_amount)).to.equal(-D_BILL_DAY_WRITEOFF);
      let dChain = await chainState(CUST.D.id);
      expect(dChain.remaining).to.equal(AFTER_M1.D - D_BILL_DAY_WRITEOFF);
      expect(wd2.row.customer_invoice_id, 'write-off tagged to its snapshot').to.equal(dChain.latest.customer_invoice_id);
      expect(num(dChain.parent.total_write_offs)).to.equal(-D_BILL_DAY_WRITEOFF);

      const body = await finalize('Month 2', ['A', 'B', 'C', 'D', 'E']);
      expect(body.message).to.equal('Finalized 5 invoice(s).');
      expect(body.skippedCustomers).to.deep.equal([]);
      expect(body.invoicesWithDetail.map(i => i.invoiceNumber)).to.deep.equal([5, 6, 7, 8, 9].map(invNo));
      await recordParents({ A: 'A2', B: 'B2', C: 'C2', D: 'D2', E: 'E1' });
      const files = await downloadZip(body.fileLocation);
      const csvLines = files['Monthly_CSV_Report.csv'].toString('utf8').split('\n');
      expect(csvLines).to.have.lengthOf(6);

      await expectStatement('A', M2.A, { number: invNo(5), files, csvLines, pdfExtras: ['Total Payments Received: -345.00 (reflected in Beginning Balance above)'] });
      await expectStatement('B', M2.B, { number: invNo(6), files, csvLines, pdfExtras: [`${invoice.B1.invoice_number} 280.00 280.00`, 'Total Payments Received: -400.00 (reflected in Beginning Balance above)'] });
      await expectStatement('C', M2.C, {
         number: invNo(7),
         files,
         csvLines,
         pdfExtras: [`Retainer/ Pre-Payment Total: ${fmt(M2.C.retainers)}`, `Invoice Total Before Retainer/ Pre-Payment: ${fmt(M2.C.total)}`, 'Retainer/ Pre-Payment Applied to Invoice: 0.00', `Remaining Retainer/ Pre-Payment: ${fmt(M2.C.retainers)}`, 'Total Payments Received: -200.00 (reflected in Beginning Balance above)']
      });
      await expectStatement('D', M2.D, { number: invNo(8), files, csvLines, pdfExtras: [`${invoice.D1.invoice_number} 300.00 300.00`, 'Total Revisions: -25.00 (reflected in invoice balance)'] });
      await expectStatement('E', M2.E, { number: invNo(9), files, csvLines });
      expect(ymd(invoice.B2.start_date), 'statement period starts at the prior statement').to.equal(ymd(invoice.B1.invoice_date));
      expect(ymd(invoice.E1.start_date), "E's first statement starts today").to.equal(todayBilling());

      // Absorption: B1 and D1 chains zeroed + marked; A1 and C1 were already settled (no marker).
      for (const [key, absorbedBy] of [['B1', 'B2'], ['D1', 'D2']]) {
         const rows = [await invoiceRow(invoice[key].customer_invoice_id), ...(await childrenOf(invoice[key].customer_invoice_id))];
         expect(rows.length).to.be.greaterThan(1);
         rows.forEach(row => {
            expect(num(row.remaining_balance_on_invoice), `${key} row ${row.customer_invoice_id} zeroed`).to.equal(0);
            expect(row.notes || '', `${key} row ${row.customer_invoice_id} marker`).to.include(`[absorbed_by:${invoice[absorbedBy].invoice_number}@`);
         });
      }
      for (const key of ['A1', 'C1']) {
         const rows = [await invoiceRow(invoice[key].customer_invoice_id), ...(await childrenOf(invoice[key].customer_invoice_id))];
         rows.forEach(row => {
            expect(num(row.remaining_balance_on_invoice), `${key} settled`).to.equal(0);
            expect(row.notes, `${key} settled chain is not marked absorbed`).to.equal(null);
         });
      }
      // Stamps: new work → month 2; E's old work → its first statement; month-1 rows untouched.
      for (const [key, inv] of [['a5', 'A2'], ['b4', 'B2'], ['c3', 'C2'], ['d3', 'D2'], ['e1', 'E1'], ['e2', 'E1']]) {
         expect((await txnRow(txn[key])).customer_invoice_id, `${key} stamped`).to.equal(invoice[inv].customer_invoice_id);
      }
      expect((await txnRow(txn.a1)).customer_invoice_id).to.equal(invoice.A1.customer_invoice_id);
      expect((await txnRow(txn.f1)).customer_invoice_id, 'F still unbilled').to.equal(null);

      for (const key of ['A', 'B', 'C', 'D', 'E']) await expectThreeViewsAgree(key, M2[key].total, 'after month 2');
      const eligible = await accountsWithBalance();
      const f = eligible.find(r => r.customer_id === CUST.F.id);
      expect(f.billed_today).to.equal(false);
      expect(money(f.billable_transactions_total)).to.equal(300);
      expect(f.write_off_count).to.equal(1);
   });

   it('3b. right after the month-2 run nothing is re-credited: the bill-day write-off stays on month 1', async () => {
      const engine = await engineFor(CUST.D.id);
      expect(engine).to.deep.equal({ invoiceTotal: M2.D.total, outstandingInvoiceTotal: M2.D.total, transactionsTotal: 0, paymentTotal: 0, writeOffTotal: 0, retainerTotal: 0 });
      const audit = await auditFor(CUST.D.id);
      expect(money(audit.totals.audit_balance)).to.equal(M2.D.total);
      expect(audit.discrepancies.filter(d => d.severity !== 'info'), JSON.stringify(audit.discrepancies)).to.deep.equal([]);
   });

   // ═══════════════════════════════════════════════════════════════════════════
   // 4. between months 2 and 3
   // ═══════════════════════════════════════════════════════════════════════════
   it('4a. next month: a payment against the absorbed month-1 statement is remapped to the current one; E settles; D still owes 350', async () => {
      await advanceCalendar(MONTH_GAP_DAYS);
      for (const key of Object.keys(invoice)) invoice[key] = await invoiceRow(invoice[key].customer_invoice_id);
      expect(ymd(invoice.B2.invoice_date)).to.equal(daysAgo(MONTH_GAP_DAYS));
      expect(ymd(invoice.B1.invoice_date)).to.equal(daysAgo(MONTH_GAP_DAYS * 2));

      const b = await pay('b_remap', 'B', { selectedInvoiceID: invoice.B1.customer_invoice_id, unitCost: 100, paymentReferenceNumber: '2202' });
      expect(b.body.message).to.include(`Applied to current invoice ${invoice.B2.invoice_number} — the referenced invoice ${invoice.B1.invoice_number} was already rolled into it.`);
      expect(b.row.note).to.include(`[applied to ${invoice.B2.invoice_number}; customer referenced ${invoice.B1.invoice_number}]`);
      const bChain = await chainState(CUST.B.id);
      expect(bChain.parent.customer_invoice_id).to.equal(invoice.B2.customer_invoice_id);
      expect(b.row.customer_invoice_id, 'snapshot on the month-2 chain').to.equal(bChain.latest.customer_invoice_id);
      expect(bChain.remaining).to.equal(AFTER_M2.B);
      expect(num((await invoiceRow(invoice.B1.customer_invoice_id)).remaining_balance_on_invoice), 'absorbed statement stays at 0').to.equal(0);
      await expectThreeViewsAgree('B', AFTER_M2.B, 'B after remapped payment');

      const e = await pay('e_full', 'E', { selectedInvoiceID: invoice.E1.customer_invoice_id, unitCost: 500, paymentReferenceNumber: '5501' });
      expect(e.body.message).to.equal('Successfully created payment.');
      await expectThreeViewsAgree('E', AFTER_M2.E, 'E paid');

      // The month-2 bill-day write-off must not come back as a credit a month later.
      const dEngine = await engineFor(CUST.D.id);
      expect(dEngine.writeOffTotal, 'bill-day write-off not re-credited').to.equal(0);
      expect(dEngine.invoiceTotal).to.equal(AFTER_M2.D);
      for (const key of ['A', 'C', 'D']) await expectThreeViewsAgree(key, AFTER_M2[key], 'before month 3');
   });

   // ═══════════════════════════════════════════════════════════════════════════
   // 5. month 3
   // ═══════════════════════════════════════════════════════════════════════════
   it('5a. month-3 finalize everyone: E is skipped for a credit balance, F gets its first statement, PDFs/CSV match', async () => {
      await logEntry('a6', 'A', { type: 'Time', qty: 0.5, rate: SA.rate, user: SA, jobId: CUST.A.jobs.form1040, desc: 'Follow-up', date: daysAgo(5) });
      await logEntry('b5', 'B', { type: 'Time', qty: 1, rate: ADMIN.rate, user: ADMIN, jobId: CUST.B.jobs.form1120s, desc: 'K-1 revisions', date: daysAgo(5) });
      await logEntry('c4', 'C', { type: 'Time', qty: 2, rate: STAFF.rate, user: STAFF, jobId: CUST.C.jobs.bookkeeping, desc: 'Quarterly close', date: daysAgo(5) });
      await logEntry('e4', 'E', { type: 'Time', qty: 1, rate: STAFF.rate, user: STAFF, jobId: CUST.E.jobs.bookkeeping, desc: 'Reconciliation', date: daysAgo(5) });
      await writeOff('we1', 'E', { selectedJobID: CUST.E.jobs.bookkeeping, unitCost: 150, writeOffReason: 'Goodwill credit', writeoffReason: 'Goodwill credit' });
      await logEntry('f2', 'F', { type: 'Time', qty: 1, rate: STAFF.rate, user: STAFF, jobId: CUST.F.jobs.form1040, desc: 'Return finalization', date: daysAgo(4) });
      expect((await engineFor(CUST.E.id)).invoiceTotal, 'E carries a credit').to.equal(E_CREDIT_BALANCE);

      const body = await finalize('Month 3', ALL_KEYS);
      expect(body.message).to.match(/^Finalized 5 invoice\(s\)\./);
      expect(body.skippedCustomers).to.have.lengthOf(1);
      expect(body.skippedCustomers[0].customer_id).to.equal(CUST.E.id);
      expect(body.skippedCustomers[0].reason).to.include(`Credit balance of $${fmt(Math.abs(E_CREDIT_BALANCE))}`);
      expect(body.invoicesWithDetail.map(i => i.invoiceNumber)).to.deep.equal([10, 11, 12, 13, 14].map(invNo));
      await recordParents({ A: 'A3', B: 'B3', C: 'C3', D: 'D3', F: 'F1' });
      const files = await downloadZip(body.fileLocation);
      const csvLines = files['Monthly_CSV_Report.csv'].toString('utf8').split('\n');
      expect(csvLines).to.have.lengthOf(6);

      await expectStatement('A', M3.A, { number: invNo(10), files, csvLines, pdfExtras: [`${invoice.A2.invoice_number} 200.00 200.00`] });
      await expectStatement('B', M3.B, { number: invNo(11), files, csvLines, pdfExtras: [`${invoice.B2.invoice_number} 380.00 380.00`, 'Total Payments Received: -100.00 (reflected in Beginning Balance above)'] });
      await expectStatement('C', M3.C, { number: invNo(12), files, csvLines, pdfExtras: [`Retainer/ Pre-Payment Total: ${fmt(M3.C.retainers)}`, `Invoice Total Before Retainer/ Pre-Payment: ${fmt(M3.C.total)}`, `Remaining Retainer/ Pre-Payment: ${fmt(M3.C.retainers)}`] });
      await expectStatement('D', M3.D, { number: invNo(13), files, csvLines, pdfExtras: [`${invoice.D2.invoice_number} 350.00 350.00`, 'Total New Charges: 0.00'] });
      await expectStatement('F', M3.F, { number: invNo(14), files, csvLines });
      expect(await parentsFor(CUST.E.id).then(rows => rows.length), 'no month-3 statement for E').to.equal(1);
      expect((await txnRow(txn.e4)).customer_invoice_id, "E's work stays unbilled").to.equal(null);
      expect((await txnRow(txn.f1)).customer_invoice_id, "F's month-1 work billed on its first statement").to.equal(invoice.F1.customer_invoice_id);
      expect((await txnRow(txn.f2)).customer_invoice_id).to.equal(invoice.F1.customer_invoice_id);
      expect(ymd(invoice.F1.start_date), 'first statement').to.equal(todayBilling());
      for (const key of ['A', 'B', 'C', 'D', 'F']) await expectThreeViewsAgree(key, M3[key].total, 'after month 3');
      await expectThreeViewsAgree('E', 0, 'after month 3');
   });

   // Regression guard: a job-level write-down on a job with no unbilled time used
   // to be dropped (the engine only netted write-downs into jobs that had a
   // transaction bucket), so the customer never received the credit and the
   // Create Invoice grid reported it as pending forever.
   it('5b. a job-level write-down on a job without time is credited once and stops being pending', async () => {
      expect(num(invoice.F1.total_amount_due)).to.equal(M3.F.total);
      expect(num(invoice.F1.total_charges), 'net of the $40 write-down').to.equal(M3.F.charges);
      const f = (await accountsWithBalance()).find(r => r.customer_id === CUST.F.id);
      expect(f, 'F still listed (open balance)').to.exist;
      expect(f.write_off_count, 'the write-down is no longer pending').to.equal(0);
      expect(f.billed_today).to.equal(true);
      expect(money(f.outstanding_invoice_total)).to.equal(M3.F.total);
   });

   it('5c. a same-day re-run is refused for everyone; allowSameDayRebill absorbs the statement instead of doubling it', async () => {
      const rerun = await finalize('Month 3 again', ALL_KEYS);
      expect(rerun.message).to.equal('No invoices created — 6 customer(s) skipped (already finalized today or credit balance).');
      expect(rerun.invoicesWithDetail).to.deep.equal([]);
      expect(rerun.fileLocation).to.equal('');
      expect(rerun.skippedCustomers.map(s => s.customer_id).sort((x, y) => x - y)).to.deep.equal(ALL_KEYS.map(k => CUST[k].id));
      for (const key of ['A', 'B', 'C', 'D', 'F']) {
         expect(rerun.skippedCustomers.find(s => s.customer_id === CUST[key].id).reason).to.include(`Already finalized today as ${invoice[`${key}${key === 'F' ? 1 : 3}`].invoice_number}`);
      }
      expect(rerun.skippedCustomers.find(s => s.customer_id === CUST.E.id).reason).to.include('Credit balance of $50.00');
      expect(await parentsFor(CUST.B.id).then(r => r.length)).to.equal(3);

      const rebill = await finalize('Month 3 re-bill', ['B'], { allowSameDayRebill: true });
      expect(rebill.message).to.equal('Finalized 1 invoice(s).');
      expect(rebill.invoicesWithDetail[0].invoiceNumber).to.equal(invNo(15));
      await recordParents({ B: 'B4' });
      const files = await downloadZip(rebill.fileLocation);
      const csvLines = files['Monthly_CSV_Report.csv'].toString('utf8').split('\n');
      const rebillExp = { bb: M3.B.total, charges: 0, payments: 0, writeoffs: 0, retainers: 0, total: M3.B.total };
      await expectStatement('B', rebillExp, { number: invNo(15), files, csvLines, pdfExtras: [`${invoice.B3.invoice_number} 530.00 530.00`, 'Total New Charges: 0.00'] });
      const b3 = await invoiceRow(invoice.B3.customer_invoice_id);
      expect(num(b3.remaining_balance_on_invoice), 'first statement of the day absorbed').to.equal(0);
      expect(b3.notes).to.include(`[absorbed_by:${invoice.B4.invoice_number}@`);
      const { audit } = await expectThreeViewsAgree('B', M3.B.total, 'after same-day re-bill');
      expect(audit.discrepancies.filter(d => d.kind === 'duplicate_same_day_parent_invoices' || d.kind === 'stale_rolled_forward_balance')).to.deep.equal([]);
   });

   it('5d. AR aging: rows, buckets and the FIFO oldest-open-charge date agree with the ledger', async () => {
      const body = expectOk(await get(`/accountsReceivable/aging/${A}/${SA.id}?limit=50`), 'AR aging');
      const rows = body.arAging.customers;
      expect(rows.map(r => r.customer_id).sort((x, y) => x - y), 'E (settled) is absent').to.deep.equal(['A', 'B', 'C', 'D', 'F'].map(k => CUST[k].id));
      expect(body.arAging.pagination, 'pagination metadata').to.be.an('object');
      const reportedTotal = ['totalCount', 'totalItems', 'total', 'count'].map(k => body.arAging.pagination[k]).find(v => v != null);
      expect(Number(reportedTotal), `pagination total (${JSON.stringify(body.arAging.pagination)})`).to.equal(5);
      // Hand-computed FIFO (newest charge first, stop once the outstanding
      // balance is covered), from the entry dates logged in steps 1a/3a/5a —
      // independent of the production algorithm the loop below re-runs. The
      // calendar advanced 31 days twice: month-1 entries are 62 days older than
      // logged, month-2 entries 31 days older, month-3 entries as logged.
      //   A 300 ← a6 100 (−5d) + a5 200 (−6d, month 2)               → −(6+31)
      //   B 530 ← b5 150 + b4 200 + b3 30 + part of b2 350 (−8d, m1)  → −(8+62)
      //   C 350 ← c4 200 (−5d) + c3 150 (−6d, month 2)               → −(6+31)
      //   D 350 ← d3 50 + d2 75 + part of d1 300 (−9d, month 1)       → −(9+62)
      //   F 360 ← f2 100 (−4d) + part of f1 300 (−9d, month 1)        → −(9+62)
      const HAND_OLDEST_OPEN_DAYS_AGO = { A: 6 + MONTH_GAP_DAYS, B: 8 + 2 * MONTH_GAP_DAYS, C: 6 + MONTH_GAP_DAYS, D: 9 + 2 * MONTH_GAP_DAYS, F: 9 + 2 * MONTH_GAP_DAYS };
      for (const key of ['A', 'B', 'C', 'D', 'F']) {
         const row = rows.find(r => r.customer_id === CUST[key].id);
         expect(money(row.total_outstanding), `${key} total_outstanding`).to.equal(END_OUTSTANDING[key]);
         expect(money(row.bucket_0_30), `${key} bucket 0–30 (statement today)`).to.equal(END_OUTSTANDING[key]);
         expect(money(row.bucket_31_60) + money(row.bucket_61_90) + money(row.bucket_over_90), `${key} older buckets empty`).to.equal(0);
         expect(row.oldest_days, `${key} statement age`).to.be.within(0, 1);
         expect(ymd(row.statement_date), `${key} statement date`).to.equal(todayBilling());
         expect(row.is_customer_active).to.equal(true);
         // FIFO: walking billed billable charges newest-first, the oldest charge
         // still needed to cover the outstanding balance.
         const charges = await db('customer_transactions').where({ account_id: A, customer_id: CUST[key].id, is_transaction_billable: true }).whereNotNull('customer_invoice_id').orderBy([{ column: 'transaction_date', order: 'desc' }, { column: 'transaction_id', order: 'desc' }]);
         let covered = 0;
         let oldestOpen = null;
         for (const charge of charges) {
            if (covered < END_OUTSTANDING[key]) oldestOpen = ymd(charge.transaction_date);
            covered = money(covered + num(charge.total_transaction));
         }
         expect(ymd(row.oldest_open_charge_date), `${key} oldest open charge (FIFO)`).to.equal(oldestOpen);
         expect(ymd(row.oldest_open_charge_date), `${key} oldest open charge (hand-computed)`).to.equal(daysAgo(HAND_OLDEST_OPEN_DAYS_AGO[key]));
      }
      expect(rows.find(r => r.customer_id === CUST.B.id).statement_count, 'B: absorbed + re-billed statements dated today').to.equal(2);
      expect(rows.find(r => r.customer_id === CUST.D.id).statement_count).to.equal(1);
   });

   it('5e. account audit through the API for B and D: balances match the app, only informational findings', async () => {
      const run = expectOk(await post(`/accountAudit/run/${A}/${SA.id}`, { customer_ids: [CUST.B.id, CUST.D.id], notes: 'clean room' }), 'accountAudit run');
      expect(run.total).to.equal(2);
      let job;
      for (let attempt = 0; attempt < 120; attempt++) {
         job = expectOk(await get(`/accountAudit/job/${run.job_id}/${A}/${SA.id}`), 'accountAudit job');
         if (job.processing_status === 'complete' || job.processing_status === 'failed') break;
         await new Promise(resolve => setTimeout(resolve, 500));
      }
      expect(job.processing_status, JSON.stringify(job)).to.equal('complete');
      expect(job.results).to.have.lengthOf(2);
      for (const [key, expected] of [['B', END_OUTSTANDING.B], ['D', END_OUTSTANDING.D]]) {
         const result = job.results.find(r => r.customer_id === CUST[key].id);
         expect(result.status, `${key}: ${result.error || ''}`).to.equal('completed');
         expect(money(result.audit_balance), `${key} audit_balance`).to.equal(expected);
         expect(money(result.app_invoice_total), `${key} app_invoice_total`).to.equal(expected);
         expect(money(result.balance_difference), `${key} balance_difference`).to.equal(0);
         const detail = expectOk(await get(`/accountAudit/audit/${result.audit_id}/${A}/${SA.id}`), 'accountAudit detail');
         const nonInfo = detail.audit.discrepancies.filter(d => d.severity !== 'info');
         expect(nonInfo, `${key} discrepancies: ${JSON.stringify(detail.audit.discrepancies)}`).to.deep.equal([]);
         expect(money(detail.audit.outstanding_invoices)).to.equal(expected);
         expect(detail.audit.run_by_display_name).to.equal(SA.display);
         const stored = await db('account_audits').where({ audit_id: result.audit_id }).first();
         expect(stored.status).to.equal('completed');
         expect(money(stored.audit_balance)).to.equal(expected);
      }
   });

   it('5f. zero drift: engine, audit and AR agree for all six customers, and every chain matches the expected ledger', async () => {
      for (const key of ALL_KEYS) {
         const { engine, audit } = await expectThreeViewsAgree(key, END_OUTSTANDING[key], 'end state');
         expect(money(audit.totals.audit_balance), `${key} audit_balance == engine next bill`).to.equal(engine.invoiceTotal);
      }
      // Whole-ledger sanity.
      const parents = await db('customer_invoices').where({ account_id: A }).whereNull('parent_invoice_id').orderBy('customer_invoice_id', 'asc');
      expect(parents.map(p => p.invoice_number), 'fifteen statements, numbered without gaps').to.deep.equal(Array.from({ length: 15 }, (_, i) => invNo(i + 1)));
      const statementsIssued = { A: [M1.A, M2.A, M3.A], B: [M1.B, M2.B, M3.B, { total: M3.B.total }], C: [M1.C, M2.C, M3.C], D: [M1.D, M2.D, M3.D], E: [M2.E], F: [M3.F] };
      for (const key of ALL_KEYS) {
         const rows = await parentsFor(CUST[key].id);
         expect(rows.map(r => num(r.total_amount_due)), `${key}: statement totals in order`).to.deep.equal(statementsIssued[key].map(s => s.total));
      }
      const payments = await db('customer_payments').where({ account_id: A });
      expect(payments.every(p => p.customer_invoice_id !== null), 'every payment is tagged to a statement snapshot').to.equal(true);
      expect(payments.filter(p => num(p.payment_amount) > 0), 'no reversal rows remain').to.have.lengthOf(0);
      const unbilledBillable = await db('customer_transactions').where({ account_id: A, is_transaction_billable: true }).whereNull('customer_invoice_id').pluck('transaction_id');
      expect(unbilledBillable, "only E's credit-balance work is still unbilled").to.deep.equal([txn.e4]);
   });
});
