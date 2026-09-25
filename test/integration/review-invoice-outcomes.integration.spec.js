const { bootHttp, expectEnvelopeOk } = require('./_http');
const fixture = require('./_review-fixture');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const { billingDateToday } = require('../../src/endpoints/invoice/billingDate');
const { deleteObject } = require('../../src/utils/s3');

describe('F14 invoice work cutoff', function () {
   let h, f; const keys = [];
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => {
      if (!h) return;
      const rows = await h.db('customer_invoices').where({ account_id: 9001 }).whereIn('customer_id', customers);
      for (const key of [...keys, ...rows.map(r => r.invoice_file_location)].filter(Boolean)) await deleteObject(key);
      await f.cleanup(); await h.close();
   });
   const customers = [];
   it('uses the same billing calendar date in WIP and preview across server date boundaries', async () => {
      const c = await f.customer(); customers.push(c.customer_id); const j = await f.job(c);
      await f.transaction(c, j, { transactionDate: '2026-09-01' });
      await f.transaction(c, j, { transactionDate: '2026-09-02' });
      const wip = await require('../../src/endpoints/analytics/analytics-service').getWipAging(h.db, 9001, { billingDate: '2026-09-01' });
      const row = wip.find(r => r.customer_id === c.customer_id);
      expect(row.unbilled_amount).to.equal(100);
      expect(row.future_dated_amount).to.equal(100);
      const query = await fetchInitialQueryItems(h.db, { [c.customer_id]: c }, 9001, { billingDate: '2026-09-01' });
      expect(calculateInvoices([c], query)[0].invoiceTotal).to.equal(row.unbilled_amount);
   });
   it('includes stale past and billing-day work but leaves future work unbilled on finalize', async () => {
      const c = await f.customer(); customers.push(c.customer_id);
      const j = await f.job(c);
      const past = await f.transaction(c, j, { transactionDate: '2000-01-01' });
      const today = await f.transaction(c, j, { transactionDate: billingDateToday(), unitCost: 50, totalTransaction: 50 });
      const future = await f.transaction(c, j, { transactionDate: '2058-01-01' });
      const query = await fetchInitialQueryItems(h.db, { [c.customer_id]: c }, 9001, { billingDate: billingDateToday() });
      expect(calculateInvoices([c], query)[0].invoiceTotal).to.equal(150);
      const res = await h.as('admin').post('/invoices/createInvoice/9001/90013').send({ invoiceConfiguration: { invoicesToCreate: [c], invoiceCreationSettings: { isFinalized: true, globalInvoiceNote: '' } } });
      if (res.body.fileLocation) keys.push(res.body.fileLocation);
      expectEnvelopeOk(res);
      const rows = await h.db('customer_transactions').where({ account_id: 9001, customer_id: c.customer_id });
      expect(rows.find(t => t.transaction_id === future.transaction_id).customer_invoice_id).to.equal(null);
      for (const t of [past, today]) expect(rows.find(row => row.transaction_id === t.transaction_id).customer_invoice_id).to.be.a('number');
   });
});

describe('F15 postcommit invoice outcomes', function () {
   let h, f; const keys = []; const customers = [];
   const { S3Client } = require('@aws-sdk/client-s3');
   const invoiceService = require('../../src/endpoints/invoice/invoice-service');
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { for (const key of new Set(keys)) await deleteObject(key); await f.cleanup(); await h.close(); } });
   for (const failure of ['combined ZIP', 'invoice list']) it(`returns committed identities and retrievable individual files after ${failure} failure`, async () => {
      const c = await f.customer(); customers.push(c.customer_id);
      const j = await f.job(c); const t = await f.transaction(c, j, { transactionDate: '2000-01-01' });
      const send = S3Client.prototype.send; const getInvoices = invoiceService.getInvoices;
      let res;
      try {
         S3Client.prototype.send = function (command, ...args) {
            if (command.constructor.name === 'PutObjectCommand') {
               if (failure === 'combined ZIP' && command.input.Key.includes('/final_invoices/')) throw new Error('F15 export unavailable');
               keys.push(command.input.Key);
            }
            return send.call(this, command, ...args);
         };
         if (failure === 'invoice list') invoiceService.getInvoices = async () => { throw new Error('F15 readback unavailable'); };
         res = await h.as('admin').post('/invoices/createInvoice/9001/90013').send({ invoiceConfiguration: { invoicesToCreate: [c], invoiceCreationSettings: { isFinalized: true, globalInvoiceNote: '' } } });
      } finally { S3Client.prototype.send = send; invoiceService.getInvoices = getInvoices; }
      const stored = await h.db('customer_invoices').where({ account_id: 9001, customer_id: c.customer_id }).first();
      expect(stored).to.exist;
      expect((await h.db('customer_transactions').where({ account_id: 9001, transaction_id: t.transaction_id }).first()).customer_invoice_id).to.equal(stored.customer_invoice_id);
      expectEnvelopeOk(res);
      expect(res.body.committed).to.equal(true);
      expect(res.body.committedInvoices[0]).to.include({ customer_invoice_id: stored.customer_invoice_id, invoice_number: stored.invoice_number, invoice_file_location: stored.invoice_file_location });
      expect(res.body.warnings).to.have.lengthOf(1);
      const download = await h.as('admin').get('/invoices/downloadFile/9001/90013').query({ fileLocation: stored.invoice_file_location });
      expect(download.status).to.equal(200);
   });
});
