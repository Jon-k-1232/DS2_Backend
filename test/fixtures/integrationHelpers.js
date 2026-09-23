/**
 * Shared helpers for the DB-backed integration specs (orchestrator, PII leak).
 * Side-effect free on require (the unit run loads every file under test/).
 *
 *   uploadTrackerBuffer — the upload route's persistence path minus HTTP/S3/email:
 *     real validateUploadedTracker -> same row normalization as the router ->
 *     advisory lock + duplicate plan -> insert, in one transaction.
 *   installStubbedAws   — Bedrock AND Comprehend clients replaced with local
 *     stubs so no test ever reaches AWS. Captures every Bedrock prompt.
 */
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { validateUploadedTracker } = require('../../src/timeTrackerValidation/validateUploadedTracker');
const { findTrackerDuplicates, lockTrackerUploads } = require('../../src/endpoints/timeTracking/trackerDuplicates');
const timesheetsService = require('../../src/endpoints/timesheets/timesheets-service');
const bedrock = require('../../src/ai_integrations/bedrock');
const comprehend = require('../../src/utils/comprehend');

dayjs.extend(customParseFormat);

const CATEGORY_SYSTEM_PREFIX = 'You categorize one timesheet entry';
const CUSTOMER_MATCH_SYSTEM_PREFIX = 'You match a free-text customer name';
const SEED_GWD_ID = 90031;
const VAGUE_NOTES = new Set(['work', 'misc', '?', '']);

const _iso = (value, format) => dayjs(value, format, true).format('YYYY-MM-DD');
const _nullable = value => (value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim());

const uploadTrackerBuffer = async (db, { accountId, ownerUserId, fileBuffer, timesheetName, today }) => {
   const validation = await validateUploadedTracker({ db, accountID: accountId, userID: ownerUserId, fileBuffer, originalFileName: timesheetName, today });
   if (validation.errors.length) {
      const err = new Error(`tracker failed validation:\n${validation.errors.join('\n')}`);
      err.validation = validation;
      throw err;
   }
   const meta = validation.metadata;
   const rows = validation.entries.map(entry => ({
      account_id: accountId,
      user_id: ownerUserId,
      employee_name: _nullable(entry.employee_name),
      timesheet_name: timesheetName,
      time_tracker_start_date: _iso(meta.startDate, 'MM-DD-YYYY'),
      time_tracker_end_date: _iso(meta.endDate, 'MM-DD-YYYY'),
      date: _iso(entry.date, 'MM/DD/YYYY'),
      entity: _nullable(entry.entity),
      category: _nullable(entry.category),
      company_name: _nullable(entry.company_name),
      first_name: _nullable(entry.first_name),
      last_name: _nullable(entry.last_name),
      duration: entry.duration,
      notes: entry.notes ? String(entry.notes).trim() : ''
   }));

   const trx = await db.transaction();
   try {
      await lockTrackerUploads(trx, ownerUserId);
      const plan = await findTrackerDuplicates(trx, {
         accountId,
         userId: ownerUserId,
         startDate: rows[0].time_tracker_start_date,
         endDate: rows[0].time_tracker_end_date,
         entries: rows,
         sourceRows: validation.entries.map(entry => entry.source_row)
      });
      let inserted = [];
      if (!plan.identicalUpload && plan.toInsertIndexes.length) {
         inserted = await timesheetsService.insertTimesheetEntriesWithTransaction(trx, plan.toInsertIndexes.map(i => rows[i]));
      }
      await trx.commit();
      return { validation, plan, inserted, entryIds: inserted.map(r => r.timesheet_entry_id) };
   } catch (err) {
      await trx.rollback();
      throw err;
   }
};

// Comprehend stand-in: flags street addresses (the one PII class the string
// fallback cannot catch) with real offsets, so the offset-replacement path in
// detectAndRedact is exercised too.
const _fakeComprehendEntities = text => {
   const entities = [];
   const re = /\d+ [A-Z][a-z]+ (?:St|Ave|Rd|Blvd)\b[^.;]*?\b[A-Z]{2} \d{5}/g;
   let match;
   while ((match = re.exec(text))) {
      entities.push({ Type: 'ADDRESS', BeginOffset: match.index, EndOffset: match.index + match[0].length, Score: 0.99 });
   }
   return entities;
};

/**
 * @param {{ categoryConfidence?: number, vagueConfidence?: number }} [options]
 * @returns {{ prompts: Array<{system:string, text:string}>, categoryPrompts: () => object[], customerMatchPrompts: () => object[] }}
 */
const installStubbedAws = ({ categoryConfidence = 0.92, vagueConfidence = 0.5 } = {}) => {
   const prompts = [];
   bedrock._setClientsForTest({
      bedrockClient: {
         send: async command => {
            const body = JSON.parse(command.input.body);
            const system = String(body.system || '');
            const text = (body.messages || []).map(m => (m.content || []).map(c => c.text || '').join('\n')).join('\n');
            prompts.push({ system, text });
            let json;
            if (system.startsWith(CUSTOMER_MATCH_SYSTEM_PREFIX)) {
               json = { match_id: null, match_confidence: 0, reason: 'stub: no tiebreak' };
            } else {
               let notes = '';
               try {
                  notes = String(JSON.parse(text.split('\n')[1] || '{}').notes || '').trim().toLowerCase();
               } catch (e) {
                  notes = '';
               }
               json = {
                  suggested_general_work_description_id: SEED_GWD_ID,
                  suggested_job_category_id: 90001,
                  suggested_job_type_id: 900201,
                  suggested_category_label: 'Tax Return Preparation',
                  category_confidence: VAGUE_NOTES.has(notes) ? vagueConfidence : categoryConfidence,
                  ai_reason: VAGUE_NOTES.has(notes) ? 'stub: notes too sparse' : 'stub: confident'
               };
            }
            return {
               body: Buffer.from(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 800, output_tokens: 80 } }))
            };
         }
      },
      s3Client: null
   });
   comprehend._setClientForTest({ send: async command => ({ Entities: _fakeComprehendEntities(command.input.Text || '') }) });
   return {
      prompts,
      categoryPrompts: () => prompts.filter(p => p.system.startsWith(CATEGORY_SYSTEM_PREFIX)),
      customerMatchPrompts: () => prompts.filter(p => p.system.startsWith(CUSTOMER_MATCH_SYSTEM_PREFIX))
   };
};

// Teardown: leave FAIL-CLOSED clients behind instead of nulling them (a null
// client makes the next caller lazily build a real AWS client). Bedrock calls
// fail as a non-retryable auth error; Comprehend failures fall back to the
// local string redactor.
const installFailClosedAws = () => {
   bedrock._setClientsForTest({
      bedrockClient: {
         send: async () => {
            throw new Error('AccessDeniedException: live Bedrock is disabled in tests');
         }
      },
      s3Client: null
   });
   comprehend._setClientForTest({
      send: async () => {
         throw new Error('live Comprehend is disabled in tests');
      }
   });
};

module.exports = { uploadTrackerBuffer, installStubbedAws, installFailClosedAws, CATEGORY_SYSTEM_PREFIX, CUSTOMER_MATCH_SYSTEM_PREFIX, SEED_GWD_ID };
