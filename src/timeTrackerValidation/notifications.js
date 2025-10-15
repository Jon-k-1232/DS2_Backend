const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { sendEmail } = require('../utils/email/sendEmail');
const { DS2_SUPPORT_EMAILS } = require('../../config');

dayjs.extend(utc);
dayjs.extend(timezone);

const formatTimestamp = () => dayjs().tz('America/Phoenix').format('MMMM DD, YYYY [at] h:mm A z');

const parseEmailList = value =>
   (value || '')
      .split(',')
      .map(email => email.trim())
      .filter(Boolean);

const dedupeEmails = emails => Array.from(new Set((emails || []).filter(Boolean)));

const buildUserSummary = (userRecord, accountRecord) => {
   const userName = userRecord?.display_name || 'Unknown User';
   const userEmail = userRecord?.email || 'Not Available';
   const accountName = accountRecord?.account_name || `Account ${accountRecord?.account_id || ''}`.trim();
   return `<ul>
      <li><strong>User:</strong> ${userName}</li>
      <li><strong>Email:</strong> ${userEmail}</li>
      <li><strong>Account:</strong> ${accountName}</li>
   </ul>`;
};

const formatErrorList = errors =>
   `<ol>${(errors || []).map(error => `<li>${error}</li>`).join('')}</ol>`;

const sendValidationSuccessEmail = async ({ billingStaffEmails, userRecord, metadata, storedFileName, entryCount }) => {
   const recipients = dedupeEmails(billingStaffEmails);
   if (!recipients.length) return null;

   const subject = `Time Tracker Ready for Billing: ${userRecord?.display_name || 'Team Member'}`;
   const html = `
      <p>Hello Billing Team,</p>
      <p>The time tracker <strong>${storedFileName}</strong> for ${userRecord?.display_name || 'a user'} has been validated and a new timesheet record is now available.</p>
      <p>The related transactions have been added to the processing queue for your review${
         typeof entryCount === 'number' ? ` (${entryCount} entr${entryCount === 1 ? 'y' : 'ies'})` : ''
      }.</p>
      <p><strong>Tracker Details:</strong></p>
      <ul>
         <li><strong>Upload Time:</strong> ${formatTimestamp()}</li>
         <li><strong>Start Date:</strong> ${metadata?.startDate || 'Unknown'}</li>
         <li><strong>End Date:</strong> ${metadata?.endDate || 'Unknown'}</li>
      </ul>
      <p>You are receiving this message because you are listed as time tracker staff.</p>
      <p>Thank you.</p>
   `;

   return sendEmail({
      recipientEmails: recipients,
      subject,
      html
   });
};

const sendValidationFailureEmail = async ({
   adminEmails,
   userRecord,
   accountRecord,
   originalFileName,
   errors
}) => {
   const recipients = dedupeEmails(adminEmails);
   if (!recipients.length) return null;

   const subject = `Time Tracker Validation Failed: ${originalFileName || 'Unknown File'}`;
   const html = `
      <p>Admin Team,</p>
      <p>A time tracker failed validation during upload.</p>
      ${buildUserSummary(userRecord, accountRecord)}
      <p><strong>File:</strong> ${originalFileName || 'Unknown'}</p>
      <p><strong>Attempted At:</strong> ${formatTimestamp()}</p>
      <p><strong>Validation Errors:</strong></p>
      ${formatErrorList(errors)}
      <p>Please review and assist the user as needed.</p>
   `;

   return sendEmail({
      recipientEmails: recipients,
      subject,
      html
   });
};

const sendSystemErrorEmail = async ({
   adminEmails,
   userRecord,
   accountRecord,
   originalFileName,
   error
}) => {
   const recipients = dedupeEmails(adminEmails);
   if (!recipients.length) return null;

   const subject = `Time Tracker Upload Error: ${originalFileName || 'Unknown File'}`;
   const html = `
      <p>Admin Team,</p>
      <p>An unexpected system error occurred during a time tracker upload.</p>
      ${buildUserSummary(userRecord, accountRecord)}
      <p><strong>File:</strong> ${originalFileName || 'Unknown'}</p>
      <p><strong>Attempted At:</strong> ${formatTimestamp()}</p>
      <p><strong>Error Details:</strong></p>
      <pre>${(error && error.stack) || error?.message || String(error)}</pre>
      <p>Please investigate at your earliest convenience.</p>
   `;

   return sendEmail({
      recipientEmails: recipients,
      subject,
      html
   });
};

const getAdminRecipients = () => dedupeEmails(parseEmailList(DS2_SUPPORT_EMAILS));

module.exports = {
   sendValidationSuccessEmail,
   sendValidationFailureEmail,
   sendSystemErrorEmail,
   getAdminRecipients
};
