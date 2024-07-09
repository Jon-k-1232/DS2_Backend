const dayjs = require('dayjs');

const restoreDataTypesRecurringCustomerTableOnCreate = (customer, customerID) => ({
  account_id: Number(customer.accountID),
  customer_id: Number(customerID) || Number(customer.customerID),
  subscription_frequency: customer.subscriptionFrequency,
  bill_on_date: Number(customer.billingCycle),
  recurring_bill_amount: Number(customer.recurringAmount),
  start_date: customer.startDate || dayjs().format(),
  end_date: customer.endDate || null,
  is_recurring_customer_active: Boolean(customer.isActive) || true,
  created_by_user_id: Number(customer.userID)
});

const restoreDataTypesRecurringCustomerTableOnUpdate = (data, customer_id) => ({
  recurring_customer_id: Number(data.recurringCustomerID),
  account_id: Number(data.accountID),
  customer_id: Number(customer_id),
  subscription_frequency: data.subscriptionFrequency,
  bill_on_date: Number(data.billingCycle),
  recurring_bill_amount: Number(data.recurringAmount),
  start_date: data.startDate || dayjs().format(),
  end_date: data.endDate || null,
  is_recurring_customer_active: Boolean(data.isActive) || true,
  created_by_user_id: Number(data.userID)
});

module.exports = { restoreDataTypesRecurringCustomerTableOnCreate, restoreDataTypesRecurringCustomerTableOnUpdate };
