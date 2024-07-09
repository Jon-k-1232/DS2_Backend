const dayjs = require('dayjs');

const createBillToSection = (doc, invoiceDetails, preferenceSettings) => {
   const { dueDate, customerContactInformation } = invoiceDetails;
   const { customer_street, customer_city, customer_state, customer_zip, customer_phone, business_name, customer_name } = customerContactInformation;
   const { normalFont, headerHeight, leftMargin, alignRight } = preferenceSettings;
   const invoiceRecipientName = business_name || customer_name;

   // Client details
   doc.fontSize(12)
      .font(normalFont)
      .text('Bill To:', leftMargin, headerHeight + 115)
      .text(invoiceRecipientName, 120, headerHeight + 115)
      .text(customer_street, 120, headerHeight + 135)
      .text(`${customer_city}, ${customer_state} ${customer_zip}`, 120, headerHeight + 155)
      .text(customer_phone, 120, headerHeight + 175)
      .text(`Statement Date:     ${dayjs().format('MM/DD/YYYY')}`, alignRight(`Payment Due Date: ${dueDate}`, +3), headerHeight + 115)
      .text(`Payment Due Date:     ${dueDate}`, alignRight(`Payment Due Date:      ${dueDate}`, +3), headerHeight + 135);
};

module.exports = { createBillToSection };
