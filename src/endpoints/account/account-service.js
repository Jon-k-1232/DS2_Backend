const { resolveNewAccountStorageSlug } = require('../../utils/storageSlug');

const accountService = {
   getAccount(db, accountID) {
      return db.select().from('accounts').join('account_information', 'account_information.account_id', '=', 'accounts.account_id').where('accounts.account_id', '=', accountID);
   },

   //Get all accountID's
   fetchAllAccountIDs(db) {
      return db
         .select('account_id')
         .from('accounts')
         .then(rows => rows.map(row => row.account_id));
   },

   // review/full-audit-2026-09 finding 1 (Astra round 9): assigns the new
   // account's IMMUTABLE storage_slug here, at the one moment its S3
   // namespace is decided, rather than deriving it on every later request
   // from the (mutable) account_name — see src/utils/storageSlug.js. The new
   // account_id must be known BEFORE the row is inserted so a colliding slug
   // can be suffixed correctly on the very first write (resolveNewAccountStorageSlug's
   // collision rule assumes the new row always has the highest id in play);
   // `nextval` reserves it a row at a time under the same transaction, same
   // as a human assigning ids by hand — Postgres sequences are never
   // transactional, so a failed create simply leaves a gap, which is
   // harmless (ids carry no meaning beyond uniqueness).
   createAccount(db, newAccount) {
      return db.transaction(async trx => {
         const {
            rows: [{ id }]
         } = await trx.raw("SELECT nextval(pg_get_serial_sequence('accounts', 'account_id')) AS id");
         const accountId = Number(id);
         const storageSlug = await resolveNewAccountStorageSlug(trx, newAccount.account_name, accountId);
         const [row] = await trx('accounts')
            .insert({ ...newAccount, account_id: accountId, storage_slug: storageSlug })
            .returning('*');
         return row;
      });
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
         .andWhere('account_id', accountInformationData.account_id)
         .update(accountInformationData)
         .returning('*')
         .then(rows => rows[0]);
   },

   deleteAccount(db, accountID) {
      return db('accounts').where('account_id', accountID).del();
   }
};

module.exports = accountService;
