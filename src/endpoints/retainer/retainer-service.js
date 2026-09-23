const RETAINERS = 'customer_retainers_and_prepayments';

// A retainer "chain" is its root row (parent_retainer_id NULL) plus every
// draw-down snapshot (parent_retainer_id = root). The latest row by
// (created_at, retainer_id) carries the chain's current balance.
const chainFilter = rootRetainerID => builder => builder.where('retainer_id', rootRetainerID).orWhere('parent_retainer_id', rootRetainerID);

const retainersService = {
   // Must stay desc, used in finding if an invoice has to be created
   getActiveRetainers(db, accountID) {
      return db
         .select('customer_retainers_and_prepayments.*', db.raw('customers.display_name as customer_name'), db.raw('users.display_name as created_by_user_name'))
         .from('customer_retainers_and_prepayments')
         .join('customers', 'customer_retainers_and_prepayments.customer_id', 'customers.customer_id')
         .join('users', 'customer_retainers_and_prepayments.created_by_user_id', 'users.user_id')
         .where('customer_retainers_and_prepayments.account_id', accountID)
         .orderBy('customer_retainers_and_prepayments.created_at', 'desc');
   },

   getRetainersBetweenDates(db, accountID, start_date, end_date) {
      return db.select().from(RETAINERS).where('account_id', accountID).andWhere('created_at', '>=', start_date).andWhere('created_at', '<=', end_date);
   },

   getCustomerRetainersByID(db, accountID, customerID) {
      return db.select().from(RETAINERS).where('account_id', accountID).andWhere('customer_id', customerID);
   },

   getSingleRetainer(db, accountID, retainerID) {
      return db.select().from(RETAINERS).where('account_id', accountID).andWhere('retainer_id', retainerID);
   },

   /**
    * Root id of the chain `retainerID` belongs to (a snapshot id resolves to its
    * parent). When the row itself is gone — e.g. a root deleted by the old
    * unscoped payment-delete path — the id is returned as-is so its surviving
    * snapshots can still be found.
    */
   async resolveRetainerRootID(db, accountID, retainerID) {
      const id = Number(retainerID);
      if (!Number.isInteger(id) || id <= 0) return null;
      const row = await db(RETAINERS).select('retainer_id', 'parent_retainer_id').where({ account_id: accountID, retainer_id: id }).first();
      return row ? row.parent_retainer_id || row.retainer_id : id;
   },

   /** Every row of a chain, oldest first. */
   getRetainerChain(db, accountID, rootRetainerID) {
      return db
         .select()
         .from(RETAINERS)
         .where('account_id', accountID)
         .andWhere(chainFilter(rootRetainerID))
         .orderBy([
            { column: 'created_at', order: 'asc' },
            { column: 'retainer_id', order: 'asc' }
         ]);
   },

   // The draw-down snapshot a retainer-funded payment created is resolved by
   // ledger-helpers.resolveRetainerDrawForPayment: the payment's
   // `[retainer_draw:<id>]` marker, or — for legacy payments — a ±1 s window
   // accepted only when exactly ONE draw matches. The former "closest in time"
   // lookup that lived here could hand back another payment's draw.

   /**
    * Retainer picker: the LATEST row of each of the customer's chains, kept
    * only when that latest balance is still available. The window function
    * runs first — filtering current_amount < 0 before ROW_NUMBER made an
    * exhausted chain (latest row $0) reappear as an older row with a stale
    * balance.
    */
   getMostRecentRecordOfCustomerRetainers(db, accountID, customerID) {
      return db
         .select('*')
         .from(function () {
            this.select('*', db.raw('ROW_NUMBER() OVER (PARTITION BY COALESCE(parent_retainer_id, retainer_id) ORDER BY created_at DESC, retainer_id DESC) as rn'))
               .from(RETAINERS)
               .where('account_id', accountID)
               .andWhere('customer_id', customerID)
               .as('sub');
         })
         .where('rn', 1)
         .andWhere('current_amount', '<', 0)
         .andWhere('is_retainer_active', true)
         .orderBy('created_at', 'desc');
   },

   /**
    * Latest row of the chain `retainerID` belongs to — works for a root id or
    * any snapshot id. Resolves `[row]` (or `[]`), like the other lookups.
    */
   async getMostRecentRecordOfSingleRetainer(db, accountID, retainerID) {
      const rootID = await retainersService.resolveRetainerRootID(db, accountID, retainerID);
      if (!rootID) return [];
      return db
         .select()
         .from(RETAINERS)
         .where('account_id', accountID)
         .andWhere(chainFilter(rootID))
         .orderBy([
            { column: 'created_at', order: 'desc' },
            { column: 'retainer_id', order: 'desc' }
         ])
         .limit(1);
   },

   /**
    * Ledger rows that reference a chain: transactions and payments whose
    * retainer_id is any row of the chain, plus payments whose overpayment
    * split banked this (root) retainer (`[prepayment_retainer:<id>]` note).
    */
   async getRetainerChainReferences(db, accountID, retainerIDs, rootRetainerID) {
      const ids = (retainerIDs || []).map(Number).filter(id => Number.isInteger(id) && id > 0);
      const [transactions, payments, overpaymentPayments] = await Promise.all([
         ids.length ? db('customer_transactions').select('transaction_id', 'retainer_id').where('account_id', accountID).whereIn('retainer_id', ids) : [],
         ids.length ? db('customer_payments').select('payment_id', 'retainer_id').where('account_id', accountID).whereIn('retainer_id', ids) : [],
         rootRetainerID
            ? db('customer_payments').select('payment_id').where('account_id', accountID).andWhere('note', 'like', `%[prepayment_retainer:${Number(rootRetainerID)}]%`)
            : []
      ]);
      return { transactions, payments, overpaymentPayments };
   },

   updateRetainer(db, updatedRetainer, accountId) {
      return db.update(updatedRetainer).into(RETAINERS).where('retainer_id', '=', updatedRetainer.retainer_id).andWhere('account_id', accountId);
   },

   deleteRetainer(db, retainerID, accountID) {
      return db.delete().from(RETAINERS).where('retainer_id', retainerID).andWhere('account_id', accountID);
   },

   createRetainer(db, newRetainer) {
      return db
         .insert(newRetainer)
         .into(RETAINERS)
         .returning('*')
         .then(rows => rows[0]);
   }
};

module.exports = retainersService;
