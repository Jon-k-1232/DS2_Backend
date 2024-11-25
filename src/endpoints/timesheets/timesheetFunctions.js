const timesheetsService = require('./timesheets-service');

/**
 * Inserts new timesheet entries into the database
 */
const handleNewEntriesWithTransaction = async (trx, timesheetEntries) => {
   if (timesheetEntries.length > 0) {
      return timesheetsService.insertTimesheetEntriesWithTransaction(trx, timesheetEntries);
   }
   return [];
};

/**
 * Inserts new timesheet errors into the database
 */
const handleNewErrorsWithTransaction = async (trx, timesheetErrors) => {
   if (timesheetErrors.length > 0) {
      return timesheetsService.insertTimesheetErrorsWithTransaction(trx, timesheetErrors);
   }
   return [];
};

/**
 * Resolves timesheet errors with matching timesheet names
 */
const resolveMatchingErrorsWithTransaction = async (trx, accountID, timesheetEntries) => {
   if (timesheetEntries.length === 0) return;
   const uniqueTimesheetNames = Array.from(new Set(timesheetEntries.map(entry => entry.timesheet_name)));
   // Query the database for matching unresolved errors
   const matchingErrors = await timesheetsService.getUnresolvedErrorsByTimesheetNames(trx, accountID, uniqueTimesheetNames);
   if (matchingErrors.length === 0) return;
   const resolvedErrorIds = matchingErrors.map(error => error.timesheet_error_id);
   // Batch update the matching errors to resolved
   await timesheetsService.batchUpdateTimesheetErrors(trx, resolvedErrorIds, { is_resolved: true });
   return;
};

/**
 * Fetches outstanding timesheet entries and errors from the database
 */
const fetchOutstandingData = async (db, accountID) => {
   const [outstandingTimesheetEntries, outstandingTimesheetErrors] = await Promise.all([
      timesheetsService.getOutstandingTimesheetEntries(db, accountID),
      timesheetsService.getOutstandingTimesheetErrors(db, accountID)
   ]);

   return { outstandingTimesheetEntries, outstandingTimesheetErrors };
};

module.exports = {
   handleNewEntriesWithTransaction,
   handleNewErrorsWithTransaction,
   resolveMatchingErrorsWithTransaction,
   fetchOutstandingData
};
