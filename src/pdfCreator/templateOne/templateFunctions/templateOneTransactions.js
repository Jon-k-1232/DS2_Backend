const { renderTableSection } = require('./pdfLayoutHelpers');

const createChargesSection = (doc, invoiceDetails, preferenceSettings) => {
   const { transactions } = invoiceDetails;
   const { leftMargin, rightMargin, pageWidth } = preferenceSettings;
   const right = pageWidth - rightMargin;
   const amountX = right - 100;

   renderTableSection(doc, invoiceDetails, preferenceSettings, {
      title: 'Professional Services',
      columns: [
         { header: 'Job', x: leftMargin + 10, width: 110, cell: row => `${row.jobID}` },
         { header: 'Job Description', x: 200, width: amountX - 200 - 12, cell: row => `${row.jobDescription}` },
         { header: 'Charge', x: amountX, width: 100, align: 'right', cell: row => Number(row.jobTotal).toFixed(2) }
      ],
      rows: transactions.transactionRecords,
      subtotalLines: [`Total New Charges: ${Number(transactions.transactionsTotal).toFixed(2)}`],
      describeRow: row => `job ${row.jobID ?? ''}`
   });
};

module.exports = { createChargesSection };
