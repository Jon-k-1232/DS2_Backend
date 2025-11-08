const buildActiveWriteOffsQuery = (db, accountID) =>
   db
      .select(
         'customer_writeoffs.*',
         db.raw('customers.display_name as customer_name'),
         'customer_jobs.job_type_id',
         'customer_job_types.job_description',
         db.raw('users.display_name as created_by_user_name')
      )
      .from('customer_writeoffs')
      .join('customers', 'customer_writeoffs.customer_id', 'customers.customer_id')
      .leftJoin('customer_jobs', 'customer_writeoffs.customer_job_id', 'customer_jobs.customer_job_id')
      .leftJoin('customer_job_types', 'customer_jobs.job_type_id', 'customer_job_types.job_type_id')
      .join('users', 'customer_writeoffs.created_by_user_id', 'users.user_id')
      .where('customer_writeoffs.account_id', accountID);

const applyWriteoffsSearchFilter = (query, searchTerm) => {
   if (!searchTerm) return;
   const normalized = String(searchTerm).trim().toLowerCase();
   if (!normalized.length) return;
   const likeTerm = `%${normalized}%`;
   query.andWhere(builder => {
      builder
         .whereRaw('LOWER(customers.display_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_job_types.job_description) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_writeoffs.writeoff_reason) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_writeoffs.note) LIKE ?', [likeTerm])
         .orWhereRaw('CAST(customer_writeoffs.writeoff_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_writeoffs.customer_invoice_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw('CAST(customer_writeoffs.customer_id AS TEXT) LIKE ?', [`%${searchTerm}%`])
         .orWhereRaw("TO_CHAR(customer_writeoffs.writeoff_date, 'YYYY-MM-DD') LIKE ?", [`%${searchTerm}%`]);
   });
};

const writeOffsService = {
   getActiveWriteOffs(db, accountID) {
      return buildActiveWriteOffsQuery(db, accountID);
   },

   async getActiveWriteOffsPaginated(db, accountID, { limit, offset, searchTerm }) {
      const baseQuery = buildActiveWriteOffsQuery(db, accountID);
      applyWriteoffsSearchFilter(baseQuery, searchTerm);

      const sortedQuery = baseQuery.clone().orderBy('customer_writeoffs.created_at', 'desc');
      const dataQuery = sortedQuery.clone().limit(limit).offset(offset);

      const countResult = await baseQuery.clone().clearSelect().count({ count: '*' }).first();
      const writeoffs = await dataQuery;
      const totalCount = Number(countResult?.count || 0);

      return { writeoffs, totalCount };
   },

   getWriteoffsBetweenDates(db, accountID, start_date, end_date) {
      return db.select().from('customer_writeoffs').where('account_id', accountID).andWhere('writeoff_date', '>=', start_date).andWhere('writeoff_date', '<=', end_date);
   },

   getSingleWriteOff(db, writeOffID, accountID) {
      return db.select().from('customer_writeoffs').where('writeoff_id', writeOffID).andWhere('account_id', accountID);
   },

   getWriteoffsForInvoice(db, accountID, invoiceID) {
      return db.select().from('customer_writeoffs').where('account_id', accountID).andWhere('customer_invoice_id', invoiceID);
   },

   getWriteOffsByJobID(db, accountID, jobID) {
      return db.select().from('customer_writeoffs').where('account_id', accountID).andWhere('customer_job_id', jobID);
   },

   updateWriteOff(db, updatedWriteOff) {
      return db.update(updatedWriteOff).into('customer_writeoffs').where('writeoff_id', '=', updatedWriteOff.writeoff_id);
   },

   deleteWriteOff(db, writeOffID, accountID) {
      return db.delete().from('customer_writeoffs').where('writeoff_id', writeOffID).andWhere('account_id', accountID);
   },

   createWriteOff(db, newWriteOff) {
      return db
         .insert(newWriteOff)
         .into('customer_writeoffs')
         .returning('*')
         .then(rows => rows[0]);
   },

   upsertWriteOffs(db, writeOffs) {
      if (!writeOffs.length) return [];
      return db.insert(writeOffs).into('customer_writeoffs').onConflict('writeoff_id').merge();
   }
};

module.exports = writeOffsService;
