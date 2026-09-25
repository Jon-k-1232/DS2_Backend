'use strict';
const { assertScenarioEnvironment } = require('../../scripts/scenarios/guard');
const { reset } = require('../../scripts/scenarios/reset');
const { expect } = require('chai');
const knex = require('knex');
const jwt = require('jsonwebtoken');
const supertest = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const unzipper = require('unzipper');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
// Optional narrative/sanitization is not part of the accounting oracle.
require('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient.prototype.send = async () => { throw new Error('scenario: AI disabled'); };
require('@aws-sdk/client-comprehend').ComprehendClient.prototype.send = async () => ({ Entities: [] });
require('../../src/endpoints/accountAudit/account-audit-narrative').generateAuditNarrative = async () => null;
const app = require('../../src/app');
const config = require('../../config');

const today = () => dayjs().tz('America/Phoenix').format('YYYY-MM-DD');
const ago = n => dayjs().tz('America/Phoenix').subtract(n, 'day').format('YYYY-MM-DD');
const money = n => Math.round(Number(n) * 100) / 100;
const fmt = n => Number(n).toFixed(2);
const no = n => `INV-${today().slice(0, 4)}-${String(n).padStart(5, '0')}`;
const ok = (r, label = 'HTTP action') => {
   expect(r.status, `${label}: ${JSON.stringify(r.body)}`).to.equal(200);
   if (r.body.status !== undefined) expect(r.body.status, `${label}: ${JSON.stringify(r.body)}`).to.equal(200);
   return r.body;
};
const refused = (r, pattern, status) => {
   const effective = Number(r.body.status || r.status);
   expect(effective, JSON.stringify(r.body).slice(0, 800)).to.be.at.least(400);
   if (status) expect(effective, JSON.stringify(r.body)).to.equal(status);
   if (pattern) expect(String(r.body.message || r.body.error || ''), JSON.stringify(r.body)).to.match(pattern);
   return r.body;
};
const TABLES = ['retainer_events', 'duplicate_flags', 'duplicate_history', 'customer_payments_processed', 'invoice_issues', 'invoice_statement_members', 'invoice_exceptions', 'invoice_exception_payments', 'invoice_revisions', 'invoice_history', 'customers', 'customer_information', 'customer_jobs', 'customer_transactions', 'customer_payments', 'customer_writeoffs', 'customer_retainers_and_prepayments', 'customer_invoices'];

class Scenario {
   async boot() {
      assertScenarioEnvironment();
      await reset();
      this.db = knex({ client: 'pg', connection: { host: process.env.DB_DEV_HOST, port: 5433, user: 'ds2', password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME, ssl: false }, pool: { min: 0, max: 8 } });
      expect((await this.db.raw('select current_database() as db')).rows[0].db).to.equal(process.env.DATABASE_NAME);
      this.scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-scenarios-'));
      app.set('db', this.db);
      config.JWT_SECRET = process.env.JWT_SECRET;
      this.request = supertest(app);
      return this;
   }
   async close() {
      if (this.db) await this.db.destroy();
      if (this.scratch) fs.rmSync(this.scratch, { recursive: true, force: true });
   }
   token(role = 'sa', extra = {}) {
      const id = { sa: [1, 'sa@clean.test'], admin: [2, 'admin@clean.test'], staff: [3, 'staff@clean.test'], foreign: [70001, 'foreign@scenario.test'], stranger: [999999, 'absent@scenario.test'] }[role];
      return jwt.sign({ user_id: id[0] }, process.env.JWT_SECRET, { subject: id[1], expiresIn: '2h', algorithm: 'HS256', ...extra });
   }
   req(method, url, body, role = 'sa') {
      let r = this.request[method](url);
      if (role) r = r.set('Authorization', `Bearer ${this.token(role)}`);
      return require('./_audit-request')(body === undefined ? r : r.send(body),this.db,{sa:1,admin:2,staff:3,foreign:70001,stranger:999999}[role] || null);
   }
   post(url, body, role) { return this.req('post', url, body, role); }
   put(url, body, role) { return this.req('put', url, body, role); }
   del(url, body, role) { return this.req('delete', url, body, role); }
   get(url, role) { return this.req('get', url, undefined, role); }
   customerBody(name, more = {}) {
      return { accountID: 1, userID: 1, customerBusinessName: name, customerName: name, isCommercialCustomer: true,
         isCustomerActive: true, isCustomerBillable: true, isCustomerRecurring: false, customerStreet: '10 Scenario Way',
         customerCity: 'Phoenix', customerState: 'AZ', customerZip: '85001', customerEmail: 'dummy@scenario.test', customerPhone: '602-555-0199',
         isCustomerAddressActive: true, isCustomerPhysicalAddress: true, isCustomerBillingAddress: true, isCustomerMailingAddress: true, ...more };
   }
   async customer(name, more = {}) {
      const payload = this.customerBody(name, more);
      ok(await this.post('/customer/createCustomer/1/1', { customer: payload }));
      const c = await this.db('customers').where({ account_id: 1, display_name: name }).first();
      expect(c, name).to.exist;
      const info = await this.db('customer_information').where({ account_id: 1, customer_id: c.customer_id }).first();
      c.id = c.customer_id; c.info = info; c.payload = { ...payload, customerID: c.id, customerInfoID: info.customer_info_id }; c.name = name;
      await this.check(c, { n: 0, b: 0, r: 0 });
      return c;
   }
   jobBody(c, type = 1, more = {}) { return { accountID: 1, userID: 1, customerID: c.id, jobTypeID: type, quoteAmount: 0, agreedJobAmount: 0, currentJobTotal: 0, isJobComplete: false, isQuote: false, notes: 'scenario job', ...more }; }
   async job(c, type = 1) {
      ok(await this.post('/jobs/createJob/1/1', { job: this.jobBody(c, type) }));
      return this.db('customer_jobs').where({ account_id: 1, customer_id: c.id, job_type_id: type }).whereNull('parent_job_id').first();
   }
   transaction(c, job, amount, more = {}) {
      return { accountID: 1, customerID: c.id, customerJobID: job.customer_job_id, selectedJobID: job.customer_job_id, loggedByUserID: 1,
         loggedForUserID: 3, selectedGeneralWorkDescriptionID: 1, transactionDate: today(), transactionType: 'Charge', quantity: 1,
         unitCost: amount, totalTransaction: amount, isTransactionBillable: true, detailedJobDescription: 'Scenario work', minutes: null, ...more };
   }
   async work(c, job, amount, more = {}) {
      const payload = this.transaction(c, job, amount, more);
      const before = await this.db('customer_transactions').where({ account_id: 1, customer_id: c.id }).max({ id: 'transaction_id' }).first();
      ok(await this.post('/transactions/createTransaction/1/1', { transaction: payload }));
      const rows = await this.db('customer_transactions').where('transaction_id', '>', before.id || 0).where({ account_id: 1, customer_id: c.id });
      expect(rows).to.have.lengthOf(1);
      const row = rows[0];
      expect(money(row.total_transaction)).to.equal(amount);
      expect(money(row.quantity)).to.equal(payload.quantity);
      expect(money(row.unit_cost)).to.equal(payload.unitCost);
      row.payload = { ...payload, transactionID: row.transaction_id };
      return row;
   }
   async editWork(row, overrides) { return this.put('/transactions/updateTransaction/1/1', { transaction: { ...row.payload, ...overrides } }); }
   async deleteWork(row) { return this.del('/transactions/deleteTransaction/1/1', { transaction: { transactionID: row.transaction_id, customerID: row.customer_id } }); }
   async family(job, amount) {
      const row = await this.db('customer_jobs').where({ account_id: 1 }).where(q => q.where('customer_job_id', job.customer_job_id).orWhere('parent_job_id', job.customer_job_id)).orderBy('created_at', 'desc').orderBy('customer_job_id', 'desc').first();
      expect(money(row.current_job_total), `family ${job.customer_job_id}`).to.equal(amount);
   }
   payment(c, amount, more = {}) { return { customerID: c.id, unitCost: amount, transactionDate: today(), formOfPayment: 'Check', paymentReferenceNumber: 'SCENARIO', ...more }; }
   async pay(c, amount, more = {}) {
      const before = await this.db('customer_payments').where({ account_id: 1, customer_id: c.id }).max({ id: 'payment_id' }).first();
      const body = ok(await this.post('/payments/createPayment/1/1', { payment: this.payment(c, amount, more) }));
      const row = await this.db('customer_payments').where('payment_id', '>', before.id || 0).where({ account_id: 1, customer_id: c.id }).first();
      return { row, body };
   }
   async retainer(c, amount, more = {}) {
      ok(await this.post('/retainers/createRetainer/1/1', { retainer: { customerID: c.id, unitCost: amount, typeOfHold: 'Retainer', displayName: 'Scenario funds', ...more } }));
      return this.db('customer_retainers_and_prepayments').where({ account_id: 1, customer_id: c.id }).whereNull('parent_retainer_id').orderBy('retainer_id', 'desc').first();
   }
   credit(c, amount, more = {}) { return { customerID: c.id, unitCost: amount, selectedDate: today(), writeoffReason: 'Scenario credit', ...more }; }
   async writeoff(c, amount, more = {}) {
      ok(await this.post('/writeOffs/createWriteOffs/1/1', { writeOff: this.credit(c, amount, more) }));
      return this.db('customer_writeoffs').where({ account_id: 1, customer_id: c.id }).orderBy('writeoff_id', 'desc').first();
   }
   configuration(customers, settings = {}, flags = {}) {
      return { invoiceConfiguration: { invoicesToCreate: customers.map(c => ({ customer_id: c.id, showWriteOffs: false, ...flags })), invoiceCreationSettings: settings } };
   }
   async preview(c, flags = {}) { return ok(await this.post('/invoices/createInvoice/1/1', this.configuration([c], {}, flags))).invoicesWithDetail[0]; }
   async audit(c) {
      const job = ok(await this.post('/accountAudit/run/1/1', { customer_ids: [c.id], notes: 'scenario oracle' }));
      let result;
      for (let attempt = 0; attempt < 1000; attempt++) {
         result = ok(await this.get(`/accountAudit/job/${job.job_id}/1/1`));
         if (result.processing_status !== 'processing') break;
         await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(result.processing_status, JSON.stringify(result)).to.equal('complete');
      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0].status, JSON.stringify(result)).to.equal('completed');
      return ok(await this.get(`/accountAudit/audit/${result.results[0].audit_id}/1/1`)).audit;
   }
   async check(c, e) {
      const p = await this.preview(c);
      expect(money(p.invoiceTotal), `${c.name} next bill`).to.equal(e.n);
      expect(money(p.outstandingInvoices.outstandingInvoiceTotal), `${c.name} billed`).to.equal(e.b);
      expect(money(p.retainers.retainerTotal), `${c.name} retainer`).to.equal(e.r || 0);
      for (const [key, [group, field]] of Object.entries({ charges: ['transactions', 'transactionsTotal'], payments: ['payments', 'paymentTotal'], writeoffs: ['writeOffs', 'writeOffTotal'] })) {
         if (e[key] !== undefined) expect(money(p[group][field]), key).to.equal(e[key]);
      }
      const a = await this.audit(c);
      expect(money(a.audit_balance), `${c.name} saved audit`).to.equal(e.n);
      expect(money(a.app_invoice_total), `${c.name} audit app`).to.equal(e.n);
      expect(money(a.outstanding_invoices), `${c.name} audit billed`).to.equal(e.b);
      expect(money(a.balance_difference), `${c.name} audit difference`).to.equal(0);
      const findings = a.discrepancies.filter(d => d.severity !== 'info');
      if (e.unlinked) {
         const [count, amount] = e.unlinked;
         expect(findings, `${c.name} only the documented pending-payment diagnostic`).to.have.lengthOf(1);
         expect(findings[0].kind).to.equal('unlinked_payments');
         expect(findings[0].severity).to.equal(count > 1 ? 'medium' : 'low');
         expect(findings[0].payment_ids).to.have.lengthOf(count);
         expect(findings[0].detail).to.equal(`${count} payment(s) not attached to any invoice (total $${fmt(amount)}).`);
      } else expect(findings, `${c.name} audit findings`).to.deep.equal([]);
      const ar = ok(await this.get(`/accountsReceivable/aging/1/1?limit=500`)).arAging.customers.find(r => r.customer_id === c.id);
      expect(ar ? money(ar.total_outstanding) : 0, `${c.name} AR`).to.equal(e.b);
      if (e.b === 0) expect(ar, 'AR omits zero balances').to.equal(undefined);
      if (ar) {
         const fields = ['bucket_0_30', 'bucket_31_60', 'bucket_61_90', 'bucket_over_90'];
         for (const field of fields) expect(money(ar[field]), `${c.name} ${field}`).to.equal(field === (e.bucket || fields[0]) ? e.b : 0);
      }
      return { preview: p, audit: a, ar };
   }
   async finalize(customers, settings = {}, flags = {}) { return ok(await this.post('/invoices/createInvoice/1/1', this.configuration(customers, { isFinalized: true, isCsvOnly: true, ...settings }, flags))); }
   async files(key) {
      const r = await this.get(`/invoices/downloadFile/1/1?fileLocation=${encodeURIComponent(key)}`).buffer(true).parse((res, cb) => {
         const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(r.status).to.equal(200);
      const zip = await unzipper.Open.buffer(r.body); const files = {};
      for (const entry of zip.files) files[entry.path] = await entry.buffer();
      return files;
   }
   pdf(buffer) {
      const file = path.join(this.scratch, 'statement.pdf'); fs.writeFileSync(file, buffer);
      return execFileSync(process.env.PDFTOTEXT_BIN || '/opt/homebrew/bin/pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
   }
   async statement(c, body, number, tuple, extras = []) {
      const row = await this.db('customer_invoices').where({ account_id: 1, customer_id: c.id }).whereNull('parent_invoice_id').orderBy('customer_invoice_id', 'desc').first();
      expect(row.invoice_number).to.equal(no(number));
      const fields = ['beginning_balance', 'total_charges', 'total_payments', 'total_write_offs', 'total_retainers', 'total_amount_due'];
      fields.forEach((field, i) => expect(money(row[field]), `${c.name} ${field}`).to.equal(tuple[i]));
      expect(money(row.remaining_balance_on_invoice)).to.equal(tuple[5]);
      expect(row.is_invoice_paid_in_full).to.equal(tuple[5] === 0);
      const files = await this.files(body.fileLocation || row.invoice_file_location);
      const pdfKey = Object.keys(files).find(key => key.endsWith(`_customer_${c.id}.pdf`));
      expect(pdfKey, Object.keys(files).join(',')).to.exist;
      const text = this.pdf(files[pdfKey]);
      for (const line of [no(number), `Bill To: ${c.name}`, `Beginning Balance: ${fmt(tuple[0])}`, `Total New Charges: ${fmt(tuple[1])}`, tuple[5] < 0 ? `Credit balance: ${fmt(tuple[5])}` : `Balance Due: ${fmt(tuple[5])}`, tuple[5] < 0 ? 'No payment due' : `Payment Due Date: ${dayjs(today()).add(16, 'day').format('MM/DD/YYYY')}`, ...extras]) expect(text).to.include(line);
      // Linked receipts are informational on the next statement: their literal
      // expected PDF total is supplied by that scenario, not deducted twice.
      const paymentLine = extras.find(line => line.startsWith('Total Payments Received:')) || `Total Payments Received: ${fmt(tuple[2])}`;
      expect(text).to.include(paymentLine);
      const revisionLine = extras.find(line => line.startsWith('Total Revisions:')) || (tuple[3] ? `Total Revisions: ${fmt(tuple[3])}` : null);
      if (revisionLine) expect(text).to.include(revisionLine);
      else expect(text).not.to.include('Total Revisions:');
      if (tuple[4]) expect(text).to.include(`Retainer/ Pre-Payment Total: ${fmt(tuple[4])}`);
      if (tuple[4] || tuple[2]) {
         expect(text).to.include(`Invoice Total Before Retainer/ Pre-Payment: ${fmt(tuple[5] - tuple[2])}`);
         expect(text).to.include(`Retainer/ Pre-Payment Applied to Invoice: ${fmt(tuple[2])}`);
         expect(text).to.include(`Remaining Retainer/ Pre-Payment: ${fmt(tuple[4])}`);
      } else expect(text).not.to.include('Retainer/ Pre-Payment Applied to Invoice:');
      if (files['Monthly_CSV_Report.csv']) {
         const csv = files['Monthly_CSV_Report.csv'].toString('utf8');
         expect(csv.split('\n')).to.include(`${c.id},${c.name},${tuple[0]},${tuple[2]},${tuple[1]},${tuple[3]},${tuple[4]},${tuple[5]}`);
      } else {
         expect(body.committed, 'missing combined CSV requires an explicit committed export warning').to.equal(true);
         expect(body.warnings).to.have.lengthOf(1);
      }
      await this.check(c, { n: tuple[5], b: tuple[5], r: tuple[4] });
      return { ...row, text, pdf: files[pdfKey] };
   }
   async shift(days) {
      assertScenarioEnvironment();
      await this.db.transaction(async trx => {
         // Synthetic calendar fixture only. Runtime has no unlock switch.
         await trx.raw('SET LOCAL session_replication_role = replica');
         await trx('invoice_issues').update({ issued_at: trx.raw("issued_at - ?::interval", [`${days} days`]) });
         for (const [table, columns] of Object.entries({ customer_invoices: ['invoice_date', 'due_date', 'start_date', 'end_date', 'fully_paid_date'], customer_transactions: ['transaction_date'], customer_payments: ['payment_date'], customer_writeoffs: ['writeoff_date'], customer_retainers_and_prepayments: [], retainer_events: ['event_date'], customer_jobs: [] })) {
            await trx(table).where({ account_id: 1 }).update(Object.fromEntries([...columns.map(column => [column, trx.raw('?? - ?::int', [column, days])]), ['created_at', trx.raw("created_at - ?::interval", [`${days} days`])]]));
         }
      });
   }
   async state() {
      const result = {};
      for (const table of TABLES) result[table] = (await this.db.raw('SELECT md5(coalesce(string_agg(row_to_json(t)::text, ? ORDER BY row_to_json(t)::text), ?)) AS digest FROM ?? t', ['|', '', table])).rows[0].digest;
      return result;
   }
   async reject(action, pattern, c, expected, status) {
      const before = await this.state();
      const response = await action(); refused(response, pattern, status);
      expect(await this.state(), 'refusal leaves all financial/customer rows unchanged').to.deep.equal(before);
      if (c) await this.check(c, expected);
      return response;
   }
   async dbFailure(table, event, action) {
      assertScenarioEnvironment();
      if (!TABLES.includes(table) || !['INSERT', 'UPDATE', 'DELETE'].includes(event)) throw new Error('Bad fault target');
      await this.db.raw("CREATE FUNCTION scenario_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'scenario injected database failure'; END $$");
      try {
         await this.db.raw(`CREATE TRIGGER scenario_fail BEFORE ${event} ON ?? FOR EACH ROW EXECUTE FUNCTION scenario_fail()`, [table]);
         return await action();
      } finally {
         await this.db.raw('DROP TRIGGER IF EXISTS scenario_fail ON ??', [table]);
         await this.db.raw('DROP FUNCTION scenario_fail()');
      }
   }
   async suppressWrite(table, event, action) {
      assertScenarioEnvironment();
      if (!TABLES.includes(table) || !['INSERT','UPDATE','DELETE'].includes(event)) throw Error('Bad suppression target');
      await this.db.raw("CREATE FUNCTION scenario_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$");
      try {
         await this.db.raw(`CREATE TRIGGER scenario_suppress BEFORE ${event} ON ?? FOR EACH ROW EXECUTE FUNCTION scenario_suppress()`,[table]);
         return await action();
      } finally {
         await this.db.raw('DROP TRIGGER IF EXISTS scenario_suppress ON ??',[table]);
         await this.db.raw('DROP FUNCTION scenario_suppress()');
      }
   }
   async foreignFixture() {
      await this.db('accounts').insert({ account_id: 700, account_name: 'Scenario Foreign', account_type: 'business', storage_slug: 'Scenario_Foreign', is_account_active: true });
      await this.db('users').insert({ user_id: 70001, account_id: 700, email: 'foreign@scenario.test', display_name: 'Foreign Actor', job_title: 'Scenario', cost_rate: 50, billing_rate: 100, access_level: 'Super Admin', is_user_active: true });
      await this.db('customers').insert({ customer_id: 70001, account_id: 700, customer_name: 'Foreign Client', display_name: 'Foreign Client', is_commercial_customer: true, is_recurring: false, is_customer_active: true, is_billable: true });
      await this.db('customer_job_types').insert({ job_type_id: 70001, account_id: 700, job_description: 'Foreign Type', is_job_type_active: true, created_by_user_id: 70001 });
      await this.db('customer_jobs').insert({ customer_job_id: 70001, account_id: 700, customer_id: 70001, job_type_id: 70001, is_quote: false, is_job_complete: false, current_job_total: 0, created_by_user_id: 70001 });
      await this.db('customer_general_work_descriptions').insert({ general_work_description_id: 70001, account_id: 700, general_work_description: 'Foreign Work', estimated_time: 60, is_general_work_description_active: true, created_by_user_id: 70001 });
      const owner = { account_id: 700, customer_id: 70001, created_by_user_id: 70001 };
      await this.db('customer_transactions').insert({ ...owner, transaction_id: 70001, customer_job_id: 70001, general_work_description_id: 70001, logged_for_user_id: 70001, transaction_date: today(), transaction_type: 'Charge', quantity: 1, unit_cost: 100, total_transaction: 100, is_transaction_billable: true, is_excess_to_subscription: false });
      await this.db('customer_payments').insert({ ...owner, payment_id: 70001, payment_date: today(), payment_amount: -20 });
      await this.db('customer_writeoffs').insert({ ...owner, writeoff_id: 70001, writeoff_date: today(), writeoff_amount: -10, transaction_type: 'Writeoff', writeoff_reason: 'Foreign credit' });
      await this.db('customer_retainers_and_prepayments').insert({ ...owner, retainer_id: 70001, type_of_hold: 'Retainer', starting_amount: -50, current_amount: -50, is_retainer_active: true });
   }
}
module.exports = { Scenario, ok, refused, today, ago, money, no, expect };
