/**
 * Account Audit ↔ billing engine parity (2026-09 cross-review, findings 10 and 11).
 *
 * 10. created_at precision. The engine gates payments / write-offs INSIDE
 *     Postgres against the newest parent row (`created_at > (SELECT created_at
 *     FROM customer_invoices WHERE customer_invoice_id = <marker>)`), i.e. at
 *     timestamp(6) microsecond precision, and orders statements / snapshots by
 *     created_at in SQL. node-postgres Dates keep only milliseconds, so the audit
 *     disagreed for rows created in the statement's own millisecond. The audit
 *     service now also selects `created_at::text AS created_at_exact`.
 * 11. Issue-time payments. Finalize stamps the period's uninvoiced payments onto
 *     the NEW parent row, whose total_amount_due is already net of them. The
 *     per-invoice check subtracted them again (false invoice_remaining_drift).
 *
 * No database: rows are shaped exactly as the audit service returns them (a
 * millisecond Date in created_at plus Postgres' own text in created_at_exact),
 * and the engine side runs its real query builders / calculators.
 */
const pg = require('knex')({ client: 'pg' });
const { auditCustomerLedger } = require('../../../src/endpoints/accountAudit/account-audit-logic');
const accountAuditService = require('../../../src/endpoints/accountAudit/account-audit-service');
const invoiceService = require('../../../src/endpoints/invoice/invoice-service');
const { calculateInvoices } = require('../../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const { buildStampPlan, newInvoiceObject } = require('../../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator');

const CID = 7;
const customer = { customer_id: CID, display_name: 'Parity Test', is_customer_active: true };
const money = n => Math.round(Number(n) * 100) / 100;

// ── timestamp(6) as each side sees it ───────────────────────────────────────
const TS = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;
const parts = ts => {
   const m = TS.exec(ts);
   if (!m) throw new Error(`bad timestamp ${ts}`);
   return { secondMs: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), micros: Number((m[7] || '').padEnd(6, '0')) };
};
// created_at as node-postgres hands it back: a Date, truncated to the millisecond.
const pgDate = ts => {
   const { secondMs, micros } = parts(ts);
   return new Date(secondMs + Math.floor(micros / 1000));
};
// created_at::text as Postgres prints it: fractional trailing zeros dropped.
const pgText = ts => ts.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
// Postgres' own `a > b` on two timestamp(6) values (what the engine's SQL gate evaluates).
const pgAfter = (a, b) => {
   const pa = parts(a);
   const pb = parts(b);
   return pa.secondMs !== pb.secondMs ? pa.secondMs > pb.secondMs : pa.micros > pb.micros;
};
// A row exactly as account-audit-service returns it.
const dbRow = (ts, fields) => ({ ...fields, created_at: pgDate(ts), created_at_exact: pgText(ts) });

// The engine's real query builder, recorded instead of executed.
const captureEngineQueries = rows => {
   const captured = [];
   const record = qb => {
      qb.then = (resolve, reject) => {
         captured.push(qb.toSQL());
         return Promise.resolve(rows).then(resolve, reject);
      };
      return qb;
   };
   const db = (...args) => record(pg(...args));
   db.select = (...args) => record(pg.select(...args));
   db.raw = (...args) => pg.raw(...args);
   return { db, captured };
};

const engineData = ({ outstanding = [], payments = [], writeOffs = [], transactions = [], retainers = [], lastInvoiceDate } = {}) => ({
   lastInvoiceDateByCustomerID: lastInvoiceDate ? { [CID]: lastInvoiceDate } : {},
   customerOutstandingInvoices: { [CID]: outstanding },
   customerPayments: { [CID]: payments },
   customerRetainers: { [CID]: retainers },
   customerTransactions: { [CID]: transactions },
   customerWriteOffs: { [CID]: writeOffs }
});
const engineTotal = data => money(calculateInvoices([{ customer_id: CID, showWriteOffs: false }], data)[0].invoiceTotal);

const audit = ({ invoices, payments = [], writeoffs = [], transactions = [], retainers = [] }) =>
   auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });

const parentRow = (id, ts, fields = {}) =>
   dbRow(ts, {
      customer_invoice_id: id,
      parent_invoice_id: null,
      customer_id: CID,
      invoice_number: `INV-${id}`,
      invoice_date: ts.slice(0, 10),
      due_date: ts.slice(0, 10),
      beginning_balance: 0,
      total_amount_due: 100,
      remaining_balance_on_invoice: 100,
      is_invoice_paid_in_full: false,
      notes: null,
      ...fields
   });

describe('account-audit-service — exact created_at', () => {
   it('selects created_at::text AS created_at_exact for invoices, payments and write-offs', () => {
      ['getInvoices', 'getPayments', 'getWriteoffs'].forEach(fn => {
         const { sql } = accountAuditService[fn](pg, 1, CID).toSQL();
         expect(sql, fn).to.match(/^select \*, created_at::text AS created_at_exact from /);
      });
   });
});

describe('audit ↔ engine: created_at compared at microsecond precision (finding 10)', () => {
   const PARENT_TS = '2026-09-22 15:00:00.123100';
   const parent = parentRow(500, PARENT_TS);
   // What getLastInvoiceMarkersByCustomerID returns for it (a millisecond Date).
   const marker = { customer_id: CID, customer_invoice_id: 500, invoice_number: 'INV-500', invoice_date: '2026-09-22', created_at: pgDate(PARENT_TS) };
   const jobWriteoff = (id, ts) => dbRow(ts, { writeoff_id: id, customer_id: CID, writeoff_amount: -10, writeoff_date: '2026-09-22', writeoff_reason: 'probe', customer_invoice_id: null, customer_job_id: 42, job_description: 'Bookkeeping' });
   const unappliedPayment = (id, ts) => dbRow(ts, { payment_id: id, customer_id: CID, payment_amount: -25, payment_date: '2026-09-22', customer_invoice_id: null, retainer_id: null, form_of_payment: 'Check' });

   it('the engine gates inside Postgres against the marker row, binding its id — never a millisecond Date', async () => {
      for (const fn of ['getWriteOffsByCustomerID', 'getPaymentsByCustomerID']) {
         const { db, captured } = captureEngineQueries([]);
         await invoiceService[fn](db, 1, [CID], { [CID]: marker });
         const [{ sql, bindings }] = captured;
         expect(sql, fn).to.match(/"created_at" > \(SELECT ci_marker\.created_at FROM customer_invoices ci_marker WHERE ci_marker\.customer_invoice_id = \?\)/);
         expect(bindings, fn).to.deep.equal([1, CID, 500]);
         expect(bindings.some(b => b instanceof Date), fn).to.equal(false);
      }
   });

   it('parent …:00.123100, job write-off …:00.123900: the engine credits it on the next bill, and so does the audit', () => {
      const wo = jobWriteoff(1, '2026-09-22 15:00:00.123900');
      // node-postgres cannot tell the two apart — both are 15:00:00.123Z.
      expect(wo.created_at.getTime()).to.equal(parent.created_at.getTime());
      // Postgres can: the engine's SQL gate returns the row.
      const engineReturns = pgAfter('2026-09-22 15:00:00.123900', PARENT_TS);
      expect(engineReturns).to.equal(true);
      const engine = engineTotal(engineData({ outstanding: [parent], writeOffs: engineReturns ? [wo] : [], lastInvoiceDate: '2026-09-22' }));
      expect(engine).to.equal(90);

      const { totals } = audit({ invoices: [parent], writeoffs: [wo] });
      expect(totals.adjustment_writeoffs).to.equal(10); // was 0: "already on the statement"
      expect(totals.audit_balance).to.equal(engine);
   });

   it('an unapplied payment in the statement\'s millisecond but after its microsecond is a next-bill payment in both', () => {
      const pay = unappliedPayment(2, '2026-09-22 15:00:00.123900');
      expect(pgAfter('2026-09-22 15:00:00.123900', PARENT_TS)).to.equal(true);
      const engine = engineTotal(engineData({ outstanding: [parent], payments: [pay], lastInvoiceDate: '2026-09-22' }));
      expect(engine).to.equal(75);

      const { totals } = audit({ invoices: [parent], payments: [pay] });
      expect(totals.unbilled_payments).to.equal(25);
      expect(totals.audit_balance).to.equal(engine);
   });

   it('a row at the parent\'s exact microsecond, or earlier in the same millisecond, stays on the statement in both', () => {
      ['2026-09-22 15:00:00.123100', '2026-09-22 15:00:00.123050'].forEach((ts, i) => {
         const wo = jobWriteoff(10 + i, ts);
         const pay = unappliedPayment(20 + i, ts);
         expect(pgAfter(ts, PARENT_TS), ts).to.equal(false);
         const engine = engineTotal(engineData({ outstanding: [parent], lastInvoiceDate: '2026-09-22' }));
         const { totals } = audit({ invoices: [parent], writeoffs: [wo], payments: [pay] });
         expect(totals.adjustment_writeoffs, ts).to.equal(0);
         expect(totals.unbilled_payments, ts).to.equal(0);
         expect(totals.audit_balance, ts).to.equal(engine);
         expect(engine).to.equal(100);
      });
   });

   it('the newest statement follows the engine\'s ORDER BY created_at DESC to the microsecond, not the id tie-break', async () => {
      // Two same-day runs inside one millisecond; the LOWER id was created later.
      const later = parentRow(41, '2026-09-22 17:00:00.250900', { total_amount_due: 60, remaining_balance_on_invoice: 60 });
      const earlier = parentRow(42, '2026-09-22 17:00:00.250100', { total_amount_due: 40, remaining_balance_on_invoice: 40 });
      const { db, captured } = captureEngineQueries([]);
      await invoiceService.getLastInvoiceMarkersByCustomerID(db, 1, [CID]);
      expect(captured[0].sql).to.match(/order by customer_id, invoice_date DESC, created_at DESC, customer_invoice_id DESC/i);

      // Created between the two runs: before the engine's marker (INV-41), so not a next-bill payment.
      const between = unappliedPayment(3, '2026-09-22 17:00:00.250500');
      expect(pgAfter('2026-09-22 17:00:00.250500', '2026-09-22 17:00:00.250900')).to.equal(false);
      const { totals } = audit({ invoices: [later, earlier], payments: [between] });
      expect(totals.last_bill_invoice_number).to.equal('INV-41'); // the id tie-break picked INV-42
      expect(totals.unbilled_payments).to.equal(0);
      expect(totals.outstanding_invoices).to.equal(100); // same-day parents summed
   });

   it('a chain\'s latest snapshot is the one the engine reads first (created_at DESC to the microsecond)', () => {
      const root = parentRow(60, '2026-09-20 17:00:00', { total_amount_due: 100, remaining_balance_on_invoice: 40 });
      // Same millisecond; the higher id was created EARLIER.
      const newest = dbRow('2026-09-23 10:00:00.500900', { ...root, customer_invoice_id: 61, parent_invoice_id: 60, remaining_balance_on_invoice: 40 });
      const older = dbRow('2026-09-23 10:00:00.500100', { ...root, customer_invoice_id: 62, parent_invoice_id: 60, remaining_balance_on_invoice: 80 });
      // Engine: getOutstandingInvoices orders children created_at DESC, id DESC in SQL, then the parent.
      const engine = money(calculateInvoices([{ customer_id: CID, showWriteOffs: false }], engineData({ outstanding: [newest, older, root], lastInvoiceDate: '2026-09-20' }))[0].outstandingInvoices.outstandingInvoiceTotal);
      expect(engine).to.equal(40);

      const { totals, invoice_breakdown: [row] } = audit({ invoices: [root, older, newest] });
      expect(row.latest_snapshot_remaining).to.equal(40); // the id tie-break read 62's $80
      expect(totals.outstanding_invoices).to.equal(engine);
   });

   it('compares Postgres\' trimmed text and a zero-padded fraction as the same instant', () => {
      const statement = { ...parent, created_at_exact: '2026-09-22 15:00:00.123100' };
      const sameInstant = { ...unappliedPayment(4, '2026-09-22 15:00:00.123100'), created_at_exact: '2026-09-22 15:00:00.1231' };
      const { totals } = audit({ invoices: [statement], payments: [sameInstant] });
      expect(totals.unbilled_payments).to.equal(0);
   });

   it('rows without created_at_exact (synthetic) still compare at millisecond precision', () => {
      const strip = ({ created_at_exact, ...row }) => row;
      const { totals } = audit({ invoices: [strip(parent)], writeoffs: [strip(jobWriteoff(5, '2026-09-22 15:00:00.123900'))] });
      expect(totals.adjustment_writeoffs).to.equal(0); // same millisecond → not after the statement
   });
});

describe('per-invoice expected remaining: issue-time payments are inside total_amount_due (finding 11)', () => {
   const PARENT_ID = 700;
   const PARENT_TS = '2026-09-22 17:00:00.250000';
   const work = { transaction_id: 900, customer_id: CID, customer_job_id: 10, job_description: 'Bookkeeping', total_transaction: 100, is_transaction_billable: true, customer_invoice_id: null, transaction_date: '2026-09-05' };
   const retainerPayment = dbRow('2026-09-10 09:00:00.000100', {
      payment_id: 301,
      customer_id: CID,
      payment_amount: -30,
      payment_date: '2026-09-10',
      customer_invoice_id: null,
      retainer_id: 3,
      form_of_payment: 'Retainer'
   });
   const retainers = [
      { retainer_id: 3, parent_retainer_id: null, customer_id: CID, starting_amount: -500, current_amount: -500, is_retainer_active: true, created_at: '2026-09-01T10:00:00Z' },
      { retainer_id: 4, parent_retainer_id: 3, customer_id: CID, starting_amount: -500, current_amount: -470, is_retainer_active: true, created_at: '2026-09-10T09:00:00Z' }
   ];

   // Run the engine + finalize row builders, then return the ledger as the DB holds it afterwards.
   const finalizeFirstStatement = () => {
      const [calc] = calculateInvoices([{ customer_id: CID, showWriteOffs: false }], engineData({ payments: [retainerPayment], transactions: [{ ...work, retainer_id: 3 }], retainers }));
      const detail = { ...calc, invoiceNumber: `INV-${PARENT_ID}`, dueDate: '2026-10-22', lastInvoiceDate: undefined, customerContactInformation: { customer_info_id: 5, account_id: 1 } };
      const row = newInvoiceObject(detail, { [CID]: 'invoicing/x.zip' }, 9, '2026-09-22');
      const plan = buildStampPlan(detail);
      const parent = dbRow(PARENT_TS, { ...row, customer_invoice_id: PARENT_ID, notes: null });
      const payments = [retainerPayment].map(p => (plan.paymentIDs.includes(p.payment_id) ? { ...p, customer_invoice_id: PARENT_ID } : p));
      const transactions = [work].map(t => (plan.transactionIDs.includes(t.transaction_id) ? { ...t, customer_invoice_id: PARENT_ID } : t));
      return { calc, row, plan, parent, payments, transactions };
   };

   it('$100 of work less a $30 retainer payment received before the run: expected remaining $70, no discrepancy', () => {
      const { calc, row, plan, parent, payments, transactions } = finalizeFirstStatement();
      // The engine nets the payment into the statement and finalize stamps it onto the parent.
      expect(money(calc.payments.paymentTotal)).to.equal(-30);
      expect(money(calc.invoiceTotal)).to.equal(70);
      expect(row.total_amount_due).to.equal(70);
      expect(row.remaining_balance_on_invoice).to.equal(70);
      expect(plan.paymentIDs).to.deep.equal([301]);

      const { totals, invoice_breakdown: [inv], discrepancies } = audit({ invoices: [parent], payments, transactions, retainers });
      expect(inv).to.include({
         parent_total_amount_due: 70,
         expected_remaining: 70, // was 40: the $30 subtracted a second time
         actual_remaining_used: 70,
         paid_at_issue: 30,
         paid_against_invoice: 0,
         issue_time_payments_count: 1,
         linked_payments_count: 1
      });
      expect(discrepancies).to.deep.equal([]);
      expect(totals.audit_balance).to.equal(70);
   });

   it('a later payment on a snapshot still moves the remaining', () => {
      const { parent, payments, transactions } = finalizeFirstStatement();
      const snapshot = dbRow('2026-09-25 11:00:00.000200', { ...parent, customer_invoice_id: 701, parent_invoice_id: PARENT_ID, remaining_balance_on_invoice: 50 });
      const later = dbRow('2026-09-25 11:00:00.000300', { payment_id: 302, customer_id: CID, payment_amount: -20, payment_date: '2026-09-25', customer_invoice_id: 701, retainer_id: null, form_of_payment: 'Check' });
      const mirroredParent = { ...parent, remaining_balance_on_invoice: 50 };

      const { totals, invoice_breakdown: [inv], discrepancies } = audit({ invoices: [mirroredParent, snapshot], payments: [...payments, later], transactions, retainers });
      expect(inv).to.include({ expected_remaining: 50, actual_remaining_used: 50, paid_against_invoice: 20, paid_at_issue: 30, linked_payments_count: 2 });
      expect(discrepancies.map(d => d.kind)).to.not.include('invoice_remaining_drift');
      expect(totals.audit_balance).to.equal(50);
   });

   it('legacy: a payment linked straight to a parent but created AFTER it is still subtracted', () => {
      const parent = parentRow(710, '2026-06-01 17:00:00', { total_amount_due: 100, remaining_balance_on_invoice: 70 });
      const direct = dbRow('2026-06-03 10:00:00', { payment_id: 310, customer_id: CID, payment_amount: -30, payment_date: '2026-06-03', customer_invoice_id: 710, retainer_id: null, form_of_payment: 'Check' });
      const { invoice_breakdown: [inv], discrepancies } = audit({ invoices: [parent], payments: [direct] });
      expect(inv).to.include({ expected_remaining: 70, paid_against_invoice: 30, paid_at_issue: 0, issue_time_payments_count: 0 });
      expect(discrepancies.map(d => d.kind)).to.not.include('invoice_remaining_drift');
   });

   it('a stored remaining that subtracted the issue-time payment a second time is now reported, not mirrored', () => {
      // A 2024 statement in the prod snapshot has this shape: total $625 = $778 − $153
      // retainer payment (stamped on the parent), stored remaining $472.
      const parent = parentRow(720, '2024-10-16 09:10:58.102892', { total_amount_due: 625, remaining_balance_on_invoice: 472 });
      const stamped = dbRow('2024-05-31 13:01:48.269', { payment_id: 320, customer_id: CID, payment_amount: -153, payment_date: '2024-05-22', customer_invoice_id: 720, retainer_id: 1, form_of_payment: 'Retainer' });
      const { invoice_breakdown: [inv], discrepancies } = audit({ invoices: [parent], payments: [stamped] });
      expect(inv).to.include({ expected_remaining: 625, actual_remaining_used: 472, paid_at_issue: 153, paid_against_invoice: 0 });
      const drift = discrepancies.find(d => d.kind === 'invoice_remaining_drift');
      expect(drift).to.include({ diff_amount: 153, severity: 'medium' });
      expect(drift.detail).to.match(/\$153\.00 received before the statement was issued is already netted into its total/);
   });

   it('issue-time means created no later than the parent row, to the microsecond (the statement gate\'s boundary)', () => {
      const parent = parentRow(730, '2026-09-22 17:00:00.250100', { total_amount_due: 70, remaining_balance_on_invoice: 70 });
      const pay = (id, ts) => dbRow(ts, { payment_id: id, customer_id: CID, payment_amount: -30, payment_date: '2026-09-22', customer_invoice_id: 730, retainer_id: null, form_of_payment: 'Check' });

      const atParent = audit({ invoices: [parent], payments: [pay(330, '2026-09-22 17:00:00.250100')] }).invoice_breakdown[0];
      expect(atParent).to.include({ paid_at_issue: 30, paid_against_invoice: 0, expected_remaining: 70 });

      // Same millisecond, 800 µs after the parent row: not an issue-time payment.
      const afterParent = audit({ invoices: [parent], payments: [pay(331, '2026-09-22 17:00:00.250900')] }).invoice_breakdown[0];
      expect(afterParent).to.include({ paid_at_issue: 0, paid_against_invoice: 30, expected_remaining: 40 });
   });
});
