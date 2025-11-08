const schedule = require('node-schedule');
const timeTrackerReminders = require('./automationScripts/timeTrackerReminders');
const { AUTOMATION_KEY_MAP } = require('./automationDefinitions');
const automationSettingsService = require('../endpoints/account/automation-settings-service');
const db = require('../utils/db');
const { uploadWeeklyForAccount } = require('./automationScripts/aiTrainingUploader');

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

   // Weekly AI training upload, Sunday 4 AM AZ
   schedule.scheduleJob({ rule: '0 4 * * 0', tz: 'America/Phoenix' }, async () => {
      try {
         const accountIDs = await automationSettingsService.getEnabledAccountIds(db, AUTOMATION_KEY_MAP.AI_TRAINING_UPLOAD);
         if (!accountIDs.length) {
            console.log(`[${new Date().toISOString()}] No accounts enabled for AI training upload automation.`);
            return;
         }
         for (const accountId of accountIDs) {
            await uploadWeeklyForAccount(accountId);
         }
      } catch (err) {
         console.error(`[${new Date().toISOString()}] AI training upload scheduler failed: ${err.message}`);
      }
   });
};

module.exports = { scheduledAutomations };
