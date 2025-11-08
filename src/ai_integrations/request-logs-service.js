const TABLE = 'ai_request_logs';

const safeJson = obj => {
   try {
      return JSON.stringify(obj);
   } catch {
      return '[]';
   }
};

const requestLogsService = {
   async insertLog(db, log) {
      const now = db.raw('NOW()');
      const payload = { ...log, created_at: now, updated_at: now };
      const [row] = await db(TABLE).insert(payload).returning('*');
      return row;
   },

   async markCompleted(db, requestId) {
      const [row] = await db(TABLE)
         .where({ request_id: requestId })
         .update({ status: 'completed', completed_at: db.raw('NOW()'), updated_at: db.raw('NOW()') })
         .returning('*');
      return row;
   },

   async markFailed(db, requestId, errorMessage) {
      const [row] = await db(TABLE)
         .where({ request_id: requestId })
         .update({ status: 'failed', error_message: errorMessage?.toString().slice(0, 2000) || null, completed_at: db.raw('NOW()'), updated_at: db.raw('NOW()') })
         .returning('*');
      return row;
   }
};

module.exports = requestLogsService;
