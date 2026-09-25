const _pad2 = n => String(n).padStart(2, '0');
// Local calendar date — node-postgres parses DATE columns to local midnight.
const _localISODate = d => `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;

const _serviceError = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);

// Canonical transaction_type spelling ('Time' / 'Charge'). Local stand-in until
// transactionsObjects.normalizeTransactionType is available to import.
const _normalizeTransactionType = (value, fallback = 'Time') => {
   const s = String(value ?? '').trim().toLowerCase();
   if (s === 'time') return 'Time';
   if (s === 'charge') return 'Charge';
   return fallback;
};

// Latest AI training example per transaction. ai_category_training_examples is
// 1:N per transaction (a reviewer edit adds a 'reviewer_edit' row with no
// timesheet link), so a plain join duplicated rows and inflated totalSum/
// totalCount. Prefer the provenance row (the one tied to the tracker entry),
// newest first.
const LATEST_TRAINING_EXAMPLE_JOIN = `LEFT JOIN LATERAL (
      SELECT e.timesheet_entry_id, e.ai_source
      FROM ai_category_training_examples e
      WHERE e.transaction_id = t.transaction_id AND e.account_id = t.account_id
      ORDER BY (e.timesheet_entry_id IS NULL), e.created_at DESC, e.training_id DESC
      LIMIT 1
   ) AS ex ON TRUE`;

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

   // te.* carries timesheet_entries.ai_payload — the hold detail the Review
   // dialog parses (customer.candidates for ambiguous_customer_match,
   // hold.requested_tax_year for missing_current_year_job, the Bedrock error).
   // The suggestion's own payload is aliased so it can never overwrite it.
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
      .joinRaw(LATEST_TRAINING_EXAMPLE_JOIN)
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

const HELD_FIELD_LABELS = Object.freeze({
   customer_id: 'Customer',
   customer_job_id: 'Job',
   general_work_description_id: 'Work description',
   transaction_date: 'Date',
   logged_for_user_id: 'Employee'
});

const applyHeldEntry = async (db, accountId, entryId, edits, editingUserId) => {
   const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');
   // Same hours / rate / total arithmetic as the AI auto-insert path, so an entry
   // costs the same whether the AI or a reviewer applies it.
   const { _computeTimeAmounts } = require('../timesheets/auto-ingest-orchestrator');
   const internalCustomers = require('../timesheets/internal-customers');
   const { isNonWorkEntry } = require('../../timeTrackerValidation/nonWorkEntries');
   const entry = await db('timesheet_entries')
      .where({ account_id: accountId, timesheet_entry_id: entryId, is_processed: false, is_deleted: false })
      .first();
   if (!entry) {
      throw _serviceError('NOT_FOUND', 'This held entry was not found or has already been applied.');
   }

   const required = ['customer_id', 'customer_job_id', 'general_work_description_id', 'transaction_date', 'logged_for_user_id'];
   for (const field of required) {
      if (edits[field] == null || edits[field] === '') {
         throw _serviceError('MISSING_FIELD', `${HELD_FIELD_LABELS[field]} is required before this entry can be applied.`, { field });
      }
   }

   // Every reference must belong to this account, and the job to the customer
   // (a job on another customer's ledger bills the work to the wrong client).
   const customer = await db('customers').where({ customer_id: edits.customer_id, account_id: accountId }).first();
   if (!customer) throw _serviceError('INVALID_FIELD', `Customer #${edits.customer_id} was not found in this account.`, { field: 'customer_id' });
   const job = await db('customer_jobs').where({ customer_job_id: edits.customer_job_id, account_id: accountId }).first();
   if (!job || Number(job.customer_id) !== Number(edits.customer_id)) {
      throw _serviceError('INVALID_FIELD', `Job #${edits.customer_job_id} does not belong to the chosen customer.`, { field: 'customer_job_id' });
   }
   // A valid FK does not establish tenant ownership — the work description
   // must belong to THIS account, not merely exist somewhere in the database
   // (e.g. account 1's general_work_description_id=1 sent from account 9001).
   const gwd = await db('customer_general_work_descriptions').where({ general_work_description_id: edits.general_work_description_id, account_id: accountId }).first();
   if (!gwd) throw _serviceError('INVALID_FIELD', `Work description #${edits.general_work_description_id} was not found in this account.`, { field: 'general_work_description_id' });
   const employee = await db('users').where({ user_id: edits.logged_for_user_id, account_id: accountId }).select('billing_rate').first();
   if (!employee) throw _serviceError('INVALID_FIELD', `Employee #${edits.logged_for_user_id} was not found in this account.`, { field: 'logged_for_user_id' });

   // quantity = ceil(minutes / 6) / 10 (manual six-minute policy) and total = quantity × rate
   // rounded to cents, priced from the SAME rounded hours so quantity × rate
   // always equals the stored total (integer hundredths/cents —
   // auto-ingest-orchestrator._computeTimeAmounts).
   // A client-supplied total_transaction is ignored for the same reason.
   const minutes = Number(edits.duration_minutes ?? entry.duration);
   if (!Number.isFinite(minutes) || minutes <= 0 || !(_computeTimeAmounts(minutes, 0).quantity > 0)) {
      throw _serviceError('INVALID_FIELD', 'Duration must be greater than zero minutes.', { field: 'duration_minutes' });
   }
   const rawRate = edits.unit_cost ?? employee.billing_rate ?? 0;
   const rate = Number(rawRate);
   if (!Number.isFinite(rate) || rate < 0) {
      throw _serviceError('INVALID_FIELD', 'Rate must be a number of zero or more.', { field: 'unit_cost' });
   }
   // Reject a rate with more than 2 decimal places instead of silently
   // rounding it (e.g. 1.005 -> 1.00/1.01 depending on float noise). Tested
   // against the RAW value's own string form, not the Number()-parsed `rate`,
   // so float representation noise never masks (or manufactures) extra
   // decimals.
   if (!/^\d+(?:\.\d{1,2})?$/.test(String(rawRate).trim())) {
      throw _serviceError('INVALID_FIELD', 'Rate must have at most 2 decimal places.', { field: 'unit_cost' });
   }
   const { quantity, unitCost, totalTransaction } = _computeTimeAmounts(minutes, rate);

   // The firm's own entities are never billable (internal-customers.js); the
   // hours are still recorded for analytics. Non-work time (vacation / PTO /
   // holiday / sick / lunch / personal / doctor's appointment / ...) is also
   // never billable — decided from the STORED entry, never the reviewer's
   // editable is_transaction_billable flag, which defaulted to billable=true
   // for a held Doctor Appointment row with no explicit flag sent.
   const internalCustomer = await internalCustomers.isInternalCustomer(db, accountId, edits.customer_id);
   const isTransactionBillable = !internalCustomer && !isNonWorkEntry(entry) && ![false, 'false', 0, '0'].includes(edits.is_transaction_billable);

   let createdTxn = null;
   await db.transaction(async trx => {
      await require('../../utils/ledgerAction').actionContext(trx, editingUserId, 'Apply reviewed tracker duration using six-minute billing increments.');
      // Claim the entry FIRST, inside the same transaction as the insert (the
      // auto-ingest orchestrator's pattern): UPDATE … WHERE is_processed = false
      // RETURNING. The row lock + predicate mean a double submit, a concurrent
      // apply or an AI rerun cannot both insert — the loser claims 0 rows and
      // rolls back.
      const claimed = await trx('timesheet_entries')
         .where({ account_id: accountId, timesheet_entry_id: entryId, is_processed: false, is_deleted: false })
         .update({
            is_processed: true,
            hold_reason: null,
            matched_user_id: edits.logged_for_user_id,
            suggested_customer_id: edits.customer_id
         })
         .returning('timesheet_entry_id');
      if (!claimed.length) {
         throw _serviceError('NOT_FOUND', 'This held entry was not found or has already been applied.');
      }

      createdTxn = await addNewTransaction(trx, {
         accountID: accountId,
         customerID: edits.customer_id,
         customerJobID: edits.customer_job_id,
         selectedRetainerID: null,
         // New work is always unbilled; the next Create Invoice run stamps it.
         // Linking it to an existing invoice here would skip billing entirely.
         customerInvoicesID: null,
         loggedForUserID: edits.logged_for_user_id,
         selectedGeneralWorkDescriptionID: edits.general_work_description_id,
         detailedJobDescription: edits.detailed_work_description || '',
         transactionDate: edits.transaction_date,
         transactionType: _normalizeTransactionType(edits.transaction_type),
         quantity,
         unitCost,
         totalTransaction,
         isTransactionBillable,
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
      throw _serviceError('BAD_MODE', `unknown reprocess mode: ${mode}`);
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
// The transaction a tracker line was applied as, if it still exists. There is
// no applied-transaction column on timesheet_entries; the link is the
// ai_category_training_examples row written by addNewTransaction (both the AI
// auto-insert and the manual apply write one). Its transaction_id is SET NULL
// when the transaction is deleted.
const findAppliedTransactionId = async (db, accountId, entryId) => {
   const links = await db('ai_category_training_examples')
      .where({ account_id: accountId, timesheet_entry_id: entryId })
      .whereNotNull('transaction_id')
      .select('transaction_id');
   const ids = [...new Set(links.map(l => Number(l.transaction_id)).filter(n => Number.isInteger(n) && n > 0))];
   if (!ids.length) return null;
   const live = await db('customer_transactions').where({ account_id: accountId }).whereIn('transaction_id', ids).first('transaction_id');
   return live ? live.transaction_id : null;
};

// Orchestrator result for an entry another run / reviewer processed first
// (auto-ingest-orchestrator _skipped).
const SKIPPED_ALREADY_PROCESSED = Object.freeze({ decision: 'skip', reason: 'already_processed' });

const _alreadyAppliedError = transactionId =>
   _serviceError(
      'ENTRY_ALREADY_APPLIED',
      `This time entry was already applied as transaction #${transactionId}. Edit that transaction on the Processed & Not Billed tab instead of re-running AI.`,
      { transactionId }
   );

const reprocessHeldEntryWithOverrides = async (db, accountId, entryId, overrides, editingUserId) => {
   const { processEntries } = require('../timesheets/auto-ingest-orchestrator');

   // Check-and-reset atomically under the entry's row lock. Resetting an entry
   // that already produced a transaction would let the orchestrator insert a
   // SECOND transaction for the same tracker line. applyHeldEntry and the AI
   // auto-insert claim this same row inside their insert transaction, so a
   // concurrent apply is either committed and visible to the check below
   // (refused), or its claim waits for this reset and wins the orchestrator's
   // own claim afterwards (reported as 'skip') — an entry with a live
   // transaction is never flipped back to unprocessed.
   await db.transaction(async trx => {
      const entry = await trx('timesheet_entries').where({ timesheet_entry_id: entryId, account_id: accountId }).forUpdate().first();
      if (!entry || entry.is_deleted) {
         throw _serviceError('NOT_FOUND', 'This time entry was not found.');
      }
      const appliedTransactionId = await findAppliedTransactionId(trx, accountId, entryId);
      if (appliedTransactionId) throw _alreadyAppliedError(appliedTransactionId);

      // Reset the held entry so the orchestrator picks it up. Keep matched_user_id
      // and suggested_customer_id in case the reviewer doesn't override them — that
      // way the orchestrator's existing customer/employee matching won't override
      // a previously-applied reviewer pick from a prior reprocess.
      await trx('timesheet_entries').where({ timesheet_entry_id: entryId, account_id: accountId, is_deleted: false }).update({
         is_processed: false,
         hold_reason: null,
         ai_attempted_at: null
      });
   });

   const result = await processEntries({
      db,
      accountId,
      userId: editingUserId,
      entryIds: [entryId],
      overridesByEntryId: { [entryId]: overrides || {} }
   });

   // Another run or a reviewer processed the entry between the reset and the
   // AI pass. Nothing is reset again; point the reviewer at what it produced.
   const skipped = async outcome => {
      const transactionId = await findAppliedTransactionId(db, accountId, entryId);
      return { ...outcome, ...(transactionId ? { transactionId } : {}) };
   };

   const perEntry = (result.perEntry || []).find(r => Number(r.entryId) === Number(entryId)) || (result.perEntry || [])[0] || null;
   if (!perEntry) {
      // processEntries only loads unprocessed rows: an empty result means it was
      // already processed by the time the AI pass looked.
      const current = await db('timesheet_entries').where({ timesheet_entry_id: entryId, account_id: accountId }).first();
      if (current && current.is_processed && !current.is_deleted) return skipped({ ...SKIPPED_ALREADY_PROCESSED, autoInserted: 0, held: 0 });
      return { decision: 'unknown', reason: 'no_result_returned', autoInserted: 0, held: 0 };
   }
   // decision ('auto_insert' | 'hold' | 'skip') and reason (every hold reason,
   // e.g. ambiguous_customer_match / missing_current_year_job) pass through as-is.
   const outcome = {
      decision: perEntry.decision,
      reason: perEntry.reason || null,
      suggestionError: perEntry.suggestionError || null,
      errorMessage: perEntry.errorMessage || null,
      autoInserted: result.autoInserted,
      held: result.held
   };
   return perEntry.decision === SKIPPED_ALREADY_PROCESSED.decision ? skipped(outcome) : outcome;
};

// Default Start for the Processed & Not Billed tab: first of the month holding
// the oldest UNBILLED transaction (customer_invoice_id IS NULL — the same rule
// the billing engine uses to pick up work), or first of the current month when
// nothing is unbilled. The old heuristic (this/last month based on the latest
// invoice date) hid stale unbilled rows that the next bill would still pick up.
// Future-dated rows (known date typos) are ignored so they can't pull the start
// past today.
const earliestUnbilledMonth = async (db, accountId, { today = new Date() } = {}) => {
   const todayISO = _localISODate(today);
   const row = await db('customer_transactions')
      .where({ account_id: accountId })
      .whereNull('customer_invoice_id')
      .where('transaction_date', '<=', todayISO)
      .min({ earliest: 'transaction_date' })
      .first();

   const earliest = row && row.earliest ? row.earliest : null;
   let earliestISO = null;
   if (earliest instanceof Date && !Number.isNaN(earliest.getTime())) earliestISO = _localISODate(earliest);
   else if (typeof earliest === 'string' && /^\d{4}-\d{2}-\d{2}/.test(earliest)) earliestISO = earliest.slice(0, 10);

   const monthStart = earliestISO || todayISO;
   return `${monthStart.slice(0, 7)}-01`;
};

module.exports = {
   listPendingHeldEntries,
   listConsolidatedTransactions,
   applyHeldEntry,
   invoiceAnomalyCheck,
   listEntriesForReprocess,
   reprocessHeldEntryWithOverrides,
   findAppliedTransactionId,
   listDistinctEntities,
   earliestUnbilledMonth
};
