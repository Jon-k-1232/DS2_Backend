-- review/full-audit-2026-09 finding 1 (Astra round 9): renaming an account
-- defeated invoice/logo S3 ownership checks. downloadAuthorization.js derived
-- the S3 prefix an account is allowed to read/write by re-sanitizing its
-- CURRENT, mutable account_name (sanitizeAccountName in src/utils/
-- invoicePath.js) on every request. An authenticated account-9001 admin
-- renamed their own account to a different string that sanitizes to the SAME
-- slug as account 1 ("James_F__Kimmel___Associates") and immediately inherited
-- account 1's S3 namespace: a foreign invoice key went from 403/zero S3 calls
-- to 200 with account 1's exact bytes, and setting account 1's logo key then
-- returned 200 with account 1's real logo. Raw account_name UNIQUE would not
-- have prevented this — the collision is in the SANITIZED slug, not the raw
-- name (many distinct names sanitize to the same slug).
--
-- Fix: give every account an IMMUTABLE storage_slug, assigned once (at
-- creation, or backfilled here for existing rows) and never recomputed from
-- account_name again. Every place in src/ that used to build or authorize an
-- S3 key from sanitizeAccountName(account_name) now reads this column
-- instead (see src/utils/storageSlug.js) — renaming an account can no longer
-- change, or collide with, its S3 namespace.
--
-- Idempotent: safe to re-run. The backfill only ever touches NULL slugs, and
-- the collision-resolution step recomputes collisions from the CURRENT
-- (already-resolved) values, so a second run finds nothing left to change —
-- see test/scripts/migration-020.spec.js.
--
-- review/full-audit-2026-09 finding 4 (Astra round 10): the collision step
-- below used to be a single UPDATE computed from one static snapshot (a CTE
-- taken once, before any row was rewritten), which could assign a "resolved"
-- slug that collided with an UNRELATED row's slug the snapshot never
-- re-checked against. Reproduced on a clone: accounts 100 'R10 Foo', 101
-- 'R10_Foo', 102 'R10_Foo_101' — 100 and 101 collide on base 'R10_Foo' (rank
-- 1 and 2), and the old single-pass UPDATE always suffixed the rank-2 loser
-- with exactly `_<account_id>` and stopped looking, so 101 became
-- 'R10_Foo_101' — the pre-existing BARE slug of completely unrelated account
-- 102. That second, newly-created collision was never re-examined by the
-- same statement, so it reached CREATE UNIQUE INDEX below, which failed
-- (duplicate key) and rolled back the ENTIRE migration inside the `psql -X
-- -1` transaction — not just the storage_slug backfill. Fix: replace the
-- single UPDATE with a PL/pgSQL loop (still plain SQL under the file
-- contract in migrations/README.md — a dollar-quoted DO block, no
-- BEGIN/COMMIT of its own) that resolves one colliding row at a time, in
-- deterministic account_id order, trying `_<account_id>`, then
-- `_<account_id>_2`, `_<account_id>_3`, ... and re-checking each candidate
-- against the CURRENT, live state of the WHOLE table (every untouched bare
-- slug plus every collision already resolved earlier in the same loop) —
-- mirroring what a brand-new account's own allocation does one row at a time
-- (src/utils/storageSlug.js's resolveNewAccountStorageSlug). The real prod
-- snapshot has exactly one account and cannot hit this at all; every shape
-- above is exercised by test/scripts/migration-020.spec.js against throwaway
-- databases.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS storage_slug text;

-- Backfill: must produce EXACTLY what sanitizeAccountName() in
-- src/utils/invoicePath.js produces today for the same input — every
-- character outside [A-Za-z0-9] becomes its own single '_' (no collapsing
-- of runs) — so every existing S3 key stays valid under the new column.
-- Verified against account 1's real name: 'James F. Kimmel & Associates' ->
-- 'James_F__Kimmel___Associates', matching invoicePath.js and the existing
-- hardcoded slug constants in src/endpoints/timeTracking/timeTracking-router.js
-- and src/endpoints/pendingPayments/pendingPayments-service.js.
-- JavaScript's /[^a-zA-Z0-9]/g works on UTF-16 code units, so a character
-- outside the Basic Multilingual Plane (an emoji, for example) is two code
-- units and becomes TWO underscores in sanitizeAccountName(); PostgreSQL
-- regexes work on whole characters. The inner replace turns each such
-- character into '__' first so the backfill matches the JS output byte for
-- byte (Astra round 11); BMP characters, including accented letters, map to
-- one '_' in both. account_name is NOT NULL.
UPDATE accounts
SET storage_slug = regexp_replace(regexp_replace(account_name, '[\U00010000-\U0010FFFF]', '__', 'g'), '[^a-zA-Z0-9]', '_', 'g')
WHERE storage_slug IS NULL;

-- Resolve collisions deterministically: two DIFFERENT accounts whose names
-- happen to sanitize to the same slug (or which already share a slug from a
-- prior partial run) must not end up sharing an S3 namespace. The account
-- with the LOWEST account_id in each colliding group keeps the bare
-- name-derived slug (preserving every existing S3 key for the
-- longest-lived / lowest-id account — in practice, account 1); every other
-- account sharing that slug is walked, in ascending account_id order, through
-- `_<account_id>`, then `_<account_id>_2`, `_<account_id>_3`, ... until it
-- finds a candidate NOTHING ELSE in the table currently holds (see this
-- file's header comment, finding 4) — each candidate check runs against the
-- table as it stands at that moment, so it sees every untouched bare slug
-- AND every collision this same loop has already resolved for an
-- earlier (lower) account_id.
DO $$
DECLARE
   loser RECORD;
   base_slug text;
   candidate text;
   attempt int;
BEGIN
   FOR loser IN
      SELECT account_id,
             storage_slug,
             ROW_NUMBER() OVER (PARTITION BY storage_slug ORDER BY account_id) AS slug_rank
      FROM accounts
      ORDER BY account_id
   LOOP
      IF loser.slug_rank = 1 THEN
         CONTINUE;
      END IF;

      base_slug := loser.storage_slug;
      attempt := 1;
      LOOP
         IF attempt = 1 THEN
            candidate := base_slug || '_' || loser.account_id;
         ELSE
            candidate := base_slug || '_' || loser.account_id || '_' || attempt;
         END IF;

         EXIT WHEN NOT EXISTS (
            SELECT 1 FROM accounts
            WHERE storage_slug = candidate AND account_id <> loser.account_id
         );

         attempt := attempt + 1;
      END LOOP;

      UPDATE accounts SET storage_slug = candidate WHERE account_id = loser.account_id;
   END LOOP;
END $$;

ALTER TABLE accounts ALTER COLUMN storage_slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_storage_slug_key ON accounts (storage_slug);
