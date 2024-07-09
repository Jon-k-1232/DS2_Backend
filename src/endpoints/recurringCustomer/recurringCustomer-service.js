const recurringCustomerService = {
  // Get all recurring customers
  getActiveRecurringCustomers(db, accountID) {
    return db
      .from('recurring_customers')
      .select('customers.display_name', 'recurring_customers.*') // select all columns from recurring_customers and display_name from customers
      .join('customers', 'recurring_customers.customer_id', 'customers.customer_id') // join with customers table on customer_id
      .where('recurring_customers.account_id', accountID)
      .andWhere('recurring_customers.is_recurring_customer_active', true);
  },

  getRecurringCustomerByID(db, accountID, customerID) {
    return db.from('recurring_customers').select().where('recurring_customer_id', customerID).andWhere('account_id', accountID);
  },

  // Create a new recurring customer
  createRecurringCustomer(db, recurringCustomerTableFields) {
    return db
      .insert(recurringCustomerTableFields)
      .into('recurring_customers')
      .returning('*')
      .then(rows => rows[0]);
  },

  // Update a recurring customer
  updateRecurringCustomer(db, recurringCustomerTableFields) {
    return db
      .from('recurring_customers')
      .where('recurring_customer_id', recurringCustomerTableFields.recurring_customer_id)
      .update(recurringCustomerTableFields);
  },

  // Delete a recurring customer
  deleteRecurringCustomer(db, recurringCustomerTableFields) {
    return db
      .from('recurring_customers')
      .update(recurringCustomerTableFields)
      .where('recurring_customer_id', recurringCustomerTableFields.recurring_customer_id);
  }
};

module.exports = recurringCustomerService;
