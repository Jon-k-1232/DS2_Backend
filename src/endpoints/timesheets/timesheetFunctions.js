const timesheetsService = require('./timesheets-service');

/**
 * Inserts new timesheet entries into the database
 */
const saveValidTimesheets = async (trx, timesheetEntries) => {
   if (timesheetEntries.length > 0) {
      return timesheetsService.insertTimesheetEntriesWithTransaction(trx, timesheetEntries);
   }
   return [];
};

/**
 * Inserts new timesheet errors into the database
 */
const saveValidTimesheetErrors = async (trx, timesheetsWithErrors) => {
   if (timesheetsWithErrors.length > 0) {
      return timesheetsService.insertTimesheetErrorsWithTransaction(trx, timesheetsWithErrors);
   }
   return [];
};

const saveInvalidTimesheetErrors = (trx, invalidTimesheets) => {
   if (invalidTimesheets.length > 0) {
      return timesheetsService.insertInvalidTimesheetsWithTransaction(trx, invalidTimesheets);
   }
   return [];
};

/**
 * Resolves timesheet errors with matching timesheet names
 */
const markTimesheetErrorsResolved = async (trx, accountID, timesheetEntries = [], invalidTimesheets = []) => {
   if (timesheetEntries.length === 0 && invalidTimesheets.length === 0) return;

   const uniqueTimesheetNames = Array.from(new Set(timesheetEntries.map(entry => entry.timesheet_name)));
   const uniqueInvalidTimesheetNames = Array.from(new Set(invalidTimesheets.map(entry => entry.timesheet_name)));

   // Combine unique names to ensure we query for all relevant timesheets
   const combinedTimesheetNames = Array.from(new Set([...uniqueTimesheetNames, ...uniqueInvalidTimesheetNames]));

   // Query the database for matching unresolved errors and invalid timesheets
   const [matchingErrors, unresolvedInvalidTimesheets] = await Promise.all([
      timesheetsService.getUnresolvedErrorsByTimesheetNames(trx, accountID, combinedTimesheetNames),
      timesheetsService.getUnresolvedInvalidTimesheetsByName(trx, accountID, combinedTimesheetNames)
   ]);

   const resolvedErrorIds = matchingErrors.map(error => error.timesheet_error_id);
   const resolvedInvalidIds = unresolvedInvalidTimesheets.map(invalid => invalid.invalid_timesheet_id);

   // Batch update matching errors and invalid timesheets to resolved
   if (resolvedErrorIds.length > 0) {
      await timesheetsService.batchUpdateTimesheetErrors(trx, resolvedErrorIds, { is_resolved: true });
      console.log(`[${new Date().toISOString()}] Marked ${resolvedErrorIds.length} timesheet errors as resolved.`);
   }

   if (resolvedInvalidIds.length > 0) {
      await timesheetsService.batchUpdateInvalidTimesheets(trx, resolvedInvalidIds, { is_resolved: true });
      console.log(`[${new Date().toISOString()}] Marked ${resolvedInvalidIds.length} invalid timesheets as resolved.`);
   }

   return;
};

module.exports = {
   saveValidTimesheets,
   saveValidTimesheetErrors,
   markTimesheetErrorsResolved,
   saveInvalidTimesheetErrors
};
