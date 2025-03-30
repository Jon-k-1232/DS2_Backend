const schedule = require('node-schedule');
const runTimesheetAutomation = require('./automationScripts/timeTrackerAutomation/runTimesheetAutomation');

// Start automations. List all scheduled automations here.
const scheduledAutomations = () => {
   // Schedule the task to run at 03:29 PM every day
   // schedule.scheduleJob('30 23 * * *', async () => {
   //    console.log(`[${new Date().toISOString()}] Starting scheduled timesheets automation...`);
   //    try {
   //       const { successfulAccounts, failedAccounts } = await runTimesheetAutomation();
   //       console.log(`[${new Date().toISOString()}] Scheduled timesheets automation completed.`);
   //       console.log(`- Successful Accounts: ${successfulAccounts}`);
   //       console.log(`- Failed Accounts: ${failedAccounts}`);
   //    } catch (err) {
   //       console.error(`[${new Date().toISOString()}] Unhandled error in scheduled automation: ${err.message}`);
   //    }
   // });
};

module.exports = { scheduledAutomations };
