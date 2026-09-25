/**
 * Pure unit tests for the billing-engine pieces changed in the 2026-09 review:
 *   - retainerCalculations: latest snapshot per chain, active non-zero only
 *   - totalInvoice: remaining retainer = current balance (no double-adding draws)
 *   - transactionValidation: decimals survive validation (no parseInt flooring)
 *   - invoiceEligibility: unbilled basis, newest-chain outstanding, billed_today
 *   - dataInsertionOrchestrator: stamp plan + parent row shape (due == remaining)
 */
process.env.S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'test-bucket';
process.env.S3_REGION = process.env.S3_REGION || 'us-east-1';
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost';

const { groupAndTotalRetainers } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations');
const { totalInvoice } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice');
const cleanAndValidateTransactionObject = require('../../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/transactionValidation');
const { _invoiceEligibilityPerCustomer: eligibility, _currentChainsSummary: chains } = require('../../../src/endpoints/invoice/invoiceEligibility/invoiceEligibility');
const { buildStampPlan, newInvoiceObject } = require('../../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator');
const { groupAndTotalTransactions } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations');
const { incrementAnInvoiceOrQuote } = require('../../../src/endpoints/invoice/sharedInvoiceFunctions');

const CID = 77;

describe('retainerCalculations — latest snapshot per chain', () => {
   const rows = [
      { retainer_id: 1, parent_retainer_id: null, customer_id: CID, starting_amount: -1000, current_amount: -1000, is_retainer_active: true, created_at: '2026-01-01T10:00:00Z' },
      { retainer_id: 5, parent_retainer_id: 1, customer_id: CID, starting_amount: -1000, current_amount: -800, is_retainer_active: true, created_at: '2026-02-01T10:00:00Z' },
      { retainer_id: 9, parent_retainer_id: 1, customer_id: CID, starting_amount: -1000, current_amount: -650, is_retainer_active: true, created_at: '2026-03-01T10:00:00Z' },
      // exhausted chain: latest snapshot is 0 → must not print
      { retainer_id: 2, parent_retainer_id: null, customer_id: CID, starting_amount: -300, current_amount: -300, is_retainer_active: true, created_at: '2026-01-05T10:00:00Z' },
      { retainer_id: 6, parent_retainer_id: 2, customer_id: CID, starting_amount: -300, current_amount: 0, is_retainer_active: false, created_at: '2026-01-20T10:00:00Z' }
   ];

   it('uses the newest snapshot balance, not the original starting amount', () => {
      const { retainerTotal, retainerRecords } = groupAndTotalRetainers(CID, { customerRetainers: { [CID]: rows } }, false);
      expect(retainerRecords).to.have.lengthOf(1);
      expect(retainerRecords[0].retainer_id).to.equal(9);
      expect(retainerTotal).to.equal(-650);
   });

   it('returns zero when hideRetainers is set', () => {
      expect(groupAndTotalRetainers(CID, { customerRetainers: { [CID]: rows } }, true)).to.deep.equal({ retainerTotal: 0, retainerRecords: [], events: [] });
   });
});

describe('totalInvoice — retainers are informational, never re-added', () => {
   const info = {
      payments: { paymentTotal: 0, retainerPaymentTotal: -200 },
      retainers: { retainerTotal: -800 },
      writeOffs: { writeOffTotal: -25 },
      transactions: { transactionsTotal: 1000 },
      transactionRetainerPayments: {},
      outstandingInvoices: { outstandingInvoiceTotal: 300 }
   };
   it('balance due excludes the retainer balance; pre-retainer subtotal adds back the period draws; remaining retainer is the current balance', () => {
      const result = totalInvoice(CID, info, false, false);
      expect(result.invoiceTotal).to.equal(1275);
      // $200 of the period's work was paid from the retainer → the bill before that draw was $1,475
      expect(result.preRetainerInvoiceTotal).to.equal(1475);
      expect(result.remainingRetainer).to.equal(-800);
      expect(result.retainerAppliedToInvoice).to.equal(-200);
   });
});

describe('transactionValidation — decimals are preserved', () => {
   const base = {
      transaction_id: 1, account_id: 1, customer_id: CID, customer_job_id: 3, retainer_id: null, customer_invoice_id: null,
      logged_for_user_id: 2, general_work_description_id: 4, detailed_work_description: 'x', transaction_date: '2026-09-01',
      transaction_type: 'Time', is_transaction_billable: true, is_excess_to_subscription: false, created_at: '2026-09-01T10:00:00Z',
      created_by_user_id: 2, note: null
   };
   it('keeps 0.25 h × $75 = $18.75 intact', () => {
      const out = cleanAndValidateTransactionObject({ ...base, quantity: 0.25, unit_cost: 75, total_transaction: 18.75 });
      expect(out.quantity).to.equal(0.25);
      expect(out.unit_cost).to.equal(75);
      expect(out.total_transaction).to.equal(18.75);
   });
   it('corrects numeric strings from Postgres to numbers without flooring', () => {
      const out = cleanAndValidateTransactionObject({ ...base, quantity: '1.50', unit_cost: '150.00', total_transaction: '225.00' });
      expect(out.quantity).to.equal(1.5);
      expect(out.total_transaction).to.equal(225);
   });
});

describe('invoiceEligibility — engine-consistent Create Invoice list', () => {
   const customer = { customer_id: CID, display_name: 'Acme' };
   const parent = (id, date, remaining, created) => ({ customer_invoice_id: id, parent_invoice_id: null, customer_id: CID, invoice_number: `INV-2026-${String(id).padStart(5, '0')}`, invoice_date: date, remaining_balance_on_invoice: remaining, created_at: created });
   const child = (id, parentId, date, remaining, created) => ({ customer_invoice_id: id, parent_invoice_id: parentId, customer_id: CID, invoice_number: `INV-2026-${String(parentId).padStart(5, '0')}`, invoice_date: date, remaining_balance_on_invoice: remaining, created_at: created });

   it('lists a customer whose only unbilled work is dated before the last statement (the engine bills it)', () => {
      const invoices = [parent(1, '2026-08-01', 0, '2026-08-01T20:00:00Z')];
      const transactions = [{ customer_id: CID, transaction_id: 9, customer_invoice_id: null, transaction_date: '2026-07-15', is_transaction_billable: true, total_transaction: 465 }];
      const rows = eligibility([customer], { [CID]: invoices }, { [CID]: transactions }, {}, {}, {}, '2026-09-22');
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].billable_transactions_total).to.equal(465);
      expect(rows[0].transaction_count).to.equal(1);
      expect(rows[0].billed_today).to.equal(false);
   });

   it('outstanding balance comes from the newest chain latest snapshot, not stale rolled-forward parents', () => {
      const invoices = [
         parent(1, '2026-06-01', 350, '2026-06-01T20:00:00Z'), // stale, never zeroed (legacy)
         parent(2, '2026-08-01', 500, '2026-08-01T20:00:00Z'),
         child(3, 2, '2026-08-01', 200, '2026-08-10T20:00:00Z') // after a $300 payment
      ];
      const [row] = eligibility([customer], { [CID]: invoices }, {}, {}, {}, {}, '2026-09-22');
      expect(row.outstanding_invoice_total).to.equal(200);
      expect(row.invoice_count).to.equal(1);
      expect(row.last_invoice_number).to.equal('INV-2026-00002');
   });

   it('sums same-day duplicate parents like the engine and flags billed_today', () => {
      const invoices = [parent(4, '2026-09-22', 800, '2026-09-22T09:00:00Z'), parent(5, '2026-09-22', 800, '2026-09-22T09:01:00Z')];
      const [row] = eligibility([customer], { [CID]: invoices }, {}, {}, {}, {}, '2026-09-22');
      expect(row.outstanding_invoice_total).to.equal(1600);
      expect(row.billed_today).to.equal(true);
   });

   it('drops a fully settled customer with nothing pending', () => {
      const invoices = [parent(1, '2026-08-01', 0, '2026-08-01T20:00:00Z')];
      const writeOffs = [{ customer_id: CID, writeoff_amount: -50, created_at: '2026-07-31T10:00:00Z' }]; // before the statement → already reflected
      expect(eligibility([customer], { [CID]: invoices }, {}, {}, { [CID]: writeOffs }, {}, '2026-09-22')).to.have.lengthOf(0);
   });

   it('keeps a settled customer who has a write-off entered after the statement (next-bill credit)', () => {
      const invoices = [parent(1, '2026-08-01', 0, '2026-08-01T20:00:00Z')];
      const writeOffs = [{ customer_id: CID, writeoff_amount: -50, created_at: '2026-08-01T21:00:00Z' }];
      const rows = eligibility([customer], { [CID]: invoices }, {}, {}, { [CID]: writeOffs }, {}, '2026-09-22');
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].write_off_count).to.equal(1);
   });

   it('currentChainsSummary returns nothing for a never-billed customer', () => {
      expect(chains([])).to.deep.equal({ newestParent: null, currentParents: [], outstandingTotal: 0, outstandingRecords: [] });
   });
});

describe('dataInsertionOrchestrator — stamp plan and parent row', () => {
   const invoice = {
      customer_id: CID,
      lastInvoiceDate: '2026-08-01',
      invoiceNumber: 'INV-2026-00010',
      dueDate: '10/08/2026',
      invoiceTotal: 1275.5,
      customerContactInformation: { customer_info_id: 5, account_id: 1 },
      outstandingInvoices: { outstandingInvoiceTotal: 300 },
      payments: { paymentTotal: 0, allPaymentRecords: [{ payment_id: 1, customer_invoice_id: 44 }, { payment_id: 2, customer_invoice_id: null }] },
      retainers: { retainerTotal: -800 },
      transactions: { transactionsTotal: 1000.5, allTransactionRecords: [{ transaction_id: 11, is_transaction_billable: true }, { transaction_id: 12, is_transaction_billable: false }] },
      writeOffs: { writeOffTotal: -25 }
   };

   it('stamps every listed transaction (billable or not), only uninvoiced payments, and records the absorbed chain roots', () => {
      const plan = buildStampPlan({ ...invoice, outstandingInvoices: { outstandingInvoiceTotal: 300, outstandingInvoiceRecords: [{ customer_invoice_id: 90, parent_invoice_id: 70 }, { customer_invoice_id: 71, parent_invoice_id: null }, { customer_invoice_id: 91, parent_invoice_id: 70 }] } });
      expect(plan.customer_id).to.equal(CID);
      expect(plan.transactionIDs).to.deep.equal([11, 12]);
      expect(plan.paymentIDs).to.deep.equal([2]);
      expect(plan.absorbedRootIDs).to.deep.equal([70, 71]);
      expect(plan.transactionSnapshot.map(t => t.transaction_id)).to.deep.equal([11, 12]);
   });

   it('writes total_amount_due == remaining == engine invoiceTotal, retainers informational, date-only dates', () => {
      const row = newInvoiceObject(invoice, { [CID]: 'invoicing/x.zip' }, 9, '2026-09-22');
      expect(row.invoice_date).to.equal('2026-09-22');
      expect(row.end_date).to.equal('2026-09-22');
      expect(row.total_amount_due).to.equal(1275.5);
      expect(row.remaining_balance_on_invoice).to.equal(1275.5);
      expect(row.total_retainers).to.equal(-800);
      expect(row.beginning_balance).to.equal(300);
      expect(row.is_invoice_paid_in_full).to.equal(false);
      expect(row.invoice_date).to.match(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.due_date).to.equal('2026-10-08');
      expect(row.start_date).to.equal('2026-08-01');
      expect(row.created_by_user_id).to.equal(9);
   });

   it('marks a zero statement paid at creation', () => {
      const row = newInvoiceObject({ ...invoice, invoiceTotal: 0 }, {}, 9);
      expect(row.is_invoice_paid_in_full).to.equal(true);
      expect(row.fully_paid_date).to.match(/^\d{4}-\d{2}-\d{2}$/);
   });
});

describe('transactionCalculations — job-only write-downs credit the customer even without new time', () => {
   const txn = { transaction_id: 1, customer_id: CID, customer_job_id: 10, job_description: 'Form 1040', total_transaction: 500, is_transaction_billable: true };
   const jobWriteOff = { writeoff_id: 5, customer_id: CID, customer_job_id: 20, customer_invoice_id: null, writeoff_amount: -25, job_description: 'Bookkeeping' };

   it('creates an adjustment-only group when the write-off job has no unbilled transactions (Show Write Offs unchecked)', () => {
      const result = groupAndTotalTransactions(CID, { customerTransactions: { [CID]: [txn] }, customerWriteOffs: { [CID]: [jobWriteOff] } }, false);
      expect(result.transactionsTotal).to.equal(475);
      const adj = result.transactionRecords.find(g => g.jobID === 20);
      expect(adj.jobWriteOffTotal).to.equal(-25);
      expect(adj.transactionRecords).to.deep.equal([]);
   });

   it('does not double count when Show Write Offs is checked (writeOffCalculations owns them then)', () => {
      const result = groupAndTotalTransactions(CID, { customerTransactions: { [CID]: [txn] }, customerWriteOffs: { [CID]: [jobWriteOff] } }, true);
      expect(result.transactionsTotal).to.equal(500);
   });

   it('folds the write-down into the job when that job has unbilled time', () => {
      const result = groupAndTotalTransactions(CID, { customerTransactions: { [CID]: [txn] }, customerWriteOffs: { [CID]: [{ ...jobWriteOff, customer_job_id: 10 }] } }, false);
      expect(result.transactionsTotal).to.equal(475);
      expect(result.transactionRecords).to.have.lengthOf(1);
   });

   it('ignores invoice-linked write-offs here (they are statement credits, not job write-downs)', () => {
      const result = groupAndTotalTransactions(CID, { customerTransactions: { [CID]: [txn] }, customerWriteOffs: { [CID]: [{ ...jobWriteOff, customer_invoice_id: 77 }] } }, false);
      expect(result.transactionsTotal).to.equal(500);
   });
});

describe('sharedInvoiceFunctions.incrementAnInvoiceOrQuote — billing year and overflow', () => {
   it('continues the sequence within the billing year and restarts in a new year', () => {
      expect(incrementAnInvoiceOrQuote('INV-2026-00304', 0, 2026)).to.equal('INV-2026-00305');
      expect(incrementAnInvoiceOrQuote('INV-2026-00304', 2, 2026)).to.equal('INV-2026-00307');
      expect(incrementAnInvoiceOrQuote('INV-2025-00402', 0, 2026)).to.equal('INV-2026-00001');
      expect(incrementAnInvoiceOrQuote('INV-2026-00000', 0, 2026)).to.equal('INV-2026-00001');
   });
   it('refuses to overflow five digits', () => {
      expect(() => incrementAnInvoiceOrQuote('INV-2026-99999', 0, 2026)).to.throw(/exhausted/);
   });
});

describe('calculateInvoices — one effective Show Write Offs flag for every calculator', () => {
   const { calculateInvoices, effectiveShowWriteOffs } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
   const data = {
      lastInvoiceDateByCustomerID: { [CID]: '2026-08-01' },
      customerOutstandingInvoices: { [CID]: [] },
      customerPayments: { [CID]: [] },
      customerRetainers: { [CID]: [] },
      customerTransactions: { [CID]: [] },
      customerWriteOffs: {
         [CID]: [
            { writeoff_id: 1, customer_id: CID, customer_job_id: 20, customer_invoice_id: null, writeoff_amount: -15, job_description: 'Bookkeeping' },
            { writeoff_id: 2, customer_id: CID, customer_job_id: null, customer_invoice_id: 44, writeoff_amount: -55, linked_chain_invoice_date: '2026-07-01' }
         ]
      }
   };
   it('no unbilled work + pending invoice credit → shown mode for all calculators, each write-off counted once', () => {
      expect(effectiveShowWriteOffs({ customer_id: CID, showWriteOffs: false }, data)).to.equal(true);
      const [calc] = calculateInvoices([{ customer_id: CID, showWriteOffs: false }], data);
      expect(calc.invoiceTotal).to.equal(-70);
      expect(calc.transactions.transactionsTotal).to.equal(0);
      expect(calc.writeOffs.writeOffTotal).to.equal(-70);
   });
   it('unassigned (no job, no invoice) write-offs are credited as a general credit exactly once', () => {
      const d = { ...data, customerWriteOffs: { [CID]: [{ writeoff_id: 3, customer_id: CID, customer_job_id: null, customer_invoice_id: null, writeoff_amount: -10 }] }, customerTransactions: { [CID]: [{ transaction_id: 1, customer_id: CID, customer_job_id: 10, job_description: 'x', total_transaction: 100, is_transaction_billable: true }] } };
      const [calc] = calculateInvoices([{ customer_id: CID, showWriteOffs: false }], d);
      expect(calc.invoiceTotal).to.equal(90);
      const general = calc.transactions.transactionRecords.find(g => g.jobID === null);
      expect(general.jobDescription).to.equal('General credit');
   });
});

describe('retainerCalculations — snapshot ordering keeps Postgres microseconds (round-3 B2)', () => {
   // Root at .123100, draw snapshot at .123900: same millisecond, different
   // microseconds, and the newer row has the LOWER id. SQL says the draw is the
   // latest; a millisecond Date tie broken by id picked the root.
   const rows = [
      { retainer_id: 20, parent_retainer_id: null, customer_id: CID, starting_amount: -500, current_amount: -500, is_retainer_active: true, created_at: '2026-06-01T10:00:00.123Z', created_at_exact: '2026-06-01 10:00:00.1231' },
      { retainer_id: 15, parent_retainer_id: 20, customer_id: CID, starting_amount: -500, current_amount: -300, is_retainer_active: true, created_at: '2026-06-01T10:00:00.123Z', created_at_exact: '2026-06-01 10:00:00.1239' }
   ];

   it('uses created_at_exact when present: the .1239 snapshot wins over the .1231 root despite its lower id', () => {
      const { retainerTotal, retainerRecords } = groupAndTotalRetainers(CID, { customerRetainers: { [CID]: rows } }, false);
      expect(retainerRecords.map(r => r.retainer_id)).to.deep.equal([15]);
      expect(retainerTotal).to.equal(-300);
   });

   it('is independent of input order', () => {
      const reversed = [...rows].reverse();
      const { retainerTotal } = groupAndTotalRetainers(CID, { customerRetainers: { [CID]: reversed } }, false);
      expect(retainerTotal).to.equal(-300);
   });

   it('breaks an exact timestamp tie by retainer_id, and falls back to ms + id without exact text', () => {
      const tie = rows.map(r => ({ ...r, created_at_exact: '2026-06-01 10:00:00.1234' }));
      expect(groupAndTotalRetainers(CID, { customerRetainers: { [CID]: tie } }, false).retainerRecords[0].retainer_id).to.equal(20);
      const noExact = rows.map(({ created_at_exact, ...r }) => r);
      // Same millisecond, no microseconds available → higher id is treated as later.
      expect(groupAndTotalRetainers(CID, { customerRetainers: { [CID]: noExact } }, false).retainerRecords[0].retainer_id).to.equal(20);
      const laterMs = noExact.map(r => (r.retainer_id === 15 ? { ...r, created_at: '2026-06-01T10:00:00.124Z' } : r));
      expect(groupAndTotalRetainers(CID, { customerRetainers: { [CID]: laterMs } }, false).retainerRecords[0].retainer_id).to.equal(15);
   });
});


describe('credit classification uses the same cents as persistence and PDFs',()=>{
 it('does not mistake binary floating point residue for a negative credit',()=>{
  const {totalInvoice}=require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice');
  const result=totalInvoice(1,{payments:{paymentTotal:-.3,retainerPaymentTotal:0},transactions:{transactionsTotal:.2},outstandingInvoices:{outstandingInvoiceTotal:.1},writeOffs:{writeOffTotal:0},retainers:{retainerTotal:0}});
  expect(result.invoiceTotal).to.equal(0);expect(result.preRetainerInvoiceTotal).to.equal(0);
 });
});
