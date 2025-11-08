const TABLE = 'ai_category_training_examples';

const toRow = example => ({
   account_id: example.account_id,
   timesheet_entry_id: example.timesheet_entry_id || null,
   transaction_id: example.transaction_id || null,
   original_category: example.original_category || null,
   suggested_category: example.suggested_category || null,
   final_category: example.final_category,
   ai_reason: example.ai_reason || null,
   ai_confidence: example.ai_confidence == null ? null : Number(example.ai_confidence),
   ai_source: example.ai_source || 'ai',
   original_notes: example.original_notes || null,
   sanitized_notes: example.sanitized_notes || null,
   duration_minutes: example.duration_minutes == null ? null : Number(example.duration_minutes),
   entity: example.entity || null,
   uploaded_to_vector_store: Boolean(example.uploaded_to_vector_store) || false,
   uploaded_at: example.uploaded_at || null,
   created_at: new Date(),
   updated_at: new Date()
});

module.exports = {
   insert(db, example) {
      const row = toRow(example);
      return db(TABLE)
         .insert(row)
         .returning('*')
         .then(rows => rows[0]);
   },

   bulkInsert(db, examples = []) {
      if (!examples.length) return Promise.resolve([]);
      return db(TABLE).insert(examples.map(toRow)).returning('*');
   },

   markUploaded(db, accountId, trainingIds = [], uploadedAt = new Date()) {
      if (!trainingIds.length) return Promise.resolve(0);
      return db(TABLE)
         .where({ account_id: accountId })
         .whereIn('training_id', trainingIds)
         .update({ uploaded_to_vector_store: true, uploaded_at: uploadedAt, updated_at: db.raw('NOW()') });
   },

   getUnuploadedSince(db, accountId, sinceDate) {
      const query = db(TABLE).where({ account_id: accountId, uploaded_to_vector_store: false });
      if (sinceDate) {
         query.andWhere('created_at', '>=', sinceDate);
      }
      return query.orderBy('created_at', 'asc');
   }
};
