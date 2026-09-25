const dayjs = require('dayjs');

// Restores the customer table fields.
//
// review/full-audit-2026-09 finding 1 (Astra round 9): `storage_slug` is
// DELIBERATELY not in this whitelist. It is the account's immutable S3
// namespace (migrations/020.accounts_storage_slug.sql /
// src/utils/storageSlug.js) — account-service.js's createAccount assigns it
// server-side from the (also-whitelisted-here) account_name, and a client
// payload that happens to include a `storage_slug` key is silently dropped
// by simply never being copied into the returned object, same as any other
// unrecognized field. See restoreDataTypesAccountOnUpdate below for the same
// rule on update, and test/endpoints/account/accountObjects.spec.js for the
// regression proving a supplied value never survives either mapper.
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

// account-router.js's PUT /account/updateAccount is a single combined
// endpoint fed by two independent frontend forms (business settings and
// address) that each submit only their own fields — req.body.account
// legitimately carries a PARTIAL object. These *OnUpdate mappers used to be
// unconditional object literals (every key always present, defaulting via
// Boolean()/dayjs() when the source field was missing), which turned "the
// address form didn't send is_account_active" into "set is_account_active to
// false" and "didn't send created_at" into "rewrite created_at to right now".
// A key that's genuinely absent from the payload must stay absent here too —
// hasField() (own-property, not truthiness) is what lets the router tell
// "the client omitted this" apart from "the client explicitly cleared it to
// null/false", and drives which of the two underlying tables the router
// actually needs to write to.
const hasField = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

// Restores the customer table fields.
//
// `storage_slug` is intentionally NEVER read from `newAccount` here — see the
// comment on restoreDataTypesAccountOnCreate above. A client that includes
// `storage_slug` in a PUT /account/updateAccount body has it silently
// ignored (the key is simply never copied into accountFields), the same
// outcome as any other field this whitelist doesn't recognize; it is never a
// 400, since the field name isn't otherwise reserved/meaningful to a client.
const restoreDataTypesAccountOnUpdate = newAccount => {
  const accountFields = { account_id: Number(newAccount.account_id) };
  if (hasField(newAccount, 'account_name')) accountFields.account_name = newAccount.account_name;
  if (hasField(newAccount, 'account_type')) accountFields.account_type = newAccount.account_type;
  if (hasField(newAccount, 'is_account_active')) accountFields.is_account_active = Boolean(newAccount.is_account_active);
  if (hasField(newAccount, 'account_statement')) accountFields.account_statement = newAccount.account_statement;
  if (hasField(newAccount, 'account_interest_statement')) accountFields.account_interest_statement = newAccount.account_interest_statement;
  if (hasField(newAccount, 'account_invoice_template_option')) accountFields.account_invoice_template_option = newAccount.account_invoice_template_option;
  if (hasField(newAccount, 'account_company_logo')) accountFields.account_company_logo = newAccount.account_company_logo;
  // created_at is intentionally never written by an update — only
  // restoreDataTypesAccountOnCreate (a real creation) should ever set it.
  return accountFields;
};

const restoreDataTypesAccountInformationOnUpdate = newAccountInformation => {
  const infoFields = { account_id: Number(newAccountInformation.account_id) };
  if (hasField(newAccountInformation, 'account_info_id')) infoFields.account_info_id = Number(newAccountInformation.account_info_id);
  if (hasField(newAccountInformation, 'account_street')) infoFields.account_street = newAccountInformation.account_street;
  if (hasField(newAccountInformation, 'account_city')) infoFields.account_city = newAccountInformation.account_city;
  if (hasField(newAccountInformation, 'account_state')) infoFields.account_state = newAccountInformation.account_state;
  if (hasField(newAccountInformation, 'account_zip')) infoFields.account_zip = newAccountInformation.account_zip;
  if (hasField(newAccountInformation, 'account_email')) infoFields.account_email = newAccountInformation.account_email;
  if (hasField(newAccountInformation, 'account_phone')) infoFields.account_phone = newAccountInformation.account_phone;
  if (hasField(newAccountInformation, 'is_this_address_active')) infoFields.is_this_address_active = Boolean(newAccountInformation.is_this_address_active);
  if (hasField(newAccountInformation, 'is_account_physical_address')) infoFields.is_account_physical_address = Boolean(newAccountInformation.is_account_physical_address);
  if (hasField(newAccountInformation, 'is_account_billing_address')) infoFields.is_account_billing_address = Boolean(newAccountInformation.is_account_billing_address);
  if (hasField(newAccountInformation, 'is_account_mailing_address')) infoFields.is_account_mailing_address = Boolean(newAccountInformation.is_account_mailing_address);
  // created_at is intentionally never written by an update — see above.
  return infoFields;
};

const validateAccountCreation = account => {
  const limits = { account_name: 100, account_type: 50, account_statement: 255, account_interest_statement: 255,
    account_invoice_template_option: 100, account_company_logo: 255, account_street: 255,
    account_city: 100, account_state: 2, account_zip: 10, account_email: 255, account_phone: 20 };
  for (const [field, limit] of Object.entries(limits)) {
    const value = account && account[field];
    if ((['account_name', 'account_type'].includes(field) && (typeof value !== 'string' || !value.trim())) ||
        (value != null && (typeof value !== 'string' || [...value].length > limit))) {
      throw Object.assign(new Error(`Invalid ${field}; use text up to ${limit} characters.`), { status: 400 });
    }
  }
};

module.exports = {
  validateAccountCreation,
  restoreDataTypesAccountOnCreate,
  restoreDataTypesAccountInformationOnCreate,
  restoreDataTypesAccountOnUpdate,
  restoreDataTypesAccountInformationOnUpdate
};
