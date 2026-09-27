const { withTransaction, lockCustomerLedger } = require('../payments/ledger-helpers');

// The explicit active flag defines membership; dates remain descriptive, as in
// getActiveRecurringCustomers. Callers hold the customer's ledger lock.
const reconcileCustomerRecurringFlag = async (trx, accountId, customerId) => {
  const active = await trx('public.recurring_customers').where({ account_id: accountId, customer_id: customerId, is_recurring_customer_active: true }).first();
  return trx('customers').where({ account_id: accountId, customer_id: customerId }).update({ is_recurring: Boolean(active) });
};

const saveRecurring = (db, fields, create = false) => withTransaction(db, async trx => {
  const accountId = fields.account_id;
  const identity = { account_id: accountId, recurring_customer_id: fields.recurring_customer_id };
  const existing = create ? null : await trx('recurring_customers').where(identity).first();
  if (!create && !existing) throw new Error('Recurring customer not found.');
  const customerId = create ? fields.customer_id : existing.customer_id;
  await lockCustomerLedger(trx, accountId, customerId);
  const calendar = require('./recurring-calendar');
  const { ruleError } = require('../payments/ledger-helpers');
  const entityId = require('../billingEntities/entity-context').current() || existing?.billing_entity_id;
  const merged = { ...existing, ...fields };
  calendar.validate(merged);
  if (create) {
    Object.assign(fields, { description: fields.description || 'Recurring services',
      anchor_start_date: fields.start_date, first_automated_period: String(fields.start_date).slice(0, 7) + '-01' });
    if (entityId) fields.billing_entity_id = entityId;
  } else {
    if (await trx('recurring_charge_occurrences').where({ plan_id: existing.recurring_customer_id }).first()) {
      const same = Object.entries(fields).every(([name, value]) => name === 'account_id' || name === 'customer_id' || name === 'recurring_customer_id' ||
        (['start_date', 'end_date'].includes(name) ? require('../payments/receipt-values').day(value) === require('../payments/receipt-values').day(existing[name]) : String(value).toLowerCase() === String(existing[name]).toLowerCase()));
      if (same) return existing; // Saving unrelated customer details does not edit its plan.
      throw ruleError('This plan has generated charges. Make changes in Billing → Recurring plans, with a reason and current version.', 409);
    }
    fields.version = existing.version + 1;
    if (fields.start_date) { fields.anchor_start_date = fields.start_date; fields.first_automated_period = calendar.firstPeriod({ ...merged, anchor_start_date: fields.start_date }, existing.cutover_date ? require('../payments/receipt-values').day(existing.cutover_date) : require('../payments/receipt-values').day(fields.start_date)); }
  }
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
