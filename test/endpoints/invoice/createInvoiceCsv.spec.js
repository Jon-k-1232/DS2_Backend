const { expect } = require('chai');
const { createCsvData } = require('../../../src/endpoints/invoice/createInvoiceCsv/createInvoiceCsv');

const customer = (id, displayName, totals = {}) => ({
   customer_id: id,
   customerContactInformation: { display_name: displayName },
   outstandingInvoices: { outstandingInvoiceTotal: totals.outstanding ?? 0 },
   payments: { paymentTotal: totals.payments ?? 0 },
   transactions: { transactionsTotal: totals.transactions ?? 0 },
   writeOffs: { writeOffTotal: totals.writeOffs ?? 0 },
   retainers: { retainerTotal: totals.retainers ?? 0 },
   invoiceTotal: totals.invoiceTotal ?? 0
});

describe('createInvoiceCsv (month-end CSV report)', () => {
   const lines = rows => createCsvData(rows).buffer.toString('utf8').split('\n');

   it('returns a csv buffer with the fixed header row and one line per customer', () => {
      const out = createCsvData([customer(1, 'Acme LLC', { invoiceTotal: 125.5 })]);
      expect(out.metadata).to.deep.equal({ type: 'csv', displayName: 'Monthly_CSV_Report' });
      const [header, row] = out.buffer.toString('utf8').split('\n');
      expect(header.split(',')[0]).to.equal('Customer ID');
      expect(header.split(',')).to.have.length(15);
      expect(row).to.equal('1,Acme LLC,0,0,0,0,0,125.5');
   });

   it('neutralises a customer name a spreadsheet would run as a formula', () => {
      const [, row] = lines([customer(7, '=HYPERLINK("http://evil.example","click")')]);
      expect(row.startsWith('7,')).to.equal(true);
      const nameCell = row.slice(2).split(',')[0];
      expect(nameCell.startsWith('"\'=') || nameCell.startsWith("'=")).to.equal(true, `name cell must not start with = : ${nameCell}`);
   });

   it('quotes a name containing commas instead of deleting them, and leaves numeric cells untouched', () => {
      const [, row] = lines([customer(9, 'Smith, Jones & Co', { payments: -225, invoiceTotal: 1042.75 })]);
      expect(row).to.equal('9,"Smith, Jones & Co",0,-225,0,0,0,1042.75');
   });
});
