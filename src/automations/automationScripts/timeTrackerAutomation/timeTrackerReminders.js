const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const db = require('../../../utils/db');
const accountService = require('../../../endpoints/account/account-service');
const automationSettingsService = require('../../../endpoints/account/automation-settings-service');
const accountUserService = require('../../../endpoints/user/user-service');
const { sendEmail } = require('../../../utils/email/sendEmail');
const { AUTOMATION_KEY_MAP } = require('../../automationDefinitions');

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Phoenix';

const getAccountDetails = async accountID => {
   const accountRows = await accountService.getAccount(db, accountID);
   const account = accountRows?.[0] || {};
   return {
      accountName: account.account_name || `Account ${accountID}`
   };
};

const fetchActiveUsersWithEmail = async accountID => {
   const users = await accountUserService.getActiveAccountUsers(db, accountID);
   return (users || []).filter(user => user?.email).map(user => ({
      userId: user.user_id,
      name: user.display_name || 'Team Member',
      email: user.email.trim()
   }));
};

const sendAccountWideReminder = async ({ accountID, subject, buildHtml }) => {
   try {
      const [{ accountName }, recipients] = await Promise.all([
         getAccountDetails(accountID),
         fetchActiveUsersWithEmail(accountID)
      ]);

      const recipientEmails = Array.from(new Set(recipients.map(user => user.email)));
      if (!recipientEmails.length) {
         console.log(`[${new Date().toISOString()}] Skipping account ${accountID} reminder "${subject}" - no recipient emails found.`);
         return;
      }

      const html = buildHtml({ accountName });

      await sendEmail({
         recipientEmails,
         subject,
         html
      });

      console.log(
         `[${new Date().toISOString()}] Sent "${subject}" reminder to account ${accountID} (${recipientEmails.length} recipients).`
      );
   } catch (error) {
      console.error(
         `[${new Date().toISOString()}] Failed to send "${subject}" reminder for account ${accountID}: ${error.message}`
      );
   }
};

const buildThursdayReminder = ({ accountName }) => {
   const tomorrow = dayjs().tz(TIMEZONE).add(1, 'day').format('dddd, MMMM D');
   return `
      <p>Hello ${accountName} Team,</p>
      <p>This is a friendly reminder that your weekly time tracker is due tomorrow (${tomorrow}).</p>
      <p>Please make sure your tracker is complete and ready to submit before the end of the day Friday.</p>
      <p>Thank you!<br/>DS2 Time Tracking</p>
   `;
};

const buildFridayReminder = ({ accountName }) => {
   const today = dayjs().tz(TIMEZONE).format('MMMM D');
   return `
      <p>Hello ${accountName} Team,</p>
      <p>This is a final reminder that your weekly time tracker is due today (${today}).</p>
      <p>Please submit your tracker as soon as possible so we can keep billing up-to-date.</p>
      <p>Thank you!<br/>DS2 Time Tracking</p>
   `;
};

const getPreviousWeekRange = () => {
   const now = dayjs().tz(TIMEZONE);
   const startOfCurrentWeek = now.startOf('week');
   const previousWeekStart = startOfCurrentWeek.subtract(1, 'week');
   const previousWeekEnd = previousWeekStart.endOf('week');

   return {
      start: previousWeekStart.format('YYYY-MM-DD'),
      end: previousWeekEnd.format('YYYY-MM-DD'),
      displayStart: previousWeekStart.format('MMMM D'),
      displayEnd: previousWeekEnd.format('MMMM D, YYYY')
   };
};

const sendMissingTrackerRemindersForAccount = async accountID => {
   try {
      const [accountInfo, activeUsers] = await Promise.all([
         getAccountDetails(accountID),
         fetchActiveUsersWithEmail(accountID)
      ]);

      if (!activeUsers.length) {
         console.log(`[${new Date().toISOString()}] No active users with emails for account ${accountID}; skipping missing tracker reminders.`);
         return;
      }

      const { start, end, displayStart, displayEnd } = getPreviousWeekRange();
      const missingUsers = [];

      for (const user of activeUsers) {
         try {
            const entryCountResult = await db('timesheet_entries')
               .where('account_id', accountID)
               .andWhere('user_id', user.userId)
               .andWhere('is_deleted', false)
               .andWhereBetween('time_tracker_end_date', [start, end])
               .count('* as count')
               .first();

            const entryCount = parseInt(entryCountResult?.count ?? '0', 10);
            if (entryCount === 0) {
               missingUsers.push(user);
            }
         } catch (userError) {
            console.error(
               `[${new Date().toISOString()}] Failed to evaluate tracker status for user ${user.userId} (account ${accountID}): ${userError.message}`
            );
         }
      }

      if (!missingUsers.length) {
         console.log(
            `[${new Date().toISOString()}] All users for account ${accountID} submitted trackers for ${displayStart} – ${displayEnd}.`
         );
         return;
      }

      const subjectsSent = new Set();

      await Promise.all(
         missingUsers.map(async user => {
            const subject = `Reminder: Submit last week's time tracker (${displayStart} – ${displayEnd})`;
            if (subjectsSent.has(`${user.email}-${subject}`)) return;

            const html = `
               <p>Hi ${user.name},</p>
               <p>We did not receive your time tracker for the week of <strong>${displayStart} – ${displayEnd}</strong>.</p>
               <p>Please submit your tracker as soon as possible so billing can stay on schedule.</p>
               <p>Thank you!<br/>${accountInfo.accountName} Time Tracking</p>
            `;

            try {
               await sendEmail({
                  recipientEmails: [user.email],
                  subject,
                  html
               });
               subjectsSent.add(`${user.email}-${subject}`);
               console.log(
                  `[${new Date().toISOString()}] Sent missing tracker reminder to ${user.email} for account ${accountID}.`
               );
            } catch (emailError) {
               console.error(
                  `[${new Date().toISOString()}] Failed to send missing tracker reminder to ${user.email} (account ${accountID}): ${emailError.message}`
               );
            }
         })
      );
   } catch (error) {
      console.error(
         `[${new Date().toISOString()}] Failed to evaluate missing trackers for account ${accountID}: ${error.message}`
      );
   }
};

const iterateAccountsForAutomation = async (automationKey, callback) => {
   try {
      const accountIDs = await automationSettingsService.getEnabledAccountIds(db, automationKey);

      if (!accountIDs.length) {
         console.log(`[${new Date().toISOString()}] No accounts enabled for automation "${automationKey}"; skipping.`);
         return;
      }

      for (const accountID of accountIDs) {
         await callback(accountID);
      }
   } catch (error) {
      console.error(
         `[${new Date().toISOString()}] Unable to resolve accounts for automation "${automationKey}": ${error.message}`
      );
   }
};

const sendThursdayReminderEmails = async () => {
   console.log(`[${new Date().toISOString()}] Starting Thursday time tracker reminder automation...`);
   await iterateAccountsForAutomation(AUTOMATION_KEY_MAP.THURSDAY_REMINDER, accountID =>
      sendAccountWideReminder({
         accountID,
         subject: 'Reminder: Weekly time tracker is due tomorrow',
         buildHtml: buildThursdayReminder
      })
   );
   console.log(`[${new Date().toISOString()}] Thursday time tracker reminder automation complete.`);
};

const sendFridayReminderEmails = async () => {
   console.log(`[${new Date().toISOString()}] Starting Friday afternoon time tracker reminder automation...`);
   await iterateAccountsForAutomation(AUTOMATION_KEY_MAP.FRIDAY_REMINDER, accountID =>
      sendAccountWideReminder({
         accountID,
         subject: 'Final reminder: Weekly time tracker is due today',
         buildHtml: buildFridayReminder
      })
   );
   console.log(`[${new Date().toISOString()}] Friday afternoon time tracker reminder automation complete.`);
};

const sendMissingTrackerReminderEmails = async () => {
   console.log(`[${new Date().toISOString()}] Starting daily missing time tracker reminder automation...`);
   await iterateAccountsForAutomation(AUTOMATION_KEY_MAP.MISSING_TRACKER, sendMissingTrackerRemindersForAccount);
   console.log(`[${new Date().toISOString()}] Daily missing time tracker reminder automation complete.`);
};

module.exports = {
   sendThursdayReminderEmails,
   sendFridayReminderEmails,
   sendMissingTrackerReminderEmails
};
