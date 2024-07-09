const createTotalsSection = (doc, invoiceDetails, preferenceSettings) => {
   const { retainerAppliedToInvoice, remainingRetainer, invoiceTotal, preRetainerInvoiceTotal, retainers } = invoiceDetails;
   const { normalFont, boldFont, lineHeight, alignRight, endOfGroupingHeight } = preferenceSettings;

   const groupHeight = endOfGroupingHeight + 25;

   if (retainers.retainerRecords.length) {
      doc.font(normalFont)
         .fontSize(12)
         .text(
            `Invoice Total Before Retainer/ Pre-Payment: ${preRetainerInvoiceTotal.toFixed(2)}`,
            alignRight(`Invoice Total Before Retainer/ Pre-Payment: ${preRetainerInvoiceTotal.toFixed(2)}`, 1),
            groupHeight
         )
         .text(
            `Retainer/ Pre-Payment Applied to Invoice: ${retainerAppliedToInvoice.toFixed(2)}`,
            alignRight(`Retainer/ Pre-Payment Applied to Invoice: ${retainerAppliedToInvoice.toFixed(2)}`, 1),
            groupHeight + lineHeight
         )
         .text(`Remaining Retainer/ Pre-Payment: ${remainingRetainer.toFixed(2)}`, alignRight(`Remaining Retainer/ Pre-Payment: ${remainingRetainer.toFixed(2)}`, 1), groupHeight + lineHeight * 2);

      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(475, groupHeight + lineHeight * 3)
         .lineTo(770, groupHeight + lineHeight * 3)
         .stroke();
   }

   doc.font(boldFont)
      .fontSize(14)
      .text(
         `Balance Due: ${invoiceTotal.toFixed(2)}`,
         alignRight(`Balance Due: ${invoiceTotal.toFixed(2)}`, 1),
         retainers.retainerRecords.length ? groupHeight + lineHeight * 3.5 : groupHeight + lineHeight
      );

   preferenceSettings.endOfGroupingHeight = groupHeight + lineHeight * 2;
};

module.exports = { createTotalsSection };
