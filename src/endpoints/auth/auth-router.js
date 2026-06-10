const express = require('express');
const authService = require('./auth-service');
const { requireAuth } = require('./jwt-auth');
const { setAuthCookie, clearAuthCookie } = require('./auth-cookie');
const asyncHandler = require('../../utils/asyncHandler');
const authentication = express.Router();
const jsonParser = express.json();

const getClientIP = req => {
   const forwardedFor = req.headers['x-forwarded-for'];

   if (forwardedFor) {
      const ips = forwardedFor.split(',').map(ip => ip.trim());
      const internalIP = ips.find(ip => ip.startsWith('192.168.') || ip.startsWith('172.31.'));
      if (internalIP) return internalIP;
      if (ips.length > 0 && ips[0]) return ips[0];
   }

   return req.ip || 'unknown';
};

// Google OAuth login - accepts a Google ID token, verifies it, returns DS2 JWT + user info
authentication.post(
   '/google',
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const { credential } = req.body;
      const login_ip = getClientIP(req);

      if (!credential) {
         return res.status(400).json({
            error: 'Missing Google credential',
            status: 400
         });
      }

      let googlePayload;
      try {
         googlePayload = await authService.verifyGoogleIdToken(credential);
      } catch (err) {
         console.error('Google ID token verification failed:', err.message);
         return res.status(401).json({
            error: err.message || 'Invalid Google credential',
            status: 401
         });
      }

      const email = googlePayload.email;
      const user = await authService.getUserByEmail(db, email);

      if (!user) {
         console.log(`[${new Date().toISOString()}] Login attempt by non-provisioned user: ${email}`);
         return res.status(403).json({
            error: 'Your account is not provisioned in DS2. Contact your administrator.',
            status: 403
         });
      }

      const { user_id, account_id } = user;

      await authService.insertLoginLog(db, { user_id, account_id, login_ip });

      const authToken = authService.createJwt(email, { user_id });

      // Deliver the session token as an httpOnly cookie so client-side JS (and
      // therefore any XSS) cannot read it. The token is intentionally NOT echoed
      // back in the JSON body anymore.
      setAuthCookie(res, authToken);

      res.status(200).json({
         user,
         status: 200
      });
   })
);

// JWT renewal - requires a still-valid token, then issues a fresh one.
// Identity comes from requireAuth (verified JWT), never from the request body.
authentication.post(
   '/renew',
   requireAuth,
   asyncHandler(async (req, res) => {
      const authToken = authService.createJwt(req.user.email, { user_id: req.user.user_id });
      setAuthCookie(res, authToken);
      res.status(200).json({
         status: 200
      });
   })
);

// Logout - clear the session cookie.
authentication.post(
   '/logout',
   asyncHandler(async (req, res) => {
      clearAuthCookie(res);
      res.status(200).json({ status: 200 });
   })
);

module.exports = authentication;
