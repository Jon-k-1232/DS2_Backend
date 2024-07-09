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
         const { customer_id, showWriteOffs } = customer;
         const { lastInvoiceDateByCustomerID } = invoiceQueryData;
         const hideRetainers = false;

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

module.exports = { calculateInvoices };
