const dayjs = require('dayjs');

const createOutstandingChargesSection = (doc, invoiceDetails, preferenceSettings) => {
   const { outstandingInvoices } = invoiceDetails;
   const { boldFont, normalFont, bodyHeight, lineHeight, rightMargin, leftMargin, pageWidth, alignRight, endOfGroupingHeight } = preferenceSettings;

   const groupHeight = endOfGroupingHeight + bodyHeight;

   doc.font(boldFont).fontSize(14).text('Beginning Balance', leftMargin, groupHeight);

   doc.font(normalFont)
      .fontSize(12)
      .text('Invoice Date', leftMargin + 10, groupHeight + lineHeight)
      .text('Invoice', 200, groupHeight + lineHeight)
      .text('Original Amount', 400, groupHeight + lineHeight)
      .text('Outstanding', alignRight('Outstanding', 0), groupHeight + lineHeight);

   doc.lineCap('butt')
      .lineWidth(1)
      .moveTo(leftMargin, groupHeight + lineHeight * 2)
      .lineTo(pageWidth - rightMargin, groupHeight + lineHeight * 2)
      .stroke();

   const loopHeight = groupHeight + lineHeight * 2 + 10;

   outstandingInvoices.outstandingInvoiceRecords.forEach((outstandingRecord, index) => {
      const yHeight = loopHeight + lineHeight * index;

      doc.font(normalFont)
         .fontSize(12)
         .text(`${dayjs(outstandingRecord.invoice_date).format('MM/DD/YYYY')}`, leftMargin + 10, yHeight)
         .text(`${outstandingRecord.invoice_number}`, 200, yHeight)
         .text(`${Number(outstandingRecord.remaining_balance_on_invoice).toFixed(2)}`, 400, yHeight)
         .text(`${Number(outstandingRecord.remaining_balance_on_invoice).toFixed(2)}`, alignRight(`${Number(outstandingRecord.remaining_balance_on_invoice).toFixed(2)}`, 1), yHeight);

      // if last index draw line
      if (index === outstandingInvoices.outstandingInvoiceRecords.length - 1) {
         doc.lineCap('butt')
            .lineWidth(1)
            .moveTo(leftMargin, yHeight + lineHeight)
            .lineTo(pageWidth - rightMargin, yHeight + lineHeight)
            .stroke();

         doc.font(normalFont)
            .fontSize(12)
            .text(
               `Beginning Balance: ${outstandingInvoices.outstandingInvoiceTotal.toFixed(2)}`,
               alignRight(`Beginning Balance:  ${outstandingInvoices.outstandingInvoiceTotal.toFixed(2)}`, -3),
               yHeight + lineHeight * 1.5
            );

         preferenceSettings.endOfGroupingHeight = yHeight + lineHeight * 1.5;
      }
   });

   // if no outstanding invoices
   if (!outstandingInvoices.outstandingInvoiceRecords.length) {
      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(leftMargin, loopHeight + 10)
         .lineTo(pageWidth - rightMargin, loopHeight + 10)
         .stroke();

      doc.font(normalFont)
         .fontSize(12)
         .text('Beginning Balance: 0.00', alignRight('Beginning Balance: 0.00', 0), loopHeight + lineHeight);

      preferenceSettings.endOfGroupingHeight = loopHeight + lineHeight;
   }
};

module.exports = { createOutstandingChargesSection };
