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
   'application/vnd.ms-excel.sheet.macroenabled.12': '.xlsm'
};

const formatTimestamp = () => dayjs().format('MMMM-DD-YYYY_hh-mm-ssA');

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

timeTrackingRouter.post(
   '/upload/:accountID/:userID',
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

      const userFolder = buildUserFolder(userRecord);
      const { firstName, lastName } = deriveUserNameSegments(userRecord);
      const decodedOriginalName = decodeURIComponent(fileNameHeader);
      const extension = resolveExtension(decodedOriginalName, fileTypeHeader);
      const timestamp = formatTimestamp();
      const storedFileName = `${sanitizeSegment(lastName)}_${sanitizeSegment(firstName)}_${timestamp}${extension}`;
      const s3Key = `${PROCESSED_ROOT}/${userFolder}/${storedFileName}.gz`;

      const compressedFile = await gzip(req.body);

      await putObject(s3Key, compressedFile, 'application/gzip', {
         'original-filename': encodeURIComponent(storedFileName),
         'original-content-type': fileTypeHeader
      });

      res.status(201).json({
         message: 'Time tracker uploaded successfully.',
         storedKey: s3Key,
         fileName: storedFileName
      });
   })
);

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
         mergedObjects.reduce((accumulator, object) => {
            if (object?.Key && !accumulator.has(object.Key)) {
               accumulator.set(object.Key, object);
            }
            return accumulator;
         }, new Map()).values()
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

      if (!key.startsWith(`${TRACKER_VERSIONS_ROOT}/`) || key.endsWith('/')) {
         return res.status(400).json({ message: 'Invalid template key.' });
      }

      const baseName = path.basename(key);
      if (!/^timetracker_/i.test(baseName)) {
         return res.status(400).json({ message: 'Only tracker template files can be deleted.' });
      }

      const db = req.app.get('db');
      const userRecord = await fetchUserRecord(db, accountID, userID);
      ensureAdminAccess(userRecord);

      await deleteObject(key);

      res.status(204).send();
   })
);

module.exports = timeTrackingRouter;
