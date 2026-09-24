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
   //
   // review/full-audit-2026-09 findings 3+4 (Astra round 10): each attempt
   // runs inside its own SAVEPOINT (trx.transaction() nested inside an
   // already-open transaction — knex's documented way to get one), not bare
   // statements directly on trx. A unique-violation leaves the ENTIRE
   // enclosing transaction aborted until rollback, so retrying on the same
   // trx with no savepoint would just raise "current transaction is aborted"
   // on the very next statement; the savepoint confines that abort to the
   // one attempt, leaving trx itself (and the id already reserved via
   // nextval above it, if the retry reused it — it doesn't, see below) still
   // usable. resolveNewAccountStorageSlug's advisory lock should make a
   // 23505 on accounts_storage_slug_key unreachable in practice; this retry
   // is the documented last-line-of-defence belt-and-suspenders, not the
   // primary fix — see storageSlug.js.
   createAccount(db, newAccount) {
      return db.transaction(async trx => {
         const attemptInsert = async attemptTrx => {
            const {
               rows: [{ id }]
            } = await attemptTrx.raw("SELECT nextval(pg_get_serial_sequence('accounts', 'account_id')) AS id");
            const accountId = Number(id);
            const storageSlug = await resolveNewAccountStorageSlug(attemptTrx, newAccount.account_name, accountId);
            const [row] = await attemptTrx('accounts')
               .insert({ ...newAccount, account_id: accountId, storage_slug: storageSlug })
               .returning('*');
            return row;
         };

         try {
            return await trx.transaction(attemptInsert);
         } catch (err) {
            if (err?.code === '23505' && err?.constraint === 'accounts_storage_slug_key') {
               // Re-picks a fresh accountId too (a new nextval), not just a
               // fresh slug for the same id — simplest correct retry, and the
               // abandoned id from the failed attempt is just a harmless gap
               // (see the comment above).
               return trx.transaction(attemptInsert);
            }
            throw err;
         }
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
