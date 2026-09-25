const { bootHttp, expectEnvelopeRefused, expectEnvelopeOk } = require('./_http');
const fixture = require('./_review-fixture');
const recurring = require('../../src/endpoints/recurringCustomer/recurringCustomer-service');
const customerService = require('../../src/endpoints/customer/customer-service');

const body = (c, fields = {}) => ({ customerID: c.customer_id, customerInfoID: c.customer_info_id, customerName: c.customer_name,
   isCustomerBillable: true, isCustomerActive: true, isCustomerAddressActive: true, isCustomerMailingAddress: true,
   customerState: 'AZ', isCustomerRecurring: false, subscriptionFrequency: 'Monthly', billingCycle: 1, recurringAmount: 100, startDate: '2026-09-01', ...fields });

describe('F21 atomic customer and recurring saves', function () {
   let h, f;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   for (const [name, fields] of [
      ['invalid contact state', { customerState: 'Arizona' }],
      ['missing owned contact', { customerInfoID: 2147483647 }],
      ['invalid recurring insert', { isCustomerRecurring: true, billingCycle: 'invalid' }]
   ]) it(`rolls back customer/contact on ${name}`, async () => {
      const c = await f.customer();
      const before = await h.db('customers').where({ account_id: 9001, customer_id: c.customer_id }).first();
      const contact = await h.db('customer_information').where({ account_id: 9001, customer_id: c.customer_id }).first();
      const res = await h.as('admin').put('/customer/updateCustomer/9001/90013').send({ customer: body(c, { customerName: `${c.customer_name}-changed`, customerCity: 'changed', ...fields }) });
      expectEnvelopeRefused(res);
      expect(await h.db('customers').where({ account_id: 9001, customer_id: c.customer_id }).first()).to.deep.equal(before);
      expect(await h.db('customer_information').where({ account_id: 9001, customer_id: c.customer_id }).first()).to.deep.equal(contact);
      expect(await h.db('recurring_customers').where({ account_id: 9001, customer_id: c.customer_id })).to.have.lengthOf(0);
   });
   it('rolls back the customer flag when dedicated recurring insertion fails', async () => {
      const c = await f.customer(); const create = recurring.createRecurringCustomer; let res;
      try {
         recurring.createRecurringCustomer = async () => { throw new Error('F21 recurring insert failed'); };
         res = await h.as('admin').post('/recurringCustomer/createRecurringCustomer/9001/90013').send({ recurringCustomer: body(c) });
      } finally { recurring.createRecurringCustomer = create; }
      expectEnvelopeRefused(res);
      expect((await h.db('customers').where({ account_id: 9001, customer_id: c.customer_id }).first()).is_recurring).to.equal(false);
   });
});

describe('F22 recurring flag follows active subscriptions', function () {
   let h, f;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   const activeFlag = async c => (await h.db('customers').where({ account_id: 9001, customer_id: c.customer_id }).first()).is_recurring;
   const create = async (c, fields = {}) => {
      expectEnvelopeOk(await h.as('admin').post('/recurringCustomer/createRecurringCustomer/9001/90013').send({ recurringCustomer: body(c, fields) }));
      return h.db('recurring_customers').where({ account_id: 9001, customer_id: c.customer_id }).orderBy('recurring_customer_id', 'desc').first();
   };
   for (const action of ['delete', 'update']) it(`clears the flag when ${action} ends the last subscription`, async () => {
      const c = await f.customer(); const row = await create(c);
      if (action === 'delete') expectEnvelopeOk(await h.as('admin').delete(`/recurringCustomer/deleteRecurringCustomer/9001/${row.recurring_customer_id}`).send({}));
      else expectEnvelopeOk(await h.as('admin').put('/recurringCustomer/updateRecurringCustomer').send({ recurringCustomer: body(c, { recurringCustomerID: row.recurring_customer_id, isActive: false }) }));
      expect(await activeFlag(c)).to.equal(false);
   });
   it('keeps the flag with another active subscription, including embedded customer edits', async () => {
      const c = await f.customer(); const first = await create(c); await create(c);
      expectEnvelopeOk(await h.as('admin').put('/customer/updateCustomer/9001/90013').send({ customer: body(c, { recurringCustomerID: first.recurring_customer_id, isCustomerRecurring: false }) }));
      expect(await activeFlag(c)).to.equal(true);
   });
   it('inactive creation leaves the flag false and reactivation restores it regardless of dates', async () => {
      const c = await f.customer(); const row = await create(c, { isActive: false });
      expect(await activeFlag(c)).to.equal(false);
      expectEnvelopeOk(await h.as('admin').put('/recurringCustomer/updateRecurringCustomer').send({ recurringCustomer: body(c, { recurringCustomerID: row.recurring_customer_id, isActive: true, startDate: '2058-01-01' }) }));
      expect(await activeFlag(c)).to.equal(true);
   });
});
