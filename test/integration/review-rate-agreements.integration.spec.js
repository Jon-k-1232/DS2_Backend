const { bootHttp, uniqueName, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const fixture = require('./_review-fixture');

describe('F32 rate agreement ownership and attribution', function () {
   let h, f, actor, customer, note;
   before(async function () {
      h = await bootHttp.call(this); f = fixture(h); customer = await f.customer();
      const name = uniqueName('F32'); note = name;
      [actor] = await h.db('users').insert({ account_id: 9001, display_name: name, email: `${name}@example.test`, job_title: 'Test',
         cost_rate: 0, billing_rate: 0, access_level: 'Super Admin', is_user_active: true }).returning('*');
   });
   after(async () => {
      if (h) {
         await h.db('customer_rate_agreements').where({ account_id: 9001, notes: note }).del();
         await f.cleanup(); await h.db('users').where({ account_id: 9001, user_id: actor.user_id }).del(); await h.close();
      }
   });
   const save = body => h.request.post('/analytics/rateAgreement/9001/90011')
      .set('Authorization', `Bearer ${h.mint('admin', actor)}`).send({ customerId: customer.customer_id, year: 2026, agreedRate: 125.5, notes: note, ...body });
   it('refuses a foreign customer without creating an own-account association', async () => {
      const foreign = await h.db('customers').whereNot('account_id', 9001).first('customer_id');
      expectEnvelopeRefused(await save({ customerId: foreign.customer_id }), /customer/i);
      expect(await h.db('customer_rate_agreements').where({ account_id: 9001, customer_id: foreign.customer_id, notes: note })).to.have.length(0);
   });
   it('takes the creator from the authenticated user and preserves it on rate edits', async () => {
      const created = expectEnvelopeOk(await save({})).agreement;
      expect(created.created_by_user_id).to.equal(actor.user_id);
      const updated = expectEnvelopeOk(await save({ agreedRate: 150 })).agreement;
      expect(updated.rate_agreement_id).to.equal(created.rate_agreement_id);
      expect(updated.created_by_user_id).to.equal(actor.user_id);
   });
   for (const body of [{ customerId: -1 }, { customerId: 1.5 }, { year: 2026.5 }, { year: 1999 }, { agreedRate: 'Infinity' }, { agreedRate: 0 }, { agreedRate: 100000000 }, { agreedRate: 125.555 }]) {
      it(`validates ${JSON.stringify(body)} before writing`, async () => {
         const before = await h.db('customer_rate_agreements').where({ account_id: 9001, customer_id: customer.customer_id, notes: note });
         expectEnvelopeRefused(await save(body), /customer|year|rate/i);
         expect(await h.db('customer_rate_agreements').where({ account_id: 9001, customer_id: customer.customer_id, notes: note })).to.deep.equal(before);
      });
   }
});
