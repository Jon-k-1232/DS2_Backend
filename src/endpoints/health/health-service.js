const healthService = {
   // A true connectivity probe: SELECT 1 succeeds/fails purely on whether the
   // DB is reachable and query-able, independent of any table's contents (the
   // previous "SELECT customer_job_id FROM customer_jobs" could read as
   // healthy-but-empty for a brand new account with zero jobs, or fail for
   // reasons unrelated to connectivity, e.g. the table being renamed).
   async dbStatus(db) {
      await db.raw('SELECT 1');
      return true;
   }
};
module.exports = healthService;
