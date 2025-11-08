const buildActivePaymentsQuery = (db, accountID) => {
   return db
      .select('customer_payments.*', db.raw('customers.display_name as customer_name'), db.raw('users.display_name as created_by_user_name'))
      .from('customer_payments')
      .join('customers', 'customer_payments.customer_id', 'customers.customer_id')
      .join('users', 'customer_payments.created_by_user_id', 'users.user_id')
      .where('customer_payments.account_id', accountID);
};

const applyPaymentsSearchFilter = (query, searchTerm) => {
   if (!searchTerm) return;

   const normalized = String(searchTerm).trim().toLowerCase();
   if (!normalized.length) return;

   const likeTerm = `%${normalized}%`;
   query.andWhere(builder => {
      builder
         .whereRaw('LOWER(customers.display_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_payments.form_of_payment) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_payments.payment_reference_number) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_payments.note) LIKE ?', [likeTerm])
         .orWhereRaw('CAST(customer_payments.payment_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_payments.customer_invoice_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_payments.customer_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw("TO_CHAR(customer_payments.payment_date, 'YYYY-MM-DD') LIKE ?", [`%${searchTerm}%`]);
   });
};

const paymentsService = {
   // Must stay desc, used in finding if an invoice has to be created
   getActivePayments(db, accountID) {
      return buildActivePaymentsQuery(db, accountID).orderBy('customer_payments.created_at', 'desc');
   },

   async getActivePaymentsPaginated(db, accountID, { limit, offset, searchTerm }) {
      const baseQuery = buildActivePaymentsQuery(db, accountID);
      applyPaymentsSearchFilter(baseQuery, searchTerm);

      const sortedQuery = baseQuery.clone().orderBy('customer_payments.created_at', 'desc');
      const dataQuery = sortedQuery.clone().limit(limit).offset(offset);

      const countResult = await baseQuery.clone().clearSelect().count({ count: '*' }).first();
      const payments = await dataQuery;
      const totalCount = Number(countResult?.count || 0);

      return { payments, totalCount };
   },

   getActivePaymentsForCustomer(db, accountID, customerID) {
      return db
         .select('customer_payments.*', db.raw('customers.display_name as customer_name'), db.raw('users.display_name as created_by_user_name'))
         .from('customer_payments')
         .join('customers', 'customer_payments.customer_id', 'customers.customer_id')
         .join('users', 'customer_payments.created_by_user_id', 'users.user_id')
         .where('customer_payments.account_id', accountID)
         .andWhere('customer_payments.customer_id', customerID)
         .orderBy('customer_payments.created_at', 'desc');
   },

   getPaymentsBetweenDates(db, accountID, start_date, end_date) {
      return db.select().from('customer_payments').where('account_id', accountID).andWhere('payment_date', '>=', start_date).andWhere('payment_date', '<=', end_date);
   },

   getSinglePayment(db, paymentID, accountID) {
      return db.select().from('customer_payments').andWhere('payment_id', Number(paymentID));
   },

   getPaymentsForInvoice(db, accountID, invoiceID) {
      return db.select().from('customer_payments').where('account_id', accountID).andWhere('customer_invoice_id', invoiceID);
   },

   updatePayment(db, updatedPayment) {
      return db
         .update(updatedPayment)
         .into('customer_payments')
         .where('payment_id', '=', updatedPayment.payment_id)
         .returning('*')
         .then(rows => rows[0]);
   },

   deletePayment(db, paymentID) {
      return db
         .delete()
         .from('customer_payments')
         .where('payment_id', '=', paymentID)
         .returning('*')
         .then(rows => rows[0]);
   },

   createPayment(db, newPayment) {
      return db
         .insert(newPayment)
         .into('customer_payments')
         .returning('*')
         .then(rows => rows[0]);
   },

   upsertPayments(db, payments) {
      if (!payments.length) return [];
      return db.insert(payments).into('customer_payments').onConflict('payment_id').merge();
   }
};

module.exports = paymentsService;
