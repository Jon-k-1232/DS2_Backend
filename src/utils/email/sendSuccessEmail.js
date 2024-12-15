const { sendEmail } = require('./sendEmail');
const dayjs = require('dayjs');

/**
 * Sends a success email for a processed timesheet.
 *
 * @param {string} recipientEmail - The recipient's email address.
 * @param {string} timesheetName - The name of the timesheet file.
 */
const sendSuccessEmail = async (recipientEmail, timesheetName) => {
   try {
      const subject = `Timesheet Processed Successfully: ${timesheetName}`;
      const body = `
Dear User,

The timesheet "${timesheetName}" has been processed successfully.

**Process Completion Time:**  
      ${dayjs().format()}

No further action is required by you.

Thank you,  
DS2 Automation Service
`;

      // Send the email
      await sendEmail({
         recipientEmails: [recipientEmail],
         subject,
         body
      });

      console.log(`[${new Date().toISOString()}] Success email sent to "${recipientEmail}" for "${timesheetName}".`);
   } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to send success email for "${timesheetName}": ${error.message}`);
      throw error;
   }
};

module.exports = sendSuccessEmail;
