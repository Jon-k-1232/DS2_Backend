const { nullableString } = require('../payments/ledger-helpers');

// undefined keeps a column untouched on update (knex drops undefined values).
const optionalString = value => (value === undefined ? undefined : nullableString(value));

// Retainer balances are stored NEGATIVE (credits held for the customer).
// A new retainer always starts a new chain; draw-down snapshots are
// server-generated, so the client cannot pick a parent.
const restoreDataTypesRetainersTableOnCreate = data => ({
   parent_retainer_id: null,
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   display_name: nullableString(data.displayName),
   type_of_hold: nullableString(data.typeOfHold),
   starting_amount: -Math.abs(Number(data.unitCost)),
   current_amount: -Math.abs(Number(data.unitCost)),
   form_of_payment: nullableString(data.formOfPayment),
   payment_reference_number: nullableString(data.paymentReferenceNumber),
   is_retainer_active: true,
   created_by_user_id: Number(data.loggedByUserID),
   note: nullableString(data.note)
});

// current_amount and is_retainer_active are NOT client fields: the balance is
// the chain's draw history, adjusted server-side by the starting-amount delta
// (see retainer-logic.updateRetainerCore). parent_retainer_id and
// created_by_user_id are server-owned as well.
const restoreDataTypesRetainersTableOnUpdate = data => ({
   retainer_id: Number(data.retainerID),
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   display_name: optionalString(data.displayName),
   type_of_hold: nullableString(data.typeOfHold) || undefined,
   starting_amount: -Math.abs(Number(data.unitCost)),
   form_of_payment: optionalString(data.formOfPayment),
   payment_reference_number: optionalString(data.paymentReferenceNumber),
   note: optionalString(data.note)
});

module.exports = { restoreDataTypesRetainersTableOnCreate, restoreDataTypesRetainersTableOnUpdate };
