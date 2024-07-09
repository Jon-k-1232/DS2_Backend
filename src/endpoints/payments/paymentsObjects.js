const restoreDataTypesPaymentsTableOnCreate = data => ({
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_job_id: data.selectedJobID || null,
   retainer_id: Number(data.selectedRetainerID) || null,
   customer_invoice_id: Number(data.selectedInvoiceID) || null,
   payment_date: data.transactionDate,
   payment_amount: -Math.abs(Number(data.unitCost)),
   form_of_payment: data.formOfPayment,
   payment_reference_number: data.paymentReferenceNumber || null,
   is_transaction_billable: Boolean(data.isTransactionBillable) || true,
   created_by_user_id: Number(data.loggedByUserID),
   note: data.note || null
});

const restoreDataTypesPaymentsTableOnUpdate = data => ({
   payment_id: Number(data.paymentID),
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_job_id: data.selectedJobID || null,
   retainer_id: Number(data.selectedRetainerID) || null,
   customer_invoice_id: Number(data.selectedInvoiceID) || null,
   payment_date: data.transactionDate,
   payment_amount: -Math.abs(Number(data.unitCost)),
   form_of_payment: data.formOfPayment,
   payment_reference_number: data.paymentReferenceNumber || null,
   is_transaction_billable: Boolean(data.isTransactionBillable) || true,
   created_by_user_id: Number(data.loggedByUserID),
   note: data.note || null
});

const restoreDataTypesOnPayments = data => ({
   payment_id: Number(data.payment_id),
   customer_id: Number(data.customer_id),
   account_id: Number(data.account_id),
   customer_job_id: Number(data.customer_job_id) || null,
   retainer_id: Number(data.retainer_id) || null,
   customer_invoice_id: Number(data.customer_invoice_id) || null,
   payment_date: new Date(data.payment_date),
   payment_amount: -Math.abs(Number(data.payment_amount)),
   form_of_payment: String(data.form_of_payment),
   payment_reference_number: String(data.payment_reference_number) || null,
   is_transaction_billable: Boolean(data.is_transaction_billable) || true,
   created_at: new Date(data.created_at),
   created_by_user_id: Number(data.created_by_user_id),
   note: String(data.note) || null
});

module.exports = { restoreDataTypesPaymentsTableOnCreate, restoreDataTypesPaymentsTableOnUpdate, restoreDataTypesOnPayments };
