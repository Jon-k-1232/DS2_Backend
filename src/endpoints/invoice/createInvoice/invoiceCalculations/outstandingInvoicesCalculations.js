const dayjs = require('dayjs');

const groupAndTotalOutstandingInvoices = (customer_id, invoiceQueryData) => {
   const customerOutstandingInvoices = invoiceQueryData.customerOutstandingInvoices[customer_id] || [];
   const customersLastInvoiceDate = invoiceQueryData.lastInvoiceDateByCustomerID[customer_id] || [];
   const customerPayments = invoiceQueryData.customerPayments[customer_id] || [];

   const customerWriteOffRecords = invoiceQueryData.customerWriteOffs[customer_id] || [];

   const outstandingInvoiceRecords = filterInvoices(customerOutstandingInvoices, customerPayments, customersLastInvoiceDate, customerWriteOffRecords);
   const outstandingInvoiceTotal = outstandingInvoiceRecords.reduce((prev, invoice) => (prev += Number(invoice.remaining_balance_on_invoice)), 0);

   if (isNaN(outstandingInvoiceTotal)) {
      console.log(`Outstanding Invoice Total on customerID:${customer_id} is NaN`);
      throw new Error(`Outstanding Invoice Total on customerID:${customer_id} is NaN`);
   }
   if (outstandingInvoiceTotal === null || outstandingInvoiceTotal === undefined) {
      console.log(`Outstanding Invoice Total on customerID:${customer_id} is null or undefined`);
      throw new Error(`Outstanding Invoice Total on customerID:${customer_id} is null or undefined`);
   }
   if (typeof outstandingInvoiceTotal !== 'number') {
      console.log(`Outstanding Invoice Total on customerID:${customer_id} is not a number`);
      throw new Error(`Outstanding Invoice Total on customerID:${customer_id} is not a number`);
   }

   return { outstandingInvoiceTotal, outstandingInvoiceRecords };
};

module.exports = { groupAndTotalOutstandingInvoices };

const isSameOrBefore = (date1, date2) => dayjs(date1).isBefore(dayjs(date2)) || dayjs(date1).isSame(dayjs(date2));

/**
 * This function will filter the invoices into one invoice record per invoice number.
 *    - The invoice should be the most recent invoice for the customer, upto the last invoice date.
 * Calculating invoice this way to avoid matching payments to most recent invoices.
 * Requirements of the invoice group coming in:
 * Include parent invoices that do not have children and have a remaining balance.
 * Include parent invoices along with all their children where at least one of the children still has a remaining balance.
 * Include parent invoices along with all their children where a payment has been made after the last invoice date, regardless of the remaining balance.
 * Added conditional check for writeoffs tied to invoices.
 * @param {*} customerOutstandingInvoices
 * @param {*} customerPayments
 * @param {*} customersLastInvoiceDate
 * @param {*} customerWriteOffRecords
 * @returns [{object}]
 */
const filterInvoices = (rows, customerPayments, lastInvoiceDate) => {
   // Service orders each chain latest snapshot first, then older snapshots and
   // its parent. Historical paid flags must never discard a reopened/credit
   // latest snapshot. The latest row alone is authoritative, for either sign.
   const latest = new Map();
   for (const row of rows) {
      if (!latest.has(row.invoice_number)) latest.set(row.invoice_number, row);
   }
   return [...latest.values()].filter(row =>
      isSameOrBefore(row.invoice_date, lastInvoiceDate) &&
      Number(row.remaining_balance_on_invoice) !== 0 &&
      !/absorbed_by:/.test(row.notes || ''));
};
