'use strict';
const { PathScenario, expect, ok } = require('./_path-matrix');
const { today } = require('./_scenario');
const dayjs = require('dayjs');
const jobService = require('../../src/endpoints/job/job-service');
const payments = require('../../src/endpoints/payments/payments-service');
const invoices = require('../../src/endpoints/invoice/invoice-service');
const ingest = require('../../src/endpoints/timesheets/auto-ingest-orchestrator');
const { sendEmail } = require('../../src/utils/email/sendEmail');

describe('Path matrix: defensive database and configuration failures', function () {
   this.timeout(180000);
   let s, c, j, w;
   before(async () => { s = await new PathScenario().boot(); c = await s.customer('PM final defenses'); j = await s.job(c); w = await s.work(c, j, 100); });
   after(() => s?.close());
   it('DELETE job | family query loses its row under the lock: refusal and no writes', () =>
      s.stub(jobService, 'getJobFamilyIds', async () => [], () => s.refused(() => s.del(`/jobs/deleteJob/${j.customer_job_id}/1/1`), 200, 500, /Job not found/)));
   it('DELETE payment | second lookup loses a stored payment: refusal and no writes', async () => {
      const pc = await s.customer('PM payment lookup'), pj = await s.job(pc); await s.work(pc, pj, 100); const invoice = (await s.finalize([pc])).committedInvoices[0];
      const p = (await s.pay(pc, 25, { selectedInvoiceID: invoice.customer_invoice_id })).row;
      await s.stub(payments, 'getSinglePayment', async () => [], () => s.refused(() => s.del('/payments/deletePayment/1/1', { payment: { paymentID: p.payment_id, customerID: pc.id } }), 200, 500, /No matching payment/));
   });
   it('PUT cascade edit | second customer lookup disappears: invalid reference and no writes', async () => {
      const other = await s.customer('PM disappeared reference'), job = await s.job(other);
      await s.queryFault(/select \* from "customers" where "customer_id" = .*"account_id" = .*limit/i,
         () => s.refused(() => s.put(`/billing-review/transaction/${w.transaction_id}/1/1`, { updates: { customer_id: other.id, customer_job_id: job.customer_job_id }, confirmCustomerChange: true }), 400, undefined, /Customer.*not found/), { empty: true });
   });
   it('POST finalize | missing inserted parent mapping rolls back its insert and all ledger writes', async () => {
      const original = invoices.createInvoice;
      await s.stub(invoices, 'createInvoice', async function (...args) { const parent = await original.apply(this, args); return { ...parent, customer_id: -1 }; },
         () => s.refused(() => s.post('/invoices/createInvoice/1/1', s.configuration([c], { isFinalized: true })), 500, 500, /Parent statement missing/));
   });
   it('POST preview | timezone conversion failure uses the same local date and writes nothing', async () => {
      const before = await s.allState(), expectedDate = dayjs().format('YYYY-MM-DD');
      const r = await s.stub(dayjs.prototype, 'tz', () => { throw Error('Invalid configured timezone'); }, () => s.post('/invoices/createInvoice/1/1', s.configuration([c])));
      ok(r); expect(r.body.invoicesWithDetail[0].billingDate).eq(expectedDate);
      expect(await s.allState()).deep.eq(before);
   });
   it('POST finalize | corrupt customer-information identity refuses schema validation before saving', async () => {
      const original = invoices.getCustomerInformation;
      await s.stub(invoices, 'getCustomerInformation', async function (...args) { const records = await original.apply(this, args); delete records[c.id].customer_info_id; return records; },
         () => s.refused(() => s.post('/invoices/createInvoice/1/1', s.configuration([c], { isFinalized: true })), 500, 500, /Validation of invoice object.*customer_info_id/));
   });
   it('POST audit batch | uncoercible JSON identifier refuses 500 before any job or database write', () =>
      s.refused(() => s.post('/accountAudit/run/1/1', { customer_ids: [{ toString: null, valueOf: null }] }), 500, 500, /Cannot convert object to primitive value/));
   it('PUT cascade edit | missing unissued legacy invoice chain refuses 409 without writes', async () => {
      const [parent] = await s.db('customer_invoices').insert({ account_id: 1, customer_id: c.id, customer_info_id: c.info.customer_info_id, total_payments: 0, total_write_offs: 0, total_retainers: 0, is_invoice_paid_in_full: false, invoice_number: 'PM-LEGACY-CHAIN', invoice_date: today(), due_date: today(), beginning_balance: 0, total_charges: 100, total_amount_due: 100, remaining_balance_on_invoice: 100, created_by_user_id: 1 }).returning('*');
      await s.db('customer_transactions').where({ transaction_id: w.transaction_id }).update({ customer_invoice_id: parent.customer_invoice_id });
      await s.queryFault(/select \* from "customer_invoices" where "account_id" = .*"customer_invoice_id" = .*limit/i,
         () => s.refused(() => s.put(`/billing-review/transaction/${w.transaction_id}/1/1`, { updates: { unit_cost: 110, total_transaction: 110 } }), 409, undefined, /statement.*could not be found/), { empty: true });
   });
   it('ingestion | failed historical-pattern query clears cached failure and holds the entry without charging', async () => {
      const [e] = await s.db('timesheet_entries').insert({ account_id: 1, user_id: 3, timesheet_name: 'PM-patterns.xlsx', employee_name: 'Uma User', time_tracker_start_date: today(), time_tracker_end_date: today(), date: today(), duration: 6, notes: 'Local pattern read failure', company_name: 'Alice Anderson', entity: 'Clean Room CPA', category: 'General Consulting', is_processed: false, is_deleted: false }).returning('*');
      const before = await s.db('customer_transactions').count('* as n').first();
      const result = await s.queryFault(/from "customer_jobs" as "cj" left join/i, () => ingest.processEntries({ db: s.db, accountId: 1, userId: 1, entryIds: [e.timesheet_entry_id] }));
      expect(result.autoInserted).eq(0);
      expect(result.perEntry[0].errorMessage).match(/path-matrix/);
      expect(await s.db('customer_transactions').count('* as n').first()).deep.eq(before);
      expect((await s.db('timesheet_entries').where({ timesheet_entry_id: e.timesheet_entry_id }).first()).is_processed).eq(false);
   });
   it('POST reprocess with overrides | six minutes at 100 per hour saves exactly 10 dollars; repeat refuses without writes', async () => {
      const [e] = await s.db('timesheet_entries').insert({ account_id: 1, user_id: 3, timesheet_name: 'PM-reprocess.xlsx', employee_name: 'Uma User', time_tracker_start_date: today(), time_tracker_end_date: today(), date: today(), duration: 6, notes: 'Local reprocess happy path', company_name: 'Alice Anderson', entity: 'Clean Room CPA', category: 'General Consulting', is_processed: false, is_deleted: false }).returning('*');
      const url = `/billing-review/reprocess-with-overrides/${e.timesheet_entry_id}/1/1`;
      const body = { overrides: { customer_id: 1, customer_job_id: 1, general_work_description_id: 1, logged_for_user_id: 3, duration_minutes: 6 } };
      const flag = process.env.TIME_TRACKER_AI_FEATURE_FLAG; process.env.TIME_TRACKER_AI_FEATURE_FLAG = 'on';
      try {
         const r = await s.post(url, body); ok(r); expect(r.body.message).eq('ok'); expect(r.body.decision).eq('auto_insert');
         const links = await s.db('ai_category_training_examples').where({ timesheet_entry_id: e.timesheet_entry_id }).whereNotNull('transaction_id');
         expect(links).length(1);
         const row = await s.db('customer_transactions').where({ transaction_id: links[0].transaction_id }).first();
         expect(Number(row.total_transaction)).eq(10); expect(Number(row.quantity)).eq(0.1); expect(Number(row.unit_cost)).eq(100); expect(Number(links[0].duration_minutes)).eq(6); expect(row.created_by_user_id).eq(1);
         await s.refused(() => s.post(url, body), 409, undefined, /already applied as transaction/);
      } finally { process.env.TIME_TRACKER_AI_FEATURE_FLAG = flag; }
   });
   for (const item of [
      { title: 'missing recipients', input: { recipientEmails: [], subject: 'Local' }, message: /without any recipient/ },
      { title: 'missing subject', input: { recipientEmails: ['dummy@scenario.test'] }, message: /without a subject/ },
      { title: 'missing sender configuration', input: { recipientEmails: ['dummy@scenario.test'], subject: 'Local' }, message: /Missing FROM_EMAIL/ }
   ]) it(`email boundary | ${item.title} refuses before storage, network or database writes`, async () => {
      const before = await s.allState(), config = require('../../config'), from = config.FROM_EMAIL;
      const modulePath = require.resolve('../../src/utils/email/sendEmail'), cached = require.cache[modulePath];
      if (item.title === 'missing sender configuration') config.FROM_EMAIL = '';
      delete require.cache[modulePath];
      let error;
      try { await require(modulePath).sendEmail(item.input); } catch (e) { error = e; } finally { config.FROM_EMAIL = from; require.cache[modulePath] = cached; }
      expect(error?.message).match(item.message); expect(await s.allState()).deep.eq(before);
   });
});
