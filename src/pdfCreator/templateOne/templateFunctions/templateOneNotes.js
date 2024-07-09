const createNotesSection = (doc, invoiceDetails, preferenceSettings) => {
   const { invoiceNote, globalInvoiceNote, accountBillingInformation } = invoiceDetails;
   const { account_statement, account_interest_statement } = accountBillingInformation;
   const { normalFont, boldFont, lineHeight, leftMargin, pageWidth, bottomMargin, pageHeight, endOfGroupingHeight } = preferenceSettings;

   const groupHeight = endOfGroupingHeight;

   if (account_statement) {
      doc.font(normalFont)
         .fontSize(12)
         .text(account_statement, leftMargin + 10, groupHeight);
   }

   if (invoiceNote) {
      doc.font(boldFont)
         .fontSize(12)
         .text('Notes', leftMargin + 10, groupHeight + lineHeight * 2);

      doc.font(normalFont).fontSize(12);
      // Conditionally render globalInvoiceNote if it has content
      globalInvoiceNote.length > 0 && doc.text(globalInvoiceNote, leftMargin + 10, groupHeight + lineHeight * 3);
      // Conditionally set the y-position for invoiceNote
      doc.text(invoiceNote, leftMargin + 10, groupHeight + (globalInvoiceNote.length > 0 ? lineHeight * 4 : lineHeight * 3));
   }

   account_interest_statement.length > 0 &&
      doc
         .font(normalFont)
         .fontSize(8)
         .text(account_interest_statement, pageWidth / 2 - doc.widthOfString(account_interest_statement) / 2, pageHeight - bottomMargin - lineHeight);
};

module.exports = { createNotesSection };
