const createPdfHeader = (doc, invoiceDetails, preferenceSettings) => {
   const { invoiceNumber, accountBillingInformation, companyLogo } = invoiceDetails;
   const { account_name, account_street, account_city, account_state, account_zip, account_phone, account_email } = accountBillingInformation;
   const { boldFont, normalFont, headerHeight, rightMargin, leftMargin, pageWidth, alignRight } = preferenceSettings;
   const emailWidth = doc.widthOfString(account_email);

   doc.image(companyLogo, leftMargin, headerHeight, { width: 50 });

   doc.font(normalFont)
      .fontSize(12)
      .text(`${account_name}`, 140, headerHeight)
      .text(`${account_street}`, 140, headerHeight + 15)
      .text(`${account_city}, ${account_state} ${account_zip}`, 140, headerHeight + 30)
      .text(`Phone: ${account_phone}`, 140, headerHeight + 45)
      .text(`Email: ${account_email}`, 140, headerHeight + 60);

   doc.font(boldFont).fontSize(20).text('INVOICE', alignRight('INVOICE', 0), headerHeight);

   doc.font(normalFont)
      .fontSize(12)
      .text(`${invoiceNumber}`, alignRight(`${invoiceNumber}`, 1), headerHeight + 25, doc.widthOfString('INVOICE'));

   doc.lineCap('butt')
      .lineWidth(4)
      .moveTo(leftMargin, headerHeight + 90)
      .lineTo(pageWidth - rightMargin, headerHeight + 90)
      .stroke();
};

module.exports = { createPdfHeader };
