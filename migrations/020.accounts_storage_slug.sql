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

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS storage_slug text;

-- Backfill: must produce EXACTLY what sanitizeAccountName() in
-- src/utils/invoicePath.js produces today for the same input — every
-- character outside [A-Za-z0-9] becomes its own single '_' (no collapsing
-- of runs) — so every existing S3 key stays valid under the new column.
-- Verified against account 1's real name: 'James F. Kimmel & Associates' ->
-- 'James_F__Kimmel___Associates', matching invoicePath.js and the existing
-- hardcoded slug constants in src/endpoints/timeTracking/timeTracking-router.js
-- and src/endpoints/pendingPayments/pendingPayments-service.js.
UPDATE accounts
SET storage_slug = regexp_replace(account_name, '[^a-zA-Z0-9]', '_', 'g')
WHERE storage_slug IS NULL;

-- Resolve collisions deterministically: two DIFFERENT accounts whose names
-- happen to sanitize to the same slug (or which already share a slug from a
-- prior partial run) must not end up sharing an S3 namespace. The account
-- with the LOWEST account_id in each colliding group keeps the bare
-- name-derived slug (preserving every existing S3 key for the
-- longest-lived / lowest-id account — in practice, account 1); every other
-- account sharing that slug gets `_<account_id>` appended, which is unique
-- by construction (account_id is the primary key).
WITH collisions AS (
   SELECT account_id,
          storage_slug,
          ROW_NUMBER() OVER (PARTITION BY storage_slug ORDER BY account_id) AS slug_rank
   FROM accounts
)
UPDATE accounts
SET storage_slug = accounts.storage_slug || '_' || accounts.account_id
FROM collisions
WHERE accounts.account_id = collisions.account_id
  AND collisions.slug_rank > 1;

ALTER TABLE accounts ALTER COLUMN storage_slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_storage_slug_key ON accounts (storage_slug);
