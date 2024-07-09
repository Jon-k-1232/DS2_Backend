const createRetainersSection = (doc, invoiceDetails, preferenceSettings) => {
   const { retainers } = invoiceDetails;
   const { boldFont, normalFont, lineHeight, rightMargin, leftMargin, pageWidth, alignRight, endOfGroupingHeight } = preferenceSettings;

   const groupHeight = endOfGroupingHeight + 25;

   doc.font(boldFont).fontSize(14).text('Retainers And Pre-Payments', leftMargin, groupHeight);

   doc.font(normalFont)
      .fontSize(12)
      .text('Type', leftMargin + 10, groupHeight + lineHeight)
      .text('Original Amount', 200, groupHeight + lineHeight)
      .text('Start Of Cycle Amount', alignRight('Start Of Cycle Amount', 1), groupHeight + lineHeight);

   doc.lineCap('butt')
      .lineWidth(1)
      .moveTo(leftMargin, groupHeight + lineHeight * 2)
      .lineTo(pageWidth - rightMargin, groupHeight + lineHeight * 2)
      .stroke();

   const loopHeight = groupHeight + lineHeight * 2 + 10;

   retainers.retainerRecords.forEach((record, index) => {
      const yHeight = loopHeight + lineHeight * index;

      doc.font(normalFont)
         .fontSize(12)
         .text(record.type_of_hold, leftMargin + 10, yHeight)
         .text(record.starting_amount, 200, yHeight)
         .text(record.current_amount, alignRight(record.current_amount, 1), yHeight);

      if (index === retainers.retainerRecords.length - 1) {
         doc.lineCap('butt')
            .lineWidth(1)
            .moveTo(leftMargin, yHeight + lineHeight)
            .lineTo(pageWidth - rightMargin, yHeight + lineHeight)
            .stroke();

         doc.font(normalFont)
            .fontSize(12)
            .text(
               `Retainer/ Pre-Payment Total: ${retainers.retainerTotal.toFixed(2)}`,
               alignRight(`Retainer/ Pre-Payment Total: ${retainers.retainerTotal.toFixed(2)}`, 1),
               yHeight + lineHeight * 1.5
            );

         doc.lineCap('butt')
            .lineWidth(1)
            .moveTo(475, groupHeight + lineHeight * 5)
            .lineTo(770, groupHeight + lineHeight * 5)
            .stroke();

         preferenceSettings.endOfGroupingHeight = yHeight + lineHeight * 1.7;
      }
   });

   // Condition for if there are no jobs
   if (!retainers.retainerRecords.length) {
      doc.lineCap('butt')
         .lineWidth(1)
         .moveTo(leftMargin, loopHeight + 10)
         .lineTo(pageWidth - rightMargin, loopHeight + 10)
         .stroke();

      doc.font(normalFont)
         .fontSize(12)
         .text('Retainer/ Pre-Payment Total: 0.00', alignRight('Retainer/ Pre-Payment Total: 0.00', 1), loopHeight + lineHeight);

      preferenceSettings.endOfGroupingHeight = loopHeight + lineHeight;
   }
};

module.exports = { createRetainersSection };
