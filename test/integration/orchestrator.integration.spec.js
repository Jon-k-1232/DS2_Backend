/**
 * Integration test for the upload -> validation -> auto-ingest pipeline against
 * the sandbox/dev DB (fixture account 9001, see test/fixtures/seed.sql).
 *
 * Skipped automatically if the DB isn't reachable. Bedrock AND Comprehend are
 * replaced with local stubs (test/fixtures/integrationHelpers.js) — no AWS call
 * is ever made. Fixtures are real prod-layout trackers parsed by the real
 * validator, so the orchestrator actually resolves customers and exercises the
 * match -> categorize -> auto-insert path.
 *
 *   DS2_ENV_FILE=.env.local npx mocha --require test/setup.js test/integration/orchestrator.integration.spec.js --exit --timeout 120000
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const orchestrator = require('../../src/endpoints/timesheets/auto-ingest-orchestrator');
const { processEntries, processEntry, HOLD_REASONS } = orchestrator;
const { buildSheet, toSerial, MIXED_MESSY } = require('../fixtures/buildTrackerFixtures');
const { uploadTrackerBuffer, installStubbedAws, installFailClosedAws, SEED_GWD_ID } = require('../fixtures/integrationHelpers');
const { _knownNamesFromCatalogs } = require('../../src/utils/piiRedactor');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'timetrackers');
const ELIZA = 90011;
const BOB = 90012;
const RATES = { [ELIZA]: 75, [BOB]: 90 };
const CUSTOMER_IDS = { 'Acme Corp': 900101, 'Globex Industries': 900102, 'John Smith': 900103 };

const round2 = n => Math.round(n * 100) / 100;
const readFixture = file => fs.readFileSync(path.join(FIXTURE_DIR, file));
const uniqueName = label => `it_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.xlsx`;
const searchNameOf = e => e.company_name || [e.first_name, e.last_name].filter(Boolean).join(' ');

// entry id -> [transactions] via the training-example link addNewTransaction writes.
const transactionsByEntry = async (db, entryIds) => {
   const rows = await db('ai_category_training_examples as a')
      .join('customer_transactions as t', 't.transaction_id', 'a.transaction_id')
      .where('a.account_id', TEST_ACCOUNT_ID)
      .whereIn('a.timesheet_entry_id', entryIds)
      .select('a.timesheet_entry_id', 't.*');
   const map = new Map(entryIds.map(id => [id, []]));
   rows.forEach(r => map.get(r.timesheet_entry_id).push(r));
   return map;
};

// C1: the firm bills in 6-minute increments, rounded UP — quantity =
// ceil(minutes / 6) / 10 hours, independent of _computeTimeAmounts's own
// implementation (integer-tenths arithmetic avoids float noise across the
// wide range of minutes/rates this integration spec exercises).
const expectConsistentAmounts = (txn, minutes, rate) => {
   const quantity = Number(txn.quantity);
   const expectedQuantity = Math.ceil(Number(minutes) / 6) / 10;
   expect(quantity).to.equal(expectedQuantity);
   expect(Number(txn.unit_cost)).to.equal(rate);
   expect(Number(txn.total_transaction)).to.equal(round2(quantity * rate));
};

describe('integration: auto-ingest orchestrator (prod-layout trackers, stubbed Bedrock + Comprehend)', function () {
   this.timeout(120_000);
   let db;
   let aws;
   let cleanUpload;

   before(async function () {
      db = await requireDb.call(this);
      await cleanupTestData(db);
      aws = installStubbedAws();
   });

   after(async () => {
      installFailClosedAws();
      if (db) await cleanupTestData(db);
      await closeDb();
   });

   it('clean tracker: every row is matched, categorized and auto-inserted exactly once with consistent amounts', async () => {
      cleanUpload = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: ELIZA, fileBuffer: readFixture('clean.xlsx'), timesheetName: uniqueName('clean') });
      const { entryIds } = cleanUpload;
      expect(entryIds).to.have.lengthOf(45);

      const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds });
      expect(result).to.include({ processed: 45, autoInserted: 45, held: 0, skipped: 0 });
      expect(aws.categoryPrompts().length).to.be.at.least(45);
      expect(aws.customerMatchPrompts()).to.have.lengthOf(0); // exact / canonical matches never need the LLM

      const entries = await db('timesheet_entries').whereIn('timesheet_entry_id', entryIds).select('*');
      const txns = await transactionsByEntry(db, entryIds);
      for (const entry of entries) {
         expect(entry.is_processed, `entry ${entry.timesheet_entry_id}`).to.equal(true);
         expect(entry.hold_reason).to.equal(null);
         const linked = txns.get(entry.timesheet_entry_id);
         expect(linked, `transactions for entry ${entry.timesheet_entry_id}`).to.have.lengthOf(1);
         const [txn] = linked;
         expect(txn.customer_id).to.equal(CUSTOMER_IDS[searchNameOf(entry)]);
         expect(txn.transaction_type).to.equal('Time');
         expect(txn.general_work_description_id).to.equal(SEED_GWD_ID);
         expect(txn.is_transaction_billable).to.equal(true);
         expect(txn.customer_invoice_id).to.equal(null);
         expectConsistentAmounts(txn, entry.duration, RATES[ELIZA]);
      }
      const statuses = await db('ai_time_tracker_transaction_suggestions').whereIn('timesheet_entry_id', entryIds).pluck('status');
      expect(statuses).to.have.lengthOf(45);
      expect(new Set(statuses)).to.deep.equal(new Set(['auto_applied']));
   });

   it('re-uploading the identical tracker is rejected as a duplicate file (nothing inserted)', async () => {
      const again = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: ELIZA, fileBuffer: readFixture('clean.xlsx'), timesheetName: uniqueName('clean_again') });
      expect(again.plan.identicalUpload).to.include({ timesheet_name: cleanUpload.inserted[0].timesheet_name, row_count: 45 });
      expect(again.inserted).to.have.lengthOf(0);
   });

   it('a cumulative re-upload skips the rows already ingested and inserts only the new ones', async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(readFixture('clean.xlsx'));
      const ws = wb.worksheets[0];
      const next = ws.rowCount + 1;
      ['Reviewed estimated tax vouchers (new)', 'Prepared extension request (new)'].forEach((notes, i) => {
         const r = ws.getRow(next + i);
         r.getCell(1).value = toSerial('2026-05-01');
         r.getCell(2).value = 'James F. Kimmel & Associates';
         r.getCell(3).value = 'Tax Return Preparation';
         r.getCell(4).value = 'Acme Corp';
         r.getCell(7).value = 30;
         r.getCell(9).value = notes;
         r.commit();
      });
      const cumulative = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: ELIZA, fileBuffer: Buffer.from(await wb.xlsx.writeBuffer()), timesheetName: uniqueName('cumulative') });
      expect(cumulative.plan.identicalUpload).to.equal(null);
      expect(cumulative.plan.duplicates).to.have.lengthOf(45);
      expect(cumulative.plan.duplicates[0].duplicate_of.timesheet_name).to.equal(cleanUpload.inserted[0].timesheet_name);
      expect(cumulative.inserted.map(r => r.notes)).to.deep.equal(['Reviewed estimated tax vouchers (new)', 'Prepared extension request (new)']);

      const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds: cumulative.entryIds });
      expect(result.autoInserted).to.equal(2);
      const total = await db('customer_transactions').where({ account_id: TEST_ACCOUNT_ID }).count({ n: '*' }).first();
      expect(Number(total.n)).to.equal(47); // 45 + 2, no double billing
   });

   it('two concurrent orchestrator runs over the same entries insert each transaction exactly once', async () => {
      const rows = Array.from({ length: 8 }, (_, i) => ({
         date: '2026-04-30',
         category: 'Phone Call',
         customer: { company: i % 2 ? 'Globex Industries' : 'Acme Corp' },
         duration: 20 + i,
         notes: `Concurrency check call #${i + 1}`
      }));
      const wb = buildSheet({ employee: 'Bob Jones', startDate: '2026-04-27', endDate: '2026-05-01', rows });
      const upload = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: BOB, fileBuffer: Buffer.from(await wb.xlsx.writeBuffer()), timesheetName: uniqueName('concurrent') });
      const { entryIds } = upload;
      expect(entryIds).to.have.lengthOf(8);

      const [a, b] = await Promise.all([
         processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds }),
         processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds })
      ]);
      expect(a.autoInserted + b.autoInserted).to.equal(8);
      expect(a.held + b.held).to.equal(0);

      const txns = await transactionsByEntry(db, entryIds);
      for (const id of entryIds) expect(txns.get(id), `entry ${id}`).to.have.lengthOf(1);
      for (const [id, [txn]] of txns) {
         const entry = upload.inserted.find(r => r.timesheet_entry_id === id);
         expectConsistentAmounts(txn, entry.duration, RATES[BOB]);
      }

      const third = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds });
      expect(third.processed).to.equal(0);
   });

   it('the is_processed claim guard skips (never double-inserts or downgrades) an entry processed after it was read', async () => {
      const wb = buildSheet({
         employee: 'Bob Jones',
         startDate: '2026-04-27',
         endDate: '2026-05-01',
         rows: [{ date: '2026-04-29', category: 'Phone Call', customer: { company: 'Acme Corp' }, duration: 25, notes: 'Race check call' }]
      });
      const upload = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: BOB, fileBuffer: Buffer.from(await wb.xlsx.writeBuffer()), timesheetName: uniqueName('race') });
      const [staleEntry] = await db('timesheet_entries').whereIn('timesheet_entry_id', upload.entryIds).select('*');

      // A reviewer applies it between the orchestrator's SELECT and its insert.
      await db('timesheet_entries').where({ timesheet_entry_id: staleEntry.timesheet_entry_id }).update({ is_processed: true });

      const catalogs = await orchestrator._loadCatalogs(db, TEST_ACCOUNT_ID);
      catalogs.knownNames = _knownNamesFromCatalogs(catalogs.customers, catalogs.employees);
      catalogs.confirmedAliases = new Map();
      const outcome = await processEntry({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entry: staleEntry, catalogs, fewShots: [] });
      expect(outcome).to.include({ decision: 'skip', reason: 'already_processed' });

      const txns = await transactionsByEntry(db, [staleEntry.timesheet_entry_id]);
      expect(txns.get(staleEntry.timesheet_entry_id)).to.have.lengthOf(0);
      const [after] = await db('timesheet_entries').where({ timesheet_entry_id: staleEntry.timesheet_entry_id }).select('is_processed', 'hold_reason');
      expect(after).to.deep.equal({ is_processed: true, hold_reason: null });
   });

   it('internal customers (INTERNAL_CUSTOMER_IDS) are auto-inserted NON-billable with hours still recorded', async () => {
      const previous = process.env.INTERNAL_CUSTOMER_IDS;
      process.env.INTERNAL_CUSTOMER_IDS = '900102'; // treat Globex as one of the firm's own entities
      try {
         const wb = buildSheet({
            employee: 'Bob Jones',
            startDate: '2026-04-27',
            endDate: '2026-05-01',
            rows: [
               { date: '2026-04-28', category: 'Administrative', customer: { company: 'Globex Industries' }, duration: 45, notes: 'Internal staff meeting on workflow' },
               { date: '2026-04-28', category: 'Phone Call', customer: { company: 'Acme Corp' }, duration: 30, notes: 'Client call about vouchers' }
            ]
         });
         const upload = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: BOB, fileBuffer: Buffer.from(await wb.xlsx.writeBuffer()), timesheetName: uniqueName('internal') });
         const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds: upload.entryIds });
         expect(result.autoInserted).to.equal(2);
         const txns = await transactionsByEntry(db, upload.entryIds);
         for (const entry of upload.inserted) {
            const [txn] = txns.get(entry.timesheet_entry_id);
            expect(txn.is_transaction_billable, entry.company_name).to.equal(entry.company_name !== 'Globex Industries');
            expectConsistentAmounts(txn, entry.duration, RATES[BOB]); // hours + value kept for analytics
         }
      } finally {
         if (previous === undefined) delete process.env.INTERNAL_CUSTOMER_IDS;
         else process.env.INTERNAL_CUSTOMER_IDS = previous;
      }
   });

   it('mixed tracker: ambiguous customers, missing jobs, vague notes and non-work rows are handled per row', async () => {
      const upload = await uploadTrackerBuffer(db, { accountId: TEST_ACCOUNT_ID, ownerUserId: BOB, fileBuffer: readFixture('mixed.xlsx'), timesheetName: uniqueName('mixed') });
      const { entryIds } = upload;
      expect(entryIds).to.have.lengthOf(32);

      const result = await processEntries({ db, accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, entryIds });
      const expectedHolds = MIXED_MESSY.filter(m => !m.expect.startsWith('auto_insert')).length;
      expect(result.held).to.equal(expectedHolds);
      expect(result.autoInserted).to.equal(32 - expectedHolds);

      const entries = await db('timesheet_entries').whereIn('timesheet_entry_id', entryIds).select('*');
      const txns = await transactionsByEntry(db, entryIds);
      const allowed = new Set(Object.values(HOLD_REASONS));
      for (const entry of entries) {
         const messy = MIXED_MESSY.find(m => m.notes === entry.notes);
         const expected = messy ? messy.expect : 'auto_insert';
         const linked = txns.get(entry.timesheet_entry_id);
         if (expected.startsWith('auto_insert')) {
            expect(entry.is_processed, entry.notes).to.equal(true);
            expect(linked, entry.notes).to.have.lengthOf(1);
            expect(linked[0].is_transaction_billable, entry.notes).to.equal(expected !== 'auto_insert_non_billable');
            expectConsistentAmounts(linked[0], entry.duration, RATES[BOB]);
         } else {
            expect(entry.is_processed, entry.notes).to.equal(false);
            expect(entry.hold_reason, entry.notes).to.equal(expected);
            expect(allowed.has(entry.hold_reason)).to.equal(true);
            expect(linked, entry.notes).to.have.lengthOf(0);
         }
         if (expected === HOLD_REASONS.AMBIGUOUS_CUSTOMER_MATCH) {
            expect(entry.suggested_customer_id, 'ambiguous holds must not pre-select a customer').to.equal(null);
            expect(entry.ai_payload.customer.tier).to.equal('needs_review');
            if (entry.company_name === 'Smith') {
               expect(entry.ai_payload.customer.candidates.map(c => c.id)).to.include.members([900103, 900104]);
            }
         }
      }
   });
});
