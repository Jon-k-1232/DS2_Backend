const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const dayjs = require('dayjs');
const { FROM_EMAIL } = require('../../../config');

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

let cachedSESClient = null;

const getSESClient = () => {
   if (!cachedSESClient) {
      cachedSESClient = new SESClient({ region: AWS_REGION });
   }
   return cachedSESClient;
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
 * Send an email using AWS SES.
 * @param {Object} options
 * @param {string[]|string} options.recipientEmails - Primary recipients.
 * @param {string} options.subject - Email subject.
 * @param {string} [options.body] - Plain-text body.
 * @param {string} [options.html] - HTML body.
 * @param {string[]|string} [options.cc] - CC recipients.
 * @param {string[]|string} [options.bcc] - BCC recipients.
 * @param {Array} [options.attachments] - Note: Basic SES SendEmail doesn't support attachments. Use SendRawEmail for attachments.
 */
const sendEmail = async ({ recipientEmails, subject, body, html, cc, bcc, attachments } = {}) => {
   const to = normalizeAddresses(recipientEmails);

   if (!to.length) {
      throw new Error('sendEmail called without any recipient emails.');
   }

   if (!subject) {
      throw new Error('sendEmail called without a subject.');
   }

   if (!FROM_EMAIL) {
      throw new Error('Missing FROM_EMAIL configuration.');
   }

   const ccList = normalizeAddresses(cc);
   const bccList = normalizeAddresses(bcc);

   // Note: attachments require SendRawEmail API which is more complex
   if (attachments && attachments.length > 0) {
      console.warn('[SES] Attachments are not supported with basic SendEmail. Use SendRawEmail for attachments.');
   }

   const emailParams = {
      Source: FROM_EMAIL,
      Destination: {
         ToAddresses: to,
         CcAddresses: ccList.length ? ccList : undefined,
         BccAddresses: bccList.length ? bccList : undefined
      },
      Message: {
         Subject: {
            Data: subject,
            Charset: 'UTF-8'
         },
         Body: {}
      }
   };

   // Add text body if provided
   if (body) {
      emailParams.Message.Body.Text = {
         Data: body,
         Charset: 'UTF-8'
      };
   }

   // Add HTML body if provided
   if (html) {
      emailParams.Message.Body.Html = {
         Data: html,
         Charset: 'UTF-8'
      };
   }

   try {
      console.log(
         `[${new Date().toISOString()}] Attempting to send email via SES: region=${AWS_REGION}, subject="${subject}", to=${to.join(', ')}, cc=${ccList.length ? ccList.join(', ') : 'none'}, bcc=${
            bccList.length ? bccList.join(', ') : 'none'
         }`
      );

      const sesClient = getSESClient();
      const command = new SendEmailCommand(emailParams);
      const response = await sesClient.send(command);

      console.log(`[${new Date().toISOString()}] Email "${subject}" delivered to ${to.join(', ')} via SES (messageId=${response.MessageId}).`);
      return response;
   } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to send email "${subject}" to ${to.join(', ')}: ${error.message}`);
      throw error;
   }
};

module.exports = {
   sendEmail
};
