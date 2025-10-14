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

  createAccountLogin(db, accountLoginTableFields) {
    return db
      .insert(accountLoginTableFields)
      .into('user_login')
      .returning('*')
      .then(rows => {
        // Remove the password_hash property from the query results
        delete rows[0].password_hash;
        return rows[0];
      });
  },

  updateUserLogin(db, updateFields, userLoginID) {
    return db('user_login').update(updateFields).where('user_login_id', '=', userLoginID);
  },

  updateUser(db, userFields) {
    return db.update(userFields).into('users').where('user_id', '=', userFields.user_id);
  },

  deleteUser(db, userID) {
    return db.delete().from('users').where('user_id', '=', userID);
  },

  deleteUserLogin(db, userID) {
    return db.delete().from('user_login').where('user_id', '=', userID);
  },

  fetchUser(db, accountID, userID) {
    return db.select().from('users').where('account_id', '=', accountID).andWhere('user_id', '=', userID).returning('*');
  },

  fetchUserLogin(db, user) {
    return db
      .select('user_login_id', 'user_name', 'is_login_active')
      .from('user_login')
      .where('user_id', '=', user.user_id);
  }
};

module.exports = accountUserService;
