/**
 * Account Audit ↔ billing-engine STATEMENT GATE (pure-function level).
 *
 * The engine pulls payments / write-offs with `created_at > newest parent
 * statement's created_at` (invoiceService.applyLastBillGate). Rows entered on
 * bill day BEFORE the run were already reflected on that statement; the old
 * `created_at >= invoice_date` gate re-fetched them for the next bill and
 * credited write-offs twice. The audit must apply the same gate so
 * audit_balance keeps matching the engine's invoiceTotal.
 *
 * Synthetic ledgers only — no DB.
 */
const { auditCustomerLedger } = require('../../../src/endpoints/accountAudit/account-audit-logic');

const customer = { customer_id: 7, display_name: 'Gate Test', is_customer_active: true };

const parent = (id, invoiceDate, createdAt, fields = {}) => ({
   customer_invoice_id: id,
   parent_invoice_id: null,
   invoice_number: `INV-${id}`,
   invoice_date: invoiceDate,
   due_date: invoiceDate,
   beginning_balance: 0,
   total_amount_due: 0,
   remaining_balance_on_invoice: 0,
   is_invoice_paid_in_full: false,
   notes: null,
   created_at: createdAt,
   ...fields
});
const snapshot = (id, parentId, invoiceDate, createdAt, remaining, fields = {}) => ({
   ...parent(id, invoiceDate, createdAt, fields),
   parent_invoice_id: parentId,
   invoice_number: `INV-${parentId}`,
   remaining_balance_on_invoice: remaining
});
const writeoff = (id, amount, createdAt, link = {}) => ({
   writeoff_id: id,
   writeoff_amount: amount,
   writeoff_date: String(createdAt).slice(0, 10),
   writeoff_reason: 'test',
   customer_invoice_id: null,
   customer_job_id: null,
   created_at: createdAt,
   ...link
});
const payment = (id, amount, createdAt, link = {}) => ({
   payment_id: id,
   payment_amount: amount,
   payment_date: String(createdAt).slice(0, 10),
   customer_invoice_id: null,
   retainer_id: null,
   created_at: createdAt,
   ...link
});
const txn = (id, amount, date, jobId, fields = {}) => ({
   transaction_id: id,
   total_transaction: amount,
   transaction_date: date,
   customer_job_id: jobId,
   customer_invoice_id: null,
   is_transaction_billable: true,
   ...fields
});

const audit = ({ invoices, payments = [], writeoffs = [], transactions = [], retainers = [] }) =>
   auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });

const linesSum = totals => Math.round(totals.audit_balance_lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;

// Month 1 statement (INV-10) absorbed by month 2 (INV-20, run 2026-05-01 17:00Z).
// A −25 write-off was entered on INV-10's chain at 08:00Z the same day, BEFORE
// the run: its snapshot (id 11) took INV-10 to 475, which INV-20 carried as its
// beginning balance, then absorption zeroed the month-1 rows.
const ABSORBED = '[absorbed_by:INV-20@2026-05-01]';
const month1 = [
   parent(10, '2026-04-01', '2026-04-01T17:00:00Z', { total_amount_due: 500, remaining_balance_on_invoice: 0, notes: ABSORBED }),
   snapshot(11, 10, '2026-04-01', '2026-05-01T08:00:00Z', 0, { total_amount_due: 500, notes: ABSORBED })
];
const month2 = parent(20, '2026-05-01', '2026-05-01T17:00:00Z', { beginning_balance: 475, total_amount_due: 475, remaining_balance_on_invoice: 475 });
const billDayWriteoff = writeoff(1, -25, '2026-05-01T08:00:00Z', { customer_invoice_id: 11 });

describe('auditCustomerLedger — statement gate (created_at vs newest statement row)', () => {
   describe('(a) bill-day entries made BEFORE the run are not re-credited', () => {
      it('an invoice-linked write-off entered before the parent row is already inside the statement', () => {
         const { totals } = audit({ invoices: [...month1, month2], writeoffs: [billDayWriteoff] });

         expect(totals.outstanding_invoices).to.equal(475);
         // The old `created_at >= invoice_date` gate credited it again → 450.
         expect(totals.audit_balance).to.equal(475);
         expect(totals.invoice_linked_writeoffs_recent).to.equal(0);
         expect(totals.last_bill_invoice_number).to.equal('INV-20');
         expect(totals.last_bill_created_at).to.equal('2026-05-01T17:00:00.000Z');
      });

      it('a job write-off entered minutes before the run is not netted again against the job\'s next work', () => {
         const jobWriteoff = writeoff(2, -18, '2026-05-01T16:58:00Z', { customer_job_id: 5 });
         const nextWork = txn(100, 100, '2026-05-10', 5);
         const { totals } = audit({ invoices: [...month1, month2], writeoffs: [jobWriteoff], transactions: [nextWork] });

         expect(totals.unbilled_billable_net).to.equal(100); // was 82 under the date gate
         expect(totals.job_writeoffs_netted).to.equal(0);
         expect(totals.unbilled_writeoffs).to.equal(0); // not pending either — it is history
         expect(totals.audit_balance).to.equal(575);
      });

      it('an unapplied payment entered before the run is not credited again (finalize stamped it onto the statement)', () => {
         const early = payment(1, -50, '2026-05-01T12:00:00Z');
         const { totals, discrepancies } = audit({ invoices: [...month1, month2], payments: [early] });

         expect(totals.unbilled_payments).to.equal(0);
         expect(totals.audit_balance).to.equal(475);
         // Still surfaced for cleanup.
         expect(discrepancies.map(d => d.kind)).to.include('unlinked_payments');
      });
   });

   describe('(b) entries made AFTER the run are next-bill items', () => {
      it('credits an absorbed-chain write-off, nets a job write-off, counts an unapplied payment', () => {
         const lateAbsorbedWriteoff = writeoff(3, -40, '2026-05-02T09:00:00Z', { customer_invoice_id: 11 });
         const lateJobWriteoff = writeoff(4, -10, '2026-05-02T09:00:00Z', { customer_job_id: 5 });
         const latePayment = payment(2, -60, '2026-05-05T15:00:00Z');
         const nextWork = txn(100, 100, '2026-05-10', 5);

         const { totals } = audit({
            invoices: [...month1, month2],
            writeoffs: [billDayWriteoff, lateAbsorbedWriteoff, lateJobWriteoff],
            payments: [latePayment],
            transactions: [nextWork]
         });

         expect(totals.invoice_linked_writeoffs_recent).to.equal(40);
         expect(totals.unbilled_billable_on_jobs).to.equal(100);
         expect(totals.job_writeoffs_netted).to.equal(10);
         expect(totals.unbilled_billable_net).to.equal(90);
         expect(totals.unbilled_payments).to.equal(60);
         // 475 + 100 − 10 − 60 − 40
         expect(totals.audit_balance).to.equal(465);
      });

      it('a row created exactly at the statement timestamp is still on that statement (strictly-after gate)', () => {
         const sameInstant = writeoff(5, -40, '2026-05-01T17:00:00Z', { customer_invoice_id: 11 });
         const { totals } = audit({ invoices: [...month1, month2], writeoffs: [sameInstant] });
         expect(totals.invoice_linked_writeoffs_recent).to.equal(0);
         expect(totals.audit_balance).to.equal(475);
      });

      it('single-count rule: a write-off on the CURRENT chain is already in its snapshot remaining', () => {
         const currentChainWriteoff = writeoff(6, -30, '2026-05-03T10:00:00Z', { customer_invoice_id: 21 });
         const month2Snapshot = snapshot(21, 20, '2026-05-01', '2026-05-03T10:00:00Z', 445, { total_amount_due: 475 });
         const { totals } = audit({ invoices: [...month1, month2, month2Snapshot], writeoffs: [currentChainWriteoff] });

         expect(totals.outstanding_invoices).to.equal(445);
         expect(totals.invoice_linked_writeoffs_recent).to.equal(0);
         expect(totals.audit_balance).to.equal(445);
      });

      it('a pending job write-off with no unbilled work on its job is credited as an adjustment-only line', () => {
         // Mirrors transactionCalculations.addAdjustmentOnlyJobGroups: it used to be
         // dropped (and lost once the gate moved on).
         const orphanJobWriteoff = writeoff(7, -15, '2026-05-04T10:00:00Z', { customer_job_id: 6 }); // job 6 has no unbilled work
         const { totals } = audit({ invoices: [...month1, month2], writeoffs: [orphanJobWriteoff] });

         expect(totals.adjustment_writeoffs).to.equal(15);
         expect(totals.job_writeoffs_netted).to.equal(0);
         expect(totals.audit_balance).to.equal(460);
         // Nothing is left pending, so the strict ledger equals the audit balance.
         expect(totals.unbilled_writeoffs).to.equal(0);
         expect(totals.strict_ledger_balance).to.equal(460);
      });

      it('a pending write-off linked to neither a job nor an invoice is credited too (engine groups it under a null job)', () => {
         const jobless = writeoff(11, -21.5, '2026-05-04T10:00:00Z');
         const nextWork = txn(100, 100, '2026-05-10', 5);
         const { totals } = audit({ invoices: [...month1, month2], writeoffs: [jobless], transactions: [nextWork] });

         expect(totals.adjustment_writeoffs).to.equal(21.5);
         expect(totals.unbilled_billable_net).to.equal(100); // not netted into job 5
         expect(totals.audit_balance).to.equal(553.5); // 475 + 100 − 21.50
      });

      it('no unbilled work + an absorbed-chain credit + a job write-off: each write-off is credited exactly once', () => {
         // The engine currently double counts this case (writeOffCalculations flips to
         // "show all" when there are no transactions, and addAdjustmentOnlyJobGroups
         // credits the job write-off again) — the audit must keep the single count so
         // drift-check surfaces it.
         const absorbedCredit = writeoff(13, -40, '2026-05-02T09:00:00Z', { customer_invoice_id: 11 });
         const jobWriteoff = writeoff(14, -15, '2026-05-02T09:00:00Z', { customer_job_id: 6 });
         const { totals } = audit({ invoices: [...month1, month2], writeoffs: [absorbedCredit, jobWriteoff] });

         expect(totals.invoice_linked_writeoffs_recent).to.equal(40);
         expect(totals.adjustment_writeoffs).to.equal(15);
         expect(totals.audit_balance).to.equal(420); // 475 − 40 − 15
      });

      it('an adjustment-only write-off entered BEFORE the run is not credited again', () => {
         const early = writeoff(12, -15, '2026-05-01T16:59:00Z', { customer_job_id: 6 });
         const { totals } = audit({ invoices: [...month1, month2], writeoffs: [early] });
         expect(totals.adjustment_writeoffs).to.equal(0);
         expect(totals.audit_balance).to.equal(475);
      });

      it('a customer never billed has no gate: every row is pending', () => {
         const { totals } = audit({
            invoices: [],
            payments: [payment(3, -20, '2020-01-01T00:00:00Z')],
            writeoffs: [writeoff(8, -5, '2020-01-01T00:00:00Z', { customer_job_id: 5 })],
            transactions: [txn(101, 70, '2020-01-01', 5)]
         });
         expect(totals.unbilled_payments).to.equal(20);
         expect(totals.job_writeoffs_netted).to.equal(5);
         expect(totals.audit_balance).to.equal(45);
         expect(totals.last_bill_created_at).to.equal(null);
      });
   });

   describe('(c) legacy same-day duplicate parents', () => {
      // Two statements on 2026-06-01 (runs at 17:00Z and 17:05Z). Chain 30 took a
      // −20 write-off between the runs (snapshot 32) and a −10 one the next day
      // (snapshot 33).
      const olderAbsorbed = parent(25, '2026-05-01', '2026-05-01T17:00:00Z', { total_amount_due: 300, notes: '[absorbed_by:INV-30@2026-06-01]' });
      const dupA = parent(30, '2026-06-01', '2026-06-01T17:00:00Z', { total_amount_due: 300, remaining_balance_on_invoice: 270 });
      const dupB = parent(31, '2026-06-01', '2026-06-01T17:05:00Z', { total_amount_due: 200, remaining_balance_on_invoice: 200 });
      const dupASnap1 = snapshot(32, 30, '2026-06-01', '2026-06-01T17:02:00Z', 280, { total_amount_due: 300 });
      const dupASnap2 = snapshot(33, 30, '2026-06-01', '2026-06-02T09:00:00Z', 270, { total_amount_due: 300 });
      const between = writeoff(9, -20, '2026-06-01T17:02:00Z', { customer_invoice_id: 32 });
      const nextDay = writeoff(10, -10, '2026-06-02T09:00:00Z', { customer_invoice_id: 33 });

      it('sums every parent on the newest date (latest snapshot each) and flags the duplicate', () => {
         const { totals, discrepancies } = audit({ invoices: [olderAbsorbed, dupA, dupB, dupASnap1, dupASnap2], writeoffs: [between, nextDay] });

         expect(totals.outstanding_invoices).to.equal(470); // 270 + 200
         expect(discrepancies.map(d => d.kind)).to.include('duplicate_same_day_parent_invoices');
      });

      it('write-offs on a same-day parent are single-counted (current chain), before or after the marker', () => {
         const { totals } = audit({ invoices: [olderAbsorbed, dupA, dupB, dupASnap1, dupASnap2], writeoffs: [between, nextDay] });

         expect(totals.invoice_linked_writeoffs_recent).to.equal(0);
         expect(totals.audit_balance).to.equal(470);
         // Marker = the later same-day run (created_at DESC before id DESC).
         expect(totals.last_bill_invoice_number).to.equal('INV-31');
      });

      it('an explicitly allowed same-day re-bill (first run absorbed by chain identity) is not a duplicate', () => {
         const firstRun = parent(50, '2026-07-01', '2026-07-01T17:00:00Z', { total_amount_due: 350, remaining_balance_on_invoice: 0, notes: '[absorbed_by:INV-51@2026-07-01]' });
         const rerun = parent(51, '2026-07-01', '2026-07-01T17:05:00Z', { beginning_balance: 350, total_amount_due: 350, remaining_balance_on_invoice: 350 });
         const { totals, discrepancies } = audit({ invoices: [firstRun, rerun] });
         const kinds = discrepancies.map(d => d.kind);

         expect(totals.outstanding_invoices).to.equal(350); // counted once
         expect(kinds).to.not.include('duplicate_same_day_parent_invoices');
         expect(kinds).to.not.include('invoice_remaining_drift');
      });

      it('the marker follows the engine ordering: invoice_date DESC, created_at DESC, customer_invoice_id DESC', () => {
         // Higher id but created EARLIER → not the marker.
         const laterRun = parent(40, '2026-06-01', '2026-06-01T17:10:00Z', { total_amount_due: 100, remaining_balance_on_invoice: 100 });
         const earlierRunHigherId = parent(41, '2026-06-01', '2026-06-01T17:05:00Z', { total_amount_due: 50, remaining_balance_on_invoice: 50 });
         const between = payment(4, -30, '2026-06-01T17:07:00Z');
         const { totals } = audit({ invoices: [laterRun, earlierRunHigherId], payments: [between] });

         expect(totals.last_bill_invoice_number).to.equal('INV-40');
         expect(totals.unbilled_payments).to.equal(0); // 17:07 is before the 17:10 marker
         expect(totals.outstanding_invoices).to.equal(150);
      });
   });

   describe('audit_balance_lines (what the PDF prints)', () => {
      it('always sums to audit_balance, and the job split reproduces unbilled_billable_net', () => {
         const scenarios = [
            audit({ invoices: [...month1, month2], writeoffs: [billDayWriteoff] }),
            audit({
               invoices: [...month1, month2],
               writeoffs: [billDayWriteoff, writeoff(3, -40.1, '2026-05-02T09:00:00Z', { customer_invoice_id: 11 }), writeoff(4, -10.35, '2026-05-02T09:00:00Z', { customer_job_id: 5 })],
               payments: [payment(2, -60.15, '2026-05-05T15:00:00Z')],
               transactions: [txn(100, 100.1, '2026-05-10', 5), txn(102, 0.2, '2026-05-11', 5), txn(103, 33.33, '2026-05-12', 9, { is_transaction_billable: false })]
            })
         ];
         scenarios.forEach(({ totals }) => {
            expect(linesSum(totals)).to.equal(totals.audit_balance);
            expect(Math.round((totals.unbilled_billable_on_jobs - totals.job_writeoffs_netted) * 100) / 100).to.equal(totals.unbilled_billable_net);
            expect(totals.strict_ledger_balance).to.equal(Math.round((totals.audit_balance - totals.unbilled_writeoffs) * 100) / 100);
         });
      });
   });
});

describe('auditCustomerLedger — retainer summary reads the LATEST snapshot', () => {
   const retainers = [
      // Chain A: fully drawn; the latest snapshot deactivated it, the root still says active.
      { retainer_id: 1, parent_retainer_id: null, starting_amount: -1000, current_amount: -1000, is_retainer_active: true, created_at: '2026-01-01T00:00:00Z' },
      { retainer_id: 2, parent_retainer_id: 1, starting_amount: -1000, current_amount: 0, is_retainer_active: false, created_at: '2026-02-01T00:00:00Z' },
      // Chain B: created inactive, later topped up / re-activated with $300 left.
      { retainer_id: 3, parent_retainer_id: null, starting_amount: -500, current_amount: -500, is_retainer_active: false, created_at: '2026-01-05T00:00:00Z' },
      { retainer_id: 4, parent_retainer_id: 3, starting_amount: -500, current_amount: -300, is_retainer_active: true, created_at: '2026-03-01T00:00:00Z' }
   ];

   it('uses the latest snapshot for both current_amount and is_retainer_active', () => {
      const { retainers: summary, totals } = audit({ invoices: [month2], retainers });
      const byId = new Map(summary.breakdown.map(b => [b.retainer_id, b]));

      expect(byId.get(1)).to.include({ current_amount: 0, is_active: false });
      expect(byId.get(3)).to.include({ current_amount: 300, is_active: true });
      expect(summary.active_chains).to.equal(1);
      expect(totals.retainer_available).to.equal(300);
      expect(totals.retainer_total_prepaid_lifetime).to.equal(1500);
      expect(totals.retainer_drawn).to.equal(1200);
      expect(totals.net_position_after_retainer).to.equal(475 - 300);
   });

   it('excludes a prepayment cancelled by an NSF reversal from prepaid and drawn totals', () => {
      // Chain C: the excess of a bounced overpayment. The reversal zeroed and
      // deactivated it and stamped the marker; starting_amount is kept so the
      // reversal can be undone. It never funded anything, so it is neither
      // prepaid nor drawn.
      const cancelled = {
         retainer_id: 5,
         parent_retainer_id: null,
         starting_amount: -200,
         current_amount: 0,
         is_retainer_active: false,
         note: 'Overpayment excess [cancelled by reversal of payment #77]',
         created_at: '2026-04-01T00:00:00Z'
      };
      const { retainers: summary, totals } = audit({ invoices: [month2], retainers: [...retainers, cancelled] });
      const byId = new Map(summary.breakdown.map(b => [b.retainer_id, b]));

      expect(byId.get(5)).to.include({ is_cancelled: true, cancelled_by_payment_id: 77, is_active: false, drawn_to_date: 0, starting_amount: 200, current_amount: 0 });
      expect(byId.get(1)).to.include({ is_cancelled: false, cancelled_by_payment_id: null });
      expect(summary.cancelled_chains).to.equal(1);
      expect(summary.total_chains).to.equal(3);
      expect(summary.active_chains).to.equal(1);
      expect(totals.retainer_available).to.equal(300);
      expect(totals.retainer_total_prepaid_lifetime).to.equal(1500);
      expect(totals.retainer_drawn).to.equal(1200);
   });
});

describe('auditCustomerLedger — retainer_drawn is what was consumed, not prepaid − available (round-3 B4)', () => {
   it('an inactive chain that still holds its full balance is unavailable but NOT drawn', () => {
      const retainers = [
         { retainer_id: 7, parent_retainer_id: null, starting_amount: -500, current_amount: -500, is_retainer_active: false, created_at: '2026-01-01T00:00:00Z' },
         { retainer_id: 8, parent_retainer_id: null, starting_amount: -200, current_amount: -50, is_retainer_active: true, created_at: '2026-02-01T00:00:00Z' }
      ];
      const { retainers: summary, totals } = audit({ invoices: [month2], retainers });
      const byId = new Map(summary.breakdown.map(b => [b.retainer_id, b]));
      expect(byId.get(7)).to.include({ is_active: false, drawn_to_date: 0, current_amount: 500 });
      expect(byId.get(8)).to.include({ is_active: true, drawn_to_date: 150 });
      expect(totals.retainer_available).to.equal(50);
      expect(totals.retainer_total_prepaid_lifetime).to.equal(700);
      expect(totals.retainer_drawn).to.equal(150);
      expect(summary.retainer_drawn).to.equal(summary.breakdown.reduce((s, b) => s + b.drawn_to_date, 0));
   });
});

describe('auditCustomerLedger — retainer snapshots order by exact timestamp (round-3 B2)', () => {
   it('a snapshot written 800µs after the root but with a lower id, plus a mid one with a higher id, sort by time not id', () => {
      const retainers = [
         { retainer_id: 30, parent_retainer_id: null, starting_amount: -500, current_amount: -500, is_retainer_active: true, created_at: '2026-06-01T10:00:00.123Z', created_at_exact: '2026-06-01 10:00:00.1231' },
         { retainer_id: 31, parent_retainer_id: 30, starting_amount: -500, current_amount: -400, is_retainer_active: true, created_at: '2026-06-01T10:00:00.123Z', created_at_exact: '2026-06-01 10:00:00.1235' },
         { retainer_id: 29, parent_retainer_id: 30, starting_amount: -500, current_amount: -300, is_retainer_active: true, created_at: '2026-06-01T10:00:00.123Z', created_at_exact: '2026-06-01 10:00:00.1239' }
      ];
      const { retainers: summary, totals } = audit({ invoices: [month2], retainers });
      const chain = summary.breakdown.find(b => b.retainer_id === 30);
      expect(chain).to.include({ current_amount: 300, drawn_to_date: 200, is_active: true });
      expect(totals.retainer_available).to.equal(300);
   });
});
