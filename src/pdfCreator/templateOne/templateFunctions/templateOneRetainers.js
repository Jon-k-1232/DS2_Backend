const { renderTableSection } = require('./pdfLayoutHelpers');

const createRetainersSection = (doc, invoiceDetails, preferenceSettings) => {
   const { retainers } = invoiceDetails;
   const { leftMargin, rightMargin, pageWidth } = preferenceSettings;
   const right = pageWidth - rightMargin;
   const amountX = right - 100;

   renderTableSection(doc, invoiceDetails, preferenceSettings, {
      title: 'Retainers And Pre-Payments',
      columns: [
         { header: 'Type', x: leftMargin + 10, width: 110, cell: row => `${row.type_of_hold}` },
         { header: 'Original Amount', x: 200, width: amountX - 200 - 12, cell: row => `${row.starting_amount}` },
         { header: 'Current Balance', x: amountX, width: 100, align: 'right', cell: row => `${row.current_amount}` }
      ],
      rows: retainers.retainerRecords,
      subtotalLines: [`Retainer/ Pre-Payment Total: ${retainers.retainerTotal.toFixed(2)}`],
      describeRow: row => `retainer ${row.retainer_id ?? ''}`
   });

   // Cosmetic double-underline beneath the printed total figure, kept from
   // the legacy layout — now anchored to wherever the subtotal line actually
   // landed (it used to sit at a fixed offset that stopped tracking the
   // subtotal once more than a couple of rows pushed it further down, and
   // could even land on top of the total's own text).
   const ruleY = preferenceSettings.endOfGroupingHeight - 4;
   doc.lineCap('butt').lineWidth(1).moveTo(amountX, ruleY).lineTo(right, ruleY).stroke();
};

module.exports = { createRetainersSection };
