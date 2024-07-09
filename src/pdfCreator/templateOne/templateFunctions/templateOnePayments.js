const dayjs = require('dayjs');

const createPaymentsSection = (doc, invoiceDetails, preferenceSettings) => {
   const { payments } = invoiceDetails;
   const { boldFont, normalFont, lineHeight, rightMargin, leftMargin, pageWidth, alignRight, endOfGroupingHeight } = preferenceSettings;

   const groupHeight = endOfGroupingHeight + 25;

   doc.font(boldFont).fontSize(14).text('Payments', leftMargin, groupHeight);

   doc.font(normalFont)
      .fontSize(12)
      .text('Date', leftMargin + 10, groupHeight + lineHeight)
      .text('Invoice', 200, groupHeight + lineHeight)
      .text('Type', 350, groupHeight + lineHeight)
      .text('Reference', 450, groupHeight + lineHeight)
      .text('Amount', alignRight('Amount', 1), groupHeight + lineHeight);

   doc.lineCap('butt')
      .lineWidth(1)
      .moveTo(leftMargin, groupHeight + lineHeight * 2)
      .lineTo(pageWidth - rightMargin, groupHeight + lineHeight * 2)
      .stroke();

   const loopHeight = groupHeight + lineHeight * 2 + 10;

   payments.paymentRecords.forEach((paymentRecord, index) => {
      const yHeight = loopHeight + lineHeight * index;

      doc.font(normalFont)
         .fontSize(12)
         .text(`${dayjs(paymentRecord.payment_date).format('MM/DD/YYYY')}`, leftMargin + 10, yHeight)
         .text(`${paymentRecord.invoice_number || 'No Attached Invoice'}`, 200, yHeight)
         .text(paymentRecord.form_of_payment, 350, yHeight + 2)
         .text(paymentRecord.payment_reference_number, 450, yHeight + 2);

      doc.font(normalFont).fontSize(12).text(paymentRecord.payment_amount, alignRight(paymentRecord.payment_amount, 2), yHeight);

      // if last index draw line
      if (index === payments.paymentRecords.length - 1) {
         doc.lineCap('butt')
            .lineWidth(1)
            .moveTo(leftMargin, yHeight + lineHeight)
            .lineTo(pageWidth - rightMargin, yHeight + lineHeight)
            .stroke();

         doc.font(normalFont)
            .fontSize(12)
            .text(`Total Payments: ${payments.paymentTotal.toFixed(2)}`, alignRight(`Total Payments: ${payments.paymentTotal.toFixed(2)}`, 1), yHeight + lineHeight * 1.5);

         preferenceSettings.endOfGroupingHeight = yHeight + lineHeight * 1.5;
      }
   });

   // Condition for if there are no payments
   if (!payments.paymentRecords.length) {
      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(leftMargin, loopHeight + 10)
         .lineTo(pageWidth - rightMargin, loopHeight + 10)
         .stroke();

      doc.font(normalFont)
         .fontSize(12)
         .text('Total Payments: 0.00', alignRight('Total Payments: 0.00', 0), loopHeight + lineHeight);

      preferenceSettings.endOfGroupingHeight = loopHeight + lineHeight;
   }
};

module.exports = { createPaymentsSection };
