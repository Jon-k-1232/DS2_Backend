const schedule = require('node-schedule');
const timeTrackerReminders = require('../src/automations/automationScripts/timeTrackerReminders');
const { scheduledAutomations } = require('../src/automations/automationOrchestrator');

describe('Automation orchestrator', () => {
   let originalScheduleJob;
   let originalThursday;
   let originalFriday;
   let originalMissing;
   let scheduledCalls;
   let invocationCounts;

   beforeEach(() => {
      scheduledCalls = [];
      invocationCounts = {
         thursday: 0,
         friday: 0,
         missing: 0
      };

      originalScheduleJob = schedule.scheduleJob;
      originalThursday = timeTrackerReminders.sendThursdayReminderEmails;
      originalFriday = timeTrackerReminders.sendFridayReminderEmails;
      originalMissing = timeTrackerReminders.sendMissingTrackerReminderEmails;

      schedule.scheduleJob = (rule, callback) => {
         scheduledCalls.push({ rule, callback });
         return { cancel: () => {} };
      };

      timeTrackerReminders.sendThursdayReminderEmails = async () => {
         invocationCounts.thursday += 1;
      };
      timeTrackerReminders.sendFridayReminderEmails = async () => {
         invocationCounts.friday += 1;
      };
      timeTrackerReminders.sendMissingTrackerReminderEmails = async () => {
         invocationCounts.missing += 1;
      };
   });

   afterEach(() => {
      schedule.scheduleJob = originalScheduleJob;
      timeTrackerReminders.sendThursdayReminderEmails = originalThursday;
      timeTrackerReminders.sendFridayReminderEmails = originalFriday;
      timeTrackerReminders.sendMissingTrackerReminderEmails = originalMissing;
   });

   it('schedules the three time-tracker automations with the expected cron rules', async () => {
      scheduledAutomations();

      expect(scheduledCalls).to.have.length(4);

      const [thursdayJob, fridayJob, missingJob, aiTrainingJob] = scheduledCalls;

      expect(thursdayJob.rule).to.deep.equal({ rule: '0 9 * * 4', tz: 'America/Phoenix' });
      expect(fridayJob.rule).to.deep.equal({ rule: '0 30 15 * * 5', tz: 'America/Phoenix' });
      expect(missingJob.rule).to.deep.equal({ rule: '0 9 * * *', tz: 'America/Phoenix' });
      expect(aiTrainingJob.rule).to.deep.equal({ rule: '0 4 * * 0', tz: 'America/Phoenix' });

      await thursdayJob.callback();
      await fridayJob.callback();
      await missingJob.callback();

      expect(invocationCounts).to.deep.equal({
         thursday: 1,
         friday: 1,
         missing: 1
      });
   });
});
