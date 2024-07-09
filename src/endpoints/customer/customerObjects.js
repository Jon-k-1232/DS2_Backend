const restoreDataTypesCustomersOnCreate = customer => ({
  account_id: Number(customer.accountID),
  business_name: customer.customerBusinessName || null,
  customer_name: customer.customerName || null,
  display_name: customer.customerBusinessName || customer.customerName,
  is_commercial_customer: Boolean(customer.isCommercialCustomer),
  is_customer_active: Boolean(customer.isCustomerActive),
  is_billable: Boolean(customer.isCustomerBillable),
  is_recurring: Boolean(customer.isCustomerRecurring)
});

const restoreDataTypesCustomersInformationOnCreate = customerInformation => ({
  account_id: Number(customerInformation.accountID),
  customer_id: Number(customerInformation.customer_id),
  customer_street: customerInformation.customerStreet,
  customer_city: customerInformation.customerCity,
  customer_state: customerInformation.customerState,
  customer_zip: customerInformation.customerZip,
  customer_email: customerInformation.customerEmail,
  customer_phone: customerInformation.customerPhone,
  is_this_address_active: Boolean(customerInformation.isCustomerAddressActive),
  is_customer_physical_address: Boolean(customerInformation.isCustomerPhysicalAddress),
  is_customer_billing_address: Boolean(customerInformation.isCustomerBillingAddress),
  is_customer_mailing_address: Boolean(customerInformation.isCustomerMailingAddress),
  created_by_user_id: Number(customerInformation.userID)
});

const restoreDataTypesCustomersOnUpdate = customer => ({
  customer_id: Number(customer.customerID),
  account_id: Number(customer.accountID),
  business_name: customer.customerBusinessName || null,
  customer_name: customer.customerName || null,
  display_name: customer.customerBusinessName || customer.customerName,
  is_commercial_customer: Boolean(customer.isCommercialCustomer),
  is_customer_active: Boolean(customer.isCustomerActive),
  is_billable: Boolean(customer.isCustomerBillable),
  is_recurring: Boolean(customer.isCustomerRecurring)
});

const restoreDataTypesCustomersInformationOnUpdate = customerInformation => ({
  customer_info_id: Number(customerInformation.customerInfoID),
  account_id: Number(customerInformation.accountID),
  customer_id: Number(customerInformation.customerID),
  customer_street: customerInformation.customerStreet,
  customer_city: customerInformation.customerCity,
  customer_state: customerInformation.customerState,
  customer_zip: customerInformation.customerZip,
  customer_email: customerInformation.customerEmail,
  customer_phone: customerInformation.customerPhone,
  is_this_address_active: Boolean(customerInformation.isCustomerAddressActive),
  is_customer_physical_address: Boolean(customerInformation.isCustomerPhysicalAddress),
  is_customer_billing_address: Boolean(customerInformation.isCustomerBillingAddress),
  is_customer_mailing_address: Boolean(customerInformation.isCustomerMailingAddress),
  created_by_user_id: Number(customerInformation.userID)
});

module.exports = {
  restoreDataTypesCustomersOnCreate,
  restoreDataTypesCustomersInformationOnCreate,
  restoreDataTypesCustomersOnUpdate,
  restoreDataTypesCustomersInformationOnUpdate
};
