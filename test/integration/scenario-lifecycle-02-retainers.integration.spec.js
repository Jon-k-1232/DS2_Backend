'use strict';
const { Scenario, ok, expect, money } = require('./_scenario');
describe('scenario lifecycle R: retainers (hand oracle 02-retainers.md)', function () {
   this.timeout(180000);
   const s = new Scenario(); let c, j, r, a, b;
   const edit = amount => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: r.retainer_id, unitCost: amount } });
   before(async () => { await s.boot(); });
   after(async () => { await s.close(); });
   it('R01 receives $500 before work without creating invoice debt or an applied payment', async () => {
      c = await s.customer('Scenario Retainer Large'); j = await s.job(c); r = await s.retainer(c, 500);
      expect(money(r.starting_amount)).to.equal(-500);
      expect(await s.db('customer_payments').where({ customer_id: c.id })).to.have.lengthOf(0);
      await s.check(c, { n: 0, b: 0, r: -500 });
   });
   it('R02 draws $120 then $80, each creates exactly one offsetting payment', async () => {
      a = await s.work(c, j, 120, { selectedRetainerID: r.retainer_id });
      await s.check(c, { n: 0, b: 0, r: -380, charges: 120, payments: -120, unlinked: [1, 120] });
      b = await s.work(c, j, 80, { selectedRetainerID: r.retainer_id });
      await s.check(c, { n: 0, b: 0, r: -300, charges: 200, payments: -200, unlinked: [2, 200] });
      expect((await s.db('customer_payments').where({ customer_id: c.id }).orderBy('payment_id')).map(p => money(p.payment_amount))).to.deep.equal([-120, -80]);
   });
   it('R03 reprices the first draw, preserves the later $80 draw and shifts both snapshots', async () => {
      ok(await s.editWork(a, { unitCost: 150, totalTransaction: 150 }));
      const chain = await s.db('customer_retainers_and_prepayments').where({ customer_id: c.id }).orderBy('retainer_id');
      expect(chain.map(x => money(x.current_amount))).to.deep.equal([-500, -350, -270]);
      await s.family(j, 230); await s.check(c, { n: 0, b: 0, r: -270, charges: 230, payments: -230, unlinked: [2, 230] });
   });
   it('R04 reduces starting funds, refuses less than used, permits exact exhaustion', async () => {
      ok(await edit(300)); await s.check(c, { n: 0, b: 0, r: -70, unlinked: [2, 230] });
      await s.reject(() => edit(229), /already drawn/i, c, { n: 0, b: 0, r: -70, unlinked: [2, 230] });
      ok(await edit(230)); await s.check(c, { n: 0, b: 0, r: 0, unlinked: [2, 230] });
      ok(await edit(300)); await s.check(c, { n: 0, b: 0, r: -70, unlinked: [2, 230] });
   });
   it('R05 unwinds and re-enters one unbilled funded work item', async () => {
      ok(await s.deleteWork(b)); await s.family(j, 150); await s.check(c, { n: 0, b: 0, r: -150, charges: 150, payments: -150, unlinked: [1, 150] });
      b = await s.work(c, j, 80, { selectedRetainerID: r.retainer_id });
      await s.family(j, 230); await s.check(c, { n: 0, b: 0, r: -70, charges: 230, payments: -230, unlinked: [2, 230] });
   });
   it('R06 refuses overdraft, root/child deletion, detaching funding and reversing a draw', async () => {
      const p = await s.db('customer_payments').where({ customer_id: c.id }).orderBy('payment_id', 'desc').first();
      for (const [action, pattern] of [
         [() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(c, j, 100, { selectedRetainerID: r.retainer_id }) }), /enough balance/i],
         [() => s.del(`/retainers/deleteRetainer/${r.retainer_id}/1/1`), /already been drawn/i],
         [() => s.del(`/retainers/deleteRetainer/${b.retainer_id}/1/1`), /draw-down/i],
         [() => s.editWork(b, { selectedRetainerID: null }), /retainer|fund/i],
         [() => s.post('/payments/reversePayment/1/1', { payment: { paymentID: p.payment_id, reason: 'NSF' } }), /retainer/i]
      ]) await s.reject(action, pattern, c, { n: 0, b: 0, r: -70, unlinked: [2, 230] });
   });
   it('R07 finalizes a zero bill, keeps $70 credit, then locks the displayed retainer against edits', async () => {
      const result = await s.finalize([c]);
      await s.statement(c, result, 1, [0, 230, -230, 0, -70, 0], ['Invoice Total Before Retainer/ Pre-Payment: 230.00', 'Remaining Retainer/ Pre-Payment: -70.00']);
      await s.reject(() => edit(280), /locked: part of sent invoice/, c, { n: 0, b: 0, r: -70 }, 409);
      await s.reject(() => s.deleteWork(b), /invoice/i, c, { n: 0, b: 0, r: -70 });
      await s.reject(() => s.editWork(a, { unitCost: 140, totalTransaction: 140 }), /invoice/i, c, { n: 0, b: 0, r: -70 });
   });
   it('R08 smaller retainer cannot part-fund a single entry; separate $100 draw plus $50 work bills $50', async () => {
      const small = await s.customer('Scenario Retainer Small'); const job = await s.job(small); const hold = await s.retainer(small, 100);
      await s.check(small, { n: 0, b: 0, r: -100 });
      await s.reject(() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(small, job, 150, { selectedRetainerID: hold.retainer_id }) }), /enough balance/i, small, { n: 0, b: 0, r: -100 });
      await s.work(small, job, 100, { selectedRetainerID: hold.retainer_id }); await s.check(small, { n: 0, b: 0, unlinked: [1, 100] });
      await s.reject(() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(small, job, 1, { selectedRetainerID: hold.retainer_id }) }), /no remaining/i, small, { n: 0, b: 0, unlinked: [1, 100] });
      await s.work(small, job, 50); await s.check(small, { n: 50, b: 0, charges: 150, payments: -100, unlinked: [1, 100] });
      await s.statement(small, await s.finalize([small]), 2, [0, 150, -100, 0, 0, 50]);
   });
   it('R09 completes unused retainer CRUD and banks a hold-only payment without a payment row', async () => {
      const unused = await s.customer('Scenario Unused Funds'); const hold = await s.retainer(unused, 40);
      await s.check(unused, { n: 0, b: 0, r: -40 });
      expect(ok(await s.get(`/retainers/getSingleRetainer/${hold.retainer_id}/1/1`)).activeRetainerData.activeRetainer).to.have.lengthOf(1);
      ok(await s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 25 } }));
      await s.check(unused, { n: 0, b: 0, r: -25 });
      ok(await s.del(`/retainers/deleteRetainer/${hold.retainer_id}/1/1`)); await s.check(unused, { n: 0, b: 0 });
      await s.reject(() => s.get(`/retainers/getSingleRetainer/${hold.retainer_id}/1/1`), /No matching/i, unused, { n: 0, b: 0 });
      const p = await s.pay(unused, 90, { holdAsPrepayment: true }); expect(p.row).to.equal(undefined);
      await s.check(unused, { n: 0, b: 0, r: -90 });
   });
});
