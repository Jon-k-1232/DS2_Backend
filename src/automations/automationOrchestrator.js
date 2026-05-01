const schedule = require('node-schedule');
const timeTrackerReminders = require('./automationScripts/timeTrackerReminders');

// Start automations. List all scheduled automations here.
// The legacy weekly AI-training upload (which sent sanitized examples to an
// OpenAI Vector Store) was removed in the Phase 1 cutover. The new pipeline
// closes the learning loop in-prompt via per-account few-shot examples
// pulled from ai_category_training_examples, so no scheduled upload is
// needed.
const scheduledAutomations = () => {
   // Thursday 9 AM AZ
   schedule.scheduleJob({ rule: '0 9 * * 4', tz: 'America/Phoenix' }, async () => {
      await timeTrackerReminders.sendThursdayReminderEmails();
   });
   // Friday 3:30 PM AZ
   schedule.scheduleJob({ rule: '0 30 15 * * 5', tz: 'America/Phoenix' }, async () => {
      await timeTrackerReminders.sendFridayReminderEmails();
   });
   // Daily 9 AM AZ
   schedule.scheduleJob({ rule: '0 9 * * *', tz: 'America/Phoenix' }, async () => {
      await timeTrackerReminders.sendMissingTrackerReminderEmails();
   });
};

module.exports = { scheduledAutomations };
