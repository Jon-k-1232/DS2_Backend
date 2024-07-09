const dayjs = require('dayjs');

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
      return db.select().from('customer_retainers_and_prepayments').where('account_id', accountID).andWhere('created_at', '>=', start_date).andWhere('created_at', '<=', end_date);
   },

   getCustomerRetainersByID(db, accountID, customerID) {
      return db.select().from('customer_retainers_and_prepayments').where('account_id', accountID).andWhere('customer_id', customerID);
   },

   getSingleRetainer(db, accountID, retainerID) {
      return db.select().from('customer_retainers_and_prepayments').where('account_id', accountID).andWhere('retainer_id', retainerID);
   },

   getRetainerBySameTime(db, accountID, retainerID, createdAt) {
      // Calculate 1/2 of a second after the provided createdAt time, having to solve this way as retainer line may not be stored
      const oneSecondAfter = dayjs(createdAt).add(500, 'millisecond').toISOString();

      return db.select().from('customer_retainers_and_prepayments').where('account_id', accountID).andWhere('parent_retainer_id', retainerID).andWhere('created_at', '<=', oneSecondAfter);
   },

   getMostRecentRecordOfCustomerRetainers(db, accountID, customerID) {
      return db
         .select('*')
         .from(function () {
            this.select('*', db.raw('ROW_NUMBER() OVER (PARTITION BY COALESCE(parent_retainer_id, retainer_id) ORDER BY created_at DESC) as rn'))
               .from('customer_retainers_and_prepayments')
               .where('account_id', accountID)
               .andWhere('customer_id', customerID)
               .andWhere('current_amount', '<', 0)
               .as('sub');
         })
         .where('rn', 1)
         .orderBy('created_at', 'desc');
   },

   getMostRecentRecordOfSingleRetainer(db, accountID, retainerID) {
      return db
         .select()
         .from('customer_retainers_and_prepayments')
         .where('account_id', accountID)
         .andWhere(function () {
            this.where('retainer_id', retainerID)
               .orWhere('parent_retainer_id', retainerID)
               .orWhere(function () {
                  this.where('retainer_id', db.ref('parent_retainer_id')).andWhere('parent_retainer_id', null);
               });
         })
         .orderBy('created_at', 'desc')
         .limit(1);
   },

   updateRetainer(db, updatedRetainer) {
      return db.update(updatedRetainer).into('customer_retainers_and_prepayments').where('retainer_id', '=', updatedRetainer.retainer_id);
   },

   deleteRetainer(db, retainerID, accountID) {
      return db.delete().from('customer_retainers_and_prepayments').where('retainer_id', retainerID).andWhere('account_id', accountID);
   },

   createRetainer(db, newRetainer) {
      return db
         .insert(newRetainer)
         .into('customer_retainers_and_prepayments')
         .returning('*')
         .then(rows => rows[0]);
   }
};

module.exports = retainersService;
