const restoreDataTypesTransactionsTableOnCreate = transaction => ({
   account_id: Number(transaction.accountID),
   customer_id: Number(transaction.customerID),
   customer_job_id: Number(transaction.customerJobID),
   retainer_id: Number(transaction.selectedRetainerID) || null,
   customer_invoice_id: Number(transaction.customerInvoicesID) || null,
   logged_for_user_id: Number(transaction.loggedForUserID),
   general_work_description_id: Number(transaction.selectedGeneralWorkDescriptionID),
   detailed_work_description: String(transaction.detailedJobDescription) || '',
   transaction_date: String(transaction.transactionDate),
   transaction_type: String(transaction.transactionType),
   quantity: Number(transaction.quantity),
   unit_cost: Number(transaction.unitCost),
   total_transaction: Math.abs(Number(transaction.totalTransaction)),
   is_transaction_billable: Boolean(transaction.isTransactionBillable),
   is_excess_to_subscription: Boolean(transaction.isInAdditionToMonthlyCharge) || false,
   created_at: new Date(),
   created_by_user_id: Number(transaction.loggedByUserID),
   note: String(transaction.note) || ''
});

const restoreDataTypesTransactionsTableOnUpdate = transaction => ({
   transaction_id: Number(transaction.transactionID),
   account_id: Number(transaction.accountID),
   customer_id: Number(transaction.customerID),
   customer_job_id: Number(transaction.customerJobID),
   retainer_id: Number(transaction.selectedRetainerID) || null,
   customer_invoice_id: Number(transaction.customerInvoicesID) || null,
   logged_for_user_id: Number(transaction.loggedForUserID),
   general_work_description_id: Number(transaction.selectedGeneralWorkDescriptionID),
   detailed_work_description: String(transaction.detailedJobDescription) || '',
   transaction_date: String(transaction.transactionDate),
   transaction_type: String(transaction.transactionType),
   quantity: Number(transaction.quantity) || 1,
   unit_cost: Number(transaction.unitCost),
   total_transaction: Math.abs(Number(transaction.totalTransaction)),
   is_transaction_billable: Boolean(transaction.isTransactionBillable),
   is_excess_to_subscription: Boolean(transaction.isInAdditionToMonthlyCharge) || false,
   created_at: new Date(),
   created_by_user_id: Number(transaction.loggedByUserID),
   note: String(transaction.note) || ''
});

// Difference between this and the above is one is camelCase while the other is formatted for the db already
const restoreDataTypesOnTransactions = transaction => ({
   transaction_id: Number(transaction.transaction_id),
   account_id: Number(transaction.account_id),
   customer_id: Number(transaction.customer_id),
   customer_job_id: Number(transaction.customer_job_id),
   retainer_id: Number(transaction.retainer_id) || null,
   customer_invoice_id: Number(transaction.customer_invoice_id) || null,
   logged_for_user_id: Number(transaction.logged_for_user_id),
   general_work_description_id: Number(transaction.general_work_description_id),
   detailed_work_description: String(transaction.detailed_work_description) || '',
   transaction_date: new Date(transaction.transaction_date),
   transaction_type: String(transaction.transaction_type),
   quantity: Number(transaction.quantity),
   unit_cost: Number(transaction.unit_cost),
   total_transaction: Math.abs(Number(transaction.total_transaction)),
   is_transaction_billable: Boolean(transaction.is_transaction_billable),
   is_excess_to_subscription: Boolean(transaction.is_excess_to_subscription) || false,
   created_at: new Date(transaction.created_at),
   created_by_user_id: Number(transaction.created_by_user_id),
   note: String(transaction.note) || null
});

const createPaymentObjectFromTransaction = data => ({
   customer_id: Number(data.customerID),
   account_id: Number(data.accountID),
   customer_job_id: Number(data.customerJobID) || null,
   retainer_id: Number(data.selectedRetainerID),
   customer_invoice_id: Number(data.customerInvoicesID) || null,
   payment_date: String(data.transactionDate),
   payment_amount: -Math.abs(Number(data.totalTransaction)),
   form_of_payment: 'Retainer',
   payment_reference_number: 'Retainer',
   is_transaction_billable: Boolean(data.isTransactionBillable) || true,
   created_by_user_id: data.loggedForUserID,
   note: null
});
module.exports = { restoreDataTypesTransactionsTableOnCreate, restoreDataTypesTransactionsTableOnUpdate, restoreDataTypesOnTransactions, createPaymentObjectFromTransaction };
