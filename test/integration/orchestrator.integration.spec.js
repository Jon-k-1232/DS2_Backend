/**
 * Integration test for the auto-ingest orchestrator against the dev DB.
 *
 * Skipped automatically if the dev DB isn't reachable. Uses a stubbed
 * Bedrock invoker so the test runs without AWS credentials and without
 * spending real model dollars. The pipeline's deterministic logic (matcher,
 * redactor, gate, transaction commits) is what we're verifying here.
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { processEntries, HOLD_REASONS } = require('../../src/endpoints/timesheets/auto-ingest-orchestrator');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'timetrackers');

const _readFixtureRows = async file => {
   const buf = fs.readFileSync(path.join(FIXTURE_DIR, file));
   const wb = new ExcelJS.Workbook();
   await wb.xlsx.load(buf);
   const sheet = wb.worksheets[0];
   const rows = [];
   sheet.eachRow((row, idx) => {
      if (idx < 6) return;
      rows.push({
         date: row.getCell(1).value && (row.getCell(1).value.toISOString ? row.getCell(1).value.toISOString().slice(0, 10) : String(row.getCell(1).value)),
         entity: row.getCell(2).value,
         category: row.getCell(3).value,
         employee_name: row.getCell(4).value,
         company_name: row.getCell(5).value || '',
         first_name: row.getCell(6).value || '',
         last_name: row.getCell(7).value || '',
         duration: Number(row.getCell(8).value || 0),
         notes: row.getCell(9).value || ''
      });
   });
   return rows;
};

const _seedTimesheetEntries = async (db, rows) => {
   const inserted = [];
   for (const r of rows) {
      const [row] = await db('timesheet_entries')
         .insert({
            account_id: TEST_ACCOUNT_ID,
            user_id: TEST_ADMIN_USER_ID,
            employee_name: r.employee_name,
            timesheet_name: 'integration_test_tracker.xlsx',
            time_tracker_start_date: '2026-04-27',
            time_tracker_end_date: '2026-05-03',
            date: r.date,
            entity: r.entity,
            category: r.category,
            company_name: r.company_name,
            first_name: r.first_name,
            last_name: r.last_name,
            duration: r.duration,
            notes: r.notes,
            is_processed: false,
            is_deleted: false
         })
         .returning('timesheet_entry_id');
      inserted.push(row.timesheet_entry_id || row);
   }
   return inserted;
};

const _stubBedrockInvoker = () => {
   const calls = [];
   return Object.assign(
      async ({ feature, modelId, messages }) => {
         calls.push({ feature, modelId });
         if (feature === 'customer_match') {
            return { json: { match_id: null, match_confidence: 0, reason: 'stub' }, cost: 0.0001, inputTokens: 50, outputTokens: 10 };
         }
         // Category inference: fake a plausible high-confidence answer
         // pointing at the seed account's first general work description (90031).
         return {
            json: {
               suggested_general_work_description_id: 90031,
               suggested_job_category_id: 90001,
               suggested_job_type_id: 900201,
               suggested_category_label: 'Tax Return Preparation',
               category_confidence: 0.92,
               ai_reason: 'integration test stub'
            },
            cost: 0.002,
            inputTokens: 800,
            outputTokens: 80
         };
      },
      { _calls: calls }
   );
};

describe('integration: auto-ingest orchestrator (dev DB, stubbed Bedrock)', function () {
   this.timeout(60_000);
   let db;

   before(async function () {
      db = await requireDb.call(this);
      await cleanupTestData(db);
   });

   after(async () => {
      if (db) await cleanupTestData(db);
      await closeDb();
   });

   it('processes the clean fixture: every row decides hold or auto_insert without dropping data', async () => {
      const rows = await _readFixtureRows('clean.xlsx');
      const entryIds = await _seedTimesheetEntries(db, rows);

      const bedrock = _stubBedrockInvoker();
      // Monkey-patch the orchestrator's Bedrock call by injecting via the
      // categoryInference + customerMatching modules. They both import
      // invokeBedrockClaude from ../bedrock; for integration we instead
      // override the global cached client. Simpler: re-export the modules
      // and pass our stub. orchestrator doesn't expose invoker injection
      // today, so we instead patch the bedrock module's cached client.
      const bedrockMod = require('../../src/ai_integrations/bedrock');
      bedrockMod._setClientsForTest({
         bedrockClient: {
            send: async () => {
               const stubResp = await bedrock({ feature: 'category_haiku', modelId: 'haiku' });
               const body = JSON.stringify({
                  content: [{ type: 'text', text: JSON.stringify(stubResp.json) }],
                  usage: { input_tokens: stubResp.inputTokens, output_tokens: stubResp.outputTokens }
               });
               return { body: Buffer.from(body) };
            }
         },
         s3Client: null
      });

      const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds });

      // Sanity: every seeded entry got a verdict.
      expect(result.processed).to.equal(entryIds.length);
      expect(result.autoInserted + result.held).to.equal(entryIds.length);

      // No row was dropped.
      const remaining = await db('timesheet_entries')
         .where({ account_id: TEST_ACCOUNT_ID })
         .whereIn('timesheet_entry_id', entryIds)
         .count({ count: '*' })
         .first();
      expect(Number(remaining.count)).to.equal(entryIds.length);
   });

   it('mixed fixture produces some holds with structured hold_reasons', async () => {
      const rows = await _readFixtureRows('mixed.xlsx');
      const entryIds = await _seedTimesheetEntries(db, rows);

      const bedrockMod = require('../../src/ai_integrations/bedrock');
      bedrockMod._setClientsForTest({
         bedrockClient: {
            send: async () => {
               const body = JSON.stringify({
                  content: [{ type: 'text', text: JSON.stringify({ suggested_general_work_description_id: 90031, suggested_job_category_id: 90001, suggested_job_type_id: 900201, suggested_category_label: 'Tax Return Preparation', category_confidence: 0.92, ai_reason: 'stub' }) }],
                  usage: { input_tokens: 800, output_tokens: 80 }
               });
               return { body: Buffer.from(body) };
            }
         },
         s3Client: null
      });

      const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds });

      // Mixed fixture has known messy rows: brand-new customer, unknown
      // employee, vague notes — at least some MUST be held.
      expect(result.held).to.be.greaterThan(0);

      const heldRows = await db('timesheet_entries')
         .where({ account_id: TEST_ACCOUNT_ID })
         .whereIn('timesheet_entry_id', entryIds)
         .whereNotNull('hold_reason')
         .select('hold_reason');
      const reasons = new Set(heldRows.map(r => r.hold_reason));
      // Every hold reason must be in the allowed enum.
      const allowed = new Set(Object.values(HOLD_REASONS));
      for (const r of reasons) {
         expect(allowed.has(r)).to.equal(true, `unknown hold_reason: ${r}`);
      }
   });
});
