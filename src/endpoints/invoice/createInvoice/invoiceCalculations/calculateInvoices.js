const { groupAndTotalPayments } = require('./paymentsCalculations');
const { groupAndTotalRetainers } = require('./retainerCalculations');
const { groupAndTotalWriteOffs } = require('./writeOffCalculations');
const { groupAndTotalTransactions } = require('./transactionCalculations');
const { groupAndTotalOutstandingInvoices } = require('./outstandingInvoicesCalculations');
const { groupAndTotalTransactionRetainerPayments } = require('./transactionRetainerPaymentCalculations');
const { totalInvoice } = require('./totalInvoice');

const calculateInvoices = (invoicesToCreate, invoiceQueryData) => {
   try {
      return invoicesToCreate.map(customer => {
         const { customer_id } = customer;
         const { lastInvoiceDateByCustomerID } = invoiceQueryData;
         const hideRetainers = false;

         // "Show Write Offs" decides WHERE write-offs appear on the statement (their
         // own section vs. folded into each job). It must not change the total, so the
         // same effective flag is handed to every calculator. writeOffCalculations
         // used to flip itself to "shown" when a customer had no unbilled work but a
         // pending invoice-linked credit — while transactionCalculations still ran
         // in "hidden" mode and credited the job write-downs a second time.
         const showWriteOffs = effectiveShowWriteOffs(customer, invoiceQueryData);

         // Calculate the invoice information per customer
         const invoiceInformation = {
            lastInvoiceDate: lastInvoiceDateByCustomerID[customer_id],
            outstandingInvoices: groupAndTotalOutstandingInvoices(customer_id, invoiceQueryData),
            payments: groupAndTotalPayments(customer_id, invoiceQueryData),
            retainers: groupAndTotalRetainers(customer_id, invoiceQueryData, hideRetainers),
            transactions: groupAndTotalTransactions(customer_id, invoiceQueryData, showWriteOffs),
            writeOffs: groupAndTotalWriteOffs(customer_id, invoiceQueryData, showWriteOffs),
            transactionRetainerPayments: groupAndTotalTransactionRetainerPayments(customer_id, invoiceQueryData, showWriteOffs)
         };

         const invoiceTotal = totalInvoice(customer_id, invoiceInformation, showWriteOffs, hideRetainers);

         return { customer_id, ...invoiceInformation, ...invoiceTotal };
      });
   } catch (error) {
      console.log(`Error Calculating Invoices: ${error.message}`);
      throw new Error('Error calculating invoices: ' + error.message);
   }
};

const effectiveShowWriteOffs = (customer, invoiceQueryData) => {
   if (customer.showWriteOffs === true || customer.showWriteOffs === 'true') return true;
   const transactions = invoiceQueryData.customerTransactions?.[customer.customer_id] || [];
   const writeOffs = invoiceQueryData.customerWriteOffs?.[customer.customer_id] || [];
   // No unbilled work but pending invoice-linked credits: list every write-off in
   // its own section so the customer can see what the credit is for.
   return !transactions.length && writeOffs.some(writeOff => writeOff.customer_invoice_id);
};

module.exports = { calculateInvoices, effectiveShowWriteOffs };
