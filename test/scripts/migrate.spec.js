/**
 * scripts/migrate.js — findings F4 (prod guard), F5 (dry-run purity, bootstrap/baseline
 * concurrency, --baseline validation) and F6 (verbatim SQL / file contract), round-3 review.
 *
 * The pure-logic pieces (looksLikeProd, assertPlainSql, validateBaseline) need no database.
 * The DB-backed pieces run against throwaway ds2_mig_test_* databases (see
 * test/scripts/helpers/pgHarness.js) built fresh from migrations/schema-snapshot-2026-09-22.sql
 * — never ds2_local/ds2_clean. Skips (not fails) when the sandbox Postgres / psql CLI tools
 * aren't reachable, same convention as test/integration/_setup.js's requireDb.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { looksLikeProd, assertPlainSql, validateBaseline, runMigrate, listMigrations, MIGRATE_LOCK_KEY } = require('../../scripts/migrate');
const pgHarness = require('./helpers/pgHarness');

describe('scripts/migrate.js — pure logic (no DB)', () => {
   describe('looksLikeProd (F4)', () => {
      it('refuses the exact prod name', () => {
         expect(looksLikeProd('ds2_prod', '127.0.0.1')).to.equal(true);
      });
      it('BYPASS from the report: a differently-named prod database ("ds2_production") is still caught', () => {
         expect(looksLikeProd('ds2_production', '127.0.0.1')).to.equal(true);
      });
      it('BYPASS from the report: a dev-named database pointed at a prod-looking host is still caught', () => {
         expect(looksLikeProd('ds2_dev', 'billing-prod.example.invalid')).to.equal(true);
      });
      it('is case-insensitive', () => {
         expect(looksLikeProd('DS2_PROD', '127.0.0.1')).to.equal(true);
      });
      it('does not flag an ordinary dev/local database', () => {
         expect(looksLikeProd('ds2_dev', '127.0.0.1')).to.equal(false);
         expect(looksLikeProd('ds2_local', '127.0.0.1')).to.equal(false);
      });
   });

   describe('assertPlainSql (F6)', () => {
      it('refuses a file-level BEGIN;/COMMIT; wrapper', () => {
         expect(() => assertPlainSql('BEGIN;\nSELECT 1;\nCOMMIT;\n', 'test')).to.throw(/plain SQL/);
      });
      it('refuses START TRANSACTION; and END; lines too', () => {
         expect(() => assertPlainSql('START TRANSACTION;\nSELECT 1;\n', 'test')).to.throw(/plain SQL/);
         expect(() => assertPlainSql('SELECT 1;\nEND;\n', 'test')).to.throw(/plain SQL/);
      });
      it('refuses a psql meta-command line', () => {
         expect(() => assertPlainSql('\\connect somedb\nSELECT 1;\n', 'test')).to.throw(/plain SQL/);
      });
      it('does NOT refuse a dollar-quoted PL/pgSQL function body containing its own BEGIN/END', () => {
         const sql = 'CREATE FUNCTION pg_temp.f019probe() RETURNS integer LANGUAGE plpgsql AS $$\nBEGIN\n RETURN 1;\nEND;\n$$;\n';
         expect(() => assertPlainSql(sql, 'test')).to.not.throw();
      });
      it('does not refuse ordinary SQL with semicolons inside string/dollar literals', () => {
         const sql = "SELECT 'a;b' AS literal; SELECT $$c;d$$ AS dollar;\n";
         expect(() => assertPlainSql(sql, 'test')).to.not.throw();
      });
      it('migration 019 as shipped passes the contract', () => {
         const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '019.ledger_data_normalization.sql'), 'utf8');
         expect(() => assertPlainSql(sql, '019')).to.not.throw();
      });
   });

   describe('assertPlainSql lexer hardening (N1, 2026-09 follow-up review)', () => {
      // The old assertPlainSql split the file on '\n' and regex-matched each LINE. All of the
      // REJECT cases below were bypasses of that old version: the forbidden statement was never
      // alone on its own line, so the per-line regex never saw it, even though the statement
      // really would run as a separate, real COMMIT/ROLLBACK once sent to Postgres. The ACCEPT
      // cases are the flip side — real SQL the old version wrongly refused.
      it('rejects a COMMIT hidden behind a trailing line comment', () => {
         expect(() => assertPlainSql('COMMIT; -- comment\n', 'test')).to.throw(/plain SQL/);
      });
      it('rejects a COMMIT with CRLF line endings (old regex anchored on ";[ \\t]*$", which a trailing \\r defeated)', () => {
         expect(() => assertPlainSql('COMMIT;\r\n', 'test')).to.throw(/plain SQL/);
      });
      it('rejects a COMMIT sharing a line with an ordinary statement', () => {
         expect(() => assertPlainSql('SELECT 1; COMMIT;\n', 'test')).to.throw(/plain SQL/);
      });
      it('rejects a bare ROLLBACK;', () => {
         expect(() => assertPlainSql('ROLLBACK;\n', 'test')).to.throw(/plain SQL/);
      });
      it('rejects ABORT;/SAVEPOINT ...;/RELEASE ...; and PREPARE TRANSACTION ...;', () => {
         expect(() => assertPlainSql('ABORT;\n', 'test')).to.throw(/plain SQL/);
         expect(() => assertPlainSql('SAVEPOINT foo;\n', 'test')).to.throw(/plain SQL/);
         expect(() => assertPlainSql('RELEASE foo;\n', 'test')).to.throw(/plain SQL/);
         expect(() => assertPlainSql("PREPARE TRANSACTION 'foo';\n", 'test')).to.throw(/plain SQL/);
      });
      it('rejects SET [LOCAL|SESSION] TRANSACTION ...; and SET standard_conforming_strings ...;', () => {
         expect(() => assertPlainSql('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n', 'test')).to.throw(/plain SQL/);
         expect(() => assertPlainSql('SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n', 'test')).to.throw(/plain SQL/);
         expect(() => assertPlainSql('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n', 'test')).to.throw(/plain SQL/);
         expect(() => assertPlainSql('SET standard_conforming_strings = off;\n', 'test')).to.throw(/plain SQL/);
      });
      it('rejects a real COMMIT that follows a "$body$"-shaped token sitting only in a comment', () => {
         expect(() => assertPlainSql('-- $body$ documentation\nCOMMIT;\n', 'test')).to.throw(/plain SQL/);
      });
      it('rejects a real COMMIT that follows a "$body$"-shaped token sitting only inside an ordinary string literal', () => {
         expect(() => assertPlainSql("SELECT '$body$';\nCOMMIT;\n", 'test')).to.throw(/plain SQL/);
      });
      it('ACCEPTS a block comment that merely mentions BEGIN; in prose (must not over-refuse)', () => {
         expect(() => assertPlainSql('/*\nBEGIN;\n*/\nSELECT 1;\n', 'test')).to.not.throw();
      });
      it('ACCEPTS nested, DIFFERENT dollar-quote tags', () => {
         const sql = 'DO $body$\nBEGIN\nPERFORM $nested$BEGIN;$nested$;\nEND;\n$body$;\n';
         expect(() => assertPlainSql(sql, 'test')).to.not.throw();
      });
      it('rejects a bare COMMIT that follows a valid dollar-quoted block once it has genuinely closed', () => {
         const sql = 'DO $body$\nBEGIN\nPERFORM $nested$BEGIN;$nested$;\nEND;\n$body$;\nCOMMIT;\n';
         expect(() => assertPlainSql(sql, 'test')).to.throw(/plain SQL/);
      });
      it('accepts every shipped numbered migration file (21 files, 002–022)', () => {
         const migrations = listMigrations(path.join(__dirname, '..', '..', 'migrations'));
         expect(migrations.length).to.equal(21);
         for (const m of migrations) {
            const sql = fs.readFileSync(m.file, 'utf8');
            expect(() => assertPlainSql(sql, m.name), m.name).to.not.throw();
         }
      });

      // R1 (2026-09 second follow-up review): the 12 cases above were all built from the
      // round-4 examples — none of them exercised a newline-continued E-string or a non-ASCII
      // dollar-quote tag, so the round-5 review found the lexer silently misclassified all four
      // cases below (verified against real Postgres via probe.cjs — these are genuine valid/
      // invalid syntax, not made-up edge cases).
      it('R1: ACCEPTS a newline-continued E-string — PostgreSQL joins it into ONE literal that keeps escape mode without repeating the E prefix', () => {
         // SELECT E'abc'
         // 'it\'s; COMMIT;';
         // is ONE string literal ('abc' + "it's; COMMIT;" concatenated) — no real COMMIT exists.
         const sql = "SELECT E'abc'\n'it\\'s; COMMIT;';";
         expect(() => assertPlainSql(sql, 'test')).to.not.throw();
      });
      it('R1: rejects a real COMMIT that follows a newline-continued E-string once it has genuinely closed', () => {
         // SELECT E'a'
         // 'b\'x'; COMMIT; --'
         // The continuation closes after 'b\'x', so `; COMMIT; --'` is real: a live top-level
         // COMMIT followed by a line comment that merely happens to contain a stray quote.
         const sql = "SELECT E'a'\n'b\\'x'; COMMIT; --'\n";
         expect(() => assertPlainSql(sql, 'test')).to.throw(/plain SQL/);
      });
      it('R1: ACCEPTS a real COMMIT-looking sequence safely inside a properly opened-and-closed non-ASCII dollar-quote tag ($é$)', () => {
         // SELECT $é$; COMMIT; $é$;
         // PostgreSQL dollar-quote tags allow non-ASCII identifier characters — $é$ opens a real
         // dollar-quoted body here, so "; COMMIT; " is opaque CONTENT, never a live statement.
         const sql = 'SELECT $é$; COMMIT; $é$;';
         expect(() => assertPlainSql(sql, 'test')).to.not.throw();
      });
      it('R1: rejects a real COMMIT that follows a non-ASCII dollar-quote tag once it has genuinely closed', () => {
         // SELECT $é$--$é$; COMMIT;
         // $é$--$é$ is ONE dollar-quoted token (content "--"), closing immediately — the
         // trailing "; COMMIT;" is a real, separate, live COMMIT statement.
         const sql = 'SELECT $é$--$é$; COMMIT;\n';
         expect(() => assertPlainSql(sql, 'test')).to.throw(/plain SQL/);
      });
   });

   describe('validateBaseline (F5)', () => {
      const migrations = [{ version: 2 }, { version: 3 }, { version: 19 }];
      it('accepts 0 (nothing applied yet)', () => {
         expect(() => validateBaseline(0, migrations)).to.not.throw();
      });
      it('accepts an existing version', () => {
         expect(() => validateBaseline(19, migrations)).to.not.throw();
      });
      it('accepts null (no --baseline given)', () => {
         expect(() => validateBaseline(null, migrations)).to.not.throw();
      });
      it('rejects a version that does not exist', () => {
         expect(() => validateBaseline(4, migrations)).to.throw(/existing migration version/);
      });
      it('rejects a negative number', () => {
         expect(() => validateBaseline(-1, migrations)).to.throw(/existing migration version/);
      });
      it('rejects a non-integer', () => {
         expect(() => validateBaseline(2.5, migrations)).to.throw(/existing migration version/);
      });
   });
});

describe('scripts/migrate.js — against a throwaway database', function () {
   this.timeout(30000);
   const DB = `ds2_mig_test_runner_spec_${process.pid}`;
   let fixtureDir;

   before(function () {
      if (!pgHarness.isAvailable()) return this.skip();
      pgHarness.createThrowawayDb(DB);
   });
   after(() => {
      if (pgHarness.isAvailable()) pgHarness.dropDb(DB);
   });

   beforeEach(() => {
      fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-mig-fixture-'));
   });
   afterEach(() => {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
   });

   const writeMigration = (filename, sql) => fs.writeFileSync(path.join(fixtureDir, filename), sql);

   it('F5: --dry-run against a fresh database never creates schemaversion (real SET TRANSACTION READ ONLY, not just a skipped branch)', async () => {
      writeMigration('901.probe.sql', 'CREATE TABLE probe_901 (id int);\n');
      const db = pgHarness.knexFor(DB);
      try {
         await runMigrate({ db, dbName: DB, host: pgHarness.HOST, dryRun: true, migrationsDir: fixtureDir, log: () => {} });
         const { rows } = await db.raw("SELECT to_regclass('schemaversion') AS name");
         expect(rows[0].name).to.equal(null);
      } finally {
         await db.destroy();
      }
   });

   it('F5 (2026-09 second follow-up review): the dry-run transaction is genuinely read-only at the Postgres level — a write attempted inside it is rejected by the SERVER, not merely skipped by app logic', async () => {
      // The test above only shows schemaversion was never created, which an app-level
      // `if (dryRun) skip` branch would also produce with no real guarantee behind it. This
      // mirrors runMigrate's own dry-run bootstrap sequence (advisory lock, then SET TRANSACTION
      // READ ONLY — see migrate.js) and injects a real write to prove Postgres itself, not just
      // this code, refuses it.
      const db = pgHarness.knexFor(DB);
      const trx = await db.transaction();
      let pgError = null;
      try {
         await trx.raw('SELECT pg_advisory_xact_lock(?)', [MIGRATE_LOCK_KEY]);
         await trx.raw('SET TRANSACTION READ ONLY');
         try {
            await trx.raw('CREATE TABLE probe_dryrun_write_should_fail (id int)');
         } catch (err) {
            pgError = err;
         }
      } finally {
         await trx.rollback().catch(() => {});
      }
      expect(pgError, 'Postgres should have refused a write under SET TRANSACTION READ ONLY').to.exist;
      expect(pgError.message).to.match(/read-only transaction/i);
      try {
         const { rows } = await db.raw("SELECT to_regclass('probe_dryrun_write_should_fail') AS n");
         expect(rows[0].n).to.equal(null);
      } finally {
         await db.destroy();
      }
   });

   it('F5: two concurrent first-time runners against the same fresh database both succeed with no duplicate-key error', async () => {
      writeMigration('905.first.sql', 'CREATE TABLE probe_905 (id int);\n');
      writeMigration('906.second.sql', 'CREATE TABLE probe_906 (id int);\n');
      const dbA = pgHarness.knexFor(DB);
      const dbB = pgHarness.knexFor(DB);
      try {
         const [resA, resB] = await Promise.all([
            runMigrate({ db: dbA, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} }),
            runMigrate({ db: dbB, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} })
         ]);
         // Between them, exactly the two migrations were applied once each — never both runners
         // applying the same version, never neither.
         const appliedTogether = [...resA.applied, ...resB.applied].sort();
         expect(appliedTogether).to.deep.equal([905, 906]);
         const versions = await dbA('schemaversion').select('version').orderBy('version');
         expect(versions.map(v => v.version)).to.deep.equal([905, 906]);
      } finally {
         await dbA.destroy();
         await dbB.destroy();
      }
   });

   it('F6: a dollar-quoted PL/pgSQL body containing its own BEGIN/END applies unchanged and actually runs', async () => {
      writeMigration(
         '910.plpgsql_fn.sql',
         'CREATE FUNCTION probe_910_fn() RETURNS integer LANGUAGE plpgsql AS $$\nBEGIN\n RETURN 42;\nEND;\n$$;\n'
      );
      const db = pgHarness.knexFor(DB);
      try {
         const result = await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         expect(result.applied).to.deep.equal([910]);
         const { rows } = await db.raw('SELECT probe_910_fn() AS v');
         expect(rows[0].v).to.equal(42);
      } finally {
         await db.destroy();
      }
   });

   it('F6: a migration file with a bare BEGIN;/COMMIT; wrapper is refused, not silently applied', async () => {
      writeMigration('915.bad.sql', 'BEGIN;\nCREATE TABLE probe_915_should_not_exist (id int);\nCOMMIT;\n');
      const db = pgHarness.knexFor(DB);
      try {
         let thrown = null;
         try {
            await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         } catch (err) {
            thrown = err;
         }
         expect(thrown, 'runMigrate should have thrown').to.exist;
         expect(thrown.message).to.match(/plain SQL/);
         const { rows } = await db.raw("SELECT to_regclass('probe_915_should_not_exist') AS n");
         expect(rows[0].n).to.equal(null);
         const recorded = await db('schemaversion').where({ version: 915 }).first();
         expect(recorded).to.equal(undefined);
      } finally {
         await db.destroy();
      }
   });

   it('N1: refuses a migration file with a COMMIT hidden behind a trailing comment, CRLF included — the file\'s own SQL never reaches Postgres', async () => {
      // Title corrected (2026-09 second follow-up review): the runner's bootstrap/lookup step
      // (advisory lock, schemaversion check) DOES touch the DB before this file is even read —
      // what this test actually proves is narrower and still real: assertPlainSql() runs before
      // any of THIS FILE's own SQL is submitted, so the hidden COMMIT never executes and the
      // CREATE TABLE it would have let slip through never commits either.
      writeMigration('930.sneaky.sql', 'CREATE TABLE probe_930_should_not_exist (id int);\r\nCOMMIT; -- sneaky\r\nSELECT * FROM this_table_does_not_exist;\r\n');
      const db = pgHarness.knexFor(DB);
      try {
         let thrown = null;
         try {
            await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         } catch (err) {
            thrown = err;
         }
         expect(thrown, 'runMigrate should have refused').to.exist;
         expect(thrown.message).to.match(/plain SQL/);
         // Proves this is a real refusal, not just the validator throwing in isolation: had the
         // hidden COMMIT been missed, the CREATE TABLE would have committed before the bogus
         // trailing SELECT failed the wrapper transaction — the pre-N1 bypass this fixture is
         // shaped after (see probe.log:atomicity:trailing_comment / :crlf).
         const { rows } = await db.raw("SELECT to_regclass('probe_930_should_not_exist') AS n");
         expect(rows[0].n).to.equal(null);
         const recorded = await db('schemaversion').where({ version: 930 }).first();
         expect(recorded).to.equal(undefined);
      } finally {
         await db.destroy();
      }
   });

   it('R1: refuses (and rolls back everything, not just the flip) a migration whose bypass is a newline-continued E-string hiding a real COMMIT', async () => {
      // Mirrors probe.cjs version 955: CREATE/INSERT precede the bypass sequence, a SELECT 1/0
      // follows it. Pre-R1 this sequence was wrongly ACCEPTED, the hidden COMMIT really ran, and
      // "escaped_continuation" stayed committed even though the file overall failed on the
      // division-by-zero (probe.log:lexer:E-continuation-atomicity-state: table present).
      writeMigration(
         '955.probe.sql',
         "CREATE TABLE escaped_continuation (v int);\nINSERT INTO escaped_continuation VALUES (1);\nSELECT E'a'\n'b\\'x'; COMMIT; --'\nSELECT 1/0;\n"
      );
      const db = pgHarness.knexFor(DB);
      try {
         let thrown = null;
         try {
            await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         } catch (err) {
            thrown = err;
         }
         expect(thrown, 'runMigrate should have refused').to.exist;
         expect(thrown.message).to.match(/plain SQL/);
         const { rows } = await db.raw("SELECT to_regclass('escaped_continuation') AS n");
         expect(rows[0].n).to.equal(null);
         const recorded = await db('schemaversion').where({ version: 955 }).first();
         expect(recorded).to.equal(undefined);
      } finally {
         await db.destroy();
      }
   });

   it('R1: refuses (and rolls back everything, not just the flip) a migration whose bypass is a real COMMIT hidden behind a closed non-ASCII dollar-quote tag', async () => {
      // Mirrors probe.cjs version 954. Pre-R1 this was wrongly ACCEPTED because $é$ was never
      // recognized as a dollar-quote tag at all — "escaped_commit" stayed committed even though
      // the file overall failed on the division-by-zero (probe.log:lexer:unicode-atomicity-state:
      // table present).
      writeMigration('954.probe.sql', 'CREATE TABLE escaped_commit (v int);\nINSERT INTO escaped_commit VALUES (1);\nSELECT $é$--$é$; COMMIT;\nSELECT 1/0;\n');
      const db = pgHarness.knexFor(DB);
      try {
         let thrown = null;
         try {
            await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         } catch (err) {
            thrown = err;
         }
         expect(thrown, 'runMigrate should have refused').to.exist;
         expect(thrown.message).to.match(/plain SQL/);
         const { rows } = await db.raw("SELECT to_regclass('escaped_commit') AS n");
         expect(rows[0].n).to.equal(null);
         const recorded = await db('schemaversion').where({ version: 954 }).first();
         expect(recorded).to.equal(undefined);
      } finally {
         await db.destroy();
      }
   });

   it('N2: applies a migration through the native pg connection — a literal "?" inside a string and inside a dollar-quoted function body survive verbatim', async () => {
      writeMigration(
         '960.literal.sql',
         "CREATE TABLE literal_probe (v text);\nINSERT INTO literal_probe VALUES ('Why?');\nCREATE FUNCTION literal_probe_fn() RETURNS text LANGUAGE sql AS $body$ SELECT 'What?'::text; $body$;\n"
      );
      const db = pgHarness.knexFor(DB);
      try {
         const result = await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         expect(result.applied).to.deep.equal([960]);
         // Pre-N2, knex's positionBindings rewrote bare '?' into '$1'/'$2' even inside a string
         // literal and inside a dollar-quoted function body (verbatim.log: 'Why?' -> 'Why$1',
         // 'What?' -> 'What$2') — silently corrupting stored data, not merely mangling display.
         const row = await db('literal_probe').first();
         expect(row.v).to.equal('Why?');
         const fn = await db.raw('SELECT literal_probe_fn() AS v');
         expect(fn.rows[0].v).to.equal('What?');
      } finally {
         await db.destroy();
      }
   });

   it('N2 (2026-09 second follow-up review): the native connection.query(sql) call and the schemaversion insert run on the exact SAME database transaction', async () => {
      // The verbatim test above only proves CONTENT preservation. This proves the stronger claim
      // migrate.js's own comment makes ("acquire the transaction's own pinned connection"): a
      // trigger on schemaversion captures txid_current() at INSERT time; the migration file
      // captures its own txid_current() into a table it creates. If acquireConnection() had ever
      // handed back a DIFFERENT connection than trx's own, these transaction ids would differ.
      const db = pgHarness.knexFor(DB);
      try {
         await db.raw('CREATE TABLE IF NOT EXISTS schemaversion (version integer PRIMARY KEY, name text, applied_at timestamptz NOT NULL DEFAULT now())');
         await db.raw('CREATE TABLE IF NOT EXISTS version_tx_970 (version int, xid bigint)');
         await db.raw(
            'CREATE OR REPLACE FUNCTION capture_version_tx_970() RETURNS trigger LANGUAGE plpgsql AS $trig$ BEGIN INSERT INTO version_tx_970 VALUES (NEW.version, txid_current()); RETURN NEW; END; $trig$'
         );
         await db.raw('DROP TRIGGER IF EXISTS version_tx_970_trigger ON schemaversion');
         await db.raw('CREATE TRIGGER version_tx_970_trigger AFTER INSERT ON schemaversion FOR EACH ROW EXECUTE FUNCTION capture_version_tx_970()');

         writeMigration('970.same_tx.sql', 'CREATE TABLE native_same_tx_probe AS SELECT txid_current() AS xid;\n');
         const result = await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         expect(result.applied).to.deep.equal([970]);

         const [{ xid: fileXid }] = await db('native_same_tx_probe').select('xid');
         const [{ xid: versionXid }] = await db('version_tx_970').where({ version: 970 }).select('xid');
         expect(String(versionXid)).to.equal(String(fileXid));
      } finally {
         await db.raw('DROP TRIGGER IF EXISTS version_tx_970_trigger ON schemaversion').catch(() => {});
         await db.destroy();
      }
   });

   it('N2 (2026-09 second follow-up review): a failure on the schemaversion INSERT itself still rolls back everything the file already did', async () => {
      // The existing verbatim test only shows a SUCCESSFUL application preserves content. This
      // proves atomicity holds the other direction too: acquiring the transaction's own
      // connection for the native query must not have quietly split file-execution and
      // version-bookkeeping into two independently-committable pieces.
      const db = pgHarness.knexFor(DB);
      try {
         await db.raw('CREATE TABLE IF NOT EXISTS schemaversion (version integer PRIMARY KEY, name text, applied_at timestamptz NOT NULL DEFAULT now())');
         await db.raw('ALTER TABLE schemaversion DROP CONSTRAINT IF EXISTS reject_971');
         await db.raw('ALTER TABLE schemaversion ADD CONSTRAINT reject_971 CHECK (version <> 971)');

         writeMigration('971.version_failure.sql', 'CREATE TABLE native_version_failure_probe (v int);\nINSERT INTO native_version_failure_probe VALUES (1);\n');
         let thrown = null;
         try {
            await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         } catch (err) {
            thrown = err;
         }
         expect(thrown, 'runMigrate should have failed when the version insert violates a constraint').to.exist;
         expect(thrown.message).to.match(/reject_971/);
         const { rows } = await db.raw("SELECT to_regclass('native_version_failure_probe') AS n");
         expect(rows[0].n).to.equal(null);
         const recorded = await db('schemaversion').where({ version: 971 }).first();
         expect(recorded).to.equal(undefined);
      } finally {
         await db.raw('ALTER TABLE schemaversion DROP CONSTRAINT IF EXISTS reject_971').catch(() => {});
         await db.destroy();
      }
   });

   it('a --baseline call racing a normal apply call for the same pending version never double-applies, double-inserts, or errors', async () => {
      writeMigration('951.race.sql', 'CREATE TABLE probe_951_race (id int);\nINSERT INTO probe_951_race VALUES (1);\n');
      const dbHolder = pgHarness.knexFor(DB);
      const dbApply = pgHarness.knexFor(DB);
      const dbBaseline = pgHarness.knexFor(DB);
      const holder = await dbHolder.transaction();
      let committed = false;
      try {
         // Take the SAME advisory lock runMigrate itself takes, so both calls below are forced
         // to queue behind it — deterministically reproducing the race instead of hoping two
         // Promise.all()'d calls happen to overlap (see races.log's baseline-queued/apply-active
         // scenarios, which this fixture is adapted from).
         await holder.raw('SELECT pg_advisory_xact_lock(?)', [MIGRATE_LOCK_KEY]);
         const waiters = async () =>
            Number((await dbHolder.raw("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=? AND NOT granted", [MIGRATE_LOCK_KEY])).rows[0].count);
         const until = async fn => {
            for (let i = 0; i < 500; i++) {
               if (await fn()) return;
               await new Promise(resolve => setTimeout(resolve, 10));
            }
            throw new Error('wait timeout');
         };

         const applyPromise = runMigrate({ db: dbApply, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         await until(async () => (await waiters()) === 1);
         const baselinePromise = runMigrate({ db: dbBaseline, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, baseline: 951, log: () => {} });
         await until(async () => (await waiters()) === 2);

         await holder.commit();
         committed = true;
         const [applyResult, baselineResult] = await Promise.all([applyPromise, baselinePromise]);

         // Exactly one of the two calls is responsible for 951 ending up recorded — never both
         // (which would be a duplicate-key error on schemaversion's PRIMARY KEY) and never
         // neither. Which one wins is a genuine race (Postgres's advisory-lock wait order is not
         // an app-level contract), so this asserts the safety invariant, not a specific winner.
         const versions = await dbHolder('schemaversion').select('version').where({ version: 951 });
         expect(versions).to.have.length(1);
         const appliedIt = Array.isArray(applyResult.applied) && applyResult.applied.includes(951);
         const baselinedIt = Array.isArray(baselineResult.baselined) && baselineResult.baselined.includes(951);
         expect(appliedIt || baselinedIt, `expected exactly one winner, got applyResult=${JSON.stringify(applyResult)} baselineResult=${JSON.stringify(baselineResult)}`).to.equal(true);
         expect(appliedIt && baselinedIt, 'both calls claimed 951 — double-applied').to.equal(false);
      } finally {
         if (!committed) await holder.rollback();
         await dbHolder.destroy();
         await dbApply.destroy();
         await dbBaseline.destroy();
      }
   });

   it('F4: refuses to run against a database whose name or host looks like production', async () => {
      const db = pgHarness.knexFor(DB);
      try {
         let thrown = null;
         try {
            await runMigrate({ db, dbName: 'ds2_production', host: '127.0.0.1', migrationsDir: fixtureDir, log: () => {} });
         } catch (err) {
            thrown = err;
         }
         expect(thrown, 'runMigrate should have refused a prod-looking name').to.exist;
         expect(thrown.message).to.match(/production-looking/);
      } finally {
         await db.destroy();
      }
   });

   it('applies pending migrations in version order and records them, then is a no-op on rerun', async () => {
      writeMigration('920.a.sql', 'CREATE TABLE probe_920 (id int);\n');
      writeMigration('921.b.sql', 'CREATE TABLE probe_921 (id int);\n');
      const db = pgHarness.knexFor(DB);
      try {
         const first = await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         expect(first.applied).to.deep.equal([920, 921]);
         const second = await runMigrate({ db, dbName: DB, host: pgHarness.HOST, migrationsDir: fixtureDir, log: () => {} });
         expect(second.applied).to.deep.equal([]);
      } finally {
         await db.destroy();
      }
   });
});

describe('scripts/migrate.js — listMigrations', () => {
   it('parses NNN.description.sql filenames and sorts by version, ignoring do/undo files', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds2-mig-list-'));
      try {
         fs.writeFileSync(path.join(dir, '019.ledger_data_normalization.sql'), '');
         fs.writeFileSync(path.join(dir, '002.foo.sql'), '');
         fs.writeFileSync(path.join(dir, '002.do.foo.sql'), ''); // postgrator-style, must be ignored
         fs.writeFileSync(path.join(dir, 'tables.sql'), ''); // non-numbered, must be ignored
         const migrations = listMigrations(dir);
         expect(migrations.map(m => m.version)).to.deep.equal([2, 19]);
      } finally {
         fs.rmSync(dir, { recursive: true, force: true });
      }
   });
});
