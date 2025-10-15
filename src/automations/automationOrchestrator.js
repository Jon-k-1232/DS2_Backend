const schedule = require('node-schedule');
const { sendThursdayReminderEmails, sendFridayReminderEmails, sendMissingTrackerReminderEmails } = require('./automationScripts/timeTrackerAutomation/timeTrackerReminders');

// Start automations. List all scheduled automations here.
const scheduledAutomations = () => {
   // Thursday 9 AM AZ
   schedule.scheduleJob({ rule: '0 9 * * 4', tz: 'America/Phoenix' }, async () => {
      await sendThursdayReminderEmails();
   });
   // Friday 3:30 PM AZ
   schedule.scheduleJob({ rule: '0 30 15 * * 5', tz: 'America/Phoenix' }, async () => {
      await sendFridayReminderEmails();
   });
   // Daily 9 AM AZ
   schedule.scheduleJob({ rule: '0 9 * * *', tz: 'America/Phoenix' }, async () => {
      await sendMissingTrackerReminderEmails();
   });
};

module.exports = { scheduledAutomations };
