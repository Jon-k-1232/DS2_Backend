'use strict';
const { Scenario, ok, expect, money } = require('./_scenario');
describe('scenario lifecycle O: write-offs (hand oracle 04-writeoffs.md)', function () {
   this.timeout(180000); const s = new Scenario(); let c, shown, j, sj, w, inv;
   const update = (row, amount, more = {}) => s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: row.writeoff_id, unitCost: amount, ...more } });
   const del = row => s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: row.writeoff_id } });
   before(async () => { await s.boot(); }); after(async () => { await s.close(); });
   it('O01 creates, edits and deletes a pending job credit without changing the work total', async () => {
      c = await s.customer('Scenario Hidden Credit'); j = await s.job(c);
      await s.work(c, j, 200); await s.check(c, { n: 200, b: 0 });
      w = await s.writeoff(c, 30, { selectedJobID: j.customer_job_id });
      await s.check(c, { n: 170, b: 0, charges: 170, writeoffs: 0 }); await s.family(j, 200);
      ok(await update(w, 40)); await s.check(c, { n: 160, b: 0 });
      ok(await del(w)); await s.check(c, { n: 200, b: 0 });
      w = await s.writeoff(c, 30, { selectedJobID: j.customer_job_id }); await s.check(c, { n: 170, b: 0 });
   });
   it('O02 shown and hidden write-offs have identical $170 totals and different PDF presentation', async () => {
      shown = await s.customer('Scenario Shown Credit'); sj = await s.job(shown);
      await s.work(shown, sj, 200); await s.check(shown, { n: 200, b: 0 });
      await s.writeoff(shown, 30, { selectedJobID: sj.customer_job_id }); await s.check(shown, { n: 170, b: 0 });
      const p = await s.preview(shown, { showWriteOffs: true });
      expect(money(p.transactions.transactionsTotal)).to.equal(200); expect(money(p.writeOffs.writeOffTotal)).to.equal(-30); expect(money(p.invoiceTotal)).to.equal(170);
      inv = await s.statement(c, await s.finalize([c]), 1, [0, 170, 0, 0, 0, 170]);
      expect(inv.text).not.to.include('Scenario credit');
      const sh = await s.statement(shown, await s.finalize([shown], {}, { showWriteOffs: true }), 2, [0, 200, 0, -30, 0, 170], ['Scenario credit', '-30.00']);
      expect(sh.text).to.include('200.00');
   });
   it('O03 refuses billed pending-credit edits/deletes and applies current invoice credits once', async () => {
      await s.reject(() => update(w, 35), /billed|statement|locked: part of sent invoice/i, c, { n: 170, b: 170 });
      await s.reject(() => del(w), /billed|statement|locked: part of sent invoice/i, c, { n: 170, b: 170 });
      let credit = await s.writeoff(c, 20, { customerInvoiceID: inv.customer_invoice_id, selectedJobID: j.customer_job_id });
      await s.check(c, { n: 150, b: 150 });
      ok(await update(credit, 25)); await s.check(c, { n: 145, b: 145 });
      ok(await del(credit)); await s.check(c, { n: 170, b: 170 });
      credit = await s.writeoff(c, 20, { customerInvoiceID: inv.customer_invoice_id, selectedJobID: j.customer_job_id });
      await s.check(c, { n: 150, b: 150 });
      await s.reject(() => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 151, { customerInvoiceID: inv.customer_invoice_id }) }), /exceed/i, c, { n: 150, b: 150 });
      await s.work(c, j, 50); await s.check(c, { n: 200, b: 150 });
      const visible = await s.preview(c, { showWriteOffs: true }); expect(money(visible.invoiceTotal)).to.equal(200); expect(money(visible.writeOffs.writeOffTotal)).to.equal(0);
   });
   it('O04 credit-only job is not lost; a negative bill is skipped until work exceeds the credit', async () => {
      const pending = await s.customer('Scenario Pending Credit'); const job = await s.job(pending);
      const credit = await s.writeoff(pending, 40, { selectedJobID: job.customer_job_id }); await s.check(pending, { n: -40, b: 0 });
      const before = await s.state(); const skipped = await s.finalize([pending]);
      expect(skipped.invoicesWithDetail).to.deep.equal([]); expect(skipped.skippedCustomers[0].reason).to.include('Credit balance of $40.00'); expect(await s.state()).to.deep.equal(before);
      await s.check(pending, { n: -40, b: 0 });
      await s.reject(() => update(credit, 40, { customerInvoiceID: inv.customer_invoice_id }), /moved|invoice/i, pending, { n: -40, b: 0 });
      await s.work(pending, job, 60); await s.check(pending, { n: 20, b: 0 });
      await s.statement(pending, await s.finalize([pending]), 3, [0, 20, 0, 0, 0, 20]);
   });
   it('O05 uninvoiced write-off greater than work carries -$50; equivalent invoice over-credit is refused', async () => {
      const excess = await s.customer('Scenario Excess Credit'); const job = await s.job(excess);
      await s.work(excess, job, 200); await s.check(excess, { n: 200, b: 0 });
      await s.writeoff(excess, 250); await s.check(excess, { n: -50, b: 0 });
      const result = await s.finalize([excess]); expect(result.invoicesWithDetail).to.deep.equal([]); expect(result.skippedCustomers[0].reason).to.include('$50.00');
      await s.check(excess, { n: -50, b: 0 });
      await s.reject(() => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 250, { customerInvoiceID: inv.customer_invoice_id }) }), /exceed/i, c, { n: 200, b: 150 });
   });
   it('O06 next statement carries $150 and charges $50 without repeating the applied $20 credit', async () => {
      await s.shift(31); await s.check(c, { n: 200, b: 150, bucket: 'bucket_31_60' });
      await s.statement(c, await s.finalize([c]), 4, [150, 50, 0, 0, 0, 200], ['Total Revisions: -20.00 (reflected in invoice balance)']);
   });
});
