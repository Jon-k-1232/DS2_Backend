const { incrementAnInvoiceOrQuote } = require('../../sharedInvoiceFunctions');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const addInvoiceDetails = (calculatedInvoices, invoiceQueryData, invoicesToCreateMap, accountBillingInformation, globalInvoiceNote) => {
   const filePath = accountBillingInformation?.account_company_logo;
   // Check if file exists. If not, set to no image file.
   const noImage = path.join(__dirname, '../../../../images/noImage.png');

   const companyLogo = fs.existsSync(filePath) ? fs.readFileSync(filePath) : fs.readFileSync(noImage);

   return calculatedInvoices.map((invoiceCalculation, i) => {
      const { customer_id, invoiceNote } = invoicesToCreateMap[invoiceCalculation.customer_id];
      const { lastInvoiceNumber, customerInformation } = invoiceQueryData;
      const startingInvoiceNumber = lastInvoiceNumber?.invoice_number || 'INV-2024-00000';

      const customerContactInformation = customerInformation[customer_id];
      const invoiceNumber = incrementAnInvoiceOrQuote(startingInvoiceNumber, i);
      const dueDate = dayjs().add(16, 'day').format('MM/DD/YYYY');

      return { invoiceNumber, dueDate, globalInvoiceNote, invoiceNote, accountBillingInformation, customerContactInformation, companyLogo, ...invoiceCalculation };
   });
};

module.exports = { addInvoiceDetails };
