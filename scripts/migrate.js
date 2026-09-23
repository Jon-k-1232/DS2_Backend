/* eslint-disable no-console */
/*
   Minimal migration runner for DS2 (replaces postgrator, which silently applies
   nothing because our files are named NNN.name.sql, not NNN.do.name.sql).

   Usage:
      npm run migrate                       # apply every pending migrations/NNN.*.sql in order
      node scripts/migrate.js --dry-run     # list what would run (read-only: never writes, see below)
      node scripts/migrate.js --baseline 19 # record 001..019 as applied WITHOUT running them
                                            # (use once on a database that was migrated by hand)

   Connection: DS2_ENV_FILE (default .env.dev) → DB_DEV_HOST/DB_DEV_PORT/DATABASE_USER/
   DATABASE_PASSWORD/DATABASE_NAME/DB_SSL_DISABLE. Refuses to run against anything that LOOKS
   like production — database name OR host matching /prod/i (not just the exact string
   'ds2_prod' — see looksLikeProd) — prod is migrated by hand with psql -f, see
   migrations/README.md.

   Bookkeeping table: schemaversion(version int primary key, name text, applied_at timestamptz).
   A single Postgres advisory lock (MIGRATE_LOCK_KEY) serializes EVERY runner of this DB against
   every other one — bootstrapping/checking the schemaversion table, recording a --baseline, and
   applying each pending file all take it, so two runners started at the same instant against a
   brand-new database can't both try to CREATE TABLE schemaversion or double-insert a version row.

   --dry-run never writes: it opens its one lookup transaction with SET TRANSACTION READ ONLY and
   skips creating schemaversion when the table doesn't exist yet (an empty "applied" set is used
   instead) — the postgres server itself refuses any write attempted under it, this isn't just a
   local skip flag. A fresh database dry-run leaves no schemaversion table at all.

   FILE CONTRACT: numbered migrations/NNN.*.sql files are plain SQL. No BEGIN;/COMMIT;/
   START TRANSACTION;/END; line and no psql meta-command (a line starting with \) OUTSIDE a
   dollar-quoted block — see assertPlainSql. Files are sent to Postgres byte-for-byte: this
   runner used to strip lines matching those keywords from the whole file, which corrupted any
   dollar-quoted PL/pgSQL function body containing its own BEGIN/END and any multi-line string
   literal that happened to contain one of those words on its own line. Each file still runs
   inside ONE runner-owned transaction together with its schemaversion row (so a crash can never
   leave a migration applied but unrecorded) — which is exactly why a file may not bring its own
   BEGIN/COMMIT: that would end the wrapper transaction early and let a later statement run
   uncommitted / unrecorded. A file that violates the contract is refused outright, not silently
   miscompiled.
*/
const fs = require('fs');
const path = require('path');
const { makeDb } = require('./_db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const FILE_RE = /^(\d{3})\.(?!do\.|undo\.)(.+)\.sql$/;
// Arbitrary constant shared by every runner of this repo. Guards schemaversion
// bootstrap/baseline AND every per-file apply — see header comment.
const MIGRATE_LOCK_KEY = 20260922;

const listMigrations = (migrationsDir = MIGRATIONS_DIR) =>
   fs
      .readdirSync(migrationsDir)
      .map(f => {
         const m = FILE_RE.exec(f);
         return m ? { version: Number(m[1]), name: m[2], file: path.join(migrationsDir, f) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.version - b.version);

/**
 * Database name or host that LOOKS like production. Substring match, case-insensitive: the old
 * guard (`dbName === 'ds2_prod'`) missed a differently-named production database (e.g.
 * 'ds2_production') and said nothing about the host, so a dev-named database that happened to
 * be pointed at a production host (wrong DB_DEV_HOST, copy/paste error, …) sailed through.
 */
const looksLikeProd = (dbName, host) => /prod/i.test(String(dbName || '')) || /prod/i.test(String(host || ''));

// ── file contract: plain SQL, no txn control / meta-commands outside $$ quotes ──────────────

const DOLLAR_TAG_RE = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;

/**
 * Split `sql` into `{ text, inside }` segments, `inside` true only for the interior of a
 * dollar-quoted block (`$$...$$` or `$tag$...$tag$`) — the delimiter tags themselves are counted
 * as part of the "inside" segment, which is harmless (a bare `$$` is never mistaken for
 * BEGIN/COMMIT/END). A `$x$` token that doesn't match the currently-open tag is ordinary content
 * inside that quote (Postgres itself requires matching tags to close a dollar-quoted string).
 */
const splitOutsideDollarQuotes = sql => {
   const segments = [];
   let cursor = 0;
   let openTag = null;
   DOLLAR_TAG_RE.lastIndex = 0;
   let match;
   while ((match = DOLLAR_TAG_RE.exec(sql))) {
      const tag = match[0];
      if (openTag === null) {
         segments.push({ text: sql.slice(cursor, match.index), inside: false });
         cursor = match.index;
         openTag = tag;
      } else if (tag === openTag) {
         segments.push({ text: sql.slice(cursor, match.index + tag.length), inside: true });
         cursor = match.index + tag.length;
         openTag = null;
      }
   }
   segments.push({ text: sql.slice(cursor), inside: openTag !== null });
   return segments;
};

const FORBIDDEN_LINE_RE = /^[ \t]*(BEGIN|COMMIT|START\s+TRANSACTION|END)[ \t]*;[ \t]*$/i;
const META_COMMAND_RE = /^[ \t]*\\/;

/**
 * Refuse a migration file that is not plain SQL, per the FILE CONTRACT in the header comment:
 * a STATEMENT (not just a line) that starts with BEGIN/COMMIT/END/ROLLBACK/ABORT/SAVEPOINT/
 * RELEASE/START TRANSACTION/PREPARE TRANSACTION/SET [LOCAL|SESSION] TRANSACTION/SET
 * standard_conforming_strings (transaction control, or a setting that could change how the rest
 * of the file is interpreted — the runner owns the wrapper transaction, so a file bringing its
 * own would end it early), or any psql `\` meta-command.
 *
 * N1 fix (2026-09 follow-up review): this used to be a per-LINE regex scan (see
 * splitOutsideDollarQuotes below, now unused by this function but left in place), which a
 * bypass could defeat with a trailing comment (`COMMIT; -- comment`), a CRLF line ending
 * (`COMMIT;\r\n` — the old regex anchored on `;[ \t]*$`), two statements on one line
 * (`SELECT 1; COMMIT;`), or a `$body$`-shaped token sitting inside an ORDINARY comment or string
 * earlier in the file; it also over-refused an ordinary block comment that merely mentioned
 * `BEGIN;` in prose. The real fix is a real lexer — strip comments and quoted/dollar-quoted
 * tokens first, then split on `;` and check each statement's own first keyword — now in
 * ./plain-sql.js (kept in its own module so it can be unit-tested exhaustively on its own; see
 * test/scripts/migrate.spec.js).
 */
const assertPlainSql = require('./plain-sql');

// ── --baseline argument ──────────────────────────────────────────────────────

/** --baseline must name an existing migration version, or 0 (nothing applied yet). */
const validateBaseline = (baseline, migrations) => {
   if (baseline == null) return;
   if (!Number.isInteger(baseline) || baseline < 0 || (baseline !== 0 && !migrations.some(m => m.version === baseline))) {
      throw new Error(`--baseline must be 0 or an existing migration version (got ${baseline}). Known versions: ${migrations.map(m => m.version).join(', ') || '(none found)'}`);
   }
};

// ── core runner ───────────────────────────────────────────────────────────────
// No process.exit / process.argv / console beyond the injectable `log` — testable directly
// against any connected knex instance. Throws on any failure; the CLI wrapper below turns
// that into a nonzero exit.

/**
 * `dbName`/`host` are passed explicitly (rather than read off `db.client.config`) so a caller —
 * including a test — can exercise the prod guard independently of the real connection.
 */
const runMigrate = async ({ db, dbName, host, dryRun = false, baseline = null, migrationsDir = MIGRATIONS_DIR, log = console.log }) => {
   if (looksLikeProd(dbName, host)) {
      throw new Error(`Refusing a production-looking database name ("${dbName}") or host ("${host}"). Apply migrations by hand — see migrations/README.md.`);
   }

   const migrations = listMigrations(migrationsDir);
   validateBaseline(baseline, migrations);

   let baselineRows = [];
   const applied = await db.transaction(async trx => {
      // Serializes EVERY runner of this database for the whole bootstrap-or-check step below
      // (and the baseline insert, when requested) — not just the per-file apply loop further
      // down, which takes the same lock again per file. This is what makes two first-time
      // runners racing the schemaversion CREATE TABLE safe (see header comment).
      await trx.raw('SELECT pg_advisory_xact_lock(?)', [MIGRATE_LOCK_KEY]);
      // Order matters: Postgres only accepts SET TRANSACTION [READ ONLY] before any
      // data-modifying statement of the transaction — pg_advisory_xact_lock is a plain
      // SELECT, so it's fine to run first as long as it isn't one.
      if (dryRun) await trx.raw('SET TRANSACTION READ ONLY');

      const { rows } = await trx.raw("SELECT to_regclass('schemaversion') AS name");
      const tableExists = Boolean(rows[0] && rows[0].name);
      if (!tableExists && !dryRun) {
         await trx.raw('CREATE TABLE schemaversion (version integer PRIMARY KEY, name text, applied_at timestamptz NOT NULL DEFAULT now())');
      }
      // dry-run against a database with no schemaversion table yet: nothing is "applied" —
      // never create the table just to answer that question.
      const versions = new Set(tableExists || !dryRun ? (await trx('schemaversion').select('version')).map(r => Number(r.version)) : []);

      if (baseline != null) {
         baselineRows = migrations.filter(m => m.version <= baseline && !versions.has(m.version)).map(m => ({ version: m.version, name: m.name }));
         if (!dryRun && baselineRows.length) await trx('schemaversion').insert(baselineRows);
      }
      return versions;
   });

   if (baseline != null) {
      log(`Baseline: ${dryRun ? 'would record' : 'recorded'} ${baselineRows.length} migration(s) ≤ ${String(baseline).padStart(3, '0')}${dryRun ? ' (dry run)' : ''} on ${dbName}.`);
      return { baselined: baselineRows.map(r => r.version) };
   }

   const pending = migrations.filter(m => !applied.has(m.version));
   if (!pending.length) {
      log(`${dbName}: no pending migrations (highest applied ${Math.max(0, ...applied)}).`);
      return { applied: [] };
   }

   const appliedNow = [];
   for (const m of pending) {
      const label = `${String(m.version).padStart(3, '0')}.${m.name}`;
      if (dryRun) {
         log(`would apply ${label}`);
         continue;
      }
      const sql = fs.readFileSync(m.file, 'utf8');
      assertPlainSql(sql, label);
      try {
         await db.transaction(async trx => {
            await trx.raw('SELECT pg_advisory_xact_lock(?)', [MIGRATE_LOCK_KEY]);
            const already = await trx('schemaversion').where({ version: m.version }).first();
            if (already) {
               log(`skip ${label} (recorded by another runner)`);
               return;
            }
            // N2 fix (2026-09 follow-up review): trx.raw(sql) runs the file through knex's
            // PostgreSQL query compiler, which rewrites bare `?` characters into positional
            // bindings (`$1`, `$2`, ...) — even ones sitting inside an ordinary string literal or
            // a dollar-quoted function body, silently corrupting the stored data (verbatim.log:
            // 'Why?' became 'Why$1', a $body$...$body$ function body's 'What?' became 'What$2').
            // Go around knex's compiler entirely: acquire the transaction's own pinned connection
            // and hand the SQL straight to node-pg, which does no rewriting of its own.
            await trx.raw('SET LOCAL standard_conforming_strings = on');
            const connection = await trx.client.acquireConnection();
            await connection.query(sql); // Native pg: preserve '?' and backslashes verbatim.
            await trx('schemaversion').insert({ version: m.version, name: m.name });
            log(`applied ${label}`);
            appliedNow.push(m.version);
         });
      } catch (err) {
         throw new Error(`FAILED ${label}: ${err.message}`);
      }
   }
   return { applied: appliedNow };
};

module.exports = {
   listMigrations,
   looksLikeProd,
   splitOutsideDollarQuotes,
   assertPlainSql,
   validateBaseline,
   runMigrate,
   MIGRATE_LOCK_KEY,
   MIGRATIONS_DIR
};

if (require.main === module) {
   (async () => {
      const args = process.argv.slice(2);
      const dryRun = args.includes('--dry-run');
      const baselineIdx = args.indexOf('--baseline');
      const baseline = baselineIdx >= 0 ? Number(args[baselineIdx + 1]) : null;

      const db = makeDb({ envFile: process.env.DS2_ENV_FILE || '.env.dev', database: process.env.DATABASE_NAME || 'ds2_dev', poolMax: 2 });
      const dbName = db.client.config.connection.database;
      const host = db.client.config.connection.host;
      try {
         await runMigrate({ db, dbName, host, dryRun, baseline });
      } catch (err) {
         console.error(err.message || err);
         await db.destroy();
         process.exit(/^Refusing/.test(err.message || '') ? 2 : 1);
      }
      await db.destroy();
   })().catch(err => {
      console.error(err);
      process.exit(1);
   });
}
