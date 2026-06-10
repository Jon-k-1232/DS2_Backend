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

         // Print the sum of the rows listed above. Invoice-applied payments are
         // already reflected in the Beginning Balance, so when any exist we say
         // so — printing the engine's uninvoiced-only total here (almost always
         // 0.00) made customers believe their payment was never recorded.
         const receivedTotal = Number(payments.paymentsReceivedTotal ?? payments.paymentTotal);
         const appliedToBalance = Math.abs(receivedTotal - payments.paymentTotal) > 0.009;
         const totalLine = `Total Payments Received: ${receivedTotal.toFixed(2)}${appliedToBalance ? ' (reflected in Beginning Balance above)' : ''}`;
         doc.font(normalFont)
            .fontSize(12)
            .text(totalLine, alignRight(totalLine, 1), yHeight + lineHeight * 1.5);

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
         .text('Total Payments Received: 0.00', alignRight('Total Payments Received: 0.00', 0), loopHeight + lineHeight);

      preferenceSettings.endOfGroupingHeight = loopHeight + lineHeight;
   }
};

module.exports = { createPaymentsSection };
