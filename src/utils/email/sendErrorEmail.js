const { sendEmail } = require('./sendEmail');
const { SEND_TO_EMAILS, USER_VERSION_TIMESHEETS_ERROR_DIR } = require('../../../config');
const dayjs = require('dayjs');

/**
 * Sends an error email with the timesheet file attached.
 *
 * @param {string} recipientEmail - The recipient's email address.
 * @param {string} timesheetName - The name of the timesheet file.
 * @param {Buffer} fileData - The file data to attach.
 * @param {string} errorMessage - The error message to include in the email.
 */
const sendErrorEmail = async (recipientEmail, timesheetName, fileData, errorMessage) => {
   try {
      const fileLocation = `${USER_VERSION_TIMESHEETS_ERROR_DIR}/${timesheetName}`;
      const fallbackEmail = SEND_TO_EMAILS.split(',')[0];

      // Determine the recipient email list
      const emailToSend = recipientEmail ? [recipientEmail, fallbackEmail] : [fallbackEmail];

      // Construct the email subject and body
      const subject = `Timesheet Processing Error: ${timesheetName}`;
      const body = `
Dear User,

An error occurred while processing the timesheet "${timesheetName}".

**Error Details:**  
      ${errorMessage}

**Attempted Process Time:**  
      ${dayjs().format()}

The original timesheet has been attached for your reference. Additionally, a copy of the spreadsheet has been saved to the following location:  
      ${fileLocation}

**Next Steps:**  
      1. Review the timesheet for the error listed above and correct it.  
      2. Check for any additional issues that might cause further errors.  
           - Please note that the system processes one error at a time. If another error is detected, you will receive a subsequent notification.  
      3. Once all corrections are made, place the updated file back into the **Pending** folder.  
      4. Notify the administrator after placing the file in the **Pending** folder to ensure prompt reprocessing.  

Thank you,  
DS2 Automation Service
`;

      // Send the email
      await sendEmail({
         recipientEmails: emailToSend,
         subject,
         body,
         attachments: [
            {
               filename: timesheetName,
               content: fileData
            }
         ]
      });

      console.log(`[${new Date().toISOString()}] Error email sent to "${emailToSend.join(', ')}" for "${timesheetName}".`);
   } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to send error email for "${timesheetName}": ${error.message}`);
      throw error;
   }
};

module.exports = sendErrorEmail;
