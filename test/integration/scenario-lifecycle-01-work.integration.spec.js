'use strict';
const { Scenario, ok, expect } = require('./_scenario');

describe('scenario lifecycle W: clients, jobs and work (hand oracle 01-work.md)', function () {
   this.timeout(180000);
   const s = new Scenario(); let c, tax, payroll, first, flat, inv;
   before(async () => { await s.boot(); });
   after(async () => { await s.close(); });

   it('W01 creates a new client and two distinct jobs through HTTP', async () => {
      c = await s.customer('Scenario Client A');
      tax = await s.job(c, 1); await s.check(c, { n: 0, b: 0 });
      payroll = await s.job(c, 4); await s.check(c, { n: 0, b: 0 });
      await s.family(tax, 0); await s.family(payroll, 0);
      const p = ok(await s.get(`/customer/activeCustomers/customerByID/1/1/${c.id}`));
      expect(p.customerData.customerData.display_name).to.equal(c.name);
      expect(ok(await s.get(`/jobs/getActiveCustomerJobs/1/1/${c.id}`)).activeCustomerJobData.activeCustomerJobs).to.have.lengthOf(2);
   });
   it('W02 rounds 7 minutes to 0.2 hours and $30', async () => {
      first = await s.work(c, tax, 30, { transactionType: 'Time', quantity: 0.2, unitCost: 150, minutes: 7 });
      await s.family(tax, 30); await s.check(c, { n: 30, b: 0, charges: 30 });
   });
   it('W03 accepts the exact hour boundary: 60 minutes is $150', async () => {
      await s.work(c, tax, 150, { transactionType: 'Time', quantity: 1, unitCost: 150, minutes: 60 });
      await s.family(tax, 180); await s.check(c, { n: 180, b: 0, charges: 180 });
   });
   it('W04 rounds 61 minutes to 1.1 hours and $165', async () => {
      await s.work(c, tax, 165, { transactionType: 'Time', quantity: 1.1, unitCost: 150, minutes: 61 });
      await s.family(tax, 345); await s.check(c, { n: 345, b: 0, charges: 345 });
   });
   it('W05 adds a separate flat charge of 2 × $12.50', async () => {
      flat = await s.work(c, payroll, 25, { quantity: 2, unitCost: 12.50 });
      await s.family(payroll, 25); await s.check(c, { n: 370, b: 0, charges: 370 });
   });
   it('W06 records $50 nonbillable time in the family, excludes it from all financial views', async () => {
      const row = await s.work(c, tax, 50, { transactionType: 'Time', quantity: 0.5, unitCost: 100, minutes: 30, isTransactionBillable: false });
      expect(row.is_transaction_billable).to.equal(false);
      await s.family(tax, 395); await s.check(c, { n: 370, b: 0 });
   });
   it('W07 corrects 7 to 13 minutes before billing; updates one family by $15', async () => {
      ok(await s.editWork(first, { quantity: 0.3, unitCost: 150, totalTransaction: 45, minutes: 13 }));
      await s.family(tax, 410); await s.check(c, { n: 385, b: 0 });
   });
   it('W08 deletes and re-enters the flat charge without stale family totals', async () => {
      ok(await s.deleteWork(flat)); await s.family(payroll, 0); await s.check(c, { n: 360, b: 0 });
      flat = await s.work(c, payroll, 25, { quantity: 2, unitCost: 12.50 });
      await s.family(payroll, 25); await s.check(c, { n: 385, b: 0 });
   });
   it('W09 edits contact and job metadata, refuses duplicate customers/jobs', async () => {
      ok(await s.put('/customer/updateCustomer/1/1', { customer: { ...c.payload, customerStreet: '20 Revised Way' } }));
      await s.check(c, { n: 385, b: 0 });
      ok(await s.put('/jobs/updateJob/1/1', { job: s.jobBody(c, 1, { customerJobID: tax.customer_job_id, notes: 'Reviewed tax work', currentJobTotal: 410 }) }));
      await s.check(c, { n: 385, b: 0 }); await s.family(tax, 410);
      await s.reject(() => s.post('/customer/createCustomer/1/1', { customer: c.payload }), /already exists/i, c, { n: 385, b: 0 });
      await s.reject(() => s.post('/jobs/createJob/1/1', { job: s.jobBody(c) }), /Duplicate job/i, c, { n: 385, b: 0 });
   });
   it('W10 issues $385, stamps all five rows, and verifies statement PDF, audit and AR', async () => {
      const body = await s.finalize([c]);
      inv = await s.statement(c, body, 1, [0, 385, 0, 0, 0, 385], ['2025 Form 1040', 'Payroll']);
      const rows = await s.db('customer_transactions').where({ customer_id: c.id });
      expect(rows).to.have.lengthOf(5);
      expect(rows.every(r => r.customer_invoice_id === inv.customer_invoice_id)).to.equal(true);
   });
   it('W11 refuses billed work edits/deletes and linked customer/job deletion', async () => {
      for (const [action, pattern] of [
         [() => s.editWork(first, { note: 'ordinary edit should refuse' }), /locked: part of sent invoice/i],
         [() => s.deleteWork(first), /locked: part of sent invoice/i],
         [() => s.del(`/jobs/deleteJob/${tax.customer_job_id}/1/1`), /locked: part of sent invoice/i],
         [() => s.del(`/customer/deleteCustomer/${c.id}/1/1`), /locked: part of sent invoice/i]
      ]) await s.reject(action, pattern, c, { n: 385, b: 385 });
   });
   it('W12 forces internal/nonbillable clients to nonbillable despite caller flags and a retainer', async () => {
      for (const [name, more] of [['Clean Room CPA', {}], ['Scenario Nonbillable', { isCustomerBillable: false }]]) {
         const internal = await s.customer(name, more); const j = await s.job(internal);
         const retainer = await s.retainer(internal, 200); await s.check(internal, { n: 0, b: 0, r: -200 });
         const row = await s.work(internal, j, 100, { transactionType: 'Time', minutes: 60, selectedRetainerID: retainer.retainer_id });
         expect(row.is_transaction_billable).to.equal(false); expect(row.retainer_id).to.equal(null);
         await s.family(j, 100); await s.check(internal, { n: 0, b: 0, r: -200 });
      }
   });
   it('W13 completes empty customer and unused job CRUD', async () => {
      const empty = await s.customer('Scenario Empty'); const j = await s.job(empty);
      expect(ok(await s.get(`/jobs/getSingleJob/${j.customer_job_id}/1/1`)).activeJobData.activeJobs).to.have.lengthOf(1);
      ok(await s.put('/jobs/updateJob/1/1', { job: s.jobBody(empty, 1, { customerJobID: j.customer_job_id, notes: 'Rename note' }) }));
      await s.check(empty, { n: 0, b: 0 });
      ok(await s.del(`/jobs/deleteJob/${j.customer_job_id}/1/1`)); await s.check(empty, { n: 0, b: 0 });
      ok(await s.put('/customer/updateCustomer/1/1', { customer: { ...empty.payload, customerBusinessName: 'Scenario Renamed' } }));
      empty.name = 'Scenario Renamed'; await s.check(empty, { n: 0, b: 0 });
      ok(await s.del(`/customer/deleteCustomer/${empty.id}/1/1`));
      expect(await s.db('customers').where({ customer_id: empty.id }).first()).to.equal(undefined);
      await s.reject(() => s.get(`/customer/activeCustomers/customerByID/1/1/${empty.id}`), /not found/i);
   });
});
