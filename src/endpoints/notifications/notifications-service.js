const NOTIFICATION_TYPES = Object.freeze({
   TRACKER_UPLOAD_PROCESSED: 'tracker_upload_processed',
   ROWS_HELD_FOR_REVIEW: 'rows_held_for_review',
   NEW_CUSTOMER_NEEDS_ADDITION: 'new_customer_needs_addition',
   AI_PROCESSING_FAILED: 'ai_processing_failed'
});

const insertNotification = async (db, { accountId, userId, type, title, body = null, payload = {}, expiresAt = null }) => {
   if (!accountId || !userId || !type || !title) {
      throw new Error('accountId, userId, type, and title are required');
   }
   const [row] = await db('notifications')
      .insert({
         account_id: accountId,
         user_id: userId,
         type,
         title,
         body,
         payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
         expires_at: expiresAt
      })
      .returning('*');
   return row;
};

const insertForUsers = async (db, { accountId, userIds, type, title, body = null, payload = {}, expiresAt = null }) => {
   if (!Array.isArray(userIds) || !userIds.length) return [];
   const now = new Date();
   const rows = userIds.map(uid => ({
      account_id: accountId,
      user_id: uid,
      type,
      title,
      body,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      expires_at: expiresAt,
      created_at: now
   }));
   return db('notifications').insert(rows).returning('*');
};

const listForUser = async (db, accountId, userId, { unreadOnly = false, limit = 30 } = {}) => {
   let query = db('notifications')
      .where({ account_id: accountId, user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 30, 200));
   if (unreadOnly) query = query.whereNull('read_at');
   query = query.where(qb => qb.whereNull('expires_at').orWhere('expires_at', '>', new Date()));
   return query;
};

const unreadCount = async (db, accountId, userId) => {
   const [{ count }] = await db('notifications')
      .where({ account_id: accountId, user_id: userId })
      .whereNull('read_at')
      .where(qb => qb.whereNull('expires_at').orWhere('expires_at', '>', new Date()))
      .count({ count: '*' });
   return Number(count || 0);
};

const markRead = async (db, accountId, userId, notificationId) => {
   const updated = await db('notifications')
      .where({ account_id: accountId, user_id: userId, notification_id: notificationId })
      .update({ read_at: new Date() })
      .returning('*');
   return updated && updated[0];
};

const markAllRead = async (db, accountId, userId) => {
   await db('notifications')
      .where({ account_id: accountId, user_id: userId })
      .whereNull('read_at')
      .update({ read_at: new Date() });
};

module.exports = {
   NOTIFICATION_TYPES,
   insertNotification,
   insertForUsers,
   listForUser,
   unreadCount,
   markRead,
   markAllRead
};
