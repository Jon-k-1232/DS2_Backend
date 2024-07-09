const invoiceService = require('../invoice-service');

/**
 * Orchestrator to fetch initial data for all clients with outstanding invoices.
 * @param {*} db
 * @param {*} customerIDs
 * @param {*} accountID
 * @returns
 */
const fetchInitialQueryItems = async (db, invoicesToCreateMap, accountID) => {
   try {
      const customerIDs = Object.keys(invoicesToCreateMap);

      // All other data fetching depends on this returning the correct date of the last invoice per customer
      const lastInvoiceDateByCustomerID = await invoiceService.getLastInvoiceDatesByCustomerID(db, accountID, customerIDs);

      const [lastInvoiceNumber, accountPayToInfo, customerInformation, customerTransactions, customerPayments, customerWriteOffs, customerRetainers, customerOutstandingInvoices] = await Promise.all([
         invoiceService.getLastInvoiceNumber(db, accountID),
         invoiceService.getAccountPayToInfo(db, accountID),
         invoiceService.getCustomerInformation(db, accountID, customerIDs),
         invoiceService.getTransactionsByCustomerID(db, accountID, customerIDs, lastInvoiceDateByCustomerID),
         invoiceService.getPaymentsByCustomerID(db, accountID, customerIDs, lastInvoiceDateByCustomerID),
         invoiceService.getWriteOffsByCustomerID(db, accountID, customerIDs, lastInvoiceDateByCustomerID),
         invoiceService.getRetainersByCustomerID(db, accountID, customerIDs, lastInvoiceDateByCustomerID),
         invoiceService.getOutstandingInvoices(db, accountID, customerIDs, lastInvoiceDateByCustomerID)
      ]);

      return {
         lastInvoiceNumber,
         lastInvoiceDateByCustomerID,
         accountPayToInfo,
         customerInformation,
         customerTransactions,
         customerPayments,
         customerWriteOffs,
         customerRetainers,
         customerOutstandingInvoices
      };
   } catch (error) {
      console.log(`Error fetching initial query items: ${error.message}`);
      throw new Error('Error fetching initial query items: ' + error.message);
   }
};

module.exports = { fetchInitialQueryItems };
