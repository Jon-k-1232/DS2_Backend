/* eslint-disable no-console */
/*
   scripts/timeTracking/backfill-tracker-owners.js

   ONE-TIME, BY-HAND backfill for tracker_file_owners (migrations/
   021.tracker_file_owners.sql — see that file's header comment for the full
   writeup of why this table exists: review/full-audit-2026-09, Astra round
   13, finding P2). Every pre-existing tracker object under PROCESSED_ROOT
   (550 on 2026-09-24, all in the flat legacy layout) needs a reviewed,
   durable owner so timeTracking-router.js's buildKeyAuthorizer can serve it
   without ever re-deriving ownership from a CURRENT display name again.

   Usage:
      # 1. dry run (default): plan and write the review CSVs; nothing is written to the database
      DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/timeTracking/backfill-tracker-owners.js
      # 2. review <out>/...rows.csv (delete any line you do not approve; do not edit the other columns)
      # 3. apply EXACTLY the reviewed rows (never a fresh computation)
      DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/timeTracking/backfill-tracker-owners.js --apply --manifest <out>/...rows.csv
      DS2_ENV_FILE=.env.prod  DATABASE_NAME=ds2_prod  node scripts/timeTracking/backfill-tracker-owners.js --apply --manifest <reviewed rows.csv> --i-know-this-is-prod

   --apply writes only the rows of the reviewed manifest (Astra round 14: an
   apply that re-planned could hand a file to whoever matched a name AFTER
   the review, e.g. following a rename). Every manifest row is bound to the
   target it was reviewed against (database, bucket, legacy account) and is
   validated before anything is written. The script then re-plans read-only
   and REFUSES if any approved row has drifted (object gone, or the fresh plan
   now names a different owner or none); --accept-drift proceeds anyway, still
   writing the APPROVED owner, never the fresh one. An approved key already
   owned by someone else is refused, never overwritten.

   Like scripts/review-2026-09/*.js, DS2_ENV_FILE and DATABASE_NAME must both
   be set explicitly — there is no default target. A dry run only reads (S3
   listObjects, timesheet_entries, users) and writes its report to
   scripts/timeTracking/out/ (gitignored); nothing is written to the database
   unless --apply is also passed, and --apply against anything that LOOKS
   like production (database name or host matching /prod/i — see
   scripts/migrate.js's looksLikeProd, reused here rather than
   reimplemented) additionally requires --i-know-this-is-prod. --apply never
   updates an existing tracker_file_owners row (ON CONFLICT (s3_key) DO
   NOTHING, after refusing any approved key already owned by someone else) — a wrong or superseded backfill
   row is fixed by a separate, reviewed follow-up, never by silently
   overwriting a prior attribution.

   Attribution rules (see planTrackerOwnership below for the implementation
   and test/scripts/backfill-tracker-owners.spec.js for the full matrix):

     - id-keyed key (processed/<accountFolder>_<id>/user_<ownerId>/<file>):
       source 'path' — account and owner come straight from the path, which
       is trustworthy for this shape (only ever written by that owner's own
       upload since migration 020). Skipped as 'malformed' unless BOTH ids
       parse as canonical decimal strings (no leading zeros — see
       canonicalId, mirroring timeTracking-router.js's own check).

     - flat key (processed/<folder>/<file> — legacy tenant ONLY; a flat key
       is never attributed to any other account, since nothing in a flat
       key's path names an account at all) and name-keyed key
       (processed/<accountFolder>_<id>/<folder>/<file> — account read from
       the folder's id):
         1. the exact basename (its stored file name, with any trailing
            .gz stripped) is recorded as a timesheet_entries.timesheet_name
            by exactly ONE user of the key's own account -> 'recorded-upload'.
         2. recorded by MORE than one user of that account -> unattributed,
            reason 'ambiguous-recorded' (a human must pick).
         3. not recorded at all -> fall back to a ONE-TIME match against
            EVERY user of that account (active or not — a deactivated
            employee can still be the correct owner of an old file), by
            folder name (buildUserFolder/deriveUserNameSegments/
            sanitizeSegment from trackerFolderNames.js — the SAME shared
            helpers timeTracking-router.js uses to name a NEW upload's
            folder, so this backfill's judgment can never silently drift
            from what the router itself would have named that folder):
              exactly one matching user -> 'folder-at-backfill';
              no matching user          -> unattributed, reason 'no-matching-user';
              more than one             -> unattributed, reason 'ambiguous-folder'.

     - anything else (wrong depth, an empty segment, a key outside
       PROCESSED_ROOT) -> unattributed, reason 'malformed'.

   'folder-at-backfill' is explicitly a ONE-TIME, REVIEWED judgment call —
   the exact opposite of the removed ownerFolderIsUnique(), which
   re-computed "the unique current match" on every request forever and so
   silently followed every future rename. Once this script (with --apply)
   writes a 'folder-at-backfill' row, it is permanent: a later rename of
   that employee, or of some other, unrelated employee, never revisits it.
*/
'use strict';

// NOTE: src/utils/s3.js is deliberately NOT required at the top of this
// file (see main() below) — it reads S3_BUCKET_NAME/S3_REGION/
// S3_ENDPOINT/... straight off process.env at REQUIRE time (config.js),
// and a plain `node scripts/timeTracking/backfill-tracker-owners.js`
// process has not loaded the target env file yet at this point. Requiring
// it lazily, only inside main() after the env file is loaded, also means
// requiring THIS module purely for its pure planTrackerOwnership /
// parseTrackerKey exports (as test/scripts/backfill-tracker-owners.spec.js
// does) never needs any S3 config at all.
const fs = require('fs');
const path = require('path');
const { buildUserFolder } = require('../../src/endpoints/timeTracking/trackerFolderNames');
const { looksLikeProd } = require('../migrate');

// Mirrors timeTracking-router.js's TIME_TRACKING_ROOT / PROCESSED_ROOT and
// LEGACY_FLAT_TRACKER_ACCOUNT_ID exactly (hard-coded to the firm's real,
// immutable slug — see that file's own header comments). Never written to
// here; this script only ever reads PROCESSED_ROOT and writes to the
// database.
const PROCESSED_ROOT = 'James_F__Kimmel___Associates/time_tracking/processed';
const LEGACY_FLAT_TRACKER_ACCOUNT_ID = Number(process.env.LEGACY_FLAT_TRACKER_ACCOUNT_ID) || 1;

const ACCOUNT_FOLDER_ID_RE = /_(\d+)$/;
const USER_LEAF_RE = /^user_(\d+)$/;

// A raw digit string is trusted only when it is ALREADY a canonical decimal
// string (no leading zeros, positive, a safe integer) — the server itself
// never writes a leading-zero id, so `user_090011` or an account folder
// ending `_09001` is treated as malformed rather than silently reinterpreted
// as 90011 / 9001. This is a stricter, self-round-trip form of
// timeTracking-router.js's own canonicalId: the router always compares a
// RAW extracted string against an already-canonical id it already knows (a
// caller-supplied accountID/ownerUserID), so it never needed this check on
// its own — this script has no such known target to compare against, since
// discovering the id IS the point, so it must verify the raw string is
// canonical on its own terms instead.
const canonicalId = value => {
   const raw = String(value);
   const n = Number(raw);
   return Number.isSafeInteger(n) && n > 0 && String(n) === raw ? raw : null;
};

const stripGz = value => (value || '').replace(/\.gz$/i, '');

/**
 * Structural parse of `key` relative to `processedRoot`. Unlike
 * classifyProcessedKey in timeTracking-router.js (which VERIFIES a
 * caller-supplied owner against a key), this DISCOVERS candidate ownership
 * facts straight from the path, so it returns the parsed shape rather than
 * a single scope label.
 */
const parseTrackerKey = (processedRoot, key) => {
   if (typeof key !== 'string' || !key.startsWith(`${processedRoot}/`)) return { type: 'malformed' };
   const segments = key.slice(processedRoot.length + 1).split('/');
   if (!segments.length || !segments.every(Boolean)) return { type: 'malformed' };

   if (segments.length === 2) {
      const [folder, file] = segments;
      return { type: 'flat', folder, file };
   }
   if (segments.length !== 3) return { type: 'malformed' };

   const [accountFolder, leaf, file] = segments;
   const accountMatch = ACCOUNT_FOLDER_ID_RE.exec(accountFolder);
   const accountId = accountMatch ? canonicalId(accountMatch[1]) : null;

   const leafMatch = USER_LEAF_RE.exec(leaf);
   if (leafMatch) {
      const userId = canonicalId(leafMatch[1]);
      if (!accountId || !userId) return { type: 'malformed' };
      return { type: 'id-keyed', accountId: Number(accountId), userId: Number(userId), file };
   }

   if (!accountId) return { type: 'malformed' };
   return { type: 'name-keyed', accountId: Number(accountId), folder: leaf, file };
};

/**
 * Pure planner — no I/O. See this file's header comment for the full rule
 * set; test/scripts/backfill-tracker-owners.spec.js covers every branch.
 *
 * @param {object} args
 * @param {string[]} args.keys - every S3 key under PROCESSED_ROOT (directory markers already excluded)
 * @param {string} args.processedRoot
 * @param {number} args.legacyAccountId
 * @param {{account_id:number, user_id:number, timesheet_name:string}[]} args.recordedUploads - every (account, user, timesheet_name) timesheet_entries has ever recorded, across ALL accounts
 * @param {Record<number, {user_id:number, display_name:string}[]>} args.usersByAccount - EVERY user (active or not) of each account, keyed by account_id
 * @returns {{rows: {s3_key:string, account_id:number, user_id:number, source:string}[], unattributed: {s3_key:string, reason:string}[]}}
 */
const planTrackerOwnership = ({ keys, processedRoot, legacyAccountId, recordedUploads, usersByAccount }) => {
   const rows = [];
   const unattributed = [];

   // (account_id, basename) -> Set of user_ids that recorded it.
   const recordedIndex = new Map();
   (recordedUploads || []).forEach(rec => {
      const basename = stripGz(rec.timesheet_name);
      if (!basename) return;
      const idxKey = `${Number(rec.account_id)}::${basename}`;
      if (!recordedIndex.has(idxKey)) recordedIndex.set(idxKey, new Set());
      recordedIndex.get(idxKey).add(Number(rec.user_id));
   });

   (keys || []).forEach(key => {
      const parsed = parseTrackerKey(processedRoot, key);

      if (parsed.type === 'malformed') {
         unattributed.push({ s3_key: key, reason: 'malformed' });
         return;
      }

      if (parsed.type === 'id-keyed') {
         rows.push({ s3_key: key, account_id: parsed.accountId, user_id: parsed.userId, source: 'path' });
         return;
      }

      // flat (always the legacy tenant, never any other account) or
      // name-keyed (account read from the folder's own id).
      const accountId = parsed.type === 'flat' ? Number(legacyAccountId) : parsed.accountId;
      const basename = stripGz(parsed.file);
      const recordedUserIds = recordedIndex.get(`${accountId}::${basename}`);

      if (recordedUserIds && recordedUserIds.size === 1) {
         rows.push({ s3_key: key, account_id: accountId, user_id: [...recordedUserIds][0], source: 'recorded-upload' });
         return;
      }
      if (recordedUserIds && recordedUserIds.size > 1) {
         unattributed.push({ s3_key: key, reason: 'ambiguous-recorded' });
         return;
      }

      // Unrecorded: a ONE-TIME, reviewed match against every user of this
      // account (active or not) by folder name.
      const usersOfAccount = (usersByAccount && usersByAccount[accountId]) || [];
      const matches = usersOfAccount.filter(user => buildUserFolder(user) === parsed.folder);
      if (matches.length === 1) {
         rows.push({ s3_key: key, account_id: accountId, user_id: Number(matches[0].user_id), source: 'folder-at-backfill' });
      } else if (matches.length === 0) {
         unattributed.push({ s3_key: key, reason: 'no-matching-user' });
      } else {
         unattributed.push({ s3_key: key, reason: 'ambiguous-folder' });
      }
   });

   return { rows, unattributed };
};

// ── CSV (same escaping convention as scripts/review-2026-09/_common.js) ──
const toCsv = (rowsArr, columns) => {
   const cell = value => {
      let s = value === null || value === undefined ? '' : String(value);
      // Protect spreadsheet users from formula injection.
      if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
   };
   return [columns.join(','), ...rowsArr.map(row => columns.map(c => cell(row[c])).join(','))].join('\n') + '\n';
};

module.exports = { planTrackerOwnership, parseTrackerKey, canonicalId, PROCESSED_ROOT, LEGACY_FLAT_TRACKER_ACCOUNT_ID };

// ── Reviewed manifest: parse, validate, compare, apply ──────────────────
const MANIFEST_COLUMNS = ['database', 'bucket', 'legacy_account_id', 's3_key', 'account_id', 'user_id', 'source', 'owner_display_name'];
const ALLOWED_SOURCES = new Set(['recorded-upload', 'folder-at-backfill', 'path']);

// Minimal RFC 4180 parser for the files toCsv writes (quoted cells, doubled
// quotes, commas and newlines inside quotes). Undoes toCsv's formula guard.
const parseCsv = text => {
   const records = [];
   let row = [];
   let cell = '';
   let quoted = false;
   const src = String(text).replace(/^﻿/, '');
   for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (quoted) {
         if (ch === '"' && src[i + 1] === '"') {
            cell += '"';
            i += 1;
         } else if (ch === '"') {
            quoted = false;
         } else {
            cell += ch;
         }
      } else if (ch === '"') {
         quoted = true;
      } else if (ch === ',') {
         row.push(cell);
         cell = '';
      } else if (ch === '\n' || ch === '\r') {
         if (ch === '\r' && src[i + 1] === '\n') i += 1;
         row.push(cell);
         records.push(row);
         row = [];
         cell = '';
      } else {
         cell += ch;
      }
   }
   if (quoted) throw new Error('Manifest CSV has an unterminated quoted cell.');
   if (cell !== '' || row.length) {
      row.push(cell);
      records.push(row);
   }
   const unguard = value => (/^'[=+@\-\t\r]/.test(value) ? value.slice(1) : value);
   return records.filter(record => record.some(value => value !== '')).map(record => record.map(unguard));
};

const readManifest = text => {
   const [header, ...records] = parseCsv(text);
   if (!header || header.join(',') !== MANIFEST_COLUMNS.join(',')) {
      throw new Error(`Manifest header must be exactly: ${MANIFEST_COLUMNS.join(',')}`);
   }
   return records.map((record, index) => {
      if (record.length !== MANIFEST_COLUMNS.length) throw new Error(`Manifest line ${index + 2} has ${record.length} cells, expected ${MANIFEST_COLUMNS.length}.`);
      return Object.fromEntries(MANIFEST_COLUMNS.map((column, i) => [column, record[i]]));
   });
};

// Every problem with the manifest as a whole, before anything is written.
const validateManifestRows = ({ rows, identity, processedRoot, legacyAccountId }) => {
   const errors = [];
   const seen = new Set();
   rows.forEach((row, index) => {
      const line = index + 2;
      if (row.database !== identity.database) errors.push(`line ${line}: reviewed against database "${row.database}", target is "${identity.database}"`);
      if (row.bucket !== identity.bucket) errors.push(`line ${line}: reviewed against bucket "${row.bucket}", target is "${identity.bucket}"`);
      if (row.legacy_account_id !== String(legacyAccountId)) errors.push(`line ${line}: reviewed with legacy account ${row.legacy_account_id}, target uses ${legacyAccountId}`);
      if (seen.has(row.s3_key)) errors.push(`line ${line}: duplicate key ${row.s3_key}`);
      seen.add(row.s3_key);
      if (!ALLOWED_SOURCES.has(row.source)) errors.push(`line ${line}: source "${row.source}" is not allowed`);
      const accountId = canonicalId(row.account_id);
      const userId = canonicalId(row.user_id);
      if (!accountId || !userId) {
         errors.push(`line ${line}: account_id and user_id must be canonical positive integers`);
         return;
      }
      const parsed = parseTrackerKey(processedRoot, row.s3_key);
      if (parsed.type === 'malformed') errors.push(`line ${line}: malformed key ${row.s3_key}`);
      if (parsed.type === 'flat' && Number(accountId) !== Number(legacyAccountId)) errors.push(`line ${line}: a flat key can only belong to the legacy account ${legacyAccountId}`);
      if (parsed.type === 'name-keyed' && parsed.accountId !== Number(accountId)) errors.push(`line ${line}: key's account folder is ${parsed.accountId}, row says ${accountId}`);
      if (parsed.type === 'id-keyed' && (parsed.accountId !== Number(accountId) || parsed.userId !== Number(userId))) errors.push(`line ${line}: key's path names account ${parsed.accountId} user ${parsed.userId}, row says account ${accountId} user ${userId}`);
   });
   return errors;
};

// Approved rows whose facts changed since the review, from a fresh read-only plan.
const findDrift = ({ approved, freshKeys, freshPlan }) => {
   const present = new Set(freshKeys);
   const planned = new Map(freshPlan.rows.map(row => [row.s3_key, row]));
   const drift = [];
   approved.forEach(row => {
      if (!present.has(row.s3_key)) {
         drift.push({ s3_key: row.s3_key, reason: 'object-missing' });
         return;
      }
      const fresh = planned.get(row.s3_key);
      if (!fresh) {
         drift.push({ s3_key: row.s3_key, reason: 'now-unattributed', approved_user_id: Number(row.user_id) });
      } else if (Number(fresh.account_id) !== Number(row.account_id) || Number(fresh.user_id) !== Number(row.user_id)) {
         drift.push({ s3_key: row.s3_key, reason: 'owner-changed', approved_user_id: Number(row.user_id), fresh_user_id: Number(fresh.user_id) });
      }
   });
   return drift;
};

// Writes exactly the approved rows in one transaction. A key already owned by
// the SAME owner is skipped; a key owned by anyone else aborts the whole run.
const applyManifest = async (db, approved) =>
   db.transaction(async trx => {
      await trx.raw('LOCK TABLE tracker_file_owners IN SHARE ROW EXCLUSIVE MODE');
      const keys = approved.map(row => row.s3_key);
      const existing = keys.length ? await trx('tracker_file_owners').select('s3_key', 'account_id', 'user_id').whereIn('s3_key', keys) : [];
      const existingByKey = new Map(existing.map(row => [row.s3_key, row]));
      const conflicts = [];
      const toInsert = [];
      approved.forEach(row => {
         const current = existingByKey.get(row.s3_key);
         if (!current) toInsert.push(row);
         else if (Number(current.account_id) !== Number(row.account_id) || Number(current.user_id) !== Number(row.user_id)) conflicts.push({ s3_key: row.s3_key, owned_by_user_id: Number(current.user_id), approved_user_id: Number(row.user_id) });
      });
      if (conflicts.length) {
         const error = new Error(`Refusing to apply: ${conflicts.length} approved key(s) are already owned by someone else (first: ${JSON.stringify(conflicts[0])}). Resolve them by hand.`);
         error.conflicts = conflicts;
         throw error;
      }
      let inserted = 0;
      for (const row of toInsert) {
         // eslint-disable-next-line no-await-in-loop
         const result = await trx('tracker_file_owners')
            .insert({ s3_key: row.s3_key, account_id: Number(row.account_id), user_id: Number(row.user_id), source: row.source })
            .onConflict('s3_key')
            .ignore()
            .returning('s3_key');
         inserted += result.length;
      }
      return { approved: approved.length, inserted, alreadyApplied: approved.length - toInsert.length };
   });

module.exports.MANIFEST_COLUMNS = MANIFEST_COLUMNS;
module.exports.toCsv = toCsv;
module.exports.parseCsv = parseCsv;
module.exports.readManifest = readManifest;
module.exports.validateManifestRows = validateManifestRows;
module.exports.findDrift = findDrift;
module.exports.applyManifest = applyManifest;

// ── CLI ─────────────────────────────────────────────────────────────────
const parseArgs = argv => {
   const flags = new Set();
   let manifestPath = null;
   for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === '--manifest') {
         manifestPath = argv[i + 1];
         i += 1;
         if (!manifestPath) throw new Error('--manifest needs a path to the reviewed rows CSV.');
      } else if (['--apply', '--i-know-this-is-prod', '--accept-drift'].includes(arg)) {
         flags.add(arg);
      } else {
         throw new Error(`Unknown argument: ${arg}`);
      }
   }
   const apply = flags.has('--apply');
   if (apply && !manifestPath) throw new Error('--apply requires --manifest <reviewed rows CSV from a dry run>; the apply never re-plans ownership on its own.');
   if (!apply && (manifestPath || flags.has('--accept-drift'))) throw new Error('--manifest and --accept-drift are only valid with --apply.');
   return { apply, manifestPath, acceptDrift: flags.has('--accept-drift'), prodConfirmed: flags.has('--i-know-this-is-prod') };
};

async function main() {
   const { apply, manifestPath, acceptDrift, prodConfirmed } = parseArgs(process.argv.slice(2));

   if (!process.env.DS2_ENV_FILE || !process.env.DATABASE_NAME) {
      throw new Error('Set DS2_ENV_FILE and DATABASE_NAME explicitly (run from DS2_Backend), e.g. DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/timeTracking/backfill-tracker-owners.js');
   }

   // src/utils/s3.js and config.js read S3 settings from process.env at
   // require time, so the env file is loaded first; the legacy account
   // override is resolved only AFTER that (Astra round 14: reading it at
   // module load ignored a value set only in the env file).
   require('dotenv').config({ path: process.env.DS2_ENV_FILE, override: false });
   const legacyAccountId = Number(process.env.LEGACY_FLAT_TRACKER_ACCOUNT_ID) || 1;

   const { listObjects } = require('../../src/utils/s3');
   const { makeDb } = require('../_db');
   const config = require('../../config');
   const db = makeDb({ poolMax: 4 });

   try {
      const dbName = db.client.config.connection.database;
      const host = db.client.config.connection.host;
      if (apply && looksLikeProd(dbName, host) && !prodConfirmed) {
         throw new Error(`Refusing --apply: database "${dbName}" / host "${host}" looks like production. Pass --i-know-this-is-prod if this is deliberate.`);
      }

      const { database, role } = (await db.raw('SELECT current_database() AS database, current_user AS role')).rows[0];
      const identity = { database, bucket: String(config.S3_BUCKET_NAME || '') };
      console.log(JSON.stringify({ ...identity, role, processedRoot: PROCESSED_ROOT, legacyAccountId, mode: apply ? 'APPLY REVIEWED MANIFEST' : 'DRY RUN' }));

      // Always plan read-only: a dry run reports it; an apply only uses it to detect drift.
      const objects = await listObjects(`${PROCESSED_ROOT}/`);
      const keys = (objects || []).map(o => o.Key).filter(k => k && !k.endsWith('/'));
      const recordedUploads = await db('timesheet_entries').distinct('account_id', 'user_id', 'timesheet_name').whereNotNull('timesheet_name');
      const userRows = await db('users').select('account_id', 'user_id', 'display_name');
      const usersByAccount = {};
      const displayNameById = new Map();
      userRows.forEach(user => {
         (usersByAccount[user.account_id] = usersByAccount[user.account_id] || []).push(user);
         displayNameById.set(Number(user.user_id), user.display_name);
      });
      const plan = planTrackerOwnership({ keys, processedRoot: PROCESSED_ROOT, legacyAccountId, recordedUploads, usersByAccount });

      if (!apply) {
         const bySource = plan.rows.reduce((acc, row) => ({ ...acc, [row.source]: (acc[row.source] || 0) + 1 }), {});
         const byReason = plan.unattributed.reduce((acc, row) => ({ ...acc, [row.reason]: (acc[row.reason] || 0) + 1 }), {});
         console.log(`SUMMARY ${JSON.stringify({ totalKeysUnderProcessedRoot: keys.length, attributable: plan.rows.length, bySource, unattributedCount: plan.unattributed.length, byReason }, null, 2)}`);
         const outDir = path.join(__dirname, 'out');
         fs.mkdirSync(outDir, { recursive: true });
         const stamp = new Date().toISOString().replace(/[:.]/g, '-');
         const prefix = path.join(outDir, `backfill-tracker-owners.${String(database).replace(/[^a-zA-Z0-9_-]/g, '_')}.dry-run.${stamp}`);
         const manifestRows = plan.rows.map(row => ({ database, bucket: identity.bucket, legacy_account_id: legacyAccountId, ...row, owner_display_name: displayNameById.get(Number(row.user_id)) || '' }));
         fs.writeFileSync(`${prefix}.rows.csv`, toCsv(manifestRows, MANIFEST_COLUMNS));
         fs.writeFileSync(`${prefix}.unattributed.csv`, toCsv(plan.unattributed, ['s3_key', 'reason']));
         console.log(`Wrote ${prefix}.rows.csv (${manifestRows.length} row(s)) — review it; delete any line you do not approve.`);
         console.log(`Wrote ${prefix}.unattributed.csv (${plan.unattributed.length} row(s))`);
         console.log(`Nothing was written to the database. Apply the reviewed file with: --apply --manifest ${prefix}.rows.csv`);
         return;
      }

      const approved = readManifest(fs.readFileSync(manifestPath, 'utf8'));
      const errors = validateManifestRows({ rows: approved, identity, processedRoot: PROCESSED_ROOT, legacyAccountId });
      if (errors.length) throw new Error(`Refusing to apply: the manifest does not match this target or has invalid rows:\n  ${errors.slice(0, 20).join('\n  ')}${errors.length > 20 ? `\n  ... ${errors.length - 20} more` : ''}`);

      const drift = findDrift({ approved, freshKeys: keys, freshPlan: plan });
      if (drift.length) {
         console.log(`DRIFT since the review (${drift.length} approved row(s)):\n  ${drift.slice(0, 20).map(d => JSON.stringify(d)).join('\n  ')}`);
         if (!acceptDrift) throw new Error('Refusing to apply because approved rows drifted since the review. Re-run the dry run and review again, or pass --accept-drift to apply the APPROVED owners anyway.');
         console.log('--accept-drift given: applying the approved owners as reviewed (never the fresh plan).');
      }

      const result = await applyManifest(db, approved);
      console.log(`Applied reviewed manifest ${manifestPath}: ${JSON.stringify(result)}`);
   } finally {
      await db.destroy();
   }
}

if (require.main === module) {
   main()
      .then(() => process.exit(0))
      .catch(err => {
         console.error(`\nbackfill-tracker-owners FAILED: ${err.message}`);
         process.exit(1);
      });
}
