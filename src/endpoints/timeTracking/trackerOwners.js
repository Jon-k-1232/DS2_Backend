/**
 * tracker_file_owners (migrations/021.tracker_file_owners.sql) — a durable
 * mapping from an S3 tracker object key to the (account, user) that owns
 * it. See the migration file's own header comment for the full writeup of
 * why this exists (review/full-audit-2026-09, Astra round 13, finding P2):
 * current-name uniqueness and a recorded-name lookup are BOTH replaced by
 * this one table, which is now the ONLY authorization grant for a legacy
 * (flat or name-keyed) tracker object in timeTracking-router.js's
 * buildKeyAuthorizer. An id-keyed object needs no row here — it is
 * authorized by its own path structure alone, exactly as before.
 *
 * Rows are written by:
 *  - the upload route, for every new upload (source 'upload'), inside the
 *    SAME transaction as that upload's timesheet_entries insert;
 *  - scripts/timeTracking/backfill-tracker-owners.js, once, by hand, for
 *    the pre-existing production objects (source 'recorded-upload' /
 *    'folder-at-backfill' / 'path' — see that script's header comment).
 */

/**
 * Record that `s3Key` belongs to (accountId, userId). Idempotent: a key
 * already owned by someone (including a DIFFERENT account/user — this
 * should never happen, since a real S3 key is only ever produced once) is
 * left untouched rather than overwritten, so this is safe to call more than
 * once for the same key and never silently reassigns an existing grant.
 * `trx` may be a real transaction (the upload route always passes one, so a
 * rollback removes this row along with the timesheet_entries rows it was
 * inserted with) or a plain db handle (the backfill script's own single
 * apply transaction, or a test fixture).
 */
const recordOwner = (trx, { s3Key, accountId, userId, source }) =>
   trx('tracker_file_owners')
      .insert({ s3_key: s3Key, account_id: Number(accountId), user_id: Number(userId), source })
      .onConflict('s3_key')
      .ignore();

/** Every S3 key owned by (accountId, userId), as a Set for O(1) membership checks. */
const ownedKeys = async (db, accountId, userId) => {
   const rows = await db('tracker_file_owners').select('s3_key').where({ account_id: Number(accountId), user_id: Number(userId) });
   return new Set(rows.map(row => row.s3_key));
};

module.exports = { recordOwner, ownedKeys };
