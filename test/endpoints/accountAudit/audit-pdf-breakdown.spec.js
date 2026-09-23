/**
 * Account Audit PDF — the "Audit balance breakdown" rows must add up to the
 * printed audit balance. They used to print outstanding + unbilled billable −
 * unbilled payments while audit_balance also netted job write-offs and
 * absorbed-chain write-off credits, so the section silently did not sum.
 */
const { auditBalanceBreakdownLines, strictLedgerStep, buildAuditPdf } = require('../../../src/endpoints/accountAudit/account-audit-pdf');
const { auditCustomerLedger } = require('../../../src/endpoints/accountAudit/account-audit-logic');

const sum = lines => Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;

describe('account-audit-pdf — audit balance breakdown', () => {
   it('prints the logic\'s audit_balance_lines verbatim when present, and they sum to audit_balance', () => {
      const totals = {
         audit_balance: 465,
         strict_ledger_balance: 450,
         unbilled_writeoffs: 15,
         audit_balance_lines: [
            { key: 'outstanding_invoices', label: 'Outstanding', amount: 475 },
            { key: 'unbilled_billable_on_jobs', label: 'Unbilled work', amount: 100 },
            { key: 'job_writeoffs_netted', label: 'Job write-offs netted', amount: -10 },
            { key: 'unbilled_payments', label: 'Payments', amount: -60 },
            { key: 'invoice_linked_writeoffs_recent', label: 'Absorbed-chain credits', amount: -40 }
         ]
      };
      const lines = auditBalanceBreakdownLines(totals);
      expect(lines.map(l => l.amount)).to.deep.equal([475, 100, -10, -60, -40]);
      expect(sum(lines)).to.equal(465);

      const step = strictLedgerStep(totals);
      expect(step).to.include({ auditBalance: 465, pendingWriteoffs: 15, strict: 450 });
      expect(step.pendingLabel).to.match(/Pending write-offs/);
   });

   it('rebuilds a legacy stored summary (no lines) and prints the unstored remainder explicitly', () => {
      // Pre-2026-09 summary: audit_balance included a $40 absorbed-chain credit
      // that was never stored as its own field.
      const legacy = { outstanding_invoices: 475, unbilled_billable: 100, unbilled_billable_net: 90, unbilled_payments: 60, audit_balance: 465, strict_ledger_balance: 300 };
      const lines = auditBalanceBreakdownLines(legacy);
      expect(lines.map(l => l.amount)).to.deep.equal([475, 90, -60, -40]);
      expect(lines[3].label).to.match(/Other adjustments/);
      expect(sum(lines)).to.equal(465);

      const step = strictLedgerStep(legacy);
      expect(step.pendingWriteoffs).to.equal(165);
      expect(step.pendingLabel).to.match(/legacy/);
   });

   it('adds no adjustment line when a legacy summary already sums', () => {
      const lines = auditBalanceBreakdownLines({ outstanding_invoices: 100, unbilled_billable: 50, unbilled_payments: 20, audit_balance: 130 });
      expect(lines).to.have.lengthOf(3);
      expect(sum(lines)).to.equal(130);
   });

   it('end-to-end: the lines of a real audit result sum to its audit_balance (cents included)', () => {
      const result = auditCustomerLedger({
         customer: { customer_id: 1, display_name: 'PDF Test' },
         invoices: [
            { customer_invoice_id: 1, parent_invoice_id: null, invoice_number: 'INV-1', invoice_date: '2026-04-01', total_amount_due: 333.33, remaining_balance_on_invoice: 0, notes: '[absorbed_by:INV-2@2026-05-01]', created_at: '2026-04-01T17:00:00Z' },
            { customer_invoice_id: 2, parent_invoice_id: null, invoice_number: 'INV-2', invoice_date: '2026-05-01', total_amount_due: 333.33, remaining_balance_on_invoice: 333.33, created_at: '2026-05-01T17:00:00Z' }
         ],
         payments: [{ payment_id: 1, payment_amount: -10.1, customer_invoice_id: null, payment_date: '2026-05-02', created_at: '2026-05-02T10:00:00Z' }],
         writeoffs: [
            { writeoff_id: 1, writeoff_amount: -0.7, customer_invoice_id: 1, writeoff_date: '2026-05-03', created_at: '2026-05-03T10:00:00Z' },
            { writeoff_id: 2, writeoff_amount: -5.55, customer_job_id: 9, customer_invoice_id: null, writeoff_date: '2026-05-03', created_at: '2026-05-03T10:00:00Z' }
         ],
         transactions: [
            { transaction_id: 1, total_transaction: 12.34, customer_job_id: 9, customer_invoice_id: null, is_transaction_billable: true, transaction_date: '2026-05-04' },
            { transaction_id: 2, total_transaction: 0.1, customer_job_id: 9, customer_invoice_id: null, is_transaction_billable: true, transaction_date: '2026-05-05' }
         ],
         retainers: []
      });
      const lines = auditBalanceBreakdownLines(result.totals);
      expect(sum(lines)).to.equal(result.totals.audit_balance);
      expect(lines.some(l => /Other adjustments/.test(l.label))).to.equal(false);
      // 333.33 + 12.44 − 5.55 − 10.10 − 0.70
      expect(result.totals.audit_balance).to.equal(329.42);
   });

   it('buildAuditPdf renders a PDF from a current summary', async () => {
      const result = auditCustomerLedger({
         customer: { customer_id: 1, display_name: 'PDF Test' },
         invoices: [{ customer_invoice_id: 2, parent_invoice_id: null, invoice_number: 'INV-2', invoice_date: '2026-05-01', total_amount_due: 100, remaining_balance_on_invoice: 100, created_at: '2026-05-01T17:00:00Z' }],
         payments: [],
         writeoffs: [],
         transactions: [],
         retainers: []
      });
      const pdf = await buildAuditPdf({
         audit: { audit_id: 1, created_at: new Date().toISOString(), run_by_display_name: 'Test', discrepancies: result.discrepancies, ledger: result.ledger },
         summary: { customer: result.customer, totals: result.totals, invoice_breakdown: result.invoice_breakdown, retainers: result.retainers, methodology: result.methodology }
      });
      expect(Buffer.isBuffer(pdf)).to.equal(true);
      expect(pdf.slice(0, 4).toString()).to.equal('%PDF');
   });
});
