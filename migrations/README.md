# migrations/

## What the files in this directory are

- **`tables.sql`** — the original hand-written base schema ("DS2 Combined
  Schema (final state)"). It was last regenerated 2026-05-26 and reflects the
  schema through roughly migration `016`; it does **not** include `017` or
  `018` (both dated 2026-06-10, after tables.sql's own timestamp), and it
  predates `019` (added 2026-09-22). Treat it as a historical bootstrap
  snapshot, not a live reference — see the drift note below.

- **`schema-snapshot-2026-09-22.sql`** — the **authoritative current schema**,
  generated straight from the prod copy on the local sandbox:
  ```
  PGPASSWORD=ds2ro pg_dump -h 127.0.0.1 -p 5433 -U ds2_ro -d ds2_local \
    --schema-only --no-owner --no-acl > migrations/schema-snapshot-2026-09-22.sql
  ```
  `ds2_local` (sandbox, port 5433) is a pg_dump of prod taken 2026-09-22, so
  this file is what prod's schema actually is today — 32 tables, including
  everything `tables.sql` is missing (`customer_rate_agreements`,
  `account_audits`'s narrative/pdf/app-balance columns, the core ledger
  indexes from `017`, etc.). When you need to know the *real* current shape
  of a table, read this file, not `tables.sql`. It's also the base every
  throwaway `ds2_mig_test_*` database is built from for local testing (see
  `test/scripts/helpers/pgHarness.js`).

- **`NNN.description.sql`** (`002`–`019`) — incremental migrations, applied on
  top of `tables.sql`. There is no `001` file; that's expected and harmless
  (see "Historical: why this isn't postgrator anymore" below, which covers
  the version-sequence gap too) — `tables.sql` is what `001` would have been,
  applied once by hand when a database is first created, not through any
  runner.

## File contract: numbered migrations are plain SQL

`002`–`019` must be plain SQL — **no `BEGIN;` / `COMMIT;` / `START
TRANSACTION;` / `END;` line and no psql `\`-meta-command**, outside a
dollar-quoted (`$$...$$`/`$tag$...$tag$`) block. `scripts/migrate.js` owns
the transaction wrapper for every file it runs (together with that file's
`schemaversion` row, so a crash can never leave a migration applied but
unrecorded) and now **sends each file to Postgres byte-for-byte** — no line
stripping. An earlier version of the runner stripped lines that looked like
transaction control, which corrupted any dollar-quoted PL/pgSQL function body
containing its own `BEGIN`/`END` and any multi-line string literal that
happened to contain one of those words on its own line. The runner now
**refuses** (clear error, migration not applied) any file that violates the
contract instead of silently mis-executing it — see `assertPlainSql` in
`scripts/migrate.js`. Applying a file by hand needs the same effect from
`psql` itself: `psql -X -1 -v ON_ERROR_STOP=1 -f migrations/NNN....sql`
(`-1`/`--single-transaction` wraps the whole file in one implicit
`BEGIN`/`COMMIT`, `-X` skips `~/.psqlrc`, `ON_ERROR_STOP=1` stops on the first
error instead of plowing on). `019` in particular takes a table lock
(`LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE`) that only protects the rest of
the file for as long as it's inside a real transaction — always use `-X -1`
with it.

## How migrations are applied

- **Prod (`ds2_prod`)** — always **by hand**, never through `npm run
  migrate`: for each file in order,
  ```
  PGPASSWORD=... psql -h <rds> -U <user> -d ds2_prod -X -1 -v ON_ERROR_STOP=1 -f migrations/NNN.description.sql
  ```
  This command **commits automatically on success** (`-1`/`--single-transaction` is an implicit
  `BEGIN`/`COMMIT` around the whole file, not a dry run). For `019` specifically, review the
  counts it would print first, in a separate rollback rehearsal against the same approved file:
  ```
  PGPASSWORD=... psql -h <rds> -U <user> -d ds2_prod -X -v ON_ERROR_STOP=1 \
    -c BEGIN -f migrations/019.ledger_data_normalization.sql \
    -c "SELECT m.root_id, l.old_value, l.new_value, CASE WHEN l.log_id IS NULL THEN 'SKIPPED' ELSE 'APPLIED' END AS rehearsal_result FROM _m019_reviewed m LEFT JOIN ledger_normalization_log l ON l.migration='019' AND l.table_name='customer_invoices' AND l.column_name='total_payments' AND l.row_id=m.root_id AND l.applied_at=transaction_timestamp() ORDER BY m.root_id" \
    -c ROLLBACK
  ```
  R3 fix (2026-09 second follow-up review): the earlier version of this command rolled back
  before printing anything queryable — `ROLLBACK` also discards the very
  `ledger_normalization_log` rows the paragraph below tells you to inspect, so there was nothing
  left to check by the time the command returned (verified: after a `BEGIN`/file/`ROLLBACK` with
  no audit `SELECT` in between, the eligible row's log count is zero even though the migration DID
  apply and log it before the rollback undid it). The `-c "SELECT ..."` above runs **inside** the
  still-open transaction, after the file and before `ROLLBACK`, so it captures each approved root
  id's `APPLIED`/`SKIPPED` result from the real `_m019_reviewed`/`ledger_normalization_log` state
  while it still exists. **Save that command's output** (redirect it, copy it, whatever your
  process needs) — it is the only record of the rehearsal once `ROLLBACK` runs.

  Check every approved id against that captured audit output, including
  any row the rehearsal SKIPPED because its manifest expectations no longer matched live data —
  a skip is silent (no error), so the only way to know is to compare the manifest against what
  the rehearsal actually logged. The rehearsal takes the same `LOCK TABLE ... IN SHARE ROW
  EXCLUSIVE MODE` as the real run (it's the same file), which blocks other writers to those
  tables for as long as it holds the lock — arrange a maintenance window for it too, not just for
  the committing run.

  This applies to prod's hand-apply process specifically, because prod has no version tracking
  at all (see below) — but the same caution matters on a `schemaversion`-tracked database too:
  pasting new approval rows into `019` **after** a tracked runner has already recorded version
  `19` does not make `019` pending again. `npm run migrate` only ever looks at whether a version
  number is present in `schemaversion`, never at whether the file's own contents changed since —
  it will skip an already-recorded `019` even though the newly-pasted rows have never run. Apply
  the new rows with a separately reviewed follow-up migration, or by hand (`psql -f`, same as
  prod) against that specific database.

  Take a backup first. Prod has **no `schemaversion` tracking table at all**
  — nothing records which of `002`–`019` have already been run there, so
  whoever applies a migration by hand has to know the current state
  themselves. This is also why the several non-idempotent files below are a
  real hazard on prod specifically: a tracked runner would normally refuse to
  re-run an already-applied version, but a manual `psql -f` has no such
  guard. `scripts/migrate.js` hard-refuses to run at all when the resolved
  database name **or host** looks like production (case-insensitive `/prod/i`
  — not just the exact string `ds2_prod`; see `looksLikeProd`), so `npm run
  migrate` rejects those names. This name heuristic does not establish the
  server's real identity — it only catches a name or host that *looks* like
  production; a production server reachable through an opaque, non-matching
  hostname (or a differently-named database that happens to point at prod)
  still needs independent verification before anyone runs anything against
  it.

  **Migration `019`'s total_payments sign flip ships fail-closed:** the
  manifest temp table it reads from (`_m019_reviewed`) starts **empty** in
  this file, so `019` flips **zero** `total_payments` rows anywhere —
  including on prod — until an accountant has reviewed the candidates and a
  reviewed block of `INSERT INTO _m019_reviewed (...) VALUES (...)` rows has
  been pasted in below the `-- accountant-reviewed rows go here` marker.
  Generate the candidate CSV and the matching (still unreviewed) SQL with:
  ```
  DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/positive-total-payments-manifest.js
  ```
  which is read-only and writes into `scripts/review-2026-09/out/`
  (gitignored). Every other step in `019` (transaction_type casing, literal
  `'null'`/`'undefined'` cleanup) is unconditional and runs every time
  regardless of the manifest.

- **Dev (`ds2_dev`) / sandbox** — runs via `npm run migrate`
  (`scripts/migrate.js`, see below). Refuses to touch anything
  production-looking, records what it applies in a `schemaversion` table, and
  is safe to run repeatedly — pending migrations are applied in order, and
  running it again with nothing pending is a no-op.

### Historical: why this isn't `postgrator` anymore

This project used to run `npm run migrate` through `postgrator`
(`postgrator-cli` v7), and that no longer works for a naming reason that has
nothing to do with connection settings: **postgrator requires each file to be
named `<version>.<do|undo>.<description>.sql`.**
`node_modules/postgrator/postgrator.js` (`getMigrations()`) splits every
migration's basename on `.` and only treats it as runnable when the 2nd
segment is literally `do` (or `undo` for rollbacks) — see
`getRunnableMigrations()`'s `migration.action === "do"` filter. Every file in
this directory is named `NNN.description.sql`, i.e. the 2nd segment is the
description, never the literal string `do`. Verified directly (not just read
from source): pointed a fixed `postgrator-config.js` at a fresh throwaway
database, ran `npm run migrate`, and it completed with exit 0 having created
only the bookkeeping `schemaversion` table (`version=0`) — none of
`002`–`019`'s actual `CREATE TABLE`/`ALTER TABLE` ran. No error, no rows
changed, looks like success: a silent no-op.

Fixing that for real would need one of, both out of scope for a data-only
review pass (migration file renames and dependency version pins touch every
migration filename and deserve their own reviewed change):
1. Rename `002.description.sql` → `002.do.description.sql` for every file, or
2. Pin `postgrator`/`postgrator-cli` to a version whose parser accepts the
   current two-part naming (the `do`/`undo` requirement appears to predate
   this project's earliest migrations, going back at least to v3, so there
   may not be a version that helps without also dropping other v7 fixes this
   project wants — check before relying on this).

`postgrator-config.js` still exists (with its own prod refusal and correct
connection settings) in case a future pass revives postgrator via one of the
two fixes above, but **`npm run migrate` does not invoke it** — see the next
section. Until/unless postgrator comes back, `scripts/migrate.js` is the only
thing that runs these files automatically.

postgrator also has no notion of a contiguous version sequence —
`getMaxVersion()` just takes `Math.max()` over whatever version numbers its
glob finds, and there's no file numbered `001` in this directory (`tables.sql`
covers that ground instead, applied once by hand outside any runner). Neither
postgrator nor `scripts/migrate.js` cares about that gap; against a database
at version 0, `002` is simply treated as the first migration above the
current version.

## Known non-idempotent migrations

Inspected every file in `002`–`019` for what happens if it's run a second
time against a database where it already applied cleanly (the scenario that
matters most for prod's by-hand `psql -f` process, which has no tracking
table to prevent a re-run):

| File | Re-run behavior |
|---|---|
| `002.add_ai_time_tracker_transaction_suggestions.sql` | **Errors.** Bare `CREATE TABLE` — no `IF NOT EXISTS`. |
| `007.create_customer_payments_processed.sql` | **Runs clean but destroys data.** Starts with an unconditional `DROP TABLE IF EXISTS customer_payments_processed` before recreating it — a second run silently wipes every row (pending-payment review queue) rather than erroring. The one file here where "idempotent" (no error) would be the wrong thing to want. |
| `009.timesheet_entries_holding_columns.sql` | **Errors.** Four `ADD COLUMN` clauses with no `IF NOT EXISTS`. (Its own backfill `UPDATE ... WHERE hold_reason IS NULL` is fine in isolation — it just never gets reached on a re-run.) |
| `010.create_ai_call_log_and_notifications.sql` | **Errors.** Three bare `CREATE TABLE` (`ai_call_log`, `notifications`, `template_downloads`) plus a bare `ALTER TABLE accounts ADD COLUMN`. |
| `013.create_account_audits.sql` | **Errors.** Bare `CREATE TABLE`. |
| `014.account_audits_add_narrative_and_pdf.sql` | **Errors.** Eight `ADD COLUMN` clauses, no `IF NOT EXISTS`. |
| `015.account_audits_add_app_balance.sql` | **Errors.** Two `ADD COLUMN` clauses, no `IF NOT EXISTS`. |

Everything else (`003`, `004`, `005`, `006`, `008`, `011`, `012`, `016`,
`017`, `018`) either uses `IF NOT EXISTS` / `IF EXISTS` throughout, or (in
`008`'s case, an `ALTER COLUMN ... TYPE`) is naturally a no-op to re-run.
`019.ledger_data_normalization.sql` is a set of bulk `UPDATE`s that only ever
touch rows still in the "before" state (and a manifest-gated flip that only
ever matches a row still at its expected old value), so it's genuinely
idempotent as its own header comment claims — confirmed by reading each
`WHERE` clause, not just taking the comment's word for it, and by applying it
twice in a row against a throwaway database (second run: zero rows changed,
zero new audit-log rows).

Practical takeaway: a `psql -f` that's run twice by accident against prod
will *mostly* fail loudly (relation/column already exists) rather than
corrupt anything — annoying but safe — **except `007`**, which needs a
"has this already run?" check before anyone re-runs it by hand.

## `npm run migrate` runs `scripts/migrate.js` (2026-09-22, revised 2026-09-23)

postgrator was dropped from the npm script because it only recognises
`NNN.do.name.sql` files and therefore never applied any of ours (see
"Historical: why this isn't postgrator anymore" above). `scripts/migrate.js`
applies every pending `migrations/NNN.name.sql` in order and records each in
a `schemaversion(version, name, applied_at)` table.

```bash
DS2_ENV_FILE=.env.dev npm run migrate                 # apply pending migrations to ds2_dev
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/migrate.js --dry-run
DS2_ENV_FILE=.env.dev node scripts/migrate.js --baseline 18   # once: mark 001..018 applied on a hand-migrated DB
```

Run `--baseline <highest applied>` exactly once on any database that was
migrated by hand before this runner existed (dev is at `018` as of
2026-06-10; prod is never migrated by this script). `--baseline` validates
its argument: it must be `0` or an existing migration version, and (like
every other write path below) it takes the same advisory lock a normal run
does, so it's safe to race against another runner instead of double-inserting
a `schemaversion` row.

What it guarantees, as of the 2026-09-23 revision:
- **Refuses anything production-looking.** Database name *or* host matching
  `/prod/i`, not just the exact string `ds2_prod` — see `looksLikeProd`.
- **`--dry-run` never writes.** Its one lookup transaction runs under `SET
  TRANSACTION READ ONLY` (Postgres itself refuses any write attempted inside
  it — this isn't just a local `if` check), and it never creates the
  `schemaversion` table just to answer "what's pending" — a dry run against a
  brand-new database leaves the database exactly as it found it, including no
  `schemaversion` table.
- **One advisory lock serializes every runner of a database**, for
  bootstrapping/checking `schemaversion`, recording a `--baseline`, and
  applying each pending file — not just the per-file loop. Two runners
  started at the same instant against a brand-new database can't both try to
  `CREATE TABLE schemaversion` or double-insert a version row.
- **Files are sent verbatim** and must satisfy the file contract above
  (`assertPlainSql`) — a file that doesn't is refused outright rather than
  silently corrupted by line-stripping.
