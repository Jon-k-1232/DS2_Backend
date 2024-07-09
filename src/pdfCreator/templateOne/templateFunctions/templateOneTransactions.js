const createChargesSection = (doc, invoiceDetails, preferenceSettings) => {
   const { transactions } = invoiceDetails;
   const { boldFont, normalFont, lineHeight, rightMargin, leftMargin, pageWidth, alignRight, endOfGroupingHeight } = preferenceSettings;

   const groupHeight = endOfGroupingHeight + 25;

   doc.font(boldFont).fontSize(14).text('Professional Services', leftMargin, groupHeight);

   doc.font(normalFont)
      .fontSize(12)
      .text('Job', leftMargin + 10, groupHeight + lineHeight)
      .text('Job Description', 200, groupHeight + lineHeight)
      .text('Charge', alignRight('Charge', 1), groupHeight + lineHeight);

   doc.lineCap('butt')
      .lineWidth(1)
      .moveTo(leftMargin, groupHeight + lineHeight * 2)
      .lineTo(pageWidth - rightMargin, groupHeight + lineHeight * 2)
      .stroke();

   const loopHeight = groupHeight + lineHeight * 2 + 10;

   transactions.transactionRecords.forEach((record, index) => {
      const yHeight = loopHeight + lineHeight * index;

      doc.font(normalFont)
         .fontSize(12)
         .text(record.jobID, leftMargin + 10, yHeight)
         .text(record.jobDescription, 200, yHeight)
         .text(record.jobTotal.toFixed(2), alignRight(`${record.jobTotal.toFixed(2)}`, 1), yHeight);

      if (index === transactions.transactionRecords.length - 1) {
         doc.lineCap('butt')
            .lineWidth(1)
            .moveTo(leftMargin, yHeight + lineHeight)
            .lineTo(pageWidth - rightMargin, yHeight + lineHeight)
            .stroke();

         doc.font(normalFont)
            .fontSize(12)
            .text(`Total New Charges: ${transactions.transactionsTotal.toFixed(2)}`, alignRight(`Total New Charges: ${transactions.transactionsTotal.toFixed(2)}`, 1), yHeight + lineHeight * 1.5);

         preferenceSettings.endOfGroupingHeight = yHeight + lineHeight * 1.5;
      }
   });

   // Condition for if there are no jobs
   if (!transactions.transactionRecords.length) {
      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(leftMargin, loopHeight + 10)
         .lineTo(pageWidth - rightMargin, loopHeight + 10)
         .stroke();

      doc.font(normalFont)
         .fontSize(12)
         .text('Total New Charges: 0.00', alignRight('Total New Charges: 0.00', 1), loopHeight + lineHeight);

      preferenceSettings.endOfGroupingHeight = loopHeight + lineHeight;
   }
};

module.exports = { createChargesSection };
