// Independent audit engine.
//
// This intentionally does NOT share code with invoice-service / postInvoiceCreation.
// The whole point of an audit is to recompute from raw rows and report any
// disagreement with the values the app already shows. If we reused the app's
// helpers, the audit could not detect drift caused by those helpers.

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const abs = n => Math.abs(Number(n) || 0);
const num = n => Number(n) || 0;

const fmtDate = d => {
   if (!d) return null;
   const dt = d instanceof Date ? d : new Date(d);
   if (Number.isNaN(dt.getTime())) return null;
   return dt.toISOString().slice(0, 10);
};

const fmtDateTime = d => {
   if (!d) return null;
   const dt = d instanceof Date ? d : new Date(d);
   if (Number.isNaN(dt.getTime())) return null;
   return dt.toISOString();
};

const toMs = d => {
   if (d === null || d === undefined || d === '') return null;
   const t = (d instanceof Date ? d : new Date(d)).getTime();
   return Number.isNaN(t) ? null : t;
};

// ── created_at at the engine's precision ────────────────────────────────────
// Postgres stores created_at to the MICROSECOND and the billing engine compares
// it inside SQL (applyLastBillGate: `created_at > (SELECT created_at FROM
// customer_invoices WHERE customer_invoice_id = <newest parent>)`, and ORDER BY
// created_at for the newest statement / latest snapshot). node-postgres hands
// the column back as a JS Date, which keeps only MILLISECONDS, so comparing
// Dates here disagreed with the engine for rows created in the same millisecond
// as the statement row: parent …:00.123100, write-off …:00.123900 → the engine
// credits it on the next bill, the audit called it already billed.
// account-audit-service therefore also selects `created_at::text AS
// created_at_exact` for invoices, payments and write-offs. Postgres prints a
// timestamp as 'YYYY-MM-DD HH24:MI:SS' plus up to six fractional digits with
// trailing zeros dropped; padding the fraction to six digits yields a
// fixed-width key whose string order is time order. When either row lacks the
// field (synthetic rows in unit tests) the comparison falls back to the Dates.
const EXACT_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/;
const exactCreatedAt = row => {
   const raw = row ? row.created_at_exact : null;
   if (typeof raw !== 'string') return null;
   const m = EXACT_TIMESTAMP.exec(raw.trim());
   return m ? `${m[1]} ${m[2]}.${(m[3] || '').padEnd(6, '0')}` : null;
};
const hasCreatedAt = row => exactCreatedAt(row) !== null || toMs(row ? row.created_at : null) !== null;

/**
 * Sign of (a.created_at − b.created_at) → -1 / 0 / 1, or null when either row
 * has no created_at. Microsecond-exact when both rows carry created_at_exact.
 */
const compareCreatedAt = (a, b) => {
   const ea = exactCreatedAt(a);
   const eb = exactCreatedAt(b);
   if (ea !== null && eb !== null) return ea === eb ? 0 : ea < eb ? -1 : 1;
   const ma = toMs(a ? a.created_at : null);
   const mb = toMs(b ? b.created_at : null);
   if (ma === null || mb === null) return null;
   return Math.sign(ma - mb);
};

// ORDER BY created_at ASC exactly as Postgres sorts it: a NULL created_at is the
// largest value (ASC NULLS LAST, DESC NULLS FIRST). Swap the arguments for DESC.
const createdAtAsc = (a, b) => {
   const cmp = compareCreatedAt(a, b);
   if (cmp !== null) return cmp;
   const aMissing = !hasCreatedAt(a);
   const bMissing = !hasCreatedAt(b);
   if (aMissing === bMissing) return 0;
   return aMissing ? 1 : -1;
};

// A statement (parent) row, exactly as the billing engine defines one in
// getLastInvoiceDatesByCustomerID / getLastInvoiceMarkersByCustomerID:
// parent_invoice_id IS NULL, or a legacy self-referencing row.
const isStatementRow = i => !i.parent_invoice_id || Number(i.parent_invoice_id) === Number(i.customer_invoice_id);

// DESC comparator with Postgres' default NULLS FIRST placement for DESC.
const descNullsFirst = (aMs, bMs) => {
   if (aMs === bMs) return 0;
   if (aMs === null) return -1;
   if (bMs === null) return 1;
   return bMs - aMs;
};

/**
 * The customer's newest statement — mirrors invoiceService.getLastInvoiceMarkersByCustomerID:
 * statement rows ordered by invoice_date DESC, created_at DESC, customer_invoice_id DESC.
 * Its created_at TIMESTAMP is the engine's payments / write-offs gate.
 */
const findNewestStatement = invoices => {
   const statements = (invoices || []).filter(isStatementRow);
   if (!statements.length) return null;
   return statements.slice().sort((a, b) => {
      const byDate = descNullsFirst(toMs(a.invoice_date), toMs(b.invoice_date));
      if (byDate) return byDate;
      const byCreated = createdAtAsc(b, a); // created_at DESC NULLS FIRST, microsecond-exact
      if (byCreated) return byCreated;
      return Number(b.customer_invoice_id) - Number(a.customer_invoice_id);
   })[0];
};

/**
 * STATEMENT GATE — mirrors invoiceService.applyLastBillGate.
 *
 * A payment or write-off is a NEXT-BILL item only when it was created strictly
 * AFTER the newest statement row (created_at > newest parent's created_at).
 * Rows entered on bill day BEFORE the run were already reflected on that
 * statement (a job write-off netted into its charges, a payment/write-off
 * snapshot absorbed into its beginning_balance); gating on the statement DATE
 * (the old `created_at >= invoice_date` rule) pulled them onto the next bill a
 * second time and re-credited the customer.
 *
 *   no statement yet            → every row is pending (never billed)
 *   statement without created_at → legacy date gate (created_at >= invoice_date)
 *
 * Precision: the engine compares against the marker row's created_at inside
 * Postgres, to the microsecond. The comparison here uses created_at_exact (see
 * compareCreatedAt), so a row created in the statement's own millisecond lands
 * on the same side of the gate as in the engine.
 */
const makeStatementGate = newestStatement => {
   if (!newestStatement) return () => true;
   if (!hasCreatedAt(newestStatement)) {
      const statementDateMs = toMs(newestStatement.invoice_date);
      if (statementDateMs === null) return () => true;
      return row => {
         const c = toMs(row.created_at);
         return c !== null && c >= statementDateMs;
      };
   }
   return row => compareCreatedAt(row, newestStatement) === 1;
};

const buildInvoiceChains = invoices => {
   const byId = new Map();
   invoices.forEach(inv => byId.set(inv.customer_invoice_id, inv));
   const chains = new Map();
   invoices.forEach(inv => {
      const rootId = inv.parent_invoice_id || inv.customer_invoice_id;
      if (!chains.has(rootId)) chains.set(rootId, { rootId, parent: null, snapshots: [] });
      const chain = chains.get(rootId);
      if (!inv.parent_invoice_id) chain.parent = inv;
      else chain.snapshots.push(inv);
   });
   chains.forEach(chain => {
      if (!chain.parent && byId.has(chain.rootId)) {
         chain.parent = byId.get(chain.rootId);
      }
      // Oldest → newest, the reverse of the engine's ORDER BY created_at DESC,
      // customer_invoice_id DESC (microsecond-exact, NULL created_at newest), so
      // the last snapshot is the one the engine reads as the chain's latest.
      chain.snapshots.sort((a, b) => createdAtAsc(a, b) || a.customer_invoice_id - b.customer_invoice_id);
   });
   return chains;
};

const computePerInvoice = ({ chain, payments, writeoffs, transactions }) => {
   const parent = chain.parent;
   const chainIds = new Set([chain.rootId, ...chain.snapshots.map(s => s.customer_invoice_id)]);

   const linkedPayments = payments.filter(p => chainIds.has(p.customer_invoice_id));
   const linkedWriteoffs = writeoffs.filter(w => chainIds.has(w.customer_invoice_id));
   const linkedTransactions = transactions.filter(t => chainIds.has(t.customer_invoice_id));

   // ISSUE-TIME PAYMENTS are already inside total_amount_due. Finalize stamps
   // the uninvoiced payments received in the period onto the NEW PARENT row
   // (customer_invoice_id = parent id) and issues the parent with
   // total_amount_due = the engine's invoiceTotal, which already adds that
   // paymentTotal (negative). Those payments were created before the parent
   // row. Every later payment links to the child snapshot it creates
   // (createPaymentCore, reversePayment), and a payment linked directly to a
   // parent can be neither re-priced nor re-linked. Subtracting the issue-time
   // payments again double-debited the chain: $100 of work less a $30 retainer
   // payment is a correct $70 statement, but the audit expected $40 and raised
   // a false invoice_remaining_drift.
   //
   // Issue-time = linked to the parent row itself AND created no later than it
   // (the statement gate's boundary: only rows created strictly after the
   // statement row are next-bill items). Payments on child snapshots, and any
   // payment created after the parent, still move the remaining. A parent with
   // no such payment (legacy parents whose total was not netted by stamped
   // payments carry none) is computed exactly as before.
   const parentId = parent ? Number(parent.customer_invoice_id) : null;
   const isIssueTimePayment = p => {
      if (parentId === null || Number(p.customer_invoice_id) !== parentId) return false;
      const cmp = compareCreatedAt(p, parent);
      return cmp !== null && cmp <= 0;
   };
   const issueTimePayments = linkedPayments.filter(isIssueTimePayment);
   const movingPayments = linkedPayments.filter(p => !isIssueTimePayment(p));

   // Sign-aware, not abs(): payments are stored negative; NSF reversals are
   // POSITIVE payment rows that un-pay. Negating each amount makes payments
   // add to paidSum and reversals subtract.
   const paidSum = round2(movingPayments.reduce((a, p) => a + -num(p.payment_amount), 0));
   const paidAtIssue = round2(issueTimePayments.reduce((a, p) => a + -num(p.payment_amount), 0));
   const writeoffSum = round2(linkedWriteoffs.reduce((a, w) => a + abs(w.writeoff_amount), 0));
   const transactionSum = round2(linkedTransactions.reduce((a, t) => a + num(t.total_transaction), 0));

   const parentTotal = round2(num(parent?.total_amount_due));
   const latest = chain.snapshots[chain.snapshots.length - 1] || parent;
   const actualRemaining = round2(num(latest?.remaining_balance_on_invoice));
   const expectedRemaining = round2(parentTotal - paidSum - writeoffSum);

   // Stamped by invoiceService.zeroOutAbsorbedInvoices when a newer invoice
   // absorbed this chain's remaining into its beginning_balance. A zeroed
   // remaining on these chains is deliberate bookkeeping, not drift.
   const wasAbsorbed = /absorbed_by:/.test(parent?.notes || '') || /absorbed_by:/.test(latest?.notes || '');

   return {
      was_absorbed: wasAbsorbed,
      root_id: chain.rootId,
      parent_invoice_id: parent?.customer_invoice_id ?? null,
      invoice_number: parent?.invoice_number ?? null,
      invoice_date: fmtDate(parent?.invoice_date),
      due_date: fmtDate(parent?.due_date),
      parent_total_amount_due: parentTotal,
      parent_remaining_in_db: round2(num(parent?.remaining_balance_on_invoice)),
      latest_snapshot_remaining: actualRemaining,
      snapshot_count: chain.snapshots.length,
      linked_payments_count: linkedPayments.length,
      linked_writeoffs_count: linkedWriteoffs.length,
      linked_transactions_count: linkedTransactions.length,
      // Payments that move the remaining (snapshot / post-issue). Issue-time
      // payments are reported separately: they are already netted into
      // parent_total_amount_due, so total − paid − writeoffs = expected holds.
      paid_against_invoice: paidSum,
      issue_time_payments_count: issueTimePayments.length,
      paid_at_issue: paidAtIssue,
      writeoffs_against_invoice: writeoffSum,
      transactions_on_invoice: transactionSum,
      expected_remaining: expectedRemaining,
      actual_remaining_used: actualRemaining,
      is_paid_in_full_db: !!parent?.is_invoice_paid_in_full,
      fully_paid_date: fmtDate(parent?.fully_paid_date)
   };
};

// Severity by absolute dollar magnitude. A 50¢ rounding artifact shouldn't
// rank the same as a $3,000 ledger drift.
const driftSeverity = absD => {
   if (absD < 1) return 'info';
   if (absD < 50) return 'low';
   if (absD < 500) return 'medium';
   return 'high';
};

const detectDiscrepancies = ({
   invoices = [],
   invoiceBreakdown,
   payments,
   writeoffs,
   transactions,
   lastBillDate,
   isPendingNextBill = () => true,
   staleRolledForward = [],
   duplicateSameDayParents = []
}) => {
   const out = [];

   // Multiple parent invoices issued on the same date — likely a duplicate
   // from a billing batch.  Both/all are summed into outstanding_invoices
   // (matching the engine), but the user should review and delete the dupes.
   if (duplicateSameDayParents.length > 1) {
      const totalDup = duplicateSameDayParents.reduce((s, d) => s + d.remaining, 0);
      const list = duplicateSameDayParents.map(d => `${d.invoice_number} ($${d.remaining.toFixed(2)})`).join(', ');
      out.push({
         kind: 'duplicate_same_day_parent_invoices',
         severity: 'medium',
         detail: `${duplicateSameDayParents.length} parent invoices issued on ${fmtDate(duplicateSameDayParents[0].invoice_date)}: ${list}. Combined remaining $${totalDup.toFixed(2)} is being treated as the customer's outstanding. If these are duplicates, delete the extras to avoid over-billing.`,
         invoice_numbers: duplicateSameDayParents.map(d => d.invoice_number),
         diff_amount: totalDup
      });
   }

   // Older parents whose remaining_balance was absorbed by a newer invoice's
   // beginning_balance but never zeroed. Informational only — these don't
   // change what the customer owes (already counted in the newest invoice's
   // rolling balance), but the rows are misleading in raw SQL reports and
   // should be reconciled.
   staleRolledForward.forEach(r => {
      out.push({
         kind: 'stale_rolled_forward_balance',
         severity: 'info',
         invoice_number: r.invoice_number,
         parent_invoice_id: r.parent_invoice_id,
         detail: `Invoice ${r.invoice_number} (${fmtDate(r.invoice_date)}) still shows $${r.stale_remaining.toFixed(2)} remaining, but a newer invoice has rolled this balance forward via beginning_balance. Not double-counted in audit_balance, but the row should be zeroed for clean exports.`,
         diff_amount: r.stale_remaining
      });
   });

   // Writeoffs linked to invoices that are already paid in full = "phantom
   // credits" on the customer's account.  The billing engine treats these as
   // credits on the NEXT bill (reducing what the customer is charged), but
   // accounting-wise they're often data corrections that shouldn't change
   // current debt.  Flag each one so the user can decide whether it's a real
   // credit or a bookkeeping artifact to clean up.  Only write-offs still
   // pending for the next bill (statement gate) — older ones already landed.
   const invoiceById = new Map();
   invoices.forEach(i => invoiceById.set(i.customer_invoice_id, i));
   writeoffs
      .filter(w => w.customer_invoice_id)
      .filter(isPendingNextBill)
      .forEach(w => {
         const linked = invoiceById.get(w.customer_invoice_id);
         if (linked && linked.is_invoice_paid_in_full) {
            const amt = abs(w.writeoff_amount);
            out.push({
               kind: 'writeoff_on_paid_invoice',
               severity: 'info',
               invoice_number: linked.invoice_number,
               writeoff_id: w.writeoff_id,
               detail: `Writeoff of $${amt.toFixed(2)} (entered ${fmtDate(w.created_at)}, reason: "${w.writeoff_reason || '—'}") is linked to ${linked.invoice_number} which is already paid in full. The billing engine treats this as a credit on the customer's next invoice. If that was intentional (refund/credit), no action needed. If it was meant to retroactively adjust a paid invoice, the customer will be under-billed by $${amt.toFixed(2)} on their next statement.`,
               diff_amount: amt
            });
         }
      });

   // Credit pool: unbilled job-level write-offs that haven't been linked to an
   // invoice yet. For monthly-retainer customers these are billing adjustments
   // applied at invoice-creation time but never stitched to the invoice via
   // customer_invoice_id, so they look like phantom drift from the audit's
   // pure-math perspective. Walk invoices oldest→newest and let each positive
   // drift consume from this pool; anything still uncovered is real drift.
   let creditPool = round2(
      writeoffs
         .filter(w => !w.customer_invoice_id && w.customer_job_id)
         .reduce((a, w) => a + abs(w.writeoff_amount), 0)
   );

   invoiceBreakdown.forEach(row => {
      // Chains zeroed by rolling-balance absorption are deliberate: remaining
      // was moved into a newer invoice's beginning_balance, so drift /
      // stale-parent / paid-flag checks against the raw chain math would all
      // false-alarm. The absorbed_by note on the row documents the move.
      // (writeoff_exceeds_invoice still runs — corruption is corruption.)
      const deliberatelyAbsorbed = row.was_absorbed && row.actual_remaining_used === 0;

      const drift = round2(row.expected_remaining - row.actual_remaining_used);
      const absDrift = Math.abs(drift);
      if (absDrift >= 0.01 && !deliberatelyAbsorbed) {
         let absorbedBy = 0;
         if (drift > 0 && creditPool > 0) {
            absorbedBy = round2(Math.min(creditPool, drift));
            creditPool = round2(creditPool - absorbedBy);
         }
         const uncovered = round2(drift - absorbedBy);
         const fullyAbsorbed = drift > 0 && Math.abs(uncovered) < 0.01;
         const severity = fullyAbsorbed ? 'info' : driftSeverity(Math.abs(uncovered));
         const issueSuffix = Math.abs(num(row.paid_at_issue)) >= 0.01
            ? ` $${num(row.paid_at_issue).toFixed(2)} received before the statement was issued is already netted into its total and is not subtracted again.`
            : '';
         const noteSuffix = absorbedBy > 0
            ? ` $${absorbedBy.toFixed(2)} of this drift is covered by unbilled job-level write-offs (typical for monthly-retainer billing where excess time was zeroed via job adjustments rather than invoice-linked write-offs).`
            : '';
         out.push({
            kind: 'invoice_remaining_drift',
            severity,
            invoice_number: row.invoice_number,
            parent_invoice_id: row.parent_invoice_id,
            detail: `Expected remaining $${row.expected_remaining.toFixed(2)} (total $${row.parent_total_amount_due} - paid $${row.paid_against_invoice} - writeoffs $${row.writeoffs_against_invoice}) but the latest snapshot says $${row.actual_remaining_used.toFixed(2)}.${issueSuffix}${noteSuffix}`,
            diff_amount: drift,
            absorbed_by_writeoff_credit: absorbedBy,
            uncovered_amount: uncovered
         });
      }
      if (row.parent_total_amount_due > 0 && Math.abs(row.parent_remaining_in_db - row.actual_remaining_used) >= 0.01 && !deliberatelyAbsorbed) {
         out.push({
            kind: 'stale_parent_remaining',
            severity: 'medium',
            invoice_number: row.invoice_number,
            parent_invoice_id: row.parent_invoice_id,
            detail: `Parent row in DB shows $${row.parent_remaining_in_db.toFixed(2)} remaining but latest child snapshot has $${row.actual_remaining_used.toFixed(2)}. Affects raw SQL reports / exports.`,
            diff_amount: round2(row.parent_remaining_in_db - row.actual_remaining_used)
         });
      }
      if (row.is_paid_in_full_db && row.actual_remaining_used > 0.009) {
         out.push({
            kind: 'paid_flag_mismatch_open',
            severity: driftSeverity(row.actual_remaining_used),
            invoice_number: row.invoice_number,
            parent_invoice_id: row.parent_invoice_id,
            detail: `is_invoice_paid_in_full = true but $${row.actual_remaining_used.toFixed(2)} remains.`
         });
      }
      if (!row.is_paid_in_full_db && row.actual_remaining_used <= 0.009 && row.parent_total_amount_due > 0 && !deliberatelyAbsorbed) {
         out.push({
            kind: 'paid_flag_mismatch_closed',
            severity: 'low',
            invoice_number: row.invoice_number,
            parent_invoice_id: row.parent_invoice_id,
            detail: `Remaining is $0 but is_invoice_paid_in_full = false.`
         });
      }
      if (row.writeoffs_against_invoice > row.parent_total_amount_due + 0.01) {
         out.push({
            kind: 'writeoff_exceeds_invoice',
            severity: 'high',
            invoice_number: row.invoice_number,
            parent_invoice_id: row.parent_invoice_id,
            detail: `Write-offs of $${row.writeoffs_against_invoice.toFixed(2)} exceed invoice total of $${row.parent_total_amount_due.toFixed(2)}.`
         });
      }
   });

   const orphanPayments = payments.filter(p => !p.customer_invoice_id);
   if (orphanPayments.length) {
      out.push({
         kind: 'unlinked_payments',
         severity: orphanPayments.length > 1 ? 'medium' : 'low',
         detail: `${orphanPayments.length} payment(s) not attached to any invoice (total $${round2(orphanPayments.reduce((a, p) => a + -num(p.payment_amount), 0)).toFixed(2)}).`,
         payment_ids: orphanPayments.map(p => p.payment_id)
      });
   }

   const orphanTx = transactions.filter(t => !t.customer_invoice_id && t.is_transaction_billable);
   if (orphanTx.length && lastBillDate) {
      const stale = orphanTx.filter(t => new Date(t.transaction_date) < new Date(lastBillDate));
      if (stale.length) {
         out.push({
            kind: 'unbilled_pre_bill_transactions',
            severity: 'medium',
            detail: `${stale.length} billable transaction(s) dated on or before the last invoice (${fmtDate(lastBillDate)}) were never invoiced. Total $${round2(stale.reduce((a, t) => a + num(t.total_transaction), 0)).toFixed(2)}.`,
            transaction_ids: stale.map(t => t.transaction_id)
         });
      }
   }

   return out;
};

const buildChronologicalLedger = ({ invoices, payments, writeoffs, transactions, retainers = [] }) => {
   const events = [];
   const invoiceById = new Map();
   invoices.forEach(i => invoiceById.set(i.customer_invoice_id, i));

   // Transactions are the source of truth — the work itself creates the
   // liability. We include every transaction (billed and unbilled) so the
   // ledger reflects the full account history all the way back to the
   // customer's earliest transaction, not just the first invoice.
   transactions.forEach(t => {
      const linkedInv = t.customer_invoice_id ? invoiceById.get(t.customer_invoice_id) : null;
      const linkedInvNum = linkedInv?.invoice_number || null;
      let desc = (t.detailed_work_description || t.note || 'Transaction').slice(0, 110);
      if (linkedInvNum) desc += ` [billed on ${linkedInvNum}]`;
      else desc += ' [unbilled]';
      const type = t.is_transaction_billable
         ? linkedInv
            ? 'transaction_billed'
            : 'transaction_unbilled'
         : 'transaction_nonbillable';
      events.push({
         date: fmtDate(t.transaction_date),
         sort_ts: new Date(t.transaction_date).getTime(),
         type,
         description: desc,
         charge: t.is_transaction_billable ? round2(num(t.total_transaction)) : 0,
         credit: 0,
         reference_id: t.transaction_id,
         note: null
      });
   });

   // Invoices appear as informational rows on their billing date — they
   // document when work was formally billed but do NOT change the running
   // balance, because the underlying transactions already accounted for it.
   invoices
      .filter(i => !i.parent_invoice_id)
      .forEach(i => {
         events.push({
            date: fmtDate(i.invoice_date),
            sort_ts: new Date(i.invoice_date).getTime(),
            type: 'invoice_issued',
            description: `Invoice ${i.invoice_number} issued — total $${round2(num(i.total_amount_due)).toFixed(2)}`,
            charge: 0,
            credit: 0,
            reference_id: i.customer_invoice_id,
            note: i.notes || null
         });
      });

   // Retainer creation rows — informational only ($0 charge / $0 credit) so we
   // don't double-count with retainer-funded payments that already appear in
   // the payments stream. Each retainer root tells the auditor when the
   // customer prepaid funds.
   retainers
      .filter(r => !r.parent_retainer_id)
      .forEach(r => {
         events.push({
            date: fmtDate(r.created_at),
            sort_ts: new Date(r.created_at).getTime(),
            type: 'retainer_established',
            description: `Retainer established: ${r.display_name || r.type_of_hold || 'Retainer'} — $${round2(abs(r.starting_amount)).toFixed(2)}${r.form_of_payment ? ` (${r.form_of_payment})` : ''}`,
            charge: 0,
            credit: 0,
            reference_id: r.retainer_id,
            note: r.note || null
         });
      });

   payments.forEach(p => {
      const retainerNote = p.retainer_id ? ' [retainer-funded]' : '';
      // Stored negative = money in (credit). A POSITIVE row is an NSF
      // reversal: the debt comes back, so it lands on the charge side.
      const signed = -num(p.payment_amount);
      const isReversal = signed < 0;
      events.push({
         date: fmtDate(p.payment_date),
         sort_ts: new Date(p.payment_date).getTime(),
         type: isReversal ? 'payment_reversal' : p.retainer_id ? 'payment_retainer' : 'payment',
         description: isReversal
            ? `Payment reversal${p.payment_reference_number ? ` #${p.payment_reference_number}` : ''}`
            : `Payment${p.form_of_payment ? ` (${p.form_of_payment})` : ''}${p.payment_reference_number ? ` #${p.payment_reference_number}` : ''}${retainerNote}`,
         charge: isReversal ? round2(-signed) : 0,
         credit: isReversal ? 0 : round2(signed),
         reference_id: p.payment_id,
         note: p.note || null
      });
   });

   writeoffs.forEach(w => {
      events.push({
         date: fmtDate(w.writeoff_date),
         sort_ts: new Date(w.writeoff_date).getTime(),
         type: w.customer_invoice_id ? 'writeoff_invoice' : 'writeoff_job',
         description: `Write-off${w.writeoff_reason ? `: ${w.writeoff_reason}` : ''}`,
         charge: 0,
         credit: round2(abs(w.writeoff_amount)),
         reference_id: w.writeoff_id,
         note: w.note || null
      });
   });

   events.sort((a, b) => {
      if (a.sort_ts !== b.sort_ts) return a.sort_ts - b.sort_ts;
      // On the same day: work happens, then the invoice is issued for it,
      // then payments land, then write-offs adjust. This order keeps the
      // running balance increasing-then-settling in a way that reads naturally.
      const order = {
         retainer_established: -1,
         transaction_billed: 0,
         transaction_unbilled: 0,
         transaction_nonbillable: 0,
         invoice_issued: 1,
         payment: 2,
         payment_retainer: 2,
         payment_reversal: 2,
         writeoff_invoice: 3,
         writeoff_job: 3
      };
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
   });

   let running = 0;
   events.forEach(e => {
      running = round2(running + e.charge - e.credit);
      e.running_balance = running;
      delete e.sort_ts;
   });

   return events;
};

// Group retainer chains by root (parent_retainer_id IS NULL), then for each
// chain pick the latest snapshot as the authoritative current_amount.
// Retainer rows are stored negative (memory: customer_payments + writeoffs
// + retainers are all negative in raw DB).
const buildRetainerChains = retainers => {
   if (!retainers || !retainers.length) return new Map();
   const chains = new Map();
   retainers.forEach(r => {
      const rootId = r.parent_retainer_id || r.retainer_id;
      if (!chains.has(rootId)) chains.set(rootId, { rootId, root: null, snapshots: [] });
      const chain = chains.get(rootId);
      if (!r.parent_retainer_id) chain.root = r;
      else chain.snapshots.push(r);
   });
   chains.forEach(chain => {
      // Microsecond-exact when the row carries created_at_exact (audit-service
      // selects it); a millisecond Date tie broken by id picked the wrong
      // snapshot when two draws landed within one millisecond in id-reversed order.
      chain.snapshots.sort((a, b) => createdAtAsc(a, b) || a.retainer_id - b.retainer_id);
      // Defensive: if the chain's root row was deleted but snapshots survive
      // (orphan parent_retainer_id pointing to a non-existent retainer),
      // promote the earliest snapshot to act as the root so we don't silently
      // drop the retainer from the audit.
      if (!chain.root && chain.snapshots.length) {
         chain.root = chain.snapshots[0];
         chain.snapshots = chain.snapshots.slice(1);
         chain.orphan_root = true;
      }
   });
   return chains;
};

// Marker the payments module stamps on an overpayment prepayment retainer that
// an NSF reversal cancelled (ledger-helpers.cancelledByReversalMarker). Parsed
// locally on purpose: the audit recomputes from raw rows and imports no ledger
// code. Keep the pattern identical to the one in ledger-helpers.
const CANCELLED_BY_REVERSAL_RE = /\[cancelled by reversal of payment #(\d+)\]/;
const parseCancelledByReversal = note => {
   const match = CANCELLED_BY_REVERSAL_RE.exec(note || '');
   return match ? Number(match[1]) : null;
};

const summarizeRetainers = retainers => {
   const chains = buildRetainerChains(retainers);
   const breakdown = [];
   let total_prepaid_lifetime = 0;
   let retainer_available = 0;
   chains.forEach(chain => {
      const root = chain.root;
      if (!root) return;
      // The LATEST snapshot is authoritative for both the balance and the
      // active flag: drawing a retainer to $0 writes a new snapshot with
      // is_retainer_active = false, while the root row keeps the flag it was
      // created with. Reading the flag from the root counted exhausted (or
      // deactivated) retainers as still available.
      const latest = chain.snapshots[chain.snapshots.length - 1] || root;
      // An overpayment prepayment that an NSF reversal cancelled never funded
      // anything: it is neither prepaid nor drawn. Its starting_amount is kept
      // only so deleting the reversal can restore it exactly — counting it as
      // "drawn" overstated retainer_drawn by the bounced excess.
      const cancelledByPayment = parseCancelledByReversal(latest.note) ?? parseCancelledByReversal(root.note);
      const isCancelled = cancelledByPayment != null;
      const startingAmt = round2(abs(root.starting_amount));
      const currentAmt = round2(abs(latest.current_amount));
      const drawn = isCancelled ? 0 : round2(startingAmt - currentAmt);
      const isActive = !isCancelled && !!latest.is_retainer_active;
      if (!isCancelled) total_prepaid_lifetime = round2(total_prepaid_lifetime + startingAmt);
      if (isActive) retainer_available = round2(retainer_available + currentAmt);
      breakdown.push({
         retainer_id: root.retainer_id,
         display_name: root.display_name || null,
         type_of_hold: root.type_of_hold || null,
         form_of_payment: root.form_of_payment || null,
         created_at: fmtDateTime(root.created_at),
         starting_amount: startingAmt,
         current_amount: currentAmt,
         drawn_to_date: drawn,
         is_active: isActive,
         is_cancelled: isCancelled,
         cancelled_by_payment_id: cancelledByPayment,
         snapshot_count: chain.snapshots.length,
         orphan_root: !!chain.orphan_root
      });
   });
   // "Drawn" is what was actually consumed from each chain (starting − current),
   // not prepaid − available: an inactive chain that still holds its full
   // balance is unavailable but was never drawn, and a cancelled NSF excess is
   // neither. The two quantities differ exactly by those unavailable balances.
   const retainer_drawn = round2(breakdown.reduce((sum, chain) => sum + chain.drawn_to_date, 0));
   return {
      total_prepaid_lifetime,
      retainer_available,
      retainer_drawn,
      active_chains: breakdown.filter(b => b.is_active).length,
      cancelled_chains: breakdown.filter(b => b.is_cancelled).length,
      total_chains: breakdown.length,
      breakdown
   };
};

const auditCustomerLedger = ({ customer, invoices, payments, writeoffs, transactions, retainers = [] }) => {
   const chains = buildInvoiceChains(invoices);
   const invoiceBreakdown = [];
   chains.forEach(chain => {
      invoiceBreakdown.push(computePerInvoice({ chain, payments, writeoffs, transactions }));
   });
   invoiceBreakdown.sort((a, b) => {
      const aD = a.invoice_date || '';
      const bD = b.invoice_date || '';
      return aD.localeCompare(bD);
   });

   const parentInvoices = invoices.filter(i => !i.parent_invoice_id);

   // The newest statement drives two different gates, mirroring the engine:
   //   lastBillDate (its invoice_date) — which CHAINS are current (rolling
   //     balance + the write-off single-count rule; same-day parents summed);
   //   isPendingNextBill (its created_at) — which PAYMENTS / WRITE-OFFS are
   //     still next-bill items (see makeStatementGate).
   // Numeric comparisons throughout, so this works whether invoice_date comes
   // back from node-postgres as a 'YYYY-MM-DD' string or as a Date object (the
   // default .sort() stringifies Dates as "Mon Feb 10 2026 …").
   // lastBillDate = MAX(invoice_date) over statement rows (NULLs ignored), as in
   // getLastInvoiceDatesByCustomerID; the marker row follows the engine's
   // DISTINCT ON ordering (getLastInvoiceMarkersByCustomerID).
   const lastBillDate = invoices
      .filter(isStatementRow)
      .map(i => i.invoice_date)
      .filter(d => toMs(d) !== null)
      .reduce((max, d) => (max === null || toMs(d) > toMs(max) ? d : max), null);
   const newestStatement = findNewestStatement(invoices);
   const isPendingNextBill = makeStatementGate(newestStatement);

   const total_invoiced = round2(parentInvoices.reduce((a, i) => a + num(i.total_amount_due), 0));
   // Net of NSF reversals (positive payment rows subtract).
   const total_paid = round2(payments.reduce((a, p) => a + -num(p.payment_amount), 0));
   const total_writeoffs = round2(writeoffs.reduce((a, w) => a + abs(w.writeoff_amount), 0));
   const total_transactions = round2(transactions.reduce((a, t) => a + num(t.total_transaction), 0));
   const total_billable_transactions = round2(
      transactions.filter(t => t.is_transaction_billable).reduce((a, t) => a + num(t.total_transaction), 0)
   );

   // ROLLING-BALANCE INTERPRETATION of outstanding_invoices.
   //
   // The billing system is built around a rolling statement: each new parent
   // invoice's beginning_balance absorbs the prior period's outstanding, so
   // the customer's true current debt equals the remaining_balance on the
   // NEWEST parent invoice (paid or not).  Older parents whose remaining
   // is non-zero are stale ledger artifacts that should have been zeroed when
   // a newer invoice absorbed their balance.
   //
   // Sort chains by parent invoice_date DESC, then customer_invoice_id DESC.
   // The first chain (newest) is authoritative — if paid, customer owes 0; if
   // unpaid, the remaining is the outstanding.  Any older chain with rem > 0
   // is flagged stale and NOT counted (its balance is already inside the
   // newest invoice's beginning_balance or has been settled by payments
   // against the newest invoice).
   //
   // This deliberately mirrors getOutstandingInvoices in the app's invoice-
   // service.  An earlier version skipped paid chains and used the next-newest
   // UNPAID chain, which double-counted balances after the rolling invoice was
   // settled (e.g. Chris Poorten: Nov 2024 invoice rem=$225 was absorbed into
   // Dec 2025 invoice's bb=$990 and paid in full → customer owes $0, not $225).
   const chainsByDateDesc = invoiceBreakdown.slice().sort((a, b) => {
      const aD = new Date(a.invoice_date || 0).getTime();
      const bD = new Date(b.invoice_date || 0).getTime();
      if (aD !== bD) return bD - aD;
      return (b.parent_invoice_id || 0) - (a.parent_invoice_id || 0);
   });

   // Multiple parent invoices can share the same invoice_date (duplicate-issue
   // bug in earlier billing runs).  Treat all parents on the newest date as
   // one logical statement and sum their remainders — this matches the engine's
   // getOutstandingInvoices, which lets every parent whose invoice_date >=
   // lastBillDate through the date gate.  Each duplicate is flagged as an
   // info-level discrepancy so the user can clean them up.
   let outstanding_invoices = 0;
   const staleRolledForward = [];
   const duplicateSameDayParents = [];
   if (chainsByDateDesc.length) {
      const newestDate = chainsByDateDesc[0].invoice_date;
      const isSameDate = d => {
         if (!d || !newestDate) return false;
         return new Date(d).toISOString().slice(0, 10) === new Date(newestDate).toISOString().slice(0, 10);
      };
      const newestGroup = chainsByDateDesc.filter(c => isSameDate(c.invoice_date));
      outstanding_invoices = round2(
         newestGroup.reduce((s, c) => s + Math.max(0, c.actual_remaining_used), 0)
      );
      // A same-day statement that a later run absorbed on purpose (zeroed and
      // stamped absorbed_by — zeroOutAbsorbedInvoices works by chain identity,
      // so an explicitly allowed same-day re-bill absorbs the first run) is not
      // a duplicate; only live same-day parents are flagged.
      const liveNewestGroup = newestGroup.filter(g => !(g.was_absorbed && g.actual_remaining_used === 0));
      if (liveNewestGroup.length > 1) {
         liveNewestGroup.forEach(g => {
            duplicateSameDayParents.push({
               invoice_number: g.invoice_number,
               parent_invoice_id: g.parent_invoice_id,
               invoice_date: g.invoice_date,
               remaining: round2(Math.max(0, g.actual_remaining_used))
            });
         });
      }
      // Any chain dated older than the newest date that still has remaining > 0
      // is stale — its balance has been absorbed by the newest invoice's bb.
      for (let i = newestGroup.length; i < chainsByDateDesc.length; i++) {
         const row = chainsByDateDesc[i];
         const rem = Math.max(0, row.actual_remaining_used);
         if (rem > 0.009) {
            staleRolledForward.push({
               invoice_number: row.invoice_number,
               parent_invoice_id: row.parent_invoice_id,
               invoice_date: row.invoice_date,
               stale_remaining: rem
            });
         }
      }
   }
   const unbilled_billable = round2(
      transactions
         .filter(t => !t.customer_invoice_id && t.is_transaction_billable)
         .reduce((a, t) => a + num(t.total_transaction), 0)
   );

   // Payments received since the last statement that are not applied to an
   // invoice — the engine's paymentTotal (getPaymentsByCustomerID pulls rows
   // through the statement gate; groupAndTotalPayments keeps the uninvoiced
   // ones). An uninvoiced payment created BEFORE the newest statement row was
   // already on that statement (finalize stamps it with the new invoice) and is
   // not credited again; it is still reported by the unlinked_payments check.
   const unbilled_payments = round2(
      payments
         .filter(p => !p.customer_invoice_id)
         .filter(isPendingNextBill)
         .reduce((a, p) => a + -num(p.payment_amount), 0)
   );

   // Write-offs still pending for the next bill (statement gate). Everything
   // below that decides whether a write-off is "already reflected" works off
   // this set only.
   const pendingWriteoffs = writeoffs.filter(isPendingNextBill);

   // Net job-level write-offs against their job's unbilled transactions, mirroring the billing
   // engine's groupAndTotalTransactions behavior (showWriteOffs=false path).
   //
   // Key rules matching the billing engine:
   // 1. Jobs are initialized from ALL unbilled transactions (billable AND non-billable), because
   //    the billing engine processes every transaction to allow write-offs on jobs with only
   //    non-billable work to net against the overall total (e.g. a discount job).
   // 2. Only billable transaction amounts contribute to the job's running total.
   // 3. Only write-offs still pending for the next bill are netted — the statement gate
   //    (created_at > newest statement row's created_at), exactly like getWriteOffsByCustomerID.
   //    A job write-off entered on bill day BEFORE the run was already netted into that
   //    statement's charges; the old `created_at >= invoice_date` gate netted it a second time
   //    against the job's next unbilled work. (Gating on writeoff_date was an earlier bug of the
   //    same family: a retroactively dated write-off entered post-bill was skipped.)
   // 4. A pending write-off whose job has NO unbilled transaction this cycle — or that has no job
   //    at all — is still credited, as an adjustment-only line (transactionCalculations
   //    .addAdjustmentOnlyJobGroups groups write-offs by customer_job_id, so job-less rows land
   //    in their own group too). It used to be dropped here and, once the statement gate moved
   //    on, lost for good. Write-offs entered BEFORE the last statement are never re-applied.
   const unbilledByJob = {};
   let unbilled_billable_on_jobs = 0;
   transactions
      .filter(t => !t.customer_invoice_id && t.customer_job_id)
      .forEach(t => {
         if (!(t.customer_job_id in unbilledByJob)) unbilledByJob[t.customer_job_id] = 0;
         if (t.is_transaction_billable) {
            unbilledByJob[t.customer_job_id] = round2(unbilledByJob[t.customer_job_id] + num(t.total_transaction));
            unbilled_billable_on_jobs = round2(unbilled_billable_on_jobs + num(t.total_transaction));
         }
      });
   let job_writeoffs_netted = 0;
   // Pending write-offs not linked to an invoice with no unbilled work to net
   // against (rule 4): credited on the next bill as adjustment-only lines.
   let adjustment_writeoffs = 0;
   pendingWriteoffs
      .filter(w => !w.customer_invoice_id)
      .forEach(w => {
         if (w.customer_job_id && Object.prototype.hasOwnProperty.call(unbilledByJob, w.customer_job_id)) {
            unbilledByJob[w.customer_job_id] = round2(unbilledByJob[w.customer_job_id] - abs(w.writeoff_amount));
            job_writeoffs_netted = round2(job_writeoffs_netted + abs(w.writeoff_amount));
         } else {
            adjustment_writeoffs = round2(adjustment_writeoffs + abs(w.writeoff_amount));
         }
      });
   const unbilled_billable_net = round2(Object.values(unbilledByJob).reduce((a, v) => a + v, 0));
   // Write-offs the next bill will NOT apply — the "pending adjustment" the
   // strict ledger subtracts. The engine now applies every pending write-off
   // (current-chain ones via the snapshot, absorbed-chain ones as credits, the
   // rest netted or as adjustment-only lines), so nothing is left pending and
   // the strict ledger equals the audit balance. Kept (stored per audit, shown
   // on the print view) so a future engine rule that drops a write-off shows up.
   const unbilled_writeoffs = 0;

   // Invoice-linked write-offs since the last statement: the engine treats these as
   // credits on the next bill (they represent the customer either overpaying a
   // prior invoice that we later wrote off, or Jon entering a credit adjustment
   // and tagging it to a specific old invoice).  Audit subtracts them so the
   // balance matches what the engine would charge.  Each one is also flagged as
   // an info-level discrepancy when its linked invoice is already paid_in_full,
   // so the user can see exactly which old paid invoices are generating credits.
   //
   // SINGLE-COUNT RULE (mirrors groupAndTotalWriteOffs): a write-off linked to
   // the CURRENT chain already reduced outstanding_invoices via its snapshot —
   // only write-offs on chains absorbed by the last bill act as credits here.
   // Which chains are current is still decided by statement DATE (root
   // invoice_date < lastBillDate = absorbed), exactly like the engine, so
   // legacy same-day duplicate parents keep being summed rather than credited.
   const lastBillDateMs = toMs(lastBillDate);
   const rowById = new Map(invoices.map(i => [i.customer_invoice_id, i]));
   const isAbsorbedChainCredit = w => {
      if (lastBillDateMs === null) return true;
      const row = rowById.get(w.customer_invoice_id);
      if (!row) return true;
      const root = row.parent_invoice_id ? rowById.get(row.parent_invoice_id) : row;
      const rootDate = root?.invoice_date || row.invoice_date;
      if (!rootDate) return true;
      return new Date(rootDate).getTime() < lastBillDateMs;
   };
   const invoiceLinkedWriteoffsRecent = pendingWriteoffs
      .filter(w => w.customer_invoice_id)
      .filter(isAbsorbedChainCredit);
   const invoice_linked_writeoffs_recent = round2(
      invoiceLinkedWriteoffsRecent.reduce((a, w) => a + abs(w.writeoff_amount), 0)
   );

   // audit_balance matches the engine's invoiceTotal. It is built from the
   // same signed lines the audit PDF prints, so the printed breakdown always
   // sums to the printed balance:
   //   outstanding + unbilled work on jobs − job write-offs netted
   //   − adjustment-only write-offs − unapplied payments since the last statement
   //   − absorbed-chain write-off credits
   const audit_balance_lines = [
      { key: 'outstanding_invoices', label: 'Outstanding on current statement (latest snapshot per chain)', amount: outstanding_invoices },
      { key: 'unbilled_billable_on_jobs', label: 'Unbilled billable work (on jobs)', amount: unbilled_billable_on_jobs },
      { key: 'job_writeoffs_netted', label: 'Job write-offs netted against that work', amount: round2(-job_writeoffs_netted) },
      {
         key: 'adjustment_writeoffs',
         label: 'Write-offs since the last statement with no unbilled work to net against (credited)',
         amount: round2(-adjustment_writeoffs)
      },
      { key: 'unbilled_payments', label: 'Payments since the last statement not applied to an invoice', amount: round2(-unbilled_payments) },
      {
         key: 'invoice_linked_writeoffs_recent',
         label: 'Write-offs since the last statement on absorbed statements (next-bill credits)',
         amount: round2(-invoice_linked_writeoffs_recent)
      }
   ];
   const audit_balance = round2(audit_balance_lines.reduce((a, l) => a + l.amount, 0));
   // Strict ledger = the audit balance with every pending write-off applied now
   // (see unbilled_writeoffs above).
   const strict_ledger_balance = round2(audit_balance - unbilled_writeoffs);
   const net_position_lifetime = round2(total_invoiced + unbilled_billable - total_paid - total_writeoffs);

   // Retainer summary — purely informational alongside the balance. We do NOT
   // subtract retainer_available from audit_balance because the app's own
   // balance engine (calculateInvoices.invoiceTotal) doesn't either; retainers
   // are tracked as a separate "current retainer/prepayment" figure on the
   // customer profile, not netted into the displayed balance.
   const retainerSummary = summarizeRetainers(retainers);
   const net_position_after_retainer = round2(audit_balance - retainerSummary.retainer_available);

   const discrepancies = detectDiscrepancies({
      invoices,
      invoiceBreakdown,
      payments,
      writeoffs,
      transactions,
      lastBillDate,
      isPendingNextBill,
      staleRolledForward,
      duplicateSameDayParents
   });

   const ledger = buildChronologicalLedger({ invoices, payments, writeoffs, transactions, retainers });

   return {
      customer: {
         customer_id: customer.customer_id,
         display_name: customer.display_name || customer.customer_name || customer.business_name,
         business_name: customer.business_name,
         is_commercial: customer.is_commercial_customer,
         is_active: customer.is_customer_active
      },
      totals: {
         total_invoiced,
         total_paid,
         total_writeoffs,
         total_transactions,
         total_billable_transactions,
         outstanding_invoices,
         unbilled_billable,
         unbilled_billable_on_jobs,
         job_writeoffs_netted,
         adjustment_writeoffs,
         unbilled_billable_net,
         unbilled_payments,
         invoice_linked_writeoffs_recent,
         unbilled_writeoffs,
         audit_balance,
         audit_balance_lines,
         strict_ledger_balance,
         net_position_lifetime,
         retainer_total_prepaid_lifetime: retainerSummary.total_prepaid_lifetime,
         retainer_available: retainerSummary.retainer_available,
         retainer_drawn: retainerSummary.retainer_drawn,
         net_position_after_retainer,
         counts: {
            parent_invoices: parentInvoices.length,
            invoice_snapshots: invoices.length - parentInvoices.length,
            payments: payments.length,
            writeoffs: writeoffs.length,
            transactions: transactions.length,
            retainer_chains: retainerSummary.total_chains,
            retainer_active_chains: retainerSummary.active_chains
         },
         last_bill_date: fmtDate(lastBillDate),
         // The statement-gate marker: payments / write-offs created after this
         // timestamp are next-bill items (see makeStatementGate).
         last_bill_invoice_number: newestStatement ? newestStatement.invoice_number || null : null,
         last_bill_created_at: newestStatement ? fmtDateTime(newestStatement.created_at) : null
      },
      retainers: retainerSummary,
      invoice_breakdown: invoiceBreakdown,
      discrepancies,
      ledger,
      methodology: {
         description:
            'Independent recomputation from raw customer_invoices, customer_payments, customer_writeoffs, and customer_transactions rows. Does not share code with the app balance engine.',
         audit_balance_formula:
            'outstanding_invoices (latest-snapshot remaining of every parent chain dated on the newest statement date — the rolling-balance view; older parents whose balance was absorbed by a newer invoice\'s beginning_balance are flagged as stale_rolled_forward_balance discrepancies and NOT double-counted) + unbilled_billable_on_jobs - job_writeoffs_netted - adjustment_writeoffs (pending write-offs with no unbilled work on their job, or no job) - unbilled_payments - invoice_linked_writeoffs_recent. "Since the last statement" means created_at later than the newest statement row\'s created_at (the billing engine\'s statement gate), so bill-day entries made before the run are not counted twice. The printed lines are totals.audit_balance_lines.',
         strict_ledger_formula:
            'audit_balance - unbilled_writeoffs, where unbilled_writeoffs = write-offs entered since the last statement that the next bill will not apply. The billing engine applies every pending write-off (netted into its job\'s unbilled work or credited as an adjustment-only line), so this is currently 0 and the strict ledger equals the audit balance.',
         net_position_formula:
            'total_invoiced + unbilled_billable - total_paid - total_writeoffs (lifetime net, ignores invoice linkage)',
         ledger_basis:
            'Transaction-based — every billable transaction is a charge on its transaction_date (whether or not it was later invoiced). Invoices appear as informational markers and do NOT change the running balance, since the underlying transactions already did. Retainer creations also appear as informational markers (no ledger impact) — the cash inflow from a retainer is later reflected as a retainer-funded payment, so counting both would double-count. The ledger therefore spans the customer\'s full history from their first transaction onward, and the final running balance reflects transactions − payments − writeoffs (not the audit_balance, which uses invoice-snapshot accounting).',
         retainer_basis:
            'Retainer totals are surfaced as a separate section. retainer_available is the sum of |current_amount| across the latest snapshot of each active retainer chain. It is NOT subtracted from audit_balance — the app\'s balance display does not subtract it either. net_position_after_retainer is provided as a what-the-customer-effectively-owes figure (audit_balance − retainer_available).'
      },
      generated_at: fmtDateTime(new Date())
   };
};

module.exports = { auditCustomerLedger };
