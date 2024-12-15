const nodemailer = require('nodemailer');
const { FROM_EMAIL, FROM_EMAIL_PASSWORD, FROM_EMAIL_SMTP, SEND_TO_EMAILS } = require('../../../config');

// Configure the nodemailer transporter
const transporter = nodemailer.createTransport({
   host: FROM_EMAIL_SMTP,
   port: 465,
   secure: true,
   auth: {
      user: FROM_EMAIL,
      pass: FROM_EMAIL_PASSWORD
   }
});

/**
 * Sends an email using nodemailer
 * @param {Object} params - Email parameters
 * @param {Array<string>} params.recipientEmails - Array of email addresses
 * @param {string} params.subject - Email subject
 * @param {string} params.body - Email body
 * @param {Array<Object>} [params.attachments] - Email attachments
 */
const sendEmail = async ({ recipientEmails, subject, body, attachments = [] }) => {
   try {
      console.log(`[${new Date().toISOString()}] Sending email...`);
      const mailOptions = {
         from: FROM_EMAIL,
         to: recipientEmails?.join(', ') || SEND_TO_EMAILS.split(','),
         subject: subject || 'A Message From DS2',
         text: body,
         attachments
      };

      // Send the email
      const info = await transporter.sendMail(mailOptions);

      console.log(`[${new Date().toISOString()}] Successfully sent email.`);

      return info.messageId;
   } catch (error) {
      console.error('Error sending email:', error);
      throw error;
   }
};

module.exports = { sendEmail };
