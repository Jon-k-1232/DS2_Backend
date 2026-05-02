const aiCategoryTrainingService = require('../aiIntegration/ai-category-training-service');
const aiReviewerCorrectionsService = require('../aiIntegration/ai-reviewer-corrections-service');
const { detectAndRedact } = require('../../utils/comprehend');

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

const ERRORS = Object.freeze({
   NOT_FOUND: 'transaction_not_found',
   INVOICE_LOCKED: 'invoice_locked',
   DATE_OUTSIDE_INVOICE: 'date_outside_invoice_period',
   CUSTOMER_CHANGE_NEEDS_CONFIRM: 'customer_change_needs_confirm',
   RETAINER_NOT_EDITABLE_HERE: 'retainer_not_editable_here'
});

const _ensureNumeric = (val, fallback = 0) => {
   const n = Number(val);
   return Number.isFinite(n) ? n : fallback;
};

const _filterToEditable = updates => {
   const out = {};
   for (const k of EDITABLE_FIELDS) {
      if (k in updates) out[k] = updates[k];
   }
   return out;
};

const _diffFields = (original, next) => {
   const diff = {};
   for (const k of Object.keys(next)) {
      if (String(original[k] ?? '') !== String(next[k] ?? '')) {
         diff[k] = { from: original[k], to: next[k] };
      }
   }
   return diff;
};

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
   const totalAmountDue = beginningBalance + totalCharges - totalWriteOffs - totalRetainers;
   const remainingBalance = totalAmountDue - totalPayments;

   await trx('customer_invoices')
      .where({ customer_invoice_id: invoiceId })
      .update({
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
   await trx('customer_jobs')
      .where({ customer_job_id: customerJobId, account_id: accountId })
      .update({ current_job_total: total });
   return { customerJobId, total };
};

/**
 * Apply an edit to a finalized customer_transactions row, with full cascade
 * to customer_invoices and customer_jobs. Rejects edits on paid invoices.
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
   const original = await db('customer_transactions')
      .where({ account_id: accountId, transaction_id: transactionId })
      .first();
   if (!original) {
      const err = new Error(ERRORS.NOT_FOUND);
      err.code = ERRORS.NOT_FOUND;
      throw err;
   }

   const filtered = _filterToEditable(updates);
   if ('retainer_id' in updates) {
      const err = new Error(ERRORS.RETAINER_NOT_EDITABLE_HERE);
      err.code = ERRORS.RETAINER_NOT_EDITABLE_HERE;
      throw err;
   }

   const linkedInvoiceId = original.customer_invoice_id || null;
   let invoice = null;
   if (linkedInvoiceId) {
      invoice = await db('customer_invoices').where({ customer_invoice_id: linkedInvoiceId }).first();
   }

   const isPaid = invoice && invoice.is_invoice_paid_in_full === true;

   const touchesAmount = ['total_transaction', 'quantity', 'unit_cost', 'is_transaction_billable']
      .some(f => f in filtered);
   if (isPaid && touchesAmount) {
      const err = new Error(ERRORS.INVOICE_LOCKED);
      err.code = ERRORS.INVOICE_LOCKED;
      err.invoiceId = linkedInvoiceId;
      throw err;
   }

   if ('customer_id' in filtered && Number(filtered.customer_id) !== Number(original.customer_id) && !confirmCustomerChange) {
      const err = new Error(ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM);
      err.code = ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM;
      throw err;
   }

   if ('transaction_date' in filtered && invoice && invoice.start_date && invoice.end_date) {
      const newDate = new Date(filtered.transaction_date);
      const start = new Date(invoice.start_date);
      const end = new Date(invoice.end_date);
      if (newDate < start || newDate > end) {
         const err = new Error(ERRORS.DATE_OUTSIDE_INVOICE);
         err.code = ERRORS.DATE_OUTSIDE_INVOICE;
         err.invoiceId = linkedInvoiceId;
         throw err;
      }
   }

   if (!('total_transaction' in filtered) && ('quantity' in filtered || 'unit_cost' in filtered)) {
      const q = _ensureNumeric('quantity' in filtered ? filtered.quantity : original.quantity, 0);
      const u = _ensureNumeric('unit_cost' in filtered ? filtered.unit_cost : original.unit_cost, 0);
      filtered.total_transaction = Math.round(q * u * 100) / 100;
   }

   const diff = _diffFields(original, filtered);
   if (Object.keys(diff).length === 0) {
      return { updatedTransaction: original, sideEffects: [], diff: {} };
   }

   const sideEffects = [];

   const result = await db.transaction(async trx => {
      const customerChanged = 'customer_id' in diff;
      const jobChanged = 'customer_job_id' in diff;
      let nextRow = { ...filtered };

      if (customerChanged) {
         nextRow.customer_invoice_id = null;
         nextRow.customer_job_id = null;
      }

      await trx('customer_transactions')
         .where({ account_id: accountId, transaction_id: transactionId })
         .update(nextRow);

      const updated = await trx('customer_transactions')
         .where({ account_id: accountId, transaction_id: transactionId })
         .first();

      if (linkedInvoiceId && !isPaid) {
         const recomputed = await _recomputeInvoiceTotals(trx, accountId, linkedInvoiceId);
         if (recomputed) sideEffects.push({ type: 'invoice_recalculated', ...recomputed });
      }
      if (customerChanged && original.customer_invoice_id) {
         const recomputed = await _recomputeInvoiceTotals(trx, accountId, original.customer_invoice_id);
         if (recomputed) sideEffects.push({ type: 'old_invoice_recalculated_after_customer_change', ...recomputed });
      }

      if (original.customer_job_id && (jobChanged || customerChanged || touchesAmount)) {
         const recomputedOldJob = await _recomputeJobTotal(trx, accountId, original.customer_job_id);
         if (recomputedOldJob) sideEffects.push({ type: 'old_job_recalculated', ...recomputedOldJob });
      }
      if (updated.customer_job_id && updated.customer_job_id !== original.customer_job_id) {
         const recomputedNewJob = await _recomputeJobTotal(trx, accountId, updated.customer_job_id);
         if (recomputedNewJob) sideEffects.push({ type: 'new_job_recalculated', ...recomputedNewJob });
      }

      // Capture every changed editable field as a reviewer correction so the AI can
      // learn from manual edits to ANY field (customer, job, billable, work description).
      // Run notes through PII redaction so the row is safe to surface in future prompts.
      try {
         const rawNotes = original.detailed_work_description || '';
         let sanitizedNotes = null;
         if (rawNotes) {
            try {
               const { redacted } = await detectAndRedact(rawNotes, { knownNames: [] });
               sanitizedNotes = redacted;
            } catch (redactErr) {
               // Comprehend failed — skip notes rather than leak raw text
               sanitizedNotes = null;
            }
         }

         // Helper to look up display label for FK fields
         const _labelForField = async (fieldName, value) => {
            if (value == null) return null;
            try {
               if (fieldName === 'general_work_description_id') {
                  const r = await trx('customer_general_work_descriptions').where({ general_work_description_id: value }).select('general_work_description').first();
                  return r ? r.general_work_description : null;
               }
               if (fieldName === 'customer_id') {
                  const r = await trx('customers').where({ customer_id: value }).select('display_name').first();
                  return r ? r.display_name : null;
               }
               if (fieldName === 'customer_job_id') {
                  const r = await trx('customer_jobs as cj').leftJoin('customer_job_types as cjt', 'cjt.job_type_id', 'cj.job_type_id').where({ 'cj.customer_job_id': value }).select('cjt.job_description').first();
                  return r ? r.job_description : null;
               }
            } catch { /* label lookup failure is non-fatal */ }
            return null;
         };

         // Capture each diffed field into ai_reviewer_corrections
         for (const fieldName of Object.keys(diff)) {
            const originalLabel = await _labelForField(fieldName, original[fieldName]);
            const finalLabel = await _labelForField(fieldName, updated[fieldName]);
            await aiReviewerCorrectionsService.insert(trx, {
               accountId,
               transactionId,
               timesheetEntryId: null,
               reviewerUserId: editingUserId || null,
               fieldName,
               originalValue: original[fieldName],
               finalValue: updated[fieldName],
               originalLabel,
               finalLabel,
               sanitizedNotes
            });
         }
         sideEffects.push({ type: 'reviewer_corrections_written', transactionId, fields: Object.keys(diff) });
      } catch (e) {
         console.error('[cascadeEdit] reviewer corrections write failed:', e.message);
      }

      // Keep writing to the legacy ai_category_training_examples for work_desc changes —
      // it still feeds _loadFewShots. Now with sanitized_notes captured so the row is
      // actually usable as a few-shot.
      if ('general_work_description_id' in diff) {
         try {
            const rawNotes = original.detailed_work_description || '';
            let sanitizedNotes = null;
            if (rawNotes) {
               try {
                  const { redacted } = await detectAndRedact(rawNotes, { knownNames: [] });
                  sanitizedNotes = redacted;
               } catch (redactErr) {
                  sanitizedNotes = null;
               }
            }
            const newGwdLabel = await trx('customer_general_work_descriptions')
               .where({ general_work_description_id: updated.general_work_description_id })
               .select('general_work_description')
               .first();
            const oldGwdLabel = await trx('customer_general_work_descriptions')
               .where({ general_work_description_id: original.general_work_description_id })
               .select('general_work_description')
               .first();
            await aiCategoryTrainingService.insert(trx, {
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
            sideEffects.push({ type: 'training_example_written', transactionId });
         } catch (e) {
            console.error('[cascadeEdit] training example write failed:', e.message);
         }
      }

      return updated;
   });

   return { updatedTransaction: result, sideEffects, diff };
};

module.exports = {
   applyTransactionEdit,
   EDITABLE_FIELDS,
   ERRORS,
   _filterToEditable,
   _diffFields,
   _recomputeInvoiceTotals,
   _recomputeJobTotal
};
