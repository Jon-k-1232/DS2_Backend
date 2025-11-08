const ENTRY_SAFE_COLUMNS = [
   'timesheet_entry_id',
   'account_id',
   'user_id',
   'employee_name',
   'timesheet_name',
   'time_tracker_start_date',
   'time_tracker_end_date',
   'date',
   'entity',
   'category',
   'company_name',
   'first_name',
   'last_name',
   'duration',
   'notes',
   'is_processed',
   'is_deleted',
   'created_at'
];

const timesheetsService = {
   getOutstandingTimesheetEntries(db, accountID, limit, offset) {
      return db('timesheet_entries').select(ENTRY_SAFE_COLUMNS).where('account_id', accountID).andWhere('is_processed', false).andWhere('is_deleted', false).limit(limit).offset(offset);
   },

   getAllOutstandingTimesheetEntries(db, accountID) {
      return db('timesheet_entries').select(ENTRY_SAFE_COLUMNS).where('account_id', accountID).andWhere('is_processed', false).andWhere('is_deleted', false);
   },

   getSingleTimesheetEntry(db, accountID, entryID) {
      return db('timesheet_entries').select(ENTRY_SAFE_COLUMNS).where('timesheet_entry_id', entryID).andWhere('account_id', accountID).first();
   },

   updateTimesheetEntryStatus(db, timesheetID) {
      return db.update({ is_processed: true }).into('timesheet_entries').where('timesheet_entry_id', timesheetID);
   },

   getPendingTimesheetEntriesByUserID(db, accountID, queryUserID, limit, offset) {
      return db('timesheet_entries')
         .select(ENTRY_SAFE_COLUMNS)
         .where('account_id', accountID)
         .andWhere('user_id', queryUserID)
         .andWhere('is_processed', false)
         .andWhere('is_deleted', false)
         .limit(limit)
         .offset(offset);
   },

   getEntriesByTimesheetName(db, accountID, userID, timesheetName) {
      return db('timesheet_entries')
         .select(ENTRY_SAFE_COLUMNS)
         .where({ account_id: accountID, user_id: userID, timesheet_name: timesheetName })
         .andWhere('is_deleted', false)
         .andWhere('is_processed', false);
   },

   getTimesheetEntriesByIds(db, accountID, entryIds = []) {
      if (!Array.isArray(entryIds) || !entryIds.length) return Promise.resolve([]);
      return db('timesheet_entries').select(ENTRY_SAFE_COLUMNS).where('account_id', accountID).whereIn('timesheet_entry_id', entryIds).andWhere('is_deleted', false).andWhere('is_processed', false);
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

   getAiProcessingCountsByEmployee(db, accountID, user_id) {
      return db('ai_time_tracker_transaction_suggestions as s')
         .join('timesheet_entries as te', 'te.timesheet_entry_id', 's.timesheet_entry_id')
         .where('s.account_id', accountID)
         .andWhere('te.user_id', user_id)
         .whereIn('s.status', ['processing', 'pending'])
         .andWhere('te.is_deleted', false)
         .andWhere('te.is_processed', false)
         .count('* as count')
         .first()
         .then(result => (result && result.count ? parseInt(result.count, 10) : 0));
   },

   getAiCompletedCountsByEmployee(db, accountID, user_id) {
      return db('ai_time_tracker_transaction_suggestions as s')
         .join('timesheet_entries as te', 'te.timesheet_entry_id', 's.timesheet_entry_id')
         .where('s.account_id', accountID)
         .andWhere('te.user_id', user_id)
         .whereIn('s.status', ['completed', 'applied'])
         .andWhere('te.is_deleted', false)
         .andWhere('te.is_processed', false)
         .count('* as count')
         .first()
         .then(result => (result && result.count ? parseInt(result.count, 10) : 0));
   },

   getAiFailedCountsByEmployee(db, accountID, user_id) {
      return db('ai_time_tracker_transaction_suggestions as s')
         .join('timesheet_entries as te', 'te.timesheet_entry_id', 's.timesheet_entry_id')
         .where('s.account_id', accountID)
         .andWhere('te.user_id', user_id)
         .andWhere('s.status', 'failed')
         .andWhere('te.is_deleted', false)
         .andWhere('te.is_processed', false)
         .count('* as count')
         .first()
         .then(result => (result && result.count ? parseInt(result.count, 10) : 0));
   },

   getUniqueTimesheetNamesByEmployee(db, accountID, user_id) {
      return db('timesheet_entries').where('account_id', accountID).andWhere('user_id', user_id).andWhere('is_deleted', false).distinct('timesheet_name').pluck('timesheet_name');
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
      return db('timesheet_entries')
         .select(ENTRY_SAFE_COLUMNS)
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

   updateTimesheetEntry(db, timesheetEntry) {
      return db.update(timesheetEntry).into('timesheet_entries').where('timesheet_entry_id', timesheetEntry.timesheet_entry_id);
   },

   insertTimesheetEntriesWithTransaction(trx, entries) {
      if (!entries.length) return Promise.resolve([]);
      return trx('timesheet_entries').insert(entries).returning('*');
   }
};

module.exports = timesheetsService;
