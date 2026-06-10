/**
 * Rolling-balance payment-integrity rules (pure-function level).
 *
 * The 2026-06 incident: payments tagged to absorbed (rolled-forward) chains
 * were invisible to the billing engine, and invoice write-offs on the current
 * chain were counted twice. These specs pin the engine rules that prevent
 * both, plus the audit's absorption awareness.
 */
const { groupAndTotalWriteOffs } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations');
const { groupAndTotalPayments } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations');
const { auditCustomerLedger } = require('../../../src/endpoints/accountAudit/account-audit-logic');

const CUSTOMER_ID = 7;
const LAST_BILL = '2026-05-01';

const queryData = ({ writeoffs = [], payments = [], transactions = [] } = {}) => ({
   customerWriteOffs: { [CUSTOMER_ID]: writeoffs },
   customerPayments: { [CUSTOMER_ID]: payments },
   customerTransactions: { [CUSTOMER_ID]: transactions },
   lastInvoiceDateByCustomerID: { [CUSTOMER_ID]: LAST_BILL }
});

describe('groupAndTotalWriteOffs — single-count rule', () => {
   it('excludes current-chain write-offs from the engine total (already in the snapshot remaining)', () => {
      const currentChainWriteOff = { writeoff_id: 1, customer_invoice_id: 900, writeoff_amount: -200, linked_chain_invoice_date: LAST_BILL };
      const { writeOffTotal, writeOffsListedTotal, writeOffRecords } = groupAndTotalWriteOffs(CUSTOMER_ID, queryData({ writeoffs: [currentChainWriteOff] }), false);

      expect(writeOffTotal).to.equal(0);
      expect(writeOffsListedTotal).to.equal(-200);
      expect(writeOffRecords).to.have.length(1);
   });

   it('counts absorbed-chain write-offs as next-bill credits', () => {
      const absorbedChainWriteOff = { writeoff_id: 2, customer_invoice_id: 800, writeoff_amount: -150, linked_chain_invoice_date: '2026-03-01' };
      const { writeOffTotal } = groupAndTotalWriteOffs(CUSTOMER_ID, queryData({ writeoffs: [absorbedChainWriteOff], transactions: [{ customer_transaction_id: 1 }] }), false);

      expect(writeOffTotal).to.equal(-150);
   });

   it('treats unknown chain linkage and missing lastBillDate as credits (legacy behavior)', () => {
      const orphan = { writeoff_id: 3, customer_invoice_id: 700, writeoff_amount: -75, linked_chain_invoice_date: null };
      const data = queryData({ writeoffs: [orphan], transactions: [{ customer_transaction_id: 1 }] });
      expect(groupAndTotalWriteOffs(CUSTOMER_ID, data, false).writeOffTotal).to.equal(-75);

      data.lastInvoiceDateByCustomerID = {};
      expect(groupAndTotalWriteOffs(CUSTOMER_ID, data, false).writeOffTotal).to.equal(-75);
   });
});

describe('groupAndTotalPayments — received vs engine totals', () => {
   it('keeps invoice-tagged payments out of the engine total but in the received total', () => {
      const payments = [
         { payment_id: 1, customer_invoice_id: 901, payment_amount: -300, form_of_payment: 'Check' },
         { payment_id: 2, customer_invoice_id: null, payment_amount: -50, form_of_payment: 'Cash' }
      ];
      const { paymentTotal, paymentsReceivedTotal } = groupAndTotalPayments(CUSTOMER_ID, queryData({ payments }));

      expect(paymentTotal).to.equal(-50);
      expect(paymentsReceivedTotal).to.equal(-350);
   });
});

describe('auditCustomerLedger — absorption awareness', () => {
   const customer = { customer_id: CUSTOMER_ID, display_name: 'Test Customer' };
   const baseInvoice = {
      customer_invoice_id: 10,
      parent_invoice_id: null,
      invoice_number: 'INV-OLD',
      invoice_date: '2026-03-01',
      due_date: '2026-03-17',
      total_amount_due: 500,
      remaining_balance_on_invoice: 0,
      is_invoice_paid_in_full: false,
      created_at: '2026-03-01T08:00:00Z'
   };
   const newerInvoice = {
      customer_invoice_id: 20,
      parent_invoice_id: null,
      invoice_number: 'INV-NEW',
      invoice_date: LAST_BILL,
      due_date: '2026-05-17',
      total_amount_due: 700,
      beginning_balance: 500,
      remaining_balance_on_invoice: 700,
      is_invoice_paid_in_full: false,
      created_at: '2026-05-01T08:00:00Z'
   };

   const runAudit = oldInvoiceNotes =>
      auditCustomerLedger({
         customer,
         invoices: [{ ...baseInvoice, notes: oldInvoiceNotes }, newerInvoice],
         payments: [],
         writeoffs: [],
         transactions: [],
         retainers: []
      });

   it('suppresses drift/paid-flag noise for absorbed_by-marked zeroed chains', () => {
      const { discrepancies } = runAudit('[absorbed_by:INV-NEW@2026-05-01]');
      const kinds = discrepancies.map(d => d.kind);
      expect(kinds).to.not.include('invoice_remaining_drift');
      expect(kinds).to.not.include('paid_flag_mismatch_closed');
      expect(kinds).to.not.include('stale_parent_remaining');
   });

   it('still reports drift for unmarked zeroed chains', () => {
      const { discrepancies } = runAudit(null);
      const driftRows = discrepancies.filter(d => d.kind === 'invoice_remaining_drift' && d.invoice_number === 'INV-OLD');
      expect(driftRows).to.have.length(1);
      expect(driftRows[0].diff_amount).to.equal(500);
   });

   it('keeps the rolling-balance outstanding on the newest chain either way', () => {
      expect(runAudit('[absorbed_by:INV-NEW@2026-05-01]').totals.outstanding_invoices).to.equal(700);
      expect(runAudit(null).totals.outstanding_invoices).to.equal(700);
   });
});
