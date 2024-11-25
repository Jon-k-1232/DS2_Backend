const schedule = require('node-schedule');
const db = require('../db');
const timesheetOrchestrator = require('../endpoints/timesheets/timesheetProcessingLogic/timesheetOrchestrator');
const { handleNewEntriesWithTransaction, handleNewErrorsWithTransaction, resolveMatchingErrorsWithTransaction } = require('../endpoints/timesheets/timesheetFunctions');

const scheduledTimesheetsJob = async () => {
   // At 22:58 on every day-of-week from Monday through Friday
   schedule.scheduleJob('58 22 * * 1-5', async () => {
      console.log(`[${new Date().toISOString()}] Starting scheduled timesheets job.`);
      const accountID = 1;
      const trx = await db.transaction();
      try {
         // Process files to get timesheet entries and errors
         const { timesheetEntries, timesheetErrors } = await timesheetOrchestrator.processFiles();
         // Run the operations in parallel within the transaction
         await Promise.all([
            handleNewEntriesWithTransaction(trx, timesheetEntries),
            handleNewErrorsWithTransaction(trx, timesheetErrors),
            resolveMatchingErrorsWithTransaction(trx, accountID, timesheetEntries)
         ]);
         // Commit the transaction
         await trx.commit();
         console.log(`[${new Date().toISOString()}] Scheduled timesheets job completed successfully.`);
      } catch (err) {
         // Rollback the transaction on error
         await trx.rollback();
         console.error(`[${new Date().toISOString()}] Error processing timesheets: ${err.message}`);
         console.error(`[${new Date().toISOString()}] Scheduled job failed: ${err.message}`);
      }
   });
};

// Start the background jobs
const startJobs = async () => {
   await scheduledTimesheetsJob();
};

module.exports = {
   startJobs
};
