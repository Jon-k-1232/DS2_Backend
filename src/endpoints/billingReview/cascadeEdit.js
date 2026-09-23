const aiCategoryTrainingService = require('../aiIntegration/ai-category-training-service');
const aiReviewerCorrectionsService = require('../aiIntegration/ai-reviewer-corrections-service');
const { detectAndRedact } = require('../../utils/comprehend');
const { ledgerNow, lockCustomerLedger } = require('../payments/ledger-helpers');

const EDITABLE_FIELDS = Object.freeze([
   'customer_id',
   'customer_job_id',
   'general_work_description_id',
   'transaction_date',
   'quantity',
   'unit_cost',
   'total_transaction',
   'is_transaction_billable',
   'note',
   'detailed_work_description'
]);

// How each editable field is compared/normalised. Knex hands back DATE columns
// as JS Dates and NUMERIC columns as strings, while the UI sends 'YYYY-MM-DD'
// strings and JS numbers — comparing them raw registered phantom changes.
const FIELD_KINDS = Object.freeze({
   customer_id: 'id',
   customer_job_id: 'id',
   general_work_description_id: 'id',
   transaction_date: 'date',
   quantity: 'amount',
   unit_cost: 'amount',
   total_transaction: 'amount',
   is_transaction_billable: 'boolean',
   note: 'text',
   detailed_work_description: 'text'
});

const FIELD_LABELS = Object.freeze({
   customer_id: 'Customer',
   customer_job_id: 'Job',
   general_work_description_id: 'Work description',
   transaction_date: 'Transaction date',
   quantity: 'Quantity',
   unit_cost: 'Rate',
   total_transaction: 'Total',
   is_transaction_billable: 'Billable flag',
   note: 'Note',
   detailed_work_description: 'Detailed description'
});

const ERRORS = Object.freeze({
   NOT_FOUND: 'transaction_not_found',
   INVOICE_LOCKED: 'invoice_locked',
   DATE_OUTSIDE_INVOICE: 'date_outside_invoice_period',
   CUSTOMER_CHANGE_NEEDS_CONFIRM: 'customer_change_needs_confirm',
   RETAINER_NOT_EDITABLE_HERE: 'retainer_not_editable_here',
   JOB_REQUIRED_FOR_CUSTOMER_CHANGE: 'job_required_for_customer_change',
   INVALID_FIELD_VALUE: 'invalid_field_value',
   EDIT_WOULD_CREATE_CREDIT: 'edit_would_create_credit_balance',
   CONCURRENT_EDIT: 'concurrent_edit'
});

// Client-facing text. Keep these free of SQL-looking words ("from <x>",
// "select", "delete", "where", ...) so clientSafeMessage never masks them.
const MESSAGES = Object.freeze({
   NOT_FOUND: 'Transaction not found.',
   ABSORBED: 'This transaction was billed on a statement that has already been rolled into a newer one; post an adjustment on the current statement instead.',
   PAID_IN_FULL: 'This transaction was billed on a statement that is paid in full; enter the difference as a new charge or a write-off so it appears on the next statement instead.',
   INVOICE_MISSING: 'The statement this transaction was billed on could not be found, so its amount cannot be changed here. Contact an administrator.',
   CUSTOMER_CHANGE_NEEDS_CONFIRM: "Changing the customer moves this transaction to another customer's account. Confirm the change to continue.",
   RETAINER_FIELD: 'The retainer on a transaction cannot be changed in Billing Review.',
   RETAINER_FUNDED:
      'This transaction was paid for with a retainer, so its amount, billable flag and customer can only be changed on the Transactions page (the retainer draw has to be adjusted too).',
   JOB_MISSING_FOR_CUSTOMER_CHANGE: 'Changing the customer requires picking a job that belongs to the new customer.',
   JOB_REQUIRED: 'A transaction must stay linked to a job.',
   CUSTOMER_MISSING: "This transaction's customer was not found in this account, so it cannot be edited here. Contact an administrator.",
   CONCURRENT_EDIT: 'This transaction was changed by someone else while it was being saved. Refresh and try again.'
});

// Rows stamped by invoiceService.zeroOutAbsorbedInvoices when a newer bill
// absorbed this chain's balance into its beginning_balance.
const ABSORBED_MARKER = /\[absorbed_by:/;

const MAX_AMOUNT = 99999999.99; // NUMERIC(10,2)

const round2 = n => {
   const x = Number(n);
   if (!Number.isFinite(x)) return 0;
   const r = (Math.sign(x) * Math.round((Math.abs(x) + Number.EPSILON) * 100)) / 100;
   return r === 0 ? 0 : r; // never -0
};

const _ensureNumeric = (val, fallback = 0) => {
   const n = Number(val);
   return Number.isFinite(n) ? n : fallback;
};

const _isBlank = v => v === null || v === undefined || v === '';

const _pad2 = n => String(n).padStart(2, '0');

// Calendar date as 'YYYY-MM-DD'. node-postgres parses DATE columns to LOCAL
// midnight, so Date values use local components (toISOString() would shift the
// day for any server east of UTC). Strings keep the date the caller wrote.
const _toISODate = v => {
   if (_isBlank(v)) return null;
   if (v instanceof Date) {
      if (Number.isNaN(v.getTime())) return null;
      return `${v.getFullYear()}-${_pad2(v.getMonth() + 1)}-${_pad2(v.getDate())}`;
   }
   const s = String(v).trim();
   const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
   if (m) return `${m[1]}-${m[2]}-${m[3]}`;
   const d = new Date(s);
   if (Number.isNaN(d.getTime())) return null;
   return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
};

const _isRealCalendarDate = iso => {
   const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
   if (!m) return false;
   const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
   const dt = new Date(Date.UTC(y, mo - 1, d));
   return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

const _toBool = v => {
   if (v === true || v === false) return v;
   if (v === 1 || v === 0) return v === 1;
   if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 't') return true;
      if (s === 'false' || s === '0' || s === 'f') return false;
   }
   return undefined;
};

const _billableAmount = row => (_toBool(row && row.is_transaction_billable) === true ? round2(_ensureNumeric(row.total_transaction)) : 0);

const _signedAmount = n => `${n < 0 ? '-' : '+'}${Math.abs(n).toFixed(2)}`;

const _todayISO = () => _toISODate(new Date());

const _err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code }, extra);

const _invalid = (field, message) => _err(ERRORS.INVALID_FIELD_VALUE, message, { field });

const _filterToEditable = updates => {
   const out = {};
   if (!updates || typeof updates !== 'object') return out;
   for (const k of EDITABLE_FIELDS) {
      if (k in updates) out[k] = updates[k];
   }
   return out;
};

// True when two values of an editable field mean the same thing.
const _sameValue = (field, a, b) => {
   const kind = FIELD_KINDS[field] || 'text';
   if (kind === 'text') return String(a ?? '') === String(b ?? '');
   if (_isBlank(a) || _isBlank(b)) return _isBlank(a) && _isBlank(b);
   if (kind === 'date') {
      const da = _toISODate(a);
      const dbb = _toISODate(b);
      return da && dbb ? da === dbb : String(a) === String(b);
   }
   if (kind === 'boolean') {
      const ba = _toBool(a);
      const bb = _toBool(b);
      return ba !== undefined && bb !== undefined ? ba === bb : String(a) === String(b);
   }
   const na = Number(a);
   const nb = Number(b);
   if (Number.isFinite(na) && Number.isFinite(nb)) return kind === 'amount' ? round2(na) === round2(nb) : na === nb;
   return String(a) === String(b);
};

const _diffFields = (original, next) => {
   const diff = {};
   for (const k of Object.keys(next)) {
      if (!_sameValue(k, original[k], next[k])) {
         diff[k] = FIELD_KINDS[k] === 'date' ? { from: _toISODate(original[k]) ?? original[k], to: _toISODate(next[k]) ?? next[k] } : { from: original[k], to: next[k] };
      }
   }
   return diff;
};

// Validate + canonicalise the requested values (throws invalid_field_value).
const _normalizeUpdates = filtered => {
   const out = {};
   for (const [field, raw] of Object.entries(filtered)) {
      const label = FIELD_LABELS[field] || field;
      switch (FIELD_KINDS[field]) {
         case 'id': {
            if (_isBlank(raw)) {
               // A null job is caught later (only a CHANGE to null is refused —
               // a handful of legacy rows already have no job).
               if (field === 'customer_job_id') {
                  out[field] = null;
                  break;
               }
               throw _invalid(field, `${label} is required.`);
            }
            const n = Number(raw);
            if (!Number.isInteger(n) || n <= 0) throw _invalid(field, `${label} must be a valid id.`);
            out[field] = n;
            break;
         }
         case 'date': {
            const iso = _toISODate(raw);
            if (!iso || !_isRealCalendarDate(iso)) throw _invalid(field, `${label} must be a valid date (YYYY-MM-DD).`);
            out[field] = iso;
            break;
         }
         case 'amount': {
            if (_isBlank(raw)) throw _invalid(field, `${label} is required.`);
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) throw _invalid(field, `${label} must be a number between 0 and ${MAX_AMOUNT}.`);
            out[field] = round2(n);
            break;
         }
         case 'boolean': {
            const b = _toBool(raw);
            if (b === undefined) throw _invalid(field, `${label} must be true or false.`);
            out[field] = b;
            break;
         }
         default: {
            if (raw !== null && raw !== undefined && typeof raw === 'object') throw _invalid(field, `${label} must be text.`);
            out[field] = raw === null || raw === undefined ? null : String(raw);
         }
      }
   }
   return out;
};

/**
 * DEPRECATED — do not use for edits. Kept exported only so older callers fail
 * loudly in review rather than silently changing behaviour.
 *
 * Recomputing an invoice from scratch is wrong for this ledger:
 *  - it sums NON-billable transactions into total_charges (the engine bills
 *    billable only);
 *  - the engine folds job-level write-downs into total_charges, so a rebuild
 *    wipes them (INV-2026-00290 would jump from $105 to $2,759);
 *  - it assumes total_payments is a negative net, but most legacy parents store
 *    a POSITIVE magnitude (918 of 1,214 in prod), so the remaining balance it
 *    derives is wrong for those rows;
 *  - it updates only the parent row, while the engine and audit read the
 *    chain's latest child snapshot.
 * applyTransactionEdit now posts the billable-amount delta via _applyInvoiceDelta.
 */
const _recomputeInvoiceTotals = async (trx, accountId, invoiceId) => {
   const [{ sum_total_charges }] = await trx('customer_transactions')
      .where({ account_id: accountId, customer_invoice_id: invoiceId })
      .sum({ sum_total_charges: 'total_transaction' });
   const totalCharges = Number(sum_total_charges || 0);

   const invoice = await trx('customer_invoices').where({ customer_invoice_id: invoiceId }).first();
   if (!invoice) return null;

   const beginningBalance = Number(invoice.beginning_balance || 0);
   const totalPayments = Number(invoice.total_payments || 0);
   const totalWriteOffs = Number(invoice.total_write_offs || 0);
   const totalRetainers = Number(invoice.total_retainers || 0);
   const totalAmountDue = Math.round((beginningBalance + totalCharges + totalWriteOffs + totalRetainers) * 100) / 100;
   const remainingBalance = Math.round((totalAmountDue + totalPayments) * 100) / 100;

   await trx('customer_invoices').where({ customer_invoice_id: invoiceId }).update({
      total_charges: totalCharges,
      total_amount_due: totalAmountDue,
      remaining_balance_on_invoice: remainingBalance
   });

   return {
      invoiceId,
      totalCharges,
      totalAmountDue,
      remainingBalance,
      delta: totalCharges - Number(invoice.total_charges || 0)
   };
};

const _recomputeJobTotal = async (trx, accountId, customerJobId) => {
   if (!customerJobId) return null;
   const [{ sum_job_total }] = await trx('customer_transactions')
      .where({ account_id: accountId, customer_job_id: customerJobId })
      .sum({ sum_job_total: 'total_transaction' });
   const total = Number(sum_job_total || 0);
   await trx('customer_jobs').where({ customer_job_id: customerJobId, account_id: accountId }).update({ current_job_total: total });
   return { customerJobId, total };
};

/**
 * Load the invoice chain a transaction is billed on: the row it is linked to,
 * the chain's ROOT parent and the chain's latest child snapshot (the row whose
 * remaining balance the engine and the audit treat as authoritative).
 * With { lock: true } the root and latest rows are read FOR UPDATE.
 */
const _loadChain = async (q, accountId, linkedInvoiceId, { lock = false } = {}) => {
   const linked = await q('customer_invoices').where({ account_id: accountId, customer_invoice_id: linkedInvoiceId }).first();
   if (!linked) return null;
   const rootId = linked.parent_invoice_id || linked.customer_invoice_id;

   let rootQuery = q('customer_invoices').where({ account_id: accountId, customer_invoice_id: rootId });
   if (lock) rootQuery = rootQuery.forUpdate();
   const root = await rootQuery.first();
   if (!root) return null;

   let latestQuery = q('customer_invoices')
      .where({ account_id: accountId, parent_invoice_id: rootId })
      .orderBy([
         { column: 'created_at', order: 'desc', nulls: 'last' },
         { column: 'customer_invoice_id', order: 'desc' }
      ]);
   if (lock) latestQuery = latestQuery.forUpdate();
   const latest = (await latestQuery.first()) || null;

   return { linked, root, latest };
};

// A newer PARENT statement for the same customer means this chain's balance was
// rolled into that statement's beginning_balance.
const _findNewerParent = (q, accountId, root) => {
   const rootDate = _toISODate(root.invoice_date);
   return q('customer_invoices')
      .where({ account_id: accountId, customer_id: root.customer_id })
      .whereNull('parent_invoice_id')
      .whereNot('customer_invoice_id', root.customer_invoice_id)
      .andWhere(function newerThanRoot() {
         if (root.created_at) this.where('created_at', '>', root.created_at);
         if (rootDate) this.orWhere('invoice_date', '>', rootDate);
      })
      .first('customer_invoice_id', 'invoice_number');
};

/**
 * Refuse a billable-amount change the ledger cannot absorb in place:
 *  - the chain was rolled into a newer statement (absorbed);
 *  - the chain is paid in full;
 *  - the change would push the chain's balance below zero (the engine drops
 *    negative remainders, so the credit would silently vanish next cycle).
 */
const _assertChainAcceptsDelta = async (q, accountId, chain, delta, linkedInvoiceId) => {
   const { root, latest } = chain;
   const invoiceId = linkedInvoiceId || root.customer_invoice_id;
   const absorbedByNote = ABSORBED_MARKER.test(root.notes || '') || ABSORBED_MARKER.test((latest && latest.notes) || '');
   const newerParent = absorbedByNote ? null : await _findNewerParent(q, accountId, root);
   if (absorbedByNote || newerParent) {
      throw _err(ERRORS.INVOICE_LOCKED, MESSAGES.ABSORBED, {
         invoiceId,
         invoiceNumber: root.invoice_number,
         reason: 'absorbed',
         absorbedBy: newerParent ? newerParent.invoice_number : null
      });
   }

   const authoritative = latest || root;
   if (_toBool(authoritative.is_invoice_paid_in_full) === true || _toBool(root.is_invoice_paid_in_full) === true) {
      throw _err(ERRORS.INVOICE_LOCKED, MESSAGES.PAID_IN_FULL, { invoiceId, invoiceNumber: root.invoice_number, reason: 'paid_in_full' });
   }

   const current = round2(_ensureNumeric(authoritative.remaining_balance_on_invoice));
   const next = round2(current + delta);
   if (delta < 0 && next < 0) {
      throw _err(
         ERRORS.EDIT_WOULD_CREATE_CREDIT,
         `This change would leave statement ${root.invoice_number || `#${root.customer_invoice_id}`} with a credit of $${Math.abs(next).toFixed(2)} because payments already exceed the new total. Record a write-off or credit on the current statement instead.`,
         { invoiceId, invoiceNumber: root.invoice_number, remainingBalance: current, delta }
      );
   }
};

/**
 * Post a billable-amount change to an invoice chain as a ledger event.
 *
 * Inserts a NEW child snapshot (copied from the chain's latest row, remaining
 * += delta, notes stamped with an adjustment marker) instead of editing an
 * existing snapshot in place — if a payment snapshot were adjusted in place and
 * that payment was later deleted, the previous snapshot would become
 * authoritative again and the adjustment would silently disappear.
 *
 * The ROOT parent (the mirror AR reads) gets total_charges / total_amount_due /
 * remaining_balance_on_invoice += delta. Paid flags on both rows derive from the
 * chain's new authoritative remaining. total_payments is never computed or
 * changed: legacy parents store it as a positive magnitude, new ones as a
 * negative net (the new snapshot carries the latest row's value verbatim).
 */
const _applyInvoiceDelta = async (q, { accountId, chain, delta, transactionId, editingUserId = null }) => {
   const { root, latest } = chain;
   const base = latest || root;

   const newRemaining = round2(_ensureNumeric(base.remaining_balance_on_invoice) + delta);
   const newTotalCharges = round2(_ensureNumeric(root.total_charges) + delta);
   const newTotalAmountDue = round2(_ensureNumeric(root.total_amount_due) + delta);
   const newParentRemaining = round2(_ensureNumeric(root.remaining_balance_on_invoice) + delta);
   const isPaidInFull = newRemaining === 0;
   const fullyPaidDate = isPaidInFull ? _todayISO() : null;

   const marker = `[adjustment: transaction #${transactionId} Δ${_signedAmount(delta)}]`;
   const { customer_invoice_id: _baseId, created_at: _baseCreatedAt, ...copied } = base;
   const snapshotRow = {
      ...copied,
      parent_invoice_id: root.customer_invoice_id,
      // clock_timestamp() — the clock every payment / write-off snapshot is
      // stamped with (ledgerNow): wall time at INSERT, after the ledger lock was
      // granted. The column default now() is the transaction's BEGIN time, so a
      // reviewer save that waited on the lock while a payment committed would
      // stamp its snapshot BEFORE the payment snapshot it was built on, and every
      // latest-snapshot reader (created_at DESC, id DESC) would skip it.
      created_at: ledgerNow(q),
      total_charges: newTotalCharges,
      total_amount_due: newTotalAmountDue,
      remaining_balance_on_invoice: newRemaining,
      is_invoice_paid_in_full: isPaidInFull,
      fully_paid_date: fullyPaidDate,
      created_by_user_id: Number(editingUserId) > 0 ? Number(editingUserId) : base.created_by_user_id,
      notes: base.notes ? `${base.notes} ${marker}` : marker
   };
   const insertedRows = await q('customer_invoices').insert(snapshotRow).returning('*');
   const inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;

   await q('customer_invoices').where({ account_id: accountId, customer_invoice_id: root.customer_invoice_id }).update({
      total_charges: newTotalCharges,
      total_amount_due: newTotalAmountDue,
      remaining_balance_on_invoice: newParentRemaining,
      is_invoice_paid_in_full: isPaidInFull,
      fully_paid_date: fullyPaidDate
   });

   return {
      invoiceId: root.customer_invoice_id,
      invoiceNumber: root.invoice_number || null,
      snapshotInvoiceId: inserted && inserted.customer_invoice_id != null ? inserted.customer_invoice_id : null,
      delta,
      totalCharges: newTotalCharges,
      totalAmountDue: newTotalAmountDue,
      remainingBalance: newRemaining,
      parentRemainingBalance: newParentRemaining,
      isPaidInFull
   };
};

const _assertDateInsidePeriod = (chain, newDate, linkedInvoiceId) => {
   const start = _toISODate(chain.root.start_date);
   const end = _toISODate(chain.root.end_date);
   if (!start || !end || !newDate) return;
   if (newDate < start || newDate > end) {
      throw _err(
         ERRORS.DATE_OUTSIDE_INVOICE,
         `${newDate} is outside the billing period of statement ${chain.root.invoice_number || `#${chain.root.customer_invoice_id}`} (${start} to ${end}). Choose a date inside that period.`,
         { invoiceId: linkedInvoiceId, periodStart: start, periodEnd: end }
      );
   }
};

// Customer / job / work-description ids must belong to this account, and the
// job must belong to the transaction's (new) customer.
const _validateReferences = async (db, { accountId, original, requested, diff, customerChanged }) => {
   const effectiveCustomerId = customerChanged ? requested.customer_id : Number(original.customer_id);

   if (customerChanged) {
      const customer = await db('customers').where({ customer_id: requested.customer_id, account_id: accountId }).first();
      if (!customer) throw _invalid('customer_id', `Customer #${requested.customer_id} was not found in this account.`);

      const jobId = 'customer_job_id' in requested ? requested.customer_job_id : null;
      if (jobId == null) {
         throw _err(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE, MESSAGES.JOB_MISSING_FOR_CUSTOMER_CHANGE, { field: 'customer_job_id' });
      }
      const job = await db('customer_jobs').where({ customer_job_id: jobId, account_id: accountId }).first();
      if (!job || Number(job.customer_id) !== Number(effectiveCustomerId)) {
         throw _err(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE, `Job #${jobId} does not belong to the new customer. Pick a job that belongs to the new customer.`, {
            field: 'customer_job_id'
         });
      }
   } else if ('customer_job_id' in diff) {
      if (requested.customer_job_id == null) throw _invalid('customer_job_id', MESSAGES.JOB_REQUIRED);
      const job = await db('customer_jobs').where({ customer_job_id: requested.customer_job_id, account_id: accountId }).first();
      if (!job || Number(job.customer_id) !== Number(effectiveCustomerId)) {
         throw _invalid('customer_job_id', `Job #${requested.customer_job_id} does not belong to this transaction's customer.`);
      }
   }

   if ('general_work_description_id' in diff) {
      const gwd = await db('customer_general_work_descriptions')
         .where({ general_work_description_id: requested.general_work_description_id, account_id: accountId })
         .first();
      if (!gwd) throw _invalid('general_work_description_id', `Work description #${requested.general_work_description_id} was not found in this account.`);
   }
};

const _sanitizeNotes = async rawNotes => {
   if (!rawNotes) return null;
   try {
      const { redacted } = await detectAndRedact(rawNotes, { knownNames: [] });
      return redacted;
   } catch (redactErr) {
      // Comprehend failed — skip notes rather than leak raw text
      return null;
   }
};

// Run optional bookkeeping (AI learning rows) inside a SAVEPOINT: a failed
// insert must not abort the surrounding ledger transaction.
const _inSavepoint = async (trx, label, fn) => {
   try {
      return typeof trx.transaction === 'function' ? await trx.transaction(fn) : await fn(trx);
   } catch (e) {
      console.error(`[cascadeEdit] ${label} failed:`, e.message);
      return null;
   }
};

const _labelForField = async (q, fieldName, value) => {
   if (value == null) return null;
   try {
      if (fieldName === 'general_work_description_id') {
         const r = await q('customer_general_work_descriptions').where({ general_work_description_id: value }).select('general_work_description').first();
         return r ? r.general_work_description : null;
      }
      if (fieldName === 'customer_id') {
         const r = await q('customers').where({ customer_id: value }).select('display_name').first();
         return r ? r.display_name : null;
      }
      if (fieldName === 'customer_job_id') {
         const r = await q('customer_jobs as cj')
            .leftJoin('customer_job_types as cjt', 'cjt.job_type_id', 'cj.job_type_id')
            .where({ 'cj.customer_job_id': value })
            .select('cjt.job_description')
            .first();
         return r ? r.job_description : null;
      }
   } catch {
      /* label lookup failure is non-fatal */
   }
   return null;
};

const _readTransaction = (q, accountId, transactionId, { lock = false } = {}) => {
   let query = q('customer_transactions').where({ account_id: accountId, transaction_id: transactionId });
   if (lock) query = query.forUpdate();
   return query.first();
};

/**
 * What an edit changes, computed from ONE read of the stored row: the fields
 * that really change (after normalising), the customer / job moves and the
 * billable-amount delta for the linked statement. Throws the request-level
 * refusals (unconfirmed customer change, amount change on retainer-funded
 * work). Returns null when nothing changes. `requested` is never mutated.
 */
const _planEdit = (original, requested, confirmCustomerChange) => {
   // A quantity/rate change re-prices the row unless the reviewer also changed
   // the total explicitly. Keyed on real changes: the UI sends every field on
   // every save, so a stale-but-unchanged quantity must not re-price the row.
   const next = { ...requested };
   let diff = _diffFields(original, next);
   if (!('total_transaction' in diff) && ('quantity' in diff || 'unit_cost' in diff)) {
      const q = 'quantity' in next ? next.quantity : _ensureNumeric(original.quantity);
      const u = 'unit_cost' in next ? next.unit_cost : _ensureNumeric(original.unit_cost);
      next.total_transaction = round2(q * u);
      diff = _diffFields(original, next);
   }
   if (Object.keys(diff).length === 0) return null;

   // Only changed fields are written.
   const changes = {};
   for (const k of Object.keys(diff)) changes[k] = next[k];

   const customerChanged = 'customer_id' in diff;
   if (customerChanged && !confirmCustomerChange) {
      throw _err(ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM, MESSAGES.CUSTOMER_CHANGE_NEEDS_CONFIRM);
   }

   // Retainer-funded work drew the retainer (and posted an auto 'Retainer'
   // payment) for exactly this amount/customer; changing either here would
   // leave the draw out of step.
   if (original.retainer_id && (customerChanged || 'total_transaction' in diff || 'is_transaction_billable' in diff)) {
      throw _err(ERRORS.RETAINER_NOT_EDITABLE_HERE, MESSAGES.RETAINER_FUNDED);
   }

   const linkedInvoiceId = original.customer_invoice_id || null;
   // Moving the transaction to another customer takes it off this statement entirely.
   const delta = linkedInvoiceId ? round2((customerChanged ? 0 : _billableAmount({ ...original, ...changes })) - _billableAmount(original)) : 0;

   return {
      requested: next,
      diff,
      changes,
      customerChanged,
      jobChanged: 'customer_job_id' in diff,
      linkedInvoiceId,
      delta,
      dateCheckNeeded: Boolean(linkedInvoiceId) && !customerChanged && 'transaction_date' in diff
   };
};

// ── ledger locking ───────────────────────────────────────────────────────────
// A billed transaction's amount lives in its statement chain, and every other
// ledger writer (payments, write-offs, retainers, finalize, invoice delete)
// serializes on the CUSTOMER row lock (lockCustomerLedger). The edit takes the
// same lock(s) first — ascending customer id, the order finalize uses, so two
// multi-customer lockers can never deadlock — and only then reads the row and
// the chain it plans from.

const MAX_LOCK_ATTEMPTS = 3;
const RELOCK = Symbol('cascadeEdit.relock');

// The customers whose ledgers were locked no longer cover the row as re-read
// under the lock (it moved to another customer meanwhile, or is billed on
// another customer's statement). Roll back — releasing every lock — and retry
// with the full set, still in ascending order.
const _relock = customerIds => Object.assign(new Error('cascade edit: customer lock set changed'), { [RELOCK]: customerIds });

// Ledgers an edit of `row` moves money on: the row's own customer and, for a
// customer change, the customer it moves to.
const _ledgerCustomers = (row, requested) => {
   const ids = [Number(row.customer_id)];
   if ('customer_id' in requested && !_sameValue('customer_id', row.customer_id, requested.customer_id)) ids.push(Number(requested.customer_id));
   return ids;
};

const _lockLedgers = async (trx, accountId, customerIds, requestedCustomerId) => {
   const ids = [...new Set(customerIds.map(Number))].filter(id => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
   for (const id of ids) {
      try {
         await lockCustomerLedger(trx, accountId, id);
      } catch (e) {
         if (!e || !e.isLedgerRule) throw e;
         // No such customer in this account (tenancy is checked by the lock).
         if (id === requestedCustomerId) throw _invalid('customer_id', `Customer #${id} was not found in this account.`);
         throw _err(ERRORS.NOT_FOUND, MESSAGES.CUSTOMER_MISSING);
      }
   }
   return new Set(ids);
};

/**
 * The ledger half of an edit, run inside the transaction: lock, re-read,
 * re-plan, validate, write. Nothing computed before the lock is trusted — two
 * reviewers saving the same row serialize here, and the second one's delta is
 * computed from the first one's result.
 */
const _applyLockedEdit = async (trx, ctx) => {
   const { accountId, transactionId, requested, confirmCustomerChange, editingUserId, lockIds, previewNotes, sanitizedPreviewNotes } = ctx;

   // 1. Customer ledger lock(s) FIRST.
   const requestedCustomerId = 'customer_id' in requested ? requested.customer_id : null;
   const locked = await _lockLedgers(trx, accountId, lockIds, requestedCustomerId);

   // 2. Re-read the row under the lock; every decision below uses these values.
   const original = await _readTransaction(trx, accountId, transactionId, { lock: true });
   if (!original) throw _err(ERRORS.NOT_FOUND, MESSAGES.NOT_FOUND);
   const needed = _ledgerCustomers(original, requested);
   if (!needed.every(id => locked.has(id))) throw _relock([...locked, ...needed]);

   const plan = _planEdit(original, requested, confirmCustomerChange);
   if (!plan) return { updatedTransaction: original, sideEffects: [], diff: {} };
   const { diff, changes, customerChanged, jobChanged, linkedInvoiceId, delta, dateCheckNeeded } = plan;

   await _validateReferences(trx, { accountId, original, requested: plan.requested, diff, customerChanged });

   // 3. Chain state, read FOR UPDATE only when the edit needs it (a period
   //    check or a ledger delta) — a note edit never reads the statement.
   let chain = null;
   if (dateCheckNeeded || delta !== 0) {
      chain = await _loadChain(trx, accountId, linkedInvoiceId, { lock: true });
      if (chain && dateCheckNeeded) _assertDateInsidePeriod(chain, changes.transaction_date, linkedInvoiceId);
   }
   if (delta !== 0) {
      if (!chain) throw _err(ERRORS.INVOICE_LOCKED, MESSAGES.INVOICE_MISSING, { invoiceId: linkedInvoiceId, reason: 'invoice_missing' });
      // The statement's own ledger must be locked too (legacy rows can be
      // billed on another customer's statement).
      const chainCustomerId = Number(chain.root.customer_id);
      if (!locked.has(chainCustomerId)) throw _relock([...locked, chainCustomerId]);
      await _assertChainAcceptsDelta(trx, accountId, chain, delta, linkedInvoiceId);
   }

   // 4. Writes.
   const nextRow = { ...changes };
   if (customerChanged && linkedInvoiceId) nextRow.customer_invoice_id = null;
   await trx('customer_transactions').where({ account_id: accountId, transaction_id: transactionId }).update(nextRow);
   const updated = await _readTransaction(trx, accountId, transactionId);

   const sideEffects = [];
   if (delta !== 0) {
      const applied = await _applyInvoiceDelta(trx, { accountId, chain, delta, transactionId, editingUserId });
      sideEffects.push({ type: customerChanged ? 'old_invoice_recalculated_after_customer_change' : 'invoice_recalculated', mode: 'delta', ...applied });
   }
   if (customerChanged && linkedInvoiceId) {
      sideEffects.push({ type: 'transaction_unlinked_from_invoice', transactionId, invoiceId: linkedInvoiceId });
   }

   const jobTotalsMoved = customerChanged || jobChanged || 'total_transaction' in diff;
   if (original.customer_job_id && jobTotalsMoved) {
      const recomputedOldJob = await _recomputeJobTotal(trx, accountId, original.customer_job_id);
      if (recomputedOldJob) sideEffects.push({ type: 'old_job_recalculated', ...recomputedOldJob });
   }
   if (updated.customer_job_id && Number(updated.customer_job_id) !== Number(original.customer_job_id)) {
      const recomputedNewJob = await _recomputeJobTotal(trx, accountId, updated.customer_job_id);
      if (recomputedNewJob) sideEffects.push({ type: 'new_job_recalculated', ...recomputedNewJob });
   }

   // Redacted before the lock was taken (never hold the ledger lock across a
   // Comprehend call); only valid while the stored notes are still those.
   const sanitizedNotes = String(original.detailed_work_description ?? '') === String(previewNotes ?? '') ? sanitizedPreviewNotes : null;

   // Capture every changed editable field as a reviewer correction so the AI can
   // learn from manual edits to ANY field (customer, job, billable, work description).
   const correctionsWritten = await _inSavepoint(trx, 'reviewer corrections write', async sp => {
      for (const fieldName of Object.keys(diff)) {
         const originalLabel = await _labelForField(sp, fieldName, original[fieldName]);
         const finalLabel = await _labelForField(sp, fieldName, updated[fieldName]);
         await aiReviewerCorrectionsService.insert(sp, {
            accountId,
            transactionId,
            timesheetEntryId: null,
            reviewerUserId: editingUserId || null,
            fieldName,
            originalValue: FIELD_KINDS[fieldName] === 'date' ? _toISODate(original[fieldName]) : original[fieldName],
            finalValue: FIELD_KINDS[fieldName] === 'date' ? _toISODate(updated[fieldName]) : updated[fieldName],
            originalLabel,
            finalLabel,
            sanitizedNotes
         });
      }
      return true;
   });
   if (correctionsWritten) sideEffects.push({ type: 'reviewer_corrections_written', transactionId, fields: Object.keys(diff) });

   // Keep writing to the legacy ai_category_training_examples for work_desc changes —
   // it still feeds _loadFewShots.
   if ('general_work_description_id' in diff) {
      const trainingWritten = await _inSavepoint(trx, 'training example write', async sp => {
         const newGwdLabel = await sp('customer_general_work_descriptions')
            .where({ general_work_description_id: updated.general_work_description_id })
            .select('general_work_description')
            .first();
         const oldGwdLabel = await sp('customer_general_work_descriptions')
            .where({ general_work_description_id: original.general_work_description_id })
            .select('general_work_description')
            .first();
         await aiCategoryTrainingService.insert(sp, {
            account_id: accountId,
            timesheet_entry_id: null,
            transaction_id: transactionId,
            original_category: oldGwdLabel ? oldGwdLabel.general_work_description : String(original.general_work_description_id),
            suggested_category: oldGwdLabel ? oldGwdLabel.general_work_description : String(original.general_work_description_id),
            final_category: newGwdLabel ? newGwdLabel.general_work_description : String(updated.general_work_description_id),
            ai_reason: null,
            ai_confidence: null,
            ai_source: 'reviewer_edit',
            original_notes: null,
            sanitized_notes: sanitizedNotes,
            duration_minutes: original.minutes || null,
            entity: null,
            uploaded_to_vector_store: false
         });
         return true;
      });
      if (trainingWritten) sideEffects.push({ type: 'training_example_written', transactionId });
   }

   return { updatedTransaction: updated, sideEffects, diff };
};

/**
 * Apply a reviewer edit to a customer_transactions row.
 *
 * Only fields that actually CHANGE (after normalising dates/numbers/booleans)
 * are written or checked. When the transaction is billed on an invoice and its
 * BILLABLE amount changes, the difference is posted to the invoice chain as a
 * delta (new adjustment snapshot + parent mirror); non-financial edits (notes,
 * work description, a date inside the billing period, job) never touch invoice
 * rows. Statements that were rolled into a newer one or are paid in full refuse
 * billable-amount changes.
 *
 * Concurrency: the diff, the invoice linkage, the chain state and the delta are
 * all computed inside the transaction AFTER the customer ledger lock(s) are held
 * and the row is re-read FOR UPDATE. The unlocked read up front only picks the
 * ledgers to lock and short-circuits no-ops / request-level refusals before the
 * Comprehend call.
 *
 * @param {object} args
 * @param {object} args.db                 - knex instance (uses internal transaction)
 * @param {number} args.accountId
 * @param {number} args.transactionId
 * @param {object} args.updates            - partial customer_transactions fields
 * @param {boolean} args.confirmCustomerChange  - required when changing customer_id
 * @param {number} args.editingUserId      - user_id of the reviewer making the edit
 * @returns {Promise<{updatedTransaction, sideEffects, diff}>} or throws an Error with .code
 */
const applyTransactionEdit = async ({ db, accountId, transactionId, updates = {}, confirmCustomerChange = false, editingUserId }) => {
   // Unlocked preview — NOT authoritative (see _applyLockedEdit).
   const preview = await _readTransaction(db, accountId, transactionId);
   if (!preview) throw _err(ERRORS.NOT_FOUND, MESSAGES.NOT_FOUND);

   const safeUpdates = updates && typeof updates === 'object' && !Array.isArray(updates) ? updates : {};
   if ('retainer_id' in safeUpdates) throw _err(ERRORS.RETAINER_NOT_EDITABLE_HERE, MESSAGES.RETAINER_FIELD);

   const requested = _normalizeUpdates(_filterToEditable(safeUpdates));
   if (!_planEdit(preview, requested, confirmCustomerChange)) {
      return { updatedTransaction: preview, sideEffects: [], diff: {} };
   }

   const previewNotes = preview.detailed_work_description;
   const sanitizedPreviewNotes = await _sanitizeNotes(previewNotes);

   let lockIds = _ledgerCustomers(preview, requested);
   for (let attempt = 1; ; attempt += 1) {
      try {
         return await db.transaction(trx =>
            _applyLockedEdit(trx, { accountId, transactionId, requested, confirmCustomerChange, editingUserId, lockIds, previewNotes, sanitizedPreviewNotes })
         );
      } catch (e) {
         if (!(e && e[RELOCK])) throw e;
         if (attempt >= MAX_LOCK_ATTEMPTS) throw _err(ERRORS.CONCURRENT_EDIT, MESSAGES.CONCURRENT_EDIT);
         lockIds = e[RELOCK];
      }
   }
};

module.exports = {
   applyTransactionEdit,
   EDITABLE_FIELDS,
   ERRORS,
   MESSAGES,
   _filterToEditable,
   _diffFields,
   _normalizeUpdates,
   _toISODate,
   _loadChain,
   _assertChainAcceptsDelta,
   _applyInvoiceDelta,
   _recomputeInvoiceTotals,
   _recomputeJobTotal
};
