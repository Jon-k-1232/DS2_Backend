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
const filterInvoices = (customerOutstandingInvoices, customerPayments, customersLastInvoiceDate, customerWriteOffRecords) => {
   const discardedGroups = new Set();

   const invoices = customerOutstandingInvoices.reduce((prev, invoice) => {
      const { invoice_number, created_at, remaining_balance_on_invoice, is_invoice_paid_in_full, fully_paid_date, customer_invoice_id } = invoice;

      // Check if this invoice has a payment after the last invoice date, this ensures if an invoice is paid off, it will show on the same bill as the payment made.
      const invoiceHasPayment = customerPayments.some(payment => payment.invoice_number === invoice_number);
      const invoiceHasWriteOff = customerWriteOffRecords.some(writeOff => writeOff.customer_invoice_id === customer_invoice_id);

      // Note: Added checking for if a writeoff has invoice as an error occurred when a writeoff was made to an invoice.

      // Check for conditions to discard this group of invoices
      if (!invoiceHasPayment && !invoiceHasWriteOff && (is_invoice_paid_in_full || fully_paid_date || Number(remaining_balance_on_invoice) === 0)) {
         discardedGroups.add(invoice_number);
      }

      // Validate conditions to consider this invoice
      const isValidByDate = isSameOrBefore(created_at, customersLastInvoiceDate);
      const hasPositiveBalance = Number(remaining_balance_on_invoice) > 0;

      if (isValidByDate && hasPositiveBalance && !discardedGroups.has(invoice_number)) {
         // Check if we already have an invoice with this number
         const existingInvoice = prev[invoice_number];

         if (!existingInvoice || dayjs(created_at).isAfter(dayjs(existingInvoice.created_at))) {
            prev[invoice_number] = invoice;
         }
      }

      return prev;
   }, {});

   // Filter out discarded groups
   const filteredInvoices = Object.values(invoices).filter(invoice => !discardedGroups.has(invoice.invoice_number));

   return filteredInvoices;
};
