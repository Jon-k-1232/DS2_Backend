const { withTransaction, lockCustomerLedger } = require('../payments/ledger-helpers');

// The explicit active flag defines membership; dates remain descriptive, as in
// getActiveRecurringCustomers. Callers hold the customer's ledger lock.
const reconcileCustomerRecurringFlag = async (trx, accountId, customerId) => {
  const active = await trx('recurring_customers').where({ account_id: accountId, customer_id: customerId, is_recurring_customer_active: true }).first();
  return trx('customers').where({ account_id: accountId, customer_id: customerId }).update({ is_recurring: Boolean(active) });
};

const saveRecurring = (db, fields, create = false) => withTransaction(db, async trx => {
  const accountId = fields.account_id;
  const identity = { account_id: accountId, recurring_customer_id: fields.recurring_customer_id };
  const existing = create ? null : await trx('recurring_customers').where(identity).first();
  if (!create && !existing) throw new Error('Recurring customer not found.');
  const customerId = create ? fields.customer_id : existing.customer_id;
  await lockCustomerLedger(trx, accountId, customerId);
  let result;
  if (create) {
    [result] = await trx('recurring_customers').insert(fields).returning('*');
  } else {
    result = await trx('recurring_customers').where({ ...identity, customer_id: customerId }).update({ ...fields, customer_id: customerId });
    if (result !== 1) throw new Error('Recurring customer changed; refresh before saving.');
  }
  await reconcileCustomerRecurringFlag(trx, accountId, customerId);
  return result;
});

const recurringCustomerService = {
  // Get all recurring customers
  getActiveRecurringCustomers(db, accountID) {
    return db
      .from('recurring_customers')
      .select('customers.display_name', 'recurring_customers.*') // select all columns from recurring_customers and display_name from customers
      .join('customers', function () {
         this.on('recurring_customers.customer_id', '=', 'customers.customer_id')
            .andOn('customers.account_id', '=', 'recurring_customers.account_id');
      }) // join with customers table on customer_id
      .where('recurring_customers.account_id', accountID)
      .andWhere('recurring_customers.is_recurring_customer_active', true);
  },

  // NOTE: the second argument is a recurring_customer_id (the row's own key),
  // not a customer_id — use getRecurringCustomersForCustomer for the latter.
  getRecurringCustomerByID(db, accountID, recurringCustomerID) {
    return db.from('recurring_customers').select().where('recurring_customer_id', recurringCustomerID).andWhere('account_id', accountID);
  },

  // Every recurring-billing row that belongs to a CUSTOMER (deleteCustomer guard).
  getRecurringCustomersForCustomer(db, accountID, customerID) {
    return db.from('recurring_customers').select().where('customer_id', customerID).andWhere('account_id', accountID);
  },

  reconcileCustomerRecurringFlag,

  createRecurringCustomer(db, fields) {
    return saveRecurring(db, fields, true);
  },

  updateRecurringCustomer(db, fields) {
    return saveRecurring(db, fields);
  },

  deleteRecurringCustomer(db, fields) {
    return saveRecurring(db, fields);
  }
};

module.exports = recurringCustomerService;
