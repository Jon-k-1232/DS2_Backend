// runTimesheetAutomation.js
const db = require('../../../utils/db'); // Import db
const accountService = require('../../../endpoints/account/account-service');
const processAccountTimesheets = require('./processAccountTimesheets');
const sendErrorNotificationForAutomation = require('../../../utils/email/failureMessages');
const { DS2_SUPPORT_EMAILS } = require('../../../../config');

/**
 * Runs the weekly timesheet processing automation for all accounts
 * @returns {object} - Results of the automation, including success status and account counts
 */
const runTimesheetAutomation = async () => {
   const automationName = 'Weekly Timesheet Processing';

   try {
      // Fetch account IDs from the database
      const accountIDs = await accountService.fetchAllAccountIDs(db);

      // Process accounts
      const results = await Promise.allSettled(accountIDs.map(accountID => processAccountTimesheets(accountID)));

      const successfulAccounts = results.filter(res => res.status).length;
      const failedAccounts = results.filter(res => !res.status).length;

      return { successfulAccounts, failedAccounts };
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Failed to run timesheet automation: ${err.message}`);

      // Notify DS2 support of catastrophic failures
      await sendErrorNotificationForAutomation(null, err.message, automationName, DS2_SUPPORT_EMAILS);

      return { successfulAccounts: 0, failedAccounts: 0 };
   }
};

module.exports = runTimesheetAutomation;
