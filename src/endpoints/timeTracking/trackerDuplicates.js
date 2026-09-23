/**
 * Duplicate protection for tracker uploads.
 *
 * Re-uploading a tracker (or a cumulative "whole week so far" tracker that
 * repeats earlier days) used to insert every row again, and auto-ingest then
 * billed each row twice. Rows are compared by a stable per-row fingerprint:
 *
 *   (account_id, user_id, employee, date, entity, company / first / last name,
 *    duration, normalized notes)
 *
 * Strings are NFKC-normalized, whitespace-collapsed, trimmed and lowercased;
 * dates are YYYY-MM-DD; duration is minutes. Category is deliberately NOT part
 * of the fingerprint: re-uploading the same work with a corrected category is
 * still the same work.
 *
 * There is no free column on timesheet_entries to store the fingerprint, so it
 * is computed on the fly against the employee's RETAINED existing rows for the
 * dates in the upload (indexed by (account_id, date); see _retainedHistory).
 * Soft-deleted rows are included MOST of the time, on purpose: a row that was
 * ever processed (billed) — even if later also soft-deleted — or one linked
 * to a transaction via ai_category_training_examples represents work that was
 * already ingested and potentially billed once; excluding it here would let a
 * re-upload of the original tracker walk right past that history and re-bill
 * the same work. The one case a soft-deleted row does NOT count: it was
 * deleted while still pending (never processed) and carries no billing/
 * training link at all — an admin correcting a bad row before it was ever
 * billed, then re-uploading the fixed tracker, must be able to insert the
 * corrected version instead of being told it is a duplicate of a row that was
 * deliberately removed and never charged to anyone.
 *
 * Matching is multiset-based: a tracker may legitimately contain two identical
 * rows (two 5-minute "processed payment" entries on one day). The Nth copy of a
 * fingerprint in the upload is a duplicate only if at least N copies already
 * exist.
 */
const crypto = require('crypto');
const dayjs = require('dayjs');

const UPLOAD_LOCK_NAMESPACE = 'ds2.timesheet_upload';
const FINGERPRINT_COLUMNS = Object.freeze(['account_id', 'user_id', 'employee_name', 'date', 'entity', 'company_name', 'first_name', 'last_name', 'duration', 'notes']);

const _text = value =>
   String(value == null ? '' : value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

// node-pg returns DATE columns as a JS Date at LOCAL midnight; new rows carry
// 'YYYY-MM-DD' strings.
const _isoDate = value => {
   if (!value) return '';
   if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : dayjs(value).format('YYYY-MM-DD');
   const text = String(value).trim();
   if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
   const parsed = dayjs(text);
   return parsed.isValid() ? parsed.format('YYYY-MM-DD') : text;
};

/**
 * @param {object} entry timesheet_entries-shaped row
 * @returns {string} sha256 hex
 */
const computeEntryFingerprint = entry =>
   crypto
      .createHash('sha256')
      .update(
         JSON.stringify([
            Number(entry.account_id),
            Number(entry.user_id),
            _text(entry.employee_name),
            _isoDate(entry.date),
            _text(entry.entity),
            _text(entry.company_name),
            _text(entry.first_name),
            _text(entry.last_name),
            Number(entry.duration),
            _text(entry.notes)
         ])
      )
      .digest('hex');

const _countFingerprints = rows => {
   const counts = new Map();
   for (const row of rows) {
      const fp = computeEntryFingerprint(row);
      counts.set(fp, (counts.get(fp) || 0) + 1);
   }
   return counts;
};

const _sameMultiset = (a, b) => {
   if (a.size !== b.size) return false;
   for (const [fp, count] of a) {
      if (b.get(fp) !== count) return false;
   }
   return true;
};

const _uploadedAt = rows => rows.reduce((latest, row) => (row.created_at && (!latest || new Date(row.created_at) > new Date(latest)) ? row.created_at : latest), null);

/**
 * Pure planner (no DB).
 * @param {{ entries: object[], sourceRows?: number[], samePeriodRows?: object[], sameDateRows?: object[] }} args
 *   entries        rows about to be inserted (timesheet_entries shape)
 *   sourceRows     spreadsheet line numbers aligned with entries (for reporting)
 *   samePeriodRows existing non-deleted rows of this employee with the SAME tracker period
 *   sameDateRows   existing non-deleted rows of this employee on the upload's dates
 * @returns {{ identicalUpload: null|{timesheet_name, uploaded_at, row_count}, toInsertIndexes: number[], duplicates: object[] }}
 */
const planTrackerDedupe = ({ entries, sourceRows = [], samePeriodRows = [], sameDateRows = [] }) => {
   const newCounts = _countFingerprints(entries);

   // (a) the identical file (same employee + period + identical row set) was already ingested
   const byUpload = new Map();
   for (const row of samePeriodRows) {
      const list = byUpload.get(row.timesheet_name) || [];
      list.push(row);
      byUpload.set(row.timesheet_name, list);
   }
   let identicalUpload = null;
   for (const [timesheetName, rows] of byUpload) {
      if (!_sameMultiset(_countFingerprints(rows), newCounts)) continue;
      const uploadedAt = _uploadedAt(rows);
      if (!identicalUpload || (uploadedAt && new Date(uploadedAt) > new Date(identicalUpload.uploaded_at || 0))) {
         identicalUpload = { timesheet_name: timesheetName, uploaded_at: uploadedAt, row_count: rows.length };
      }
   }
   if (identicalUpload) {
      return { identicalUpload, toInsertIndexes: [], duplicates: [] };
   }

   // (b) skip individual rows that already exist (multiset: Nth copy vs N existing)
   const available = new Map();
   const seenIds = new Set();
   for (const row of sameDateRows) {
      if (row.timesheet_entry_id != null) {
         if (seenIds.has(row.timesheet_entry_id)) continue;
         seenIds.add(row.timesheet_entry_id);
      }
      const fp = computeEntryFingerprint(row);
      const bucket = available.get(fp) || [];
      bucket.push(row);
      available.set(fp, bucket);
   }
   const toInsertIndexes = [];
   const duplicates = [];
   entries.forEach((entry, index) => {
      const bucket = available.get(computeEntryFingerprint(entry));
      if (bucket && bucket.length) {
         const match = bucket.shift();
         duplicates.push({
            row: sourceRows[index] != null ? sourceRows[index] : null,
            date: _isoDate(entry.date),
            duration: Number(entry.duration),
            duplicate_of: { timesheet_name: match.timesheet_name || null, uploaded_at: match.created_at || null }
         });
      } else {
         toInsertIndexes.push(index);
      }
   });
   return { identicalUpload: null, toInsertIndexes, duplicates };
};

// A row counts as retained "already uploaded" history (and can therefore
// block a re-upload as a duplicate) unless it is BOTH soft-deleted AND never
// processed AND has no linked billing/training evidence. That combination —
// deleted while still pending, with nothing downstream ever created from it —
// is the one case where the advertised "delete the bad row, then re-upload
// the corrected tracker" workflow actually needs the row to stop counting. A
// PROCESSED row (billed — whether or not it was later also soft-deleted; see
// timesheets-router.js deleteTimesheetEntryIfPending, which refuses to delete
// a processed row going forward, but legacy data can still have both flags
// set) or a row with ai_category_training_examples evidence linking it to a
// transaction must still block re-ingestion, since the work may already have
// been billed once. This only ever WIDENS which rows are eligible for
// (re-)insertion, so getting it wrong risks a double bill — apply C3 (the
// atomic conditional delete) first. Best effort: no training link does not
// prove the historical work was never billed some other way.
const _retainedHistory = (query, trx) =>
   query.where(q =>
      q
         .where('is_processed', true)
         .orWhere('is_deleted', false)
         .orWhereExists(
            trx('ai_category_training_examples as _linked')
               .select(trx.raw('1'))
               .whereRaw('_linked.timesheet_entry_id = timesheet_entries.timesheet_entry_id')
               .whereNotNull('_linked.transaction_id')
         )
   );

/**
 * Load the employee's existing rows and plan the upload. Call inside the
 * insert transaction AFTER lockTrackerUploads() so two concurrent uploads for
 * the same employee can't both pass the check.
 */
const findTrackerDuplicates = async (trx, { accountId, userId, startDate, endDate, entries, sourceRows = [] }) => {
   const columns = ['timesheet_entry_id', 'timesheet_name', 'created_at', ...FINGERPRINT_COLUMNS];
   const dates = [...new Set(entries.map(entry => _isoDate(entry.date)).filter(Boolean))];
   // NOT a blind is_deleted = false filter: see _retainedHistory above (a
   // soft-deleted row's work may already be billed and must still count as
   // "already uploaded" UNLESS it was deleted while still pending and carries
   // no billing/training evidence at all — the one case the advertised
   // "delete then re-upload the corrected tracker" workflow needs to actually
   // free up).
   const [samePeriodRows, sameDateRows] = await Promise.all([
      startDate && endDate
         ? _retainedHistory(
              trx('timesheet_entries').where({ account_id: accountId, user_id: userId, time_tracker_start_date: startDate, time_tracker_end_date: endDate }),
              trx
           ).select(columns)
         : [],
      dates.length
         ? _retainedHistory(trx('timesheet_entries').where({ account_id: accountId, user_id: userId }).whereIn('date', dates), trx).select(columns)
         : []
   ]);
   return planTrackerDedupe({ entries, sourceRows, samePeriodRows, sameDateRows });
};

/** Transaction-scoped advisory lock serializing uploads per employee. */
const lockTrackerUploads = (trx, userId) => trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [UPLOAD_LOCK_NAMESPACE, Number(userId)]);

module.exports = {
   computeEntryFingerprint,
   planTrackerDedupe,
   findTrackerDuplicates,
   lockTrackerUploads,
   FINGERPRINT_COLUMNS,
   UPLOAD_LOCK_NAMESPACE
};
