const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const config = require('../../../config');

const googleOAuthClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

const authService = {
   async verifyGoogleIdToken(idToken) {
      const ticket = await googleOAuthClient.verifyIdToken({
         idToken,
         audience: config.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();

      const expectedDomain = (config.GOOGLE_WORKSPACE_DOMAIN || '').toLowerCase();
      const actualDomain = (payload.hd || '').toLowerCase();
      if (!expectedDomain || actualDomain !== expectedDomain) {
         throw new Error(`Access restricted to ${config.GOOGLE_WORKSPACE_DOMAIN} Workspace accounts`);
      }
      if (!payload.email_verified) {
         throw new Error('Email not verified by Google');
      }
      return payload;
   },

   getUserByEmail(db, email) {
      return db('users').where('email', email).andWhere('is_user_active', true).first();
   },

   getUserRoleByEmail(db, email) {
      return db('users').where('email', email).andWhere('is_user_active', true).select('access_level').first();
   },

   getUserInformation(db, accountID, userID) {
      return db('users').where('account_id', accountID).where('user_id', userID).where('is_user_active', true);
   },

   createJwt(subject, payload) {
      return jwt.sign(payload, config.JWT_SECRET, {
         subject,
         expiresIn: config.JWT_EXPIRATION,
         algorithm: 'HS256'
      });
   },

   verifyJwt(token) {
      return jwt.verify(token, config.JWT_SECRET, {
         algorithms: ['HS256']
      });
   },

   insertLoginLog(db, userLog) {
      return db('user_login_log').insert(userLog).returning('*');
   }
};

module.exports = authService;
