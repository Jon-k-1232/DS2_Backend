const express = require('express');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const dayjs = require('dayjs');
const asyncHandler = require('../../utils/asyncHandler');
const { requireAuth, requireSuperAdmin } = require('../auth/jwt-auth');
const accountUserService = require('../user/user-service');
const accountService = require('../account/account-service');
const { listObjects, getObject, putObject, deleteObject } = require('../../utils/s3');
const { isSyntacticallySafeKey, isSafeBareFilename } = require('../../utils/downloadAuthorization');
const { validateUploadedTracker } = require('../../timeTrackerValidation/validateUploadedTracker');
const timeTrackerStaffService = require('../timeTrackerStaff/timeTrackerStaff-service');
const { sendValidationSuccessEmail, sendSystemErrorEmail, getAdminRecipients } = require('../../timeTrackerValidation/notifications');
const sendSuccessEmail = require('../../utils/email/sendSuccessEmail');
const timesheetsService = require('../timesheets/timesheets-service');
const { kickOffAutoIngestForEntryIds, _isAccountAllowed: _isAutoIngestAllowed } = require('../timesheets/auto-ingest-runner');
// Imported as a namespace (not destructured) so tests can monkey-patch
// templateBuilder.buildTemplate on the shared module object and have this
// router pick up the stub — see the "builder failure" 503 coverage in
// coverage-timetracking-timesheets.integration.spec.js.
const templateBuilder = require('./template-builder');
const { findTrackerDuplicates, lockTrackerUploads } = require('./trackerDuplicates');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const { enforceAccountId, enforceSelfOrPrivileged } = require('../auth/account-scope');
const timeTrackingRouter = express.Router();
timeTrackingRouter.param('accountID', enforceAccountId);
// :userID on this router identifies the OWNER of the uploaded tracker files,
// so a non-privileged user may only address their own id. requireAuth must run
// first (it does, at the app mount) so req.user is populated.
timeTrackingRouter.param('userID', enforceSelfOrPrivileged);
const rawUploadParser = express.raw({ type: () => true, limit: '25mb' });
const jsonParser = express.json();

const TIME_TRACKING_ROOT = 'James_F__Kimmel___Associates/time_tracking';
const TRACKER_VERSIONS_ROOT = `${TIME_TRACKING_ROOT}/tracker_versions`;
const PROCESSED_ROOT = `${TIME_TRACKING_ROOT}/processed`;
const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MB

const extensionLookup = {
   'text/csv': '.csv',
   'application/vnd.ms-excel': '.xls',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
   'application/vnd.ms-excel.sheet.macroenabled.12': '.xlsm',
   'application/x-iwork-numbers-sffnumbers': '.numbers'
};

const formatTimestamp = () => dayjs().format('MMMM-DD-YYYY_hh-mm-ssA');

const toISODate = value => {
   if (!value) return null;

   if (value instanceof Date) {
      return dayjs(value).format('YYYY-MM-DD');
   }

   if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const delimiter = trimmed.includes('/') ? '/' : trimmed.includes('-') ? '-' : null;
      if (delimiter) {
         const parts = trimmed.split(delimiter);
         if (parts.length === 3) {
            if (parts[0].length === 4) {
               const [year, month, day] = parts;
               return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            const [month, day, year] = parts;
            return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
         }
      }

      const parsed = dayjs(trimmed);
      if (parsed.isValid()) {
         return parsed.format('YYYY-MM-DD');
      }
      return null;
   }

   const parsed = dayjs(value);
   return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
};

const sanitizeSegment = (value, fallback = 'unknown') => {
   if (!value) return fallback;
   const trimmed = value.trim();
   if (!trimmed) return fallback;
   return trimmed.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
};

const resolveExtension = (fileName, fileType) => {
   const ext = path.extname(fileName || '').toLowerCase();
   if (ext) return ext;
   if (fileType && extensionLookup[fileType]) return extensionLookup[fileType];
   return '';
};

const fetchUserRecord = async (db, accountID, userID) => {
   const userRecords = await accountUserService.fetchUser(db, accountID, userID);
   if (!userRecords || !userRecords.length) {
      const error = new Error('Unable to locate user details for upload.');
      error.status = 404;
      throw error;
   }
   return userRecords[0];
};

const fetchAccountRecord = async (db, accountID) => {
   const accountRecords = await accountService.getAccount(db, accountID);
   if (!accountRecords || !accountRecords.length) {
      const error = new Error('Unable to locate account details for upload.');
      error.status = 404;
      throw error;
   }
   return accountRecords[0];
};

const deriveUserNameSegments = userRecord => {
   const displayName = userRecord.display_name || '';
   const trimmed = displayName.trim();

   if (!trimmed) {
      return { firstName: 'User', lastName: 'Unknown' };
   }

   const parts = trimmed.split(/\s+/);
   if (parts.length === 1) {
      return { firstName: parts[0], lastName: parts[0] };
   }

   return {
      firstName: parts[0],
      lastName: parts[parts.length - 1]
   };
};

const buildUserFolder = userRecord => {
   const { firstName, lastName } = deriveUserNameSegments(userRecord);
   return sanitizeSegment(`${lastName}_${firstName}`);
};

// review/full-audit-2026-09 finding 5 (Astra round 10): this used to be the
// ONLY account-folder builder, re-deriving its output from the account's
// CURRENT, mutable account_name on every call. The numeric account-id suffix
// already stops a rename from colliding with a DIFFERENT account's folder
// (finding 1 / migration 020's fix — see buildAccountFolder below), but does
// nothing to keep THIS account's own folder stable across ITS OWN rename: an
// authenticated account-9001 admin renamed their own account and the SAME
// employee's SAME already-uploaded tracker went from listed-and-downloadable
// (200, one history entry) to invisible (403, zero history entries) with its
// S3 key completely unchanged. Kept alive, under its original name, ONLY as
// a read fallback for objects that already exist under it — see
// buildProcessedPrefixes. No code path should call this to build a NEW key.
const buildLegacyAccountFolder = (accountRecord, accountID) => {
   const accountName = accountRecord.account_name || `account_${accountID}`;
   return `${sanitizeSegment(accountName)}_${accountID}`;
};

// The fix: key every account folder off accounts.storage_slug instead —
// assigned once and NEVER recomputed from account_name (migrations/
// 020.accounts_storage_slug.sql, src/utils/storageSlug.js) — so renaming the
// account can never move this folder again. storage_slug is NOT always
// byte-identical to buildLegacyAccountFolder's output for a given name:
// account 1's real slug ('James_F__Kimmel___Associates', from
// sanitizeAccountName, which turns each non-alphanumeric character into its
// OWN '_') differs from what sanitizeSegment(account_name) produces for that
// same name ('James_F_Kimmel__Associates', which instead DELETES punctuation
// rather than replacing it) — confirmed by direct comparison against both
// real accounts (1 and the 9001 fixture) before this shipped: identical for
// 9001 (whose name has no punctuation), different for account 1. Switching
// straight over would have silently orphaned account 1's real, already-
// uploaded S3 objects the moment this code deployed, so
// buildLegacyAccountFolder stays in permanent, read-only use alongside this
// one (see buildProcessedPrefixes) rather than being deleted — only NEW
// uploads ever write under this folder.
const buildAccountFolder = (accountRecord, accountID) => {
   const slug = accountRecord.storage_slug || `account_${accountID}`;
   return `${slug}_${accountID}`;
};

// primaryPrefix: account-AND-OWNER-scoped by the account's IMMUTABLE
// buildAccountFolder (storage_slug) plus the OWNER's immutable numeric user
// id (user_<id>), never by name. ALL new uploads always write here; renaming
// the account or the employee can never move it again.
// legacyIdKeyedPrefix: the SAME id-keyed leaf, but under
// buildLegacyAccountFolder — the account segment primaryPrefix itself used
// before storage_slug existed. Nothing writes here anymore, but real
// production/fixture objects already do, and it is trusted as this owner's
// own exactly like primaryPrefix (the leaf is still keyed by this owner's
// immutable numeric id either way) — this is what keeps those pre-existing
// files listable and downloadable through the cutover onto storage_slug,
// and across any rename that happens after it, without needing a record of
// every name the account has ever had.
// accountLegacyPrefix: the FORMER primary layout — the same mutable
// buildLegacyAccountFolder account segment as legacyIdKeyedPrefix, but keyed
// by SANITIZED DISPLAY NAME (<account_name_slug>/<Last_First>/...). Two
// employees in the SAME account who share a display name ("Alex Jones" hired
// twice) resolved to this exact same folder, so one could list/download the
// other's files. No longer written by new uploads; only ever read, and (like
// legacyPrefix below) never trusted as this owner's own without filtering.
// legacyPrefix: the pre-fix flat layout with no account segment at all —
// production still has real files there. It is only ever READ, never written
// by new uploads, and a key/object found only under it is NOT automatically
// trusted as this account's own: see filterLegacyObjectsToOwner, which every
// caller of legacyPrefix (and accountLegacyPrefix) must run before listing or
// serving from it, because both folders are shared by any OTHER same-named
// employee — in another account for legacyPrefix, or in THIS SAME account for
// accountLegacyPrefix.
const buildProcessedPrefixes = (accountRecord, accountID, userFolder, ownerId) => {
   const accountFolder = buildAccountFolder(accountRecord, accountID);
   const legacyAccountFolder = buildLegacyAccountFolder(accountRecord, accountID);
   const primaryPrefix = `${PROCESSED_ROOT}/${accountFolder}/user_${Number(ownerId)}/`;
   const legacyIdKeyedPrefix = `${PROCESSED_ROOT}/${legacyAccountFolder}/user_${Number(ownerId)}/`;
   const accountLegacyPrefix = `${PROCESSED_ROOT}/${legacyAccountFolder}/${userFolder}/`;
   const legacyPrefix = `${PROCESSED_ROOT}/${userFolder}/`;
   return { primaryPrefix, legacyIdKeyedPrefix, accountLegacyPrefix, legacyPrefix };
};

// Keep only the legacy-prefix S3 objects whose stored file name is one THIS
// account has actually recorded for THIS employee (timesheet_entries.timesheet_name,
// any is_deleted state — the upload happened even if the rows were later
// cleaned up). Objects under a name-keyed legacy prefix that don't match
// anything in this account's own history for THIS owner belong to some other
// same-named employee (a different account for the flat layout; possibly this
// SAME account for the old account-scoped-by-name layout) and must never be
// listed or served here.
const filterLegacyObjectsToOwner = async (db, accountID, ownerUserID, objects) => {
   if (!objects || !objects.length) return [];
   const ownNames = new Set(await timesheetsService.getAllTimesheetNamesEverUsedByEmployee(db, accountID, ownerUserID));
   if (!ownNames.size) return [];
   return objects.filter(object => object?.Key && ownNames.has(path.basename(object.Key).replace(/\.gz$/i, '')));
};

// Same rule as filterLegacyObjectsToOwner, for a single candidate key (used
// where we're about to fetch/serve one object rather than list a prefix).
// Deliberately prefix-agnostic — it only ever looks at the key's basename —
// so it doubles as the finding-5 fallback in /history/download for a key
// under NO reconstructable prefix at all (see that route's PROCESSED_ROOT
// branch): an account can be renamed any number of times, but its recorded
// timesheet_entries.timesheet_name values never change underneath it.
const legacyKeyBelongsToOwner = async (db, accountID, ownerUserID, key) => {
   const storedName = path.basename(key).replace(/\.gz$/i, '');
   const ownNames = await timesheetsService.getAllTimesheetNamesEverUsedByEmployee(db, accountID, ownerUserID);
   return ownNames.includes(storedName);
};

const ensureAdminAccess = userRecord => {
   // Super admin sits above admin in the role hierarchy and must satisfy any
   // admin-level check. Accept both so Super Admins aren't 403'd on
   // admin-gated reads like the template list.
   const accessLevel = userRecord?.access_level?.toLowerCase();
   if (accessLevel !== 'admin' && accessLevel !== 'super admin') {
      const error = new Error('Admin access required.');
      error.status = 403;
      throw error;
   }
};

// POST /time-tracking/upload/:accountID/:userID
// Upload a time tracker file for a user, validate/normalize entries, save the compressed file to S3,
// insert entries into the holding table (timesheet_entries), send notification emails, and
// kick off AI categorization in the background (non-blocking). Returns success immediately.
timeTrackingRouter.post(
   '/upload/:accountID/:userID',
   requireAuth,
   rawUploadParser,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;
      const fileNameHeader = req.headers['x-file-name'];
      const fileTypeHeader = req.headers['x-file-type'] || 'application/octet-stream';
      const policyNote = 'Managers and admins can submit on behalf of team members; all other users may only submit their own time tracker files.';

      const accountIdNumber = Number(accountID);
      const userIdNumber = Number(userID);
      const ownerUserIdParam = req.query?.ownerUserID ?? req.query?.targetUserID ?? null;
      const ownerUserIdNumber = ownerUserIdParam ? Number(ownerUserIdParam) : userIdNumber;

      if (!Number.isFinite(accountIdNumber) || !Number.isFinite(userIdNumber) || !Number.isFinite(ownerUserIdNumber)) {
         return res.status(400).json({
            message: 'Invalid account or user information provided.',
            note: policyNote
         });
      }

      if (!Number.isInteger(accountIdNumber) || !Number.isInteger(userIdNumber) || !Number.isInteger(ownerUserIdNumber) || accountIdNumber <= 0 || userIdNumber <= 0 || ownerUserIdNumber <= 0) {
         return res.status(400).json({
            message: 'Account and user identifiers must be positive integers.',
            note: policyNote
         });
      }

      if (!fileNameHeader) {
         return res.status(400).json({
            message: 'Missing file metadata. Please include the original file name.',
            note: policyNote
         });
      }

      if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) {
         return res.status(400).json({
            message: 'Uploaded file is empty or missing.',
            note: policyNote
         });
      }

      if (req.body.length > MAX_UPLOAD_BYTES) {
         return res.status(400).json({
            message: 'File exceeds the 1MB size limit.',
            note: policyNote
         });
      }

      const db = req.app.get('db');
      let adminRecipients = [];
      try {
         adminRecipients = await getAdminRecipients(db, accountIdNumber);
      } catch (recipientError) {
         console.warn(`[${new Date().toISOString()}] Failed to resolve time tracker admin recipients for account ${accountIdNumber}: ${recipientError.message}`);
         adminRecipients = [];
      }
      let decodedOriginalName;
      try {
         decodedOriginalName = decodeURIComponent(fileNameHeader);
      } catch (decodeError) {
         return res.status(400).json({
            message: 'Invalid file name encoding.',
            note: policyNote
         });
      }
      const detectedExtension = path.extname(decodedOriginalName || '').toLowerCase();
      if (detectedExtension === '.numbers') {
         return res.status(400).json({
            message: 'Apple Numbers files are not supported. Please export your tracker as XLSX or XLS before uploading.',
            note: policyNote
         });
      }
      let requestingUserRecord;
      let userRecord;
      let accountRecord;

      try {
         const [requesterRecord, ownerRecord, fetchedAccount] = await Promise.all([
            fetchUserRecord(db, accountIdNumber, userIdNumber),
            fetchUserRecord(db, accountIdNumber, ownerUserIdNumber),
            fetchAccountRecord(db, accountIdNumber)
         ]);

         requestingUserRecord = requesterRecord;
         userRecord = ownerRecord;
         accountRecord = fetchedAccount;

         if (!userRecord?.is_user_active) {
            return res.status(400).json({
               message: 'The selected user is inactive and cannot receive time tracker uploads.',
               note: policyNote
            });
         }

         const requesterRole = requestingUserRecord?.access_level?.toLowerCase?.() || '';
         const allowedOverrideRoles = ['super admin', 'admin', 'manager'];
         const isSelfSubmission = ownerUserIdNumber === userIdNumber;

         if (!isSelfSubmission && !allowedOverrideRoles.includes(requesterRole)) {
            return res.status(403).json({
               message: 'Only managers or admins can submit trackers for other users.',
               note: policyNote
            });
         }

         console.log(
            `[${new Date().toISOString()}] Starting tracker validation for account ${accountIdNumber}, submitted by user ${userIdNumber} for user ${ownerUserIdNumber}, file "${decodedOriginalName}".`
         );
         const validationResult = await validateUploadedTracker({
            db,
            accountID: accountIdNumber,
            userID: ownerUserIdNumber,
            fileBuffer: req.body,
            originalFileName: decodedOriginalName
         });

         console.log(`[${new Date().toISOString()}] Validation completed for "${decodedOriginalName}". Errors found: ${validationResult.errors.length}.`);

         if (validationResult.errors.length) {
            console.warn(`[${new Date().toISOString()}] Validation failed for "${decodedOriginalName}". Errors: ${validationResult.errors.join('; ')}`);

            return res.status(400).json({
               message: 'The tracker failed validation. The file was not saved. Correct all validation errors before re-uploading.',
               errors: validationResult.errors,
               note: policyNote
            });
         }

         const metadataFromValidation = validationResult.metadata || {};
         const metadata = {
            ...metadataFromValidation,
            userId: ownerUserIdNumber,
            submittedForUserId: ownerUserIdNumber,
            submittedForDisplayName: userRecord?.display_name || userRecord?.email || `User ${ownerUserIdNumber}`,
            submittedForEmail: userRecord?.email || null,
            submittedByUserId: userIdNumber,
            submittedByDisplayName: requestingUserRecord?.display_name || requestingUserRecord?.email || `User ${userIdNumber}`,
            submittedByEmail: requestingUserRecord?.email || null
         };
         validationResult.metadata = metadata;

         console.log(`[${new Date().toISOString()}] Extracted tracker metadata for "${decodedOriginalName}".`);

         const toNumeric = value => (value === undefined || value === null || Number.isNaN(Number(value)) ? null : Number(value));
         const toNullableString = value => {
            if (value === undefined || value === null) return null;
            const trimmed = typeof value === 'string' ? value.trim() : value;
            return trimmed === '' ? null : trimmed;
         };

         const metadataUserId = toNumeric(metadataFromValidation.userId);
         if (metadataUserId !== null && metadataUserId !== ownerUserIdNumber) {
            console.warn(`[${new Date().toISOString()}] Tracker metadata user (${metadataUserId}) does not match selected user ${ownerUserIdNumber}; overriding to the selected user.`);
         }

         if (!metadata.startDate || !metadata.endDate) {
            console.error(`[${new Date().toISOString()}] Missing tracker date range in metadata for "${decodedOriginalName}". Metadata:`, metadata);
            return res.status(400).json({
               message: 'The tracker metadata is incomplete. Please ensure the start and end dates are provided.',
               note: policyNote
            });
         }

         const effectiveUserId = ownerUserIdNumber;

         const normalizedEntries = (validationResult.entries || []).map(entry => ({
            account_id: accountIdNumber,
            user_id: effectiveUserId,
            employee_name: toNullableString(entry.employee_name),
            timesheet_name: null, // placeholder, set after storedFileName computed
            time_tracker_start_date: toISODate(metadata.startDate),
            time_tracker_end_date: toISODate(metadata.endDate),
            date: toISODate(entry.date),
            entity: toNullableString(entry.entity),
            category: toNullableString(entry.category),
            company_name: toNullableString(entry.company_name),
            first_name: toNullableString(entry.first_name),
            last_name: toNullableString(entry.last_name),
            duration: toNumeric(entry.duration),
            notes: entry.notes?.toString().trim() || ''
         }));
         // Per-row upload facts that are not timesheet_entries columns.
         const entryMeta = (validationResult.entries || []).map(entry => ({
            sourceRow: entry.source_row ?? null,
            nonWorkReason: entry.non_work_reason || null
         }));

         if (!normalizedEntries.length) {
            console.warn(`[${new Date().toISOString()}] No time entries produced for "${decodedOriginalName}" after validation.`);
            return res.status(400).json({
               message: 'The tracker did not contain any valid time entries. The file was not saved.',
               note: policyNote
            });
         }

         console.log(`[${new Date().toISOString()}] Normalized entries for "${decodedOriginalName}".`);

         if (normalizedEntries.some(entry => !entry.time_tracker_start_date || !entry.time_tracker_end_date || !entry.date)) {
            console.error(`[${new Date().toISOString()}] One or more entries for "${decodedOriginalName}" contained invalid dates after normalization. Rolling back.`);
            return res.status(400).json({
               message: 'The tracker contains invalid dates. Please review the Date column and try again.',
               note: policyNote
            });
         }

         if (normalizedEntries.some(entry => entry.duration === null)) {
            console.error(`[${new Date().toISOString()}] One or more entries for "${decodedOriginalName}" contained invalid durations after normalization. Rolling back.`);
            return res.status(400).json({
               message: 'The tracker contains invalid duration values. Please review the Duration column and try again.',
               note: policyNote
            });
         }

         const userFolder = buildUserFolder(userRecord);
         const { firstName, lastName } = deriveUserNameSegments(userRecord);
         const extension = resolveExtension(decodedOriginalName, fileTypeHeader);
         const compressedFile = await gzip(req.body);

         // Duplicate protection + insert run in ONE transaction, serialized per
         // employee by an advisory lock, so a double-clicked or concurrent
         // re-upload can't slip past the check. The S3 copy is written only once
         // we know there is something new to store (and removed if the insert fails).
         //
         // The stored file name (and therefore the S3 key) is generated AFTER the
         // lock is acquired, not before: two uploads for the same employee inside
         // the same second used to race to compute the identical
         // formatTimestamp() string BEFORE either one blocked on the lock, so the
         // second writer's S3 PutObject silently overwrote the first's object even
         // though both inserts succeeded. Generating the name post-lock forces the
         // second caller's clock read to happen only once the first has fully
         // committed (or rolled back) and released the lock, and the appended
         // millisecond suffix closes the (now practically unreachable, but still
         // possible on a very fast machine) same-second gap.
         const trx = await db.transaction();
         let insertedEntries = [];
         let dedupe = { identicalUpload: null, toInsertIndexes: normalizedEntries.map((_, index) => index), duplicates: [] };
         let storedInS3 = false;
         let storedFileName;
         let s3Key;
         try {
            await lockTrackerUploads(trx, effectiveUserId);

            const uploadInstant = dayjs();
            const timestamp = uploadInstant.format('MMMM-DD-YYYY_hh-mm-ssA');
            const msSuffix = String(uploadInstant.millisecond()).padStart(3, '0');
            // A random suffix (on top of the per-employee advisory lock + ms
            // timestamp) removes any remaining reliance on wall-clock
            // uniqueness alone for the STORED FILE NAME.
            const uniqueSuffix = crypto.randomUUID().slice(0, 8);
            storedFileName = `${sanitizeSegment(lastName)}_${sanitizeSegment(firstName)}_${timestamp}-${msSuffix}-${uniqueSuffix}${extension}`;
            s3Key = `${buildProcessedPrefixes(accountRecord, accountIdNumber, userFolder, effectiveUserId).primaryPrefix}${storedFileName}.gz`;
            normalizedEntries.forEach(entry => {
               entry.timesheet_name = storedFileName;
            });

            dedupe = await findTrackerDuplicates(trx, {
               accountId: accountIdNumber,
               userId: effectiveUserId,
               startDate: normalizedEntries[0].time_tracker_start_date,
               endDate: normalizedEntries[0].time_tracker_end_date,
               entries: normalizedEntries,
               sourceRows: entryMeta.map(meta => meta.sourceRow)
            });

            if (dedupe.identicalUpload) {
               await trx.rollback();
               const earlier = dedupe.identicalUpload;
               // The stored file name carries the upload timestamp; created_at is a
               // tz-less timestamp, so it is returned raw (duplicate_of) rather than
               // re-formatted into a possibly-shifted local time.
               const message = `This tracker was already uploaded as "${earlier.timesheet_name}" (${earlier.row_count} identical row${earlier.row_count === 1 ? '' : 's'} for ${metadata.startDate} to ${metadata.endDate}). Nothing was saved. To replace that upload, ask an admin to delete its rows first.`;
               console.warn(`[${new Date().toISOString()}] Rejected duplicate upload "${decodedOriginalName}" for user ${effectiveUserId}: identical to "${earlier.timesheet_name}".`);
               return res.status(409).json({ message, errors: [message], duplicate_of: earlier, note: policyNote });
            }

            if (!dedupe.toInsertIndexes.length) {
               await trx.rollback();
               const earlierNames = [...new Set(dedupe.duplicates.map(d => d.duplicate_of.timesheet_name).filter(Boolean))];
               const message = `All ${dedupe.duplicates.length} row${dedupe.duplicates.length === 1 ? '' : 's'} in this tracker were already uploaded${earlierNames.length ? ` (${earlierNames.map(n => `"${n}"`).join(', ')})` : ''}. Nothing new was saved.`;
               console.warn(`[${new Date().toISOString()}] Rejected upload "${decodedOriginalName}" for user ${effectiveUserId}: every row already exists.`);
               return res.status(409).json({
                  message,
                  errors: [message],
                  duplicates_skipped: dedupe.duplicates,
                  duplicates_skipped_count: dedupe.duplicates.length,
                  note: policyNote
               });
            }

            console.log(`[${new Date().toISOString()}] Validation passed for "${decodedOriginalName}". Saving compressed file to S3 key "${s3Key}".`);
            await putObject(s3Key, compressedFile, 'application/gzip', {
               'original-filename': encodeURIComponent(storedFileName),
               'original-content-type': fileTypeHeader
            });
            storedInS3 = true;
            console.log(`[${new Date().toISOString()}] Successfully saved tracker to S3 at "${s3Key}". Persisting entries to database...`);

            const rowsToInsert = dedupe.toInsertIndexes.map(index => normalizedEntries[index]);
            insertedEntries = await timesheetsService.insertTimesheetEntriesWithTransaction(trx, rowsToInsert);
            await trx.commit();
            console.log(
               `[${new Date().toISOString()}] Inserted ${rowsToInsert.length} entries into timesheet_entries for "${decodedOriginalName}" (${dedupe.duplicates.length} duplicate row(s) skipped).`
            );
         } catch (dbError) {
            await trx.rollback().catch(() => {});
            console.error(`[${new Date().toISOString()}] Failed to persist timesheet entries for "${decodedOriginalName}": ${dbError.message}`, dbError.stack);

            if (storedInS3) {
               try {
                  await deleteObject(s3Key);
                  console.log(`[${new Date().toISOString()}] Removed S3 object "${s3Key}" after database insert failure.`);
               } catch (cleanupError) {
                  console.error(`[${new Date().toISOString()}] Failed to remove S3 object "${s3Key}" after database error: ${cleanupError.message}`);
               }
            }

            if (adminRecipients.length) {
               await sendSystemErrorEmail({
                  adminEmails: adminRecipients,
                  userRecord,
                  accountRecord,
                  originalFileName: decodedOriginalName,
                  error: dbError
               }).catch(emailError => {
                  console.error(`[${new Date().toISOString()}] Failed to send system error email after DB error: ${emailError.message}`, emailError.stack);
               });
            }

            return res.status(500).json({
               message: 'An unexpected error occurred while saving the time tracker. Please try again later.',
               note: policyNote
            });
         }

         // Kick off the Bedrock auto-ingest pipeline in the background when the
         // feature flag covers this account. When the flag is off the rows just
         // sit in timesheet_entries until a human reviewer applies them — no
         // external AI is contacted under any condition. (OpenAI integration
         // was removed in the Phase 1 cutover; see migration 011.)
         if (insertedEntries.length && _isAutoIngestAllowed(accountIdNumber)) {
            const insertedIds = insertedEntries.map(e => e?.timesheet_entry_id).filter(Boolean);
            if (insertedIds.length) {
               kickOffAutoIngestForEntryIds({
                  db,
                  accountId: accountIdNumber,
                  userId: requestingUserRecord?.user_id || null,
                  entryIds: insertedIds
               });
            }
         }

         const staffRecords = await timeTrackerStaffService.listActiveEmailsByAccount(db, accountIdNumber);
         const billingStaffEmails = staffRecords.map(record => record.email).filter(Boolean);

         let staffNotifiedCount = 0;
         try {
            const info = await sendValidationSuccessEmail({
               billingStaffEmails,
               userRecord,
               metadata: validationResult.metadata,
               storedFileName,
               entryCount: insertedEntries.length
            });
            if (info && info.accepted) {
               staffNotifiedCount = info.accepted.length;
            } else if (billingStaffEmails.length) {
               staffNotifiedCount = billingStaffEmails.length;
            }
         } catch (emailError) {
            console.error(`[${new Date().toISOString()}] Failed to send validation success email: ${emailError.message}`, emailError.stack);
         }

         if (staffNotifiedCount) {
            console.log(`[${new Date().toISOString()}] Successfully notified ${staffNotifiedCount} time tracker staff member(s) of upload "${storedFileName}".`);
         }

         // Optionally send user-facing success emails; disabled by default to avoid duplicate notices.
         // Enable by setting TIME_TRACKER_SEND_USER_SUCCESS_EMAILS=1
         const sendUserSuccessEmails = process.env.TIME_TRACKER_SEND_USER_SUCCESS_EMAILS === '1';
         const ownerEmail = validationResult.metadata?.submittedForEmail || userRecord?.email || null;
         const submitterEmail = validationResult.metadata?.submittedByEmail || requestingUserRecord?.email || null;
         const staffEmailSet = new Set((billingStaffEmails || []).map(e => (e || '').toLowerCase()));

         if (sendUserSuccessEmails) {
            const notifiedEmails = new Set();
            // Avoid emailing users who already receive the staff "ready for review" email
            if (ownerEmail && !staffEmailSet.has(String(ownerEmail).toLowerCase())) {
               try {
                  await sendSuccessEmail(ownerEmail, storedFileName);
                  notifiedEmails.add(ownerEmail);
               } catch (emailError) {
                  console.error(`[${new Date().toISOString()}] Failed to send success email to owner (${ownerEmail}): ${emailError.message}`, emailError.stack);
               }
            } else if (ownerEmail) {
               console.info(`[${new Date().toISOString()}] Skipping duplicate success email to owner (${ownerEmail}); already notified as staff.`);
            }

            if (submitterEmail && submitterEmail !== ownerEmail && !staffEmailSet.has(String(submitterEmail).toLowerCase())) {
               try {
                  await sendSuccessEmail(submitterEmail, storedFileName);
                  notifiedEmails.add(submitterEmail);
               } catch (emailError) {
                  console.error(`[${new Date().toISOString()}] Failed to send success email to submitter (${submitterEmail}): ${emailError.message}`, emailError.stack);
               }
            } else if (submitterEmail && submitterEmail !== ownerEmail) {
               console.info(`[${new Date().toISOString()}] Skipping duplicate success email to submitter (${submitterEmail}); already notified as staff.`);
            }

            if (notifiedEmails.size) {
               console.log(`[${new Date().toISOString()}] Sent confirmation email(s) to: ${Array.from(notifiedEmails).join(', ')}.`);
            }
         } else {
            console.info(`[${new Date().toISOString()}] User success emails disabled; only "ready for review" notifications sent to staff.`);
         }

         console.log(
            `[${new Date().toISOString()}] Tracker upload complete for "${decodedOriginalName}". Stored as "${storedFileName}". Submitted by user ${userIdNumber} for user ${ownerUserIdNumber}.`
         );

         const insertedIndexSet = new Set(dedupe.toInsertIndexes);
         const nonBillableRows = entryMeta
            .map((meta, index) => ({ row: meta.sourceRow, reason: meta.nonWorkReason, inserted: insertedIndexSet.has(index) }))
            .filter(item => item.reason && item.inserted)
            .map(({ row, reason }) => ({ row, reason }));
         const messageParts = ['Time tracker validated and uploaded successfully.'];
         if (dedupe.duplicates.length) {
            messageParts.push(
               `${dedupe.duplicates.length} row${dedupe.duplicates.length === 1 ? ' was' : 's were'} already uploaded earlier and ${dedupe.duplicates.length === 1 ? 'was' : 'were'} skipped as ${dedupe.duplicates.length === 1 ? 'a duplicate' : 'duplicates'}.`
            );
         }
         if (nonBillableRows.length) {
            messageParts.push(
               `${nonBillableRows.length} row${nonBillableRows.length === 1 ? ' looks' : 's look'} like non-work time (vacation / PTO / holiday / sick / personal / lunch) and will never be auto-billed.`
            );
         }

         return res.status(201).json({
            message: messageParts.join(' '),
            storedKey: s3Key,
            fileName: storedFileName,
            metadata: validationResult.metadata,
            inserted_count: insertedEntries.length,
            duplicates_skipped: dedupe.duplicates,
            duplicates_skipped_count: dedupe.duplicates.length,
            non_billable_rows: nonBillableRows,
            note: policyNote
         });
      } catch (error) {
         const status = error.status || 500;
         if (status >= 500 && adminRecipients.length) {
            await sendSystemErrorEmail({
               adminEmails: adminRecipients,
               userRecord,
               accountRecord,
               originalFileName: decodedOriginalName,
               error
            }).catch(emailError => {
               console.error(`[${new Date().toISOString()}] Failed to send system error email: ${emailError.message}`, emailError.stack);
            });
         }

         const message = status >= 500 ? 'An unexpected error occurred while uploading the time tracker.' : error.message;

         console.error(`[${new Date().toISOString()}] Upload failed for "${decodedOriginalName}" with status ${status}: ${error.message}`, error.stack);

         return res.status(status).json({ message, note: policyNote });
      }
   })
);

// GET /time-tracking/users/:accountID/:userID
// Returns the list of active users the requester is allowed to see.
timeTrackingRouter.get(
   '/users/:accountID/:userID',
   requireAuth,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;
      const accountIdNumber = Number(accountID);
      const userIdNumber = Number(userID);

      if (!Number.isFinite(accountIdNumber) || !Number.isFinite(userIdNumber)) {
         return res.status(400).json({
            message: 'Invalid account or user information provided.',
            status: 400
         });
      }

      const db = req.app.get('db');
      const [requestingUserRecord, activeUsers] = await Promise.all([fetchUserRecord(db, accountIdNumber, userIdNumber), accountUserService.getActiveAccountUsers(db, accountIdNumber)]);

      const requesterRole = requestingUserRecord?.access_level?.toLowerCase?.() || '';
      const allowedRoles = ['super admin', 'admin', 'manager'];
      const canSeeAll = allowedRoles.includes(requesterRole);

      const normalizedUsers = (activeUsers || []).map(user => ({
         userId: user.user_id,
         displayName: user.display_name || user.email || `User ${user.user_id}`,
         email: user.email || '',
         accessLevel: user.access_level || ''
      }));

      const filteredUsers = canSeeAll ? normalizedUsers : normalizedUsers.filter(user => user.userId === userIdNumber);

      return res.status(200).json({
         users: filteredUsers,
         status: 200
      });
   })
);

// GET /time-tracking/history/:accountID/:userID
// Lists uploaded tracker files for the requesting user (supports legacy and new folder structures).
timeTrackingRouter.get(
   '/history/:accountID/:userID',
   requireAuth,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;
      const db = req.app.get('db');
      const userRecord = await fetchUserRecord(db, accountID, userID);
      const accountRecord = await fetchAccountRecord(db, accountID);
      const userFolder = buildUserFolder(userRecord);
      const { primaryPrefix, legacyIdKeyedPrefix, accountLegacyPrefix, legacyPrefix } = buildProcessedPrefixes(accountRecord, accountID, userFolder, userID);

      const [primaryObjects, legacyIdKeyedObjects, rawAccountLegacyObjects, rawFlatLegacyObjects] = await Promise.all([
         listObjects(primaryPrefix),
         listObjects(legacyIdKeyedPrefix),
         listObjects(accountLegacyPrefix),
         listObjects(legacyPrefix)
      ]);
      // Both name-keyed prefixes are shared by any OTHER same-named employee —
      // another account's for the flat layout, or (pre-fix) this SAME
      // account's for the old account-scoped-by-name layout — so only surface
      // the objects this account's own upload history actually accounts for
      // THIS owner. legacyIdKeyedPrefix needs no such filtering: like
      // primaryPrefix, its leaf is keyed by this owner's immutable numeric id
      // (see buildProcessedPrefixes, finding 5).
      const legacyObjects = await filterLegacyObjectsToOwner(db, accountID, userID, [...(rawAccountLegacyObjects || []), ...(rawFlatLegacyObjects || [])]);
      const mergedObjects = [...(primaryObjects || []), ...(legacyIdKeyedObjects || []), ...(legacyObjects || [])];

      if (!mergedObjects.length) {
         return res.status(200).json({ history: [] });
      }

      const uniqueObjects = Array.from(
         mergedObjects
            .reduce((accumulator, object) => {
               if (object?.Key && !accumulator.has(object.Key)) {
                  accumulator.set(object.Key, object);
               }
               return accumulator;
            }, new Map())
            .values()
      );

      const history = uniqueObjects
         .filter(object => object.Key && object.Key !== primaryPrefix && object.Key !== legacyIdKeyedPrefix && object.Key !== accountLegacyPrefix && object.Key !== legacyPrefix)
         .map(object => {
            const baseName = path.basename(object.Key);
            const fileName = baseName.endsWith('.gz') ? baseName.slice(0, -3) : baseName;
            return {
               id: object.Key,
               key: object.Key,
               fileName,
               uploadedAt: object.LastModified ? object.LastModified.toISOString() : null,
               size: object.Size ?? null
            };
         })
         .sort((a, b) => {
            if (!a.uploadedAt) return 1;
            if (!b.uploadedAt) return -1;
            return new Date(b.uploadedAt) - new Date(a.uploadedAt);
         });

      res.status(200).json({ history });
   })
);

// GET /time-tracking/history/download/:accountID/:userID?key=...
// Downloads a specific uploaded tracker by S3 key.
timeTrackingRouter.get(
   '/history/download/:accountID/:userID',
   requireAuth,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;
      const { key } = req.query;

      if (!key) {
         return res.status(400).json({ message: 'An S3 object key is required to download the file.' });
      }

      // RESIDUAL finding, Astra round 9: this route used to go straight from
      // "does the key start with one of my own prefixes" to getObject() with
      // no syntax check at all — a key that legitimately STARTS WITH this
      // owner's own primaryPrefix could still carry '../', a backslash, or a
      // residual '%' past that prefix-only test (a prefix match is a
      // string.startsWith check, not a path-safety check). Run the same
      // syntax gate every other client-supplied-key route uses, before any
      // prefix comparison or S3 call.
      if (!isSyntacticallySafeKey(key)) {
         return res.status(403).json({ message: 'You do not have access to this file.' });
      }

      const db = req.app.get('db');
      const userRecord = await fetchUserRecord(db, accountID, userID);
      const accountRecord = await fetchAccountRecord(db, accountID);
      const userFolder = buildUserFolder(userRecord);
      const { primaryPrefix, legacyIdKeyedPrefix, accountLegacyPrefix, legacyPrefix } = buildProcessedPrefixes(accountRecord, accountID, userFolder, userID);

      let authorized;
      if (key.startsWith(primaryPrefix) || key.startsWith(legacyIdKeyedPrefix)) {
         // owner-id-scoped key (current storage_slug folder, or the
         // pre-storage_slug folder it replaced — finding 5): inherently this
         // exact owner's own either way.
         authorized = true;
      } else if (key.startsWith(accountLegacyPrefix) || key.startsWith(legacyPrefix)) {
         // Name-keyed legacy key (account-scoped-by-name, or the older flat
         // layout): either folder is shared by any OTHER same-named employee
         // (in this same account for accountLegacyPrefix; in another account
         // for legacyPrefix), so only serve it if this account's own upload
         // history actually accounts for that file name FOR THIS OWNER.
         authorized = await legacyKeyBelongsToOwner(db, accountID, userID, key);
      } else if (key.startsWith(`${PROCESSED_ROOT}/`)) {
         // review/full-audit-2026-09 finding 5 (Astra round 10): a key under
         // this account's own time-tracking namespace that doesn't match ANY
         // prefix reconstructable from the account's CURRENT name/slug — e.g.
         // a pre-storage_slug object surviving a SECOND rename that happened
         // after the storage_slug cutover — still gets one more chance via
         // the same DB-backed ownership rule used for the name-keyed legacy
         // prefixes above, so a file this account's own tracker history
         // really did record for this owner is never turned into a 403 by a
         // rename alone. Scoped to PROCESSED_ROOT so this can never become a
         // way to reach an S3 key outside the time-tracking namespace.
         authorized = await legacyKeyBelongsToOwner(db, accountID, userID, key);
      } else {
         authorized = false;
      }

      if (!authorized) {
         return res.status(403).json({ message: 'You do not have access to this file.' });
      }

      let body;
      let metadata;
      try {
         ({ body, metadata } = await getObject(key));
      } catch (err) {
         if (err.name === 'NoSuchKey') {
            return res.status(404).json({ message: 'That time tracker file could not be found.' });
         }
         throw err;
      }
      const metadataValues = metadata?.userMetadata || {};
      const storedFileName = path.basename(key).replace(/\.gz$/, '');
      const originalContentType = metadataValues['original-content-type'] || 'application/octet-stream';

      const decompressedFile = await gunzip(body);

      res.set({
         'Content-Type': originalContentType,
         'Content-Disposition': `attachment; filename="${storedFileName}"`,
         'X-Tracker-Filename': storedFileName
      });

      return res.status(200).send(decompressedFile);
   })
);

// GET /time-tracking/download/by-name/:accountID/:userID?ownerUserID=...&timesheetName=...
// Attempts to resolve and download a tracker by its stored file name, with fallbacks for variants.
timeTrackingRouter.get(
   '/download/by-name/:accountID/:userID',
   requireAuth,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;
      const { ownerUserID, timesheetName } = req.query;

      if (!ownerUserID || !timesheetName) {
         return res.status(400).json({ message: 'Both ownerUserID and timesheetName are required to download a tracker.' });
      }

      // RESIDUAL finding, Astra round 9: path.basename() only splits on '/'
      // (even on POSIX, never '\'), so a timesheetName containing a
      // backslash, a residual '%', or a control byte satisfied
      // `safeTimesheetName === timesheetName` unchanged and reached the raw
      // `variants.add(baseName)` candidate below unexamined. timesheetName is
      // used exactly like a bare filename here (the route prepends its own
      // fixed prefix) — isSafeBareFilename is the same check
      // pendingPayments-router.js uses for that exact shape.
      const safeTimesheetName = path.basename(timesheetName);
      if (!safeTimesheetName || safeTimesheetName !== timesheetName || !isSafeBareFilename(timesheetName)) {
         return res.status(400).json({ message: 'Invalid timesheet name provided.' });
      }

      const db = req.app.get('db');

      const [requestingUserRecord, ownerUserRecord, accountRecord] = await Promise.all([
         fetchUserRecord(db, accountID, userID),
         fetchUserRecord(db, accountID, ownerUserID),
         fetchAccountRecord(db, accountID)
      ]);

      const requesterRole = requestingUserRecord?.access_level?.toLowerCase();
      const isSelfRequest = Number(userID) === Number(ownerUserID);
      const allowedRoles = ['super admin', 'admin', 'manager'];

      if (!isSelfRequest && !allowedRoles.includes(requesterRole)) {
         return res.status(403).json({ message: 'You are not authorized to download this tracker.' });
      }

      const ownerFolder = buildUserFolder(ownerUserRecord);
      const { primaryPrefix, legacyIdKeyedPrefix, accountLegacyPrefix, legacyPrefix } = buildProcessedPrefixes(accountRecord, accountID, ownerFolder, ownerUserID);
      // Both name-keyed legacy prefixes are shared by any OTHER same-named
      // employee — another account's for the flat layout, or (pre-fix) this
      // SAME account's for the old account-scoped-by-name layout — so only
      // ever resolve a legacy-prefix candidate whose name is one this
      // account's own history actually recorded for THIS owner.
      const ownLegacyNames = new Set(await timesheetsService.getAllTimesheetNamesEverUsedByEmployee(db, accountID, ownerUserID));

      const evaluateCandidate = key => `${key.endsWith('.gz') ? key : `${key}.gz`}`;

      const baseName = path.basename(timesheetName);
      const ext = path.extname(baseName);
      const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName;

      const buildVariants = () => {
         const variants = new Set();
         const trimmed = nameWithoutExt.trim();
         if (baseName) variants.add(baseName);
         if (trimmed) {
            variants.add(`${trimmed.replace(/\s+/g, '_')}${ext}`);
            variants.add(`${trimmed.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`);
            variants.add(`${sanitizeSegment(trimmed)}${ext}`);
            variants.add(`${trimmed.replace(/[^a-zA-Z0-9_-]/g, '')}${ext}`);
         }
         return Array.from(variants).filter(Boolean);
      };

      const candidateNames = buildVariants();

      const candidateKeys = candidateNames.flatMap(name => {
         // primaryPrefix and legacyIdKeyedPrefix are both keyed by this
         // owner's immutable numeric id (finding 5) — always safe to try
         // regardless of recorded history, exactly like primaryPrefix alone
         // used to be.
         const keys = [evaluateCandidate(`${primaryPrefix}${name}`), evaluateCandidate(`${legacyIdKeyedPrefix}${name}`)];
         if (ownLegacyNames.has(name)) {
            keys.push(evaluateCandidate(`${accountLegacyPrefix}${name}`), evaluateCandidate(`${legacyPrefix}${name}`));
         }
         return keys;
      });

      let downloadKey = null;
      let downloadedObject = null;

      const tryFetchObject = async key => {
         const object = await getObject(key);
         if (object?.body) {
            downloadKey = key;
            downloadedObject = object;
         }
      };

      for (const key of candidateKeys) {
         if (downloadKey) break;
         try {
            await tryFetchObject(key);
         } catch (error) {
            if (error.name !== 'NoSuchKey') {
               console.error(`[${new Date().toISOString()}] Error attempting to download "${key}": ${error.message}`);
            }
         }
      }

      if (!downloadKey || !downloadedObject) {
         const normalize = value => sanitizeSegment((value || '').replace(/\.gz$/i, '')).toLowerCase();
         const targetVariants = Array.from(new Set([...candidateNames, baseName, nameWithoutExt, safeTimesheetName].filter(Boolean))).map(normalize);
         // Same ownership rule as the direct-candidate lookup above, applied to
         // the legacy/flat prefix's listing scan.
         const ownLegacyNormalized = new Set([...ownLegacyNames].map(normalize));

         const idKeyedPrefixes = new Set([primaryPrefix, legacyIdKeyedPrefix]);
         const prefixesToSearch = [primaryPrefix, legacyIdKeyedPrefix, accountLegacyPrefix, legacyPrefix];

         for (const prefix of prefixesToSearch) {
            if (downloadKey) break;
            try {
               const objects = await listObjects(prefix);
               for (const object of objects || []) {
                  if (!object?.Key) continue;
                  const base = path.basename(object.Key);
                  const normalizedBase = normalize(base);
                  // Neither name-keyed legacy prefix is trusted as this
                  // owner's own without checking their recorded history —
                  // only the id-keyed prefixes (primaryPrefix and
                  // legacyIdKeyedPrefix — finding 5) are inherently theirs.
                  if (!idKeyedPrefixes.has(prefix) && !ownLegacyNormalized.has(normalizedBase)) continue;
                  if (targetVariants.includes(normalizedBase)) {
                     try {
                        await tryFetchObject(object.Key);
                        if (downloadKey) break;
                     } catch (fetchError) {
                        console.error(`[${new Date().toISOString()}] Error retrieving candidate key "${object.Key}": ${fetchError.message}`);
                     }
                  }
               }
            } catch (listError) {
               console.error(`[${new Date().toISOString()}] Failed to list objects under "${prefix}": ${listError.message}`);
            }
         }

         if (!downloadKey || !downloadedObject) {
            console.error(`[${new Date().toISOString()}] Tracker download failed. Account ${accountID}, requester ${userID}, owner ${ownerUserID}, requested name "${timesheetName}".`);
            return res.status(404).json({
               message: 'We could not locate that time tracker. It may have been archived or renamed.'
            });
         }
      }

      const metadata = downloadedObject?.metadata;
      const metadataValues = metadata?.userMetadata || {};
      let storedFileName = path.basename(downloadKey);
      const originalContentType = metadataValues['original-content-type'] || 'application/octet-stream';

      let fileBuffer;
      const shouldGunzip = storedFileName.toLowerCase().endsWith('.gz');

      try {
         fileBuffer = shouldGunzip ? await gunzip(downloadedObject.body) : downloadedObject.body;
         if (shouldGunzip) {
            storedFileName = storedFileName.replace(/\.gz$/i, '');
         }
      } catch (decompressError) {
         console.error(`[${new Date().toISOString()}] Failed to decompress tracker "${downloadKey}": ${decompressError.message}`);
         return res.status(500).json({
            message: 'We were unable to open that time tracker file. It may be corrupted. Please contact support if this continues.'
         });
      }

      res.set({
         'Content-Type': originalContentType,
         'Content-Disposition': `attachment; filename="${storedFileName}"`,
         'X-Tracker-Filename': storedFileName
      });

      return res.status(200).send(fileBuffer);
   })
);

// The object under TRACKER_VERSIONS_ROOT is a single firm-wide S3 key (see
// TIME_TRACKING_ROOT above — hard-coded to the "James_F__Kimmel___Associates"
// slug) written only via POST /template/upload below. Nothing records a
// per-object owner today: there is no tracker_versions DB table, and upload
// only stamps an 'original-filename' on the object, never an account id.
// Since the key itself lives under account 1's slug and account 1 is the
// only real uploader, account 1 is treated as that object's owner. Only the
// owner may ever receive the raw bytes; every other account is always served
// a copy rebuilt from ITS OWN customers/employees/categories instead — see
// the /template/latest handler below. If a real per-object owner is ever
// recorded (S3 metadata or a tracker_versions row), replace this constant
// with a lookup against that instead. Overridable per deployment with the
// TEMPLATE_OWNER_ACCOUNT_ID environment variable (default 1).
const TEMPLATE_OWNER_ACCOUNT_ID = Number(process.env.TEMPLATE_OWNER_ACCOUNT_ID) || 1;

// GET /time-tracking/template/latest/:accountID/:userID
// Admin: Fetch the latest tracker template from S3.
timeTrackingRouter.get(
   '/template/latest/:accountID/:userID',
   requireAuth,
   asyncHandler(async (req, res) => {
      const objects = await listObjects(`${TRACKER_VERSIONS_ROOT}/`);

      if (!objects || !objects.length) {
         return res.status(404).json({ message: 'No tracker templates are available in S3.' });
      }

      const sortedObjects = objects
         .filter(object => {
            if (!object.Key) return false;
            if (object.Key.endsWith('/')) return false;
            const baseName = path.basename(object.Key);
            return /^timetracker_/i.test(baseName);
         })
         .sort((a, b) => {
            const aTime = a.LastModified ? new Date(a.LastModified).getTime() : 0;
            const bTime = b.LastModified ? new Date(b.LastModified).getTime() : 0;
            return bTime - aTime;
         });

      if (!sortedObjects.length) {
         return res.status(404).json({ message: 'Unable to find a base tracker template.' });
      }

      const latestTemplate = sortedObjects[0];
      const { body, metadata } = await getObject(latestTemplate.Key);
      const fileName = path.basename(latestTemplate.Key);
      const contentType = metadata?.contentType || 'application/octet-stream';

      const accountIdNumber = Number(req.params.accountID);
      const userIdNumber = Number(req.params.userID);
      const isOwnerAccount = accountIdNumber === TEMPLATE_OWNER_ACCOUNT_ID;

      // Every account other than the template's owner ALWAYS gets a copy
      // rebuilt for its own customers/employees/categories, regardless of
      // the auto-ingest flag — otherwise it would silently receive the
      // owner's real client and staff names (both in the hidden lookup
      // sheets and the visible "Employee Names" sheet). The owner account
      // keeps the legacy behavior: a passthrough unless auto-ingest is on
      // for it too, in which case it gets its own rebuild (falling back to
      // its own raw bytes if that rebuild fails, same as always).
      if (!isOwnerAccount || _isAutoIngestAllowed(accountIdNumber)) {
         try {
            const db = req.app.get('db');
            // isOwnerAccount, forwarded (round 10, 2026-09-23 — Astra
            // findings 1 & 2): buildTemplate no longer scrubs a non-owner
            // download from these owner bytes at all — it rebuilds from the
            // reviewed, committed neutral-template.xlsx asset instead, and
            // never reads baseTemplateBuffer to do it. See the
            // design-decision comment above buildTemplate in
            // template-builder.js. baseTemplateBuffer is still passed
            // through unconditionally (harmless for a non-owner build, which
            // ignores it) so the owner-with-autoingest branch above keeps
            // rebuilding from ITS OWN bytes exactly as before.
            const { buffer, counts } = await templateBuilder.buildTemplate({
               db,
               accountId: accountIdNumber,
               userId: userIdNumber,
               baseTemplateBuffer: body,
               isOwnerAccount
            });
            res.set({
               'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'Content-Disposition': `attachment; filename="${fileName}"`,
               'X-Tracker-Filename': fileName,
               'X-Tracker-Customers': String(counts.customers),
               'X-Tracker-Employees': String(counts.employees),
               'X-Tracker-Categories': String(counts.categories)
            });
            return res.status(200).send(buffer);
         } catch (err) {
            console.error(`[${new Date().toISOString()}] template-builder failed for account ${accountIdNumber}: ${err.message}`);
            if (!isOwnerAccount) {
               // Never launder the owner's names into another tenant's
               // download by falling back to the shared raw bytes here.
               return res.status(503).json({
                  message: 'We could not prepare your time tracker template right now. Please try again shortly, or contact support if this continues.'
               });
            }
            // Owner account: fall through to serving its own bytes unmodified below.
         }
      }

      res.set({
         'Content-Type': contentType,
         'Content-Disposition': `attachment; filename="${fileName}"`,
         'X-Tracker-Filename': fileName
      });

      return res.status(200).send(body);
   })
);

// POST /time-tracking/template/upload/:accountID/:userID
// Owner-account super admin only (Kasi/Jon): Upload a new tracker template to S3.
timeTrackingRouter.post(
   '/template/upload/:accountID/:userID',
   requireSuperAdmin,
   rawUploadParser,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;

      // finding 3, review/full-audit-2026-09: the fixed account-1 slug this
      // object lives under is a storage location, not proof that the caller
      // is the account this shared, firm-wide template belongs to. A super
      // admin's role is checked above, but role alone let a super admin of
      // ANY account overwrite the one template every other tenant's
      // /template/latest rebuild starts from. Only the configured owner
      // account may mutate it.
      if (Number(accountID) !== TEMPLATE_OWNER_ACCOUNT_ID) {
         return res.status(403).json({ message: 'Only the template owner account may upload a shared tracker template.', status: 403 });
      }

      const fileNameHeader = req.headers['x-file-name'];
      const fileTypeHeader = req.headers['x-file-type'] || 'application/octet-stream';

      if (!fileNameHeader) {
         return res.status(400).json({ message: 'Missing file metadata. Please include the original file name.' });
      }

      if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) {
         return res.status(400).json({ message: 'Uploaded file is empty or missing.' });
      }

      if (req.body.length > MAX_UPLOAD_BYTES) {
         return res.status(400).json({ message: 'File exceeds the 1MB size limit.' });
      }

      const db = req.app.get('db');

      let decodedOriginalName;
      try {
         decodedOriginalName = decodeURIComponent(fileNameHeader);
      } catch (decodeError) {
         return res.status(400).json({ message: 'Invalid file name encoding.' });
      }
      const extension = resolveExtension(decodedOriginalName, fileTypeHeader) || '.xlsx';
      const timestamp = formatTimestamp();
      const storedFileName = `timeTracker_${timestamp}${extension}`;
      const s3Key = `${TRACKER_VERSIONS_ROOT}/${storedFileName}`;

      await putObject(s3Key, req.body, fileTypeHeader || 'application/octet-stream', {
         'original-filename': encodeURIComponent(decodedOriginalName)
      });

      res.status(201).json({
         message: 'Tracker template uploaded successfully.',
         storedKey: s3Key,
         fileName: storedFileName,
         accountID
      });
   })
);

// GET /time-tracking/template/list/:accountID/:userID
// Admin: List available tracker templates in S3.
timeTrackingRouter.get(
   '/template/list/:accountID/:userID',
   requireAuth,
   asyncHandler(async (req, res) => {
      // Authorize the AUTHENTICATED caller (req.user), never the selected
      // URL :userID's own record — a manager can legitimately address another
      // user's id here (enforceSelfOrPrivileged allows it), and that other
      // user's record could belong to an admin, which used to let the manager
      // "borrow" that admin's role just by addressing their id in the URL.
      ensureAdminAccess(req.user);

      // finding 3 (list-route callout), review/full-audit-2026-09: this list
      // used to hand back the owner firm's raw S3 keys (and therefore its
      // account-name slug) to an admin of ANY account — including the exact
      // key finding 1 then used to bypass the download guard. Non-owner
      // accounts don't manage this shared, firm-wide template at all, so
      // they get an (unremarkable, UI-safe) empty list instead of a peek at
      // owner-account S3 layout. `managedByOwnerAccount` lets a future UI
      // explain the empty state without changing what the owner account
      // receives. No listObjects call is even made for a non-owner caller.
      if (Number(req.params.accountID) !== TEMPLATE_OWNER_ACCOUNT_ID) {
         return res.status(200).json({ templates: [], managedByOwnerAccount: true });
      }

      const objects = await listObjects(`${TRACKER_VERSIONS_ROOT}/`);

      if (!objects || !objects.length) {
         return res.status(200).json({ templates: [] });
      }

      const templates = objects
         .filter(object => {
            if (!object.Key) return false;
            if (object.Key.endsWith('/')) return false;
            const baseName = path.basename(object.Key);
            return /^timetracker_/i.test(baseName);
         })
         .map(object => ({
            id: object.Key,
            key: object.Key,
            fileName: path.basename(object.Key),
            uploadedAt: object.LastModified ? object.LastModified.toISOString() : null,
            size: object.Size ?? null
         }))
         .sort((a, b) => {
            if (!a.uploadedAt) return 1;
            if (!b.uploadedAt) return -1;
            return new Date(b.uploadedAt) - new Date(a.uploadedAt);
         });

      res.status(200).json({ templates });
   })
);

// DELETE /time-tracking/template/delete/:accountID/:userID
// Super admin only — same gate as template upload (a firm-wide template
// version affects every tenant, so deleting one is held to the same bar as
// creating one; it used to only require plain admin access). Also owner-
// account-only, same rationale and finding as template upload above: a
// super admin's role says nothing about whether their account owns this
// shared, firm-wide object.
timeTrackingRouter.delete(
   '/template/delete/:accountID/:userID',
   requireSuperAdmin,
   jsonParser,
   asyncHandler(async (req, res) => {
      const { accountID } = req.params;

      if (Number(accountID) !== TEMPLATE_OWNER_ACCOUNT_ID) {
         return res.status(403).json({ message: 'Only the template owner account may delete a shared tracker template.', status: 403 });
      }

      const { key } = req.body || {};

      if (!key) {
         return res.status(400).json({ message: 'S3 key is required to delete a template.' });
      }

      // RESIDUAL finding, Astra round 9: a key containing '../' could
      // satisfy `startsWith(TRACKER_VERSIONS_ROOT + '/')` (a plain string
      // prefix check) AND end with a `timetracker_`-basename after the
      // traversal segments, reaching deleteObject() unexamined. The syntax
      // gate every other client-supplied-key route uses now runs here too.
      if (!isSyntacticallySafeKey(key) || !key.startsWith(`${TRACKER_VERSIONS_ROOT}/`) || key.endsWith('/')) {
         return res.status(400).json({ message: 'Invalid template key.' });
      }

      const baseName = path.basename(key);
      if (!/^timetracker_/i.test(baseName)) {
         return res.status(400).json({ message: 'Only tracker template files can be deleted.' });
      }

      await deleteObject(key);

      res.status(204).send();
   })
);

module.exports = timeTrackingRouter;
