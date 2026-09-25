const pLimit = require('p-limit');
const { matchCustomer, NEEDS_REVIEW_TIER } = require('../../ai_integrations/customerMatching');
const { inferCategorization } = require('../../ai_integrations/categoryInference');
const { loadCustomerHistoricalPatterns, pickJobFromHistory, pickBillableFromHistory } = require('../../ai_integrations/customerHistoricalPatterns');
const { matchEmployee } = require('../../utils/employeeMatching');
const { redactRowForAi, _knownNamesFromCatalogs } = require('../../utils/piiRedactor');
const { canonicalNameKey } = require('../../utils/fuzzyMatch');
const { isNonWorkEntry } = require('../../timeTrackerValidation/nonWorkEntries');
const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');
const { loadInternalCustomerIds } = require('./internal-customers');

const AUTO_INSERT_THRESHOLD = Number(process.env.AUTO_INSERT_CONFIDENCE_THRESHOLD || 0.85);
const FUZZY_HIGH_THRESHOLD = Number(process.env.CUSTOMER_FUZZY_HIGH_THRESHOLD || 0.90);
const CONCURRENCY = Number(process.env.AUTO_INGEST_CONCURRENCY || 8);
const FEW_SHOT_LIMIT = Number(process.env.FEW_SHOT_LIMIT || 5);
// A search name becomes a reviewer-confirmed alias once reviewers have billed
// it to the same customer at least this many times and never to another one.
const MIN_ALIAS_CONFIRMATIONS = Number(process.env.CUSTOMER_ALIAS_MIN_CONFIRMATIONS || 2);

const HOLD_REASONS = Object.freeze({
   NO_MATCHING_CUSTOMER: 'no_matching_customer',
   LOW_AI_CONFIDENCE: 'low_ai_confidence',
   MISSING_REQUIRED_FIELD: 'missing_required_field',
   AMBIGUOUS_CATEGORY: 'ambiguous_category',
   NEW_CUSTOMER_NEEDS_ADDITION: 'new_customer_needs_addition',
   EMPLOYEE_NOT_MATCHED: 'employee_not_matched',
   BEDROCK_ERROR: 'bedrock_error',
   AI_COST_CAP_REACHED: 'ai_cost_cap_reached',
   MISSING_CURRENT_YEAR_JOB: 'missing_current_year_job',
   // The tracker's customer name matched more than one plausible customer (or
   // only on a single shared token). Candidate IDs are kept in ai_payload.
   AMBIGUOUS_CUSTOMER_MATCH: 'ambiguous_customer_match'
});

// Thrown inside the insert transaction when another run (or a reviewer) has
// already processed the entry; the transaction rolls back and the entry is
// reported as skipped — never held, never inserted twice.
const ALREADY_PROCESSED = 'timesheet_entry_already_processed';

const _customerSearchName = entry =>
   (entry && (entry.company_name ||
      (entry.first_name && entry.last_name ? `${entry.first_name} ${entry.last_name}` : null) ||
      entry.first_name ||
      entry.last_name)) ||
   null;

const _loadCatalogs = async (db, accountId) => {
   const [customers, employees, categories, jobTypes, gwds, account] = await Promise.all([
      // Deterministic order: matchCustomer's fuzzy tier depends only on
      // (query, label) now (see src/utils/fuzzyMatch.js), but an unordered
      // SELECT still lets Postgres return the catalog in a different physical
      // row order between runs, which made the AI payload's candidate order —
      // and which duplicate-name candidate is reported first — nondeterministic.
      db('customers').where({ account_id: accountId, is_customer_active: true }).orderBy('customer_id').select('customer_id', 'business_name', 'customer_name', 'display_name'),
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

// Search names that human reviewers have repeatedly — and only ever — billed to
// one customer (manual submissions, and reprocesses where the reviewer picked
// the customer). matchCustomer uses these ONLY to break a near-tie between
// fuzzy leaders that already agree on >= 2 name tokens, e.g. "Kimmel Financial
// Advisors" -> Kimmel Financial Partners (tied at 0.95 with "Jonathon and Kathy
// Kimmel"; reviewers have confirmed the former 100+ times).
const _loadConfirmedAliases = async (db, accountId) => {
   try {
      const rows = await db('timesheet_entries as te')
         .join('ai_time_tracker_transaction_suggestions as s', 's.timesheet_entry_id', 'te.timesheet_entry_id')
         .join('ai_category_training_examples as a', 'a.timesheet_entry_id', 'te.timesheet_entry_id')
         .join('customer_transactions as t', function joinTxn() {
            this.on('t.transaction_id', '=', 'a.transaction_id').andOn('t.account_id', '=', 'te.account_id');
         })
         .where('te.account_id', accountId)
         .where(q => q.where('s.status', 'applied').orWhereRaw("s.ai_payload->'customer'->>'tier' = 'reviewer_override'"))
         .select('te.company_name', 'te.first_name', 'te.last_name', 't.customer_id');
      const tallies = new Map();
      for (const row of rows) {
         const key = canonicalNameKey(_customerSearchName(row));
         if (!key || row.customer_id == null) continue;
         const perCustomer = tallies.get(key) || new Map();
         perCustomer.set(row.customer_id, (perCustomer.get(row.customer_id) || 0) + 1);
         tallies.set(key, perCustomer);
      }
      const aliases = new Map();
      for (const [key, perCustomer] of tallies) {
         if (perCustomer.size !== 1) continue;
         const [[customerId, count]] = [...perCustomer.entries()];
         if (count >= MIN_ALIAS_CONFIRMATIONS) aliases.set(key, customerId);
      }
      return aliases;
   } catch (e) {
      console.error('[auto-ingest] confirmed-alias load failed (continuing without aliases):', e.message);
      return new Map();
   }
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
// AFTER picking via 2/3/4:
//   - notes named a year but the customer has NO job for it (step 1 found none):
//     if the pick is a job for a DIFFERENT year, HOLD (missing_current_year_job,
//     detail names the requested year) — never fall back to another year's job.
//     Year-less jobs (monthly bookkeeping, consulting) are still fine.
//   - notes named no year: if the pick is year-prefixed for an OLD year, swap to
//     the same job family for the **transaction's tax year** (transaction_date_year
//     - 1; tax-prep work lags by a year, e.g. work logged in 2026 bills 2025
//     returns). No same-family job for that year -> HOLD (missing_current_year_job).
//     Uses the transaction date, NOT today, so historical reprocesses stay correct.
//
// Child jobs are NEVER assigned — they exist only as internal tracking rows.
const _normalizeForJobMatch = s => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const _stripYearFromJob = s => _normalizeForJobMatch(s).replace(/\b20\d{2}\b\s*/, '').trim();
const _jobYear = job => ((((job && job.job_description) || '').match(/\b(20\d{2})\b/)) || [])[1] || null;

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
//   { jobId: null, missingYear, family, fallbackJobId, fallbackJobYear }
//                               — stale year but customer has NO current-year same-family
//                                 job; caller should hold rather than bill the wrong year
const _resolveTaxYearSwap = (candidateJobId, patterns, transactionDate) => {
   const candidate = patterns.parentJobs.find(j => j.customer_job_id === candidateJobId);
   if (!candidate || !candidate.job_description) return { jobId: candidateJobId };
   const candYear = _jobYear(candidate);
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
   return { jobId: null, missingYear: ty, family: candidate.job_description, fallbackJobId: candidateJobId, fallbackJobYear: candYear };
};

/**
 * Resolve the parent job an auto-inserted row bills to.
 * @returns {Promise<{ jobId: number|null, holdReason?: string, holdDetail?: object }>}
 *   jobId null => the caller must HOLD the entry with holdReason; holdDetail
 *   (no PII — years and opaque job ids only) is persisted into ai_payload.hold.
 */
const _resolveCustomerJob = async (db, accountId, customerId, entry = null, { workDescId = null, patterns = null } = {}) => {
   if (!customerId) {
      return { jobId: null, holdReason: HOLD_REASONS.MISSING_REQUIRED_FIELD, holdDetail: { reason: 'no_customer' } };
   }

   const effectivePatterns = patterns || (await loadCustomerHistoricalPatterns(db, accountId, customerId));
   if (!effectivePatterns || !effectivePatterns.parentJobs || !effectivePatterns.parentJobs.length) {
      return { jobId: null, holdReason: HOLD_REASONS.MISSING_REQUIRED_FIELD, holdDetail: { reason: 'customer_has_no_open_parent_job' } };
   }

   const sourceText = [entry && entry.category, entry && entry.notes].filter(Boolean).join(' ');
   const yearMatches = [...new Set(sourceText.match(/\b(20\d{2})\b/g) || [])];
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
               return { jobId: hist.customer_job_id };
            }
         }
         const wordsOf = s => _normalizeForJobMatch(s).split(/[\s,.;:!?()\[\]"'/-]+/).filter(w => w.length >= 4 && !/^20\d{2}$/.test(w));
         const sw = wordsOf(sourceText);
         if (sw.length > 0) {
            const scored = yearJobs
               .map(j => ({ j, overlap: wordsOf(j.job_description).filter(w => sw.includes(w)).length }))
               .sort((a, b) => b.overlap - a.overlap);
            return { jobId: scored[0].j.customer_job_id };
         }
         return { jobId: yearJobs[0].customer_job_id };
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
               return { jobId: hist.customer_job_id };
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
         return { jobId: best ? best.id : monthlyJobs[0].customer_job_id };
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

   if (notesHaveYear) {
      // The notes named a year and step 1 found no job for it. Falling back to a job
      // for ANOTHER year would bill the wrong return — hold for a reviewer instead.
      const candidate = effectivePatterns.parentJobs.find(j => j.customer_job_id === candidateJobId);
      const candidateYear = _jobYear(candidate);
      if (candidateYear && !yearMatches.includes(candidateYear)) {
         return {
            jobId: null,
            holdReason: HOLD_REASONS.MISSING_CURRENT_YEAR_JOB,
            holdDetail: {
               reason: 'no_job_for_year_named_in_notes',
               requested_tax_year: yearMatches.join(', '),
               year_source: 'notes',
               fallback_job_id: candidateJobId,
               fallback_job_year: candidateYear
            }
         };
      }
      return { jobId: candidateJobId };
   }

   // No year in notes: if the pick is year-prefixed for an old year, swap to the same
   // family's current-tax-year job. If none exists (e.g. JKA hasn't created the 2025
   // PITR job yet), HOLD rather than silently billing the wrong year.
   const swap = _resolveTaxYearSwap(candidateJobId, effectivePatterns, entry && entry.date);
   if (swap.jobId) return { jobId: swap.jobId };
   return {
      jobId: null,
      holdReason: HOLD_REASONS.MISSING_CURRENT_YEAR_JOB,
      holdDetail: {
         reason: 'no_job_for_transaction_tax_year',
         requested_tax_year: swap.missingYear,
         year_source: 'transaction_date',
         fallback_job_id: swap.fallbackJobId,
         fallback_job_year: swap.fallbackJobYear
      }
   };
};

// Strip name/label fields before persisting. ai_payload must not contain
// any PII strings — only opaque IDs, scores, tiers and fixed reason codes.
const _safeCustomerForPayload = customer => {
   if (!customer) return null;
   const out = {
      customerId: customer.customerId,
      score: customer.score,
      tier: customer.tier,
      reason: customer.reason
      // intentionally omits: displayName, candidates[*].label
   };
   if (customer.tier === NEEDS_REVIEW_TIER && Array.isArray(customer.candidates)) {
      // Ambiguous match: keep the candidate IDs so the reviewer can pick one.
      out.candidates = customer.candidates.map(c => ({ id: c.id, score: c.score }));
   }
   return out;
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

const _safePayload = (suggestion, customer, holdDetail = null) => {
   if (!suggestion && !customer && !holdDetail) return null;
   const payload = {
      suggestion: _safeSuggestionForPayload(suggestion),
      customer: _safeCustomerForPayload(customer)
   };
   if (holdDetail) payload.hold = holdDetail;
   return JSON.stringify(payload);
};

const _writeSuggestion = async (db, { accountId, entryId, sanitizedNotes, suggestion, suggestedCustomer, status, holdDetail = null }) => {
   const safe = _safePayload(suggestion, suggestedCustomer, holdDetail);
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

// Returns true when the entry was held; false when it had already been
// processed (by a concurrent run or a reviewer) — an applied entry is never
// downgraded back to a hold.
const _holdEntry = async (db, { entryId, accountId, holdReason, suggestion, suggestedCustomer, employeeMatch = null, sanitizedNotes, holdDetail = null }) => {
   let held = false;
   await db.transaction(async trx => {
      const updated = await trx('timesheet_entries')
         .where({ timesheet_entry_id: entryId, account_id: accountId, is_processed: false })
         .update({
            hold_reason: holdReason,
            ai_attempted_at: new Date(),
            ai_payload: _safePayload(suggestion, suggestedCustomer, holdDetail),
            suggested_customer_id: suggestedCustomer ? suggestedCustomer.customerId : null,
            matched_user_id: employeeMatch ? employeeMatch.userId : null
         })
         .returning('timesheet_entry_id');
      if (!updated.length) return;
      held = true;
      await _writeSuggestion(trx, {
         accountId,
         entryId,
         sanitizedNotes,
         suggestion,
         suggestedCustomer,
         status: 'pending_review',
         holdDetail
      });
   });
   return held;
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
//   0a. Non-work time (vacation / PTO / holiday / sick / lunch / out of office /
//       personal) → false, always. Never billable, whatever history says.
//   0b. Internal customer (the firm's own entities, see internal-customers.js) → false,
//       always. The hours are still recorded for analytics.
//   1. Strong admin/payment regex match → false (ignores historical signal — back-office work
//      shouldn't be billed even if past data shows it was).
//   2. Customer history for this work_desc strongly favors non-billable (e.g. retainer client) → false.
//   3. Customer history for this work_desc strongly favors billable → true.
//   4. Default → true (safer to bill and let reviewer flip than to silently miss revenue).
const _decideBillable = ({ entry, suggestion, customerPatterns, internalCustomer = false }) => {
   if (isNonWorkEntry(entry)) return false;
   if (internalCustomer) return false;
   if (_isLikelyNonBillable(entry)) return false;
   const workDescId = suggestion && suggestion.suggested_general_work_description_id;
   const fromHistory = pickBillableFromHistory(customerPatterns, workDescId);
   if (fromHistory === false) return false;
   if (fromHistory === true) return true;
   return true;
};

// The firm bills time in 6-minute increments, ROUNDED UP (0.1h units) — the
// same rule the frontend's TimeTrackingIncrements.js already applies
// (Math.ceil(minutes / 6)). quantity and total are derived from the SAME
// rounded quantity, in integer cents/hundredths so the invoice's qty × rate
// always equals the line total. (customer_transactions.quantity is
// numeric(10,2); rounding hours only in the DB while totalling from the
// unrounded value made 4.4k prod rows disagree.)
// Examples: 1 min -> ceil(1/6)=1 -> 0.1h; 68 min -> ceil(68/6)=12 -> 1.2h;
// 60 min -> ceil(60/6)=10 -> 1.0h.
const _computeTimeAmounts = (minutes, rate) => {
   return require('../../utils/timeAmounts').computeTimeAmounts(minutes, rate);
};

// Resolve which employee a row should be billed to. Order: (1) an explicit
// reviewer override always wins; (2) the VALIDATED entry.user_id — the
// tracker owner, set at upload time from the authenticated/authorized owner,
// never from free-text — is the source of truth whenever present; (3) only a
// legacy pre-validation row with no user_id at all falls back to matching the
// free-text employee_name string, which is unsafe when two employees share a
// display name (matchEmployee itself refuses that case rather than guessing
// — see src/utils/employeeMatching.js).
const _resolveEmployeeMatch = (entry, catalogs, ov = {}) => {
   if (ov && ov.logged_for_user_id) {
      const emp = catalogs.employees.find(e => e.user_id === Number(ov.logged_for_user_id));
      return emp ? { userId: emp.user_id, displayName: emp.display_name } : null;
   }
   if (entry && entry.user_id != null) {
      const emp = catalogs.employees.find(e => Number(e.user_id) === Number(entry.user_id));
      return emp ? { userId: emp.user_id, displayName: emp.display_name } : null;
   }
   return matchEmployee(entry && entry.employee_name, catalogs.employees);
};

const _holdError = (holdReason, holdDetail = null) => {
   const err = new Error(holdReason);
   err.holdReason = holdReason;
   err.holdDetail = holdDetail;
   return err;
};

const _autoInsertEntry = async (db, { entry, accountId, userId, suggestion, customerMatch, employeeMatch, sanitizedNotes, customerPatterns = null, overrides = null, internalCustomerIds = null }) => {
   const ov = overrides || {};
   // Reviewer overrides win when present — otherwise fall back to deterministic picker
   const resolution = ov.customer_job_id
      ? { jobId: Number(ov.customer_job_id) }
      : await _resolveCustomerJob(db, accountId, customerMatch.customerId, entry, {
           workDescId: suggestion && suggestion.suggested_general_work_description_id,
           patterns: customerPatterns
        });
   if (!resolution.jobId) {
      throw _holdError(resolution.holdReason || HOLD_REASONS.MISSING_REQUIRED_FIELD, resolution.holdDetail || null);
   }
   const customerJobId = resolution.jobId;

   const minutesValue = ov.duration_minutes != null ? Number(ov.duration_minutes) : Number(entry.duration);
   if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
      // Legacy rows (pre-validation) include negative durations; never bill them.
      throw _holdError(HOLD_REASONS.MISSING_REQUIRED_FIELD, { reason: 'invalid_duration', duration_minutes: Number.isFinite(minutesValue) ? minutesValue : null });
   }
   const employee = (await db('users').where({ user_id: employeeMatch.userId }).select('billing_rate').first()) || {};
   const { quantity, unitCost, totalTransaction } = _computeTimeAmounts(minutesValue, employee.billing_rate);
   const txnDate = ov.transaction_date ? _toISODate(ov.transaction_date) : _toISODate(entry.date);
   const internalCustomer = Boolean(internalCustomerIds && internalCustomerIds.has(Number(customerMatch.customerId)));
   const isTransactionBillable = _decideBillable({ entry, suggestion, customerPatterns, internalCustomer });

   await db.transaction(async trx => {
      // Claim the entry FIRST, inside the same transaction as the insert. The row
      // lock + `is_processed = false` predicate means two concurrent runs (upload
      // kickoff + "Process pending", a double-clicked reprocess, ...) cannot both
      // insert: the loser updates 0 rows and rolls back.
      const claimed = await trx('timesheet_entries')
         .where({ timesheet_entry_id: entry.timesheet_entry_id, account_id: accountId, is_processed: false, is_deleted: false })
         .update({
            is_processed: true,
            hold_reason: null,
            ai_attempted_at: new Date(),
            matched_user_id: employeeMatch.userId,
            suggested_customer_id: customerMatch.customerId
         })
         .returning('timesheet_entry_id');
      if (!claimed.length) {
         const err = new Error(ALREADY_PROCESSED);
         err.code = ALREADY_PROCESSED;
         throw err;
      }

      await addNewTransaction(trx, {
         accountID: accountId,
         customerID: customerMatch.customerId,
         customerJobID: customerJobId,
         selectedRetainerID: null,
         customerInvoicesID: null,
         loggedForUserID: employeeMatch.userId,
         selectedGeneralWorkDescriptionID: suggestion.suggested_general_work_description_id,
         detailedJobDescription: entry.notes || '',
         transactionDate: txnDate,
         transactionType: 'Time',
         quantity,
         unitCost,
         totalTransaction,
         isTransactionBillable,
         isInAdditionToMonthlyCharge: false,
         loggedByUserID: userId,
         note: '',
         category: entry.category,
         minutes: minutesValue,
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
   if (customerMatch && customerMatch.tier === NEEDS_REVIEW_TIER) {
      return { action: 'hold', reason: HOLD_REASONS.AMBIGUOUS_CUSTOMER_MATCH };
   }
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

const _skipped = (entryId, costUsd = 0) => ({ entryId, decision: 'skip', reason: 'already_processed', costUsd });

// Customer patterns (parent jobs, history, redacted few-shots) are loaded once
// per customer per batch — the few-shot redaction calls Comprehend, so this
// keeps that cost proportional to distinct customers, not rows.
const _customerPatternsFor = (db, accountId, customerId, catalogs) => {
   const load = () => loadCustomerHistoricalPatterns(db, accountId, customerId, { knownNames: catalogs.knownNames || [] });
   const cache = catalogs.patternsCache;
   if (!cache) return load();
   if (!cache.has(customerId)) {
      cache.set(
         customerId,
         load().catch(err => {
            cache.delete(customerId);
            throw err;
         })
      );
   }
   return cache.get(customerId);
};

const processEntry = async ({ db, accountId, userId, entry, catalogs, fewShots, costSoFarUsd = 0, overrides = null }) => {
   // Reviewer overrides (from the "Rerun AI Processing" path) replace the AI's
   // matching/inference for the fields the reviewer corrected. Fields not in
   // overrides flow through normal AI logic. This lets the reviewer fix just
   // the broken field instead of rebuilding the whole row by hand.
   const ov = overrides || {};

   const employeeMatch = _resolveEmployeeMatch(entry, catalogs, ov);

   const cap = catalogs.account && catalogs.account.ai_daily_cost_cap_usd ? Number(catalogs.account.ai_daily_cost_cap_usd) : null;
   if (cap && costSoFarUsd >= cap) {
      const held = await _holdEntry(db, {
         entryId: entry.timesheet_entry_id,
         accountId,
         holdReason: HOLD_REASONS.AI_COST_CAP_REACHED,
         suggestion: null,
         suggestedCustomer: null,
         employeeMatch,
         sanitizedNotes: ''
      });
      if (!held) return _skipped(entry.timesheet_entry_id);
      return { entryId: entry.timesheet_entry_id, decision: 'hold', reason: HOLD_REASONS.AI_COST_CAP_REACHED, costUsd: 0 };
   }

   let customerMatch = { customerId: null, displayName: null, score: 0, tier: 'none', candidates: [], reason: 'not_attempted' };
   if (ov.customer_id) {
      const cust = catalogs.customers.find(c => c.customer_id === Number(ov.customer_id));
      if (cust) {
         customerMatch = {
            customerId: cust.customer_id,
            displayName: cust.display_name,
            score: 1.0,
            tier: 'reviewer_override',
            candidates: [],
            reason: 'reviewer_override'
         };
      }
   } else if (employeeMatch) {
      // Customer = company_name (business customer) OR first_name + last_name (individual customer).
      // entity is the EMPLOYER's business identity (which of the multi-business owner's entities the
      // employee was working FOR), NOT the customer. Don't ever look up customer from entity.
      const customerSearchName = _customerSearchName(entry);
      if (customerSearchName) {
         customerMatch = await matchCustomer({
            searchName: customerSearchName,
            customerCatalog: catalogs.customers,
            accountId,
            userId,
            timesheetEntryId: entry.timesheet_entry_id,
            db,
            confirmedAliases: catalogs.confirmedAliases || null
         });
      }
      if (!customerMatch.customerId && customerMatch.tier !== NEEDS_REVIEW_TIER && entry.first_name && entry.last_name) {
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
      // the deterministic post-AI job assignment in _autoInsertEntry. Past notes
      // are PII-redacted against the account's known names before use.
      customerPatterns = await _customerPatternsFor(db, accountId, customerMatch.customerId, catalogs);

      if (ov.general_work_description_id) {
         // Reviewer hand-picked the work description — skip the AI call entirely.
         const gwd = (catalogs.refData.general_work_descriptions || []).find(g => g.id === Number(ov.general_work_description_id));
         suggestion = {
            suggested_general_work_description_id: Number(ov.general_work_description_id),
            suggested_job_category_id: null,
            suggested_job_type_id: null,
            suggested_category_label: gwd ? gwd.label : null,
            category_confidence: 1.0,
            ai_reason: 'reviewer override'
         };
      } else {
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
            customerPatterns,
            overrides: ov,
            internalCustomerIds: catalogs.internalCustomerIds || null
         });
         return { entryId: entry.timesheet_entry_id, decision: 'auto_insert', reason: null, costUsd: suggestionCost };
      } catch (err) {
         if (err.code === ALREADY_PROCESSED) return _skipped(entry.timesheet_entry_id, suggestionCost);
         if (!err.holdReason) {
            // Unexpected insert failure (job/customer guard, DB error). The raw message can
            // carry data values, so it is logged — never persisted into ai_payload.
            console.error(`[auto-ingest] auto-insert failed for entry ${entry.timesheet_entry_id}: ${err.message}`);
         }
         const holdReason = err.holdReason || HOLD_REASONS.MISSING_REQUIRED_FIELD;
         const held = await _holdEntry(db, {
            entryId: entry.timesheet_entry_id,
            accountId,
            holdReason,
            suggestion,
            suggestedCustomer: customerMatch,
            employeeMatch,
            sanitizedNotes,
            holdDetail: err.holdDetail || (err.holdReason ? null : { reason: 'auto_insert_failed' })
         });
         if (!held) return _skipped(entry.timesheet_entry_id, suggestionCost);
         return { entryId: entry.timesheet_entry_id, decision: 'hold', reason: holdReason, costUsd: suggestionCost };
      }
   }

   const held = await _holdEntry(db, {
      entryId: entry.timesheet_entry_id,
      accountId,
      holdReason: decision.reason,
      suggestion,
      // Ambiguous matches carry no customerId but keep their candidate IDs for review.
      suggestedCustomer: customerMatch.customerId || customerMatch.tier === NEEDS_REVIEW_TIER ? customerMatch : null,
      employeeMatch,
      sanitizedNotes
   });
   if (!held) return _skipped(entry.timesheet_entry_id, suggestionCost);
   return {
      entryId: entry.timesheet_entry_id,
      decision: 'hold',
      reason: decision.reason,
      suggestionError,
      costUsd: suggestionCost
   };
};

const processEntries = async ({ db, accountId, userId, entryIds, overridesByEntryId = null }) => {
   const empty = { processed: 0, autoInserted: 0, held: 0, skipped: 0, totalCostUsd: 0, perEntry: [] };
   if (!Array.isArray(entryIds) || !entryIds.length) {
      return empty;
   }
   const entries = await db('timesheet_entries')
      .where({ account_id: accountId })
      .whereIn('timesheet_entry_id', entryIds)
      .where('is_processed', false)
      .where('is_deleted', false)
      .select('*');
   if (!entries.length) {
      return empty;
   }

   const catalogs = await _loadCatalogs(db, accountId);
   catalogs.knownNames = _knownNamesFromCatalogs(catalogs.customers, catalogs.employees);
   catalogs.confirmedAliases = await _loadConfirmedAliases(db, accountId);
   catalogs.internalCustomerIds = await loadInternalCustomerIds(db, accountId, { customers: catalogs.customers });
   catalogs.patternsCache = new Map();
   const fewShots = await _loadFewShots(db, accountId);

   let costSoFar = await _todayDailyCostUsd(db, accountId);
   const limiter = pLimit(CONCURRENCY);
   const results = [];

   await Promise.all(
      entries.map(entry =>
         limiter(async () => {
            try {
               const overrides = overridesByEntryId ? overridesByEntryId[entry.timesheet_entry_id] || null : null;
               const result = await processEntry({ db, accountId, userId, entry, catalogs, fewShots, costSoFarUsd: costSoFar, overrides });
               costSoFar += result.costUsd || 0;
               results.push(result);
            } catch (err) {
               let held = true;
               try {
                  held = await _holdEntry(db, {
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
               results.push(
                  held
                     ? { entryId: entry.timesheet_entry_id, decision: 'hold', reason: HOLD_REASONS.BEDROCK_ERROR, errorMessage: err.message }
                     : _skipped(entry.timesheet_entry_id)
               );
            }
         })
      )
   );

   const autoInserted = results.filter(r => r.decision === 'auto_insert').length;
   const held = results.filter(r => r.decision === 'hold').length;
   const skipped = results.filter(r => r.decision === 'skip').length;
   return { processed: results.length, autoInserted, held, skipped, totalCostUsd: costSoFar, perEntry: results };
};

module.exports = {
   processEntries,
   processEntry,
   HOLD_REASONS,
   ALREADY_PROCESSED,
   _gateDecision,
   _loadCatalogs,
   _loadFewShots,
   _loadConfirmedAliases,
   _resolveCustomerJob,
   _decideBillable,
   _computeTimeAmounts,
   _resolveEmployeeMatch,
   _safePayload
};
