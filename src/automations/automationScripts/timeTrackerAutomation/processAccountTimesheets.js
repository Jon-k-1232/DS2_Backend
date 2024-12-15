// processAccountTimesheets.js
const sendErrorNotificationForAutomation = require('../../../utils/email/failureMessages');
const processTimesheetBatch = require('../../../endpoints/timesheets/timesheetProcessingLogic/processTimesheetBatch');
const { saveValidTimesheets, saveValidTimesheetErrors, markTimesheetErrorsResolved, saveInvalidTimesheetErrors } = require('../../../endpoints/timesheets/timesheetFunctions');
const { DS2_SUPPORT_EMAILS } = require('../../../../config');
const db = require('../../../utils/db');

/**
 * Processes timesheets for a single account
 * @param {number} accountID - The account ID to process timesheets for
 * @param {object} db - Database connection object
 * @returns {object} - Results of the processing, including success status and entry counts
 */
const processAccountTimesheets = async accountID => {
   const trx = await db.transaction();
   const automationName = 'Weekly Timesheet Processing';

   try {
      console.log(`[${new Date().toISOString()}] Starting timesheet processing for account ${accountID}...`);

      const { validSuccessEntries, invalidSuccessEntries, validErrorEntries, invalidErrorEntries, error } = await processTimesheetBatch(accountID);

      if (error) {
         console.error(`[${new Date().toISOString()}] Errors occurred while processing account ${accountID}: ${error}`);

         // Rollback and send email notification for the account-level failure
         await trx.rollback();

         // Notify DS2 support of failures
         await sendErrorNotificationForAutomation(accountID, error, automationName, DS2_SUPPORT_EMAILS);

         return { accountID, success: false, validErrorEntries, invalidErrorEntries };
      }

      const joinedInvalidTimesheets = invalidSuccessEntries.concat(invalidErrorEntries);
      const invalidTimesheets = joinedInvalidTimesheets.map(timesheet => ({
         account_id: accountID,
         timesheet_name: timesheet.timesheet_name,
         error_message: timesheet.error_message
      }));

      // Save results to the database
      await Promise.all([
         saveValidTimesheets(trx, validSuccessEntries),
         saveValidTimesheetErrors(trx, validErrorEntries),
         saveInvalidTimesheetErrors(trx, invalidTimesheets),
         markTimesheetErrorsResolved(trx, accountID, validSuccessEntries, invalidTimesheets)
      ]);

      await trx.commit();
      console.log(`[${new Date().toISOString()}] Database operations successful for account ${accountID}.`);

      return {
         accountID,
         success: true,
         timesheetsProcessedSuccessfully: validSuccessEntries.length,
         timesheetsWithErrors: validErrorEntries.length,
         invalidSuccessEntries: invalidSuccessEntries.length,
         invalidErrorEntries: invalidErrorEntries.length
      };
   } catch (err) {
      await trx.rollback();
      console.error(`[${new Date().toISOString()}] Error processing account ${accountID}: ${err.message}`);

      // Send email notification for the account-level failure to DS2 support
      await sendErrorNotificationForAutomation(accountID, err.message, automationName, DS2_SUPPORT_EMAILS);

      return {
         accountID,
         success: false,
         timesheetsProcessedSuccessfully: 0,
         timesheetsWithErrors: 0,
         invalidSuccessEntries: 0,
         invalidErrorEntries: 0
      };
   }
};

module.exports = processAccountTimesheets;
