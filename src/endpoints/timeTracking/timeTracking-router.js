const express = require('express');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const dayjs = require('dayjs');
const asyncHandler = require('../../utils/asyncHandler');
const { requireAuth } = require('../auth/jwt-auth');
const accountUserService = require('../user/user-service');
const accountService = require('../account/account-service');
const { listObjects, getObject, putObject, deleteObject } = require('../../utils/s3');
const { validateUploadedTracker } = require('../../timeTrackerValidation/validateUploadedTracker');
const timeTrackerStaffService = require('../timeTrackerStaff/timeTrackerStaff-service');
const { sendValidationSuccessEmail, sendSystemErrorEmail, getAdminRecipients } = require('../../timeTrackerValidation/notifications');
const sendSuccessEmail = require('../../utils/email/sendSuccessEmail');
const timesheetsService = require('../timesheets/timesheets-service');
const { kickOffAiSuggestionsForEntryIds } = require('../timesheets/aiTimesheetJobRunner');
const aiIntegrationService = require('../aiIntegration/aiIntegration-service');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const timeTrackingRouter = express.Router();
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

const buildAccountFolder = (accountRecord, accountID) => {
   const accountName = accountRecord.account_name || `account_${accountID}`;
   return `${sanitizeSegment(accountName)}_${accountID}`;
};

const buildProcessedPrefixes = (accountFolder, userFolder) => {
   const primaryPrefix = `${PROCESSED_ROOT}/${userFolder}/`;
   const legacyPrefix = `${PROCESSED_ROOT}/${accountFolder}/${userFolder}/`;
   return { primaryPrefix, legacyPrefix };
};

const ensureAdminAccess = userRecord => {
   const accessLevel = userRecord?.access_level?.toLowerCase();
   if (accessLevel !== 'admin') {
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
      const decodedOriginalName = decodeURIComponent(fileNameHeader);
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
         const allowedOverrideRoles = ['admin', 'manager'];
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
         const timestamp = formatTimestamp();
         const storedFileName = `${sanitizeSegment(lastName)}_${sanitizeSegment(firstName)}_${timestamp}${extension}`;
         const s3Key = `${PROCESSED_ROOT}/${userFolder}/${storedFileName}.gz`;
         const compressedFile = await gzip(req.body);

         normalizedEntries.forEach(entry => {
            entry.timesheet_name = storedFileName;
         });

         console.log(`[${new Date().toISOString()}] Validation passed for "${decodedOriginalName}". Saving compressed file to S3 key "${s3Key}".`);
         await putObject(s3Key, compressedFile, 'application/gzip', {
            'original-filename': encodeURIComponent(storedFileName),
            'original-content-type': fileTypeHeader
         });

         console.log(`[${new Date().toISOString()}] Successfully saved tracker to S3 at "${s3Key}". Persisting entries to database...`);

         const trx = await db.transaction();
         let insertedEntries = [];
         try {
            insertedEntries = await timesheetsService.insertTimesheetEntriesWithTransaction(trx, normalizedEntries);
            await trx.commit();
            console.log(`[${new Date().toISOString()}] Inserted ${normalizedEntries.length} entries into timesheet_entries for "${decodedOriginalName}".`);
         } catch (dbError) {
            await trx.rollback();
            console.error(`[${new Date().toISOString()}] Failed to persist timesheet entries for "${decodedOriginalName}": ${dbError.message}`, dbError.stack);

            try {
               await deleteObject(s3Key);
               console.log(`[${new Date().toISOString()}] Removed S3 object "${s3Key}" after database insert failure.`);
            } catch (cleanupError) {
               console.error(`[${new Date().toISOString()}] Failed to remove S3 object "${s3Key}" after database error: ${cleanupError.message}`);
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

         // Kick off AI categorization in the background if integration is enabled; do not block user response
         if (insertedEntries.length) {
            try {
               const integration = await aiIntegrationService.getIntegrationByAccount(db, accountIdNumber);
               if (integration && integration.is_enabled) {
                  const insertedIds = insertedEntries.map(e => e?.timesheet_entry_id).filter(Boolean);
                  if (insertedIds.length) {
                     kickOffAiSuggestionsForEntryIds({
                        db,
                        accountId: accountIdNumber,
                        userId: requestingUserRecord?.user_id || null,
                        entryIds: insertedIds
                     });
                  }
               } else {
                  console.info(`[${new Date().toISOString()}] AI integration disabled for account ${accountIdNumber}; skipping background AI kickoff.`);
               }
            } catch (aiCheckError) {
               console.warn(`[${new Date().toISOString()}] Failed to check AI integration for account ${accountIdNumber}: ${aiCheckError.message}`);
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
               entryCount: normalizedEntries.length
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

         return res.status(201).json({
            message: 'Time tracker validated and uploaded successfully.',
            storedKey: s3Key,
            fileName: storedFileName,
            metadata: validationResult.metadata,
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
      const allowedRoles = ['admin', 'manager'];
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
      const accountFolder = buildAccountFolder(accountRecord, accountID);
      const { primaryPrefix, legacyPrefix } = buildProcessedPrefixes(accountFolder, userFolder);

      const primaryObjects = await listObjects(primaryPrefix);
      const legacyObjects = await listObjects(legacyPrefix);
      const mergedObjects = [...(primaryObjects || []), ...(legacyObjects || [])];

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
         .filter(object => object.Key && object.Key !== primaryPrefix && object.Key !== legacyPrefix)
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

      const db = req.app.get('db');
      const userRecord = await fetchUserRecord(db, accountID, userID);
      const accountRecord = await fetchAccountRecord(db, accountID);
      const userFolder = buildUserFolder(userRecord);
      const accountFolder = buildAccountFolder(accountRecord, accountID);
      const { primaryPrefix, legacyPrefix } = buildProcessedPrefixes(accountFolder, userFolder);

      if (!key.startsWith(primaryPrefix) && !key.startsWith(legacyPrefix)) {
         return res.status(403).json({ message: 'You do not have access to this file.' });
      }

      const { body, metadata } = await getObject(key);
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

      const safeTimesheetName = path.basename(timesheetName);
      if (!safeTimesheetName || safeTimesheetName !== timesheetName) {
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
      const allowedRoles = ['admin', 'manager'];

      if (!isSelfRequest && !allowedRoles.includes(requesterRole)) {
         return res.status(403).json({ message: 'You are not authorized to download this tracker.' });
      }

      const ownerFolder = buildUserFolder(ownerUserRecord);
      const accountFolder = buildAccountFolder(accountRecord, accountID);
      const { primaryPrefix, legacyPrefix } = buildProcessedPrefixes(accountFolder, ownerFolder);

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

      const candidateKeys = candidateNames.flatMap(name => [evaluateCandidate(`${primaryPrefix}${name}`), evaluateCandidate(`${legacyPrefix}${name}`)]);

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

         const prefixesToSearch = [primaryPrefix, legacyPrefix];

         for (const prefix of prefixesToSearch) {
            if (downloadKey) break;
            try {
               const objects = await listObjects(prefix);
               for (const object of objects || []) {
                  if (!object?.Key) continue;
                  const base = path.basename(object.Key);
                  if (targetVariants.includes(normalize(base))) {
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

      res.set({
         'Content-Type': contentType,
         'Content-Disposition': `attachment; filename="${fileName}"`,
         'X-Tracker-Filename': fileName
      });

      return res.status(200).send(body);
   })
);

// POST /time-tracking/template/upload/:accountID/:userID
// Admin: Upload a new tracker template to S3.
timeTrackingRouter.post(
   '/template/upload/:accountID/:userID',
   requireAuth,
   rawUploadParser,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;
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
      const userRecord = await fetchUserRecord(db, accountID, userID);
      ensureAdminAccess(userRecord);

      const decodedOriginalName = decodeURIComponent(fileNameHeader);
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
      const { accountID, userID } = req.params;
      const db = req.app.get('db');
      const userRecord = await fetchUserRecord(db, accountID, userID);
      ensureAdminAccess(userRecord);

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
// Admin: Delete a specific tracker template from S3.
timeTrackingRouter.delete(
   '/template/delete/:accountID/:userID',
   requireAuth,
   jsonParser,
   asyncHandler(async (req, res) => {
      const { accountID, userID } = req.params;
      const { key } = req.body || {};

      if (!key) {
         return res.status(400).json({ message: 'S3 key is required to delete a template.' });
      }

      const db = req.app.get('db');
      const userRecord = await fetchUserRecord(db, accountID, userID);
      ensureAdminAccess(userRecord);

      if (!key.startsWith(`${TRACKER_VERSIONS_ROOT}/`) || key.endsWith('/')) {
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
