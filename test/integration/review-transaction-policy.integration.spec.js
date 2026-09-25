const { bootHttp, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const fixture = require('./_review-fixture');

describe('F11 direct transaction pricing', function () {
   let h, f, c, j;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); c = await f.customer(); j = await f.job(c); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   for (const action of ['create', 'update']) {
      for (const [name, fields] of [
         ['inconsistent total', { totalTransaction: 1 }],
         ['quantity inconsistent with supplied duration', { quantity: 0.11, totalTransaction: 11, minutes: 6 }],
         ['negative quantity', { quantity: -1 }], ['negative rate', { unitCost: -100 }],
         ['negative total', { totalTransaction: -100 }], ['nonfinite rate', { unitCost: 'Infinity' }],
         ['missing quantity', { quantity: null }], ['sub-cent rate', { unitCost: 100.001 }]
      ]) it(`refuses ${name} on ${action} without ledger writes`, async () => {
         const stored = action === 'update' ? await f.transaction(c, j) : null;
         const before = await h.db('customer_transactions').where({ account_id: 9001, customer_id: c.customer_id }).orderBy('transaction_id');
         const jobs = await h.db('customer_jobs').where({ account_id: 9001, customer_id: c.customer_id }).orderBy('customer_job_id');
         const res = await h.as('admin')[action === 'create' ? 'post' : 'put'](`/transactions/${action}Transaction/9001/90013`).send({ transaction: f.body(c, j, { transactionID: stored && stored.transaction_id, ...fields }) });
         expectEnvelopeRefused(res);
         expect(await h.db('customer_transactions').where({ account_id: 9001, customer_id: c.customer_id }).orderBy('transaction_id')).to.deep.equal(before);
         expect(await h.db('customer_jobs').where({ account_id: 9001, customer_id: c.customer_id }).orderBy('customer_job_id')).to.deep.equal(jobs);
      });
   }
   it('creates and edits decimal-hour Time work without a supplied duration, preserving cents and notes', async () => {
      const customer = await f.customer(); const job = await f.job(customer);
      const fields = { transactionType: 'time', quantity: 0.25, unitCost: 75, totalTransaction: 18.75, note: 'Quarter-hour direct entry' };
      expectEnvelopeOk(await h.as('admin').post('/transactions/createTransaction/9001/90013').send({ transaction: f.body(customer, job, fields) }));
      const stored = await h.db('customer_transactions').where({ account_id: 9001, customer_id: customer.customer_id }).first();
      expect([Number(stored.quantity), Number(stored.unit_cost), Number(stored.total_transaction)]).to.deep.equal([0.25, 75, 18.75]);
      expect(stored.transaction_type).to.equal('Time');
      expect(stored.note).to.equal(fields.note);
      expectEnvelopeOk(await h.as('admin').put('/transactions/updateTransaction/9001/90013').send({ transaction: f.body(customer, job, { ...fields, transactionID: stored.transaction_id, quantity: 0.75, totalTransaction: 56.25 }) }));
      const updated = await h.db('customer_transactions').where({ account_id: 9001, transaction_id: stored.transaction_id }).first();
      expect([Number(updated.quantity), Number(updated.unit_cost), Number(updated.total_transaction)]).to.deep.equal([0.75, 75, 56.25]);
      expect(updated.note).to.equal(fields.note);
      const latest = await h.db('customer_jobs').where({ account_id: 9001, customer_id: customer.customer_id }).orderBy('customer_job_id', 'desc').first();
      expect(Number(latest.current_job_total)).to.equal(56.25);
   });
   it('preserves zero quantity on update and accepts rounded Charge arithmetic', async () => {
      const stored = await f.transaction(c, j);
      expectEnvelopeOk(await h.as('admin').put('/transactions/updateTransaction/9001/90013').send({ transaction: f.body(c, j, { transactionID: stored.transaction_id, quantity: 0, totalTransaction: 0 }) }));
      expect(Number((await h.db('customer_transactions').where({ account_id: 9001, transaction_id: stored.transaction_id }).first()).quantity)).to.equal(0);
      expectEnvelopeOk(await h.as('admin').post('/transactions/createTransaction/9001/90013').send({ transaction: f.body(c, j, { transactionType: 'Charge', quantity: 0.25, unitCost: 99.99, totalTransaction: 25 }) }));
   });
});

describe('F12 shared billability policy', function () {
   let h, f, oldInternal;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); oldInternal = process.env.INTERNAL_CUSTOMER_IDS; });
   after(async () => { if (oldInternal === undefined) delete process.env.INTERNAL_CUSTOMER_IDS; else process.env.INTERNAL_CUSTOMER_IDS = oldInternal; if (h) { await f.cleanup(); await h.close(); } });
   for (const policy of ['internal', 'customer flag']) for (const action of ['create', 'update']) it(`forces ${policy} work nonbillable on ${action} without a retainer draw`, async () => {
      const c = await f.customer({ is_billable: policy !== 'customer flag' });
      const j = await f.job(c);
      process.env.INTERNAL_CUSTOMER_IDS = policy === 'internal' ? String(c.customer_id) : '';
      const retainer = await f.insert('customer_retainers_and_prepayments', { customer_id: c.customer_id, type_of_hold: 'Retainer', starting_amount: -500, current_amount: -500, is_retainer_active: true, created_by_user_id: 90013 });
      const stored = action === 'update' ? await f.transaction(c, j, { isTransactionBillable: false }) : null;
      expectEnvelopeOk(await h.as('admin')[action === 'create' ? 'post' : 'put'](`/transactions/${action}Transaction/9001/90013`).send({ transaction: f.body(c, j, { transactionID: stored && stored.transaction_id, selectedRetainerID: retainer.retainer_id }) }));
      const rows = await h.db('customer_transactions').where({ account_id: 9001, customer_id: c.customer_id });
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].is_transaction_billable).to.equal(false);
      expect(rows[0].retainer_id).to.equal(null);
      expect(await h.db('customer_payments').where({ account_id: 9001, customer_id: c.customer_id })).to.have.lengthOf(0);
      expect(await h.db('customer_retainers_and_prepayments').where({ account_id: 9001, customer_id: c.customer_id })).to.have.lengthOf(1);
   });
});
