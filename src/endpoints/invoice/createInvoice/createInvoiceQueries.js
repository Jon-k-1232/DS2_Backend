const invoiceService = require('../invoice-service');

/**
 * Orchestrator to fetch initial data for all clients with outstanding invoices.
 * @param {*} db
 * @param {*} customerIDs
 * @param {*} accountID
 * @returns
 */
const fetchInitialQueryItems = async (db, invoicesToCreateMap, accountID, { billingDate } = {}) => {
   try {
      const customerIDs = Object.keys(invoicesToCreateMap);
      const billingYear = billingDate ? Number(String(billingDate).slice(0, 4)) : new Date().getFullYear();

      // All other data fetching depends on this returning the correct date of the last invoice per customer.
      // The DATE lookup drives the outstanding-invoice (rolling balance) logic; the MARKER lookup
      // (newest parent row incl. its created_at timestamp) drives the payments / write-offs
      // statement gate so bill-day entries are never reflected on two statements.
      const [lastInvoiceDateByCustomerID, lastInvoiceMarkerByCustomerID] = await Promise.all([
         invoiceService.getLastInvoiceDatesByCustomerID(db, accountID, customerIDs),
         invoiceService.getLastInvoiceMarkersByCustomerID(db, accountID, customerIDs)
      ]);

      const [lastInvoiceNumber, accountPayToInfo, customerInformation, customerTransactions, customerPayments, customerWriteOffs, customerRetainers, customerOutstandingInvoices] = await Promise.all([
         invoiceService.getLastInvoiceNumber(db, accountID, { year: billingYear }),
         invoiceService.getAccountPayToInfo(db, accountID),
         invoiceService.getCustomerInformation(db, accountID, customerIDs),
         invoiceService.getTransactionsByCustomerID(db, accountID, customerIDs, lastInvoiceDateByCustomerID),
         invoiceService.getPaymentsByCustomerID(db, accountID, customerIDs, lastInvoiceMarkerByCustomerID),
         invoiceService.getWriteOffsByCustomerID(db, accountID, customerIDs, lastInvoiceMarkerByCustomerID),
         invoiceService.getRetainersByCustomerID(db, accountID, customerIDs, lastInvoiceDateByCustomerID),
         invoiceService.getOutstandingInvoices(db, accountID, customerIDs, lastInvoiceDateByCustomerID)
      ]);

      return {
         lastInvoiceNumber,
         billingYear,
         lastInvoiceDateByCustomerID,
         lastInvoiceMarkerByCustomerID,
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
