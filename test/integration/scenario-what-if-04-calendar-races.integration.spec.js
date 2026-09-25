'use strict';
require('../../scripts/scenarios/guard');
// Inject only the request's clock input. The real Phoenix conversion, invoice
// engine, PDF, storage and commit all run; JWT and MinIO clocks remain real.
const calendar = require('../../src/endpoints/invoice/billingDate');
const realDate = calendar.billingDateToday; let instant;
calendar.billingDateToday = () => realDate(instant);
const { Scenario, ok, refused, expect } = require('./_scenario');
const { S3Client } = require('@aws-sdk/client-s3');
describe('what-if T: Phoenix midnight, calendar limits and overlapping billing', function () {
   this.timeout(180000); const s = new Scenario();
   before(() => s.boot()); after(async () => { calendar.billingDateToday = realDate; await s.close(); });
   const dates = [
      ['2024-02-29T06:59:00Z', '2024-02-28', 'INV-2024-00001', '2024-03-15'],
      ['2024-02-29T07:00:00Z', '2024-02-29', 'INV-2024-00002', '2024-03-16'],
      ['2024-03-01T06:59:00Z', '2024-02-29', 'INV-2024-00003', '2024-03-16'],
      ['2024-03-01T07:00:00Z', '2024-03-01', 'INV-2024-00004', '2024-03-17'],
      ['2026-12-01T06:59:00Z', '2026-11-30', 'INV-2026-00001', '2026-12-16'],
      ['2026-12-01T07:00:00Z', '2026-12-01', 'INV-2026-00002', '2026-12-17'],
      ['2027-01-01T06:59:00Z', '2026-12-31', 'INV-2026-00003', '2027-01-16'],
      ['2027-01-01T07:00:00Z', '2027-01-01', 'INV-2027-00001', '2027-01-17']
   ];
   for (const [clock, date, number, due] of dates) it(`T02 ${clock} issues ${date}, ${number}, due ${due}`, async () => {
      instant = clock;
      const c = await s.customer(`Calendar ${date} ${number}`), j = await s.job(c);
      await s.work(c, j, 100, { transactionDate: date }); const result = await s.finalize([c]);
      const row = await s.db('customer_invoices').select('*', s.db.raw('invoice_date::text AS issued, due_date::text AS due')).where({ customer_id: c.id }).whereNull('parent_invoice_id').first();
      expect([row.issued, row.invoice_number, row.due, row.total_amount_due]).to.deep.equal([date, number, due, '100.00']);
      const files = await s.files(result.fileLocation), pdf = s.pdf(files[Object.keys(files).find(n => n.endsWith(`_customer_${c.id}.pdf`))]);
      expect(pdf).to.include(number); expect(pdf).to.include(`Payment Due Date: ${due.slice(5, 7)}/${due.slice(8, 10)}/${due.slice(0, 4)}`); expect(pdf).to.include('Balance Due: 100.00');
      const before = await s.state(); const retry = await s.finalize([c]); expect(retry.skippedCustomers).to.have.lengthOf(1); expect(await s.state()).to.deep.equal(before);
   });
   it('T02 midnight allows the next calendar statement and carries $100 plus $20 once', async () => {
      instant = '2027-02-01T06:59:00Z'; const c = await s.customer('Midnight carry'), j = await s.job(c);
      await s.work(c, j, 100, { transactionDate: '2027-01-31' }); await s.finalize([c]);
      instant = '2027-02-01T07:00:00Z'; await s.work(c, j, 20, { transactionDate: '2027-02-01' }); await s.finalize([c]);
      const rows = await s.db('customer_invoices').select('*', s.db.raw('invoice_date::text AS date')).where({ customer_id: c.id }).whereNull('parent_invoice_id').orderBy('customer_invoice_id');
      expect(rows.map(r => [r.date, r.total_amount_due, r.remaining_balance_on_invoice])).to.deep.equal([['2027-01-31', '100.00', '100.00'], ['2027-02-01', '120.00', '120.00']]);
   });
   it('T03 future work stays unbilled until its date: $0, then $10, then $30 carried forward', async () => {
      instant = '2027-02-01T19:00:00Z'; const c = await s.customer('Future-dated work'), j = await s.job(c);
      await s.work(c, j, 10, { transactionDate: '2027-02-02' }); await s.work(c, j, 20, { transactionDate: '2028-01-01' });
      expect((await s.preview(c)).invoiceTotal).to.equal(0); await s.finalize([c]);
      let entries = await s.db('customer_transactions').where({ customer_id: c.id }).orderBy('transaction_id'); entries.forEach(t => expect(t.customer_invoice_id).to.equal(null));
      instant = '2027-02-02T19:00:00Z'; expect((await s.preview(c)).invoiceTotal).to.equal(10); await s.finalize([c]);
      entries = await s.db('customer_transactions').where({ customer_id: c.id }).orderBy('transaction_id'); expect(entries[0].customer_invoice_id).to.be.a('number'); expect(entries[1].customer_invoice_id).to.equal(null);
      instant = '2028-01-01T19:00:00Z'; expect((await s.preview(c)).invoiceTotal).to.equal(30); await s.finalize([c]);
      const row = await s.db('customer_invoices').where({ customer_id: c.id }).whereNull('parent_invoice_id').orderBy('customer_invoice_id', 'desc').first(); expect(row.total_amount_due).to.equal('30.00');
      entries = await s.db('customer_transactions').where({ customer_id: c.id }).orderBy('transaction_id'); expect(entries[0].customer_invoice_id).not.to.equal(row.customer_invoice_id); expect(entries[1].customer_invoice_id).to.equal(row.customer_invoice_id);
   });
   async function duringRendering(change, run) {
      const send = S3Client.prototype.send; let fired = false;
      try {
         S3Client.prototype.send = async function(command, ...args) {
            if (!fired && command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/invoice_images/')) { fired = true; await change(); }
            return send.call(this, command, ...args);
         };
         const result = await run(); expect(fired).to.equal(true); return result;
      } finally { S3Client.prototype.send = send; }
   }
   it('T01 payment during rendering preserves $90 and refuses stale $100 rebill', async () => {
      instant = undefined; const c = await s.customer('Payment in render'), j = await s.job(c); await s.work(c, j, 100); await s.finalize([c]);
      const inv = await s.db('customer_invoices').where({ customer_id: c.id }).whereNull('parent_invoice_id').first();
      const response = await duringRendering(() => s.pay(c, 10, { selectedInvoiceID: inv.customer_invoice_id }), () => s.post('/invoices/createInvoice/1/1', s.configuration([c], { isFinalized: true, allowSameDayRebill: true })));
      refused(response, /ledger changed/i); expect(await s.db('customer_invoices').where({ customer_id: c.id }).whereNull('parent_invoice_id')).to.have.lengthOf(1);
      await s.check(c, { n: 90, b: 90 });
   });
   it('T01 edit during rendering preserves $110 unbilled and refuses stale $100 invoice', async () => {
      const c = await s.customer('Edit in render'), j = await s.job(c), row = await s.work(c, j, 100);
      const response = await duringRendering(async () => ok(await s.editWork(row, { unitCost: 110, totalTransaction: 110 })), () => s.post('/invoices/createInvoice/1/1', s.configuration([c], { isFinalized: true })));
      refused(response, /Transactions changed/i); expect(await s.db('customer_invoices').where({ customer_id: c.id })).to.have.lengthOf(0); await s.check(c, { n: 110, b: 0 });
   });
   it('D02/T01 simultaneous finalizations produce one parent and one explicit conflict', async () => {
      const c = await s.customer('Concurrent finalize'), j = await s.job(c); await s.work(c, j, 100);
      const send = S3Client.prototype.send; let ready = 0, release;
      const gate = new Promise(resolve => { release = resolve; }); const timeout = setTimeout(release, 10000);
      try {
         S3Client.prototype.send = async function(command, ...args) {
            if (command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/invoice_images/')) { ready++; if (ready === 2) release(); await gate; }
            return send.call(this, command, ...args);
         };
         const responses = await Promise.all([1, 2].map(() => s.post('/invoices/createInvoice/1/1', s.configuration([c], { isFinalized: true })).then(r => r)));
         expect(ready).to.equal(2); expect(responses.map(r => r.body.status).sort()).to.deep.equal([200, 409]);
         refused(responses.find(r => r.body.status !== 200), /finalized today by another run/);
      } finally { clearTimeout(timeout); release(); S3Client.prototype.send = send; }
      expect(await s.db('customer_invoices').where({ customer_id: c.id }).whereNull('parent_invoice_id')).to.have.lengthOf(1); await s.check(c, { n: 100, b: 100 });
   });
});
