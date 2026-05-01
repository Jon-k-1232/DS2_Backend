/**
 * PII-leak invariant: after a full upload-through-orchestrator run, no
 * persisted artifact may contain a customer.business_name, customer.display_name,
 * or users.display_name that belongs to the test account.
 *
 * Persistence surfaces inspected:
 *   - timesheet_entries.ai_payload (jsonb)
 *   - ai_time_tracker_transaction_suggestions.ai_payload (jsonb)
 *   - ai_call_log.error_message (text)
 *
 * Skipped when the dev DB is unreachable.
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { processEntries } = require('../../src/endpoints/timesheets/auto-ingest-orchestrator');
const { containsAnyName, _knownNamesFromCatalogs } = require('../../src/utils/piiRedactor');

const _readAdversarial = async () => {
   const buf = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'timetrackers', 'adversarial.xlsx'));
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
         duration: Number(row.getCell(8).value || 0),
         notes: row.getCell(9).value || ''
      });
   });
   return rows;
};

describe('integration: PII-leak invariant', function () {
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

   it('processes the adversarial fixture and asserts zero PII leak across all persisted artifacts', async () => {
      const rows = await _readAdversarial();
      const inserted = [];
      for (const r of rows) {
         const [row] = await db('timesheet_entries')
            .insert({
               account_id: TEST_ACCOUNT_ID,
               user_id: TEST_ADMIN_USER_ID,
               employee_name: r.employee_name,
               timesheet_name: 'pii_test_tracker.xlsx',
               time_tracker_start_date: '2026-04-27',
               time_tracker_end_date: '2026-05-03',
               date: r.date,
               entity: r.entity,
               category: r.category,
               duration: r.duration,
               notes: r.notes,
               is_processed: false,
               is_deleted: false
            })
            .returning('timesheet_entry_id');
         inserted.push(row.timesheet_entry_id || row);
      }

      // Stub Bedrock to return a plausible suggestion.
      const bedrockMod = require('../../src/ai_integrations/bedrock');
      bedrockMod._setClientsForTest({
         bedrockClient: {
            send: async () => {
               const body = JSON.stringify({
                  content: [{ type: 'text', text: JSON.stringify({ suggested_general_work_description_id: 90031, suggested_job_category_id: 90001, suggested_job_type_id: 900201, suggested_category_label: 'Tax Return Preparation', category_confidence: 0.92, ai_reason: 'stub' }) }],
                  usage: { input_tokens: 500, output_tokens: 50 }
               });
               return { body: Buffer.from(body) };
            }
         },
         s3Client: null
      });

      await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds: inserted });

      const customers = await db('customers').where({ account_id: TEST_ACCOUNT_ID }).select('display_name', 'business_name', 'customer_name');
      const employees = await db('users').where({ account_id: TEST_ACCOUNT_ID }).select('display_name');
      const knownNames = _knownNamesFromCatalogs(customers, employees);

      const ai_payloads = await db('timesheet_entries').where({ account_id: TEST_ACCOUNT_ID }).whereIn('timesheet_entry_id', inserted).select('ai_payload');
      const suggestion_payloads = await db('ai_time_tracker_transaction_suggestions').where({ account_id: TEST_ACCOUNT_ID }).select('ai_payload');
      const call_errors = await db('ai_call_log').where({ account_id: TEST_ACCOUNT_ID }).select('error_message');

      const haystacks = [
         ...ai_payloads.map(r => JSON.stringify(r.ai_payload || {})),
         ...suggestion_payloads.map(r => JSON.stringify(r.ai_payload || {})),
         ...call_errors.map(r => r.error_message || '')
      ];

      for (const haystack of haystacks) {
         expect(containsAnyName(haystack, knownNames)).to.equal(false, `PII leak detected in persisted artifact:\n${haystack.slice(0, 500)}`);
      }
   });
});
