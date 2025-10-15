const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const config = require('../../../config');

const authService = {
   getUserByUserName(db, username) {
      return db('user_login').where('user_name', username).where('is_login_active', true);
   },

   findUserForPasswordReset(db, identifier) {
      if (!identifier) return null;
      return db('user_login')
         .join('users', 'user_login.user_id', '=', 'users.user_id')
         .select(
            'user_login.user_login_id',
            'user_login.user_name',
            'user_login.user_id',
            'user_login.account_id',
            'user_login.password_hash',
            'users.email',
            'users.display_name'
         )
         .where('user_login.user_name', identifier)
         .andWhere('user_login.is_login_active', true)
         .andWhere('users.is_user_active', true)
         .first();
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
   },

   async setTemporaryPassword(db, userLoginId, accountId, userId, tempPasswordHash) {
      return db.transaction(async trx => {
         await trx('user_login')
            .where('user_login_id', userLoginId)
            .update({
               password_hash: tempPasswordHash,
               updated_at: trx.fn.now()
            });

         await trx('user_login_log').where({ user_id: userId, login_ip: 'PASSWORD_RESET' }).del();

         await trx('user_login_log').insert({
            user_id: userId,
            account_id: accountId,
            login_ip: 'PASSWORD_RESET',
            created_at: trx.fn.now()
         });
      });
   },

   getActivePasswordReset(db, userId, minutes) {
      const cutoff = dayjs().subtract(minutes, 'minute').toDate();
      return db('user_login_log')
         .where({ user_id: userId, login_ip: 'PASSWORD_RESET' })
         .andWhere('created_at', '>=', cutoff)
         .orderBy('created_at', 'desc')
         .first();
   },

   async clearPasswordReset(db, userId) {
      return db('user_login_log').where({ user_id: userId, login_ip: 'PASSWORD_RESET' }).del();
   },

   async updateUserPassword(db, userLoginId, userId, newPasswordHash) {
      return db.transaction(async trx => {
         await trx('user_login')
            .where('user_login_id', userLoginId)
            .update({
               password_hash: newPasswordHash,
               updated_at: trx.fn.now()
            });

         await trx('user_login_log')
            .where({ user_id: userId, login_ip: 'PASSWORD_RESET' })
            .del();
      });
   }
};

module.exports = authService;
