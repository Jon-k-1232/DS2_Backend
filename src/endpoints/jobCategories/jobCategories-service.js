const jobCategoriesService = {
  getActiveJobCategories(db, accountID) {
    return db.select().from('customer_job_categories').where('account_id', accountID).where('is_job_category_active', true);
  },

  getSingleJobCategory(db, jobCategoryID) {
    return db.select().from('customer_job_categories').where('customer_job_category_id', jobCategoryID);
  },

  createJobCategory(db, newJobCategory) {
    return db
      .insert(newJobCategory)
      .into('customer_job_categories')
      .returning('*')
      .then(rows => rows[0]);
  },

  updateJobCategory(db, updatedJobCategory) {
    return db
      .update(updatedJobCategory)
      .into('customer_job_categories')
      .where('customer_job_category_id', '=', updatedJobCategory.customer_job_category_id);
  },

  deleteJobCategory(db, jobCategoryID) {
    return db.delete().from('customer_job_categories').where('customer_job_category_id', '=', jobCategoryID);
  }
};

module.exports = jobCategoriesService;
