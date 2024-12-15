const express = require('express');
const authService = require('./auth-service');
const asyncHandler = require('../../utils/asyncHandler');
const authentication = express.Router();
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');

// JWT Creation Endpoint
authentication.post(
   '/login',
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { suppliedUsername, suppliedPassword } = req.body;
      const login_ip = req.ip;

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

      const { user_id, user_name, password_hash, account_id } = user;

      // Verify password
      const isPasswordValid = await authService.comparePasswords(sanitizedPassword, password_hash);
      if (!isPasswordValid) {
         return res.status(401).json({
            error: 'Incorrect password',
            status: 401
         });
      }

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
