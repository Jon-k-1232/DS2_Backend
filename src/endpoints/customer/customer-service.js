const customerService = {
   getContactMailingInformation(db, accountID, customerID) {
      return db
         .select(
            'customers.*',
            'customer_information.customer_info_id',
            'customer_information.customer_street',
            'customer_information.customer_city',
            'customer_information.customer_state',
            'customer_information.customer_zip',
            'customer_information.customer_email',
            'customer_information.customer_phone'
         )
         .from('customers')
         .leftJoin('customer_information', function () {
            this.on('customers.customer_id', '=', 'customer_information.customer_id')
               .andOn('customer_information.is_customer_mailing_address', db.raw('?', [true]))
               .andOn('customer_information.is_this_address_active', db.raw('?', [true]));
         })
         .where('customers.customer_id', customerID)
         .where('customers.account_id', accountID)
         .orderBy('customers.customer_name', 'asc');
   },

   getActiveCustomers(db, accountID) {
      return db
         .select()
         .from('customers')
         .where('customers.account_id', '=', accountID)
         .andWhere('customers.is_customer_active', '=', true)
         .join('customer_information', 'customers.customer_id', '=', 'customer_information.customer_id')
         .andWhere('customer_information.is_this_address_active', '=', true)
         .andWhere('customer_information.account_id', '=', accountID)
         .orderBy('customers.customer_name', 'asc');
   },

   getCustomerByID(db, accountID, customerID) {
      return db
         .select(
            'customers.*',
            'customer_information.*',
            'recurring_customers.subscription_frequency',
            'recurring_customers.bill_on_date',
            'recurring_customers.recurring_bill_amount',
            'recurring_customers.start_date',
            'recurring_customers.end_date',
            'recurring_customers.recurring_customer_id',
            'recurring_customers.is_recurring_customer_active'
         )
         .from('customers')
         .where('customers.account_id', '=', accountID)
         .andWhere('customers.customer_id', '=', customerID)
         .join('customer_information', 'customers.customer_id', '=', 'customer_information.customer_id')
         .andWhere('customer_information.is_this_address_active', '=', true)
         .andWhere('customer_information.account_id', '=', accountID)
         .leftJoin('recurring_customers', function () {
            this.on('customers.customer_id', '=', 'recurring_customers.customer_id')
               .andOn('recurring_customers.is_recurring_customer_active', '=', db.raw('?', [true]))
               .andOn('recurring_customers.account_id', '=', db.raw('?', [accountID]));
         });
   },

   disableCustomer(db, accountID, customerID) {
      return db('customers').where('customer_id', customerID).andWhere('account_id', accountID).update('is_customer_active', false);
   },

   createCustomer(db, customer) {
      return db('customers')
         .insert(customer)
         .returning('*')
         .then(([customer]) => customer);
   },

   createCustomerInformation(db, customerInformation) {
      return db('customer_information')
         .insert(customerInformation)
         .returning('*')
         .then(([customerInformation]) => customerInformation);
   },

   updateCustomer(db, customer) {
      return db('customers')
         .where({ customer_id: customer.customer_id })
         .update(customer)
         .returning('*')
         .then(([customer]) => customer);
   },

   updateCustomerRecurringField(db, customerID, accountID) {
      return db('customers').where('customer_id', customerID).andWhere('account_id', accountID).update('is_recurring', true);
   },

   updateCustomerInformation(db, customerInformation) {
      return db('customer_information').where('customer_id', customerInformation.customer_id).where('customer_info_id', customerInformation.customer_info_id).update(customerInformation);
   },

   deleteCustomer(db, customer_id) {
      return db('customers').where({ customer_id }).del();
   }
};

module.exports = customerService;
