const totalInvoice = (customer_id, invoiceInformation, showWriteOffs, hideRetainers) => {
   const { payments, retainers, writeOffs, transactions, transactionRetainerPayments, outstandingInvoices } = invoiceInformation;

   const invoiceTotalHidingWriteOffs = payments.paymentTotal + transactions.transactionsTotal + outstandingInvoices.outstandingInvoiceTotal;

   const writeOffsTotal = writeOffs.writeOffTotal;
   const retainerTotal = hideRetainers ? 0 : retainers.retainerTotal;

   // These are payments that were applied at the time of the transaction charge/time and linked to a retainer.
   const retainerAppliedToInvoice = payments.retainerPaymentTotal;
   // What the statement would ask for before the retainer-funded payments of the
   // period were applied (those payments are negative, so subtracting adds back).
   const preRetainerInvoiceTotal = invoiceTotalHidingWriteOffs + writeOffsTotal - retainerAppliedToInvoice;
   // retainerTotal is the sum of each chain's LATEST snapshot, i.e. the balance
   // that already reflects every draw (retainer-funded work reduces the chain when
   // the transaction is entered). Adding the period's draws back on top of it — as
   // the old formula did against the ORIGINAL balance — double counted them.
   const remainingRetainer = retainerTotal;
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
