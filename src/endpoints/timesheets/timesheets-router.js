const express = require('express');
const timesheetsRouter = express.Router();
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
const { updateRecentJobTotal } = require('../transactions/sharedTransactionFunctions');
const dayjs = require('dayjs');
const { kickOffAiSuggestionsForTimesheet, kickOffAiSuggestionsForEntryIds } = require('./aiTimesheetJobRunner');

// Get timesheet entries
timesheetsRouter.route('/getTimesheetEntries/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const { page, limit, offset } = getPaginationParams(req.query);

         const { outstandingTimesheetEntries, entriesMetadata } = await fetchTimesheetEntries(db, accountID, page, limit, offset);

         res.status(200).json({
            outstandingTimesheetEntries,
            pagination: entriesMetadata,
            message: 'Successfully retrieved timesheet entries.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving timesheet entries for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: `Error retrieving timesheet entries: ${err.message}` });
      }
   })
);

// Kick off AI suggestions for a given timesheet name or set of entry IDs (non-blocking)
timesheetsRouter.route('/ai/kickoff/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, userID } = req.params;
      const { timesheet_name, entry_ids } = req.body || {};

      if (!timesheet_name && (!Array.isArray(entry_ids) || !entry_ids.length)) {
         return res.status(400).json({ status: 400, message: 'Provide timesheet_name or entry_ids to kick off AI suggestions.' });
      }

      if (timesheet_name) {
         kickOffAiSuggestionsForTimesheet({ db, accountId: Number(accountID), userId: Number(userID), timesheetName: String(timesheet_name) });
      }

      if (Array.isArray(entry_ids) && entry_ids.length) {
         kickOffAiSuggestionsForEntryIds({ db, accountId: Number(accountID), userId: Number(userID), entryIds: entry_ids.map(Number) });
      }

      return res.status(202).json({ status: 202, message: 'AI suggestions job accepted and running in background.' });
   })
);

// Get Timesheet Entries By User ID
timesheetsRouter.route('/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, queryUserID } = req.params;

      try {
         const { page, limit, offset } = getPaginationParams(req.query);

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
         res.status(500).json({ message: `Error retrieving timesheet entries: ${err.message}` });
      }
   })
);

// getTimesheetEntriesByUserID
timesheetsRouter.route('/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, queryUserID } = req.params;
      const { page, limit, offset } = getPaginationParams(req.query);
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
         res.status(500).json({ message: `Error retrieving timesheet entries: ${err.message}` });
      }
   })
);

timesheetsRouter.route('/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, queryUserID } = req.params;
      const { page, limit, offset } = getPaginationParams(req.query);
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
         res.status(500).json({ message: `Error retrieving timesheet entries: ${err.message}` });
      }
   })
);

// Counts By Employee
timesheetsRouter.route('/countsByEmployee/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

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
         res.status(500).json({ message: `Error retrieving timesheet counts by employee: ${err.message}` });
      }
   })
);

// Move To Transactions;
timesheetsRouter.route('/moveToTransactions/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { entry } = req.body;

      try {
         const sanitizedEntry = sanitizeFields(entry);
         const timesheetEntryID = sanitizedEntry.timesheetEntryID;
         const newTransaction = restoreDataTypesTransactionsTableOnCreate(sanitizedEntry);
         const { customer_job_id, account_id, total_transaction } = newTransaction;

         // Update job total
         await updateRecentJobTotal(db, customer_job_id, account_id, total_transaction);

         // Reuse central addNewTransaction to ensure consistent side-effects (payments, AI training insert, etc.)
         // Merge provenance fields to enable AI training logging
         const mergedForCreate = {
            ...sanitizedEntry,
            accountID: account_id,
            customerID: newTransaction.customer_id,
            customerJobID: newTransaction.customer_job_id,
            selectedGeneralWorkDescriptionID: newTransaction.general_work_description_id,
            loggedForUserID: newTransaction.logged_for_user_id,
            totalTransaction: newTransaction.total_transaction,
            isTransactionBillable: newTransaction.is_transaction_billable,
            isInAdditionToMonthlyCharge: newTransaction.is_excess_to_subscription,
            minutes: sanitizedEntry?.minutes || null,
            timesheetEntryID: timesheetEntryID || sanitizedEntry?.timesheet_entry_id || null,
            aiSuggestion: sanitizedEntry?.aiSuggestion || sanitizedEntry?.ai_suggestion || null,
            entity: sanitizedEntry?.entity || null,
            category: sanitizedEntry?.category || null
         };

         await addNewTransaction(db, mergedForCreate);

         // Find timesheet entry and update the isProcessed column to indicate the entry has been processed
         await timesheetsService.updateTimesheetEntryStatus(db, timesheetEntryID);
         await timesheetSuggestionsService.updateSuggestion(db, timesheetEntryID, { status: 'applied' });

         res.status(200).json({
            status: 200,
            message: 'Successfully moved timesheet entry to transactions.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error moving timesheet entry to transactions: ${err.message}`);
         res.status(500).json({ message: `Error moving timesheet entry to transactions: ${err.message}` });
      }
   })
);

timesheetsRouter.route('/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID').delete(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { timesheetEntryID, accountID } = req.params;

      try {
         const foundEntry = await timesheetsService.getSingleTimesheetEntry(db, accountID, timesheetEntryID);
         foundEntry.is_deleted = true;
         await timesheetsService.updateTimesheetEntry(db, foundEntry);

         console.log(`[${new Date().toISOString()}] Successfully deleted timesheet entry ID ${timesheetEntryID} for account ${accountID}.`);

         res.status(200).json({
            message: 'Successfully deleted timesheet entry.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error deleting timesheet entry: ${err.message}`);
         res.status(500).json({ message: `Error deleting timesheet entry: ${err.message}` });
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
