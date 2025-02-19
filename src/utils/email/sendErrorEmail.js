const { sendEmail } = require('./sendEmail');
const { SEND_TO_EMAILS, USER_VERSION_TIMESHEETS_ERROR_DIR } = require('../../../config');
const dayjs = require('dayjs');

// Import and extend dayjs with UTC and Timezone plugins
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Sends an error email with the timesheet file attached.
 *
 * @param {string} recipientEmail - The recipient's email address.
 * @param {string} timesheetName - The name of the timesheet file.
 * @param {Buffer} fileData - The file data to attach.
 * @param {string} errorMessage - The error messages in JSON string format (e.g. '["Some error message"]').
 */
const sendErrorEmail = async (recipientEmail, timesheetName, fileData, errorMessage) => {
   try {
      // Safely parse the JSON string into an array.
      let errorArray;
      try {
         errorArray = JSON.parse(errorMessage);
      } catch (parseError) {
         // If parse fails, treat the whole string as a single error message
         errorArray = [errorMessage];
      }

      // Create the HTML list of errors
      const errorList = errorArray.map(msg => `<li>${msg}.</li>`).join('');

      const fileLocation = `${USER_VERSION_TIMESHEETS_ERROR_DIR}/${timesheetName}`;
      const fallbackEmail = SEND_TO_EMAILS.split(',')[0];

      // Determine the recipient email list
      const emailToSend = recipientEmail ? [recipientEmail, fallbackEmail] : [fallbackEmail];

      // Format the "Attempted Process Time" in the requested style:
      // "January 01, 2024, At 7:01:00.000 pm az time"
      const attemptedProcessTime = dayjs().tz('America/Phoenix').format('MMMM DD, YYYY, [At] h:mm:ss.SSS a [AZ time]');

      // Construct the email subject and body
      const subject = `Timesheet Processing Error: ${timesheetName}`;
      const body = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Timesheet Processing Error</title>
</head>
<body style="font-family: sans-serif;">
  <p>Dear User,</p>

  <p>
    An error occurred while processing the timesheet 
    <strong>"${timesheetName}"</strong>.
  </p>

  <p>
    <strong>Error Details:</strong><br />
    <ol>
      ${errorList}
    </ol>
  </p>

  <p>
    <strong>Attempted Process Time:</strong><br />
    ${attemptedProcessTime}
  </p>

  <p>
    The original timesheet has been attached for your reference. Additionally, a copy of the spreadsheet has been saved to the following location:<br />
    ${fileLocation}
  </p>

  <p>
    <strong>Next Steps:</strong><br />
    1. Review the timesheet for the error(s) listed above and correct them.<br />
    2. Check for any additional issues that might cause further errors.
    <ul>
      <li>Please note that the system processes one error at a time. If another error is detected, you will receive a subsequent notification.</li>
    </ul>
    3. Once all corrections are made, place the updated file back into the <em>Pending</em> folder.<br />
    4. Notify the administrator after placing the file in the <em>Pending</em> folder to ensure prompt reprocessing.
  </p>

  <p>
    Thank you,<br />
    DS2 Automation Service
  </p>
</body>
</html>
    `;

      sendEmail({
         recipientEmails: emailToSend,
         subject,
         html: body,
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
