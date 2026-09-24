/**
 * migrations/021.tracker_file_owners.sql — review/full-audit-2026-09,
 * Astra round 13, finding P2: current-name uniqueness and the recorded-name
 * (timesheet_entries) lookup are both replaced by ONE durable mapping from
 * an S3 tracker key to the (account, user) that owns it. See the migration
 * file's own header comment, and trackerOwners.js / timeTracking-router.js
 * for how the app reads this table.
 *
 * Runs against throwaway ds2_mig_test_* databases built fresh from
 * migrations/schema-snapshot-2026-09-22.sql (never ds2_local/ds2_clean — see
 * test/scripts/helpers/pgHarness.js). Skips when the sandbox Postgres / psql
 * CLI tools aren't reachable.
 */
const fs = require('fs');
const path = require('path');
const pgHarness = require('./helpers/pgHarness');

const MIGRATION_021_PATH = path.join(__dirname, '..', '..', 'migrations', '021.tracker_file_owners.sql');
const migrationSql = () => fs.readFileSync(MIGRATION_021_PATH, 'utf8');

const insertAccount = (db, overrides) =>
   db('accounts').insert(
      Object.assign(
         {
            account_type: 'business',
            is_account_active: true
         },
         overrides
      )
   );

const insertOwnerRow = (db, overrides) =>
   db('tracker_file_owners').insert(
      Object.assign(
         {
            s3_key: 'James_F__Kimmel___Associates/time_tracking/processed/Smith_Eliza/some-file.xlsx.gz',
            account_id: 1,
            user_id: 90011,
            source: 'path'
         },
         overrides
      )
   );

describe('migrations/021.tracker_file_owners.sql', function () {
   this.timeout(30000);
   const DB = `ds2_mig_test_021_spec_${process.pid}`;
   let db;

   before(function () {
      if (!pgHarness.isAvailable()) return this.skip();
   });

   beforeEach(async () => {
      pgHarness.createThrowawayDb(DB);
      db = pgHarness.knexFor(DB);
      await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });
      await insertAccount(db, { account_id: 9001, account_name: 'TEST FIXTURE ACCOUNT' });
   });
   afterEach(async () => {
      if (db) await db.destroy();
      pgHarness.dropDb(DB);
   });

   describe('table creation', () => {
      it('creates tracker_file_owners with the expected columns', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));

         const columns = await db('information_schema.columns').select('column_name', 'data_type', 'is_nullable').where({ table_name: 'tracker_file_owners' }).orderBy('column_name');
         const byName = Object.fromEntries(columns.map(c => [c.column_name, c]));

         expect(Object.keys(byName).sort()).to.deep.equal(['account_id', 'created_at', 's3_key', 'source', 'user_id']);
         expect(byName.s3_key.data_type).to.equal('text');
         expect(byName.s3_key.is_nullable).to.equal('NO');
         expect(byName.account_id.data_type).to.equal('integer');
         expect(byName.account_id.is_nullable).to.equal('NO');
         expect(byName.user_id.data_type).to.equal('integer');
         expect(byName.user_id.is_nullable).to.equal('NO');
         expect(byName.source.data_type).to.equal('text');
         expect(byName.source.is_nullable).to.equal('NO');
         expect(byName.created_at.is_nullable).to.equal('NO');
      });

      it('accepts a well-formed row and round-trips it', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         await insertOwnerRow(db, { s3_key: 'a/b/c.gz', account_id: 1, user_id: 21, source: 'folder-at-backfill' });

         const row = await db('tracker_file_owners').where({ s3_key: 'a/b/c.gz' }).first();
         expect(row.account_id).to.equal(1);
         expect(row.user_id).to.equal(21);
         expect(row.source).to.equal('folder-at-backfill');
         expect(row.created_at).to.exist;
      });
   });

   describe('primary key on s3_key', () => {
      it('rejects a second row with a duplicate s3_key', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         await insertOwnerRow(db, { s3_key: 'dup/key.gz', account_id: 1, user_id: 21 });

         let error = null;
         try {
            await insertOwnerRow(db, { s3_key: 'dup/key.gz', account_id: 9001, user_id: 90011 });
         } catch (e) {
            error = e;
         }
         expect(error, 'PRIMARY KEY on s3_key must reject a duplicate').to.exist;
      });

      it('rejects a NULL s3_key', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         let error = null;
         try {
            await insertOwnerRow(db, { s3_key: null });
         } catch (e) {
            error = e;
         }
         expect(error, 'NOT NULL / PRIMARY KEY must reject a NULL s3_key').to.exist;
      });
   });

   describe('source CHECK constraint', () => {
      it('accepts each of the four documented source values', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         const sources = ['upload', 'recorded-upload', 'folder-at-backfill', 'path'];
         for (const [index, source] of sources.entries()) {
            await insertOwnerRow(db, { s3_key: `source-check/${index}.gz`, source });
         }
         const rows = await db('tracker_file_owners').whereIn('source', sources).orderBy('s3_key');
         expect(rows).to.have.length(4);
      });

      it('rejects a value outside the four documented sources', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         let error = null;
         try {
            await insertOwnerRow(db, { s3_key: 'bad-source.gz', source: 'guessed' });
         } catch (e) {
            error = e;
         }
         expect(error, 'CHECK (source IN (...)) must reject an undocumented value').to.exist;
      });

      it('rejects a NULL source', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         let error = null;
         try {
            await insertOwnerRow(db, { s3_key: 'null-source.gz', source: null });
         } catch (e) {
            error = e;
         }
         expect(error, 'source is NOT NULL').to.exist;
      });
   });

   describe('account_id: has a foreign key, unlike user_id', () => {
      it('rejects a row whose account_id does not exist in accounts', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         let error = null;
         try {
            await insertOwnerRow(db, { s3_key: 'foreign-key-check.gz', account_id: 999999 });
         } catch (e) {
            error = e;
         }
         expect(error, 'account_id REFERENCES accounts(account_id) must reject an unknown account').to.exist;
      });
   });

   describe('user_id has NO foreign key (attribution must survive user deletion)', () => {
      it('accepts a user_id that does not exist in users at all', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         // No users table row is ever inserted in this spec — proves the
         // column accepts an arbitrary integer with no referential check.
         await insertOwnerRow(db, { s3_key: 'no-fk-check.gz', account_id: 1, user_id: 4242424 });
         const row = await db('tracker_file_owners').where({ s3_key: 'no-fk-check.gz' }).first();
         expect(row.user_id).to.equal(4242424);
      });

      it('a row keyed to a user_id survives that id being "deleted" (DELETE FROM users, mirroring the real hard-delete route)', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         await db('users').insert({
            user_id: 555001,
            account_id: 9001,
            email: 'm021-temp@example.test',
            display_name: 'Migration 021 Temp',
            job_title: 'Temp',
            access_level: 'employee',
            is_user_active: true
         });
         await insertOwnerRow(db, { s3_key: 'survives-delete.gz', account_id: 9001, user_id: 555001 });

         await db('users').where({ user_id: 555001 }).del();

         const row = await db('tracker_file_owners').where({ s3_key: 'survives-delete.gz' }).first();
         expect(row, 'the ownership row must still exist after the user row is gone').to.exist;
         expect(row.user_id).to.equal(555001);
      });
   });

   describe('index on (account_id, user_id)', () => {
      it('tracker_file_owners_owner_idx exists on (account_id, user_id)', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         const rows = await db('pg_indexes').select('indexdef').where({ tablename: 'tracker_file_owners', indexname: 'tracker_file_owners_owner_idx' });
         expect(rows).to.have.length(1);
         expect(rows[0].indexdef).to.match(/\(account_id,\s*user_id\)/);
      });
   });

   describe('idempotency — rerun is a no-op', () => {
      it('running the file twice in a row leaves the table, its rows, and its constraints unchanged', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         await insertOwnerRow(db, { s3_key: 'idempotency-check.gz', account_id: 1, user_id: 21, source: 'path' });

         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('tracker_file_owners').select('s3_key', 'account_id', 'user_id', 'source');
         expect(rows).to.have.length(1);
         expect(rows[0]).to.include({ s3_key: 'idempotency-check.gz', account_id: 1, user_id: 21, source: 'path' });

         // Constraints must still be live after the rerun, not silently dropped/recreated empty.
         let error = null;
         try {
            await insertOwnerRow(db, { s3_key: 'idempotency-check.gz', account_id: 9001, user_id: 90011 });
         } catch (e) {
            error = e;
         }
         expect(error, 'PRIMARY KEY must still be enforced after a second run of the file').to.exist;
      });

      it('running the file three times in a row against an empty table is still a clean no-op', async () => {
         await db.transaction(trx => trx.raw(migrationSql()));
         await db.transaction(trx => trx.raw(migrationSql()));
         await db.transaction(trx => trx.raw(migrationSql()));

         const columns = await db('information_schema.columns').select('column_name').where({ table_name: 'tracker_file_owners' });
         expect(columns).to.have.length(5);
         const indexes = await db('pg_indexes').select('indexname').where({ tablename: 'tracker_file_owners' });
         expect(indexes.map(i => i.indexname)).to.include('tracker_file_owners_owner_idx');
      });
   });
});
