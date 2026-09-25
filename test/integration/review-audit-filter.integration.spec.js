const dayjs = require('dayjs');
const { bootHttp, uniqueName, expectEnvelopeOk } = require('./_http');
const fixture = require('./_review-fixture');

describe('F38 unsupported audit age filter', function () {
   let h, f, actor, name, customers = [];
   before(async function () {
      h = await bootHttp.call(this); f = fixture(h); name = uniqueName('F38');
      [actor] = await h.db('users').insert({ account_id: 9001, email: `${name}@example.test`, display_name: name, job_title: 'Test',
         cost_rate: 0, billing_rate: 0, access_level: 'Super Admin', is_user_active: true }).returning('*');
      for (const age of [10,80]) {
         const c = await f.customer({ display_name: `${name}-${age}` }); customers.push(c);
         const date = dayjs().subtract(age, 'day').format('YYYY-MM-DD');
         await f.insert('customer_invoices', { customer_id: c.customer_id, customer_info_id: c.customer_info_id, invoice_number: `${name}-${age}`,
            invoice_date: date, due_date: date, beginning_balance: 0, total_payments: 0, total_charges: 100, total_write_offs: 0,
            total_retainers: 0, total_amount_due: 100, remaining_balance_on_invoice: 100, is_invoice_paid_in_full: false, created_by_user_id: 90013 });
      }
   });
   after(async () => { if (h) { await f.cleanup(); await h.db('users').where({ account_id:9001, user_id:actor.user_id }).del(); await h.close(); } });
   const get = query => h.request.get(`/accountAudit/customers/9001/${actor.user_id}`).query(query).set('Authorization', `Bearer ${h.mint('admin', actor)}`);
   it('keeps normal audit listing available for both recent and old statements', async () => {
      const body = expectEnvelopeOk(await get({ search: name }));
      expect(body.customers.map(r=>r.customer_id)).to.have.members(customers.map(c=>c.customer_id));
   });
   for (const [index, age] of [10,80].entries()) it(`explicitly refuses ar_60 instead of silently including the ${age}-day statement`, async () => {
      const result = await get({ search: customers[index].display_name, filter: 'ar_60' });
      expect(result.status).to.equal(400);
      expect(result.body.message).to.match(/ar_60.*not supported/i);
      expect(result.body).not.to.have.property('customers');
   });
});
