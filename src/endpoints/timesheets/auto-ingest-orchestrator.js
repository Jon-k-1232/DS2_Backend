const pLimit = require('p-limit');
const { matchCustomer } = require('../../ai_integrations/customerMatching');
const { inferCategorization } = require('../../ai_integrations/categoryInference');
const { loadCustomerHistoricalPatterns, pickJobFromHistory, pickBillableFromHistory } = require('../../ai_integrations/customerHistoricalPatterns');
const { matchEmployee } = require('../../utils/employeeMatching');
const { redactRowForAi } = require('../../utils/piiRedactor');
const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');

const AUTO_INSERT_THRESHOLD = Number(process.env.AUTO_INSERT_CONFIDENCE_THRESHOLD || 0.85);
const FUZZY_HIGH_THRESHOLD = Number(process.env.CUSTOMER_FUZZY_HIGH_THRESHOLD || 0.90);
const CONCURRENCY = Number(process.env.AUTO_INGEST_CONCURRENCY || 8);
const FEW_SHOT_LIMIT = Number(process.env.FEW_SHOT_LIMIT || 5);

const HOLD_REASONS = Object.freeze({
   NO_MATCHING_CUSTOMER: 'no_matching_customer',
   LOW_AI_CONFIDENCE: 'low_ai_confidence',
   MISSING_REQUIRED_FIELD: 'missing_required_field',
   AMBIGUOUS_CATEGORY: 'ambiguous_category',
   NEW_CUSTOMER_NEEDS_ADDITION: 'new_customer_needs_addition',
   EMPLOYEE_NOT_MATCHED: 'employee_not_matched',
   BEDROCK_ERROR: 'bedrock_error',
   AI_COST_CAP_REACHED: 'ai_cost_cap_reached',
   MISSING_CURRENT_YEAR_JOB: 'missing_current_year_job'
});

const _loadCatalogs = async (db, accountId) => {
   const [customers, employees, categories, jobTypes, gwds, account] = await Promise.all([
      db('customers').where({ account_id: accountId, is_customer_active: true }).select('customer_id', 'business_name', 'customer_name', 'display_name'),
      db('users').where({ account_id: accountId, is_user_active: true }).select('user_id', 'display_name', 'billing_rate', 'cost_rate'),
      db('customer_job_categories').where({ account_id: accountId, is_job_category_active: true }).select('customer_job_category_id', 'customer_job_category'),
      db('customer_job_types').where({ account_id: accountId, is_job_type_active: true }).select('job_type_id', 'customer_job_category_id', 'job_description'),
      db('customer_general_work_descriptions').where({ account_id: accountId, is_general_work_description_active: true }).select('general_work_description_id', 'general_work_description'),
      db('accounts').where({ account_id: accountId }).select('ai_daily_cost_cap_usd').first()
   ]);
   return {
      customers,
      employees,
      account,
      refData: {
         general_work_descriptions: gwds.map(g => ({ id: g.general_work_description_id, label: g.general_work_description })),
         job_categories: categories.map(c => ({ id: c.customer_job_category_id, label: c.customer_job_category })),
         job_types: jobTypes.map(j => ({ id: j.job_type_id, label: j.job_description, category_id: j.customer_job_category_id }))
      }
   };
};

const _loadFewShots = async (db, accountId) => {
   try {
      // Combine the legacy ai_category_training_examples (work-desc-only) with the
      // newer ai_reviewer_corrections (any field). Both must have sanitized_notes
      // to be useful as a few-shot prompt.
      const [legacy, reviewerEdits] = await Promise.all([
         db('ai_category_training_examples')
            .where({ account_id: accountId })
            .whereNotNull('final_category')
            .whereNotNull('sanitized_notes')
            .orderBy('updated_at', 'desc')
            .limit(FEW_SHOT_LIMIT)
            .select('sanitized_notes', 'duration_minutes', 'final_category as final_label', 'updated_at as ts'),
         db('ai_reviewer_corrections')
            .where({ account_id: accountId, field_name: 'general_work_description_id' })
            .whereNotNull('sanitized_notes')
            .whereNotNull('final_label')
            .orderBy('created_at', 'desc')
            .limit(FEW_SHOT_LIMIT)
            .select('sanitized_notes', db.raw('NULL as duration_minutes'), 'final_label', 'created_at as ts')
      ]);

      // Merge, dedupe by (sanitized_notes, final_label), keep most recent first
      const merged = [...reviewerEdits, ...legacy]
         .sort((a, b) => new Date(b.ts) - new Date(a.ts));
      const seen = new Set();
      const out = [];
      for (const r of merged) {
         const key = `${r.sanitized_notes}|${r.final_label}`;
         if (seen.has(key)) continue;
         seen.add(key);
         out.push({
            sanitized_notes: r.sanitized_notes,
            duration_minutes: r.duration_minutes,
            final_general_work_description: r.final_label
         });
         if (out.length >= FEW_SHOT_LIMIT) break;
      }
      return out;
   } catch (e) {
      return [];
   }
};

const _todayDailyCostUsd = async (db, accountId) => {
   const start = new Date();
   start.setUTCHours(0, 0, 0, 0);
   const row = await db('ai_call_log')
      .where({ account_id: accountId })
      .where('created_at', '>=', start)
      .sum({ total: 'cost_usd' })
      .first();
   return Number((row && row.total) || 0);
};

const _findGwdByLabel = (refData, label) => {
   if (!label || !refData || !refData.general_work_descriptions) return null;
   const norm = String(label).trim().toLowerCase();
   const hit = refData.general_work_descriptions.find(g => String(g.label).trim().toLowerCase() === norm);
   return hit ? hit.id : null;
};

// Pick a customer_job_id given (customer, work_desc, entry). Preference order:
//   1. Year-specific match: if notes/category mention a year (e.g. "2025 pitr") and
//      the customer has a parent job whose description contains that year, use it.
//      Tax-prep jobs are commonly named "2024 Personal Tax Return", "2025 Personal
//      Tax Return", etc., and a typo'd year would silently bill the wrong job.
//   2. Historical (work_desc → most-common-job) for THIS customer (if count >= MIN).
//   3. Word-overlap between (category + notes) and parent-job descriptions.
//   4. Most-recent active parent job.
//
// AFTER picking via 2/3/4, if the chosen job is year-prefixed AND the notes/category
// did NOT mention a year, swap to the same job family for the **transaction's tax year**
// (transaction_date_year - 1). Tax-prep work is year-driven and lags by one year:
// transactions logged in calendar 2026 are billing 2025 returns; transactions logged
// during Oct-Dec 2025 (on-extension work) are billing 2024 returns. Use the transaction
// date, NOT today, so historical reprocesses stay correct.
//
// Child jobs are NEVER assigned — they exist only as internal tracking rows.
const _normalizeForJobMatch = s => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const _stripYearFromJob = s => _normalizeForJobMatch(s).replace(/\b20\d{2}\b\s*/, '').trim();

const _taxYearForDate = d => {
   if (!d) return String(new Date().getUTCFullYear() - 1);
   const dt = d instanceof Date ? d : new Date(d);
   if (isNaN(dt.getTime())) return String(new Date().getUTCFullYear() - 1);
   return String(dt.getUTCFullYear() - 1);
};

// Helper: given a candidate job and the patterns, if the candidate is year-prefixed
// for an OLD year (≠ this transaction's tax year), look for a same-family job for the
// transaction's tax year. Returns:
//   { jobId }                   — swap succeeded OR no swap needed
//   { jobId: null, missingYear } — stale year but customer has NO current-year same-family job;
//                                   caller should hold the entry rather than billing the wrong year
const _resolveTaxYearSwap = (candidateJobId, patterns, transactionDate) => {
   const candidate = patterns.parentJobs.find(j => j.customer_job_id === candidateJobId);
   if (!candidate || !candidate.job_description) return { jobId: candidateJobId };
   const candYear = (candidate.job_description.match(/\b(20\d{2})\b/) || [])[1];
   if (!candYear) return { jobId: candidateJobId };
   const ty = _taxYearForDate(transactionDate);
   if (candYear === ty) return { jobId: candidateJobId };
   const family = _stripYearFromJob(candidate.job_description);
   const currentYearJob = patterns.parentJobs.find(j =>
      j.job_description &&
      j.job_description.includes(ty) &&
      _stripYearFromJob(j.job_description) === family
   );
   if (currentYearJob) return { jobId: currentYearJob.customer_job_id };
   // No current-year same-family job exists for this customer — hold rather than bill wrong year.
   return { jobId: null, missingYear: ty, family: candidate.job_description };
};

const _findCustomerJobId = async (db, accountId, customerId, entry = null, { workDescId = null, patterns = null } = {}) => {
   if (!customerId) return null;

   const effectivePatterns = patterns || (await loadCustomerHistoricalPatterns(db, accountId, customerId));
   if (!effectivePatterns || !effectivePatterns.parentJobs || !effectivePatterns.parentJobs.length) return null;

   const sourceText = [entry && entry.category, entry && entry.notes].filter(Boolean).join(' ');
   const yearMatches = (sourceText.match(/\b(20\d{2})\b/g) || []);
   const notesHaveYear = yearMatches.length > 0;

   // 1. Year-specific match (notes explicitly mention a year)
   if (notesHaveYear) {
      const yearJobs = effectivePatterns.parentJobs.filter(j =>
         yearMatches.some(y => (j.job_description || '').includes(y))
      );
      if (yearJobs.length > 0) {
         if (workDescId) {
            const hist = pickJobFromHistory(effectivePatterns, workDescId);
            if (hist && yearJobs.some(j => j.customer_job_id === hist.customer_job_id)) {
               return hist.customer_job_id;
            }
         }
         const wordsOf = s => _normalizeForJobMatch(s).split(/[\s,.;:!?()\[\]"'/-]+/).filter(w => w.length >= 4 && !/^20\d{2}$/.test(w));
         const sw = wordsOf(sourceText);
         if (sw.length > 0) {
            const scored = yearJobs
               .map(j => ({ j, overlap: wordsOf(j.job_description).filter(w => sw.includes(w)).length }))
               .sort((a, b) => b.overlap - a.overlap);
            return scored[0].j.customer_job_id;
         }
         return yearJobs[0].customer_job_id;
      }
   }

   // 1b. Monthly-services keyword override. Recurring/monthly clients get year-prefixed
   // tax-return jobs assigned by history when notes describe non-tax monthly work
   // (payroll, bookkeeping, monthly close). When notes signal monthly work AND the
   // customer has a monthly-style job, prefer that over the year-prefixed default.
   const MONTHLY_NOTE_RE = /\b(payroll|payoll|paycheck|monthly|bookkeep|qbo|quickbooks|reconcil|month[-\s]?end|aspire)\b/i;
   const MONTHLY_JOB_RE = /\b(monthly|miscellaneous services|bookkeep|payroll)\b/i;
   if (MONTHLY_NOTE_RE.test(sourceText)) {
      const monthlyJobs = effectivePatterns.parentJobs.filter(j => MONTHLY_JOB_RE.test(j.job_description || ''));
      if (monthlyJobs.length > 0) {
         // If history's pick for this work_desc IS one of the monthly jobs, honor it.
         if (workDescId) {
            const hist = pickJobFromHistory(effectivePatterns, workDescId);
            if (hist && monthlyJobs.some(j => j.customer_job_id === hist.customer_job_id)) {
               return hist.customer_job_id;
            }
         }
         // Otherwise pick the monthly job with the most aggregate historical volume
         // across ALL work_descs — this captures "the customer's primary monthly bucket".
         const monthlyAgg = new Map();
         for (const [, top] of effectivePatterns.workDescToJobMap.entries()) {
            if (monthlyJobs.some(mj => mj.customer_job_id === top.customer_job_id)) {
               monthlyAgg.set(top.customer_job_id, (monthlyAgg.get(top.customer_job_id) || 0) + top.count);
            }
         }
         let best = null;
         for (const [id, n] of monthlyAgg.entries()) {
            if (!best || n > best.n) best = { id, n };
         }
         return best ? best.id : monthlyJobs[0].customer_job_id;
      }
   }

   // 2. Historical (work_desc → top job)
   let candidateJobId = null;
   if (workDescId) {
      const fromHistory = pickJobFromHistory(effectivePatterns, workDescId);
      if (fromHistory && fromHistory.source === 'history') candidateJobId = fromHistory.customer_job_id;
   }

   // 3. Word-overlap fallback
   if (candidateJobId == null) {
      const wordsOf = s => _normalizeForJobMatch(s).split(/[\s,.;:!?()\[\]"'/-]+/).filter(w => w.length >= 4);
      const sourceWords = wordsOf(sourceText);
      if (sourceWords.length > 0) {
         const scored = effectivePatterns.parentJobs
            .map(j => {
               const jdWords = wordsOf(j.job_description);
               const overlap = sourceWords.filter(w => jdWords.includes(w)).length;
               return { j, overlap };
            })
            .filter(s => s.overlap > 0)
            .sort((a, b) => b.overlap - a.overlap);
         if (scored.length > 0) candidateJobId = scored[0].j.customer_job_id;
      }
   }

   // 4. Most recent active parent
   if (candidateJobId == null) {
      const sortedByRecent = await db('customer_jobs')
         .where({ account_id: accountId, customer_id: customerId, is_job_complete: false })
         .whereNull('parent_job_id')
         .orderBy('created_at', 'desc')
         .select('customer_job_id')
         .first();
      candidateJobId = sortedByRecent ? sortedByRecent.customer_job_id : effectivePatterns.parentJobs[0].customer_job_id;
   }

   // POST-PICK adjustment: if notes had no year and candidate is year-prefixed but for an
   // old year, swap to the same family's current-tax-year job. If no current-year same-family
   // job exists for this customer (e.g. JKA hasn't created the 2025 PITR job yet), return null
   // so the caller HOLDS the entry rather than silently billing the wrong year.
   if (!notesHaveYear) {
      const swap = _resolveTaxYearSwap(candidateJobId, effectivePatterns, entry && entry.date);
      return swap.jobId; // may be null → caller should hold with MISSING_CURRENT_YEAR_JOB
   }
   return candidateJobId;
};

// Strip name/label fields before persisting. ai_payload must not contain
// any PII strings — only opaque IDs, scores, and tiers.
const _safeCustomerForPayload = customer => {
   if (!customer) return null;
   return {
      customerId: customer.customerId,
      score: customer.score,
      tier: customer.tier,
      reason: customer.reason
      // intentionally omits: displayName, candidates[*].label
   };
};

const _safeSuggestionForPayload = suggestion => {
   if (!suggestion) return null;
   return {
      suggested_general_work_description_id: suggestion.suggested_general_work_description_id,
      suggested_job_category_id: suggestion.suggested_job_category_id,
      suggested_job_type_id: suggestion.suggested_job_type_id,
      category_confidence: suggestion.category_confidence,
      ai_reason: suggestion.ai_reason
      // intentionally omits: suggested_category_label (could in theory echo a name)
   };
};

const _safePayload = (suggestion, customer) => {
   if (!suggestion && !customer) return null;
   return JSON.stringify({
      suggestion: _safeSuggestionForPayload(suggestion),
      customer: _safeCustomerForPayload(customer)
   });
};

const _writeSuggestion = async (db, { accountId, entryId, sanitizedNotes, suggestion, suggestedCustomer, status }) => {
   const safe = _safePayload(suggestion, suggestedCustomer);
   await db('ai_time_tracker_transaction_suggestions')
      .insert({
         account_id: accountId,
         timesheet_entry_id: entryId,
         sanitized_notes: sanitizedNotes || '',
         suggested_category: null,  // label could echo PII; surfaced only via FK ID lookups
         suggested_job_category_id: suggestion ? suggestion.suggested_job_category_id : null,
         suggested_job_type_id: suggestion ? suggestion.suggested_job_type_id : null,
         suggested_general_work_description_id: suggestion ? suggestion.suggested_general_work_description_id : null,
         suggested_entity: null,
         suggested_customer_id: suggestedCustomer ? suggestedCustomer.customerId : null,
         suggested_customer_display_name: null,  // resolved at read time via FK to customers.display_name
         ai_confidence: suggestion ? suggestion.category_confidence : null,
         ai_reason: suggestion ? suggestion.ai_reason : null,
         ai_payload: safe,
         status,
         source: 'ai',
         updated_at: new Date()
      })
      .onConflict('timesheet_entry_id')
      .merge({
         status,
         updated_at: new Date(),
         ai_confidence: suggestion ? suggestion.category_confidence : null,
         ai_reason: suggestion ? suggestion.ai_reason : null,
         ai_payload: safe,
         suggested_general_work_description_id: suggestion ? suggestion.suggested_general_work_description_id : null,
         suggested_job_category_id: suggestion ? suggestion.suggested_job_category_id : null,
         suggested_job_type_id: suggestion ? suggestion.suggested_job_type_id : null,
         suggested_customer_id: suggestedCustomer ? suggestedCustomer.customerId : null
      });
};

const _holdEntry = async (db, { entryId, accountId, holdReason, suggestion, suggestedCustomer, employeeMatch = null, sanitizedNotes }) => {
   await db.transaction(async trx => {
      await trx('timesheet_entries')
         .where({ timesheet_entry_id: entryId, account_id: accountId })
         .update({
            hold_reason: holdReason,
            ai_attempted_at: new Date(),
            ai_payload: _safePayload(suggestion, suggestedCustomer),
            suggested_customer_id: suggestedCustomer ? suggestedCustomer.customerId : null,
            matched_user_id: employeeMatch ? employeeMatch.userId : null
         });
      await _writeSuggestion(trx, {
         accountId,
         entryId,
         sanitizedNotes,
         suggestion,
         suggestedCustomer,
         status: 'pending_review'
      });
   });
};

const _toISODate = d => {
   if (!d) return null;
   if (typeof d === 'string') return d.length > 10 ? d.slice(0, 10) : d;
   if (d instanceof Date) return d.toISOString().slice(0, 10);
   return String(d).slice(0, 10);
};

// Internal admin work — payment processing, scanning/filing, bank deposits, internal
// staff notifications about billing — is typically NOT billable to the client. The
// firm absorbs this back-office cost. Detect strong admin-only signals and flip
// isTransactionBillable=false at insert time so it doesn't sneak onto the client's bill.
//
// Conservative by design: requires admin-pattern AND lack of strong client-work signal.
// False negatives (billable misflagged) are worse than false positives here.
const _ADMIN_NONBILLABLE_RE = /\b(processed.{0,30}(check|payment|deposit|chase bank|bank)|made (a )?deposit|deposited (a )?check|verified invoice|posted (the )?payment|scanned and filed|filed and scanned|reviewed (the )?check|(emailed|notified) (kati|kasi|jim|marsha|kennedy|eliza|stacia|jessica))\b/i;
const _CLIENT_WORK_RE = /\b(meeting with (the )?client|called (the )?client|spoke (with|to) (the )?client|conference call|client meeting|tax return prep|return prep|pitr (prep|review)|citr (prep|review)|prepar(ed|ing) (the )?return|reviewing (the )?return)\b/i;

const _isLikelyNonBillable = entry => {
   const notes = (entry && entry.notes) || '';
   if (!notes) return false;
   if (!_ADMIN_NONBILLABLE_RE.test(notes)) return false;
   if (_CLIENT_WORK_RE.test(notes)) return false;
   return true;
};

// Decide whether a new auto-insert should be billable. Order:
//   1. Strong admin/payment regex match → false (ignores historical signal — back-office work
//      shouldn't be billed even if past data shows it was).
//   2. Customer history for this work_desc strongly favors non-billable (e.g. retainer client) → false.
//   3. Customer history for this work_desc strongly favors billable → true.
//   4. Default → true (safer to bill and let reviewer flip than to silently miss revenue).
const _decideBillable = ({ entry, suggestion, customerPatterns }) => {
   if (_isLikelyNonBillable(entry)) return false;
   const workDescId = suggestion && suggestion.suggested_general_work_description_id;
   const fromHistory = pickBillableFromHistory(customerPatterns, workDescId);
   if (fromHistory === false) return false;
   if (fromHistory === true) return true;
   return true;
};

const _autoInsertEntry = async (db, { entry, accountId, userId, suggestion, customerMatch, employeeMatch, sanitizedNotes, customerPatterns = null }) => {
   const customerJobId = await _findCustomerJobId(db, accountId, customerMatch.customerId, entry, {
      workDescId: suggestion && suggestion.suggested_general_work_description_id,
      patterns: customerPatterns
   });
   if (!customerJobId) {
      // Distinguish "no jobs at all" from "stale-year, missing current-year same-family job".
      // The latter is the common case during early tax season: client doesn't have e.g. 2025
      // PITR set up yet. Hold for review with a clear hold_reason.
      const hasAnyParentJob = customerPatterns && customerPatterns.parentJobs && customerPatterns.parentJobs.length > 0;
      const err = new Error(hasAnyParentJob ? 'missing_current_year_job' : 'no_customer_job_for_auto_insert');
      err.holdReason = hasAnyParentJob ? HOLD_REASONS.MISSING_CURRENT_YEAR_JOB : HOLD_REASONS.MISSING_REQUIRED_FIELD;
      throw err;
   }
   const employee = (await db('users').where({ user_id: employeeMatch.userId }).select('billing_rate').first()) || {};
   const hours = Number(entry.duration || 0) / 60;
   const unitCost = Number(employee.billing_rate || 0);
   const totalTransaction = Math.round(hours * unitCost * 100) / 100;

   await db.transaction(async trx => {
      await addNewTransaction(trx, {
         accountID: accountId,
         customerID: customerMatch.customerId,
         customerJobID: customerJobId,
         selectedRetainerID: null,
         customerInvoicesID: null,
         loggedForUserID: employeeMatch.userId,
         selectedGeneralWorkDescriptionID: suggestion.suggested_general_work_description_id,
         detailedJobDescription: entry.notes || '',
         transactionDate: _toISODate(entry.date),
         transactionType: 'time',
         quantity: hours,
         unitCost,
         totalTransaction,
         isTransactionBillable: _decideBillable({ entry, suggestion, customerPatterns }),
         isInAdditionToMonthlyCharge: false,
         loggedByUserID: userId,
         note: '',
         category: entry.category,
         minutes: entry.duration,
         entity: null,
         timesheetEntryID: entry.timesheet_entry_id,
         aiSuggestion: {
            suggested_category: suggestion.suggested_category_label,
            ai_reason: suggestion.ai_reason,
            ai_confidence: suggestion.category_confidence,
            sanitized_notes: sanitizedNotes,
            source: 'ai_auto_insert'
         },
         selectedGeneralWorkDescription: null
      });

      await trx('timesheet_entries')
         .where({ timesheet_entry_id: entry.timesheet_entry_id, account_id: accountId })
         .update({
            is_processed: true,
            hold_reason: null,
            ai_attempted_at: new Date(),
            matched_user_id: employeeMatch.userId,
            suggested_customer_id: customerMatch.customerId
         });

      await _writeSuggestion(trx, {
         accountId,
         entryId: entry.timesheet_entry_id,
         sanitizedNotes,
         suggestion,
         suggestedCustomer: customerMatch,
         status: 'auto_applied'
      });
   });
};

const _gateDecision = ({ employeeMatch, customerMatch, suggestion }) => {
   if (!employeeMatch) return { action: 'hold', reason: HOLD_REASONS.EMPLOYEE_NOT_MATCHED };
   if (!customerMatch || !customerMatch.customerId) {
      return { action: 'hold', reason: HOLD_REASONS.NO_MATCHING_CUSTOMER };
   }
   if (!suggestion) {
      return { action: 'hold', reason: HOLD_REASONS.BEDROCK_ERROR };
   }
   if (!suggestion.suggested_general_work_description_id) {
      return { action: 'hold', reason: HOLD_REASONS.MISSING_REQUIRED_FIELD };
   }

   const combined = Math.min(
      typeof suggestion.category_confidence === 'number' ? suggestion.category_confidence : 0,
      typeof customerMatch.score === 'number' ? customerMatch.score : 0
   );
   if (combined < 0.65) return { action: 'hold', reason: HOLD_REASONS.AMBIGUOUS_CATEGORY };
   if (combined < AUTO_INSERT_THRESHOLD) return { action: 'hold', reason: HOLD_REASONS.LOW_AI_CONFIDENCE };
   if (customerMatch.tier === 'fuzzy_high' && customerMatch.score < FUZZY_HIGH_THRESHOLD) {
      return { action: 'hold', reason: HOLD_REASONS.LOW_AI_CONFIDENCE };
   }
   return { action: 'auto_insert', reason: null };
};

const processEntry = async ({ db, accountId, userId, entry, catalogs, fewShots, costSoFarUsd = 0 }) => {
   const employeeMatch = matchEmployee(entry.employee_name, catalogs.employees);

   const cap = catalogs.account && catalogs.account.ai_daily_cost_cap_usd ? Number(catalogs.account.ai_daily_cost_cap_usd) : null;
   if (cap && costSoFarUsd >= cap) {
      await _holdEntry(db, {
         entryId: entry.timesheet_entry_id,
         accountId,
         holdReason: HOLD_REASONS.AI_COST_CAP_REACHED,
         suggestion: null,
         suggestedCustomer: null,
         employeeMatch,
         sanitizedNotes: ''
      });
      return { entryId: entry.timesheet_entry_id, decision: 'hold', reason: HOLD_REASONS.AI_COST_CAP_REACHED, costUsd: 0 };
   }

   let customerMatch = { customerId: null, displayName: null, score: 0, tier: 'none', candidates: [], reason: 'not_attempted' };
   if (employeeMatch) {
      // Customer = company_name (business customer) OR first_name + last_name (individual customer).
      // entity is the EMPLOYER's business identity (which of the multi-business owner's entities the
      // employee was working FOR), NOT the customer. Don't ever look up customer from entity.
      const customerSearchName =
         entry.company_name ||
         (entry.first_name && entry.last_name ? `${entry.first_name} ${entry.last_name}` : null) ||
         entry.first_name ||
         entry.last_name ||
         null;
      if (customerSearchName) {
         customerMatch = await matchCustomer({
            searchName: customerSearchName,
            customerCatalog: catalogs.customers,
            accountId,
            userId,
            timesheetEntryId: entry.timesheet_entry_id,
            db
         });
      }
      if (!customerMatch.customerId && entry.first_name && entry.last_name) {
         customerMatch.reason = 'no_match_first_last_present';
         customerMatch.tier = 'new_individual';
      }
   }

   let suggestion = null;
   let suggestionCost = 0;
   let suggestionError = null;
   let customerPatterns = null;

   if (employeeMatch && customerMatch.customerId) {
      // Pull this customer's historical patterns once. Used to (a) bias the AI
      // toward the customer's actual jobs + past notes patterns, and (b) drive
      // the deterministic post-AI job assignment in _autoInsertEntry.
      customerPatterns = await loadCustomerHistoricalPatterns(db, accountId, customerMatch.customerId);

      const { sanitized } = await redactRowForAi(entry, catalogs.customers, catalogs.employees, {
         resolvedCustomerId: customerMatch.customerId,
         resolvedUserId: employeeMatch.userId
      });
      try {
         const inferred = await inferCategorization({
            redactedRow: sanitized,
            refData: catalogs.refData,
            fewShots,
            customerPatterns,
            accountId,
            userId,
            timesheetEntryId: entry.timesheet_entry_id,
            db
         });
         suggestion = inferred.suggestion;
         suggestionCost = inferred.totalCost || 0;
         suggestionError = inferred.error || null;

         if (suggestion && !suggestion.suggested_general_work_description_id && suggestion.suggested_category_label) {
            const found = _findGwdByLabel(catalogs.refData, suggestion.suggested_category_label);
            if (found) suggestion.suggested_general_work_description_id = found;
         }
      } catch (err) {
         suggestionError = err.message;
      }
   }

   const decision = _gateDecision({ employeeMatch, customerMatch, suggestion });

   const sanitizedNotes = ''; // notes redaction happens inside redactRowForAi; not persisted here.

   if (decision.action === 'auto_insert') {
      try {
         await _autoInsertEntry(db, {
            entry,
            accountId,
            userId,
            suggestion,
            customerMatch,
            employeeMatch,
            sanitizedNotes,
            customerPatterns
         });
         return { entryId: entry.timesheet_entry_id, decision: 'auto_insert', reason: null, costUsd: suggestionCost };
      } catch (err) {
         const holdReason = err.holdReason || HOLD_REASONS.MISSING_REQUIRED_FIELD;
         await _holdEntry(db, {
            entryId: entry.timesheet_entry_id,
            accountId,
            holdReason,
            suggestion,
            suggestedCustomer: customerMatch,
            employeeMatch,
            sanitizedNotes
         });
         return { entryId: entry.timesheet_entry_id, decision: 'hold', reason: holdReason, costUsd: suggestionCost };
      }
   }

   await _holdEntry(db, {
      entryId: entry.timesheet_entry_id,
      accountId,
      holdReason: decision.reason,
      suggestion,
      suggestedCustomer: customerMatch.customerId ? customerMatch : null,
      employeeMatch,
      sanitizedNotes
   });
   return {
      entryId: entry.timesheet_entry_id,
      decision: 'hold',
      reason: decision.reason,
      suggestionError,
      costUsd: suggestionCost
   };
};

const processEntries = async ({ db, accountId, userId, entryIds }) => {
   if (!Array.isArray(entryIds) || !entryIds.length) {
      return { processed: 0, autoInserted: 0, held: 0, totalCostUsd: 0, perEntry: [] };
   }
   const entries = await db('timesheet_entries')
      .where({ account_id: accountId })
      .whereIn('timesheet_entry_id', entryIds)
      .where('is_processed', false)
      .select('*');

   const catalogs = await _loadCatalogs(db, accountId);
   const fewShots = await _loadFewShots(db, accountId);

   let costSoFar = await _todayDailyCostUsd(db, accountId);
   const limiter = pLimit(CONCURRENCY);
   const results = [];

   await Promise.all(
      entries.map(entry =>
         limiter(async () => {
            try {
               const result = await processEntry({ db, accountId, userId, entry, catalogs, fewShots, costSoFarUsd: costSoFar });
               costSoFar += result.costUsd || 0;
               results.push(result);
            } catch (err) {
               try {
                  await _holdEntry(db, {
                     entryId: entry.timesheet_entry_id,
                     accountId,
                     holdReason: HOLD_REASONS.BEDROCK_ERROR,
                     suggestion: null,
                     suggestedCustomer: null,
                     sanitizedNotes: ''
                  });
               } catch (holdErr) {
                  console.error('[auto-ingest] hold-on-error fallback failed:', holdErr.message);
               }
               results.push({ entryId: entry.timesheet_entry_id, decision: 'hold', reason: HOLD_REASONS.BEDROCK_ERROR, errorMessage: err.message });
            }
         })
      )
   );

   const autoInserted = results.filter(r => r.decision === 'auto_insert').length;
   const held = results.filter(r => r.decision === 'hold').length;
   return { processed: results.length, autoInserted, held, totalCostUsd: costSoFar, perEntry: results };
};

module.exports = {
   processEntries,
   processEntry,
   HOLD_REASONS,
   _gateDecision,
   _loadCatalogs,
   _loadFewShots
};
