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
      DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/timeTracking/backfill-tracker-owners.js            # dry run (default)
      DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/timeTracking/backfill-tracker-owners.js --apply    # write the rows
      DS2_ENV_FILE=.env.prod  DATABASE_NAME=ds2_prod  node scripts/timeTracking/backfill-tracker-owners.js --apply --i-know-this-is-prod

   Like scripts/review-2026-09/*.js, DS2_ENV_FILE and DATABASE_NAME must both
   be set explicitly — there is no default target. A dry run only reads (S3
   listObjects, timesheet_entries, users) and writes its report to
   scripts/timeTracking/out/ (gitignored); nothing is written to the database
   unless --apply is also passed, and --apply against anything that LOOKS
   like production (database name or host matching /prod/i — see
   scripts/migrate.js's looksLikeProd, reused here rather than
   reimplemented) additionally requires --i-know-this-is-prod. --apply never
   updates an existing tracker_file_owners row (ON CONFLICT (s3_key) DO
   NOTHING, via trackerOwners.recordOwner) — a wrong or superseded backfill
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
const trackerOwners = require('../../src/endpoints/timeTracking/trackerOwners');
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

// ── CLI ─────────────────────────────────────────────────────────────────
async function main() {
   const args = new Set(process.argv.slice(2));
   for (const arg of args) {
      if (!['--apply', '--i-know-this-is-prod'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
   }
   const apply = args.has('--apply');

   if (!process.env.DS2_ENV_FILE || !process.env.DATABASE_NAME) {
      throw new Error('Set DS2_ENV_FILE and DATABASE_NAME explicitly (run from DS2_Backend), e.g. DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/timeTracking/backfill-tracker-owners.js');
   }

   // makeDb() deliberately never calls dotenv.config() for its OWN callers
   // (see scripts/_db.js's header comment) — it reads connection settings
   // straight off the env file itself. But src/utils/s3.js (required just
   // below, only now that the env file is known-present) reads config.js,
   // which reads S3_BUCKET_NAME/S3_REGION/S3_ENDPOINT/... straight off
   // process.env at require time — so this loads the env file into
   // process.env itself first, the same way test/setup.js does for the
   // test suite.
   require('dotenv').config({ path: process.env.DS2_ENV_FILE, override: false });

   const { listObjects } = require('../../src/utils/s3');
   const { makeDb } = require('../_db');
   const config = require('../../config');
   const db = makeDb({ poolMax: 4 });

   try {
      const dbName = db.client.config.connection.database;
      const host = db.client.config.connection.host;
      if (apply && looksLikeProd(dbName, host) && !args.has('--i-know-this-is-prod')) {
         throw new Error(`Refusing --apply: database "${dbName}" / host "${host}" looks like production. Pass --i-know-this-is-prod if this is deliberate.`);
      }

      const identity = (await db.raw('SELECT current_database() AS database, current_user AS role')).rows[0];
      console.log(
         JSON.stringify({
            database: identity.database,
            role: identity.role,
            bucket: config.S3_BUCKET_NAME,
            processedRoot: PROCESSED_ROOT,
            mode: apply ? 'APPLY' : 'DRY RUN'
         })
      );

      const objects = await listObjects(`${PROCESSED_ROOT}/`);
      const keys = (objects || []).map(o => o.Key).filter(k => k && !k.endsWith('/'));

      const recordedUploads = await db('timesheet_entries').distinct('account_id', 'user_id', 'timesheet_name').whereNotNull('timesheet_name');
      const userRows = await db('users').select('account_id', 'user_id', 'display_name');
      const usersByAccount = {};
      userRows.forEach(user => {
         const list = usersByAccount[user.account_id] || (usersByAccount[user.account_id] = []);
         list.push(user);
      });

      const { rows, unattributed } = planTrackerOwnership({
         keys,
         processedRoot: PROCESSED_ROOT,
         legacyAccountId: LEGACY_FLAT_TRACKER_ACCOUNT_ID,
         recordedUploads,
         usersByAccount
      });

      const bySource = rows.reduce((acc, row) => ({ ...acc, [row.source]: (acc[row.source] || 0) + 1 }), {});
      const byReason = unattributed.reduce((acc, row) => ({ ...acc, [row.reason]: (acc[row.reason] || 0) + 1 }), {});
      const summary = {
         totalKeysUnderProcessedRoot: keys.length,
         attributable: rows.length,
         bySource,
         unattributedCount: unattributed.length,
         byReason
      };
      console.log(`SUMMARY ${JSON.stringify(summary, null, 2)}`);

      const outDir = path.join(__dirname, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const prefix = path.join(outDir, `backfill-tracker-owners.${String(identity.database).replace(/[^a-zA-Z0-9_-]/g, '_')}.${apply ? 'apply' : 'dry-run'}.${stamp}`);
      const rowsCsvPath = `${prefix}.rows.csv`;
      const unattributedCsvPath = `${prefix}.unattributed.csv`;
      fs.writeFileSync(rowsCsvPath, toCsv(rows, ['s3_key', 'account_id', 'user_id', 'source']));
      fs.writeFileSync(unattributedCsvPath, toCsv(unattributed, ['s3_key', 'reason']));
      console.log(`Wrote ${rowsCsvPath} (${rows.length} row(s))`);
      console.log(`Wrote ${unattributedCsvPath} (${unattributed.length} row(s))`);

      if (apply) {
         await db.transaction(async trx => {
            for (const row of rows) {
               // eslint-disable-next-line no-await-in-loop
               await trackerOwners.recordOwner(trx, { s3Key: row.s3_key, accountId: row.account_id, userId: row.user_id, source: row.source });
            }
         });
         console.log(`Applied ${rows.length} row(s) to tracker_file_owners inside one transaction (ON CONFLICT (s3_key) DO NOTHING — an existing row was never updated).`);
      } else {
         console.log('Dry run only (default) — review the two CSVs above, then re-run with --apply to write the attributable rows.');
      }
   } finally {
      await db.destroy();
   }
}

if (require.main === module) {
   main()
      .then(() => process.exit(0))
      .catch(err => {
         console.error(`\nbackfill-tracker-owners FAILED: ${err.message}`);
         console.error(err.stack);
         process.exit(1);
      });
}
