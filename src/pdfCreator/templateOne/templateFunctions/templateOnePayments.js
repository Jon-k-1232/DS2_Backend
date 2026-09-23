const dayjs = require('dayjs');
const { renderTableSection } = require('./pdfLayoutHelpers');

const createPaymentsSection = (doc, invoiceDetails, preferenceSettings) => {
   const { payments } = invoiceDetails;
   const { leftMargin, rightMargin, pageWidth } = preferenceSettings;
   const right = pageWidth - rightMargin;
   const amountX = right - 100;

   // Print the sum of the rows listed below. Invoice-applied payments are
   // already reflected in the Beginning Balance, so when any exist we say
   // so — printing the engine's uninvoiced-only total here (almost always
   // 0.00) made customers believe their payment was never recorded.
   const receivedTotal = Number(payments.paymentsReceivedTotal ?? payments.paymentTotal);
   const appliedToBalance = Math.abs(receivedTotal - payments.paymentTotal) > 0.009;
   const totalLine = `Total Payments Received: ${receivedTotal.toFixed(2)}${appliedToBalance ? ' (reflected in Beginning Balance above)' : ''}`;

   renderTableSection(doc, invoiceDetails, preferenceSettings, {
      title: 'Payments',
      columns: [
         { header: 'Date', x: leftMargin + 10, width: 110, cell: row => dayjs(row.payment_date).format('MM/DD/YYYY') },
         { header: 'Invoice', x: 200, width: 140, cell: row => `${row.invoice_number || 'No Attached Invoice'}` },
         { header: 'Type', x: 350, width: 90, cell: row => `${row.form_of_payment ?? ''}` },
         { header: 'Reference', x: 450, width: amountX - 450 - 12, cell: row => `${row.payment_reference_number ?? ''}` },
         { header: 'Amount', x: amountX, width: 100, align: 'right', cell: row => `${row.payment_amount}` }
      ],
      rows: payments.paymentRecords,
      subtotalLines: [totalLine],
      describeRow: row => `payment ${row.payment_id ?? ''} dated ${row.payment_date ?? ''}`
   });
};

module.exports = { createPaymentsSection };
