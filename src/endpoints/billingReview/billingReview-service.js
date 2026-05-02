const listPendingHeldEntries = async (
   db,
   accountId,
   {
      holdReason = null,
      timesheetName = null,
      dateStart = null,
      dateEnd = null,
      entityContains = null,
      employeeContains = null,
      trackerContains = null,
      notesContains = null,
      aiConfMin = null,
      customerId = null,
      employeeUserId = null,
      workDescId = null,
      entityEquals = null,
      sortField = null,
      sortDirection = 'desc',
      page = 1,
      limit = 50
   } = {}
) => {
   const offset = Math.max(0, (Number(page) - 1) * Number(limit));

   const applyFilters = qb => {
      qb = qb
         .where({ 'te.account_id': accountId, 'te.is_processed': false, 'te.is_deleted': false })
         .whereNotNull('te.hold_reason');
      if (holdReason) qb = qb.andWhere('te.hold_reason', holdReason);
      if (timesheetName) qb = qb.andWhere('te.timesheet_name', timesheetName);
      if (dateStart) qb = qb.andWhere('te.date', '>=', dateStart);
      if (dateEnd) qb = qb.andWhere('te.date', '<=', dateEnd);
      if (entityContains) qb = qb.andWhere('te.entity', 'ilike', `%${entityContains}%`);
      if (entityEquals) qb = qb.andWhere('te.entity', entityEquals);
      if (employeeContains) qb = qb.andWhere('te.employee_name', 'ilike', `%${employeeContains}%`);
      if (trackerContains) qb = qb.andWhere('te.timesheet_name', 'ilike', `%${trackerContains}%`);
      if (notesContains) qb = qb.andWhere('te.notes', 'ilike', `%${notesContains}%`);
      if (aiConfMin != null) qb = qb.andWhere('s.ai_confidence', '>=', Number(aiConfMin));
      if (customerId) qb = qb.andWhere('te.suggested_customer_id', customerId);
      if (employeeUserId) qb = qb.andWhere('te.matched_user_id', employeeUserId);
      if (workDescId) qb = qb.andWhere('s.suggested_general_work_description_id', workDescId);
      return qb;
   };

   const baseFromJoin = qb => qb
      .from('timesheet_entries as te')
      .leftJoin('ai_time_tracker_transaction_suggestions as s', 's.timesheet_entry_id', 'te.timesheet_entry_id')
      .leftJoin('customers as sc', 'sc.customer_id', 'te.suggested_customer_id')
      .leftJoin('customer_general_work_descriptions as g', 'g.general_work_description_id', 's.suggested_general_work_description_id');

   const entries = applyFilters(baseFromJoin(db.queryBuilder()))
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
         'sc.display_name as suggested_customer_display',
         'g.general_work_description as suggested_work_description'
      );

   const HELD_SORT_MAP = {
      date: 'te.date',
      entity: 'te.entity',
      customer: 'sc.display_name',
      work_description: 'g.general_work_description',
      hold_reason: 'te.hold_reason',
      hours: 'te.duration',
      employee: 'te.employee_name',
      timesheet_name: 'te.timesheet_name',
      ai_confidence: 's.ai_confidence',
      created_at: 'te.created_at'
   };
   const heldDir = sortDirection === 'asc' ? 'asc' : 'desc';
   const heldOrderCol = HELD_SORT_MAP[sortField] || 'te.created_at';
   const finalEntries = await entries.orderBy(heldOrderCol, heldDir).limit(limit).offset(offset);

   const [{ count }] = await applyFilters(baseFromJoin(db.queryBuilder())).count({ count: '*' });

   return { entries: finalEntries, total: Number(count || 0), page: Number(page), limit: Number(limit) };
};

const listConsolidatedTransactions = async (
   db,
   accountId,
   {
      startDate,
      endDate,
      customerId = null,
      employeeUserId = null,
      workDescId = null,
      jobContains = null,
      trackerContains = null,
      noteContains = null,
      entityContains = null,
      entityEquals = null, // exact-match form for the entity dropdown
      aiConfMin = null,
      billableOnly = null, // null = both, true = billable, false = non-billable
      unbilledOnly = false,
      aiOnly = false,
      sortField = null,
      sortDirection = 'desc',
      page = 1,
      limit = 200
   } = {}
) => {
   const offset = Math.max(0, (Number(page) - 1) * Number(limit));

   const applyFilters = q => {
      let qq = q
         .where({ 't.account_id': accountId })
         .andWhere('t.transaction_date', '>=', startDate)
         .andWhere('t.transaction_date', '<=', endDate);
      if (customerId) qq = qq.andWhere('t.customer_id', customerId);
      if (employeeUserId) qq = qq.andWhere('t.logged_for_user_id', employeeUserId);
      if (workDescId) qq = qq.andWhere('t.general_work_description_id', workDescId);
      if (jobContains) qq = qq.andWhere('cjt.job_description', 'ilike', `%${jobContains}%`);
      if (trackerContains) qq = qq.andWhere('te.timesheet_name', 'ilike', `%${trackerContains}%`);
      if (noteContains) qq = qq.andWhere(function () {
         this.where('t.detailed_work_description', 'ilike', `%${noteContains}%`).orWhere('t.note', 'ilike', `%${noteContains}%`);
      });
      if (entityContains) qq = qq.andWhere('te.entity', 'ilike', `%${entityContains}%`);
      if (entityEquals) qq = qq.andWhere('te.entity', entityEquals);
      if (aiConfMin != null) qq = qq.andWhere('s.ai_confidence', '>=', Number(aiConfMin));
      if (billableOnly === true) qq = qq.andWhere('t.is_transaction_billable', true);
      else if (billableOnly === false) qq = qq.andWhere('t.is_transaction_billable', false);
      if (unbilledOnly) qq = qq.whereNull('t.customer_invoice_id');
      if (aiOnly) qq = qq.where('ex.ai_source', 'ai_auto_insert');
      return qq;
   };

   const baseFromJoin = q => q
      .from('customer_transactions as t')
      .innerJoin('customers as c', 'c.customer_id', 't.customer_id')
      .innerJoin('customer_general_work_descriptions as g', 'g.general_work_description_id', 't.general_work_description_id')
      .leftJoin('users as u', 'u.user_id', 't.logged_for_user_id')
      .leftJoin('customer_invoices as i', 'i.customer_invoice_id', 't.customer_invoice_id')
      .leftJoin('customer_jobs as cj', 'cj.customer_job_id', 't.customer_job_id')
      .leftJoin('customer_job_types as cjt', 'cjt.job_type_id', 'cj.job_type_id')
      .leftJoin('ai_category_training_examples as ex', 'ex.transaction_id', 't.transaction_id')
      .leftJoin('timesheet_entries as te', 'te.timesheet_entry_id', 'ex.timesheet_entry_id')
      .leftJoin('ai_time_tracker_transaction_suggestions as s', 's.timesheet_entry_id', 'ex.timesheet_entry_id');

   const transactionsQuery = applyFilters(baseFromJoin(db.queryBuilder()))
      .select(
         't.*',
         'c.display_name as customer_display_name',
         'g.general_work_description',
         'u.display_name as logged_for_user_display_name',
         'i.invoice_number',
         'i.is_invoice_paid_in_full',
         'cjt.job_description as customer_job_description',
         'cj.parent_job_id as customer_job_parent_id',
         'te.timesheet_entry_id as tracker_id',
         'te.timesheet_name as tracker_filename',
         'te.entity as tracker_entity',
         'te.company_name as tracker_company_name',
         'te.first_name as tracker_first_name',
         'te.last_name as tracker_last_name',
         'te.category as tracker_category',
         'te.notes as tracker_notes',
         'te.duration as tracker_duration_minutes',
         'te.date as tracker_date',
         'te.employee_name as tracker_employee_name',
         's.ai_confidence',
         's.ai_reason',
         's.status as ai_status',
         'ex.ai_source'
      );

   // Map UI-friendly sort field names to actual SQL columns. Anything not in
   // this map falls back to transaction_date desc (the previous default).
   const SORT_MAP = {
      transaction_date: 't.transaction_date',
      customer: 'c.display_name',
      entity: 'te.entity',
      job: 'cjt.job_description',
      work_description: 'g.general_work_description',
      employee: 'u.display_name',
      hours: 't.quantity',
      total: 't.total_transaction',
      billable: 't.is_transaction_billable',
      ai_confidence: 's.ai_confidence',
      timesheet_name: 'te.timesheet_name'
   };
   const dir = sortDirection === 'asc' ? 'asc' : 'desc';
   const orderCol = SORT_MAP[sortField] || 't.transaction_date';
   const finalTransactions = await transactionsQuery.orderBy(orderCol, dir).limit(limit).offset(offset);

   const [{ count: totalCount, sum: totalSumRaw }] = await applyFilters(baseFromJoin(db.queryBuilder())).count('* as count').sum('t.total_transaction as sum');
   const pageSum = finalTransactions.reduce((acc, t) => acc + Number(t.total_transaction || 0), 0);
   return {
      transactions: finalTransactions,
      totalSum: Math.round(Number(totalSumRaw || 0) * 100) / 100,
      pageSum: Math.round(pageSum * 100) / 100,
      totalCount: Number(totalCount || 0),
      page: Number(page),
      limit: Number(limit)
   };
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

// Distinct entity values for the dropdowns. Source = timesheet_entries.entity
// (the employer-of-record on each tracker line). Sorted alphabetically.
const listDistinctEntities = async (db, accountId) => {
   const rows = await db('timesheet_entries')
      .where({ account_id: accountId, is_deleted: false })
      .whereNotNull('entity')
      .where('entity', '<>', '')
      .distinct('entity')
      .orderBy('entity', 'asc');
   return rows.map(r => r.entity);
};

// Re-run the AI orchestrator on a single held entry, with reviewer overrides
// for the fields the reviewer corrected. Used by the "Rerun AI Processing"
// button in the held-entry dialog. Synchronous — returns the orchestrator's
// outcome so the UI can show success or surface the new hold reason.
const reprocessHeldEntryWithOverrides = async (db, accountId, entryId, overrides, editingUserId) => {
   const { processEntries } = require('../timesheets/auto-ingest-orchestrator');

   // Reset the held entry so the orchestrator picks it up. Keep matched_user_id
   // and suggested_customer_id in case the reviewer doesn't override them — that
   // way the orchestrator's existing customer/employee matching won't override
   // a previously-applied reviewer pick from a prior reprocess.
   await db('timesheet_entries')
      .where({ timesheet_entry_id: entryId, account_id: accountId })
      .update({
         is_processed: false,
         hold_reason: null,
         ai_attempted_at: null
      });

   const result = await processEntries({
      db,
      accountId,
      userId: editingUserId,
      entryIds: [entryId],
      overridesByEntryId: { [entryId]: overrides || {} }
   });

   const perEntry = (result.perEntry || [])[0] || null;
   if (!perEntry) {
      return { decision: 'unknown', reason: 'no_result_returned', autoInserted: 0, held: 0 };
   }
   return {
      decision: perEntry.decision,
      reason: perEntry.reason || null,
      suggestionError: perEntry.suggestionError || null,
      errorMessage: perEntry.errorMessage || null,
      autoInserted: result.autoInserted,
      held: result.held
   };
};

module.exports = {
   listPendingHeldEntries,
   listConsolidatedTransactions,
   applyHeldEntry,
   invoiceAnomalyCheck,
   listEntriesForReprocess,
   reprocessHeldEntryWithOverrides,
   listDistinctEntities
};
