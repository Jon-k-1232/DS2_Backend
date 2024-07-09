const jobTypeService = {
   createJobType(db, newJobType) {
      return db
         .insert(newJobType)
         .into('customer_job_types')
         .returning('*')
         .then(rows => rows[0]);
   },

   getJobTypesByJobCategoryID(db, accountID, jobCategoryID) {
      return db.select().from('customer_job_types').where('account_id', accountID).andWhere('customer_job_category_id', jobCategoryID);
   },

   getSingleJobType(db, jobTypeID, account) {
      return db.select().from('customer_job_types').where('job_type_id', jobTypeID).andWhere('account_id', account);
   },

   getActiveJobTypes(db, accountID) {
      return db
         .select('customer_job_types.*', 'customer_job_categories.customer_job_category')
         .from('customer_job_types')
         .leftJoin('customer_job_categories', 'customer_job_types.customer_job_category_id', 'customer_job_categories.customer_job_category_id')
         .where('customer_job_types.account_id', accountID)
         .orderBy('job_description', 'asc');
   },

   updateJobType(db, updatedJobType) {
      return db.update(updatedJobType).into('customer_job_types').where('job_type_id', '=', updatedJobType.job_type_id);
   },

   deleteJobType(db, jobTypeID) {
      return db.del().from('customer_job_types').where('job_type_id', '=', jobTypeID);
   }
};

module.exports = jobTypeService;
