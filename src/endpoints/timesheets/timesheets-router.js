const express = require('express');
const { clientSafeMessage } = require('../../utils/clientError');
const { enforceAccountId, enforceSelfOrPrivileged, PRIVILEGED_ROLES } = require('../auth/account-scope');
const timesheetsRouter = express.Router();
timesheetsRouter.param('accountID', enforceAccountId);
// :queryUserID identifies the OWNER of the rows being read (getTimesheetEntriesByUserID,
// getAllTimesheetsForEmployeeByUserID, fetchTimesheetsByMonth) — a non-privileged
// caller may only address their own id, same rule timeTracking-router.js applies to
// its :userID. requireAuth runs first (app.js mounts this router with it), so
// req.user is already populated by the time this param handler fires.
timesheetsRouter.param('queryUserID', enforceSelfOrPrivileged);
const asyncHandler = require('../../utils/asyncHandler');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const timesheetsService = require('./timesheets-service');
const timesheetSuggestionsService = require('./timesheet-suggestions-service');
const transactionsService = require('../transactions/transactions-service');
const accountUserService = require('../user/user-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');
const { createGrid } = require('../../utils/gridFunctions');
const { restoreDataTypesTransactionsTableOnCreate } = require('../transactions/transactionsObjects');
const dayjs = require('dayjs');
const { kickOffAutoIngestForEntryIds, _isAccountAllowed: _isAutoIngestAllowed } = require('./auto-ingest-runner');
const timesheetsServiceLocal = require('./timesheets-service');
const { isInternalCustomer } = require('./internal-customers');
const { isNonWorkEntry } = require('../../timeTrackerValidation/nonWorkEntries');
const { _computeTimeAmounts } = require('./auto-ingest-orchestrator');

// Firm-wide reads (every employee's pending entries / counts) and the two
// billing-affecting actions (moveToTransactions, deleteTimesheetEntry) are
// manager-and-up only — the only UI that calls this router (Tracking
// Administration) is itself wrapped in ManagerAndAdminProtectedAccessRoute on
// the frontend, but the API had no matching server-side gate.
const isPrivilegedRole = req => PRIVILEGED_ROLES.includes(String((req.user && req.user.access_level) || '').toLowerCase());
const requireManagerOrAbove = (req, res) => {
   if (!req.user || !isPrivilegedRole(req)) {
      res.status(403).json({ status: 403, message: 'Manager, admin or super admin access required.' });
      return false;
   }
   return true;
};

// getPaginationParams (utils/pagination.js) throws a plain, unannotated Error
// on invalid page/limit rather than one carrying a .status — call it through
// here so every route answers 400 (a client input error) instead of letting
// it fall into the generic catch below, which used to answer 500.
const parsePagination = (req, res) => {
   try {
      return { ok: true, params: getPaginationParams(req.query) };
   } catch (err) {
      res.status(400).json({ status: 400, message: clientSafeMessage(err, 'Invalid pagination parameters. Page and limit must be positive integers.') });
      return { ok: false };
   }
};

// Get timesheet entries
timesheetsRouter.route('/getTimesheetEntries/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      // Firm-wide read: every employee's pending entries.
      if (!requireManagerOrAbove(req, res)) return;

      const pagination = parsePagination(req, res);
      if (!pagination.ok) return;

      try {
         const { page, limit, offset } = pagination.params;

         const { outstandingTimesheetEntries, entriesMetadata } = await fetchTimesheetEntries(db, accountID, page, limit, offset);

         res.status(200).json({
            outstandingTimesheetEntries,
            pagination: entriesMetadata,
            message: 'Successfully retrieved timesheet entries.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving timesheet entries for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') });
      }
   })
);

// Kick off Bedrock auto-ingest for a given timesheet name or set of entry IDs.
// (Replaces the legacy OpenAI suggestion kickoff; same path, new pipeline.)
timesheetsRouter.route('/ai/kickoff/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;
      const accountIdNumber = Number(accountID);
      // The ACTOR is always the authenticated caller — never the URL :userID
      // (unauthenticated-by-itself; this route never registered
      // enforceSelfOrPrivileged on :userID at all) or anything from the body.
      // Otherwise any authenticated account member could pass any other
      // employee's id as :userID and have their name recorded as the one who
      // triggered the AI/billing work.
      const userIdNumber = Number(req.user.user_id);
      const { timesheet_name, entry_ids } = req.body || {};

      if (!timesheet_name && (!Array.isArray(entry_ids) || !entry_ids.length)) {
         return res.status(400).json({ status: 400, message: 'Provide timesheet_name or entry_ids to kick off auto-ingest.' });
      }

      if (!_isAutoIngestAllowed(accountIdNumber)) {
         return res.status(503).json({ status: 503, message: 'Auto-ingest is not enabled for this account (TIME_TRACKER_AI_FEATURE_FLAG).' });
      }

      const privileged = isPrivilegedRole(req);
      let entryIds = [];
      if (timesheet_name) {
         // Resolve entries from the TRACKER's own owner, not the caller (:userID).
         // A timesheet_name is unique per upload and every row under it already
         // carries its real owner's user_id, so no separate owner lookup is
         // needed — filtering by (account, timesheet_name) alone is correct and
         // lets a manager/admin kick off an employee's tracker by name.
         const entries = await timesheetsServiceLocal.getEntriesByTimesheetName(db, accountIdNumber, String(timesheet_name));
         // A non-privileged caller may only name their OWN tracker — otherwise
         // any employee could kick off (and appear as the actor for) another
         // employee's tracker just by knowing its stored file name.
         if (!privileged && entries.some(e => Number(e.user_id) !== userIdNumber)) {
            return res.status(403).json({ status: 403, message: 'Access denied for this tracker.' });
         }
         entryIds = (entries || []).map(e => e.timesheet_entry_id).filter(Boolean);
      } else {
         entryIds = entry_ids.map(Number).filter(Boolean);
         if (!privileged && entryIds.length) {
            const owned = await db('timesheet_entries')
               .where({ account_id: accountIdNumber, user_id: userIdNumber })
               .whereIn('timesheet_entry_id', entryIds)
               .pluck('timesheet_entry_id');
            if (entryIds.some(id => !owned.includes(id))) {
               return res.status(403).json({ status: 403, message: 'Access denied for this tracker.' });
            }
         }
      }

      if (entryIds.length) {
         kickOffAutoIngestForEntryIds({ db, accountId: accountIdNumber, userId: userIdNumber, entryIds });
      }

      return res.status(202).json({ status: 202, message: 'Auto-ingest job accepted and running in background.', entryIdsCount: entryIds.length });
   })
);

// Get Timesheet Entries By User ID
timesheetsRouter.route('/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, queryUserID } = req.params;

      const pagination = parsePagination(req, res);
      if (!pagination.ok) return;

      try {
         const { page, limit, offset } = pagination.params;

         const { outstandingTimesheetEntries, entriesMetadata } = await fetchTimesheetEntriesByUserID(db, accountID, queryUserID, page, limit, offset);

         // put into grid format
         const gridRows = outstandingTimesheetEntries.map(entry => {
            const { ai_suggestion, ...gridSafeEntry } = entry;
            // Include ai_status for frontend indicators
            return { ...gridSafeEntry, ai_status: ai_suggestion?.status || null };
         });

         const timesheetsByEmployeesData = {
            outstandingTimesheetEntries,
            grid: createGrid(gridRows)
         };

         res.status(200).json({
            ...timesheetsByEmployeesData,
            pagination: entriesMetadata,
            message: 'Successfully retrieved timesheet entries.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving employee timesheet entries for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') });
      }
   })
);

// getTimesheetEntriesByUserID
timesheetsRouter.route('/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, queryUserID } = req.params;
      const pagination = parsePagination(req, res);
      if (!pagination.ok) return;
      const { page, limit, offset } = pagination.params;
      try {
         const { allEmployeeTimesheets, entriesMetadata } = await fetchEmployeeTimesheets(db, accountID, queryUserID, page, limit, offset);
         // put into grid format
         const timesheetsByEmployeesData = {
            allEmployeeTimesheets,
            grid: createGrid(allEmployeeTimesheets)
         };

         res.status(200).json({
            ...timesheetsByEmployeesData,
            pagination: entriesMetadata,
            message: 'Successfully retrieved employee timesheets.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving employee timesheet entries for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') });
      }
   })
);

timesheetsRouter.route('/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, queryUserID } = req.params;
      const pagination = parsePagination(req, res);
      if (!pagination.ok) return;
      const { page, limit, offset } = pagination.params;
      const monthQuery = {
         start: dayjs().startOf('month').toDate(),
         end: dayjs().endOf('month').toDate()
      };

      try {
         const { employeeTimesheetsForMonth, entriesMetadata } = await fetchEmployeeTimesheetForMonth(db, accountID, queryUserID, page, limit, offset, monthQuery);

         // put into grid format
         const timesheetsByEmployeesData = {
            employeeTimesheetsForMonth,
            grid: createGrid(employeeTimesheetsForMonth)
         };
         res.status(200).json({
            ...timesheetsByEmployeesData,
            pagination: entriesMetadata,
            message: 'Successfully retrieved employee timesheets.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving employee timesheet entries for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') });
      }
   })
);

// Counts By Employee
timesheetsRouter.route('/countsByEmployee/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      // Firm-wide read: every employee's counts.
      if (!requireManagerOrAbove(req, res)) return;

      try {
         const timesheetsByEmployees = await fetchEmployeeTimesheetCounts(db, accountID);

         // put into grid format
         const timesheetsByEmployeesData = {
            timesheetsByEmployees,
            grid: createGrid(timesheetsByEmployees)
         };

         res.status(200).json({
            ...timesheetsByEmployeesData,
            message: 'Successfully retrieved timesheet counts by employee.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving timesheet counts by employee for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet counts by employee.') });
      }
   })
);

// Move To Transactions (legacy manual apply).
// The entry is claimed (`is_processed = false` -> true) inside the SAME
// transaction as the insert, so a double-click / retry can't create a second
// transaction for one tracker line (prod had three entries billed twice,
// 0.2-4s apart). account_id comes from the enforced :accountID param, never
// from the request body.
timesheetsRouter.route('/moveToTransactions/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { entry } = req.body || {};
      const accountIdNumber = Number(req.params.accountID);

      // The manual-apply UI (Tracking Administration) is Manager/Admin only.
      if (!requireManagerOrAbove(req, res)) return;

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
         return res.status(400).json({ status: 400, message: 'A valid timesheetEntryID is required to move a timesheet entry to transactions.' });
      }

      try {
         const sanitizedEntry = sanitizeFields(entry);
         const timesheetEntryID = Number(sanitizedEntry?.timesheetEntryID || sanitizedEntry?.timesheet_entry_id);
         if (!Number.isInteger(timesheetEntryID) || timesheetEntryID <= 0) {
            return res.status(400).json({ status: 400, message: 'A valid timesheetEntryID is required to move a timesheet entry to transactions.' });
         }

         const newTransaction = restoreDataTypesTransactionsTableOnCreate({ ...sanitizedEntry, account_id: accountIdNumber });

         // The actor who applied this entry is always the authenticated
         // caller — never whatever loggedByUserID the client's request body
         // happened to carry.
         sanitizedEntry.loggedByUserID = Number(req.user.user_id);

         // The firm's own entities are never billed (hours are still recorded).
         const internalCustomer = await isInternalCustomer(db, accountIdNumber, newTransaction.customer_id);

         // Reuse central addNewTransaction to ensure consistent side-effects (job total,
         // retainer draw-down, AI training insert, ...). It already updates the job total,
         // so the router no longer does it a second time.
         const mergedForCreate = {
            ...sanitizedEntry,
            account_id: accountIdNumber,
            accountID: accountIdNumber,
            customerID: newTransaction.customer_id,
            customerJobID: newTransaction.customer_job_id,
            selectedGeneralWorkDescriptionID: newTransaction.general_work_description_id,
            loggedForUserID: newTransaction.logged_for_user_id,
            totalTransaction: newTransaction.total_transaction,
            isTransactionBillable: internalCustomer ? false : newTransaction.is_transaction_billable,
            isInAdditionToMonthlyCharge: newTransaction.is_excess_to_subscription,
            minutes: sanitizedEntry?.minutes || null,
            timesheetEntryID,
            aiSuggestion: sanitizedEntry?.aiSuggestion || sanitizedEntry?.ai_suggestion || null,
            entity: sanitizedEntry?.entity || null,
            category: sanitizedEntry?.category || null
         };

         await db.transaction(async trx => {
            const claimed = await trx('timesheet_entries')
               .where({ timesheet_entry_id: timesheetEntryID, account_id: accountIdNumber, is_processed: false, is_deleted: false })
               .update({ is_processed: true, hold_reason: null })
               .returning('*');
            if (!claimed.length) {
               const alreadyDone = new Error('This timesheet entry was already moved to transactions (or was deleted).');
               alreadyDone.status = 409;
               throw alreadyDone;
            }

            // A valid FK does not establish tenant ownership: both the employee
            // and the work description must belong to THIS account, not merely
            // exist somewhere in the database (a client could send another
            // tenant's row id for either). Checked AFTER the claim so it runs
            // inside the same transaction — a refusal here rolls the claim back
            // too, so nothing is written.
            const [employeeRecord, gwdRecord] = await Promise.all([
               trx('users').where({ account_id: accountIdNumber, user_id: newTransaction.logged_for_user_id }).first(),
               trx('customer_general_work_descriptions').where({ account_id: accountIdNumber, general_work_description_id: newTransaction.general_work_description_id }).first()
            ]);
            if (!employeeRecord || !gwdRecord) {
               const badTenancy = new Error('Employee and work description must belong to this account.');
               badTenancy.status = 400;
               throw badTenancy;
            }

            // A Time row's quantity/total are ALWAYS recomputed server-side
            // from the STORED minutes (a reviewer's explicit minute override
            // wins if sent) and the account-scoped employee's rate (a
            // reviewer's explicit rate override wins if sent) — never taken
            // from the request's quantity/unitCost/totalTransaction, which
            // let a client persist stale hundredth-hour pricing (or a
            // sub-cent rate) even after the AI/held-apply paths were fixed to
            // price in 6-minute increments. 'Charge' rows are flat amounts,
            // not time-derived, and are unaffected.
            if (newTransaction.transaction_type === 'Time') {
               const minutes = Number(sanitizedEntry.minutes ?? claimed[0].duration);
               const rawRate = sanitizedEntry.unitCost ?? employeeRecord.billing_rate;
               const rateIsWellFormed = /^\d+(?:\.\d{1,2})?$/.test(String(rawRate ?? '').trim()) && Number.isFinite(Number(rawRate));
               if (!Number.isFinite(minutes) || minutes <= 0 || !rateIsWellFormed) {
                  const invalidTime = new Error('Time requires positive minutes and a rate of zero or more with at most 2 decimal places.');
                  invalidTime.status = 400;
                  throw invalidTime;
               }
               Object.assign(mergedForCreate, _computeTimeAmounts(minutes, rawRate), { minutes });
            }

            // Non-work time (vacation / PTO / holiday / sick / lunch / personal /
            // doctor's appointment / ...) is never billable — decided from the
            // STORED entry (the row just claimed), never the request's editable
            // category/notes text, which a client can send differently from what
            // was actually uploaded.
            if (isNonWorkEntry(claimed[0])) {
               mergedForCreate.isTransactionBillable = false;
            }
            await addNewTransaction(trx, mergedForCreate);
            await timesheetSuggestionsService.updateSuggestion(trx, timesheetEntryID, { status: 'applied' });
         });

         res.status(200).json({
            status: 200,
            message: 'Successfully moved timesheet entry to transactions.'
         });
      } catch (err) {
         if (err.status === 409 || err.status === 400) {
            return res.status(err.status).json({ status: err.status, message: err.message });
         }
         console.error(`[${new Date().toISOString()}] Error moving timesheet entry to transactions: ${err.message}`);
         res.status(500).json({ message: clientSafeMessage(err, 'Error moving timesheet entry to transactions.') });
      }
   })
);

timesheetsRouter.route('/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID').delete(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { timesheetEntryID, accountID } = req.params;

      // Same bar as moveToTransactions: Manager/Admin only.
      if (!requireManagerOrAbove(req, res)) return;

      const entryIdNumber = Number(timesheetEntryID);
      if (!Number.isInteger(entryIdNumber) || entryIdNumber <= 0) {
         return res.status(400).json({ status: 400, message: 'A valid timesheetEntryID is required to delete a timesheet entry.' });
      }

      try {
         const foundEntry = await timesheetsService.getSingleTimesheetEntry(db, accountID, timesheetEntryID);
         if (!foundEntry) {
            return res.status(404).json({ status: 404, message: 'Timesheet entry not found.' });
         }
         // Ledger rule: an entry that has already been turned into a transaction
         // (auto-ingest or moveToTransactions, either of which sets is_processed
         // = true in the SAME transaction as the transaction insert) must not be
         // soft-deleted — the transaction would stay billed while the entry
         // silently vanished from the review queue, and trackerDuplicates would
         // then let a re-upload of the same tracker re-insert and re-bill that
         // exact line (see trackerDuplicates.js's module doc comment).
         if (foundEntry.is_processed) {
            return res.status(409).json({
               status: 409,
               message: 'This timesheet entry has already been processed into a transaction and cannot be deleted. Reverse or delete the transaction first.'
            });
         }
         // Delete with a conditional UPDATE ... WHERE is_processed = false AND
         // is_deleted = false ... RETURNING — never write the `foundEntry`
         // object read above. A concurrent apply (auto-ingest OR a reviewer's
         // manual apply) can claim this exact entry — setting is_processed =
         // true — in the gap between that read and this write; blindly writing
         // the stale, already-false is_processed value back would silently
         // resurrect the row as unprocessed WHILE ALSO marking it deleted
         // ({is_processed:false, is_deleted:true}) even though a live billed
         // transaction now exists for it. The atomic predicate makes this
         // write a no-op (0 rows) in that case instead.
         const deleted = await timesheetsService.deleteTimesheetEntryIfPending(db, accountID, entryIdNumber);
         if (!deleted.length) {
            return res.status(409).json({
               status: 409,
               message: 'This timesheet entry was processed or deleted by someone else; refresh before retrying.'
            });
         }

         console.log(`[${new Date().toISOString()}] Successfully deleted timesheet entry ID ${timesheetEntryID} for account ${accountID}.`);

         res.status(200).json({
            message: 'Successfully deleted timesheet entry.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error deleting timesheet entry: ${err.message}`);
         res.status(500).json({ message: clientSafeMessage(err, 'Error deleting timesheet entry.') });
      }
   })
);

module.exports = timesheetsRouter;

const formatSuggestionForResponse = suggestion => {
   if (!suggestion) return null;

   return {
      suggestion_id: suggestion.suggestion_id,
      timesheet_entry_id: suggestion.timesheet_entry_id,
      sanitized_notes: suggestion.sanitized_notes,
      suggested_category: suggestion.suggested_category,
      suggested_job_category_id: suggestion.suggested_job_category_id,
      suggested_job_type_id: suggestion.suggested_job_type_id,
      suggested_general_work_description_id: suggestion.suggested_general_work_description_id,
      suggested_entity: suggestion.suggested_entity,
      suggested_customer_id: suggestion.suggested_customer_id,
      suggested_customer_display_name: suggestion.suggested_customer_display_name,
      ai_confidence: suggestion.ai_confidence,
      ai_reason: suggestion.ai_reason,
      status: suggestion.status,
      source: suggestion.source,
      ai_payload: suggestion.ai_payload,
      updated_at: suggestion.updated_at,
      created_at: suggestion.created_at
   };
};

const attachSuggestionsToEntries = async (db, accountID, entries = []) => {
   if (!Array.isArray(entries) || !entries.length) {
      return entries;
   }

   const entryIds = entries.map(entry => entry.timesheet_entry_id).filter(Boolean);
   if (!entryIds.length) {
      return entries;
   }

   const suggestions = await timesheetSuggestionsService.getSuggestionsForEntries(db, accountID, entryIds);
   if (!Array.isArray(suggestions) || !suggestions.length) {
      return entries;
   }

   const suggestionMap = new Map();
   suggestions.forEach(suggestion => {
      suggestionMap.set(suggestion.timesheet_entry_id, formatSuggestionForResponse(suggestion));
   });

   return entries.map(entry => {
      if (!entry || !entry.timesheet_entry_id) return entry;
      const suggestion = suggestionMap.get(entry.timesheet_entry_id);
      return suggestion ? { ...entry, ai_suggestion: suggestion } : entry;
   });
};

/**
 *
 * @param {*} db
 * @param {*} accountID
 * @param {*} queryUserID
 * @param {*} page
 * @param {*} limit
 * @param {*} offset
 * @returns
 */
const fetchTimesheetEntriesByUserID = async (db, accountID, queryUserID, page, limit, offset) => {
   const [outstandingTimesheetEntries, totalEntries] = await Promise.all([
      timesheetsService.getPendingTimesheetEntriesByUserID(db, accountID, queryUserID, limit, offset),
      timesheetsService.getOutstandingTimesheetEntriesCountByUserID(db, accountID, queryUserID)
   ]);

   const entriesWithSuggestions = await attachSuggestionsToEntries(db, accountID, outstandingTimesheetEntries);

   const entriesMetadata = getPaginationMetadata(totalEntries, page, limit);

   return { outstandingTimesheetEntries: entriesWithSuggestions, entriesMetadata };
};

// fetch employee timesheets
const fetchEmployeeTimesheets = async (db, accountID, queryUserID, page, limit, offset) => {
   const [allEmployeeTimesheets, totalEntries] = await Promise.all([
      timesheetsService.getTimesheetSummariesByUser(db, accountID, queryUserID, limit, offset),
      timesheetsService.getTimesheetSummariesCountByUser(db, accountID, queryUserID)
   ]);

   const sanitizedTimesheets = allEmployeeTimesheets.map(entry => {
      const { timesheet_entry_id, account_id, user_id, rn, ...rest } = entry;
      return rest;
   });

   const entriesMetadata = getPaginationMetadata(totalEntries, page, limit);

   return { allEmployeeTimesheets: sanitizedTimesheets, entriesMetadata };
};

const fetchEmployeeTimesheetForMonth = async (db, accountID, queryUserID, page, limit, offset, monthQuery) => {
   const [employeeTimesheetsForMonth, totalEntries] = await Promise.all([
      timesheetsService.getTimesheetSummariesByUserAndMonth(db, accountID, queryUserID, monthQuery, limit, offset),
      timesheetsService.getTimesheetSummariesCountByUserAndMonth(db, accountID, queryUserID, monthQuery)
   ]);

   const sanitizedTimesheets = employeeTimesheetsForMonth.map(entry => {
      const { timesheet_entry_id, account_id, user_id, rn, ...rest } = entry;
      return rest;
   });

   const entriesMetadata = getPaginationMetadata(totalEntries, page, limit);

   return { employeeTimesheetsForMonth: sanitizedTimesheets, entriesMetadata };
};

/**
 * Send an error notification email to the DS2 Support team
 * @param {*} db
 * @param {*} accountID
 * @returns {Promise} - Promise that resolves when the email is sent
 */
const fetchEmployeeTimesheetCounts = async (db, accountID) => {
   // get employee list. This is used to get the employee name for each timesheet count
   const employeesData = await accountUserService.getActiveAccountUsers(db, accountID);
   const employees = employeesData.filter(employee => employee.display_name !== 'Jon Kimmel');
   const monthQuery = {
      start: dayjs().startOf('month').toDate(),
      end: dayjs().endOf('month').toDate()
   };
   const limit = Number.MAX_SAFE_INTEGER;
   const offset = 0;

   return Promise.all(
      employees.map(async employee => {
         const { display_name, user_id } = employee;

         try {
            const [transactionCount, timesheetsToDate, timeTrackersByMonth, aiProcessing, aiCompleted, aiFailed] = await Promise.all([
               timesheetsService.getTimesheetEntryCountsByEmployee(db, accountID, user_id),
               timesheetsService.getTimesheetSummariesCountByUser(db, accountID, user_id),
               timesheetsService.getTimesheetSummariesCountByUserAndMonth(db, accountID, user_id, monthQuery),
               timesheetsService.getAiProcessingCountsByEmployee(db, accountID, user_id),
               timesheetsService.getAiCompletedCountsByEmployee(db, accountID, user_id),
               timesheetsService.getAiFailedCountsByEmployee(db, accountID, user_id)
            ]);

            return {
               display_name,
               user_id,
               transaction_count: transactionCount,
               trackers_to_date: timesheetsToDate,
               trackers_by_month: timeTrackersByMonth,
               ai_processing_count: aiProcessing,
               ai_completed_count: aiCompleted,
               ai_failed_count: aiFailed
            };
         } catch (err) {
            console.error(`Error for User ID ${user_id}:`, err);
            return {
               display_name,
               user_id,
               transaction_count: 0,
               trackers_to_date: 0,
               trackers_by_month: 0,
               ai_processing_count: 0,
               ai_completed_count: 0,
               ai_failed_count: 0
            };
         }
      })
   );
};

/**
 * Fetch timesheet entries and metadata for the given account
 * @param {*} db
 * @param {*} accountID
 * @param {*} page
 * @param {*} limit
 * @param {*} offset
 * @returns {Object} - {outstandingTimesheetEntries, entriesMetadata}
 */
const fetchTimesheetEntries = async (db, accountID, page, limit, offset) => {
   const [outstandingTimesheetEntries, totalEntries] = await Promise.all([
      timesheetsService.getOutstandingTimesheetEntries(db, accountID, limit, offset),
      timesheetsService.getOutstandingTimesheetEntriesCount(db, accountID)
   ]);

   const entriesWithSuggestions = await attachSuggestionsToEntries(db, accountID, outstandingTimesheetEntries);

   const entriesMetadata = getPaginationMetadata(totalEntries, page, limit);

   return { outstandingTimesheetEntries: entriesWithSuggestions, entriesMetadata };
};

/**
 * Fetch timesheet errors and metadata for the given account
 * @param {*} db
 * @param {*} accountID
 * @param {*} page
 * @param {*} limit
 * @param {*} offset
 * @returns {Object} - {outstandingTimesheetErrors, errorsMetadata}
 */
// removed: timesheet errors helpers (table deprecated)

/**
 *
 * @param {*} db
 * @param {*} accountID
 * @param {*} page
 * @param {*} limit
 * @param {*} offset
 * @returns
 */
// removed: invalid timesheets endpoint and helpers (table deprecated)
