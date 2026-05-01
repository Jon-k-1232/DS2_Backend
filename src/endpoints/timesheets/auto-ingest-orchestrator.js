const pLimit = require('p-limit');
const { matchCustomer } = require('../../ai_integrations/customerMatching');
const { inferCategorization } = require('../../ai_integrations/categoryInference');
const { matchEmployee } = require('../../utils/employeeMatching');
const { redactRowForAi } = require('../../utils/piiRedactor');
const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');

const AUTO_INSERT_THRESHOLD = Number(process.env.AUTO_INSERT_CONFIDENCE_THRESHOLD || 0.85);
const FUZZY_HIGH_THRESHOLD = Number(process.env.CUSTOMER_FUZZY_HIGH_THRESHOLD || 0.90);
const CONCURRENCY = Number(process.env.AUTO_INGEST_CONCURRENCY || 4);
const FEW_SHOT_LIMIT = Number(process.env.FEW_SHOT_LIMIT || 5);

const HOLD_REASONS = Object.freeze({
   NO_MATCHING_CUSTOMER: 'no_matching_customer',
   LOW_AI_CONFIDENCE: 'low_ai_confidence',
   MISSING_REQUIRED_FIELD: 'missing_required_field',
   AMBIGUOUS_CATEGORY: 'ambiguous_category',
   NEW_CUSTOMER_NEEDS_ADDITION: 'new_customer_needs_addition',
   EMPLOYEE_NOT_MATCHED: 'employee_not_matched',
   BEDROCK_ERROR: 'bedrock_error',
   AI_COST_CAP_REACHED: 'ai_cost_cap_reached'
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
      const rows = await db('ai_category_training_examples')
         .where({ account_id: accountId })
         .whereNotNull('final_category')
         .whereNotNull('sanitized_notes')
         .orderBy('updated_at', 'desc')
         .limit(FEW_SHOT_LIMIT);
      return rows.map(r => ({
         sanitized_notes: r.sanitized_notes,
         duration_minutes: r.duration_minutes,
         final_general_work_description: r.final_category
      }));
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

const _findCustomerJobId = async (db, accountId, customerId) => {
   if (!customerId) return null;
   const row = await db('customer_jobs')
      .where({ account_id: accountId, customer_id: customerId })
      .orderBy('created_at', 'desc')
      .select('customer_job_id')
      .first();
   return row ? row.customer_job_id : null;
};

const _writeSuggestion = async (db, { accountId, entryId, sanitizedNotes, suggestion, suggestedCustomer, status }) => {
   await db('ai_time_tracker_transaction_suggestions')
      .insert({
         account_id: accountId,
         timesheet_entry_id: entryId,
         sanitized_notes: sanitizedNotes || '',
         suggested_category: suggestion ? suggestion.suggested_category_label : null,
         suggested_job_category_id: suggestion ? suggestion.suggested_job_category_id : null,
         suggested_job_type_id: suggestion ? suggestion.suggested_job_type_id : null,
         suggested_general_work_description_id: suggestion ? suggestion.suggested_general_work_description_id : null,
         suggested_entity: null,
         suggested_customer_id: suggestedCustomer ? suggestedCustomer.customerId : null,
         suggested_customer_display_name: suggestedCustomer ? suggestedCustomer.displayName : null,
         ai_confidence: suggestion ? suggestion.category_confidence : null,
         ai_reason: suggestion ? suggestion.ai_reason : null,
         ai_payload: suggestion ? JSON.stringify({ suggestion, customer: suggestedCustomer }) : null,
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
         ai_payload: suggestion ? JSON.stringify({ suggestion, customer: suggestedCustomer }) : null,
         suggested_general_work_description_id: suggestion ? suggestion.suggested_general_work_description_id : null,
         suggested_job_category_id: suggestion ? suggestion.suggested_job_category_id : null,
         suggested_job_type_id: suggestion ? suggestion.suggested_job_type_id : null,
         suggested_customer_id: suggestedCustomer ? suggestedCustomer.customerId : null,
         suggested_customer_display_name: suggestedCustomer ? suggestedCustomer.displayName : null
      });
};

const _holdEntry = async (db, { entryId, accountId, holdReason, suggestion, suggestedCustomer, sanitizedNotes }) => {
   await db.transaction(async trx => {
      await trx('timesheet_entries')
         .where({ timesheet_entry_id: entryId, account_id: accountId })
         .update({
            hold_reason: holdReason,
            ai_attempted_at: new Date(),
            ai_payload: suggestion || suggestedCustomer ? JSON.stringify({ suggestion, customer: suggestedCustomer }) : null,
            suggested_customer_id: suggestedCustomer ? suggestedCustomer.customerId : null,
            matched_user_id: null
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

const _autoInsertEntry = async (db, { entry, accountId, userId, suggestion, customerMatch, employeeMatch, sanitizedNotes }) => {
   const customerJobId = await _findCustomerJobId(db, accountId, customerMatch.customerId);
   if (!customerJobId) {
      throw new Error('no_customer_job_for_auto_insert');
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
         detailedJobDescription: '',
         transactionDate: entry.date,
         transactionType: 'time',
         quantity: hours,
         unitCost,
         totalTransaction,
         isTransactionBillable: true,
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
         sanitizedNotes: ''
      });
      return { entryId: entry.timesheet_entry_id, decision: 'hold', reason: HOLD_REASONS.AI_COST_CAP_REACHED, costUsd: 0 };
   }

   let customerMatch = { customerId: null, displayName: null, score: 0, tier: 'none', candidates: [], reason: 'not_attempted' };
   if (employeeMatch) {
      customerMatch = await matchCustomer({
         searchName: entry.entity,
         customerCatalog: catalogs.customers,
         accountId,
         userId,
         timesheetEntryId: entry.timesheet_entry_id,
         db
      });
      if (!customerMatch.customerId && entry.first_name && entry.last_name) {
         customerMatch.reason = 'no_match_first_last_present';
         customerMatch.tier = 'new_individual';
      }
   }

   let suggestion = null;
   let suggestionCost = 0;
   let suggestionError = null;

   if (employeeMatch && customerMatch.customerId) {
      const { sanitized } = await redactRowForAi(entry, catalogs.customers, catalogs.employees, {
         resolvedCustomerId: customerMatch.customerId,
         resolvedUserId: employeeMatch.userId
      });
      try {
         const inferred = await inferCategorization({
            redactedRow: sanitized,
            refData: catalogs.refData,
            fewShots,
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
            sanitizedNotes
         });
         return { entryId: entry.timesheet_entry_id, decision: 'auto_insert', reason: null, costUsd: suggestionCost };
      } catch (err) {
         await _holdEntry(db, {
            entryId: entry.timesheet_entry_id,
            accountId,
            holdReason: HOLD_REASONS.MISSING_REQUIRED_FIELD,
            suggestion,
            suggestedCustomer: customerMatch,
            sanitizedNotes
         });
         return { entryId: entry.timesheet_entry_id, decision: 'hold', reason: `auto_insert_failed:${err.message}`, costUsd: suggestionCost };
      }
   }

   await _holdEntry(db, {
      entryId: entry.timesheet_entry_id,
      accountId,
      holdReason: decision.reason,
      suggestion,
      suggestedCustomer: customerMatch.customerId ? customerMatch : null,
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
