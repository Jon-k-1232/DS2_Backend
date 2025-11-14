const express = require('express');
const crypto = require('crypto');
const dayjs = require('dayjs');
const authService = require('./auth-service');
const asyncHandler = require('../../utils/asyncHandler');
const { requireAuth } = require('./jwt-auth');
const { sendEmail } = require('../../utils/email/sendEmail');
const authentication = express.Router();
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');

const TEMP_PASSWORD_EXPIRATION_MINUTES = 20;
const TEMP_PASSWORD_LENGTH = 12;

/**
 * Extract the real client IP address from the request.
 * Prioritizes internal IPs (192.168.x.x, 172.31.x.x) from x-forwarded-for header.
 * Falls back to req.ip if no suitable IP is found.
 */
const getClientIP = req => {
   const forwardedFor = req.headers['x-forwarded-for'];

   if (forwardedFor) {
      // x-forwarded-for can be a comma-separated list of IPs
      const ips = forwardedFor.split(',').map(ip => ip.trim());

      // Look for internal IPs first (192.168.x.x or 172.31.x.x)
      const internalIP = ips.find(ip => ip.startsWith('192.168.') || ip.startsWith('172.31.'));

      if (internalIP) {
         return internalIP;
      }

      // If no internal IP, return the first IP (client's real IP)
      if (ips.length > 0 && ips[0]) {
         return ips[0];
      }
   }

   // Fallback to req.ip
   return req.ip || 'unknown';
};

const generateTemporaryPassword = (length = TEMP_PASSWORD_LENGTH) => {
   const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$?';
   const bytes = crypto.randomBytes(length);
   let password = '';
   for (let i = 0; i < length; i += 1) {
      password += characters[bytes[i] % characters.length];
   }
   return password;
};

// JWT Creation Endpoint
authentication.post(
   '/login',
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { suppliedUsername, suppliedPassword } = req.body;
      const login_ip = getClientIP(req);

      // Sanitize input fields
      const sanitizedFields = sanitizeFields({ suppliedUsername, suppliedPassword });
      const sanitizedUserName = sanitizedFields.suppliedUsername;
      const sanitizedPassword = sanitizedFields.suppliedPassword;

      if (!sanitizedUserName || !sanitizedPassword) {
         return res.status(400).json({
            error: 'Missing username or password in request body',
            status: 400
         });
      }

      // Retrieve user from DB
      const [user] = await authService.getUserByUserName(db, sanitizedUserName);
      if (!user) {
         return res.status(401).json({
            error: 'Incorrect username',
            status: 401
         });
      }

      const { user_id, user_name, password_hash, account_id, user_login_id } = user;

      const passwordResetRecord = await authService.getActivePasswordReset(db, user_id, TEMP_PASSWORD_EXPIRATION_MINUTES);

      const isPasswordValid = await authService.comparePasswords(sanitizedPassword, password_hash);

      if (!isPasswordValid) {
         return res.status(401).json({
            error: 'Incorrect password',
            status: 401
         });
      }

      const requiresPasswordReset = Boolean(passwordResetRecord);

      // Retrieve user information
      const [getUserInformation] = await authService.getUserInformation(db, account_id, user_id);

      // Log user login
      const userLog = { user_id, account_id, login_ip };
      await authService.insertLoginLog(db, userLog);

      // Generate JWT token
      const sub = user_name;
      const payload = { user_id };
      const authToken = authService.createJwt(sub, payload);

      res.status(200).json({
         user: getUserInformation,
         authToken,
         status: 200,
         requiresPasswordReset
      });
   })
);

authentication.post(
   '/requestPasswordReset',
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const sanitizedFields = sanitizeFields(req.body || {});
      const identifier = sanitizedFields.identifier?.trim();

      if (!identifier) {
         return res.status(200).json({
            message: 'If an account exists for the provided information, a temporary password has been emailed.'
         });
      }

      const userRecord = await authService.findUserForPasswordReset(db, identifier);

      if (!userRecord) {
         console.log(`[${new Date().toISOString()}] Password reset requested for identifier "${identifier}" but no active user was found.`);
         return res.status(404).json({
            message: 'No active user account found with that username or email address.'
         });
      }

      console.log(`[${new Date().toISOString()}] Password reset requested for user_id=${userRecord.user_id}, user_name=${userRecord.user_name}, account_id=${userRecord.account_id}.`);

      if (userRecord) {
         let temporaryPasswordApplied = false;
         try {
            const temporaryPassword = generateTemporaryPassword();
            const hashedTemporaryPassword = await authService.hashPassword(temporaryPassword);
            const expiresAt = dayjs().add(TEMP_PASSWORD_EXPIRATION_MINUTES, 'minute').toDate();

            await authService.setTemporaryPassword(db, userRecord.user_login_id, userRecord.account_id, userRecord.user_id, hashedTemporaryPassword);
            temporaryPasswordApplied = true;

            const formattedExpiration = dayjs(expiresAt).format('MMMM D, YYYY h:mm A');
            const body = [
               `Hello ${userRecord.display_name || userRecord.user_name},`,
               '',
               'A temporary password has been generated for your DS2 account.',
               '',
               `Temporary password: ${temporaryPassword}`,
               `Expires: ${formattedExpiration} (local time)`,
               '',
               'Use this password to sign in within the next 20 minutes. You will be prompted to create a new password immediately after logging in.',
               '',
               'If you did not request this change, please contact support.'
            ].join('\n');

            await sendEmail({
               recipientEmails: [userRecord.email],
               subject: 'DS2 Temporary Password',
               body
            });
         } catch (error) {
            console.error('Error generating temporary password:', error);
            if (temporaryPasswordApplied) {
               await authService.clearPasswordReset(db, userRecord.user_id);
               await authService.updateUserPassword(db, userRecord.user_login_id, userRecord.user_id, userRecord.password_hash);
            }
            return res.status(500).json({ message: 'Unable to process password reset request.' });
         }
      }

      return res.status(200).json({
         message: 'If an account exists for the provided information, a temporary password has been emailed.'
      });
   })
);

authentication.post(
   '/updatePassword',
   requireAuth,
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const sanitizedFields = sanitizeFields(req.body || {});
      const newPassword = sanitizedFields.newPassword?.trim();

      if (!newPassword || newPassword.length < 8) {
         return res.status(400).json({
            message: 'Password must be at least 8 characters.',
            status: 400
         });
      }

      const [user] = await authService.getUserByUserName(db, req.user.user_name);
      if (!user) {
         return res.status(404).json({
            message: 'User not found.',
            status: 404
         });
      }

      const hashedPassword = await authService.hashPassword(newPassword);
      await authService.updateUserPassword(db, user.user_login_id, user.user_id, hashedPassword);

      return res.status(200).json({
         message: 'Password updated successfully.',
         status: 200
      });
   })
);

// JWT Renewal Endpoint
authentication.post(
   '/renew',
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { user_id, user_name } = req.body;

      // Check if the user is still active
      const [user] = await authService.getUserByUserName(db, user_name);
      if (!user || !user.is_login_active) {
         return res.status(401).json({
            error: 'Unauthorized request',
            status: 401
         });
      }

      // Generate new JWT token
      const sub = user_name;
      const payload = { user_id };
      const authToken = authService.createJwt(sub, payload);

      res.status(200).json({
         authToken,
         status: 200
      });
   })
);

module.exports = authentication;
