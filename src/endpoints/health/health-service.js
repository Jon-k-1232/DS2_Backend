const healthService = {
   dbStatus(db) {
      return db.select('customer_job_id').from('customer_jobs').first();
   }
};
module.exports = healthService;
