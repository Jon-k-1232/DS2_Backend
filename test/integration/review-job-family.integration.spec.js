const { bootHttp, expectEnvelopeOk } = require('./_http');
const fixture = require('./_review-fixture');

describe('F9 Billing Review family totals', function () {
   let h, f;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   const latest = root => h.db('customer_jobs').where({ account_id: 9001, parent_job_id: root.customer_job_id }).orderBy('created_at', 'desc').orderBy('customer_job_id', 'desc').first();
   for (const move of ['price', 'same family', 'other family']) it(`recomputes and appends whole-family totals after ${move} edit`, async () => {
      const c = await f.customer();
      const root = await f.job(c, { current_job_total: 100 });
      const child = await f.job(c, { parent_job_id: root.customer_job_id, current_job_total: 150 });
      const t = await f.transaction(c, root);
      await f.transaction(c, child, { unitCost: 50, totalTransaction: 50 });
      const destination = move === 'other family' ? await f.job(c) : child;
      const updates = { total_transaction: 120, unit_cost: 120, ...(move === 'price' ? {} : { customer_job_id: destination.customer_job_id }) };
      expectEnvelopeOk(await h.as('admin').put(`/billing-review/transaction/${t.transaction_id}/9001/90013`).send({ updates }));
      const current = await latest(root);
      expect(current.customer_job_id).to.be.greaterThan(child.customer_job_id);
      expect(Number(current.current_job_total)).to.equal(move === 'other family' ? 50 : 170);
      expect(Number((await h.db('customer_jobs').where({ account_id: 9001, customer_job_id: root.customer_job_id }).first()).current_job_total)).to.equal(100);
      if (move === 'other family') expect(Number((await latest(destination)).current_job_total)).to.equal(120);
   });
});

describe('F10 latest family metadata', function () {
   let h, f;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   it('preserves edited current notes and agreed amount when repricing an older-linked entry', async () => {
      const c = await f.customer();
      const root = await f.job(c, { notes: 'old', agreed_job_amount: 10 });
      const t = await f.transaction(c, root);
      const child = await f.job(c, { parent_job_id: root.customer_job_id, current_job_total: 100, notes: 'current agreement', agreed_job_amount: 250 });
      expectEnvelopeOk(await h.as('admin').put('/transactions/updateTransaction/9001/90013').send({ transaction: f.body(c, root, { transactionID: t.transaction_id, unitCost: 120, totalTransaction: 120 }) }));
      const newest = await h.db('customer_jobs').where({ account_id: 9001, parent_job_id: root.customer_job_id }).orderBy('created_at', 'desc').orderBy('customer_job_id', 'desc').first();
      expect(newest.customer_job_id).to.be.greaterThan(child.customer_job_id);
      expect(newest.notes).to.equal('current agreement');
      expect(Number(newest.agreed_job_amount)).to.equal(250);
      expect(Number(newest.current_job_total)).to.equal(120);
   });
});
