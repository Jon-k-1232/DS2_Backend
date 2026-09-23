const { nullableString, parseBoolean, positiveIntOrNull } = require('./ledger-helpers');

const restoreDataTypesPaymentsTableOnCreate = data => ({
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_job_id: positiveIntOrNull(data.selectedJobID),
   retainer_id: Number(data.selectedRetainerID) || null,
   customer_invoice_id: Number(data.selectedInvoiceID) || null,
   payment_date: data.transactionDate,
   payment_amount: -Math.abs(Number(data.unitCost)),
   form_of_payment: nullableString(data.formOfPayment),
   payment_reference_number: nullableString(data.paymentReferenceNumber),
   is_transaction_billable: parseBoolean(data.isTransactionBillable, true),
   created_by_user_id: Number(data.loggedByUserID),
   note: nullableString(data.note)
});

// Update: a key the client did not send stays undefined, and knex leaves that
// column untouched (an omitted field must not be nulled out).
const optional = (value, parse) => (value === undefined ? undefined : parse(value));

const restoreDataTypesPaymentsTableOnUpdate = data => ({
   payment_id: Number(data.paymentID),
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_job_id: optional(data.selectedJobID, positiveIntOrNull),
   retainer_id: Number(data.selectedRetainerID) || null,
   customer_invoice_id: Number(data.selectedInvoiceID) || null,
   payment_date: data.transactionDate,
   payment_amount: -Math.abs(Number(data.unitCost)),
   form_of_payment: optional(data.formOfPayment, nullableString),
   payment_reference_number: optional(data.paymentReferenceNumber, nullableString),
   is_transaction_billable: optional(data.isTransactionBillable, value => parseBoolean(value, true)),
   created_by_user_id: Number(data.loggedByUserID),
   note: optional(data.note, nullableString)
});

const restoreDataTypesOnPayments = data => ({
   payment_id: Number(data.payment_id),
   customer_id: Number(data.customer_id),
   account_id: Number(data.account_id),
   customer_job_id: Number(data.customer_job_id) || null,
   retainer_id: Number(data.retainer_id) || null,
   customer_invoice_id: Number(data.customer_invoice_id) || null,
   payment_date: new Date(data.payment_date),
   // Stored rows keep their sign: a POSITIVE payment row is a reversal (NSF),
   // and forcing it negative would turn a debt restoration into a payment.
   payment_amount: Number(data.payment_amount),
   form_of_payment: nullableString(data.form_of_payment),
   payment_reference_number: nullableString(data.payment_reference_number),
   is_transaction_billable: parseBoolean(data.is_transaction_billable, true),
   created_at: new Date(data.created_at),
   created_by_user_id: Number(data.created_by_user_id),
   note: nullableString(data.note)
});

module.exports = { restoreDataTypesPaymentsTableOnCreate, restoreDataTypesPaymentsTableOnUpdate, restoreDataTypesOnPayments };
