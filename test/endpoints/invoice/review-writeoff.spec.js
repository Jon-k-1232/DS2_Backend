const { calculateInvoices } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');

describe('F8 same-job invoice-linked write-offs', () => {
   for (const [chainDate, expected] of [['2026-08-01', 140], ['2026-07-01', 130]]) {
      it(`counts the ${chainDate} chain credit once in shown and hidden modes`, () => {
         const data = {
            lastInvoiceDateByCustomerID: { 7: '2026-08-01' },
            customerOutstandingInvoices: { 7: [{ customer_invoice_id: 8, invoice_number: 'INV-2026-00008', invoice_date: '2026-08-01', remaining_balance_on_invoice: 90 }] },
            customerTransactions: { 7: [{ customer_id: 7, customer_job_id: 10, total_transaction: 50, is_transaction_billable: true }] },
            customerWriteOffs: { 7: [{ customer_id: 7, customer_job_id: 10, customer_invoice_id: 8, writeoff_amount: -10, linked_chain_invoice_date: chainDate }] },
            customerPayments: {}, customerRetainers: {}
         };
         for (const showWriteOffs of [false, true]) {
            const [result] = calculateInvoices([{ customer_id: 7, showWriteOffs }], data);
            expect(result.invoiceTotal).to.equal(expected);
         }
      });
   }
});
