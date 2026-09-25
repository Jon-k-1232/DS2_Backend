/**
 * Normalizes a transaction_type value to the canonical casing the rest of
 * the app expects ('Time' / 'Charge'), case-insensitively. Throws a clear
 * error for anything else instead of silently persisting a value that later
 * case-sensitive comparisons would just silently fail to match.
 * @param {*} value
 * @returns {'Time'|'Charge'}
 */
const normalizeTransactionType = value => {
   const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
   if (normalized === 'time') return 'Time';
   if (normalized === 'charge') return 'Charge';
   throw new Error(`Invalid transaction_type: "${value}". Must be "Time" or "Charge".`);
};

/**
 * `String(x) || fallback` is broken for nullable text columns: String(undefined)
 * is the literal string "undefined" (truthy), and String(null) is the literal
 * string "null" (truthy), so the `||` fallback never fires and the literal
 * word gets persisted instead of the intended empty/NULL value.
 * @param {*} value
 * @returns {string|null}
 */
const nullableString = value => (value == null || value === '' ? null : String(value));

/**
 * `Boolean(x) || true` always evaluates to `true` (a boolean OR'd with `true`
 * is always `true`), making it impossible to ever persist `false`. This only
 * treats a genuinely absent value (null/undefined) as "use the default";
 * an explicit false/'false' is honored.
 * @param {*} value
 * @param {boolean} defaultValue - used only when value is null/undefined
 * @returns {boolean}
 */
const parseBooleanFlag = (value, defaultValue = false) => (value == null ? defaultValue : value === true || value === 'true');

const restoreDataTypesTransactionsTableOnCreate = transaction => ({
   // Prefer an already-trusted snake_case account_id (the router sets this
   // from req.params.accountID, never from the request body) and only fall
   // back to the camelCase body field for callers that don't set it.
   account_id: Number(transaction.account_id ?? transaction.accountID),
   customer_id: Number(transaction.customerID),
   customer_job_id: Number(transaction.customerJobID),
   retainer_id: Number(transaction.selectedRetainerID) || null,
   customer_invoice_id: Number(transaction.customerInvoicesID) || null,
   logged_for_user_id: Number(transaction.loggedForUserID),
   general_work_description_id: Number(transaction.selectedGeneralWorkDescriptionID),
   detailed_work_description: nullableString(transaction.detailedJobDescription),
   transaction_date: String(transaction.transactionDate),
   transaction_type: normalizeTransactionType(transaction.transactionType),
   quantity: Number(transaction.quantity),
   unit_cost: Number(transaction.unitCost),
   total_transaction: Math.abs(Number(transaction.totalTransaction)),
   is_transaction_billable: parseBooleanFlag(transaction.isTransactionBillable),
   is_excess_to_subscription: parseBooleanFlag(transaction.isInAdditionToMonthlyCharge),
   created_at: new Date(),
   created_by_user_id: Number(transaction.loggedByUserID),
   note: nullableString(transaction.note)
});

const restoreDataTypesTransactionsTableOnUpdate = transaction => ({
   transaction_id: Number(transaction.transactionID),
   account_id: Number(transaction.account_id ?? transaction.accountID),
   customer_id: Number(transaction.customerID),
   customer_job_id: Number(transaction.customerJobID),
   retainer_id: Number(transaction.selectedRetainerID) || null,
   // customer_invoice_id is intentionally NOT included here. Once a
   // transaction is billed it is immutable, and the invoice link may only
   // ever be set by the billing engine — never by a client update request.
   // Omitting the key means knex's .update() leaves the stored column
   // untouched, so the client can never move a transaction on/off an
   // invoice via this path.
   logged_for_user_id: Number(transaction.loggedForUserID),
   general_work_description_id: Number(transaction.selectedGeneralWorkDescriptionID),
   detailed_work_description: nullableString(transaction.detailedJobDescription),
   transaction_date: String(transaction.transactionDate),
   transaction_type: normalizeTransactionType(transaction.transactionType),
   quantity: Number(transaction.quantity),
   unit_cost: Number(transaction.unitCost),
   total_transaction: Math.abs(Number(transaction.totalTransaction)),
   is_transaction_billable: parseBooleanFlag(transaction.isTransactionBillable),
   is_excess_to_subscription: parseBooleanFlag(transaction.isInAdditionToMonthlyCharge),
   // created_at is intentionally NOT included here. It is an audit column
   // stamped once at creation; omitting the key means knex's .update()
   // leaves it untouched instead of resetting it to "now" on every edit.
   // created_by_user_id is likewise NOT included: it is stamped once at
   // creation from the authenticated actor (see addNewTransaction) and must
   // survive every later edit, including one made by a different user —
   // omitting the key means knex's .update() leaves it untouched.
   note: nullableString(transaction.note)
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
   detailed_work_description: nullableString(transaction.detailed_work_description),
   transaction_date: new Date(transaction.transaction_date),
   transaction_type: normalizeTransactionType(transaction.transaction_type),
   quantity: Number(transaction.quantity),
   unit_cost: Number(transaction.unit_cost),
   total_transaction: Math.abs(Number(transaction.total_transaction)),
   is_transaction_billable: Boolean(transaction.is_transaction_billable),
   is_excess_to_subscription: Boolean(transaction.is_excess_to_subscription) || false,
   created_at: new Date(transaction.created_at),
   created_by_user_id: Number(transaction.created_by_user_id),
   note: nullableString(transaction.note)
});

const createPaymentObjectFromTransaction = data => ({
   customer_id: Number(data.customerID),
   account_id: Number(data.account_id ?? data.accountID),
   customer_job_id: Number(data.customerJobID) || null,
   retainer_id: Number(data.selectedRetainerID),
   customer_invoice_id: Number(data.customerInvoicesID) || null,
   payment_date: String(data.transactionDate),
   payment_amount: -Math.abs(Number(data.totalTransaction)),
   form_of_payment: 'Retainer',
   payment_reference_number: 'Retainer',
   // Was `Boolean(data.isTransactionBillable) || true`, which always
   // evaluates true regardless of input (same class of bug as item 7).
   // addNewTransaction now only calls this function for billable
   // transactions in the first place, but parse it properly rather than
   // hardcode true so this stays correct if reused elsewhere.
   is_transaction_billable: parseBooleanFlag(data.isTransactionBillable, true),
   created_by_user_id: data.loggedForUserID,
   note: null
});

module.exports = {
   normalizeTransactionType,
   nullableString,
   parseBooleanFlag,
   restoreDataTypesTransactionsTableOnCreate,
   restoreDataTypesTransactionsTableOnUpdate,
   restoreDataTypesOnTransactions,
   createPaymentObjectFromTransaction
};
