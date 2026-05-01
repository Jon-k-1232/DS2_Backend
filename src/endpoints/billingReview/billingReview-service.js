const listPendingHeldEntries = async (db, accountId, { holdReason = null, timesheetName = null, page = 1, limit = 50 } = {}) => {
   const offset = Math.max(0, (Number(page) - 1) * Number(limit));
   let query = db('timesheet_entries as te')
      .leftJoin('ai_time_tracker_transaction_suggestions as s', 's.timesheet_entry_id', 'te.timesheet_entry_id')
      .leftJoin('customers as sc', 'sc.customer_id', 'te.suggested_customer_id')
      .where({ 'te.account_id': accountId, 'te.is_processed': false, 'te.is_deleted': false })
      .whereNotNull('te.hold_reason')
      .select(
         'te.*',
         's.suggested_general_work_description_id',
         's.suggested_job_category_id',
         's.suggested_job_type_id',
         's.suggested_category as ai_suggested_category',
         's.ai_confidence',
         's.ai_reason',
         's.ai_payload as ai_payload_suggestion',
         's.suggested_customer_display_name',
         'sc.display_name as suggested_customer_display'
      );

   if (holdReason) query = query.andWhere('te.hold_reason', holdReason);
   if (timesheetName) query = query.andWhere('te.timesheet_name', timesheetName);

   const [{ count }] = await db('timesheet_entries')
      .where({ account_id: accountId, is_processed: false, is_deleted: false })
      .whereNotNull('hold_reason')
      .modify(qb => {
         if (holdReason) qb.andWhere('hold_reason', holdReason);
         if (timesheetName) qb.andWhere('timesheet_name', timesheetName);
      })
      .count({ count: '*' });

   const entries = await query.orderBy('te.created_at', 'desc').limit(limit).offset(offset);

   return { entries, total: Number(count || 0), page: Number(page), limit: Number(limit) };
};

const listConsolidatedTransactions = async (db, accountId, { startDate, endDate, customerId = null, employeeUserId = null, page = 1, limit = 200 } = {}) => {
   const offset = Math.max(0, (Number(page) - 1) * Number(limit));
   let query = db('customer_transactions as t')
      .innerJoin('customers as c', 'c.customer_id', 't.customer_id')
      .innerJoin('customer_general_work_descriptions as g', 'g.general_work_description_id', 't.general_work_description_id')
      .leftJoin('users as u', 'u.user_id', 't.logged_for_user_id')
      .leftJoin('customer_invoices as i', 'i.customer_invoice_id', 't.customer_invoice_id')
      .where({ 't.account_id': accountId })
      .andWhere('t.transaction_date', '>=', startDate)
      .andWhere('t.transaction_date', '<=', endDate)
      .select(
         't.*',
         'c.display_name as customer_display_name',
         'g.general_work_description',
         'u.display_name as logged_for_user_display_name',
         'i.invoice_number',
         'i.is_invoice_paid_in_full'
      );

   if (customerId) query = query.andWhere('t.customer_id', customerId);
   if (employeeUserId) query = query.andWhere('t.logged_for_user_id', employeeUserId);

   const transactions = await query.orderBy('t.transaction_date', 'desc').limit(limit).offset(offset);
   const totalSum = transactions.reduce((acc, t) => acc + Number(t.total_transaction || 0), 0);
   return { transactions, totalSum: Math.round(totalSum * 100) / 100, page: Number(page), limit: Number(limit) };
};

const applyHeldEntry = async (db, accountId, entryId, edits, editingUserId) => {
   const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');
   const entry = await db('timesheet_entries')
      .where({ account_id: accountId, timesheet_entry_id: entryId, is_processed: false, is_deleted: false })
      .first();
   if (!entry) {
      const err = new Error('held_entry_not_found_or_already_processed');
      err.code = 'NOT_FOUND';
      throw err;
   }

   const required = ['customer_id', 'customer_job_id', 'general_work_description_id', 'transaction_date', 'logged_for_user_id'];
   for (const field of required) {
      if (edits[field] == null) {
         const err = new Error(`missing_required_field:${field}`);
         err.code = 'MISSING_FIELD';
         err.field = field;
         throw err;
      }
   }

   const employee = await db('users').where({ user_id: edits.logged_for_user_id }).select('billing_rate').first();
   const minutes = Number(edits.duration_minutes ?? entry.duration ?? 0);
   const hours = minutes / 60;
   const unitCost = Number(edits.unit_cost ?? (employee ? employee.billing_rate : 0) ?? 0);
   const totalTransaction = edits.total_transaction != null
      ? Number(edits.total_transaction)
      : Math.round(hours * unitCost * 100) / 100;

   let createdTxn = null;
   await db.transaction(async trx => {
      createdTxn = await addNewTransaction(trx, {
         accountID: accountId,
         customerID: edits.customer_id,
         customerJobID: edits.customer_job_id,
         selectedRetainerID: null,
         customerInvoicesID: edits.customer_invoice_id || null,
         loggedForUserID: edits.logged_for_user_id,
         selectedGeneralWorkDescriptionID: edits.general_work_description_id,
         detailedJobDescription: edits.detailed_work_description || '',
         transactionDate: edits.transaction_date,
         transactionType: edits.transaction_type || 'time',
         quantity: hours,
         unitCost,
         totalTransaction,
         isTransactionBillable: edits.is_transaction_billable !== false,
         isInAdditionToMonthlyCharge: false,
         loggedByUserID: editingUserId,
         note: edits.note || '',
         category: entry.category,
         minutes,
         entity: null,
         timesheetEntryID: entryId,
         aiSuggestion: null,
         selectedGeneralWorkDescription: null
      });

      await trx('timesheet_entries')
         .where({ account_id: accountId, timesheet_entry_id: entryId })
         .update({
            is_processed: true,
            hold_reason: null,
            matched_user_id: edits.logged_for_user_id,
            suggested_customer_id: edits.customer_id
         });

      await trx('ai_time_tracker_transaction_suggestions')
         .where({ timesheet_entry_id: entryId })
         .update({ status: 'applied', updated_at: new Date() });
   });

   return createdTxn;
};

/**
 * Lists timesheet_entry IDs that haven't yet been processed through the
 * Bedrock orchestrator (legacy backlog from before the rewrite, plus any
 * rows that errored out on a previous Bedrock attempt). Used by the
 * "Process pending with AI" button on the Billing Review page so the
 * billing person can clear the backlog without re-uploading every tracker.
 *
 * Modes:
 *   'unprocessed' (default) — never been seen by AI. Picks up legacy_pre_ai,
 *      and any row whose hold_reason was set without ai_attempted_at being
 *      written.
 *   'errored' — just rows that errored on Bedrock. Use after fixing IAM.
 *   'all_held' — every still-held row regardless of why. Use sparingly.
 */
const listEntriesForReprocess = async (db, accountId, { mode = 'unprocessed', limit = 500 } = {}) => {
   let query = db('timesheet_entries')
      .where({ account_id: accountId, is_processed: false, is_deleted: false });

   if (mode === 'unprocessed') {
      query = query.whereNull('ai_attempted_at');
   } else if (mode === 'errored') {
      query = query.where('hold_reason', 'bedrock_error');
   } else if (mode === 'all_held') {
      query = query.whereNotNull('hold_reason');
   } else {
      throw new Error(`unknown reprocess mode: ${mode}`);
   }

   const rows = await query.orderBy('created_at', 'asc').limit(Math.min(Number(limit) || 500, 2000)).select('timesheet_entry_id');
   return rows.map(r => r.timesheet_entry_id);
};

const invoiceAnomalyCheck = async (db, accountId, { customerId, periodStart, periodEnd, lookbackPeriods = 6 }) => {
   const periodStartDate = new Date(periodStart);
   const periodEndDate = new Date(periodEnd);
   const periodMs = periodEndDate.getTime() - periodStartDate.getTime();
   if (!Number.isFinite(periodMs) || periodMs <= 0) return null;

   const lookbackStart = new Date(periodStartDate.getTime() - periodMs * lookbackPeriods);

   const [{ sum_current }] = await db('customer_transactions')
      .where({ account_id: accountId, customer_id: customerId })
      .where('transaction_date', '>=', periodStart)
      .where('transaction_date', '<=', periodEnd)
      .sum({ sum_current: 'total_transaction' });

   const [{ sum_lookback }] = await db('customer_transactions')
      .where({ account_id: accountId, customer_id: customerId })
      .where('transaction_date', '>=', lookbackStart.toISOString().slice(0, 10))
      .where('transaction_date', '<', periodStart)
      .sum({ sum_lookback: 'total_transaction' });

   const current = Number(sum_current || 0);
   const lookbackTotal = Number(sum_lookback || 0);
   const lookbackAvg = lookbackTotal / lookbackPeriods;

   if (lookbackAvg <= 0) {
      return { current, lookbackAvg, ratio: null, flagged: false, reason: 'no_history' };
   }

   const ratio = current / lookbackAvg;
   const flagged = ratio > 2.0 || ratio < 0.5;
   return { current, lookbackAvg, ratio, flagged, reason: flagged ? (ratio > 2 ? 'spike' : 'drop') : 'normal' };
};

module.exports = {
   listPendingHeldEntries,
   listConsolidatedTransactions,
   applyHeldEntry,
   invoiceAnomalyCheck,
   listEntriesForReprocess
};
