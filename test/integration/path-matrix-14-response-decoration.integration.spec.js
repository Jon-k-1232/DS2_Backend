'use strict';
const { PathScenario, expect, ok } = require('./_path-matrix');

describe('Path matrix: sent-lock response decoration failures', function () {
   this.timeout(180000);
   let s, customer, job;
   const lockLookup = /SELECT t, id, ds2_locked_invoice/i;
   before(async () => {
      s = await new PathScenario().boot();
      customer = await s.customer('PM response decoration');
      job = await s.job(customer);
      await s.work(customer, job, 100);
   });
   after(() => s?.close());
   it('GET transactions | failed lock lookup refuses 500 without writing or exposing unannotated rows', () =>
      s.queryFault(lockLookup, () => s.refused(() => s.get('/transactions/getTransactions/1/1'), 500, undefined, /path-matrix/)));
   it('POST work | failed lock decoration reports one committed ten-dollar charge and a reload warning', async () => {
      const before = await s.db('customer_transactions').where({ customer_id: customer.id }).count('* as n').first();
      const r = await s.queryFault(lockLookup, () => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(customer, job, 10) }));
      ok(r);
      expect(r.body.committed).eq(true);
      expect(r.body.warnings.join(' ')).match(/saved.*[Rr]eload.*do not submit/);
      const rows = await s.db('customer_transactions').where({ customer_id: customer.id });
      expect(rows).length(Number(before.n) + 1);
      expect(rows.reduce((sum, row) => sum + Number(row.total_transaction), 0)).eq(110);
      expect(r.body).not.have.property('transactionsList');
   });
   it('POST finalize | failed lock decoration preserves sent status, exact 110-dollar statement and immutable issue', async () => {
      const r = await s.queryFault(lockLookup, () => s.post('/invoices/createInvoice/1/1', s.configuration([customer], { isFinalized: true })));
      ok(r);
      expect(r.body.committed).eq(true);
      expect(r.body.warnings.join(' ')).match(/saved.*[Rr]eload.*do not submit/);
      expect(r.body.fileLocation).to.be.a('string').and.not.eq('');
      const issues = await s.db('invoice_issues').where({ customer_id: customer.id });
      expect(issues).length(1);
      const invoice = await s.db('customer_invoices').where({ customer_invoice_id: issues[0].invoice_id }).first();
      expect(Number(invoice.total_amount_due)).eq(110);
      expect(await s.db('invoice_revisions').where({ invoice_id: invoice.customer_invoice_id })).length(1);
      await s.refused(() => s.del(`/invoices/deleteInvoice/1/${invoice.customer_invoice_id}`), 409, 409, /locked: part of sent invoice/);
   });
   it('POST finalize | failed decoration preserves the download and skipped-customer identities in a partial batch', async () => {
      const other = await s.customer('PM partial committed batch'), otherJob = await s.job(other); await s.work(other, otherJob, 50);
      const r = await s.queryFault(lockLookup, () => s.post('/invoices/createInvoice/1/1', s.configuration([customer, other], { isFinalized: true })));
      ok(r); expect(r.body.committed).eq(true);
      expect(r.body.fileLocation).to.be.a('string').and.not.eq('');
      expect(r.body.skippedCustomers).length(1); expect(r.body.skippedCustomers[0].customer_id).eq(customer.id);
      expect(r.body.skippedCustomers[0].reason).match(/Already finalized today/);
      expect(r.body.committedInvoices).length(1); expect(r.body.committedInvoices[0].customer_id).eq(other.id);
      expect(r.body.committedInvoices[0]).not.have.property('total_amount_due');
      expect(r.body).not.have.property('invoicesList');
      const rows = await s.db('customer_invoices').where({ customer_id: other.id }).whereNull('parent_invoice_id');
      expect(rows).length(1); expect(Number(rows[0].total_amount_due)).eq(50);
   });
   it('GET transactions | failed root-invoice lookup refuses 500 without changing the sent ledger', () =>
      s.queryFault(/select "invoice_number", "customer_invoice_id" from "customer_invoices"/i, () => s.refused(() => s.get('/transactions/getTransactions/1/1'), 500, undefined, /path-matrix/)));
});
