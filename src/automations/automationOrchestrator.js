const schedule = require('node-schedule');
const timeTrackerReminders = require('./automationScripts/timeTrackerReminders');

// Start automations. List all scheduled automations here.
const scheduledAutomations = () => {
   // Thursday 9 AM AZ
   schedule.scheduleJob({ rule: '0 9 * * 4', tz: 'America/Phoenix' }, async () => {
      await timeTrackerReminders.sendThursdayReminderEmails();
   });
   // Friday 3:30 PM AZ
   schedule.scheduleJob({ rule: '0 30 15 * * 5', tz: 'America/Phoenix' }, async () => {
      await timeTrackerReminders.sendFridayReminderEmails();
   });
   // Daily 9 AM AZ
   schedule.scheduleJob({ rule: '0 9 * * *', tz: 'America/Phoenix' }, async () => {
      await timeTrackerReminders.sendMissingTrackerReminderEmails();
   });
};

module.exports = { scheduledAutomations };
