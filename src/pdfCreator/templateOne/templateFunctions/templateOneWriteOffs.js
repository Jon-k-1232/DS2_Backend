const { renderTableSection } = require('./pdfLayoutHelpers');

const createWriteOffsSection = (doc, invoiceDetails, preferenceSettings) => {
   const { writeOffs } = invoiceDetails;
   const { leftMargin, rightMargin, pageWidth } = preferenceSettings;
   const right = pageWidth - rightMargin;
   const amountX = right - 100;

   // Print the sum of the rows listed below. Current-chain write-offs are
   // already reflected in the invoice balance, so when any exist the engine
   // total differs from the listed sum — say so.
   const listedTotal = Number(writeOffs.writeOffsListedTotal ?? writeOffs.writeOffTotal);
   const reflectedInBalance = Math.abs(listedTotal - writeOffs.writeOffTotal) > 0.009;
   const totalLine = `Total Revisions: ${listedTotal.toFixed(2)}${reflectedInBalance ? ' (reflected in invoice balance)' : ''}`;

   renderTableSection(doc, invoiceDetails, preferenceSettings, {
      title: 'Revisions',
      columns: [
         { header: 'Type', x: leftMargin + 10, width: 110, cell: row => `${row.transaction_type}` },
         { header: 'Reason', x: 200, width: amountX - 200 - 12, cell: row => `${row.writeoff_reason}` },
         { header: 'Amount', x: amountX, width: 100, align: 'right', cell: row => `${row.writeoff_amount}` }
      ],
      rows: writeOffs.writeOffRecords,
      subtotalLines: [totalLine],
      describeRow: row => `write-off ${row.writeoff_id ?? ''}`
   });
};

module.exports = { createWriteOffsSection };
