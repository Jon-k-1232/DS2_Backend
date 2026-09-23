const buildActiveCustomersQuery = (db, accountID) =>
   db
      .select()
      .from('customers')
      .where('customers.account_id', '=', accountID)
      .andWhere('customers.is_customer_active', '=', true)
      .join('customer_information', 'customers.customer_id', '=', 'customer_information.customer_id')
      .andWhere('customer_information.is_this_address_active', '=', true)
      .andWhere('customer_information.account_id', '=', accountID);

const applyCustomersSearchFilter = (query, searchTerm) => {
   if (!searchTerm) return;
   const normalized = String(searchTerm).trim().toLowerCase();
   if (!normalized.length) return;
   const likeTerm = `%${normalized}%`;
   query.andWhere(builder => {
      builder
         .whereRaw('LOWER(customers.display_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customers.business_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customers.customer_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_information.customer_city) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_information.customer_state) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_information.customer_email) LIKE ?', [likeTerm])
         .orWhereRaw('CAST(customers.customer_id AS TEXT) LIKE ?', [`%${searchTerm}%`]);
   });
};

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
      return buildActiveCustomersQuery(db, accountID).orderBy('customers.customer_name', 'asc');
   },

   async getActiveCustomersPaginated(db, accountID, { limit, offset, searchTerm }) {
      const baseQuery = buildActiveCustomersQuery(db, accountID);
      applyCustomersSearchFilter(baseQuery, searchTerm);
      const sortedQuery = baseQuery.clone().orderBy('customers.customer_name', 'asc');
      const dataQuery = sortedQuery.clone().limit(limit).offset(offset);
      const countResult = await baseQuery.clone().clearSelect().count({ count: '*' }).first();
      const customers = await dataQuery;
      const totalCount = Number(countResult?.count || 0);
      return { customers, totalCount };
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
         .andWhere('account_id', customer.account_id)
         .update(customer)
         .returning('*')
         .then(([customer]) => customer);
   },

   updateCustomerRecurringField(db, customerID, accountID) {
      return db('customers').where('customer_id', customerID).andWhere('account_id', accountID).update('is_recurring', true);
   },

   updateCustomerInformation(db, customerInformation) {
      return db('customer_information')
         .where('customer_id', customerInformation.customer_id)
         .where('customer_info_id', customerInformation.customer_info_id)
         .andWhere('account_id', customerInformation.account_id)
         .update(customerInformation);
   },

   deleteCustomer(db, customer_id, accountId) {
      return db('customers').where({ customer_id }).andWhere('account_id', accountId).del();
   },

   // deleteCustomer's guard previously checked jobs/retainers/invoices/
   // payments/transactions/recurring-customers but not write-offs — a
   // customer with only write-off history (no jobs/invoices/etc. left) could
   // slip past the guard and get hard-deleted, leaving customer_writeoffs rows
   // pointing at a customer_id that no longer exists. writeOffs-service.js has
   // no customer-scoped getter to reuse (only by-invoice / by-job), so this is
   // a small direct query rather than a cross-boundary edit into writeOffs/**.
   getWriteOffsForCustomer(db, accountID, customerID) {
      return db('customer_writeoffs').where({ customer_id: customerID, account_id: accountID });
   },

   // Deactivating (is_customer_active -> false) is the supported alternative
   // to deleteCustomer's hard-delete-with-no-related-records rule, so it must
   // NOT be blocked by an open balance or unbilled work — but the caller
   // should be warned, since those debts/hours become easy to lose track of
   // once a customer drops out of the active lists. Mirrors the rolling-balance
   // model documented in account-audit-logic.js: current debt = the newest
   // parent invoice's remaining_balance_on_invoice, not a sum across parents.
   async getDeactivationWarnings(db, accountID, customerID) {
      const warnings = [];

      const newestParent = await db('customer_invoices')
         .where({ account_id: accountID, customer_id: customerID })
         .whereNull('parent_invoice_id')
         .orderBy('invoice_date', 'desc')
         .orderBy('customer_invoice_id', 'desc')
         .first('remaining_balance_on_invoice');
      const openBalance = Number(newestParent?.remaining_balance_on_invoice || 0);
      if (openBalance > 0) {
         warnings.push(`Customer has an open balance of $${openBalance.toFixed(2)}.`);
      }

      const { count: unbilledCount } = await db('customer_transactions')
         .where({ account_id: accountID, customer_id: customerID, is_transaction_billable: true })
         .whereNull('customer_invoice_id')
         .count({ count: '*' })
         .first();
      if (Number(unbilledCount) > 0) {
         warnings.push(`Customer has ${unbilledCount} unbilled billable transaction(s).`);
      }

      return warnings;
   }
};

module.exports = customerService;
