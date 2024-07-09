const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../../config');

const authService = {
   getUserByUserName(db, username) {
      return db('user_login').where('user_name', username).where('is_login_active', true);
   },

   getUserRoleByUserName(db, username) {
      return db('user_login')
         .join('users', 'user_login.user_id', '=', 'users.user_id')
         .where({
            'user_login.user_name': username,
            'user_login.is_login_active': true
         })
         .select('users.access_level');
   },

   getUserInformation(db, accountID, userID) {
      return db('users').where('account_id', accountID).where('user_id', userID).where('is_user_active', true);
   },

   comparePasswords(password, hash) {
      return bcrypt.compare(password, hash);
   },

   createJwt(subject, payload) {
      return jwt.sign(payload, config.API_TOKEN, {
         subject,
         expiresIn: config.JWT_EXPIRATION,
         algorithm: 'HS256'
      });
   },

   verifyJwt(token) {
      return jwt.verify(token, config.API_TOKEN, {
         algorithms: ['HS256']
      });
   },

   hashPassword(password) {
      return bcrypt.hash(password, 12);
   },

   insertLoginLog(db, userLog) {
      return db('user_login_log').insert(userLog).returning('*');
   }
};

module.exports = authService;
