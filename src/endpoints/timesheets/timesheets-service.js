const timesheetsService = {
   getOutstandingTimesheetEntries(db, accountID, limit, offset) {
      return db.select().from('timesheet_entries').where('account_id', accountID).andWhere('is_processed', false).andWhere('is_deleted', false).limit(limit).offset(offset);
   },

   getInvalidTimesheets(db, accountID, limit, offset) {
      return db.select().from('invalid_timesheets').where('account_id', accountID).andWhere('is_resolved', false).limit(limit).offset(offset);
   },

   getOutstandingTimesheetErrors(db, accountID, limit, offset) {
      return db.select().from('timesheet_errors').where('account_id', accountID).andWhere('is_resolved', false).limit(limit).offset(offset);
   },

   getAllOutstandingTimesheetEntries(db, accountID) {
      return db.select().from('timesheet_entries').where('account_id', accountID).andWhere('is_processed', false).andWhere('is_deleted', false);
   },

   getAllOutstandingTimesheetErrors(db, accountID) {
      return db.select().from('timesheet_errors').where('account_id', accountID).andWhere('is_resolved', false);
   },

   getAllOutstandingInvalidTimesheets(db, accountID) {
      return db.select().from('invalid_timesheets').where('account_id', accountID).andWhere('is_resolved', false);
   },

   getSingleTimesheetEntry(db, accountID, entryID) {
      return db.select().from('timesheet_entries').where('timesheet_entry_id', entryID).andWhere('account_id', accountID).first();
   },

   updateTimesheetEntryStatus(db, timesheetID) {
      return db.update({ is_processed: true }).into('timesheet_entries').where('timesheet_entry_id', timesheetID);
   },

   getSingleTimesheetError(db, accountID, timesheetErrorID) {
      return db.select().from('timesheet_errors').where('timesheet_error_id', timesheetErrorID).andWhere('account_id', accountID).first();
   },

   getSingleInvalidTimesheet(db, accountID, invalidTimesheetID) {
      return db.select().from('invalid_timesheets').where('invalid_timesheet_id', invalidTimesheetID).andWhere('account_id', accountID).first();
   },

   getPendingTimesheetEntriesByUserID(db, accountID, queryUserID, limit, offset) {
      return db
         .select()
         .from('timesheet_entries')
         .where('account_id', accountID)
         .andWhere('user_id', queryUserID)
         .andWhere('is_processed', false)
         .andWhere('is_deleted', false)
         .limit(limit)
         .offset(offset);
   },

   getPendingTimesheetErrorsByUserID(db, accountID, queryUserID, limit, offset) {
      return db.select().from('timesheet_errors').where('account_id', accountID).andWhere('user_id', queryUserID).andWhere('is_resolved', false).limit(limit).offset(offset);
   },

   getOutstandingTimesheetEntriesCount(db, accountID) {
      return db
         .select()
         .from('timesheet_entries')
         .where('account_id', accountID)
         .andWhere('is_processed', false)
         .andWhere('is_deleted', false)
         .count('* as count')
         .first()
         .then(result => parseInt(result.count, 10));
   },

   getOutstandingTimesheetErrorsCount(db, accountID) {
      return db
         .select()
         .from('timesheet_errors')
         .where('account_id', accountID)
         .andWhere('is_resolved', false)
         .count('* as count')
         .first()
         .then(result => parseInt(result.count, 10));
   },

   getInvalidTimesheetsCount(db, accountID) {
      return db
         .select()
         .from('invalid_timesheets')
         .where('account_id', accountID)
         .andWhere('is_resolved', false)
         .count('* as count')
         .first()
         .then(result => parseInt(result.count, 10));
   },

   getTimesheetEntryCountsByEmployee(db, accountID, user_id) {
      return db('timesheet_entries')
         .where('account_id', accountID)
         .andWhere('user_id', user_id)
         .andWhere('is_processed', false)
         .andWhere('is_deleted', false)
         .count('* as count')
         .first()
         .then(result => (result && result.count ? parseInt(result.count, 10) : 0));
   },

   getTimesheetErrorCountsByEmployee(db, accountID, user_id) {
      return db('timesheet_errors')
         .where('account_id', accountID)
         .andWhere('user_id', user_id)
         .andWhere('is_resolved', false)
         .count('* as count')
         .first()
         .then(result => (result && result.count ? parseInt(result.count, 10) : 0));
   },

   getUniqueTimesheetNamesByEmployee(db, accountID, user_id) {
      return db('timesheet_entries').where('account_id', accountID).andWhere('user_id', user_id).andWhere('is_deleted', false).distinct('timesheet_name').pluck('timesheet_name');
   },

   getInvalidTimesheetCountsByEmployee(db, accountID) {
      return db('invalid_timesheets')
         .where('account_id', accountID)
         .andWhere('is_resolved', false)
         .count('* as count')
         .first()
         .then(result => (result && result.count ? parseInt(result.count, 10) : 0));
   },

   getOutstandingTimesheetEntriesCountByUserID(db, accountID, queryUserID) {
      return db
         .select()
         .from('timesheet_entries')
         .where('account_id', accountID)
         .andWhere('user_id', queryUserID)
         .andWhere('is_processed', false)
         .andWhere('is_deleted', false)
         .count('* as count')
         .first()
         .then(result => parseInt((result && result.count) || 0, 10));
   },

   getEmployeeTimesheetsByUserID(db, accountID, queryUserID, limit, offset) {
      return db
         .select()
         .from('timesheet_entries')
         .where('account_id', accountID)
         .andWhere('user_id', queryUserID)
         .andWhere('is_processed', false)
         .andWhere('is_deleted', false)
         .orderBy('timesheet_name')
         .limit(limit)
         .offset(offset);
   },

   getTimesheetSummariesByUser(db, accountID, userId, limit, offset) {
      return db
         .with('ranked_entries', qb => {
            qb.select(
               'te.timesheet_entry_id',
               'te.account_id',
               'te.user_id',
               'te.employee_name',
               'te.timesheet_name',
               'te.time_tracker_start_date',
               'te.time_tracker_end_date',
               'te.created_at',
               db.raw('ROW_NUMBER() OVER (PARTITION BY te.timesheet_name ORDER BY te.created_at DESC) as rn')
            )
               .from('timesheet_entries as te')
               .where('te.account_id', accountID)
               .andWhere('te.user_id', userId)
               .andWhere('te.is_deleted', false);
         })
         .select('*')
         .from('ranked_entries')
         .where('rn', 1)
         .orderBy('created_at', 'desc')
         .limit(limit)
         .offset(offset);
   },

   getTimesheetSummariesCountByUser(db, accountID, userId) {
      return db('timesheet_entries')
         .where('account_id', accountID)
         .andWhere('user_id', userId)
         .andWhere('is_deleted', false)
         .countDistinct('timesheet_name as count')
         .first()
         .then(result => parseInt((result && result.count) || 0, 10));
   },

   getTimesheetSummariesByUserAndMonth(db, accountID, userId, monthQuery, limit, offset) {
      return db
         .with('ranked_entries', qb => {
            qb.select(
               'te.timesheet_entry_id',
               'te.account_id',
               'te.user_id',
               'te.employee_name',
               'te.timesheet_name',
               'te.time_tracker_start_date',
               'te.time_tracker_end_date',
               'te.created_at',
               db.raw('ROW_NUMBER() OVER (PARTITION BY te.timesheet_name ORDER BY te.created_at DESC) as rn')
            )
               .from('timesheet_entries as te')
               .where('te.account_id', accountID)
               .andWhere('te.user_id', userId)
               .andWhere('te.is_deleted', false)
               .andWhere('te.time_tracker_start_date', '>=', monthQuery.start)
               .andWhere('te.time_tracker_end_date', '<=', monthQuery.end);
         })
         .select('*')
         .from('ranked_entries')
         .where('rn', 1)
         .orderBy('created_at', 'desc')
         .limit(limit)
         .offset(offset);
   },

   getTimesheetSummariesCountByUserAndMonth(db, accountID, userId, monthQuery) {
      return db('timesheet_entries')
         .where('account_id', accountID)
         .andWhere('user_id', userId)
         .andWhere('is_deleted', false)
         .andWhere('time_tracker_start_date', '>=', monthQuery.start)
         .andWhere('time_tracker_end_date', '<=', monthQuery.end)
         .countDistinct('timesheet_name as count')
         .first()
         .then(result => parseInt((result && result.count) || 0, 10));
   },

   getUnresolvedErrorsByTimesheetNames(trx, accountID, timesheetNames) {
      return trx('timesheet_errors').where('account_id', accountID).whereIn('timesheet_name', timesheetNames).andWhere('is_resolved', false);
   },

   getUnresolvedInvalidTimesheetsByName(trx, accountID, timesheetNames) {
      return trx('invalid_timesheets').where('account_id', accountID).whereIn('timesheet_name', timesheetNames).andWhere('is_resolved', false);
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

   insertInvalidTimesheetsWithTransaction(trx, invalidTimesheets) {
      if (!invalidTimesheets.length) return Promise.resolve([]);
      return trx('invalid_timesheets').insert(invalidTimesheets).returning('*');
   },

   batchUpdateTimesheetErrors(trx, errorIds, updateFields) {
      if (!errorIds.length) return Promise.resolve([]);
      return trx('timesheet_errors').whereIn('timesheet_error_id', errorIds).update(updateFields);
   },

   batchUpdateInvalidTimesheets(trx, invalidIds, updateFields) {
      if (!invalidIds.length) return Promise.resolve([]);
      return trx('invalid_timesheets').whereIn('invalid_timesheet_id', invalidIds).update(updateFields);
   }
};

module.exports = timesheetsService;
