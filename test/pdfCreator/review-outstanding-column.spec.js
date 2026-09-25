const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPDF } = require('../../src/pdfCreator/templateOne/templateOneOrchestrator');
const { baseFixture, extractPdfText } = require('./_pdfFixtures');

describe('F39 accurately labeled beginning balance', () => {
   for (const [total, remaining] of [[100,60],[75,35]]) it(`prints the ${remaining} outstanding amount once for a ${total} partially paid or adjusted statement`, async () => {
      const invoice = baseFixture();
      invoice.outstandingInvoices = { outstandingInvoiceTotal: remaining, outstandingInvoiceRecords: [{
         customer_invoice_id: 2, parent_invoice_id: 1, invoice_number: 'INV-OLD', invoice_date: '2026-08-01',
         total_amount_due: total, remaining_balance_on_invoice: remaining
      }] };
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-f39-'));
      try {
         const text = extractPdfText(await createPDF(invoice), dir);
         expect(text).not.to.include('Original Amount');
         const row = text.split('\n').find(line => line.includes('INV-OLD'));
         expect(row).to.exist;
         expect(row.match(new RegExp(`${remaining}\\.00`, 'g'))).to.have.length(1);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
   });
});
