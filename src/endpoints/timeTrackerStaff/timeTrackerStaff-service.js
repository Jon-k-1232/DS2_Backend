const listBaseQuery = (db, accountID) =>
   db('time_tracker_staff as tts')
      .join('users as u', 'u.user_id', 'tts.user_id')
      .select(
         'tts.id',
         'tts.user_id',
         'tts.is_active',
         'tts.created_at',
         'u.display_name',
         'u.email',
         'u.account_id'
      )
      .where('u.account_id', accountID)
      .orderBy('u.display_name', 'asc');

const filterToAccount = (db, accountID) =>
   db('users').select('user_id').where('account_id', accountID);

const timeTrackerStaffService = {
   listByAccount(db, accountID) {
      return listBaseQuery(db, accountID);
   },

   listActiveEmailsByAccount(db, accountID) {
      return db('time_tracker_staff as tts')
         .join('users as u', 'u.user_id', 'tts.user_id')
         .select('u.email')
         .where('tts.is_active', true)
         .andWhere('u.account_id', accountID)
         .andWhere('u.is_user_active', true);
   },

   async createMany(db, accountID, userIds) {
      const uniqueUserIds = Array.from(
         new Set((userIds || []).map(id => Number(id)).filter(id => Number.isFinite(id)))
      );

      if (!uniqueUserIds.length) return [];

      return db.transaction(async trx => {
         const allowedIds = await trx('users')
            .select('user_id')
            .where('account_id', accountID)
            .whereIn('user_id', uniqueUserIds);

         const validUserIds = allowedIds.map(row => row.user_id);
         if (!validUserIds.length) return [];

         const insertRows = validUserIds.map(user_id => ({ user_id, is_active: true }));

         await trx('time_tracker_staff')
            .insert(insertRows)
            .onConflict('user_id')
            .merge({ is_active: true });

         return listBaseQuery(trx, accountID);
      });
   },

   async updateStatus(db, accountID, staffID, isActive) {
      await db('time_tracker_staff as tts')
         .update({ is_active: !!isActive })
         .where('tts.id', staffID)
         .whereIn('tts.user_id', filterToAccount(db, accountID));

      return listBaseQuery(db, accountID);
   },

   async deleteById(db, accountID, staffID) {
      await db('time_tracker_staff as tts')
         .where('tts.id', staffID)
         .whereIn('tts.user_id', filterToAccount(db, accountID))
         .delete();

      return listBaseQuery(db, accountID);
   }
};

module.exports = timeTrackerStaffService;
