const schedule = require('node-schedule');
const runTimesheetAutomation = require('./automationScripts/timeTrackerAutomation/runTimesheetAutomation');

// Start automations. List all scheduled automations here.
const scheduledAutomations = () => {
   // Schedule the task to run at 10am, 12pm, 2pm, 4pm, 6pm, and 8pm everyday
   schedule.scheduleJob('0 10,12,14,16,18,20 * * *', async () => runTimeTrackerAutomation());
};

module.exports = { scheduledAutomations };

const runTimeTrackerAutomation = async () => {
   console.log(`[${new Date().toISOString()}] Starting scheduled timesheets automation...`);
   try {
      const { successfulAccounts, failedAccounts } = await runTimesheetAutomation();
      console.log(`[${new Date().toISOString()}] Scheduled timesheets automation completed.`);
      console.log(`- Successful Accounts: ${successfulAccounts}`);
      console.log(`- Failed Accounts: ${failedAccounts}`);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Unhandled error in scheduled automation: ${err.message}`);
   }
};
