const jobService = {
   createJob(db, newJob) {
      return db
         .insert(newJob)
         .into('customer_jobs')
         .returning('*')
         .then(rows => rows[0]);
   },

   findDuplicateJob(db, jobTableFields) {
      return db.select().from('customer_jobs').where('job_type_id', jobTableFields.job_type_id).andWhere('customer_id', jobTableFields.customer_id).andWhere('account_id', jobTableFields.account_id);
   },

   getSingleJob(db, customerJobID, accountID) {
      return db.select().from('customer_jobs').where('customer_job_id', customerJobID).andWhere('account_id', accountID);
   },

   getSingleJobType(db, jobTypeID, accountID) {
      return db.select().from('customer_jobs').where('job_type_id', jobTypeID).andWhere('account_id', accountID);
   },

   getActiveJobs(db, accountID) {
      return db
         .select(
            'customer_jobs.*',
            'customer_job_types.*',
            'customer_job_categories.customer_job_category',
            db.raw('customers.display_name as customer_name'),
            db.raw('users.display_name as created_by_user')
         )
         .from('customer_jobs')
         .join('customer_job_types', 'customer_jobs.job_type_id', 'customer_job_types.job_type_id')
         .join('customer_job_categories', 'customer_job_types.customer_job_category_id', 'customer_job_categories.customer_job_category_id')
         .join('customers', 'customer_jobs.customer_id', 'customers.customer_id')
         .join('users', 'customer_jobs.created_by_user_id', 'users.user_id')
         .where('customer_jobs.account_id', accountID)
         .orderBy('customer_jobs.created_at', 'asc');
   },

   // !! Must be in asc order, oldest to newest.
   getActiveCustomerJobs(db, accountID, customerID) {
      return db
         .select()
         .from('customer_jobs')
         .where('customer_jobs.account_id', accountID)
         .andWhere('customer_jobs.customer_id', customerID)
         .join('customer_job_types', 'customer_jobs.job_type_id', 'customer_job_types.job_type_id')
         .join('customer_job_categories', 'customer_job_types.customer_job_category_id', 'customer_job_categories.customer_job_category_id')
         .orderBy('customer_jobs.created_at', 'asc');
   },

   updateJob(db, updatedJob, accountId) {
      return db.update(updatedJob).into('customer_jobs').where('customer_job_id', '=', updatedJob.customer_job_id).andWhere('account_id', accountId);
   },

   // Toggle job family completion status
   toggleJobCompletion(db, jobTableFields, accountId) {
      const { is_job_complete, customer_job_id, parent_job_id } = jobTableFields;
      const familyId = parent_job_id || customer_job_id;
      return db('customer_jobs')
         .where('account_id', accountId)
         .andWhere(builder => builder.where('customer_job_id', familyId).orWhere('parent_job_id', familyId))
         .update({ is_job_complete });
   },

   /**
    * Resolves every customer_job_id in a job's version family: the root
    * (parent_job_id IS NULL) plus every version row updateRecentJobTotal
    * inserted on a total change (parent_job_id = root). Works whether jobID
    * passed in IS the root or a later version's id. Returns [] when jobID
    * isn't found for this account.
    * @param {*} db
    * @param {*} jobID
    * @param {*} accountID
    * @returns {Promise<number[]>}
    */
   async getJobFamilyIds(db, jobID, accountID) {
      const target = await db.select('customer_job_id', 'parent_job_id').from('customer_jobs').where('customer_job_id', jobID).andWhere('account_id', accountID).first();
      if (!target) return [];

      const rootId = target.parent_job_id || target.customer_job_id;
      const family = await db
         .select('customer_job_id')
         .from('customer_jobs')
         .where('account_id', accountID)
         .andWhere(builder => builder.where('customer_job_id', rootId).orWhere('parent_job_id', rootId));

      return family.map(row => row.customer_job_id);
   },

   // Deletes every row in a job's version family (root + prior versions).
   // Callers must confirm nothing references ANY row in the family first -
   // see getJobFamilyIds and the deleteJob route handler.
   deleteJobFamily(db, jobIDs, accountId) {
      if (!jobIDs || !jobIDs.length) return Promise.resolve(0);
      return db('customer_jobs').where('account_id', accountId).whereIn('customer_job_id', jobIDs).del();
   },

   /**
    * !! Must be in desc order, newest to oldest. to select most recent job.
    * Does not include the customer_job_id, and created_at fields, used for updating/creating a new job record.
    * @param {*} db
    * @param {*} jobId
    * @returns
    */
   getRecentJob(db, jobId, accountID) {
      return db
         .select(
            'parent_job_id',
            'account_id',
            'customer_id',
            'job_type_id',
            'job_quote_amount',
            'agreed_job_amount',
            'current_job_total',
            'job_status',
            'is_job_complete',
            'is_quote',
            'created_by_user_id',
            'notes'
         )
         .from('customer_jobs')
         .where('customer_job_id', jobId)
         .andWhere('account_id', accountID)
         .orderBy('created_at', 'desc')
         .limit(1)
         .first();
   }
};

module.exports = jobService;
