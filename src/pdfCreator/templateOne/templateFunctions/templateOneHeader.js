const createPdfHeader = (doc, invoiceDetails, preferenceSettings) => {
   const { invoiceNumber, accountBillingInformation, companyLogo } = invoiceDetails;
   const { account_name, account_street, account_city, account_state, account_zip, account_phone, account_email } = accountBillingInformation;
   const { boldFont, normalFont, headerHeight, rightMargin, leftMargin, pageWidth, alignRight } = preferenceSettings;
   doc.image(companyLogo, leftMargin, headerHeight, { width: 50 });

   const cityState = [account_city, account_state].filter(Boolean).join(', ');
   const lines = [account_name, account_street, [cityState, account_zip].filter(Boolean).join(' '),
      account_phone ? `Phone: ${account_phone}` : '', account_email ? `Email: ${account_email}` : ''].filter(Boolean);
   doc.font(normalFont).fontSize(12);
   lines.forEach((line, index) => doc.text(line, 140, headerHeight + index * 15));

   const title = Number(invoiceDetails.invoiceTotal) < 0 ? 'CREDIT STATEMENT' : 'INVOICE';
   doc.font(boldFont).fontSize(20).text(title, alignRight(title, 0), headerHeight);

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
