const createWriteOffsSection = (doc, invoiceDetails, preferenceSettings) => {
   const { writeOffs } = invoiceDetails;
   const { boldFont, normalFont, lineHeight, rightMargin, leftMargin, pageWidth, alignRight, endOfGroupingHeight } = preferenceSettings;

   const groupHeight = endOfGroupingHeight + 25;

   doc.font(boldFont).fontSize(14).text('Revisions', leftMargin, groupHeight);

   doc.font(normalFont)
      .fontSize(12)
      .text('Type', leftMargin + 10, groupHeight + lineHeight)
      .text('Reason', 200, groupHeight + lineHeight)
      .text('Amount', alignRight('Amount', 1), groupHeight + lineHeight);

   doc.lineCap('butt')
      .lineWidth(1)
      .moveTo(leftMargin, groupHeight + lineHeight * 2)
      .lineTo(pageWidth - rightMargin, groupHeight + lineHeight * 2)
      .stroke();

   const loopHeight = groupHeight + lineHeight * 2 + 10;

   writeOffs.writeOffRecords.forEach((record, index) => {
      const yHeight = loopHeight + lineHeight * index;

      doc.font(normalFont)
         .fontSize(12)
         .text(record.transaction_type, leftMargin + 10, yHeight)
         .text(record.writeoff_reason, 200, yHeight)
         .text(record.writeoff_amount, alignRight(record.writeoff_amount, 1), yHeight);

      if (index === writeOffs.writeOffRecords.length - 1) {
         doc.lineCap('butt')
            .lineWidth(1)
            .moveTo(leftMargin, yHeight + lineHeight)
            .lineTo(pageWidth - rightMargin, yHeight + lineHeight)
            .stroke();

         doc.font(normalFont)
            .fontSize(12)
            .text(`Total Revisions: ${writeOffs.writeOffTotal.toFixed(2)}`, alignRight(`Total Revisions: ${writeOffs.writeOffTotal.toFixed(2)}`, 1), yHeight + lineHeight * 1.5);

         preferenceSettings.endOfGroupingHeight = yHeight + lineHeight * 1.5;
      }
   });

   // Condition for if there are no jobs
   if (!writeOffs.writeOffRecords.length) {
      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(leftMargin, loopHeight + 10)
         .lineTo(pageWidth - rightMargin, loopHeight + 10)
         .stroke();

      doc.font(normalFont)
         .fontSize(12)
         .text('Total Revisions: 0.00', alignRight('Total Revisions: 0.00', 1), loopHeight + lineHeight);

      preferenceSettings.endOfGroupingHeight = loopHeight + lineHeight;
   }
};

module.exports = { createWriteOffsSection };
