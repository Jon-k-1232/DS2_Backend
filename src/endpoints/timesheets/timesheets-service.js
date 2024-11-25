const timesheetsService = {
   getOutstandingTimesheetEntries(db, accountID) {
      return db.select().from('timesheet_entries').where('account_id', accountID).andWhere('is_processed', false).andWhere('is_deleted', false);
   },

   getOutstandingTimesheetErrors(db, accountID) {
      return db.select().from('timesheet_errors').where('account_id', accountID).andWhere('is_resolved', false);
   },

   getSingleTimesheetEntry(db, accountID, entryID) {
      return db.select().from('timesheet_entries').where('timesheet_entry_id', entryID).andWhere('account_id', accountID).first();
   },

   getSingleTimesheetError(db, accountID, timesheetErrorID) {
      return db.select().from('timesheet_errors').where('timesheet_error_id', timesheetErrorID).andWhere('account_id', accountID).first();
   },

   getUnresolvedErrorsByTimesheetNames(trx, accountID, timesheetNames) {
      return trx('timesheet_errors').where('account_id', accountID).whereIn('timesheet_name', timesheetNames).andWhere('is_resolved', false);
   },

   updateTimesheetEntry(db, timesheetEntry) {
      return db.update(timesheetEntry).into('timesheet_entries').where('timesheet_entry_id', timesheetEntry.timesheet_entry_id);
   },

   updateTimesheetError(db, timesheetError) {
      return db.update(timesheetError).into('timesheet_errors').where('timesheet_error_id', timesheetError.timesheet_error_id);
   },

   insertTimesheetEntriesWithTransaction(trx, entries) {
      if (!entries.length) return Promise.resolve([]);
      return trx('timesheet_entries').insert(entries).returning('*');
   },

   insertTimesheetErrorsWithTransaction(trx, errors) {
      if (!errors.length) return Promise.resolve([]);
      return trx('timesheet_errors').insert(errors).returning('*');
   },

   batchUpdateTimesheetErrors(trx, errorIds, updateFields) {
      if (!errorIds.length) return Promise.resolve([]);
      return trx('timesheet_errors').whereIn('timesheet_error_id', errorIds).update(updateFields);
   }
};

module.exports = timesheetsService;
