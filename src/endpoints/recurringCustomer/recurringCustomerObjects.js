const dayjs = require('dayjs');

// The "New Customer" form (customer-router.js createCustomer, when
// isCustomerRecurring is checked) posts the chosen start date under
// selectedStartDate (DS2_Frontend RecurringCustomerForm.js / RecurringOptions.js
// state key); a standalone "Add Recurring Customer" form's post-object builder
// (formObjectForNewRecurringCustomerPost) also fails to rename its own
// selectedStartDate-backed value to startDate. Accept either key so a caller's
// actual chosen date is honoured instead of always silently falling back to
// "now".
const resolveStartDate = source => source.startDate || source.selectedStartDate || dayjs().format();

const restoreDataTypesRecurringCustomerTableOnCreate = (customer, customerID) => ({
  account_id: Number(customer.accountID),
  customer_id: Number(customerID) || Number(customer.customerID),
  subscription_frequency: customer.subscriptionFrequency,
  bill_on_date: Number(customer.billingCycle),
  recurring_bill_amount: Number(customer.recurringAmount),
  start_date: resolveStartDate(customer),
  end_date: customer.endDate || null,
  // `is_recurring_customer_active` is NOT NULL with no DB default, so a fresh
  // INSERT needs a real boolean. The old `Boolean(customer.isActive) || true`
  // was always `true` (Boolean(x) is either true, or false — and `false || true`
  // is still true), so an explicit `isActive: false` on create could never take
  // effect. Default to active when the field is omitted entirely (today's "New
  // Customer" form never sends it) but honour an explicit false.
  is_recurring_customer_active: customer.isActive === undefined ? true : Boolean(customer.isActive),
  created_by_user_id: Number(customer.userID)
});

const restoreDataTypesRecurringCustomerTableOnUpdate = (data, customer_id) => {
  const updated = {
    recurring_customer_id: Number(data.recurringCustomerID),
    account_id: Number(data.accountID),
    customer_id: Number(customer_id),
    subscription_frequency: data.subscriptionFrequency,
    bill_on_date: Number(data.billingCycle),
    recurring_bill_amount: Number(data.recurringAmount),
    start_date: resolveStartDate(data),
    end_date: data.endDate || null,
    created_by_user_id: Number(data.userID)
  };

  // Same `Boolean(x) || true` bug as create, but worse here: this is a partial
  // UPDATE against an existing row, so if we defaulted a missing isActive to
  // `true` we'd force every recurring customer back to active on any unrelated
  // edit (e.g. changing the billing amount). Only touch the column when the
  // caller explicitly sent a value, so `isActive: false` persists and omitting
  // the field leaves the current DB value alone.
  if (data.isActive !== undefined) {
    updated.is_recurring_customer_active = Boolean(data.isActive);
  }

  return updated;
};

module.exports = { restoreDataTypesRecurringCustomerTableOnCreate, restoreDataTypesRecurringCustomerTableOnUpdate };
