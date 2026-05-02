// Captures every reviewer edit to an AI-applied transaction so the AI can learn
// from manual corrections to ANY field (customer, job, billable, work description, etc.).
// The older ai_category_training_examples table only covers work-description changes;
// this table is broader and is the source for richer few-shot examples.

const TABLE = 'ai_reviewer_corrections';

const _stringify = v => {
   if (v === null || v === undefined) return null;
   if (typeof v === 'boolean') return v ? 'true' : 'false';
   return String(v);
};

const insert = (db, {
   accountId,
   transactionId = null,
   timesheetEntryId = null,
   reviewerUserId = null,
   fieldName,
   originalValue,
   finalValue,
   originalLabel = null,
   finalLabel = null,
   sanitizedNotes = null
}) => {
   if (!accountId || !fieldName) return Promise.resolve(null);
   return db(TABLE).insert({
      account_id: accountId,
      transaction_id: transactionId,
      timesheet_entry_id: timesheetEntryId,
      reviewer_user_id: reviewerUserId,
      field_name: fieldName,
      original_value: _stringify(originalValue),
      final_value: _stringify(finalValue),
      original_label: originalLabel,
      final_label: finalLabel,
      sanitized_notes: sanitizedNotes
   }).returning('*').then(rows => rows[0]);
};

const recentByField = (db, accountId, fieldName, limit = 10) =>
   db(TABLE)
      .where({ account_id: accountId, field_name: fieldName })
      .whereNotNull('sanitized_notes')
      .orderBy('created_at', 'desc')
      .limit(limit);

module.exports = {
   insert,
   recentByField
};
