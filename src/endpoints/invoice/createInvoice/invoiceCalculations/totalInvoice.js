const totalInvoice = (customer_id, invoiceInformation, showWriteOffs, hideRetainers) => {
   const { payments, retainers, writeOffs, transactions, transactionRetainerPayments, outstandingInvoices } = invoiceInformation;

   const invoiceTotalHidingWriteOffs = payments.paymentTotal + transactions.transactionsTotal + outstandingInvoices.outstandingInvoiceTotal;

   const writeOffsTotal = writeOffs.writeOffTotal;
   const retainerTotal = hideRetainers ? 0 : retainers.retainerTotal;

   const preRetainerInvoiceTotal = invoiceTotalHidingWriteOffs + writeOffsTotal;
   // These are payments that were applied at the time of the transaction charge/time and linked to a retainer.
   const retainerAppliedToInvoice = payments.retainerPaymentTotal;
   const remainingRetainer = retainerTotal + Math.abs(retainerAppliedToInvoice);
   const invoiceTotal = invoiceTotalHidingWriteOffs + writeOffsTotal;

   if (isNaN(invoiceTotal)) {
      console.log(`Invoice Total on ${customer_id} is NaN`);
      throw new Error(`Invoice Total on ${customer_id} is NaN`);
   }
   if (invoiceTotal === null || invoiceTotal === undefined) {
      console.log(`Invoice Total on ${customer_id} is null or undefined`);
      throw new Error(`Invoice Total on ${customer_id} is null or undefined`);
   }
   if (typeof invoiceTotal !== 'number') {
      console.log(`Invoice Total on ${customer_id} is not a number`);
      throw new Error(`Invoice Total on ${customer_id} is not a number`);
   }

   return { retainerAppliedToInvoice, remainingRetainer, invoiceTotal, preRetainerInvoiceTotal };
};

module.exports = { totalInvoice };
