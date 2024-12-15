const { sendEmail } = require('./sendEmail');
const dayjs = require('dayjs');

/**
 * Send error notification for automation failures
 * @param {number} accountID - The account ID associated with the error (default is 1)
 * @param {string} errorMessage - The error message to include in the email
 * @param {string} automationName - The name of the automation
 * @param {string[] | string} recipientEmails - The list of recipient emails or a single email
 */
const sendErrorNotificationForAutomation = async (accountID = 1, errorMessage, automationName, recipientEmails = '') => {
   try {
      // Ensure recipientEmails is an array
      const emailRecipients = Array.isArray(recipientEmails) ? recipientEmails : recipientEmails ? [recipientEmails] : []; // Fallback to an empty array if no recipients are provided

      // Validate at least one recipient
      if (emailRecipients.length === 0) {
         throw new Error('No valid recipient emails provided.');
      }

      // Send the email
      await sendEmail({
         body: `A DS2 automation failure occurred on:\n\nAutomation Name: ${automationName}\n\nTime: ${dayjs().format()}\n\n${errorMessage}`,
         subject: `DS2 Automation Error`,
         recipientEmails: emailRecipients
      });

      console.log(`[${new Date().toISOString()}] Sent error notification for account ${accountID}.`);
   } catch (emailErr) {
      console.error(`[${new Date().toISOString()}] Failed to send error notification for account ${accountID}: ${emailErr.message}`);
   }
};

module.exports = sendErrorNotificationForAutomation;
