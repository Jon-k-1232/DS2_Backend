const schedule = require('node-schedule');
const timeTrackerReminders = require('./automationScripts/timeTrackerReminders');
const { scheduledAutomationsEnabled } = require('../utils/environmentSwitches');

// Start automations. List all scheduled automations here.
// The legacy weekly AI-training upload (which sent sanitized examples to an
// OpenAI Vector Store) was removed in the Phase 1 cutover. The new pipeline
// closes the learning loop in-prompt via per-account few-shot examples
// pulled from ai_category_training_examples, so no scheduled upload is
// needed.
const scheduledAutomations = (getDb = () => null) => {
   // Guard direct callers as well as app startup. Off means no registered jobs.
   if (!scheduledAutomationsEnabled()) return;
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
      const db = getDb();
      if (db) await require('./automationScripts/recurringBilling').prepareRecurring(db);
   });
};

module.exports = { scheduledAutomations };
