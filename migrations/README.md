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

- **`NNN.description.sql`** (`002`–`020`) — incremental migrations, applied on
  top of `tables.sql`. There is no `001` file; that's expected and harmless
  (see "Historical: why this isn't postgrator anymore" below, which covers
  the version-sequence gap too) — `tables.sql` is what `001` would have been,
  applied once by hand when a database is first created, not through any
  runner.

## File contract: numbered migrations are plain SQL

`002`–`020` must be plain SQL — **no `BEGIN;` / `COMMIT;` / `START
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
  — nothing records which of `002`–`020` have already been run there, so
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

  **Migration `019`'s total_payments sign flip is fail-closed per row:** it
  flips only the rows listed in the manifest block between the
  `-- accountant-reviewed rows go here` and `-- end of accountant-reviewed rows`
  markers, and only while the live row still matches every expected value in
  its manifest entry (owner, old total, signed net, exact payment-id set, no
  reversal event, no foreign ownership in the chain). The shipped block holds
  the **904 rows reviewed on 2026-09-23** from the 2026-09-22 production
  snapshot (`scripts/review-2026-09/manifest-2026-09-22/` has the review CSV,
  the generator's untouched output and the 14 exceptions left for the
  accountant; the block's own header comment records the decision basis).
  Rehearsed against a clone of that snapshot: 904 APPLIED / 0 SKIPPED. A row
  whose live data drifted since the snapshot is skipped silently and stays on
  the `019-review` list, which is why the rehearsal audit SELECT above must be
  saved and compared against the manifest before the committing run. A
  row is also refused live when a `[reversal of payment #id]` note anywhere
  on the account names one of its payments (the generator only *flags* that
  shape as `possible_misattributed_reversal`; a positive event on the row's
  own chain is excluded outright by both). Regenerating after a newer
  snapshot is **not** a mechanical replace: it needs a new documented
  adoption decision — run the generator against the new copy, strike or
  first resolve every flagged row (the generator emits flagged rows into its
  INSERT block too), re-check the criteria in the block's header comment,
  record the decision in a new `scripts/review-2026-09/manifest-<date>/README.md`,
  then replace the block. The generator command:
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

Inspected every file in `002`–`020` for what happens if it's run a second
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
`020.accounts_storage_slug.sql` is also genuinely idempotent, confirmed the
same way (test/scripts/migration-020.spec.js runs it two and three times in a
row against the same database and asserts zero drift): the `ADD COLUMN`/
`CREATE UNIQUE INDEX` lines use `IF NOT EXISTS`, the backfill only targets
rows where `storage_slug IS NULL`, and the collision-resolution step
recomputes collisions from whatever the CURRENT (already-resolved) values
are, so a value that was already made unique on a prior run is never
revisited or reshuffled. That collision-resolution step is a `DO $$ ... $$`
PL/pgSQL loop (added review/full-audit-2026-09 finding 4, Astra round 10),
not the single `UPDATE ... FROM (WITH collisions AS (...))` it started as —
the original single-pass version computed every "resolved" slug from one
static snapshot and never re-checked a suffixed candidate against the table
again, so it could hand two DIFFERENT accounts the same slug (accounts 100
'R10 Foo', 101 'R10_Foo', 102 'R10_Foo_101': 101's naive `_101` suffix landed
on 102's own pre-existing bare slug), which then failed the `CREATE UNIQUE
INDEX` below and rolled back the WHOLE migration inside the `psql -X -1`
transaction. The loop instead resolves one colliding row at a time, in
ascending `account_id` order, walking `_<id>`, then `_<id>_2`, `_<id>_3`, ...
until it finds a candidate nothing else in the table currently holds — see
the migration file's own header comment and
`test/scripts/migration-020.spec.js`'s "cross-collision resolution" describe
block (Astra's exact reproduction, plus a three-way `_<id>_2`/`_<id>_3`
escalation). It is still a `DO` block, not a bare statement, so it remains
plain SQL under this file's contract (the dollar-quoted body is one opaque
token to `scripts/plain-sql.js`'s lexer — see that file's own header
comment) and still runs inside `scripts/migrate.js`'s / `psql -X -1`'s single
transaction, so a failure anywhere in it still rolls back the entire file,
not just this step. The real prod snapshot (`ds2_ref_20260922`) has exactly
one account and cannot hit this at all — confirmed by rehearsing this
migration twice against a fresh `CREATE DATABASE ... TEMPLATE
ds2_ref_20260922` clone (`psql -X -1 -v ON_ERROR_STOP=1 -f`): first run
backfills account 1 to its existing `James_F__Kimmel___Associates` slug,
second run is a byte-for-byte no-op.

The equivalent runtime allocator for a BRAND-NEW account
(`resolveNewAccountStorageSlug` in `src/utils/storageSlug.js`, called from
`account-service.js`'s `createAccount`) had the same two problems (Astra
round 10, findings 3 and 4): concurrently creating two accounts whose names
sanitize to the SAME base ('R10 Race' / 'R10_Race') let both transactions
read the base slug as free before either had inserted, so both tried to
insert it and one hit `23505`; and even run strictly sequentially, always
trying exactly one `_<id>` candidate with no re-check could still collide
with an unrelated, already-existing account's own bare slug and fail
outright. Fixed with a `pg_advisory_xact_lock` held for the rest of the
creating transaction (serializing allocation the same way
`scripts/migrate.js`'s own `MIGRATE_LOCK_KEY` serializes migration runs) plus
the same walk-until-free candidate search as the loop above, and a
retry-once-after-relocking in `createAccount` as a last-line-of-defence
against the UNIQUE index — see
`test/integration/coverage-account-users-auth-misc.integration.spec.js`'s
`POST /account/createAccount` tests for the two-connection regression and
the occupied-suffixed-candidate regression.

**Cutover order matters for `020` specifically, more than for a typical
additive column.** Deploy it as a genuine two-step, back-to-back cutover,
not "sometime before the next deploy":

1. Apply `020` to the target database (`psql -X -1 -v ON_ERROR_STOP=1 -f
   migrations/020.accounts_storage_slug.sql`) — additive and idempotent, safe
   to run with the OLD backend code still serving traffic (the old code never
   references `storage_slug` at all, so it neither reads nor writes it).
2. Deploy the new backend immediately after, with **no account creation in
   between**. The OLD `account-service.js` inserts a new `accounts` row
   without a `storage_slug` value; before `020`, that's fine (the column
   doesn't exist yet), but the moment `020` has run, that same old INSERT
   fails outright on the new `storage_slug NOT NULL` constraint — a clear,
   loud 500 on `POST /account/createAccount`, not silent corruption or a
   missing/incorrect S3 namespace, but still an avoidable outage for a
   route that (per account-router.js's own comment) has no real caller in
   the current frontend anyway. The NEW backend code requires the column to
   already exist (`resolveNewAccountStorageSlug` reads/writes it
   unconditionally). Neither ordering below is safe to leave in place for
   any length of time: new code before `020` → every `createAccount` 500s on
   `column "storage_slug" does not exist`; old code after `020` with a
   create attempted in the gap → that one attempt 500s on the NOT NULL
   violation above. **Deliberately no default and no trigger were added to
   paper over this gap** — a default would let the OLD code silently insert
   a row with a placeholder/duplicate-prone slug that the NEW code would
   then treat as a real, immutable namespace forever.

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
