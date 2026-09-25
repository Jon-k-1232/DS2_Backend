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
   const eventRows = (retainers.events || []).flatMap(event => {
      const evidence = Array.from([event.reason,event.method,event.reference].filter(Boolean).join(' / '));
      const rows = [];
      // A maximum-length unbroken reason must remain printable. Keep each
      // segment small enough for an A3 table page; print money exactly once.
      for (let offset=0; offset<evidence.length; offset+=600) rows.push({...event,continued:offset>0,display_evidence:evidence.slice(offset,offset+600).join('')});
      return rows;
   });
   if (eventRows.length) renderTableSection(doc, invoiceDetails, preferenceSettings, {
      title: 'Retainer Refunds and Adjustments (availability only)',
      columns: [
         { header:'Date / Event', x:leftMargin+10, width:170, cell:r => r.continued ? 'continued' : `${require('dayjs')(r.event_date).format('YYYY-MM-DD')} ${r.kind} ${r.direction}` },
         { header:'Reason / Method / Reference', x:260, width:right-422, cell:r => r.display_evidence },
         { header:'Amount / Available after', x:right-150, width:150, align:'right', cell:r => r.continued ? '' : `${Number(r.amount).toFixed(2)} / ${Number(r.available_after).toFixed(2)}` }
      ], rows:eventRows, subtotalLines:['Retainer activity does not change the amount due.'], describeRow:r => `retainer event ${r.event_id}`
   });


};

module.exports = { createRetainersSection };
