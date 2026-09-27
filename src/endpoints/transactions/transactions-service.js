// Preserve ordinary work's owned-label joins. Only occurrence-backed fees may
// appear without a staff/catalog/job selection.
const validRelations = (query, db, staff = true) => query.andWhere(function () {
   this.where(function () {
      this.whereNotNull('customer_jobs.customer_job_id').whereNotNull('customer_job_types.job_type_id');
      if (staff) this.whereNotNull('users.user_id').whereNotNull('customer_general_work_descriptions.general_work_description_id');
   }).orWhereExists(db('public.recurring_charge_occurrences as ro').select(db.raw('1')).whereRaw('ro.transaction_id=customer_transactions.transaction_id AND ro.account_id=customer_transactions.account_id AND ro.customer_id=customer_transactions.customer_id'));
});
const buildActiveTransactionsQuery = (db, accountID) => {
   return db
      .select(
         'customer_transactions.*',
         db.raw('(SELECT plan_id FROM public.recurring_charge_occurrences o WHERE o.transaction_id=customer_transactions.transaction_id) AS recurring_plan_id'),
         db.raw('customers.display_name as customer_name'),
         db.raw('users.display_name as logged_for_user_name'),
         'customer_general_work_descriptions.general_work_description',
         'customer_jobs.job_type_id',
         'customer_job_types.job_description'
      )
      .from('customer_transactions')
      .join('customers', function () {
         this.on('customer_transactions.customer_id', '=', 'customers.customer_id')
            .andOn('customers.account_id', '=', 'customer_transactions.account_id');
      })
      .leftJoin('users', function () {
         this.on('customer_transactions.logged_for_user_id', '=', 'users.user_id')
            .andOn('users.account_id', '=', 'customer_transactions.account_id');
      })
      .leftJoin('customer_general_work_descriptions', function () {
         this.on('customer_transactions.general_work_description_id', '=', 'customer_general_work_descriptions.general_work_description_id')
            .andOn('customer_general_work_descriptions.account_id', '=', 'customer_transactions.account_id');
      })
      .leftJoin('customer_jobs', function () {
         this.on('customer_transactions.customer_job_id', '=', 'customer_jobs.customer_job_id')
            .andOn('customer_jobs.account_id', '=', 'customer_transactions.account_id')
            .andOn('customer_jobs.customer_id', '=', 'customer_transactions.customer_id');
      })
      .leftJoin('customer_job_types', function () {
         this.on('customer_jobs.job_type_id', '=', 'customer_job_types.job_type_id')
            .andOn('customer_job_types.account_id', '=', 'customer_jobs.account_id');
      })
      .where('customer_transactions.account_id', accountID).modify(validRelations, db);
};

const applyTransactionsSearchFilter = (query, searchTerm) => {
   if (!searchTerm) return;

   const normalized = searchTerm.trim().toLowerCase();
   if (!normalized.length) return;

   const likeTerm = `%${normalized}%`;
   query.andWhere(builder => {
      builder
         .whereRaw('LOWER(customers.display_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_transactions.transaction_type) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_transactions.detailed_work_description) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_general_work_descriptions.general_work_description) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_job_types.job_description) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(users.display_name) LIKE ?', [likeTerm])
         .orWhereRaw('CAST(customer_transactions.transaction_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_transactions.customer_invoice_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_transactions.customer_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_transactions.customer_job_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_transactions.total_transaction AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_transactions.quantity AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw("TO_CHAR(customer_transactions.transaction_date, 'YYYY-MM-DD') LIKE ?", [`%${searchTerm}%`]);
   });
};

const transactionsService = {
   // Must stay desc, used in finding if an invoice has to be created
   getActiveTransactions(db, accountID) {
      return buildActiveTransactionsQuery(db, accountID).orderBy('customer_transactions.created_at', 'desc');
   },

   async getActiveTransactionsPaginated(db, accountID, { limit, offset, searchTerm }) {
      const baseQuery = buildActiveTransactionsQuery(db, accountID);
      applyTransactionsSearchFilter(baseQuery, searchTerm);

      const sortedQuery = baseQuery.clone().orderBy('customer_transactions.created_at', 'desc');

      const dataQuery = sortedQuery.clone().limit(limit).offset(offset);

      const countResult = await baseQuery.clone().clearSelect().count({ count: '*' }).first();

      const transactions = await dataQuery;
      const totalCount = Number(countResult?.count || 0);

      return { transactions, totalCount };
   },

   async getActiveTransactionsForExport(db, accountID, searchTerm) {
      const exportQuery = buildActiveTransactionsQuery(db, accountID);
      applyTransactionsSearchFilter(exportQuery, searchTerm);
      return exportQuery.orderBy('customer_transactions.created_at', 'desc');
   },

   getAllSpecificCustomerJobTransactions(db, accountID, customerJobID) {
      return db
         .select('customer_transactions.*')
         .from('customer_transactions')
         .where('customer_transactions.account_id', accountID)
         .andWhere('customer_transactions.customer_job_id', customerJobID)
         .orderBy('customer_transactions.created_at', 'desc');
   },

   getTransactionsBetweenDates(db, accountID, start_date, end_date) {
      return db
         .select(
            'customer_transactions.*',
         db.raw('(SELECT plan_id FROM public.recurring_charge_occurrences o WHERE o.transaction_id=customer_transactions.transaction_id) AS recurring_plan_id'),
            'customers.business_name',
            'customers.customer_name',
            'customers.display_name',
            'customer_jobs.job_quote_amount',
            'customer_jobs.agreed_job_amount',
            'customer_jobs.current_job_total',
            'customer_jobs.job_status',
            'customer_jobs.notes as job_notes',
            'customer_job_types.job_description',
            'customer_job_types.book_rate',
            'customer_job_types.estimated_straight_time'
         )
         .from('customer_transactions')
         .join('customers', function () {
         this.on('customer_transactions.customer_id', '=', 'customers.customer_id')
            .andOn('customers.account_id', '=', 'customer_transactions.account_id');
      })
         .leftJoin('customer_jobs', function () {
         this.on('customer_transactions.customer_job_id', '=', 'customer_jobs.customer_job_id')
            .andOn('customer_jobs.account_id', '=', 'customer_transactions.account_id')
            .andOn('customer_jobs.customer_id', '=', 'customer_transactions.customer_id');
      })
         .leftJoin('customer_job_types', function () {
         this.on('customer_jobs.job_type_id', '=', 'customer_job_types.job_type_id')
            .andOn('customer_job_types.account_id', '=', 'customer_jobs.account_id');
      })
         .where('customer_transactions.account_id', accountID)
         .modify(validRelations, db, false)
         .andWhere('customer_transactions.transaction_date', '>=', start_date)
         .andWhere('customer_transactions.transaction_date', '<=', end_date);
   },

   getCustomerTransactionsByID(db, accountID, customerID) {
      return db
         .select(
            'customer_transactions.*',
         db.raw('(SELECT plan_id FROM public.recurring_charge_occurrences o WHERE o.transaction_id=customer_transactions.transaction_id) AS recurring_plan_id'),
            db.raw('customers.display_name as customer_name'),
            db.raw('users.display_name as logged_for_user_name'),
            'customer_general_work_descriptions.general_work_description',
            'customer_jobs.job_type_id',
            'customer_job_types.job_description'
         )
         .from('customer_transactions')
         .join('customers', function () {
         this.on('customer_transactions.customer_id', '=', 'customers.customer_id')
            .andOn('customers.account_id', '=', 'customer_transactions.account_id');
      })
         .leftJoin('users', function () {
         this.on('customer_transactions.logged_for_user_id', '=', 'users.user_id')
            .andOn('users.account_id', '=', 'customer_transactions.account_id');
      })
         .leftJoin('customer_general_work_descriptions', function () {
         this.on('customer_transactions.general_work_description_id', '=', 'customer_general_work_descriptions.general_work_description_id')
            .andOn('customer_general_work_descriptions.account_id', '=', 'customer_transactions.account_id');
      })
         .leftJoin('customer_jobs', function () {
         this.on('customer_transactions.customer_job_id', '=', 'customer_jobs.customer_job_id')
            .andOn('customer_jobs.account_id', '=', 'customer_transactions.account_id')
            .andOn('customer_jobs.customer_id', '=', 'customer_transactions.customer_id');
      })
         .leftJoin('customer_job_types', function () {
         this.on('customer_jobs.job_type_id', '=', 'customer_job_types.job_type_id')
            .andOn('customer_job_types.account_id', '=', 'customer_jobs.account_id');
      })
         .where('customer_transactions.account_id', accountID)
         .where('customer_transactions.customer_id', customerID)
         .modify(validRelations, db)
         .orderBy('customer_transactions.created_at', 'desc');
   },

   getTransactionsForInvoice(db, accountID, invoiceID) {
      return db.select().from('customer_transactions').where('account_id', accountID).andWhere('customer_invoice_id', invoiceID);
   },

   getSingleTransaction(db, accountID, customerID, transactionID) {
      return db.select('customer_transactions.*', db.raw('(SELECT plan_id FROM public.recurring_charge_occurrences o WHERE o.transaction_id=customer_transactions.transaction_id AND o.account_id=customer_transactions.account_id) AS recurring_plan_id')).from('customer_transactions').where('account_id', accountID).andWhere('customer_id', customerID).andWhere('transaction_id', transactionID);
   },

   getTransactionsByRetainerID(db, accountID, retainerID) {
      return db.select().from('customer_transactions').where('account_id', accountID).andWhere('retainer_id', retainerID);
   },

   // jobID may be a single id or an array of ids (e.g. every row in a job's
   // version family — see job-service.getJobFamilyIds) so callers can check
   // "is anything linked to any row in this family" in one query.
   getTransactionsByJobID(db, accountID, jobID) {
      const query = db.select().from('customer_transactions').where('account_id', accountID);
      return Array.isArray(jobID) ? query.whereIn('customer_job_id', jobID) : query.andWhere('customer_job_id', jobID);
   },

   getTransactionsByGeneralWorkDescriptionID(db, accountID, generalWorkDescriptionID) {
      return db.select().from('customer_transactions').where('account_id', accountID).andWhere('general_work_description_id', generalWorkDescriptionID);
   },

   updateTransaction(db, updatedTransaction, accountId) {
      return db
         .update(updatedTransaction)
         .into('customer_transactions')
         .where('transaction_id', updatedTransaction.transaction_id)
         .andWhere('account_id', accountId);
   },

   deleteTransaction(db, transactionID, accountId) {
      return db.delete().from('customer_transactions').where('transaction_id', '=', transactionID).andWhere('account_id', accountId);
   },

   createTransaction(db, newTransaction) {
      return db
         .insert(newTransaction)
         .into('customer_transactions')
         .returning('*')
         .then(rows => rows[0]);
   },

   upsertTransactions(db, transactions) {
      if (!transactions.length) return [];
      return db.insert(transactions).into('customer_transactions').onConflict('transaction_id').merge();
   }
};

module.exports = transactionsService;
