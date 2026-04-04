/**
 * Maps a pending payment record (from customer_payments_processed) plus any
 * user edits into the shape expected by the existing payment creation flow.
 *
 * The output matches what `restoreDataTypesPaymentsTableOnCreate` in
 * paymentsObjects.js expects — the frontend form shape with camelCase keys.
 */
const mapPendingToPaymentCreateObject = (pendingRecord, userEdits, loggedInUser) => {
   const { accountID, userID } = loggedInUser;

   return {
      customerID: userEdits.customerID || pendingRecord.matched_customer_id || pendingRecord.customer_id,
      accountID: Number(accountID),
      selectedJobID: userEdits.customerJobID || null,
      selectedRetainerID: userEdits.retainerID || null,
      selectedInvoiceID: userEdits.customerInvoiceID || null,
      transactionDate: userEdits.paymentDate || pendingRecord.payment_date,
      unitCost: Math.abs(Number(userEdits.paymentAmount || pendingRecord.payment_amount)),
      formOfPayment: userEdits.formOfPayment || pendingRecord.form_of_payment || 'Check',
      paymentReferenceNumber: userEdits.paymentReferenceNumber ?? pendingRecord.payment_reference_number ?? '',
      isTransactionBillable: true,
      loggedByUserID: Number(userID),
      note: userEdits.note ?? pendingRecord.note ?? ''
   };
};

module.exports = { mapPendingToPaymentCreateObject };
