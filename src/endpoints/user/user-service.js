const accountUserService = {
  getActiveAccountUsers(db, accountID) {
    return db.select().from('users').where('users.account_id', '=', accountID).andWhere('users.is_user_active', '=', true);
  },

  createUser(db, accountTableFields) {
    return db
      .insert(accountTableFields)
      .into('users')
      .returning('*')
      .then(rows => rows[0]);
  },

  updateUser(db, userFields, accountId) {
    return db.update(userFields).into('users').where('user_id', '=', userFields.user_id).andWhere('account_id', accountId);
  },

  deleteUser(db, userID, accountId) {
    return db.delete().from('users').where('user_id', '=', userID).andWhere('account_id', accountId);
  },

  fetchUser(db, accountID, userID) {
    return db.select().from('users').where('account_id', '=', accountID).andWhere('user_id', '=', userID).returning('*');
  }
};

module.exports = accountUserService;
