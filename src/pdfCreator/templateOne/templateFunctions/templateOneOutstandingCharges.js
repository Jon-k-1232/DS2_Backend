const dayjs = require('dayjs');
const { renderTableSection } = require('./pdfLayoutHelpers');

const createOutstandingChargesSection = (doc, invoiceDetails, preferenceSettings) => {
   const { outstandingInvoices } = invoiceDetails;
   const { leftMargin, rightMargin, pageWidth, bodyHeight, endOfGroupingHeight } = preferenceSettings;
   const right = pageWidth - rightMargin;
   const amountX = right - 100;

   renderTableSection(doc, invoiceDetails, preferenceSettings, {
      title: 'Beginning Balance',
      // First (and only) section on the statement: always starts at the fixed
      // offset below the letterhead/Bill To block on page 1.
      startY: endOfGroupingHeight + bodyHeight,
      columns: [
         { header: 'Invoice Date', x: leftMargin + 10, width: 110, cell: row => dayjs(row.invoice_date).format('MM/DD/YYYY') },
         { header: 'Invoice', x: 200, width: 180, cell: row => `${row.invoice_number}` },
         { header: 'Original Amount', x: 400, width: amountX - 400 - 12, cell: row => `${Number(row.remaining_balance_on_invoice).toFixed(2)}` },
         { header: 'Outstanding', x: amountX, width: 100, align: 'right', cell: row => `${Number(row.remaining_balance_on_invoice).toFixed(2)}` }
      ],
      rows: outstandingInvoices.outstandingInvoiceRecords,
      subtotalLines: [`Beginning Balance: ${Number(outstandingInvoices.outstandingInvoiceTotal).toFixed(2)}`],
      describeRow: row => `outstanding invoice ${row.invoice_number ?? ''}`
   });
};

module.exports = { createOutstandingChargesSection };
