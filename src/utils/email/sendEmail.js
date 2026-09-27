const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const { FROM_EMAIL } = require('../../../config');
const { realEmailEnabled } = require('../environmentSwitches');

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
 * Send through SES when enabled; otherwise log and optionally save a local
 * outbox message. Suppression is a normal result, never a delivery claim.
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

   const ccList = normalizeAddresses(cc);
   const bccList = normalizeAddresses(bcc);

   // Check on every call, even if a previous enabled send cached a client.
   // Do not construct SES, discover credentials, or require FROM_EMAIL here.
   if (!realEmailEnabled()) {
      const entry = {
         event: 'email_suppressed',
         id: randomUUID(),
         timestamp: new Date().toISOString(),
         from: FROM_EMAIL || null,
         subject,
         to,
         cc: ccList,
         bcc: bccList
      };
      console.log(JSON.stringify(entry));
      let outboxPath = null;
      if (process.env.EMAIL_OUTBOX_DIR) {
         try {
            const directory = path.resolve(process.env.EMAIL_OUTBOX_DIR);
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            const filename = path.join(directory, `${entry.id}.json`);
            await fs.writeFile(filename, JSON.stringify({
               ...entry,
               body: body || null,
               html: html || null,
               // Basic SES does not send attachments. Store metadata only,
               // never attachment bytes or paths to other private files.
               attachments: (attachments || []).map(attachment => ({
                  filename: attachment.filename || null,
                  contentType: attachment.contentType || null
               }))
            }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
            outboxPath = filename;
         } catch (error) {
            console.warn(JSON.stringify({
               event: 'email_outbox_failed', id: entry.id,
               timestamp: new Date().toISOString(), message: error.message
            }));
         }
      }
      return { suppressed: true, MessageId: null, suppressionId: entry.id, outboxPath };
   }

   if (!FROM_EMAIL) {
      throw new Error('Missing FROM_EMAIL configuration.');
   }

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
