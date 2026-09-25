'use strict';
const { Scenario, ok, expect, money, ago, today } = require('./_scenario');
describe('scenario lifecycle C: billed corrections (hand oracle 06-cascade.md)', function () {
   this.timeout(180000); const s = new Scenario(); let c, j, other, t, inv;
   const edit = (row, updates, more = {}) => s.put(`/billing-review/transaction/${row.transaction_id}/1/1`, { updates, ...more });
   before(async () => { await s.boot(); }); after(async () => { await s.close(); });
   it('C01 bills $100 and receives $40, leaving $60', async () => {
      c = await s.customer('Scenario Cascade'); j = await s.job(c); other = await s.job(c, 4);
      t = await s.work(c, j, 100); await s.check(c, { n: 100, b: 0 });
      inv = await s.statement(c, await s.finalize([c]), 1, [0, 100, 0, 0, 0, 100]);
      await s.pay(c, 40, { selectedInvoiceID: inv.customer_invoice_id }); await s.check(c, { n: 60, b: 60 });
   });
   it('C02 refuses sent quantity, total, date, billability and no-op edits', async () => {
      for (const updates of [{quantity:1.2},{total_transaction:110},{total_transaction:20},{transaction_date:ago(1)},{transaction_date:today()},{is_transaction_billable:false},{}])
         await s.reject(()=>edit(t,updates),/locked: part of sent invoice/,c,{n:60,b:60},409);
      await s.family(j,100);
   });
   it('C03 freezes metadata and job links and retains original PDF bytes',async()=>{
      for(const updates of [{note:'Reviewed correction'},{customer_job_id:other.customer_job_id}]) await s.reject(()=>edit(t,updates),/locked/,c,{n:60,b:60},409);
      await s.family(j,100); await s.family(other,0);
      const files=await s.files(inv.invoice_file_location); const saved=files[Object.keys(files).find(x=>x.endsWith('.pdf'))];
      expect(saved.equals(inv.pdf)).to.equal(true); expect(s.pdf(saved)).to.include('Balance Due: 100.00');
   });
   it('C04 carries $60 forward with $30 new work and still refuses historical annotations',async()=>{
      await s.shift(31); await s.check(c,{n:60,b:60,bucket:'bucket_31_60'});
      await s.work(c,other,30); await s.check(c,{n:90,b:60,bucket:'bucket_31_60'});
      await s.statement(c,await s.finalize([c]),2,[60,30,0,0,0,90],['Total Payments Received: -40.00']);
      for(const updates of [{total_transaction:120},{note:'Historical annotation'}]) await s.reject(()=>edit(t,updates),/locked/,c,{n:90,b:90},409);
   });
   it('C05 refuses financial edits, notes and no-ops after settlement',async()=>{
      const paid=await s.customer('Scenario Paid Correction'); const job=await s.job(paid); const row=await s.work(paid,job,50);
      const statement=await s.statement(paid,await s.finalize([paid]),3,[0,50,0,0,0,50]);
      await s.pay(paid,50,{selectedInvoiceID:statement.customer_invoice_id});
      for(const updates of [{total_transaction:60},{note:'Paid annotation'},{}]) await s.reject(()=>edit(row,updates),/locked/,paid,{n:0,b:0},409);
   });
   it('C06 cannot move sent work to another customer even with confirmation',async()=>{
      const source=await s.customer('Scenario Move Source');const dest=await s.customer('Scenario Move Target');
      const from=await s.job(source);const to=await s.job(dest);const row=await s.work(source,from,100);
      await s.statement(source,await s.finalize([source]),4,[0,100,0,0,0,100]);
      for(const [updates,more] of [[{customer_id:dest.id},{}],[{customer_id:dest.id,customer_job_id:to.customer_job_id},{}],[{customer_id:dest.id,customer_job_id:to.customer_job_id},{confirmCustomerChange:true}]])
         await s.reject(()=>edit(row,updates,more),/locked/,source,{n:100,b:100},409);
      await s.check(dest,{n:0,b:0});await s.family(from,100);await s.family(to,0);
   });
   it('C06b still recomputes quantity/rate and permits explicit totals before issue',async()=>{
      const draft=await s.customer('Scenario Unissued Correction');const job=await s.job(draft);const row=await s.work(draft,job,100);
      ok(await edit(row,{quantity:1.2}));await s.check(draft,{n:120,b:0});await s.family(job,120);
      ok(await edit(row,{total_transaction:110}));await s.check(draft,{n:110,b:0});await s.family(job,110);
   });
   it('C07 refuses retainer-funded financial edits and explicit retainer fields', async () => {
      const fund = await s.customer('Scenario Funded Correction'); const job = await s.job(fund); const hold = await s.retainer(fund, 100);
      const row = await s.work(fund, job, 20, { selectedRetainerID: hold.retainer_id });
      await s.check(fund, { n: 0, b: 0, r: -80, unlinked: [1, 20] });
      for (const changes of [{ total_transaction: 30 }, { is_transaction_billable: false }, { retainer_id: row.retainer_id }]) {
         await s.reject(() => edit(row, changes), /retainer/i, fund, { n: 0, b: 0, r: -80, unlinked: [1, 20] }, 409);
      }
   });
   it('C08 preserves internal/nonbillable policy on cascade billability edits', async () => {
      for (const [name, options] of [['Clean Room CPA', {}], ['Scenario Never Bill', { isCustomerBillable: false }]]) {
         const internal = await s.customer(name, options); const job = await s.job(internal); const row = await s.work(internal, job, 100);
         await s.check(internal, { n: 0, b: 0 });
         ok(await edit(row, { is_transaction_billable: true }));
         expect((await s.db('customer_transactions').where({ transaction_id: row.transaction_id }).first()).is_transaction_billable).to.equal(false);
         await s.check(internal, { n: 0, b: 0 });
         const source = await s.customer(`Scenario Transfer to ${internal.id}`); const sourceJob = await s.job(source);
         const moving = await s.work(source, sourceJob, 25); await s.check(source, { n: 25, b: 0 });
         ok(await edit(moving, { customer_id: internal.id, customer_job_id: job.customer_job_id }, { confirmCustomerChange: true }));
         expect((await s.db('customer_transactions').where({ transaction_id: moving.transaction_id }).first()).is_transaction_billable).to.equal(false);
         await s.check(source, { n: 0, b: 0 }); await s.check(internal, { n: 0, b: 0 });
      }
   });
});
