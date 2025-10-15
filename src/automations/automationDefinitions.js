const AUTOMATION_KEY_MAP = {
   THURSDAY_REMINDER: 'thursday_reminder_emails',
   FRIDAY_REMINDER: 'friday_reminder_emails',
   MISSING_TRACKER: 'missing_tracker_reminders'
};

const AUTOMATION_DEFINITIONS = [
   {
      key: AUTOMATION_KEY_MAP.THURSDAY_REMINDER,
      label: 'Thursday reminder emails',
      description: 'Sends a weekly reminder on Thursday mornings to complete timesheets before Friday.'
   },
   {
      key: AUTOMATION_KEY_MAP.FRIDAY_REMINDER,
      label: 'Friday reminder emails',
      description: 'Delivers the final reminder on Friday afternoon to turn in weekly time trackers.'
   },
   {
      key: AUTOMATION_KEY_MAP.MISSING_TRACKER,
      label: 'Missing tracker reminders',
      description: 'Emails individual users who have not submitted a time tracker for the previous week.'
   }
];

const AUTOMATION_KEYS = Object.values(AUTOMATION_KEY_MAP);

const isValidAutomationKey = key => AUTOMATION_KEYS.includes(key);

module.exports = {
   AUTOMATION_DEFINITIONS,
   AUTOMATION_KEY_MAP,
   AUTOMATION_KEYS,
   isValidAutomationKey
};
