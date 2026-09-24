/**
 * migrations/020.accounts_storage_slug.sql — review/full-audit-2026-09 finding 1
 * (Astra round 9): gives every account an IMMUTABLE storage_slug so renaming
 * an account can no longer collide with, or inherit, another account's S3
 * namespace (see the migration file's own header comment for the full
 * writeup, and src/utils/storageSlug.js for how the app reads this column).
 *
 * Runs against throwaway ds2_mig_test_* databases built fresh from
 * migrations/schema-snapshot-2026-09-22.sql (never ds2_local/ds2_clean — see
 * test/scripts/helpers/pgHarness.js). Skips when the sandbox Postgres / psql
 * CLI tools aren't reachable.
 */
const fs = require('fs');
const path = require('path');
const pgHarness = require('./helpers/pgHarness');
const { sanitizeAccountName } = require('../../src/utils/invoicePath');

const MIGRATION_020_PATH = path.join(__dirname, '..', '..', 'migrations', '020.accounts_storage_slug.sql');
const migrationSql = () => fs.readFileSync(MIGRATION_020_PATH, 'utf8');

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

describe('migrations/020.accounts_storage_slug.sql', function () {
   this.timeout(30000);
   const DB = `ds2_mig_test_020_spec_${process.pid}`;
   let db;

   before(function () {
      if (!pgHarness.isAvailable()) return this.skip();
   });

   beforeEach(async () => {
      pgHarness.createThrowawayDb(DB);
      db = pgHarness.knexFor(DB);
   });
   afterEach(async () => {
      if (db) await db.destroy();
      pgHarness.dropDb(DB);
   });

   describe('backfill matches sanitizeAccountName() exactly', () => {
      const samples = [
         'James F. Kimmel & Associates',
         'TEST FIXTURE ACCOUNT',
         "O'Brien & Sons, LLC",
         'Plain',
         '  leading and trailing  ',
         ''
      ];

      it('produces the same slug the JS helper would for a range of real-shaped names, including account 1\'s real name', async () => {
         for (const [index, name] of samples.entries()) {
            await insertAccount(db, { account_id: 100 + index, account_name: name });
         }

         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('accounts').select('account_id', 'account_name', 'storage_slug').orderBy('account_id');
         for (const row of rows) {
            expect(row.storage_slug, row.account_name).to.equal(sanitizeAccountName(row.account_name));
         }
      });

      it('specifically: "James F. Kimmel & Associates" -> "James_F__Kimmel___Associates" (account 1\'s real value)', async () => {
         await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });

         await db.transaction(trx => trx.raw(migrationSql()));

         const row = await db('accounts').where({ account_id: 1 }).first();
         expect(row.storage_slug).to.equal('James_F__Kimmel___Associates');
      });

      it('does not touch a storage_slug that is already set (only backfills NULLs) — proves storage_slug survives a later account rename', async () => {
         await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });

         await db.transaction(trx => trx.raw(migrationSql()));
         const afterFirstRun = (await db('accounts').where({ account_id: 1 }).first()).storage_slug;
         expect(afterFirstRun).to.equal('James_F__Kimmel___Associates');

         // Simulates the app renaming the account AFTER migration 020 has
         // already run (account-service.js's updateAccount never touches
         // storage_slug — see accountObjects.js) and a hand-set slug value
         // that no longer matches sanitizeAccountName(account_name) at all.
         // A second full run of the file must leave it alone: the backfill
         // only targets NULLs, and the collision CTE recomputes from
         // CURRENT values, so a single, already-unique, non-NULL value is
         // never revisited.
         await db('accounts').where({ account_id: 1 }).update({ account_name: 'Totally Different Name Inc', storage_slug: 'Hand_Set_Value' });
         await db.transaction(trx => trx.raw(migrationSql()));
         const row = await db('accounts').where({ account_id: 1 }).first();
         expect(row.storage_slug, 'storage_slug must be immutable once set, even across a rename').to.equal('Hand_Set_Value');
      });
   });

   describe('collision resolution', () => {
      it('two accounts whose names sanitize to the same slug: the LOWEST account_id keeps the bare slug, the other gets `_<account_id>` appended', async () => {
         await insertAccount(db, { account_id: 5, account_name: 'Foo Bar' });
         await insertAccount(db, { account_id: 2, account_name: 'Foo Bar' });
         await insertAccount(db, { account_id: 9, account_name: 'Foo Bar' });

         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');
         const byId = Object.fromEntries(rows.map(r => [r.account_id, r.storage_slug]));
         expect(byId[2]).to.equal('Foo_Bar'); // lowest id in the colliding group keeps the bare slug
         expect(byId[5]).to.equal('Foo_Bar_5');
         expect(byId[9]).to.equal('Foo_Bar_9');
         // And the final set is unique, satisfying the UNIQUE index added below.
         expect(new Set(Object.values(byId)).size).to.equal(3);
      });

      it('an account whose name is unique among its peers is never suffixed', async () => {
         await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });
         await insertAccount(db, { account_id: 9001, account_name: 'TEST FIXTURE ACCOUNT' });

         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');
         const byId = Object.fromEntries(rows.map(r => [r.account_id, r.storage_slug]));
         expect(byId[1]).to.equal('James_F__Kimmel___Associates');
         expect(byId[9001]).to.equal('TEST_FIXTURE_ACCOUNT');
      });
   });

   // review/full-audit-2026-09 finding 4 (Astra round 10): the OLD
   // collision-resolution UPDATE computed every "resolved" slug from a single
   // static snapshot (one CTE, taken once) and never re-checked a suffixed
   // candidate against the table again — so a resolved slug could collide
   // with an UNRELATED row's slug the snapshot never considered, which the
   // UNIQUE index below then caught, aborting the entire migration.
   describe('cross-collision resolution (Astra round 10, finding 4)', () => {
      it("Astra's exact reproduction — 100 'R10 Foo', 101 'R10_Foo', 102 'R10_Foo_101' — resolves to three unique slugs instead of aborting", async () => {
         // 100 and 101 collide on base 'R10_Foo' (100 is lower id, keeps it
         // bare). The OLD code always suffixed 101 with exactly
         // `_<account_id>`, giving 'R10_Foo_101' — but account 102's NAME
         // already sanitizes to that exact string, so 102 holds it as its
         // own bare (unique-at-the-time) slug. The two 'R10_Foo_101' values
         // (101's naive suffix and 102's real bare slug) would then collide
         // at the UNIQUE index, well after the single-pass UPDATE had
         // already stopped looking.
         await insertAccount(db, { account_id: 100, account_name: 'R10 Foo' });
         await insertAccount(db, { account_id: 101, account_name: 'R10_Foo' });
         await insertAccount(db, { account_id: 102, account_name: 'R10_Foo_101' });

         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');
         const byId = Object.fromEntries(rows.map(r => [r.account_id, r.storage_slug]));
         expect(byId[100]).to.equal('R10_Foo'); // lowest id in the 'R10_Foo' group keeps the bare slug
         expect(byId[102]).to.equal('R10_Foo_101'); // untouched — 102 was never part of any collision
         expect(byId[101]).to.equal('R10_Foo_101_2'); // escalated PAST 102's pre-existing slug, not equal to it
         expect(new Set(Object.values(byId)).size).to.equal(3); // all unique — the UNIQUE index below never fails
      });

      it('a three-way chain — the naive `_<id>` AND the next `_<id>_2` candidate are both already taken — escalates all the way to `_<id>_3`', async () => {
         await insertAccount(db, { account_id: 200, account_name: 'R10 Foo' }); // bare -> R10_Foo
         await insertAccount(db, { account_id: 201, account_name: 'R10_Foo' }); // collides -> naive candidate R10_Foo_201
         await insertAccount(db, { account_id: 202, account_name: 'R10_Foo_201' }); // pre-occupies the naive candidate
         await insertAccount(db, { account_id: 203, account_name: 'R10_Foo_201_2' }); // pre-occupies the NEXT candidate too

         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');
         const byId = Object.fromEntries(rows.map(r => [r.account_id, r.storage_slug]));
         expect(byId[200]).to.equal('R10_Foo');
         expect(byId[202]).to.equal('R10_Foo_201'); // untouched — never part of the R10_Foo collision group
         expect(byId[203]).to.equal('R10_Foo_201_2'); // untouched — never part of the R10_Foo collision group
         expect(byId[201]).to.equal('R10_Foo_201_3'); // escalated past BOTH pre-occupied candidates
         expect(new Set(Object.values(byId)).size).to.equal(4);
      });

      it('the cross-collision fix is itself idempotent — re-running after an escalated resolution changes nothing', async () => {
         await insertAccount(db, { account_id: 100, account_name: 'R10 Foo' });
         await insertAccount(db, { account_id: 101, account_name: 'R10_Foo' });
         await insertAccount(db, { account_id: 102, account_name: 'R10_Foo_101' });

         await db.transaction(trx => trx.raw(migrationSql()));
         const afterFirst = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');

         await db.transaction(trx => trx.raw(migrationSql()));
         const afterSecond = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');

         expect(afterSecond).to.deep.equal(afterFirst);
      });
   });

   describe('idempotency — rerun is a no-op', () => {
      it('running the file twice in a row leaves every storage_slug unchanged, including a previously-resolved collision', async () => {
         await insertAccount(db, { account_id: 5, account_name: 'Foo Bar' });
         await insertAccount(db, { account_id: 2, account_name: 'Foo Bar' });
         await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });

         await db.transaction(trx => trx.raw(migrationSql()));
         const afterFirst = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');

         await db.transaction(trx => trx.raw(migrationSql()));
         const afterSecond = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');

         expect(afterSecond).to.deep.equal(afterFirst);
      });

      it('running the file three times in a row is still stable (no drift from repeated collision passes)', async () => {
         await insertAccount(db, { account_id: 5, account_name: 'Foo Bar' });
         await insertAccount(db, { account_id: 2, account_name: 'Foo Bar' });

         await db.transaction(trx => trx.raw(migrationSql()));
         await db.transaction(trx => trx.raw(migrationSql()));
         await db.transaction(trx => trx.raw(migrationSql()));

         const rows = await db('accounts').select('account_id', 'storage_slug').orderBy('account_id');
         const byId = Object.fromEntries(rows.map(r => [r.account_id, r.storage_slug]));
         expect(byId[2]).to.equal('Foo_Bar');
         expect(byId[5]).to.equal('Foo_Bar_5');
      });
   });

   describe('NOT NULL + UNIQUE are enforced after the migration runs', () => {
      it('rejects a new row with an explicit NULL storage_slug', async () => {
         await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });
         await db.transaction(trx => trx.raw(migrationSql()));

         let error = null;
         try {
            await insertAccount(db, { account_id: 2, account_name: 'Someone Else', storage_slug: null });
         } catch (e) {
            error = e;
         }
         expect(error, 'NOT NULL constraint must reject an explicit NULL').to.exist;
      });

      it('rejects a second row with a duplicate storage_slug', async () => {
         await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });
         await db.transaction(trx => trx.raw(migrationSql()));

         let error = null;
         try {
            await insertAccount(db, { account_id: 2, account_name: 'Someone Else', storage_slug: 'James_F__Kimmel___Associates' });
         } catch (e) {
            error = e;
         }
         expect(error, 'UNIQUE constraint must reject a duplicate storage_slug').to.exist;
      });

      it('the unique index accepts two accounts with distinct slugs with no error', async () => {
         await insertAccount(db, { account_id: 1, account_name: 'James F. Kimmel & Associates' });
         await db.transaction(trx => trx.raw(migrationSql()));

         await insertAccount(db, { account_id: 2, account_name: 'Someone Else', storage_slug: 'Someone_Else' });
         const rows = await db('accounts').select('account_id');
         expect(rows).to.have.length(2);
      });
   });
});
