const { bootHttp, uniqueName, expectEnvelopeOk } = require('./_http');

describe('F1 customer update response account isolation', function () {
   let h, customer, contact;
   const body = overrides => ({
      accountID: 1, userID: 90013, customerID: customer.customer_id,
      customerInfoID: contact.customer_info_id, customerName: customer.display_name,
      isCustomerActive: true, isCustomerBillable: true, isCustomerRecurring: false,
      isCustomerAddressActive: true, isCustomerBillingAddress: true,
      customerEmail: 'f1-fixture@example.com', ...overrides
   });
   before(async function () {
      h = await bootHttp.call(this);
      const name = uniqueName('F1');
      [customer] = await h.db('customers').insert({ account_id: 9001, customer_name: name,
         display_name: name, is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false }).returning('*');
      [contact] = await h.db('customer_information').insert({ account_id: 9001,
         customer_id: customer.customer_id, is_this_address_active: true, is_customer_physical_address: true,
         is_customer_billing_address: true, is_customer_mailing_address: true, created_by_user_id: 90013 }).returning('*');
      await h.db('recurring_customers').insert({ account_id: 9001, customer_id: customer.customer_id,
         subscription_frequency: 'Monthly', bill_on_date: 1, recurring_bill_amount: 25,
         start_date: '2026-01-01', is_recurring_customer_active: true, created_by_user_id: 90013 });
   });
   after(async () => {
      if (!h) return;
      if (customer) {
         for (const table of ['recurring_customers', 'customer_information', 'customers']) {
            await h.db(table).where({ account_id: 9001, customer_id: customer.customer_id }).del();
         }
      }
      await h.close();
   });
   it('refreshes customers and recurring rows only from the verified URL account', async () => {
      const res = await h.as('admin').put('/customer/updateCustomer/9001/90013').send({ customer: body() });
      expectEnvelopeOk(res);
      const customers = res.body.customersList.activeCustomerData.activeCustomers;
      const recurring = res.body.recurringCustomersList.activeRecurringCustomersData.activeRecurringCustomers;
      expect(customers.map(r => Number(r.customer_id))).to.include(Number(customer.customer_id));
      expect(recurring.map(r => Number(r.customer_id))).to.include(Number(customer.customer_id));
      for (const row of [...customers, ...recurring]) expect(Number(row.account_id)).to.equal(9001);
   });
   it('does not return foreign lists when an update fails', async () => {
      const res = await h.as('admin').put('/customer/updateCustomer/9001/90013')
         .send({ customer: body({ customerName: null }) });
      expect(res.body.status).to.equal(500);
      expect(res.body).not.to.have.property('customersList');
      expect(res.body).not.to.have.property('recurringCustomersList');
   });
});
