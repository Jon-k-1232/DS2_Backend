const PDFDocument = require('pdfkit');
const { createNotesSection } = require('../../src/pdfCreator/templateOne/templateFunctions/templateOneNotes');

describe('F31 independent invoice notes', () => {
   for (const [individual, global] of [[undefined, 'Global message'], ['Individual message', undefined], ['Individual message', 'Global message'], [undefined, undefined]]) {
      it(`renders ${individual ? 'individual' : 'no individual'} and ${global ? 'global' : 'no global'} notes without error`, () => {
         const doc = new PDFDocument({ margin: 50 });
         doc.resume();
         const texts = [], original = doc.text;
         doc.text = function (value, ...args) { texts.push(String(value)); return original.call(this, value, ...args); };
         try {
            createNotesSection(doc, { invoiceNote: individual, globalInvoiceNote: global, accountBillingInformation: {} },
               { normalFont: 'Helvetica', boldFont: 'Helvetica-Bold', lineHeight: 16, leftMargin: 50, rightMargin: 50, pageWidth: 612, endOfGroupingHeight: 80 });
            if (individual) expect(texts).to.include(individual);
            if (global) expect(texts).to.include(global);
            expect(texts.filter(t => t === 'Notes')).to.have.length(individual || global ? 1 : 0);
         } finally { doc.end(); }
      });
   }
});
