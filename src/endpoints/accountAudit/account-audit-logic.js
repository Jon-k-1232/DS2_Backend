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

const detectDiscrepancies = ({ invoiceBreakdown, payments, writeoffs, transactions, lastBillDate }) => {
   const out = [];

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

const buildChronologicalLedger = ({ invoices, payments, writeoffs, transactions }) => {
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

   payments.forEach(p => {
      events.push({
         date: fmtDate(p.payment_date),
         sort_ts: new Date(p.payment_date).getTime(),
         type: 'payment',
         description: `Payment${p.form_of_payment ? ` (${p.form_of_payment})` : ''}${p.payment_reference_number ? ` #${p.payment_reference_number}` : ''}`,
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
         transaction_billed: 0,
         transaction_unbilled: 0,
         transaction_nonbillable: 0,
         invoice_issued: 1,
         payment: 2,
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

const auditCustomerLedger = ({ customer, invoices, payments, writeoffs, transactions }) => {
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
   const total_invoiced = round2(parentInvoices.reduce((a, i) => a + num(i.total_amount_due), 0));
   const total_paid = round2(payments.reduce((a, p) => a + abs(p.payment_amount), 0));
   const total_writeoffs = round2(writeoffs.reduce((a, w) => a + abs(w.writeoff_amount), 0));
   const total_transactions = round2(transactions.reduce((a, t) => a + num(t.total_transaction), 0));
   const total_billable_transactions = round2(
      transactions.filter(t => t.is_transaction_billable).reduce((a, t) => a + num(t.total_transaction), 0)
   );

   const outstanding_invoices = round2(
      invoiceBreakdown.reduce((a, r) => a + Math.max(0, r.actual_remaining_used), 0)
   );
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

   const audit_balance = round2(outstanding_invoices + unbilled_billable - unbilled_payments);
   const strict_ledger_balance = round2(
      outstanding_invoices + unbilled_billable - unbilled_payments - unbilled_writeoffs
   );
   const net_position_lifetime = round2(total_invoiced + unbilled_billable - total_paid - total_writeoffs);

   const lastBillDate = parentInvoices.length
      ? parentInvoices.map(i => i.invoice_date).sort().slice(-1)[0]
      : null;

   const discrepancies = detectDiscrepancies({
      invoiceBreakdown,
      payments,
      writeoffs,
      transactions,
      lastBillDate
   });

   const ledger = buildChronologicalLedger({ invoices, payments, writeoffs, transactions });

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
         unbilled_payments,
         unbilled_writeoffs,
         audit_balance,
         strict_ledger_balance,
         net_position_lifetime,
         counts: {
            parent_invoices: parentInvoices.length,
            invoice_snapshots: invoices.length - parentInvoices.length,
            payments: payments.length,
            writeoffs: writeoffs.length,
            transactions: transactions.length
         },
         last_bill_date: fmtDate(lastBillDate)
      },
      invoice_breakdown: invoiceBreakdown,
      discrepancies,
      ledger,
      methodology: {
         description:
            'Independent recomputation from raw customer_invoices, customer_payments, customer_writeoffs, and customer_transactions rows. Does not share code with the app balance engine.',
         audit_balance_formula:
            'outstanding_invoices (sum of latest-child remaining per invoice chain, floored at 0) + unbilled_billable_transactions - unbilled_payments',
         strict_ledger_formula: 'audit_balance - unbilled_writeoffs (treats job-level writeoffs as immediate credits)',
         net_position_formula:
            'total_invoiced + unbilled_billable - total_paid - total_writeoffs (lifetime net, ignores invoice linkage)',
         ledger_basis:
            'Transaction-based — every billable transaction is a charge on its transaction_date (whether or not it was later invoiced). Invoices appear as informational markers and do NOT change the running balance, since the underlying transactions already did. The ledger therefore spans the customer\'s full history from their first transaction onward, and the final running balance reflects transactions − payments − writeoffs (not the audit_balance, which uses invoice-snapshot accounting).'
      },
      generated_at: fmtDateTime(new Date())
   };
};

module.exports = { auditCustomerLedger };
