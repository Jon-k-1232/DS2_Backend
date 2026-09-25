'use strict';
const { Scenario, ok, refused, expect, money } = require('./_scenario');
const { S3Client } = require('@aws-sdk/client-s3');
describe('scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md)', function () {
   this.timeout(180000); const s = new Scenario(); let c, j, inv, work, pending, pj, pt, hold;
   const billed = { n: 200, b: 200 }, unbilled = { n: 100, b: 0, r: -100 };
   before(async () => {
      await s.boot(); c = await s.customer('Scenario Failure Billed'); j = await s.job(c); work = await s.work(c, j, 200); await s.check(c, { n: 200, b: 0 });
      inv = await s.statement(c, await s.finalize([c]), 1, [0, 200, 0, 0, 0, 200]);
      pending = await s.customer('Scenario Failure Pending'); pj = await s.job(pending); pt = await s.work(pending, pj, 100); hold = await s.retainer(pending, 100); await s.check(pending, unbilled);
   });
   after(async () => { await s.close(); });
   const failures = [
      ['customer contact insert', 'customer_information', 'INSERT', () => s.post('/customer/createCustomer/1/1', { customer: s.customerBody('Scenario Should Roll Back') }), () => c, () => billed],
      ['job insert', 'customer_jobs', 'INSERT', () => s.post('/jobs/createJob/1/1', { job: s.jobBody(pending, 4) }), () => pending, () => unbilled],
      ['work insert after job snapshot', 'customer_transactions', 'INSERT', () => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(pending, pj, 30) }), () => pending, () => unbilled],
      ['funded work payment after job, draw and work inserts', 'customer_payments', 'INSERT', () => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(pending, pj, 30, { selectedRetainerID: hold.retainer_id }) }), () => pending, () => unbilled],
      ['work delete after family snapshot', 'customer_transactions', 'DELETE', () => s.deleteWork(pt), () => pending, () => unbilled],
      ['retainer insert', 'customer_retainers_and_prepayments', 'INSERT', () => s.post('/retainers/createRetainer/1/1', { retainer: { customerID: pending.id, unitCost: 30, typeOfHold: 'Retainer' } }), () => pending, () => unbilled],
      ['retainer update', 'customer_retainers_and_prepayments', 'UPDATE', () => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 120 } }), () => pending, () => unbilled],
      ['payment after invoice snapshot', 'customer_payments', 'INSERT', () => s.post('/payments/createPayment/1/1', { payment: s.payment(c, 20, { selectedInvoiceID: inv.customer_invoice_id }) }), () => c, () => billed],
      ['writeoff after invoice snapshot', 'customer_writeoffs', 'INSERT', () => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 20, { customerInvoiceID: inv.customer_invoice_id }) }), () => c, () => billed],
      ['cascade unissued work update', 'customer_transactions', 'UPDATE', () => s.put(`/billing-review/transaction/${pt.transaction_id}/1/1`, { updates: { total_transaction: 120 } }), () => pending, () => unbilled],
      ['finalize stamping after parent insert', 'customer_transactions', 'UPDATE', () => s.post('/invoices/createInvoice/1/1', s.configuration([pending], { isFinalized: true })), () => pending, () => unbilled]
   ];
   for (const [label, table, event, action, customer, expected] of failures) it(`F atomic rollback: ${label}`, async () => {
      await s.dbFailure(table, event, () => s.reject(action, /scenario injected|error/i));
      await s.check(customer(), expected());
   });
   const readFailures = [
      ['customer/customer-service', 'getCustomerByID', () => `/customer/activeCustomers/customerByID/1/1/${c.id}`],
      ['job/job-service', 'getSingleJob', () => `/jobs/getSingleJob/${j.customer_job_id}/1/1`],
      ['transactions/transactions-service', 'getSingleTransaction', () => `/transactions/getSingleTransaction/${pending.id}/${pt.transaction_id}/1/1`],
      ['retainer/retainer-service', 'getSingleRetainer', () => `/retainers/getSingleRetainer/${hold.retainer_id}/1/1`],
      ['payments/payments-service', 'getSinglePayment', () => '/payments/getSinglePayment/999999/1/1'],
      ['writeOffs/writeOffs-service', 'getSingleWriteOff', () => '/writeOffs/getSingleWriteOff/999999/1/1'],
      ['invoice/invoice-service', 'getInvoiceByInvoiceRowID', () => `/invoices/getInvoiceDetails/${inv.customer_invoice_id}/1/1`],
      ['accountsReceivable/accounts-receivable-service', 'getAging', () => '/accountsReceivable/aging/1/1'],
      ['accountAudit/account-audit-service', 'getAuditById', () => '/accountAudit/audit/999999/1/1']
   ];
   for (const [module, method, url] of readFailures) it(`F read failure: ${module}.${method}`, async () => {
      const service = require(`../../src/endpoints/${module}`); const original = service[method];
      expect(original).to.be.a('function');
      try { service[method] = async () => { throw new Error('scenario injected read failure'); }; await s.reject(() => s.get(url()), null); }
      finally { service[method] = original; }
      await s.check(c, billed); await s.check(pending, unbilled);
   });
   it('F precommit storage failure refuses issuance and preserves all ledger rows', async () => {
      const send = S3Client.prototype.send;
      try {
         S3Client.prototype.send = function(command, ...args) {
            if (command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/invoice_images/')) throw new Error('scenario local storage failure');
            return send.call(this, command, ...args);
         };
         await s.reject(() => s.post('/invoices/createInvoice/1/1', s.configuration([pending], { isFinalized: true })), /storage|upload|scenario/i);
      } finally { S3Client.prototype.send = send; }
      await s.check(pending, unbilled);
   });
   it('F stale snapshot refuses finalize after work arrives during PDF upload', async () => {
      const send = S3Client.prototype.send; let inserted, result;
      try {
         S3Client.prototype.send = async function(command, ...args) {
            if (!inserted && command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/invoice_images/')) {
               inserted = true; await s.work(pending, pj, 10);
            }
            return send.call(this, command, ...args);
         };
         result = await s.post('/invoices/createInvoice/1/1', s.configuration([pending], { isFinalized: true }));
      } finally { S3Client.prototype.send = send; }
      refused(result, /changed|concurrent|retry|snapshot/i);
      expect(await s.db('customer_invoices').where({ customer_id: pending.id })).to.have.lengthOf(0);
      await s.check(pending, { n: 110, b: 0, r: -100 });
   });
   it('F postcommit ZIP failure reports committed $110 and individually retrievable statement', async () => {
      const send = S3Client.prototype.send; let result;
      try {
         S3Client.prototype.send = function(command, ...args) {
            if (command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/final_invoices/')) throw new Error('scenario combined export unavailable');
            return send.call(this, command, ...args);
         };
         result = ok(await s.post('/invoices/createInvoice/1/1', s.configuration([pending], { isFinalized: true, isCsvOnly: true })));
      } finally { S3Client.prototype.send = send; }
      expect(result.committed).to.equal(true); expect(result.committedInvoices).to.have.lengthOf(1); expect(result.warnings).to.have.lengthOf(1);
      const statement = await s.statement(pending, result, 2, [0, 110, 0, 0, -100, 110]);
      expect(result.committedInvoices[0].customer_invoice_id).to.equal(statement.customer_invoice_id);
      const before = await s.state(); expect((await s.finalize([pending])).invoicesWithDetail).to.have.lengthOf(0); expect(await s.state()).to.deep.equal(before);
   });
   it('F two simultaneous $120 receipts cannot overpay a $200 balance', async () => {
      const blocker = await s.db.transaction(); let requests;
      try {
         await blocker('customers').where({ account_id: 1, customer_id: c.id }).forNoKeyUpdate().first();
         requests = [1, 2].map(n => s.post('/payments/createPayment/1/1', { payment: s.payment(c, 120, { selectedInvoiceID: inv.customer_invoice_id, paymentReferenceNumber: `RACE-${n}` }) }).then(r => r));
         let waiting = false;
         for (let attempt = 0; attempt < 100; attempt++) {
            const rows = (await s.db.raw("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows;
            if (rows[0].n >= 2) { waiting = true; break; }
            await new Promise(resolve => setTimeout(resolve, 10));
         }
         expect(waiting, 'both HTTP requests reached the database ledger lock').to.equal(true);
         await blocker.commit();
      } catch (e) { await blocker.rollback(); if (requests) await Promise.all(requests); throw e; }
      const results = await Promise.all(requests);
      expect(results.map(r => r.body.status).sort()).to.deep.equal([200, 500]);
      refused(results.find(r => r.body.status !== 200), /exceed/i);
      await s.check(c, { n: 80, b: 80 });
      const payments = await s.db('customer_payments').where({ customer_id: c.id }); expect(payments).to.have.lengthOf(1); expect(money(payments[0].payment_amount)).to.equal(-120);
   });
});
