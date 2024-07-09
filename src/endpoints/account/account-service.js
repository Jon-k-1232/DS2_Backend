const accountService = {
  getAccount(db, accountID) {
    return db
      .select()
      .from('accounts')
      .join('account_information', 'account_information.account_id', '=', 'accounts.account_id')
      .where('accounts.account_id', '=', accountID);
  },

  createAccount(db, newAccount) {
    return db
      .insert(newAccount)
      .into('accounts')
      .returning('*')
      .then(rows => rows[0]);
  },

  createAccountInformation(db, newAccountInformation) {
    return db
      .insert(newAccountInformation)
      .into('account_information')
      .returning('*')
      .then(rows => rows[0]);
  },

  updateAccount(db, accountData) {
    return db('accounts')
      .where('account_id', accountData.account_id)
      .update(accountData)
      .returning('*')
      .then(rows => rows[0]);
  },

  updateAccountInformation(db, accountInformationData) {
    return db('account_information')
      .where('account_info_id', accountInformationData.account_info_id)
      .update(accountInformationData)
      .returning('*')
      .then(rows => rows[0]);
  },

  deleteAccount(db, accountID) {
    return db('accounts').where('account_id', accountID).del();
  }
};

module.exports = accountService;
