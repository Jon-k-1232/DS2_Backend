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
  },

  // Used to refuse an operation that would leave the account with zero active
  // Super Admins. Pass excludeUserID to ask "how many WOULD remain if this
  // user's Super Admin status were removed" (i.e. count everyone else).
  countActiveSuperAdmins(db, accountID, excludeUserID = null) {
    let query = db('users')
      .where('account_id', accountID)
      .andWhere('is_user_active', true)
      .andWhereRaw('LOWER(access_level) = ?', ['super admin']);
    if (excludeUserID != null) {
      query = query.andWhereNot('user_id', excludeUserID);
    }
    return query.count({ count: '*' }).first();
  }
};

module.exports = accountUserService;
