const { nullableString, positiveIntOrNull } = require('../payments/ledger-helpers');

// The form keeps the reason in `writeoffReason`; SharedPostObjects also sends a
// (usually null) `writeOffReason`.
const reasonOf = data => nullableString(data.writeoffReason ?? data.writeOffReason);

// Update: a key the client did not send stays undefined, and knex leaves that
// column untouched (an omitted field must not be nulled out).
const optional = (value, parse) => (value === undefined ? undefined : parse(value));

// Sign convention: writeoff_amount is stored NEGATIVE.
const restoreDataTypesWriteOffsTableOnCreate = data => ({
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_invoice_id: Number(data.customerInvoiceID) || null,
   customer_job_id: positiveIntOrNull(data.selectedJobID),
   writeoff_date: data.selectedDate,
   writeoff_amount: -Math.abs(Number(data.unitCost)),
   transaction_type: 'Writeoff',
   writeoff_reason: reasonOf(data),
   created_by_user_id: Number(data.loggedByUserID),
   note: nullableString(data.note)
});

// customer / invoice linkage, transaction_type and created_by are server-owned
// on update (writeOffs-logic.updateWriteOffCore keeps the stored values).
const restoreDataTypesWriteOffsTableOnUpdate = data => ({
   writeoff_id: Number(data.writeoffID ?? data.writeOffID),
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_invoice_id: Number(data.customerInvoiceID) || null,
   customer_job_id: optional(data.selectedJobID, positiveIntOrNull),
   writeoff_date: data.selectedDate,
   writeoff_amount: -Math.abs(Number(data.unitCost)),
   transaction_type: nullableString(data.transactionType) || 'Write Off',
   writeoff_reason: data.writeoffReason === undefined && data.writeOffReason === undefined ? undefined : reasonOf(data),
   created_by_user_id: Number(data.loggedByUserID),
   note: optional(data.note, nullableString)
});

const restoreDataTypesOnWriteOffs = data => ({
   writeoff_id: Number(data.writeoff_id),
   customer_id: Number(data.customer_id),
   account_id: Number(data.account_id),
   customer_invoice_id: Number(data.customer_invoice_id) || null,
   customer_job_id: Number(data.customer_job_id) || null,
   writeoff_date: data.writeoff_date,
   writeoff_amount: -Math.abs(Number(data.writeoff_amount)),
   transaction_type: nullableString(data.transaction_type) || 'Write Off',
   writeoff_reason: nullableString(data.writeoff_reason),
   created_at: new Date(data.created_at),
   created_by_user_id: Number(data.created_by_user_id),
   note: nullableString(data.note)
});

module.exports = { restoreDataTypesWriteOffsTableOnCreate, restoreDataTypesWriteOffsTableOnUpdate, restoreDataTypesOnWriteOffs };
