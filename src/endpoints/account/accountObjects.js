const dayjs = require('dayjs');

// Restores the customer table fields
const restoreDataTypesAccountOnCreate = newAccount => ({
  account_name: newAccount.account_name,
  account_type: newAccount.account_type,
  is_account_active: Boolean(newAccount.is_account_active),
  account_statement: newAccount.account_statement,
  account_interest_statement: newAccount.account_interest_statement,
  account_invoice_template_option: newAccount.account_invoice_template_option,
  account_company_logo: newAccount.account_company_logo,
  created_at: dayjs(newAccount.created_at).format()
});

const restoreDataTypesAccountInformationOnCreate = newAccountInformation => ({
  account_id: Number(newAccountInformation.account_id),
  account_street: newAccountInformation.account_street,
  account_city: newAccountInformation.account_city,
  account_state: newAccountInformation.account_state,
  account_zip: newAccountInformation.account_zip,
  account_email: newAccountInformation.account_email,
  account_phone: newAccountInformation.account_phone,
  is_this_address_active: Boolean(newAccountInformation.is_this_address_active),
  is_account_physical_address: Boolean(newAccountInformation.is_account_physical_address),
  is_account_billing_address: Boolean(newAccountInformation.is_account_billing_address),
  is_account_mailing_address: Boolean(newAccountInformation.is_account_mailing_address)
});

// Restores the customer table fields
const restoreDataTypesAccountOnUpdate = newAccount => ({
  account_id: Number(newAccount.account_id),
  account_name: newAccount.account_name,
  account_type: newAccount.account_type,
  is_account_active: Boolean(newAccount.is_account_active),
  account_statement: newAccount.account_statement,
  account_interest_statement: newAccount.account_interest_statement,
  account_invoice_template_option: newAccount.account_invoice_template_option,
  account_company_logo: newAccount.account_company_logo,
  created_at: dayjs(newAccount.created_at).format()
});

const restoreDataTypesAccountInformationOnUpdate = newAccountInformation => ({
  account_info_id: Number(newAccountInformation.account_info_id),
  account_id: Number(newAccountInformation.account_id),
  account_street: newAccountInformation.account_street,
  account_city: newAccountInformation.account_city,
  account_state: newAccountInformation.account_state,
  account_zip: newAccountInformation.account_zip,
  account_email: newAccountInformation.account_email,
  account_phone: newAccountInformation.account_phone,
  is_this_address_active: Boolean(newAccountInformation.is_this_address_active),
  is_account_physical_address: Boolean(newAccountInformation.is_account_physical_address),
  is_account_billing_address: Boolean(newAccountInformation.is_account_billing_address),
  is_account_mailing_address: Boolean(newAccountInformation.is_account_mailing_address),
  created_at: dayjs(newAccountInformation.created_at).format()
});

module.exports = {
  restoreDataTypesAccountOnCreate,
  restoreDataTypesAccountInformationOnCreate,
  restoreDataTypesAccountOnUpdate,
  restoreDataTypesAccountInformationOnUpdate
};
