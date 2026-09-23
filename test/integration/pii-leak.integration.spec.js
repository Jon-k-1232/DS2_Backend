/**
 * PII-leak invariant for the auto-ingest pipeline.
 *
 * The adversarial prod-layout tracker (test/fixtures/timetrackers/adversarial.xlsx)
 * carries PII in the notes (names, emails, phones, SSN, card, bank account,
 * street address) for customers that DO resolve, so the orchestrator runs the
 * real match -> redact -> categorize -> auto-insert path. Invariants:
 *
 *   1. No categorization prompt sent to (stubbed) Bedrock contains a known
 *      customer / employee name or any raw PII token — including the
 *      per-customer few-shot block built from previously billed notes.
 *   2. No persisted AI artifact contains them:
 *        timesheet_entries.ai_payload, ai_time_tracker_transaction_suggestions
 *        (ai_payload, ai_reason, sanitized_notes), ai_call_log.error_message.
 *   3. Held rows persist only IDs, scores, tiers and fixed reason codes.
 *
 * Bedrock and Comprehend are stubbed (no AWS). Skipped when the DB is unreachable.
 *   DS2_ENV_FILE=.env.local npx mocha --require test/setup.js test/integration/pii-leak.integration.spec.js --exit --timeout 120000
 */
const path = require('path');
const fs = require('fs');
const { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { processEntries, HOLD_REASONS } = require('../../src/endpoints/timesheets/auto-ingest-orchestrator');
const { containsAnyName, _knownNamesFromCatalogs } = require('../../src/utils/piiRedactor');
const { buildSheet } = require('../fixtures/buildTrackerFixtures');
const { uploadTrackerBuffer, installStubbedAws, installFailClosedAws } = require('../fixtures/integrationHelpers');

const ELIZA = 90011;
const RAW_PII = [
   'john.smith@example.com',
   '123-4567',
   '123-45-6789',
   '123 Main St',
   '0123456789',
   '555-0199',
   'cfo@globex.com',
   '4111-1111-1111-1111'
];

describe('integration: PII-leak invariant', function () {
   this.timeout(120_000);
   let db;
   let knownNames;
   let leakIn;

   before(async function () {
      db = await requireDb.call(this);
      await cleanupTestData(db);
      const customers = await db('customers').where({ account_id: TEST_ACCOUNT_ID }).select('display_name', 'business_name', 'customer_name');
      const employees = await db('users').where({ account_id: TEST_ACCOUNT_ID }).select('display_name');
      knownNames = _knownNamesFromCatalogs(customers, employees);
      leakIn = haystack => {
         const text = String(haystack || '');
         if (containsAnyName(text, knownNames)) return 'known name';
         const token = RAW_PII.find(t => text.toLowerCase().includes(t.toLowerCase()));
         return token ? `raw PII "${token}"` : null;
      };
   });

   after(async () => {
      installFailClosedAws();
      if (db) await cleanupTestData(db);
      await closeDb();
   });

   it('auto-inserts the adversarial tracker without leaking names / PII into prompts or persisted AI artifacts', async () => {
      const aws = installStubbedAws();
      const upload = await uploadTrackerBuffer(db, {
         accountId: TEST_ACCOUNT_ID,
         ownerUserId: ELIZA,
         fileBuffer: fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'timetrackers', 'adversarial.xlsx')),
         timesheetName: `it_pii_${Date.now()}.xlsx`
      });
      expect(upload.entryIds).to.have.lengthOf(30);

      // Two batches: the second batch's prompts include per-customer few-shots
      // built from the first batch's billed notes (which ARE the raw PII).
      const first = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds: upload.entryIds.slice(0, 15) });
      const second = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds: upload.entryIds.slice(15) });
      expect(first.autoInserted + second.autoInserted, 'the real auto-insert path must run').to.equal(30);

      // The PII really is in the input and on the bill text (by design) ...
      const billed = await db('customer_transactions').where({ account_id: TEST_ACCOUNT_ID }).pluck('detailed_work_description');
      expect(billed.some(n => n.includes('john.smith@example.com'))).to.equal(true);
      expect(billed.some(n => n.includes('Eliza Smith'))).to.equal(true);

      // ... but never in what the model sees.
      const prompts = aws.categoryPrompts();
      expect(prompts.length).to.be.at.least(30);
      expect(prompts.some(p => p.text.includes('Past examples for this customer')), 'few-shot path exercised').to.equal(true);
      for (const prompt of prompts) {
         const leak = leakIn(prompt.text);
         expect(leak, `${leak} in categorization prompt:\n${prompt.text.slice(0, 1500)}`).to.equal(null);
      }

      const entryPayloads = await db('timesheet_entries').where({ account_id: TEST_ACCOUNT_ID }).whereIn('timesheet_entry_id', upload.entryIds).select('ai_payload');
      const suggestions = await db('ai_time_tracker_transaction_suggestions').where({ account_id: TEST_ACCOUNT_ID }).select('ai_payload', 'ai_reason', 'sanitized_notes');
      const callErrors = await db('ai_call_log').where({ account_id: TEST_ACCOUNT_ID }).select('error_message');
      expect(suggestions.length).to.equal(30);
      const haystacks = [
         ...entryPayloads.map(r => JSON.stringify(r.ai_payload || {})),
         ...suggestions.map(r => JSON.stringify(r)),
         ...callErrors.map(r => r.error_message || '')
      ];
      for (const haystack of haystacks) {
         const leak = leakIn(haystack);
         expect(leak, `${leak} in persisted artifact:\n${haystack.slice(0, 500)}`).to.equal(null);
      }
   });

   it('held rows (ambiguous / unmatched / no job) persist only IDs, scores and reason codes', async () => {
      installStubbedAws();
      const rows = [
         { date: '2026-04-29', category: 'Phone Call', customer: { company: 'Smith' }, duration: 15, notes: 'Called John Smith at (555) 123-4567 about the Smith, Jane return' },
         { date: '2026-04-29', category: 'Phone Call', customer: { company: 'Acmme Corp' }, duration: 15, notes: 'emailed cfo@globex.com re Acme Corp invoice' },
         { date: '2026-04-29', category: 'Phone Call', customer: { first: 'Jane', last: 'Smith' }, duration: 15, notes: 'Jane Smith SSN 123-45-6789 verified' },
         { date: '2026-04-29', category: 'Phone Call', customer: { company: 'Brand New Co' }, duration: 15, notes: 'Eliza Smith met the owner at 123 Main St, Phoenix, AZ 85003' }
      ];
      const wb = buildSheet({ employee: 'Eliza Smith', startDate: '2026-04-27', endDate: '2026-05-01', rows });
      const upload = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: ELIZA, fileBuffer: Buffer.from(await wb.xlsx.writeBuffer()), timesheetName: `it_pii_holds_${Date.now()}.xlsx` });
      const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds: upload.entryIds });
      expect(result.held).to.equal(4);

      const held = await db('timesheet_entries').whereIn('timesheet_entry_id', upload.entryIds).select('hold_reason', 'ai_payload');
      expect(held.map(h => h.hold_reason).sort()).to.deep.equal(
         [HOLD_REASONS.AMBIGUOUS_CUSTOMER_MATCH, HOLD_REASONS.AMBIGUOUS_CUSTOMER_MATCH, HOLD_REASONS.MISSING_REQUIRED_FIELD, HOLD_REASONS.NO_MATCHING_CUSTOMER].sort()
      );
      for (const row of held) {
         const serialized = JSON.stringify(row.ai_payload || {});
         const leak = leakIn(serialized);
         expect(leak, `${leak} in held ai_payload:\n${serialized}`).to.equal(null);
      }
   });
});
