const { createPDF } = require('../pdfCreator/templateOne/templateOneOrchestrator');

/**
 * Create pdf buffer and metadata for each invoice and save pdf to disk
 * @param {*} invoicesWithDetail- Array of objects- each object is an invoice
 * @returns {Object} - { pdfBuffer: [{},{}], fileLocation:'filePath' }
 */
const createPDFInvoices = async invoicesWithDetail => {
   try {
      return Promise.all(
         invoicesWithDetail.map(async invoice => {
            // Loop through invoices and create PDFs
            const buffer = await createPDF(invoice);
            customerName = invoice.customerContactInformation.display_name;

            return {
               buffer,
               metadata: {
                  customerID: invoice.customer_id,
                  type: 'pdf',
                  displayName: customerName.replace(/ /g, '_')
               }
            };
         })
      );
   } catch (error) {
      console.log(`Error creating and saving pdfs to disk: ${error.message}`);
      throw new Error('Error creating and saving pdfs to disk: ' + error.message);
   }
};

module.exports = { createPDFInvoices };
