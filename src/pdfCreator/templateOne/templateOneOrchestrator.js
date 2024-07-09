const stream = require('stream');
const PDFDocument = require('../pdfkit-tables');
const { createPdfHeader } = require('./templateFunctions/templateOneHeader');
const { createBillToSection } = require('./templateFunctions/templateOneBillTo');
const { createOutstandingChargesSection } = require('./templateFunctions/templateOneOutstandingCharges');
const { createPaymentsSection } = require('./templateFunctions/templateOnePayments');
const { createChargesSection } = require('./templateFunctions/templateOneTransactions');
const { createWriteOffsSection } = require('./templateFunctions/templateOneWriteOffs');
const { createRetainersSection } = require('./templateFunctions/templateOneRetainers');
const { createTotalsSection } = require('./templateFunctions/templateOneTotals');
const { createNotesSection } = require('./templateFunctions/templateOneNotes');

const createPDF = async invoiceDetails => {
   const { writeOffs, retainers } = invoiceDetails;

   const doc = new PDFDocument({ size: 'A3' });

   // Passing pdf through rather than saving to fs
   const buffers = [];
   const pdfStream = new stream.PassThrough();
   doc.pipe(pdfStream);

   pdfStream.on('data', data => {
      buffers.push(data);
   });

   const preferenceSettings = {
      boldFont: 'Helvetica-Bold',
      normalFont: 'Helvetica',
      headerHeight: doc.page.margins.top,
      bodyHeight: 300,
      lineHeight: 20,
      rightMargin: doc.page.margins.right,
      leftMargin: doc.page.margins.left,
      topMargin: doc.page.margins.top,
      bottomMargin: doc.page.margins.bottom,
      pageWidth: doc.page.width,
      pageHeight: doc.page.height,
      alignRight: (text, adjustment) => preferenceSettings.pageWidth - preferenceSettings.rightMargin - doc.widthOfString(text) - adjustment,
      endOfGroupingHeight: 0
   };

   createPdfHeader(doc, invoiceDetails, preferenceSettings);
   createBillToSection(doc, invoiceDetails, preferenceSettings);
   createOutstandingChargesSection(doc, invoiceDetails, preferenceSettings);
   createPaymentsSection(doc, invoiceDetails, preferenceSettings);
   createChargesSection(doc, invoiceDetails, preferenceSettings);
   writeOffs.writeOffRecords.length && createWriteOffsSection(doc, invoiceDetails, preferenceSettings);
   retainers.retainerRecords.length && createRetainersSection(doc, invoiceDetails, preferenceSettings);
   createTotalsSection(doc, invoiceDetails, preferenceSettings);
   createNotesSection(doc, invoiceDetails, preferenceSettings);

   doc.end();

   return new Promise((resolve, reject) => {
      pdfStream.on('end', () => {
         resolve(Buffer.concat(buffers));
      });
      pdfStream.on('error', reject);
   });
};

module.exports = { createPDF };
