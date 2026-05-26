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
      chain.snapshots.sort((a, b) => {
         const aT = new Date(a.created_at).getTime();
         const bT = new Date(b.created_at).getTime();
         if (aT !== bT) return aT - bT;
         return a.customer_invoice_id - b.customer_invoice_id;
      });
   });
   return chains;
};

const computePerInvoice = ({ chain, payments, writeoffs, transactions }) => {
   const parent = chain.parent;
   const chainIds = new Set([chain.rootId, ...chain.snapshots.map(s => s.customer_invoice_id)]);

   const linkedPayments = payments.filter(p => chainIds.has(p.customer_invoice_id));
   const linkedWriteoffs = writeoffs.filter(w => chainIds.has(w.customer_invoice_id));
   const linkedTransactions = transactions.filter(t => chainIds.has(t.customer_invoice_id));

   const paidSum = round2(linkedPayments.reduce((a, p) => a + abs(p.payment_amount), 0));
   const writeoffSum = round2(linkedWriteoffs.reduce((a, w) => a + abs(w.writeoff_amount), 0));
   const transactionSum = round2(linkedTransactions.reduce((a, t) => a + num(t.total_transaction), 0));

   const parentTotal = round2(num(parent?.total_amount_due));
   const latest = chain.snapshots[chain.snapshots.length - 1] || parent;
   const actualRemaining = round2(num(latest?.remaining_balance_on_invoice));
   const expectedRemaining = round2(parentTotal - paidSum - writeoffSum);

   return {
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
      paid_against_invoice: paidSum,
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

const detectDiscrepancies = ({ invoices = [], invoiceBreakdown, payments, writeoffs, transactions, lastBillDate, staleRolledForward = [], duplicateSameDayParents = [] }) => {
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
   // credit or a bookkeeping artifact to clean up.
   const lastBillDateMs = lastBillDate ? new Date(lastBillDate).getTime() : null;
   const isPostLastBill = w => {
      if (!lastBillDateMs) return true;
      const c = w.created_at;
      return c && new Date(c).getTime() >= lastBillDateMs;
   };
   const invoiceById = new Map();
   invoices.forEach(i => invoiceById.set(i.customer_invoice_id, i));
   writeoffs
      .filter(w => w.customer_invoice_id)
      .filter(isPostLastBill)
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
      const drift = round2(row.expected_remaining - row.actual_remaining_used);
      const absDrift = Math.abs(drift);
      if (absDrift >= 0.01) {
         let absorbedBy = 0;
         if (drift > 0 && creditPool > 0) {
            absorbedBy = round2(Math.min(creditPool, drift));
            creditPool = round2(creditPool - absorbedBy);
         }
         const uncovered = round2(drift - absorbedBy);
         const fullyAbsorbed = drift > 0 && Math.abs(uncovered) < 0.01;
         const severity = fullyAbsorbed ? 'info' : driftSeverity(Math.abs(uncovered));
         const noteSuffix = absorbedBy > 0
            ? ` $${absorbedBy.toFixed(2)} of this drift is covered by unbilled job-level write-offs (typical for monthly-retainer billing where excess time was zeroed via job adjustments rather than invoice-linked write-offs).`
            : '';
         out.push({
            kind: 'invoice_remaining_drift',
            severity,
            invoice_number: row.invoice_number,
            parent_invoice_id: row.parent_invoice_id,
            detail: `Expected remaining $${row.expected_remaining.toFixed(2)} (total $${row.parent_total_amount_due} - paid $${row.paid_against_invoice} - writeoffs $${row.writeoffs_against_invoice}) but the latest snapshot says $${row.actual_remaining_used.toFixed(2)}.${noteSuffix}`,
            diff_amount: drift,
            absorbed_by_writeoff_credit: absorbedBy,
            uncovered_amount: uncovered
         });
      }
      if (row.parent_total_amount_due > 0 && Math.abs(row.parent_remaining_in_db - row.actual_remaining_used) >= 0.01) {
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
      if (!row.is_paid_in_full_db && row.actual_remaining_used <= 0.009 && row.parent_total_amount_due > 0) {
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
         detail: `${orphanPayments.length} payment(s) not attached to any invoice (total $${round2(orphanPayments.reduce((a, p) => a + abs(p.payment_amount), 0)).toFixed(2)}).`,
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
      events.push({
         date: fmtDate(p.payment_date),
         sort_ts: new Date(p.payment_date).getTime(),
         type: p.retainer_id ? 'payment_retainer' : 'payment',
         description: `Payment${p.form_of_payment ? ` (${p.form_of_payment})` : ''}${p.payment_reference_number ? ` #${p.payment_reference_number}` : ''}${retainerNote}`,
         charge: 0,
         credit: round2(abs(p.payment_amount)),
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
      chain.snapshots.sort((a, b) => {
         const aT = new Date(a.created_at).getTime();
         const bT = new Date(b.created_at).getTime();
         if (aT !== bT) return aT - bT;
         return a.retainer_id - b.retainer_id;
      });
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

const summarizeRetainers = retainers => {
   const chains = buildRetainerChains(retainers);
   const breakdown = [];
   let total_prepaid_lifetime = 0;
   let retainer_available = 0;
   chains.forEach(chain => {
      const root = chain.root;
      if (!root) return;
      const latest = chain.snapshots[chain.snapshots.length - 1] || root;
      const startingAmt = round2(abs(root.starting_amount));
      const currentAmt = round2(abs(latest.current_amount));
      const drawn = round2(startingAmt - currentAmt);
      const isActive = !!root.is_retainer_active;
      total_prepaid_lifetime = round2(total_prepaid_lifetime + startingAmt);
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
         snapshot_count: chain.snapshots.length,
         orphan_root: !!chain.orphan_root
      });
   });
   const retainer_drawn = round2(total_prepaid_lifetime - retainer_available);
   return {
      total_prepaid_lifetime,
      retainer_available,
      retainer_drawn,
      active_chains: breakdown.filter(b => b.is_active).length,
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

   // Compute last bill date early — needed for write-off netting below.
   // Use a numeric comparator so this works whether invoice_date comes back from
   // node-postgres as a 'YYYY-MM-DD' string or as a JavaScript Date object.
   // The default .sort() stringifies Date objects as "Mon Feb 10 2026 …" and sorts
   // alphabetically by day-name, giving a wrong result.
   const lastBillDate = parentInvoices.length
      ? parentInvoices
           .map(i => i.invoice_date)
           .sort((a, b) => new Date(a) - new Date(b))
           .slice(-1)[0]
      : null;

   const total_invoiced = round2(parentInvoices.reduce((a, i) => a + num(i.total_amount_due), 0));
   const total_paid = round2(payments.reduce((a, p) => a + abs(p.payment_amount), 0));
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
      if (newestGroup.length > 1) {
         newestGroup.forEach(g => {
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
   const unbilled_payments = round2(
      payments.filter(p => !p.customer_invoice_id).reduce((a, p) => a + abs(p.payment_amount), 0)
   );
   const unbilled_writeoffs = round2(
      writeoffs.filter(w => !w.customer_invoice_id).reduce((a, w) => a + abs(w.writeoff_amount), 0)
   );

   // Net job-level write-offs against their job's unbilled transactions, mirroring the billing
   // engine's groupAndTotalTransactions behavior (showWriteOffs=false path).
   //
   // Key rules matching the billing engine:
   // 1. Jobs are initialized from ALL unbilled transactions (billable AND non-billable), because
   //    the billing engine processes every transaction to allow write-offs on jobs with only
   //    non-billable work to net against the overall total (e.g. a discount job).
   // 2. Only billable transaction amounts contribute to the job's running total.
   // 3. Only write-offs created AFTER the last invoice are included — the billing engine applies
   //    the same date gate via SQL (`created_at >= lastBillDate` on customer_writeoffs).  Using
   //    writeoff_date here was a bug: a writeoff dated retroactively (writeoff_date pre-lastBill)
   //    but ENTERED post-lastBill would be excluded by the audit but included by the engine.
   // 4. Only write-offs on jobs that have at least one unbilled transaction are netted, to avoid
   //    applying old "credit pool" write-offs on fully-billed jobs.
   const lastBillDateMs = lastBillDate ? new Date(lastBillDate).getTime() : null;
   const isPostLastBill = w => {
      if (!lastBillDateMs) return true; // no prior invoice — include all
      const c = w.created_at;
      return c && new Date(c).getTime() >= lastBillDateMs;
   };
   const unbilledByJob = {};
   transactions
      .filter(t => !t.customer_invoice_id && t.customer_job_id)
      .forEach(t => {
         if (!(t.customer_job_id in unbilledByJob)) unbilledByJob[t.customer_job_id] = 0;
         if (t.is_transaction_billable) {
            unbilledByJob[t.customer_job_id] = round2(unbilledByJob[t.customer_job_id] + num(t.total_transaction));
         }
      });
   writeoffs
      .filter(w => !w.customer_invoice_id && w.customer_job_id)
      .filter(isPostLastBill)
      .forEach(w => {
         if (Object.prototype.hasOwnProperty.call(unbilledByJob, w.customer_job_id)) {
            unbilledByJob[w.customer_job_id] = round2(unbilledByJob[w.customer_job_id] - abs(w.writeoff_amount));
         }
      });
   const unbilled_billable_net = round2(Object.values(unbilledByJob).reduce((a, v) => a + v, 0));

   // Invoice-linked write-offs since lastBillDate: the engine treats these as
   // credits on the next bill (they represent the customer either overpaying a
   // prior invoice that we later wrote off, or Jon entering a credit adjustment
   // and tagging it to a specific old invoice).  Audit subtracts them so the
   // balance matches what the engine would charge.  Each one is also flagged as
   // an info-level discrepancy when its linked invoice is already paid_in_full,
   // so the user can see exactly which old paid invoices are generating credits.
   const invoiceLinkedWriteoffsRecent = writeoffs
      .filter(w => w.customer_invoice_id)
      .filter(isPostLastBill);
   const invoice_linked_writeoffs_recent = round2(
      invoiceLinkedWriteoffsRecent.reduce((a, w) => a + abs(w.writeoff_amount), 0)
   );

   // audit_balance now matches the engine's invoiceTotal formula:
   //   outstanding + unbilled_billable_net - unbilled_payments - invoice_linked_writeoffs_recent
   const audit_balance = round2(
      outstanding_invoices + unbilled_billable_net - unbilled_payments - invoice_linked_writeoffs_recent
   );
   const strict_ledger_balance = round2(
      outstanding_invoices + unbilled_billable - unbilled_payments - unbilled_writeoffs
   );
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
         unbilled_billable_net,
         unbilled_payments,
         unbilled_writeoffs,
         audit_balance,
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
         last_bill_date: fmtDate(lastBillDate)
      },
      retainers: retainerSummary,
      invoice_breakdown: invoiceBreakdown,
      discrepancies,
      ledger,
      methodology: {
         description:
            'Independent recomputation from raw customer_invoices, customer_payments, customer_writeoffs, and customer_transactions rows. Does not share code with the app balance engine.',
         audit_balance_formula:
            'outstanding_invoices (newest unpaid parent chain\'s latest-snapshot remaining — the rolling-balance view; older parents whose balance was absorbed by a newer invoice\'s beginning_balance are flagged as stale_rolled_forward_balance discrepancies and NOT double-counted) + unbilled_billable_transactions - unbilled_payments',
         strict_ledger_formula: 'audit_balance - unbilled_writeoffs (treats job-level writeoffs as immediate credits)',
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
