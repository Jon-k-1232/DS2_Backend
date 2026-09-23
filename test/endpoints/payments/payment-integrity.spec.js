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

// ── ledger CRUD rules (2026-09 review) ──────────────────────────────────────
const {
   isCoveredByStatement,
   isLedgerRowBilled,
   ledgerRowBilledQuery,
   stripReversedMarker,
   parseReversalOf,
   parsePrepaymentRetainerId,
   parseOverpaymentExcess,
   preserveSystemMarkers,
   stripLinkMarkers,
   removeNoteMarker,
   cancelledByReversalMarker,
   parseCancelledByReversal
} = require('../../../src/endpoints/payments/ledger-helpers');
const { pickCurrentChainTarget, selectLiveChainTargets, updateObjectsWithRemainingAmounts, buildCreatePaymentInput } = require('../../../src/endpoints/payments/payment-logic');
const knex = require('knex')({ client: 'pg' });

describe('billed gate — newest statement created_at TIMESTAMP (not the statement DATE)', () => {
   const newestParent = { customer_invoice_id: 50, invoice_date: '2026-09-22', created_at: new Date('2026-09-22T15:00:00Z') };

   it('treats a row entered on bill day BEFORE the run as billed', () => {
      // The old gate compared against the DATE (midnight) and called this unbilled.
      expect(isCoveredByStatement(new Date('2026-09-22T09:30:00Z'), newestParent)).to.equal(true);
   });

   it('treats a row entered after the run (same day) as unbilled', () => {
      expect(isCoveredByStatement(new Date('2026-09-22T15:00:01Z'), newestParent)).to.equal(false);
   });

   it('treats the statement row itself (legacy payments linked to a parent) as billed', () => {
      expect(isCoveredByStatement(newestParent.created_at, newestParent)).to.equal(true);
   });

   it('never billed when the customer has no statement', () => {
      expect(isCoveredByStatement(new Date('2020-01-01T00:00:00Z'), undefined)).to.equal(false);
   });
});

describe('billed gate in SQL — microsecond-exact, same rule as the engine statement gate', () => {
   const explodingDb = { raw: () => Promise.reject(new Error('must not query')) };

   it('compares the two created_at columns inside Postgres, by exact row ids', () => {
      const { sql, bindings } = ledgerRowBilledQuery(knex, 1, { table: 'customer_writeoffs', id: 77 }, 50).toSQL();
      expect(sql).to.include('COALESCE(r.created_at <= np.created_at, false) AS billed');
      expect(sql).to.include('FROM "customer_writeoffs" AS r');
      expect(sql).to.include('np.customer_invoice_id = ?');
      expect(sql).to.include('"r"."writeoff_id" = ?');
      expect(bindings).to.deep.equal([50, 1, 77]);
      expect(ledgerRowBilledQuery(knex, 1, { table: 'customer_retainers_and_prepayments', id: 3 }, 50).toSQL().sql).to.include('"r"."retainer_id" = ?');
   });

   it('refuses tables that are not ledger rows (identifiers are never taken from input)', () => {
      expect(() => ledgerRowBilledQuery(knex, 1, { table: 'users', id: 1 }, 50)).to.throw('Unsupported ledger table');
   });

   it('nothing is billed for a customer without a statement (no query)', async () => {
      expect(await isLedgerRowBilled(explodingDb, 1, { table: 'customer_payments', id: 3 }, undefined)).to.equal(false);
      expect(await isLedgerRowBilled(explodingDb, 1, { table: 'customer_payments', id: 3 }, { customer_invoice_id: null })).to.equal(false);
   });

   it('reads the boolean Postgres returns', async () => {
      const fakeDb = billed => ({ raw: () => Promise.resolve({ rows: [{ billed }] }) });
      expect(await isLedgerRowBilled(fakeDb(true), 1, { table: 'customer_payments', id: 3 }, { customer_invoice_id: 50 })).to.equal(true);
      expect(await isLedgerRowBilled(fakeDb(false), 1, { table: 'customer_payments', id: 3 }, { customer_invoice_id: 50 })).to.equal(false);
   });

   it('the JS helper is millisecond-precision only (why the ledger gates no longer use it)', () => {
      // Postgres: .123900 > .123100 → NOT billed. JS Dates both read .123 → "covered".
      const parent = { created_at: new Date('2026-09-22T15:00:00.123Z') };
      expect(isCoveredByStatement(new Date('2026-09-22T15:00:00.123Z'), parent)).to.equal(true);
   });
});

describe('buildCreatePaymentInput — audit trail and link markers', () => {
   const form = { customerID: 7, selectedInvoiceID: 31, unitCost: 50, transactionDate: '2026-09-22', loggedByUserID: 90013, note: 'memo [retainer_draw:4] [pending_payment:9]' };

   it('the authenticated user is always the creator (the form value is caller-supplied)', () => {
      expect(buildCreatePaymentInput(form, 9001, 90011).paymentFields.created_by_user_id).to.equal(90011);
      expect(buildCreatePaymentInput(form, 9001, '90011').paymentFields.created_by_user_id).to.equal(90011);
   });

   it('internal callers without a request identity keep the form value', () => {
      expect(buildCreatePaymentInput(form, 9001).paymentFields.created_by_user_id).to.equal(90013);
      expect(buildCreatePaymentInput(form, 9001, null).paymentFields.created_by_user_id).to.equal(90013);
   });

   it('drops client-typed link markers and trusts the URL account', () => {
      const { paymentFields } = buildCreatePaymentInput({ ...form, accountID: 1 }, 9001, 90011);
      expect(paymentFields.note).to.equal('memo');
      expect(paymentFields.account_id).to.equal(9001);
   });

   it('A1: a forged legacy overpayment-split/-excess note cannot survive the public create mapper either', () => {
      const forged = { ...form, note: 'memo [overpayment split: $10.00 to ROUND3-OTHER, $50.00 to prepayment]' };
      expect(buildCreatePaymentInput(forged, 9001, 90011).paymentFields.note).to.equal('memo');

      const forgedExcess = { ...form, note: 'memo [overpayment excess from payment on ROUND3-OTHER]' };
      expect(buildCreatePaymentInput(forgedExcess, 9001, 90011).paymentFields.note).to.equal('memo');
   });
});

describe('selectLiveChainTargets — same-day re-bill absorbs the first statement', () => {
   const target = (id, remaining, { parentNotes = null, latestNotes = null } = {}) => ({
      parent: { customer_invoice_id: id, invoice_number: `INV-${id}`, notes: parentNotes },
      latestRow: { customer_invoice_id: id, notes: latestNotes },
      remaining
   });

   it('drops newest-date roots marked [absorbed_by:…] on the parent or the latest snapshot when a live root exists', () => {
      const absorbed = target(20, 0, { parentNotes: '[absorbed_by:INV-21@2026-09-22]' });
      const absorbedViaSnapshot = target(19, 0, { latestNotes: 'x [absorbed_by:INV-21@2026-09-22]' });
      const live = target(21, 100);
      expect(selectLiveChainTargets([live, absorbed, absorbedViaSnapshot]).map(t => t.parent.customer_invoice_id)).to.deep.equal([21]);
   });

   it('keeps genuinely independent legacy same-date roots (no marker) as multiple live targets', () => {
      expect(selectLiveChainTargets([target(31, 40), target(30, 60)]).map(t => t.parent.customer_invoice_id)).to.deep.equal([31, 30]);
   });

   // A5 (2026-09 review): every newest-date root marked absorbed is a ledger
   // inconsistency (the statement that supposedly absorbed them cannot be
   // found), not a "nothing changed" fallback — returning them as live targets
   // let new money post to an already-closed chain. Callers must refuse instead.
   it('A5: returns no targets when every root is marked absorbed (ledger inconsistency) so the caller refuses', () => {
      const all = [target(40, 0, { parentNotes: '[absorbed_by:X@2026-01-01]' }), target(41, 0, { parentNotes: '[absorbed_by:Y@2026-01-01]' })];
      expect(selectLiveChainTargets(all)).to.have.lengthOf(0);
   });

   it('a reference to the absorbed same-day statement is remapped to the live one', () => {
      const targets = selectLiveChainTargets([target(21, 100), target(20, 0, { parentNotes: '[absorbed_by:INV-21@2026-09-22]' })]);
      const { target: picked, remapped } = pickCurrentChainTarget(targets, { customer_invoice_id: 20, parent_invoice_id: null }, () => 'x');
      expect(remapped).to.equal(true);
      expect(picked.parent.customer_invoice_id).to.equal(21);
   });
});

describe('pickCurrentChainTarget — current-chain rule shared by payments and write-offs', () => {
   const target = (id, remaining) => ({ parent: { customer_invoice_id: id, invoice_number: `INV-${id}` }, latestRow: {}, remaining });

   it('keeps a reference to the current chain (parent or any of its snapshots)', () => {
      const targets = [target(20, 300)];
      expect(pickCurrentChainTarget(targets, { customer_invoice_id: 20, parent_invoice_id: null }, () => 'x').remapped).to.equal(false);
      expect(pickCurrentChainTarget(targets, { customer_invoice_id: 21, parent_invoice_id: 20 }, () => 'x').remapped).to.equal(false);
   });

   it('remaps an absorbed-chain reference to the current chain with the most remaining', () => {
      const { target: picked, remapped } = pickCurrentChainTarget([target(20, 100), target(22, 250)], { customer_invoice_id: 10, parent_invoice_id: null }, () => 'x');
      expect(remapped).to.equal(true);
      expect(picked.parent.customer_invoice_id).to.equal(22);
   });

   it('refuses the remap when the current chain has nothing remaining', () => {
      expect(() => pickCurrentChainTarget([target(20, 0)], { customer_invoice_id: 10, parent_invoice_id: null }, t => `nothing left on ${t.parent.invoice_number}`)).to.throw(
         'nothing left on INV-20'
      );
   });
});

describe('updateObjectsWithRemainingAmounts — snapshot math', () => {
   it('builds the snapshot from the chain latest row with a rounded remaining and paid flags', () => {
      const latest = { customer_invoice_id: 31, parent_invoice_id: 30, remaining_balance_on_invoice: '100.30', created_at: new Date(), customer_name: 'joined' };
      const { invoiceInsertionObject } = updateObjectsWithRemainingAmounts({ ...latest }, { payment_amount: -100.1 });
      expect(invoiceInsertionObject.remaining_balance_on_invoice).to.equal(0.2);
      expect(invoiceInsertionObject.is_invoice_paid_in_full).to.equal(false);
      expect(invoiceInsertionObject.parent_invoice_id).to.equal(30);
      expect(invoiceInsertionObject).to.not.have.property('customer_invoice_id');
      expect(invoiceInsertionObject).to.not.have.property('created_at');
      expect(invoiceInsertionObject).to.not.have.property('customer_name');
   });

   it('a first snapshot on a parent row points at that parent; paying it off sets the paid flags', () => {
      const parent = { customer_invoice_id: 30, parent_invoice_id: null, remaining_balance_on_invoice: '525.00' };
      const { invoiceInsertionObject } = updateObjectsWithRemainingAmounts({ ...parent }, { payment_amount: -525 });
      expect(invoiceInsertionObject.parent_invoice_id).to.equal(30);
      expect(invoiceInsertionObject.remaining_balance_on_invoice).to.equal(0);
      expect(invoiceInsertionObject.is_invoice_paid_in_full).to.equal(true);
      expect(invoiceInsertionObject.fully_paid_date).to.be.an.instanceOf(Date);
   });

   it('a positive (reversal) amount restores debt', () => {
      const latest = { customer_invoice_id: 32, parent_invoice_id: 30, remaining_balance_on_invoice: '0.00' };
      expect(updateObjectsWithRemainingAmounts({ ...latest }, { payment_amount: 400 }).invoiceInsertionObject.remaining_balance_on_invoice).to.equal(400);
   });
});

describe('payment note markers', () => {
   const before = 'paid in full plus extra [overpayment split: $400.00 to INV-2026-00002, $100.00 to prepayment] [prepayment_retainer:12]';
   const reason = 'NSF — check #1003 returned';

   it('deleting a reversal restores the original note exactly (so it can be reversed again)', () => {
      const reversed = `${before} [reversed 2026-09-22: ${reason}]`;
      expect(stripReversedMarker(reversed, reason)).to.equal(before);
   });

   it('an originally empty note comes back as null', () => {
      expect(stripReversedMarker(`[reversed 2026-09-22: ${reason}]`, reason)).to.equal(null);
   });

   it('strips the exact marker even when the reason contains a closing bracket', () => {
      const oddReason = 'bank code [R01] insufficient funds';
      expect(stripReversedMarker(`note [reversed 2026-09-22: ${oddReason}]`, oddReason)).to.equal('note');
   });

   it('parses the reversal link, the prepayment link and a legacy split excess', () => {
      expect(parseReversalOf(`[reversal of payment #42] ${reason}`)).to.deep.equal({ paymentId: 42, reason });
      expect(parseReversalOf('plain note')).to.equal(null);
      expect(parsePrepaymentRetainerId(before)).to.equal(12);
      expect(parsePrepaymentRetainerId('[prepayment — no open invoice at entry]')).to.equal(null);
      expect(parseOverpaymentExcess(before)).to.equal(100);
      expect(parseOverpaymentExcess('no split here')).to.equal(null);
   });

   it('a note edit cannot drop linkage markers', () => {
      expect(preserveSystemMarkers(before, 'corrected memo')).to.equal(
         'corrected memo [overpayment split: $400.00 to INV-2026-00002, $100.00 to prepayment] [prepayment_retainer:12]'
      );
      expect(preserveSystemMarkers(before, before)).to.equal(before);
      expect(preserveSystemMarkers('[reversed 2026-09-22: NSF] [pending_payment:7]', '')).to.equal('[reversed 2026-09-22: NSF] [pending_payment:7]');
      expect(preserveSystemMarkers(null, '')).to.equal(null);
      expect(preserveSystemMarkers('memo [retainer_draw:5]', 'new memo')).to.equal('new memo [retainer_draw:5]');
      expect(preserveSystemMarkers('Prepayment [overpayment excess from payment on INV-1] [cancelled by reversal of payment #7]', 'renamed')).to.equal(
         'renamed [overpayment excess from payment on INV-1] [cancelled by reversal of payment #7]'
      );
   });

   it('a note edit cannot ADD link markers (they would re-point a delete / restore at another row)', () => {
      expect(preserveSystemMarkers('memo [retainer_draw:5]', 'memo [retainer_draw:9] [prepayment_retainer:3]')).to.equal('memo [retainer_draw:5]');
      expect(preserveSystemMarkers(null, '[pending_payment:4] typed by hand')).to.equal('typed by hand');
      expect(preserveSystemMarkers(null, 'x [cancelled by reversal of payment #1]')).to.equal('x');
   });

   // A1 (2026-09 review): a legacy overpayment split/excess marker is a link
   // marker too (it lets the legacy fallback resolve to another receipt's
   // prepayment) — a note UPDATE must not be able to add one any more than it
   // can add [retainer_draw:N] etc. Genuine markers the stored note already
   // carries still survive an edit (unchanged behavior, covered above).
   it('A1: a note edit cannot ADD a forged overpayment-split/-excess marker the stored note does not already carry', () => {
      expect(preserveSystemMarkers('plain note', 'edited [overpayment split: $10.00 to ROUND3-OTHER, $999.00 to prepayment]')).to.equal('edited');
      expect(preserveSystemMarkers('plain note', 'edited [overpayment excess from payment on ROUND3-OTHER]')).to.equal('edited');
      // A DIFFERENT genuine marker already on the stored note is not replaced by a forged one typed over it.
      expect(preserveSystemMarkers('note [overpayment split: $400.00 to INV-1, $100.00 to prepayment] [prepayment_retainer:9]', 'edited [overpayment split: $10.00 to INV-9, $999.00 to prepayment]')).to.equal(
         'edited [overpayment split: $400.00 to INV-1, $100.00 to prepayment] [prepayment_retainer:9]'
      );
   });

   it('client-supplied notes lose every link marker on create; the core strips only the ones it writes', () => {
      expect(stripLinkMarkers('[retainer_draw:5] memo [pending_payment:3] tail [prepayment_retainer:2]')).to.equal('memo tail');
      expect(stripLinkMarkers('[retainer_draw:5]')).to.equal(null);
      expect(stripLinkMarkers('keep  my spacing ')).to.equal('keep  my spacing ');
      expect(stripLinkMarkers(undefined)).to.equal(undefined);
      expect(stripLinkMarkers(null)).to.equal(null);
      // pending approval appends [pending_payment:<id>] BEFORE createPaymentCore runs.
      expect(stripLinkMarkers('ocr [pending_payment:3] [retainer_draw:5]', ['retainer_draw', 'prepayment_retainer'])).to.equal('ocr [pending_payment:3]');
   });

   // ── A1 (2026-09 review): legacy overpayment-split/-excess text is a link marker too ──
   it('A1: a forged legacy overpayment-split/-excess marker is stripped from a client-supplied note like any other link marker', () => {
      const forged = 'memo [overpayment split: $10.00 to ROUND3-OTHER, $50.00 to prepayment] tail [overpayment excess from payment on ROUND3-OTHER]';
      expect(stripLinkMarkers(forged)).to.equal('memo tail');
   });

   it('cancelled-by-reversal marker round-trips and is removed exactly', () => {
      const marker = cancelledByReversalMarker(12);
      expect(marker).to.equal('[cancelled by reversal of payment #12]');
      expect(parseCancelledByReversal(`[overpayment excess from payment on INV-1] ${marker}`)).to.equal(12);
      expect(parseCancelledByReversal('[overpayment excess from payment on INV-1]')).to.equal(null);
      expect(removeNoteMarker(`[overpayment excess from payment on INV-1] ${marker}`, marker)).to.equal('[overpayment excess from payment on INV-1]');
      expect(removeNoteMarker(marker, marker)).to.equal(null);
      expect(removeNoteMarker(`a ${cancelledByReversalMarker(1)}`, cancelledByReversalMarker(12))).to.equal(`a ${cancelledByReversalMarker(1)}`);
   });
});
