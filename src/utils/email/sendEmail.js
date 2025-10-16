const nodemailer = require('nodemailer');
const dayjs = require('dayjs');
const { FROM_EMAIL, FROM_EMAIL_USERNAME, FROM_EMAIL_PASSWORD, FROM_EMAIL_SMTP, SEND_TO_EMAILS } = require('../../../config');

const deriveBoolean = value => {
   if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n'].includes(normalized)) return false;
   }
   return undefined;
};

const SMTP_PORT = Number.parseInt(process.env.FROM_EMAIL_SMTP_PORT || '', 10) || 465;
const explicitSecureFlag = deriveBoolean(process.env.FROM_EMAIL_SMTP_SECURE);
const SMTP_SECURE = typeof explicitSecureFlag === 'boolean' ? explicitSecureFlag : SMTP_PORT === 465;
const rejectUnauthorizedFlag = deriveBoolean(process.env.FROM_EMAIL_REJECT_UNAUTHORIZED);
const REJECT_UNAUTHORIZED = typeof rejectUnauthorizedFlag === 'boolean' ? rejectUnauthorizedFlag : true;

let cachedTransporter = null;

const resolveTransporter = () => {
   if (cachedTransporter) {
      return cachedTransporter;
   }

   if (!FROM_EMAIL_SMTP) {
      throw new Error('Missing SMTP host (FROM_EMAIL_SMTP). Unable to send email.');
   }

   const auth =
      FROM_EMAIL_USERNAME && FROM_EMAIL_PASSWORD
         ? {
              user: FROM_EMAIL_USERNAME,
              pass: FROM_EMAIL_PASSWORD
           }
         : undefined;

   cachedTransporter = nodemailer.createTransport({
      host: FROM_EMAIL_SMTP,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth,
      tls: {
         rejectUnauthorized: REJECT_UNAUTHORIZED
      }
   });

   return cachedTransporter;
};

const normalizeAddresses = value => {
   if (!value) return [];
   if (Array.isArray(value)) {
      return value
         .filter(Boolean)
         .map(entry => entry.toString().trim())
         .filter(Boolean);
   }
   if (typeof value === 'string') {
      return value
         .split(',')
         .map(part => part.trim())
         .filter(Boolean);
   }
   return [];
};

/**
 * Send an email using the configured SMTP credentials.
 * @param {Object} options
 * @param {string[]|string} options.recipientEmails - Primary recipients.
 * @param {string} options.subject - Email subject.
 * @param {string} [options.body] - Plain-text body.
 * @param {string} [options.html] - HTML body.
 * @param {string[]|string} [options.cc] - CC recipients.
 * @param {string[]|string} [options.bcc] - BCC recipients.
 * @param {Array} [options.attachments] - Nodemailer attachments array.
 */
const sendEmail = async ({ recipientEmails, subject, body, html, cc, bcc, attachments } = {}) => {
   const to = normalizeAddresses(recipientEmails);
   const fallbackRecipients = normalizeAddresses(SEND_TO_EMAILS);

   if (!to.length && fallbackRecipients.length) {
      to.push(...fallbackRecipients);
   }

   if (!to.length) {
      throw new Error('sendEmail called without any recipient emails.');
   }

   if (!subject) {
      throw new Error('sendEmail called without a subject.');
   }

   const transporter = resolveTransporter();

   const fromAddress = FROM_EMAIL || FROM_EMAIL_USERNAME;
   if (!fromAddress) {
      throw new Error('Missing FROM_EMAIL or FROM_EMAIL_USERNAME configuration.');
   }

   const ccList = normalizeAddresses(cc);
   const bccList = normalizeAddresses(bcc);

   const mailOptions = {
      from: fromAddress,
      to,
      subject,
      text: body || undefined,
      html: html || undefined,
      cc: ccList.length ? ccList : undefined,
      bcc: bccList.length ? bccList : undefined,
      attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
      headers: {
         'X-DS2-Sent-At': dayjs().toISOString()
      }
   };

   try {
      console.log(
         `[${new Date().toISOString()}] Attempting to send email: smtp=${FROM_EMAIL_SMTP}:${SMTP_PORT} (secure=${SMTP_SECURE}), subject="${subject}", to=${to.join(', ')}, cc=${
            ccList.length ? ccList.join(', ') : 'none'
         }, bcc=${bccList.length ? bccList.join(', ') : 'none'}`
      );
      const info = await transporter.sendMail(mailOptions);
      console.log(`[${new Date().toISOString()}] Email "${subject}" delivered to ${to.join(', ')} (messageId=${info.messageId}).`);
      return info;
   } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to send email "${subject}" to ${to.join(', ')}: ${error.message}`);
      throw error;
   }
};

module.exports = {
   sendEmail
};
