const TABLE_NAME = 'ai_time_tracker_transaction_suggestions';

// Safely coerce any input into a JSON-serializable object for jsonb columns
const toJsonb = value => {
   if (value === undefined || value === null) return null;
   if (typeof value === 'string') {
      try {
         return JSON.parse(value);
      } catch (e) {
         return { raw_text: value };
      }
   }
   if (typeof value === 'object') return value;
   // Fallback wrapper for primitives
   return { value };
};

const normalizeSuggestion = suggestion => {
   if (!suggestion || typeof suggestion !== 'object') {
      throw new Error('Suggestion payload must be an object.');
   }

   const base = {
      account_id: suggestion.account_id,
      timesheet_entry_id: suggestion.timesheet_entry_id,
      sanitized_notes: suggestion.sanitized_notes || '',
      suggested_category: suggestion.suggested_category || null,
      suggested_job_category_id: suggestion.suggested_job_category_id || null,
      suggested_job_type_id: suggestion.suggested_job_type_id || null,
      suggested_general_work_description_id: suggestion.suggested_general_work_description_id || null,
      ai_confidence: suggestion.ai_confidence || null,
      ai_reason: suggestion.ai_reason || null,
      ai_payload: toJsonb(suggestion.ai_payload),
      status: suggestion.status || 'pending',
      source: suggestion.source || 'ai'
   };

   if (!base.account_id) {
      throw new Error('Suggestion payload is missing account_id.');
   }

   if (!base.timesheet_entry_id) {
      throw new Error('Suggestion payload is missing timesheet_entry_id.');
   }

   if (base.sanitized_notes === undefined || base.sanitized_notes === null) {
      throw new Error('Suggestion payload is missing sanitized_notes.');
   }

   return base;
};

const timesheetSuggestionsService = {
   /**
    * Upsert one or many suggestions.
    * @param {*} db - Knex instance
    * @param {Array<Object>} suggestions
    * @returns {Promise<Array>}
    */
   async upsertSuggestions(db, suggestions) {
      if (!Array.isArray(suggestions) || !suggestions.length) {
         return [];
      }

      const normalizedSuggestions = suggestions.map(normalizeSuggestion);
      const now = db.raw('NOW()');

      // Two-phase upsert that does not require a unique index
      const ids = normalizedSuggestions.map(s => s.timesheet_entry_id);

      const existingRows = await db(TABLE_NAME).select('timesheet_entry_id').whereIn('timesheet_entry_id', ids);

      const existingIds = new Set(existingRows.map(r => r.timesheet_entry_id));
      const toUpdate = normalizedSuggestions.filter(s => existingIds.has(s.timesheet_entry_id));
      const toInsert = normalizedSuggestions.filter(s => !existingIds.has(s.timesheet_entry_id));

      // On update: do NOT overwrite status/source here to preserve 'processing' until final markStatus()
      const updated = await Promise.all(
         toUpdate.map(s => {
            const updateFields = {
               sanitized_notes: s.sanitized_notes,
               suggested_category: s.suggested_category,
               suggested_job_category_id: s.suggested_job_category_id,
               suggested_job_type_id: s.suggested_job_type_id,
               suggested_general_work_description_id: s.suggested_general_work_description_id,
               ai_confidence: s.ai_confidence,
               ai_reason: s.ai_reason,
               ai_payload: toJsonb(s.ai_payload),
               updated_at: now
            };
            return db(TABLE_NAME).where({ timesheet_entry_id: s.timesheet_entry_id }).update(updateFields).returning('*');
         })
      ).then(nested => nested.flat());

      let inserted = [];
      if (toInsert.length) {
         inserted = await db(TABLE_NAME)
            .insert(
               toInsert.map(row => ({
                  ...row,
                  created_at: now,
                  updated_at: now
               }))
            )
            .returning('*');
      }

      return [...updated, ...inserted];
   },

   /**
    * Fetch suggestions by account and entry IDs.
    * @param {*} db
    * @param {number} accountId
    * @param {number[]} timesheetEntryIds
    * @returns {Promise<Array>}
    */
   getSuggestionsForEntries(db, accountId, timesheetEntryIds = []) {
      if (!Array.isArray(timesheetEntryIds) || !timesheetEntryIds.length) {
         return Promise.resolve([]);
      }

      return db(TABLE_NAME).where({ account_id: accountId }).whereIn('timesheet_entry_id', timesheetEntryIds);
   },

   /**
    * Remove suggestions by entry IDs.
    * @param {*} db
    * @param {number[]} timesheetEntryIds
    * @returns {Promise<number>}
    */
   deleteByEntryIds(db, timesheetEntryIds = []) {
      if (!Array.isArray(timesheetEntryIds) || !timesheetEntryIds.length) {
         return Promise.resolve(0);
      }

      return db(TABLE_NAME).whereIn('timesheet_entry_id', timesheetEntryIds).del();
   },

   /**
    * Update suggestion status/details for a single entry.
    * @param {*} db
    * @param {number} timesheetEntryId
    * @param {{ status?: string, ai_reason?: string, ai_confidence?: number }} payload
    * @returns {Promise<Object|null>}
    */
   updateSuggestion(db, timesheetEntryId, payload = {}) {
      if (!timesheetEntryId) {
         return Promise.resolve(null);
      }

      const updates = { ...payload, updated_at: db.raw('NOW()') };

      return db(TABLE_NAME)
         .where({ timesheet_entry_id: timesheetEntryId })
         .update(updates)
         .returning('*')
         .then(rows => rows[0] || null);
   }
};

module.exports = timesheetSuggestionsService;
