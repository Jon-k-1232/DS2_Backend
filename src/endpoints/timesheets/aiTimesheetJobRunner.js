const { generateSuggestionsForEntries } = require('./timesheet-suggestions-orchestrator');
const timesheetsService = require('./timesheets-service');
const timesheetSuggestionsService = require('./timesheet-suggestions-service');

const DEFAULT_BATCH_SIZE = Number(process.env.AI_TIMESHEET_BATCH_SIZE || 100);

const chunkArray = (arr, size) => {
   const chunks = [];
   for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
   return chunks;
};

// Mark entries as processing in suggestions table (create rows if missing)
const markProcessing = async (db, accountId, entryIds = []) => {
   if (!entryIds.length) return [];
   const now = new Date();
   const payload = entryIds.map(id => ({
      account_id: accountId,
      timesheet_entry_id: id,
      sanitized_notes: '',
      status: 'processing',
      source: 'ai'
   }));
   await timesheetSuggestionsService.upsertSuggestions(db, payload);
   return entryIds;
};

// Mark entries as completed (or failed)
const markStatus = async (db, entryIds = [], status = 'completed') => {
   if (!entryIds.length) return;
   await Promise.all(entryIds.map(id => timesheetSuggestionsService.updateSuggestion(db, id, { status })));
};

/**
 * Run AI categorization suggestions in the background for a set of entries.
 * @param {*} db
 * @param {number} accountId
 * @param {number} userId
 * @param {Array<Object>} entries - entries with at least timesheet_entry_id
 */
const runAiSuggestionsForEntries = async ({ db, accountId, userId, entries }) => {
   if (!Array.isArray(entries) || !entries.length) return;
   const entryIds = entries.map(e => e.timesheet_entry_id).filter(Boolean);
   const startDates = entries
      .map(e => e.time_tracker_start_date)
      .filter(Boolean)
      .sort();
   const endDates = entries
      .map(e => e.time_tracker_end_date)
      .filter(Boolean)
      .sort();
   const period = startDates.length && endDates.length ? `${String(startDates[0]).slice(0, 10)} to ${String(endDates[endDates.length - 1]).slice(0, 10)}` : 'unknown period';

   console.info(`[${new Date().toISOString()}] [AI] started: account=${accountId} user=${userId} entries=${entryIds.length} period=${period}`);

   // Set processing state first
   await markProcessing(db, accountId, entryIds);

   const batches = chunkArray(entries, DEFAULT_BATCH_SIZE);

   for (const batch of batches) {
      console.info(`[${new Date().toISOString()}] [AI] send: account=${accountId} user=${userId} batchSize=${batch.length}`);
      try {
         const inserted = await generateSuggestionsForEntries({ db, accountId, entries: batch, userId });
         console.info(`[${new Date().toISOString()}] [AI] processing: account=${accountId} user=${userId} batchProcessed=${batch.length}`);
         const completedIds = (inserted || []).map(r => r.timesheet_entry_id).filter(Boolean);
         await markStatus(db, completedIds, 'completed');
         console.info(`[${new Date().toISOString()}] [AI] done: account=${accountId} user=${userId} success count=${completedIds.length}`);
      } catch (err) {
         console.error(`[${new Date().toISOString()}] AI suggestions batch failed: ${err.message}`);
         const failedIds = batch.map(e => e.timesheet_entry_id).filter(Boolean);
         await markStatus(db, failedIds, 'failed');
         console.info(`[${new Date().toISOString()}] [AI] failure: account=${accountId} user=${userId} failed count=${failedIds.length}`);
      }
   }
};

/**
 * Kick off AI suggestions for a given timesheet name (single line call from controller).
 * Returns immediately and processes in the background.
 */
const kickOffAiSuggestionsForTimesheet = ({ db, accountId, userId, timesheetName }) => {
   if (!db || !accountId || !userId || !timesheetName) return;
   setImmediate(async () => {
      try {
         const entries = await timesheetsService.getEntriesByTimesheetName(db, accountId, userId, timesheetName);
         await runAiSuggestionsForEntries({ db, accountId, userId, entries });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Failed to run AI suggestions for timesheet ${timesheetName}: ${err.message}`);
      }
   });
};

/**
 * Kick off AI suggestions for specific entry IDs. Returns immediately.
 */
const kickOffAiSuggestionsForEntryIds = ({ db, accountId, userId, entryIds = [] }) => {
   if (!db || !accountId || !userId || !Array.isArray(entryIds) || !entryIds.length) return;
   setImmediate(async () => {
      try {
         const entries = await timesheetsService.getTimesheetEntriesByIds(db, accountId, entryIds);
         await runAiSuggestionsForEntries({ db, accountId, userId, entries });
      } catch (err) {
         console.error(`[${new Date().toISOString()}] Failed to run AI suggestions for entries: ${err.message}`);
      }
   });
};

module.exports = {
   kickOffAiSuggestionsForTimesheet,
   kickOffAiSuggestionsForEntryIds,
   runAiSuggestionsForEntries
};
