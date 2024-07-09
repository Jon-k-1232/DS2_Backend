const invoiceService = require('../invoice-service');
const customerService = require('../../customer/customer-service');
const transactionsService = require('../../transactions/transactions-service');
const retainerService = require('../../retainer/retainer-service');
const writeOffsService = require('../../writeOffs/writeOffs-service');
const { groupByFunction, findMostRecentOutstandingInvoiceRecords } = require('../sharedInvoiceFunctions');
const dayjs = require('dayjs');
const paymentsService = require('../../payments/payments-service');

/**
 * Orchestrate the invoice eligibility page
 * @param {*} db
 * @param {*} accountID
 * @returns {}
 */
const findCustomersNeedingInvoices = async (db, accountID) => {
   const [customers, invoices, transactions, retainers, writeOffs, payments] = await fetchData(db, accountID);
   const [invoicesByCustomer, transactionsByCustomer, retainersByCustomer, writeOffsByCustomer, paymentsByCustomer] = groupDataByCustomerId([invoices, transactions, retainers, writeOffs, payments]);
   return invoiceEligibilityPerCustomer(customers, invoicesByCustomer, transactionsByCustomer, retainersByCustomer, writeOffsByCustomer, paymentsByCustomer);
};

module.exports = { findCustomersNeedingInvoices };

// Fetch all data needed for the invoice eligibility page
const fetchData = async (db, accountID) => {
   return Promise.all([
      customerService.getActiveCustomers(db, accountID),
      invoiceService.getInvoices(db, accountID),
      transactionsService.getActiveTransactions(db, accountID),
      retainerService.getActiveRetainers(db, accountID),
      writeOffsService.getActiveWriteOffs(db, accountID),
      paymentsService.getActivePayments(db, accountID)
   ]);
};

// Group the data by customer_id
const groupDataByCustomerId = data => {
   return data.map(dataset => groupByFunction(dataset, 'customer_id'));
};

const invoiceEligibilityPerCustomer = (customers, invoicesByCustomer, transactionsByCustomer, retainersByCustomer, writeOffsByCustomer, paymentsByCustomer) => {
   return customers
      .map(customer => {
         const { customer_id } = customer;
         // Access the customers prior invoices
         const customerInvoices = invoicesByCustomer[customer_id] || [];
         // find customer most recent payment
         const customerPayment = paymentsByCustomer[customer_id] || [];
         const customerPaymentsTotal = customerPayment.reduce((acc, payment) => acc + Number(payment.payment_amount), 0);

         const sortedCustomerInvoices = customerInvoices.sort((a, b) => dayjs(b.invoice_date).isAfter(dayjs(a.invoice_date)));
         const outstandingInvoices = sortedCustomerInvoices.length ? findMostRecentOutstandingInvoiceRecords(sortedCustomerInvoices) : [];
         const outstandingInvoicesTotal = outstandingInvoices.reduce((acc, invoice) => acc + Number(invoice.remaining_balance_on_invoice), 0);

         // Of all the invoices, find the most recent invoice
         const mostRecentInvoice = sortedCustomerInvoices.length && sortedCustomerInvoices.find(invoice => invoice.parent_invoice_id === null);

         // Access the customers transactions
         const customerTransactions = transactionsByCustomer[customer_id] || [];
         // Get the transactions that are more recent than the most recent invoice
         const recentCustomerTransactions =
            customerTransactions.length && Object.keys(mostRecentInvoice).length
               ? customerTransactions.filter(transaction => dayjs(transaction.transaction_date).isAfter(dayjs(mostRecentInvoice.invoice_date)))
               : customerTransactions;

         // Access the customers retainers
         const customerRetainers = retainersByCustomer[customer_id] || [];
         const customerActiveRetainers = customerRetainers && customerRetainers?.filter(retainer => Number(retainer.current_amount) < 0);

         // If all values are null, the null customer will be filtered out of the return array
         if (!customerActiveRetainers.length && !recentCustomerTransactions.length && !outstandingInvoices.length) {
            return null;
         }

         // Remove invoices that have a 0 balance. Check for outstanding invoice, check for payment and if payment is equal to outstanding invoice.
         if (!customerActiveRetainers.length && !recentCustomerTransactions.length && Math.abs(outstandingInvoicesTotal) === Math.abs(customerPaymentsTotal)) {
            return null;
         }

         const customerWriteOffs = writeOffsByCustomer[customer_id] || [];
         const customerActiveWriteOffs = customerWriteOffs && customerWriteOffs?.filter(writeOff => Number(writeOff.writeoff_amount) < 0);

         return {
            ...customer,
            retainer_count: customerActiveRetainers.length,
            transaction_count: recentCustomerTransactions.length,
            invoice_count: outstandingInvoices.length,
            write_off_count: customerActiveWriteOffs.length
         };
      })
      .filter(Boolean); // Removes null entries
};
