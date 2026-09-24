-- review/full-audit-2026-09 finding (Astra round 13, P2): CURRENT-NAME
-- UNIQUENESS is not proof of who uploaded a HISTORICAL object.
-- ownerFolderIsUnique() in timeTracking-router.js used to grant ownership of
-- an unrecorded legacy (flat-layout) tracker to whichever user is CURRENTLY
-- the unique match for a folder's name, re-derived from users.display_name
-- on every request. Reproduced live: recorded a tracker for employee A,
-- created employee B with the SAME display name (B got 403 by key / 404 by
-- name, as expected while A was still unique) — then renamed A through the
-- real user-update endpoint. B instantly became the unique CURRENT match:
-- A's file appeared in B's history, and both download routes served B A's
-- exact bytes. Separately, deleting an employee (real delete endpoint) and
-- later creating a new employee with the same display name transferred that
-- deleted employee's unrecorded tracker to the new one the same way — a
-- 'DeVries' -> 'Devries' rename followed by a new hire spelled the old way
-- reproduced it again. The (much narrower) recorded-name path — matching a
-- key's exact basename against timesheet_entries.timesheet_name for
-- (account, user) — was not itself exploited by this PoC (a recorded name
-- stays tied to the same immutable user_id regardless of a display-name
-- rename), but it is still a SECOND, independent, ad hoc ownership
-- mechanism, and neither one is durable across a user being deleted and a
-- later user reusing their name. Both are replaced here by ONE durable
-- mapping: this table is now the ONLY grant for a legacy (flat or
-- name-keyed) object — see the rewritten buildKeyAuthorizer in
-- timeTracking-router.js and trackerOwners.js. An id-keyed object
-- (processed/<accountFolder>/user_<ownerId>/<file>, written by every upload
-- since migration 020) needs no row here at all: it is authorized by its
-- own path structure, exactly as before, because it was written by, and
-- only by, its own owner's upload.
--
-- Rows come from three places: every NEW upload writes its own row (source
-- 'upload', in the SAME transaction as its timesheet_entries insert — see
-- the upload route); scripts/timeTracking/backfill-tracker-owners.js
-- attributes the 550 pre-existing production tracker objects once, by hand,
-- reviewing its output before --apply (source 'recorded-upload' for a
-- legacy key whose exact basename was recorded, unambiguously, by
-- timesheet_entries; 'folder-at-backfill' for an unrecorded key whose
-- CURRENT name-folder match was unambiguous AT BACKFILL TIME — a one-time,
-- reviewed judgment call, not a live, continuously-recomputed grant); and
-- id-keyed keys get a row too when the backfill scans them, purely for a
-- complete record (source 'path' — see the migration's own header comment
-- above and the backfill script for the full attribution rules).
--
-- Idempotent: CREATE TABLE / CREATE INDEX ... IF NOT EXISTS throughout, like
-- 018 and 020 — see test/scripts/migration-021.spec.js.
CREATE TABLE IF NOT EXISTS tracker_file_owners (
   s3_key text PRIMARY KEY,
   account_id integer NOT NULL REFERENCES accounts(account_id),
   user_id integer NOT NULL,
   source text NOT NULL CHECK (source IN ('upload', 'recorded-upload', 'folder-at-backfill', 'path')),
   created_at timestamptz NOT NULL DEFAULT now()
);

-- Deliberately NO foreign key on user_id, unlike account_id above.
-- Attribution must survive the owning user being deleted:
-- src/endpoints/user/user-service.js's deleteUser() hard-deletes the users
-- row outright (DELETE, not a soft-delete flag), and a later employee can be
-- created with the exact same display name (the whole scenario this table
-- exists to handle). user_id is a serial primary key Postgres never reuses,
-- so a "dangling" user_id here can never silently start meaning a
-- DIFFERENT, later user — it just keeps meaning the specific person who
-- held that id, whether or not their users row still exists. Every reader
-- of this table (trackerOwners.js's ownedKeys) scopes by (account_id,
-- user_id) together, never by user_id alone.
CREATE INDEX IF NOT EXISTS tracker_file_owners_owner_idx ON tracker_file_owners (account_id, user_id);
