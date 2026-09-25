const { startContinuationPage } = require('./pdfLayoutHelpers');

const createTotalsSection = (doc, invoiceDetails, preferenceSettings) => {
   const { retainerAppliedToInvoice, remainingRetainer, invoiceTotal, preRetainerInvoiceTotal, retainers } = invoiceDetails;
   const { normalFont, boldFont, lineHeight, leftMargin, rightMargin, pageWidth } = preferenceSettings;
   const right = pageWidth - rightMargin;
   const bottom = doc.page.height - doc.page.margins.bottom;

   // Show the retainer summary when a retainer balance exists OR a retainer was
   // drawn this period (an exhausted retainer no longer lists a record).
   const showRetainerSummary = retainers.retainerRecords.length > 0 || Number(retainerAppliedToInvoice) !== 0;

   // 3 retainer lines + rule, or nothing, then the Balance Due line.
   const blockHeight = showRetainerSummary ? lineHeight * 4.5 : lineHeight * 2;

   let y = preferenceSettings.endOfGroupingHeight + 25;

   // Keep the whole totals block together: never split the retainer summary
   // from the Balance Due line below it, and never let either get stranded
   // mid-page. If it doesn't fit where the previous section left off, the
   // entire block moves to a fresh page.
   if (y + blockHeight > bottom) y = startContinuationPage(doc, invoiceDetails, preferenceSettings);

   if (showRetainerSummary) {
      doc.font(normalFont)
         .fontSize(12)
         .text(`Invoice Total Before Retainer/ Pre-Payment: ${preRetainerInvoiceTotal.toFixed(2)}`, leftMargin, y, { width: right - leftMargin, align: 'right' })
         .text(`Retainer/ Pre-Payment Applied to Invoice: ${retainerAppliedToInvoice.toFixed(2)}`, leftMargin, y + lineHeight, { width: right - leftMargin, align: 'right' })
         .text(`Remaining Retainer/ Pre-Payment: ${remainingRetainer.toFixed(2)}`, leftMargin, y + lineHeight * 2, { width: right - leftMargin, align: 'right' });

      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(475, y + lineHeight * 3)
         .lineTo(770, y + lineHeight * 3)
         .stroke();
   }

   doc.font(boldFont)
      .fontSize(14)
      .text(Number(invoiceTotal) < 0 ? `Credit balance: ${invoiceTotal.toFixed(2)} — No payment due` : `Balance Due: ${invoiceTotal.toFixed(2)}`, leftMargin, showRetainerSummary ? y + lineHeight * 3.5 : y + lineHeight, { width: right - leftMargin, align: 'right' });

   // Next section (Notes) starts below the Balance Due line, whichever layout printed.
   preferenceSettings.endOfGroupingHeight = showRetainerSummary ? y + lineHeight * 4.5 : y + lineHeight * 2;
};

module.exports = { createTotalsSection };
