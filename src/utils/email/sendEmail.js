// sendEmail.js
const nodemailer = require('nodemailer');
const { FROM_EMAIL, FROM_EMAIL_PASSWORD, FROM_EMAIL_SMTP, SEND_TO_EMAILS, FROM_EMAIL_USERNAME } = require('../../../config');

// Configure the nodemailer transporter
const transporter = nodemailer.createTransport({
   host: FROM_EMAIL_SMTP,
   port: 465,
   secure: true,
   auth: {
      user: FROM_EMAIL_USERNAME,
      pass: FROM_EMAIL_PASSWORD
   }
});
/**
 * Sends an email using nodemailer
 * @param {Object} params - Email parameters
 * @param {Array<string>} params.recipientEmails - Array of email addresses
 * @param {string} params.subject - Email subject
 * @param {string} [params.body] - Plain text body
 * @param {string} [params.html] - HTML body
 * @param {Array<Object>} [params.attachments] - Email attachments
 * @returns {string} info.messageId - The message ID from the nodemailer response
 */
const sendEmail = async ({ recipientEmails, subject, body, html, attachments = [] }) => {
   try {
      const resolvedRecipients = (Array.isArray(recipientEmails) && recipientEmails.length
         ? recipientEmails
         : SEND_TO_EMAILS.split(',')
      )
         .map(address => address.trim())
         .filter(Boolean);

      console.log(`[${new Date().toISOString()}] Sending email to: ${resolvedRecipients.join(', ')}...`);

      // Build mailOptions:
      // - 'text' will be the plain-text email body if provided.
      // - 'html' will be the HTML email body if provided.
      // Nodemailer automatically sends multipart/alternative if both are present.
      const mailOptions = {
         from: FROM_EMAIL,
         to: resolvedRecipients.join(', '),
         subject: subject || 'A Message From DS2',
         text: body, // Plain-text fallback
         html, // HTML body if available
         attachments
      };

      // Send the email
      const info = await transporter.sendMail(mailOptions);

      console.log(`[${new Date().toISOString()}] Successfully sent email to: ${resolvedRecipients.join(', ')}`);
      return info.messageId;
   } catch (error) {
      console.error('Error sending email:', error);
      throw error;
   }
};

module.exports = { sendEmail };
