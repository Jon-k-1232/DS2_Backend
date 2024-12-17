const express = require('express');
const timesheetsRouter = express.Router();
const asyncHandler = require('../../utils/asyncHandler');
const processTimesheetBatch = require('./timesheetProcessingLogic/processTimesheetBatch');
const { saveValidTimesheets, saveValidTimesheetErrors, saveInvalidTimesheetErrors, markTimesheetErrorsResolved } = require('./timesheetFunctions');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const timesheetsService = require('./timesheets-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');
const { DS2_SUPPORT_EMAILS } = require('../../../config');
const accountUserService = require('../user/user-service');
const { createGrid } = require('../../utils/gridFunctions');
const sendErrorNotificationForAutomation = require('../../utils/email/failureMessages');

// Manually run timesheet processing job
timesheetsRouter.route('/runManualJob/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      const trx = await db.transaction();

      try {
         // Process all files
         const { validSuccessEntries, invalidSuccessEntries, validErrorEntries, invalidErrorEntries, error } = await processTimesheetBatch(Number(accountID));

         // Notify DS2 Support of the error
         if (error) {
            const processName = 'Manual Timesheet Processing';
            await sendErrorNotificationForAutomation(accountID, error, processName, DS2_SUPPORT_EMAILS);
            throw new Error(error);
         }

         const joinedInvalidTimesheets = invalidSuccessEntries.concat(invalidErrorEntries);
         const invalidTimesheets = joinedInvalidTimesheets.map(timesheet => ({
            account_id: accountID,
            timesheet_name: timesheet.timesheet_name,
            error_message: timesheet.error_message
         }));

         // Insert valid results into the database
         await Promise.all([
            saveValidTimesheets(trx, validSuccessEntries),
            saveValidTimesheetErrors(trx, validErrorEntries),
            saveInvalidTimesheetErrors(trx, invalidTimesheets),
            markTimesheetErrorsResolved(trx, accountID, validSuccessEntries, invalidTimesheets)
         ]);

         await trx.commit();

         const finalMessage = `Processed: ${validSuccessEntries.length} successfully, ${validErrorEntries.length} with errors requiring user fixes, and ${
            invalidSuccessEntries.length + invalidErrorEntries.length
         } with errors that could not be processed.`;

         // Respond with full file information instead of counts
         res.status(200).json({
            message: finalMessage,
            validSuccessEntries,
            invalidSuccessEntries,
            validErrorEntries,
            invalidErrorEntries
         });
      } catch (err) {
         await trx.rollback();
         console.error(`[${new Date().toISOString()}] Error processing timesheets: ${err.message}`);
         res.status(500).json({ message: `Error processing timesheets: ${err.message}` });
      }
   })
);

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

timesheetsRouter.route('/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, queryUserID } = req.params;

      try {
         const { page, limit, offset } = getPaginationParams(req.query);

         const { outstandingTimesheetEntries, entriesMetadata } = await fetchTimesheetEntriesByUserID(db, accountID, queryUserID, page, limit, offset);

         // put into grid format
         const timesheetsByEmployeesData = {
            outstandingTimesheetEntries,
            grid: createGrid(outstandingTimesheetEntries)
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

timesheetsRouter.route('/getTimesheetErrors/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const { page, limit, offset } = getPaginationParams(req.query);

         const { outstandingTimesheetErrors, errorsMetadata } = await fetchTimesheetErrors(db, accountID, page, limit, offset);

         res.status(200).json({
            outstandingTimesheetErrors,
            pagination: errorsMetadata,
            message: 'Successfully retrieved timesheet errors.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving timesheet errors for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: `Error retrieving timesheet errors: ${err.message}` });
      }
   })
);

// get invalid timesheets
timesheetsRouter.route('/getInvalidTimesheets/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;

      try {
         const { page, limit, offset } = getPaginationParams(req.query);

         const { invalidTimesheets, errorsMetadata } = await fetchInvalidTimesheets(db, accountID, page, limit, offset);

         res.status(200).json({
            invalidTimesheets,
            pagination: errorsMetadata,
            message: 'Successfully retrieved invalid timesheets.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error retrieving invalid timesheets for account ${accountID}: ${err.message}`);
         res.status(500).json({ message: `Error retrieving invalid timesheets: ${err.message}` });
      }
   })
);

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

timesheetsRouter.route('/moveToTransactions/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { accountID } = req.params;
      const { entry } = req.body;

      try {
         const sanitizedEntry = sanitizeFields(entry);
         const transactionTableFields = restoreDataTypesTransactionsTableOnCreate(sanitizedEntry);
         const timesheetEntry = restoreTimesheetEntryTypesOnUpdate(sanitizedEntry);
         timesheetEntry.isProcessed = true;

         await timesheetsService.updateTimesheetEntry(db, accountID, timesheetEntry);
         await addNewTransaction(db, transactionTableFields, sanitizedEntry);

         console.log(`[${new Date().toISOString()}] Successfully moved timesheet entry to transactions for account ${accountID}.`);

         res.status(200).json({
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

timesheetsRouter.route('/deleteTimesheetError/:timesheetErrorID/:accountID/:userID').delete(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { timesheetErrorID, accountID } = req.params;

      try {
         const foundError = await timesheetsService.getSingleTimesheetError(db, accountID, timesheetErrorID);
         foundError.is_resolved = true;
         await timesheetsService.updateTimesheetError(db, foundError);

         console.log(`[${new Date().toISOString()}] Successfully deleted timesheet error ID ${timesheetErrorID} for account ${accountID}.`);

         res.status(200).json({
            message: 'Successfully deleted timesheet error.'
         });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Error deleting timesheet error: ${err.message}`);
         res.status(500).json({ message: `Error deleting timesheet error: ${err.message}` });
      }
   })
);

module.exports = timesheetsRouter;

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

   const entriesMetadata = getPaginationMetadata(totalEntries, page, limit);

   return { outstandingTimesheetEntries, entriesMetadata };
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

   return Promise.all(
      employees.map(async employee => {
         const { display_name, user_id } = employee;
         try {
            const [timesheetCount, timesheetErrorCount] = await Promise.all([
               timesheetsService.getTimesheetEntryCountsByEmployee(db, accountID, user_id),
               timesheetsService.getTimesheetErrorCountsByEmployee(db, accountID, user_id)
            ]);

            return {
               display_name,
               user_id,
               timesheet_count: timesheetCount,
               error_count: timesheetErrorCount
            };
         } catch (err) {
            console.error(`Error for User ID ${user_id}:`, err);
            return {
               display_name,
               user_id,
               timesheet_count: 0,
               error_count: 0
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

   const entriesMetadata = getPaginationMetadata(totalEntries, page, limit);

   return { outstandingTimesheetEntries, entriesMetadata };
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
const fetchTimesheetErrors = async (db, accountID, page, limit, offset) => {
   const [outstandingTimesheetErrors, totalErrors] = await Promise.all([
      timesheetsService.getOutstandingTimesheetErrors(db, accountID, limit, offset),
      timesheetsService.getOutstandingTimesheetErrorsCount(db, accountID)
   ]);

   const errorsMetadata = getPaginationMetadata(totalErrors, page, limit);

   return { outstandingTimesheetErrors, errorsMetadata };
};

/**
 *
 * @param {*} db
 * @param {*} accountID
 * @param {*} page
 * @param {*} limit
 * @param {*} offset
 * @returns
 */
const fetchInvalidTimesheets = async (db, accountID, page, limit, offset) => {
   const [invalidTimesheets, totalInvalidTimesheets] = await Promise.all([
      timesheetsService.getInvalidTimesheets(db, accountID, limit, offset),
      timesheetsService.getInvalidTimesheetsCount(db, accountID)
   ]);

   const errorsMetadata = getPaginationMetadata(totalInvalidTimesheets, page, limit);

   return { invalidTimesheets, errorsMetadata };
};
