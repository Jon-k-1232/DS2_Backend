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

// Note: timesheet_errors flow removed; no-op helpers deleted.

module.exports = {
   saveValidTimesheets
};
