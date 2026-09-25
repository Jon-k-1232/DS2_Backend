'use strict';
const { Scenario, ok, expect, refused, today } = require('./_scenario');
const { assertScenarioEnvironment } = require('../../scripts/scenarios/guard');
describe('scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md)', function () {
   this.timeout(180000); const s = new Scenario(); let c, j, inv, other, oj, row, hold;
   const balance = { n: 200, b: 200 };
   const workBalance = { n: 100, b: 0, r: -40 };
   before(async () => {
      await s.boot(); await s.foreignFixture();
      c = await s.customer('Scenario Refusal Billed'); j = await s.job(c); await s.work(c, j, 200); await s.check(c, { n: 200, b: 0 });
      inv = await s.statement(c, await s.finalize([c]), 1, [0, 200, 0, 0, 0, 200]);
      other = await s.customer('Scenario Refusal Unbilled'); oj = await s.job(other); row = await s.work(other, oj, 100); hold = await s.retainer(other, 40);
      await s.check(other, workBalance);
   });
   after(async () => { await s.close(); });

   for (const bad of [
      { DB_DEV_HOST: 'db.example.invalid' }, { DB_DEV_HOST: '::1' }, { DB_DEV_PORT: '5432' }, { DATABASE_NAME: 'ds2_local' },
      { DATABASE_NAME: 'ds2_ref_20260922' }, { DATABASE_NAME: 'ds2_clean' }, { DATABASE_NAME: 'ds2_scenarios;DROP DATABASE ds2_local' },
      { DATABASE_URL: 'postgres://remote/db' }, { DB_PROD_HOST: 'remote' }, { S3_ENDPOINT: 'https://s3.amazonaws.com' }, { S3_BUCKET_NAME: 'production' }
   ]) it(`X guard refuses ${JSON.stringify(bad)} before connection`, () => {
      expect(() => assertScenarioEnvironment({ ...process.env, ...bad })).to.throw(/SCENARIO SAFETY/);
   });

   const routes = [
      ['customer create', 'post', () => '/customer/createCustomer/1/1', () => ({ customer: s.customerBody('Scenario Forbidden') })],
      ['customer update', 'put', () => '/customer/updateCustomer/1/1', () => ({ customer: c.payload })],
      ['customer delete', 'delete', () => `/customer/deleteCustomer/${c.id}/1/1`],
      ['customer detail', 'get', () => `/customer/activeCustomers/customerByID/1/1/${c.id}`],
      ['job create', 'post', () => '/jobs/createJob/1/1', () => ({ job: s.jobBody(other, 4) })],
      ['job update', 'put', () => '/jobs/updateJob/1/1', () => ({ job: s.jobBody(c, 1, { customerJobID: j.customer_job_id }) })],
      ['job delete', 'delete', () => `/jobs/deleteJob/${j.customer_job_id}/1/1`],
      ['work create', 'post', () => '/transactions/createTransaction/1/1', () => ({ transaction: s.transaction(other, oj, 100) })],
      ['work update', 'put', () => '/transactions/updateTransaction/1/1', () => ({ transaction: row.payload })],
      ['work delete', 'delete', () => '/transactions/deleteTransaction/1/1', () => ({ transaction: { transactionID: row.transaction_id, customerID: other.id } })],
      ['retainer create', 'post', () => '/retainers/createRetainer/1/1', () => ({ retainer: { customerID: c.id, unitCost: 50, typeOfHold: 'Retainer' } })],
      ['retainer update', 'put', () => '/retainers/updateRetainer/1/1', () => ({ retainer: { retainerID: hold.retainer_id, unitCost: 40 } })],
      ['retainer delete', 'delete', () => `/retainers/deleteRetainer/${hold.retainer_id}/1/1`],
      ['payment create', 'post', () => '/payments/createPayment/1/1', () => ({ payment: s.payment(c, 20, { selectedInvoiceID: inv.customer_invoice_id }) })],
      ['payment update', 'put', () => '/payments/updatePayment/1/1', () => ({ payment: { paymentID: 99999, unitCost: 20 } })],
      ['payment delete', 'delete', () => '/payments/deletePayment/1/1', () => ({ payment: { paymentID: 99999 } })],
      ['payment reverse', 'post', () => '/payments/reversePayment/1/1', () => ({ payment: { paymentID: 99999, reason: 'NSF' } })],
      ['writeoff create', 'post', () => '/writeOffs/createWriteOffs/1/1', () => ({ writeOff: s.credit(c, 20) })],
      ['writeoff update', 'put', () => '/writeOffs/updateWriteOffs/1/1', () => ({ writeOff: { writeoffID: 99999, unitCost: 20 } })],
      ['writeoff delete', 'delete', () => '/writeOffs/deleteWriteOffs/1/1', () => ({ writeOff: { writeoffID: 99999 } })],
      ['finalize', 'post', () => '/invoices/createInvoice/1/1', () => s.configuration([other], { isFinalized: true })],
      ['invoice delete', 'delete', () => `/invoices/deleteInvoice/1/${inv.customer_invoice_id}`],
      ['AR', 'get', () => '/accountsReceivable/aging/1/1'],
      ['audit', 'post', () => '/accountAudit/run/1/1', () => ({ customer_ids: [c.id] })],
      ['cascade', 'put', () => `/billing-review/transaction/${row.transaction_id}/1/1`, () => ({ updates: { total_transaction: 120 } })]
   ];
   for (const [name, method, url, body] of routes) {
      it(`X auth ${name}: missing, expired, absent user, staff role and foreign tenant refused`, async () => {
         for (const [role, status] of [[null, 401], ['stranger', 401], ['staff', 403], ['foreign', 403]]) {
            await s.reject(() => s.req(method, url(), body && body(), role), null, c, balance, status);
         }
         const before = await s.state();
         let req = s.request[method](url()).set('Authorization', `Bearer ${s.token('sa', { expiresIn: '-1s' })}`);
         if (body) req = req.send(body());
         refused(await req, null, 401); expect(await s.state()).to.deep.equal(before);
      });
   }
   it('X audit also refuses an Admin; malformed and foreign account URL cannot bypass scope', async () => {
      await s.reject(() => s.post('/accountAudit/run/1/2', { customer_ids: [c.id] }, 'admin'), null, c, balance, 403);
      for (const account of ['700', 'bogus', '1.2']) await s.reject(() => s.post(`/payments/createPayment/${account}/1`, { payment: s.payment(c, 10, { selectedInvoiceID: inv.customer_invoice_id }) }), null, c, balance, 403);
   });

   for (const field of ['quantity', 'unitCost', 'totalTransaction']) for (const value of [undefined, null, '', true, 'NaN', 'Infinity', -1, 100000000, 0.001]) {
      it(`X price refuses ${field}=${String(value)} with no ledger movement`, async () => {
         await s.reject(() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(other, oj, 100, { [field]: value }) }), /number|decimal/i, other, workBalance);
      });
   }
   for (const [label, overrides, pattern] of [
      ['incorrect product', { totalTransaction: 99 }, /times rate/i],
      ['wrong duration', { transactionType: 'Time', minutes: 7, quantity: 1 }, /six-minute/i],
      ['negative duration', { transactionType: 'Time', minutes: -1 }, /six-minute/i],
      ['nonnumeric duration', { transactionType: 'Time', minutes: 'no' }, /six-minute/i],
      ['invalid type', { transactionType: 'Payment' }, /transaction_type/i],
      ['missing customer', { customerID: 999999 }, /customer/i],
      ['foreign customer', { customerID: 70001 }, /customer/i],
      ['missing job', { customerJobID: 999999 }, /job/i],
      ['other customer job', { customerJobID: 1 }, /job/i],
      ['foreign job', { customerJobID: 70001 }, /job/i],
      ['foreign employee', { loggedForUserID: 70001 }, /user|employee/i],
      ['missing description', { selectedGeneralWorkDescriptionID: 999999 }, /description/i],
      ['foreign retainer', { selectedRetainerID: 1 }, /different customer/i],
      ['missing retainer', { selectedRetainerID: 999999 }, /retainer/i]
   ]) it(`X work ${label}`, async () => {
      await s.reject(() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(other, oj, 100, overrides) }), pattern, other, workBalance);
   });
   it('X work deletion uses stored price even when caller submits forged invalid price', async () => {
      const temp = await s.work(other, oj, 25); await s.check(other, { n: 125, b: 0, r: -40 });
      ok(await s.del('/transactions/deleteTransaction/1/1', { transaction: { transactionID: temp.transaction_id, customerID: other.id, totalTransaction: -999 } }));
      await s.check(other, workBalance); await s.family(oj, 100);
   });
   for (const [label, overrides, pattern] of [
      ['zero', { unitCost: 0 }, /amount/i], ['subcent', { unitCost: 0.001 }, /amount/i], ['nan', { unitCost: 'NaN' }, /amount/i],
      ['date', { transactionDate: 'not-a-date' }, /date/i], ['missing invoice', { selectedInvoiceID: null }, /invoice/i],
      ['unknown invoice', { selectedInvoiceID: 999999 }, /invoice/i], ['foreign job', { selectedJobID: 70001 }, /job/i],
      ['other customer', { customerID: 1 }, /different customer/i], ['foreign customer', { customerID: 70001 }, /customer/i],
      ['wrong retainer owner', { selectedRetainerID: 1 }, /different customer/i], ['unknown retainer', { selectedRetainerID: 999999 }, /retainer/i],
      ['funding without invoice', { selectedInvoiceID: null, selectedRetainerID: 1, holdAsPrepayment: true }, /invoice/i],
      ['overpayment', { unitCost: 201 }, /exceed/i]
   ]) it(`X receipt ${label}`, async () => {
      await s.reject(() => s.post('/payments/createPayment/1/1', { payment: s.payment(c, 20, { selectedInvoiceID: inv.customer_invoice_id, ...overrides }) }), pattern, c, balance);
   });
   for (const [label, overrides, pattern] of [
      ['zero', { unitCost: 0 }, /amount/i], ['subcent', { unitCost: 0.001 }, /amount/i], ['nan', { unitCost: 'NaN' }, /amount/i],
      ['date', { selectedDate: 'not-a-date' }, /date/i], ['reason', { writeoffReason: '' }, /reason/i],
      ['foreign customer', { customerID: 70001 }, /customer/i], ['wrong customer invoice', { customerID: 1 }, /different customer/i],
      ['unknown invoice', { customerInvoiceID: 999999 }, /invoice/i], ['other customer job', { selectedJobID: 1 }, /job/i],
      ['over-credit', { unitCost: 201 }, /exceed/i]
   ]) it(`X writeoff ${label}`, async () => {
      await s.reject(() => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 20, { customerInvoiceID: inv.customer_invoice_id, ...overrides }) }), pattern, c, balance);
   });
   for (const overrides of [{ unitCost: 0 }, { unitCost: 0.001 }, { unitCost: 'NaN' }, { typeOfHold: '' }, { customerID: 70001 }, { customerID: 999999 }]) {
      it(`X retainer create refuses ${JSON.stringify(overrides)}`, async () => {
         await s.reject(() => s.post('/retainers/createRetainer/1/1', { retainer: { customerID: other.id, unitCost: 40, typeOfHold: 'Retainer', ...overrides } }), /amount|hold|customer/i, other, workBalance);
      });
   }
   it('X retainer update refuses a subcent amount that rounds to zero', async () => {
      await s.reject(() => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 0.001 } }), /amount/i, other, workBalance);
   });
   for (const [field, value] of [['quantity', -1], ['unit_cost', ''], ['total_transaction', 100000000], ['total_transaction', 'NaN'], ['is_transaction_billable', 'maybe'], ['note', {}], ['transaction_date', '2026-02-30'], ['customer_job_id', null], ['customer_job_id', 70001], ['general_work_description_id', 999999]]) {
      it(`X cascade refuses invalid ${field}=${JSON.stringify(value)}`, async () => {
         await s.reject(() => s.put(`/billing-review/transaction/${row.transaction_id}/1/1`, { updates: { [field]: value } }), null, other, workBalance, 400);
      });
   }
   for (const id of ['bogus', 999999, 70001]) it(`X read and mutation missing/foreign ID ${id}`, async () => {
      for (const url of [`/payments/getSinglePayment/${id}/1/1`, `/retainers/getSingleRetainer/${id}/1/1`, `/writeOffs/getSingleWriteOff/${id}/1/1`, `/transactions/getSingleTransaction/${other.id}/${id}/1/1`]) await s.reject(() => s.get(url), /matching|found/i, c, balance, 404);
      await s.reject(() => s.del('/transactions/deleteTransaction/1/1', { transaction: { transactionID: id, customerID: other.id } }), /found/i, other, workBalance);
      await s.reject(() => s.put(`/billing-review/transaction/${id}/1/1`, { updates: { total_transaction: 20 } }), /found/i, other, workBalance, 404);
   });
});
