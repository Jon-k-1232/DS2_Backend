const fs = require('fs');
const path = require('path');
const harness = require('./helpers/pgHarness');
const suggestions = require('../../src/endpoints/timesheets/timesheet-suggestions-service');

describe('F30 suggestion schema lineage', function () {
   this.timeout(30000);
   const name = `ds2_mig_test_f30_${process.pid}`;
   let db;
   before(function () { if (!harness.isAvailable()) this.skip(); });
   beforeEach(async () => { harness.createThrowawayDb(name); db = harness.knexFor(name); });
   afterEach(async () => { if (db) await db.destroy(); harness.dropDb(name); });
   const forward = async () => {
      for (const file of fs.readdirSync(path.join(__dirname, '../../migrations')).filter(f => /^\d{3}\..*\.sql$/.test(f) && Number(f.slice(0,3)) > 18).sort()) {
         await db.transaction(trx => trx.raw(fs.readFileSync(path.join(__dirname, '../../migrations', file), 'utf8')));
      }
   };
   for (const historicalDrop of [true, false]) it(`supports runtime suggestion writes from snapshot baseline${historicalDrop ? ' with the historical 005 gap' : ''}`, async () => {
      if (historicalDrop) await db.raw(fs.readFileSync(path.join(__dirname, '../../migrations/005.drop_ai_customer_suggestion_columns.sql'), 'utf8'));
      await forward();
      await db.raw(fs.readFileSync(path.join(__dirname, '../fixtures/seed.sql'), 'utf8'));
      const [entry] = await db('timesheet_entries').insert({ account_id: 9001, user_id: 90011, employee_name: 'Eliza Smith',
         timesheet_name: 'F30.xlsx', time_tracker_start_date: '2026-09-01', time_tracker_end_date: '2026-09-01', date: '2026-09-01', duration: 60, notes: 'F30' }).returning('*');
      const input = { account_id: 9001, timesheet_entry_id: entry.timesheet_entry_id, sanitized_notes: 'F30',
         suggested_entity: 'Fixture', suggested_customer_id: 900101, suggested_customer_display_name: 'Acme Corp', status: 'pending', source: 'ai' };
      await db('ai_time_tracker_transaction_suggestions').insert(input).onConflict('timesheet_entry_id').merge();
      await forward(); // Additive rerun must preserve data, including populated columns.
      const [row] = await suggestions.getSuggestionsForEntries(db, 9001, [entry.timesheet_entry_id]);
      expect(row.suggested_entity).to.equal('Fixture');
      expect(row.suggested_customer_id).to.equal(900101);
      expect(row.suggested_customer_display_name).to.equal('Acme Corp');
      const fk = await db.raw("SELECT 1 FROM pg_constraint WHERE conrelid='ai_time_tracker_transaction_suggestions'::regclass AND confrelid='customers'::regclass AND contype='f'");
      expect(fk.rows).to.have.length(1);
   });
});
