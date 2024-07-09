const dayjs = require('dayjs');

// Turns invoice array into object with key value pairs. Keys are customer IDs and values are arrays of invoices.
const groupByFunction = (array, passedPropertyToGroupBy) =>
   array.reduce((acc, invoice) => {
      if (!invoice) return acc;
      const groupByValue = invoice[passedPropertyToGroupBy];
      if (!acc[groupByValue]) acc[groupByValue] = [];
      acc[groupByValue].push(invoice);
      return acc;
   }, {});

/**
 * Takes in an array of sorted invoices and returns an array of the most recent outstanding invoices
 * @param {*} invoices
 * @returns [{},{}] Array of object. each object is the most recent record of an outstanding invoice
 */
const findMostRecentOutstandingInvoiceRecords = invoices => {
   const mostRecentOutstandingInvoices = invoices.reduce((acc, invoice) => {
      // Skip if no remaining balance
      if (Number(invoice.remaining_balance_on_invoice) <= 0) return acc;

      const parentID = invoice.parent_invoice_id || invoice.customer_invoice_id;

      // Update the record for this parent if it's either new or newer than the existing one
      if (!acc.has(parentID) || dayjs(invoice.invoice_date).isAfter(dayjs(acc.get(parentID).invoice_date))) {
         acc.set(parentID, invoice);
      }

      return acc;
   }, new Map());

   return Array.from(mostRecentOutstandingInvoices.values());
};

/**
 * increments an invoice or quote number
 * @param {*} invoiceNumber - String - invoice number to increment
 * @param {*} increment - Integer - number to increment by
 * @returns - String - incremented invoice number
 */
const incrementAnInvoiceOrQuote = (invoiceNumber, increment) => {
   // Check if invoiceNumber is a string
   if (typeof invoiceNumber !== 'string') {
      throw new Error('invoiceNumber must be a string');
   }

   const addOne = increment || 0;
   const currentYear = new Date().getFullYear();
   // match the format 'PREFIX-YYYY-NNNNN'
   const regex = /^([A-Z]+)-(\d{4})-(\d{5})$/;
   const match = regex.exec(invoiceNumber);

   if (!match) {
      throw new Error('Invalid invoiceNumber format');
   }

   const prefix = match[1];
   const year = parseInt(match[2]);
   const num = parseInt(match[3]);

   let incrementedNum;
   if (year === currentYear) {
      incrementedNum = num + 1 + addOne;
   } else {
      incrementedNum = 1;
   }

   // format number with leading zeros
   const formattedNum = incrementedNum.toString().padStart(5, '0');
   return `${prefix}-${currentYear}-${formattedNum}`;
};

module.exports = {
   groupByFunction,
   incrementAnInvoiceOrQuote,
   findMostRecentOutstandingInvoiceRecords
};
