'use strict';
const { Scenario, ok, expect, money, ago } = require('./_scenario');
describe('scenario lifecycle M: selective month-end and aging (hand oracle 05-month-end.md)', function () {
   this.timeout(180000); const s = new Scenario(); let a, b, credit, ja, i1, i2, i3;
   before(async () => { await s.boot(); }); after(async () => { await s.close(); });
   it('M01 prepares three clients and finalizes a subset; skips the -$25 credit', async () => {
      a = await s.customer('Scenario Month A'); b = await s.customer('Scenario Month B'); credit = await s.customer('Scenario Month Credit');
      ja = await s.job(a); const jb = await s.job(b); const jc = await s.job(credit);
      await s.work(a, ja, 100); await s.check(a, { n: 100, b: 0 });
      await s.work(b, jb, 200); await s.check(b, { n: 200, b: 0 });
      await s.work(credit, jc, 50); await s.check(credit, { n: 50, b: 0 });
      await s.writeoff(credit, 75, { selectedJobID: jc.customer_job_id }); await s.check(credit, { n: -25, b: 0 });
      const result = await s.finalize([a, credit]);
      expect(result.skippedCustomers).to.have.lengthOf(1); expect(result.skippedCustomers[0].customer_id).to.equal(credit.id);
      i1 = await s.statement(a, result, 1, [0, 100, 0, 0, 0, 100]);
      await s.check(b, { n: 200, b: 0 }); await s.check(credit, { n: -25, b: 0 });
   });
   it('M02 refuses ordinary same-day rerun, explicit rebill absorbs instead of doubling debt', async () => {
      const before = await s.state(); const skipped = await s.finalize([a]);
      expect(skipped.invoicesWithDetail).to.deep.equal([]); expect(skipped.fileLocation).to.equal(''); expect(skipped.skippedCustomers[0].reason).to.include('Already finalized today');
      expect(await s.state()).to.deep.equal(before); await s.check(a, { n: 100, b: 100 });
      i2 = await s.statement(a, await s.finalize([a], { allowSameDayRebill: true }), 2, [100, 0, 0, 0, 0, 100], [i1.invoice_number]);
      const old = await s.db('customer_invoices').where({ customer_invoice_id: i1.customer_invoice_id }).first();
      expect(money(old.remaining_balance_on_invoice)).to.equal(100);
      const closed = await s.db('customer_invoices').where({parent_invoice_id:i1.customer_invoice_id}).orderBy('created_at','desc').orderBy('customer_invoice_id','desc').first();
      expect(money(closed.remaining_balance_on_invoice)).to.equal(0); expect(closed.notes).to.include(`[absorbed_by:${i2.invoice_number}@`);
   });
   for (const [days, bucket] of [[31, 'bucket_31_60'], [30, 'bucket_61_90'], [30, 'bucket_over_90']]) {
      it(`M03 advances ${days} days into ${bucket} without inventing new receivables`, async () => {
         await s.shift(days); await s.check(a, { n: 100, b: 100, bucket }); await s.check(b, { n: 200, b: 0 });
      });
   }
   it('M04 pays $40, adds $25, issues two sequential month-2 statements and resets statement aging', async () => {
      await s.pay(a, 40, { selectedInvoiceID: i2.customer_invoice_id }); await s.check(a, { n: 60, b: 60, bucket: 'bucket_over_90' });
      await s.work(a, ja, 25); await s.check(a, { n: 85, b: 60, bucket: 'bucket_over_90' });
      const result = await s.finalize([a, b]);
      i3 = await s.statement(a, result, 3, [60, 25, 0, 0, 0, 85], ['Total Payments Received: -40.00 (reflected in Beginning Balance above)']);
      await s.statement(b, result, 4, [0, 200, 0, 0, 0, 200]);
      const ar = (await s.check(a, { n: 85, b: 85 })).ar;
      expect(String(ar.oldest_open_charge_date).slice(0, 10)).to.equal(ago(91));
      const arb = (await s.check(b, { n: 200, b: 200 })).ar;
      expect(String(arb.oldest_open_charge_date).slice(0, 10)).to.equal(ago(91));
      expect(money((await s.db('customer_invoices').where({ customer_invoice_id: i2.customer_invoice_id }).first()).remaining_balance_on_invoice)).to.equal(100);
   });
   it('M05 refuses even an empty sent statement, as well as linked, absorbed, child and absent invoices', async () => {
      const empty = await s.customer('Scenario Empty Invoice');
      const inv = await s.statement(empty, await s.finalize([empty]), 5, [0, 0, 0, 0, 0, 0]);
      await s.reject(() => s.del(`/invoices/deleteInvoice/1/${inv.customer_invoice_id}`), /locked/, empty, { n: 0, b: 0 }, 409);
      expect(await s.db('customer_invoices').where({ customer_invoice_id: inv.customer_invoice_id }).first()).to.exist;
      const child = await s.db('customer_invoices').where({ parent_invoice_id: i2.customer_invoice_id }).first();
      for (const id of [i1.customer_invoice_id, i2.customer_invoice_id, i3.customer_invoice_id, child.customer_invoice_id, 999999]) {
         await s.reject(() => s.del(`/invoices/deleteInvoice/1/${id}`), /locked|delete|linked|snapshot|found|absorbed|balance/i, a, { n: 85, b: 85 });
      }
   });
});
