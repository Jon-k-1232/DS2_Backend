const restoreDataTypesWriteOffsTableOnCreate = data => ({
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_invoice_id: Number(data.customerInvoiceID) || null,
   customer_job_id: Number(data.selectedJobID) || null,
   writeoff_date: data.selectedDate,
   writeoff_amount: -Math.abs(data.unitCost),
   transaction_type: 'Writeoff',
   writeoff_reason: data.writeoffReason || null,
   created_by_user_id: Number(data.loggedByUserID),
   note: data.note || null
});

const restoreDataTypesWriteOffsTableOnUpdate = data => ({
   writeoff_id: Number(data.writeoffID),
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_invoice_id: Number(data.customerInvoiceID) || null,
   customer_job_id: Number(data.selectedJobID) || null,
   writeoff_date: data.selectedDate,
   writeoff_amount: -Math.abs(data.unitCost),
   transaction_type: data.transactionType || 'Write Off',
   writeoff_reason: data.writeoffReason || null,
   created_by_user_id: Number(data.loggedByUserID),
   note: data.note || null
});

const restoreDataTypesOnWriteOffs = data => ({
   writeoff_id: Number(data.writeoff_id),
   customer_id: Number(data.customer_id),
   account_id: Number(data.account_id),
   customer_invoice_id: Number(data.customer_invoice_id) || null,
   customer_job_id: Number(data.customer_job_id) || null,
   writeoff_date: String(data.writeoff_date),
   writeoff_amount: -Math.abs(Number(data.writeoff_amount)),
   transaction_type: String(data.transaction_type) || 'Write Off',
   writeoff_reason: String(data.writeoff_reason) || null,
   created_at: new Date(data.created_at),
   created_by_user_id: Number(data.created_by_user_id),
   note: String(data.note) || null
});

/**
 * Used to convert write off to payment record.
 * @param {*} data
 * @returns
 */
const convertWriteOffToPayment = data => ({
   customer_id: Number(data.customer_id),
   account_id: Number(data.account_id),
   customer_job_id: null,
   retainer_id: null,
   customer_invoice_id: Number(data.customer_invoice_id),
   payment_date: data.writeoff_date,
   payment_amount: -Math.abs(Number(data.writeoff_amount)),
   form_of_payment: 'Write Off',
   payment_reference_number: 'See write offs.',
   is_transaction_billable: true,
   created_by_user_id: Number(data.created_by_user_id),
   note: data.note || null
});

module.exports = { restoreDataTypesWriteOffsTableOnCreate, restoreDataTypesWriteOffsTableOnUpdate, restoreDataTypesOnWriteOffs, convertWriteOffToPayment };
