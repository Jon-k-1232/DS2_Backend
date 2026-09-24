/**
 * scripts/timeTracking/backfill-tracker-owners.js — planTrackerOwnership
 * (pure, no DB / no S3 / no filesystem — see that file's own header comment
 * for the full rule set). review/full-audit-2026-09, Astra round 13, P2.
 *
 * These are synthetic inputs, not a live database — the CLI's own dry-run
 * summary against ds2_local is reported separately (see the task notes),
 * not exercised here.
 */
const { planTrackerOwnership, parseTrackerKey } = require('../../scripts/timeTracking/backfill-tracker-owners');

const PROCESSED_ROOT = 'James_F__Kimmel___Associates/time_tracking/processed';
const LEGACY_ACCOUNT_ID = 1;
const OTHER_ACCOUNT_ID = 9001;

// buildUserFolder('Jane Smith') -> 'Smith_Jane'; buildUserFolder('Eliza Smith') -> 'Smith_Eliza'
// (lastName_firstName, sanitized) — see trackerFolderNames.js. Spelled out by hand here rather
// than imported, so a bug in buildUserFolder itself can't mask a planner bug.
const rowFor = (rows, s3Key) => rows.find(r => r.s3_key === s3Key);
const reasonFor = (unattributed, s3Key) => unattributed.find(u => u.s3_key === s3Key)?.reason;

describe('scripts/timeTracking/backfill-tracker-owners.js', () => {
   describe('parseTrackerKey', () => {
      it('parses a flat (2-segment) key', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}/Smith_Jane/file.xlsx.gz`)).to.deep.equal({ type: 'flat', folder: 'Smith_Jane', file: 'file.xlsx.gz' });
      });

      it('parses an id-keyed (3-segment, user_<id> leaf) key', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/user_90011/file.xlsx.gz`)).to.deep.equal({
            type: 'id-keyed',
            accountId: 9001,
            userId: 90011,
            file: 'file.xlsx.gz'
         });
      });

      it('parses a name-keyed (3-segment, non-user_ leaf) key', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/Smith_Jane/file.xlsx.gz`)).to.deep.equal({
            type: 'name-keyed',
            accountId: 9001,
            folder: 'Smith_Jane',
            file: 'file.xlsx.gz'
         });
      });

      it('malformed: outside PROCESSED_ROOT entirely', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, 'some/other/root/file.gz').type).to.equal('malformed');
      });

      it('malformed: wrong segment count (1 and 4)', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}/onlyfile.gz`).type).to.equal('malformed');
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}/a/b/c/file.gz`).type).to.equal('malformed');
      });

      it('malformed: an empty segment (double slash)', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}//file.gz`).type).to.equal('malformed');
      });

      it('malformed: account folder id with a leading zero never round-trips', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}/Some_Folder_09001/Smith_Jane/file.gz`).type).to.equal('malformed');
      });

      it('malformed: user_<id> leaf with a leading zero never round-trips', () => {
         expect(parseTrackerKey(PROCESSED_ROOT, `${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/user_090011/file.gz`).type).to.equal('malformed');
      });
   });

   describe('planTrackerOwnership', () => {
      it('id-keyed keys: always attributed by path structure alone, source "path" — recordedUploads/usersByAccount are irrelevant', () => {
         const keys = [`${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/user_90011/File_${1}.xlsx.gz`, `${PROCESSED_ROOT}/James_F__Kimmel___Associates_1/user_21/File_2.xlsx`];
         const { rows, unattributed } = planTrackerOwnership({ keys, processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount: {} });

         expect(unattributed).to.deep.equal([]);
         expect(rows).to.have.length(2);
         expect(rowFor(rows, keys[0])).to.deep.equal({ s3_key: keys[0], account_id: 9001, user_id: 90011, source: 'path' });
         expect(rowFor(rows, keys[1])).to.deep.equal({ s3_key: keys[1], account_id: 1, user_id: 21, source: 'path' });
      });

      it('malformed keys are never attributed, and never throw', () => {
         const keys = ['outside/root.gz', `${PROCESSED_ROOT}/onlyfile.gz`, `${PROCESSED_ROOT}//blank.gz`, `${PROCESSED_ROOT}/a/b/c/d.gz`];
         const { rows, unattributed } = planTrackerOwnership({ keys, processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount: {} });

         expect(rows).to.deep.equal([]);
         expect(unattributed).to.have.length(4);
         keys.forEach(key => expect(reasonFor(unattributed, key)).to.equal('malformed'));
      });

      it('a recorded .gz key (production shape: 410 of the 550 real objects) recorded by exactly one user -> "recorded-upload"', () => {
         const key = `${PROCESSED_ROOT}/Smith_Jane/Weekly_Tracker_09-01.xlsx.gz`;
         const recordedUploads = [{ account_id: LEGACY_ACCOUNT_ID, user_id: 22, timesheet_name: 'Weekly_Tracker_09-01.xlsx' }];

         const { rows, unattributed } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads, usersByAccount: {} });

         expect(unattributed).to.deep.equal([]);
         expect(rowFor(rows, key)).to.deep.equal({ s3_key: key, account_id: LEGACY_ACCOUNT_ID, user_id: 22, source: 'recorded-upload' });
      });

      it('an unrecorded plain .xlsx key (production shape: 139 of the 140 unrecorded real objects) with a UNIQUE matching folder -> "folder-at-backfill"', () => {
         const key = `${PROCESSED_ROOT}/Smith_Jane/Old_Tracker.xlsx`; // no .gz — a genuinely plain workbook
         const usersByAccount = { [LEGACY_ACCOUNT_ID]: [{ user_id: 22, display_name: 'Jane Smith' }, { user_id: 23, display_name: 'Bob Jones' }] };

         const { rows, unattributed } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount });

         expect(unattributed).to.deep.equal([]);
         expect(rowFor(rows, key)).to.deep.equal({ s3_key: key, account_id: LEGACY_ACCOUNT_ID, user_id: 22, source: 'folder-at-backfill' });
      });

      it('folder-at-backfill matching includes INACTIVE users too (no is_user_active field is even read)', () => {
         const key = `${PROCESSED_ROOT}/Jones_Bob/Old_Tracker.xlsx`;
         // No is_user_active on this row at all — the planner must not require or read one.
         const usersByAccount = { [LEGACY_ACCOUNT_ID]: [{ user_id: 24, display_name: 'Bob Jones' }] };

         const { rows } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount });

         expect(rowFor(rows, key)).to.include({ user_id: 24, source: 'folder-at-backfill' });
      });

      it('an ambiguous folder — TWO users of the same account share the display name/folder — unattributed "ambiguous-folder"', () => {
         const key = `${PROCESSED_ROOT}/Smith_Jane/Ambiguous_Tracker.xlsx`;
         const usersByAccount = {
            [LEGACY_ACCOUNT_ID]: [
               { user_id: 22, display_name: 'Jane Smith' },
               { user_id: 25, display_name: 'Jane Smith' }
            ]
         };

         const { rows, unattributed } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount });

         expect(rows).to.deep.equal([]);
         expect(reasonFor(unattributed, key)).to.equal('ambiguous-folder');
      });

      it('a key whose folder matches NOBODY (e.g. a renamed employee, DeVries -> Devries) — unattributed "no-matching-user"', () => {
         const key = `${PROCESSED_ROOT}/DeVries_Pat/Old_Tracker.xlsx`;
         const usersByAccount = { [LEGACY_ACCOUNT_ID]: [{ user_id: 26, display_name: 'Pat Devries' }] }; // folder is now 'Devries_Pat', not 'DeVries_Pat'

         const { rows, unattributed } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount });

         expect(rows).to.deep.equal([]);
         expect(reasonFor(unattributed, key)).to.equal('no-matching-user');
      });

      it('a flat key is NEVER attributed to another account, even when the only matching-folder user belongs to one — unattributed "no-matching-user"', () => {
         const key = `${PROCESSED_ROOT}/Smith_Jane/Old_Tracker.xlsx`; // flat -> always legacyAccountId
         // The only 'Jane Smith' the planner knows about belongs to account 9001, not the legacy tenant (1).
         const usersByAccount = { [OTHER_ACCOUNT_ID]: [{ user_id: 90011, display_name: 'Jane Smith' }] };

         const { rows, unattributed } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount });

         expect(rows).to.deep.equal([]);
         expect(reasonFor(unattributed, key)).to.equal('no-matching-user');
      });

      it('a name recorded by TWO different users of the same account — unattributed "ambiguous-recorded" (never guesses)', () => {
         const key = `${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/Smith_Jane/Contested.xlsx.gz`;
         const recordedUploads = [
            { account_id: OTHER_ACCOUNT_ID, user_id: 90011, timesheet_name: 'Contested.xlsx' },
            { account_id: OTHER_ACCOUNT_ID, user_id: 90012, timesheet_name: 'Contested.xlsx' }
         ];

         const { rows, unattributed } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads, usersByAccount: {} });

         expect(rows).to.deep.equal([]);
         expect(reasonFor(unattributed, key)).to.equal('ambiguous-recorded');
      });

      it('the SAME basename recorded once in each of TWO accounts is not ambiguous — each key is scoped to its own account', () => {
         const legacyKey = `${PROCESSED_ROOT}/Smith_Jane/Shared_Name.xlsx.gz`;
         const otherKey = `${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/Smith_Jane/Shared_Name.xlsx.gz`;
         const recordedUploads = [
            { account_id: LEGACY_ACCOUNT_ID, user_id: 22, timesheet_name: 'Shared_Name.xlsx' },
            { account_id: OTHER_ACCOUNT_ID, user_id: 90011, timesheet_name: 'Shared_Name.xlsx' }
         ];

         const { rows, unattributed } = planTrackerOwnership({ keys: [legacyKey, otherKey], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads, usersByAccount: {} });

         expect(unattributed).to.deep.equal([]);
         expect(rowFor(rows, legacyKey)).to.deep.equal({ s3_key: legacyKey, account_id: LEGACY_ACCOUNT_ID, user_id: 22, source: 'recorded-upload' });
         expect(rowFor(rows, otherKey)).to.deep.equal({ s3_key: otherKey, account_id: OTHER_ACCOUNT_ID, user_id: 90011, source: 'recorded-upload' });
      });

      it('a recorded basename takes priority over an ALSO-matching folder name (recorded-upload beats folder-at-backfill)', () => {
         const key = `${PROCESSED_ROOT}/Smith_Jane/Both_Signals.xlsx.gz`;
         const recordedUploads = [{ account_id: LEGACY_ACCOUNT_ID, user_id: 22, timesheet_name: 'Both_Signals.xlsx' }];
         // A DIFFERENT user's folder also happens to match — must NOT be used; the recorded signal wins outright.
         const usersByAccount = { [LEGACY_ACCOUNT_ID]: [{ user_id: 99, display_name: 'Jane Smith' }] };

         const { rows } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads, usersByAccount });

         expect(rowFor(rows, key)).to.deep.equal({ s3_key: key, account_id: LEGACY_ACCOUNT_ID, user_id: 22, source: 'recorded-upload' });
      });

      it('the .gz suffix on the KEY is stripped before matching a recorded name that itself never carries .gz', () => {
         const key = `${PROCESSED_ROOT}/Smith_Jane/Weekly.xlsx.GZ`; // uppercase .GZ, still stripped case-insensitively
         const recordedUploads = [{ account_id: LEGACY_ACCOUNT_ID, user_id: 22, timesheet_name: 'Weekly.xlsx' }];

         const { rows } = planTrackerOwnership({ keys: [key], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads, usersByAccount: {} });

         expect(rowFor(rows, key)).to.include({ user_id: 22, source: 'recorded-upload' });
      });

      it('a full mixed batch — every shape at once — sorts into the right bucket independently (no cross-key interference)', () => {
         const keys = [
            `${PROCESSED_ROOT}/TEST_FIXTURE_ACCOUNT_9001/user_90011/Upload.xlsx.gz`, // id-keyed -> path
            `${PROCESSED_ROOT}/Smith_Jane/Recorded.xlsx.gz`, // flat, recorded once -> recorded-upload
            `${PROCESSED_ROOT}/Jones_Bob/Unrecorded_Unique.xlsx`, // flat, unrecorded, unique folder -> folder-at-backfill
            `${PROCESSED_ROOT}/Doe_Jamie/Ambiguous.xlsx`, // flat, unrecorded, ambiguous folder -> ambiguous-folder
            `${PROCESSED_ROOT}/Nobody_Here/Orphan.xlsx`, // flat, unrecorded, no match -> no-matching-user
            `${PROCESSED_ROOT}/Smith_Jane/Contested.xlsx.gz`, // flat, recorded twice -> ambiguous-recorded
            'not/under/root.gz' // malformed
         ];
         const recordedUploads = [
            { account_id: LEGACY_ACCOUNT_ID, user_id: 22, timesheet_name: 'Recorded.xlsx' },
            { account_id: LEGACY_ACCOUNT_ID, user_id: 22, timesheet_name: 'Contested.xlsx' },
            { account_id: LEGACY_ACCOUNT_ID, user_id: 23, timesheet_name: 'Contested.xlsx' }
         ];
         const usersByAccount = {
            [LEGACY_ACCOUNT_ID]: [
               { user_id: 30, display_name: 'Bob Jones' },
               { user_id: 31, display_name: 'Jamie Doe' },
               { user_id: 32, display_name: 'Jamie Doe' }
            ]
         };

         const { rows, unattributed } = planTrackerOwnership({ keys, processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads, usersByAccount });

         expect(rowFor(rows, keys[0])).to.include({ account_id: 9001, user_id: 90011, source: 'path' });
         expect(rowFor(rows, keys[1])).to.include({ user_id: 22, source: 'recorded-upload' });
         expect(rowFor(rows, keys[2])).to.include({ user_id: 30, source: 'folder-at-backfill' });
         expect(reasonFor(unattributed, keys[3])).to.equal('ambiguous-folder');
         expect(reasonFor(unattributed, keys[4])).to.equal('no-matching-user');
         expect(reasonFor(unattributed, keys[5])).to.equal('ambiguous-recorded');
         expect(reasonFor(unattributed, keys[6])).to.equal('malformed');
         expect(rows).to.have.length(3);
         expect(unattributed).to.have.length(4);
      });

      it('empty keys list -> empty result, no throw', () => {
         expect(planTrackerOwnership({ keys: [], processedRoot: PROCESSED_ROOT, legacyAccountId: LEGACY_ACCOUNT_ID, recordedUploads: [], usersByAccount: {} })).to.deep.equal({ rows: [], unattributed: [] });
      });
   });
});

// Astra round 14: --apply must write EXACTLY the reviewed dry-run manifest,
// bound to the target it was reviewed against, and refuse drift; it must never
// re-plan ownership on its own (a rename between review and apply could
// otherwise hand a file to a different person).
describe('scripts/timeTracking/backfill-tracker-owners.js — reviewed manifest (Astra round 14)', function () {
   this.timeout(30000);
   const fs = require('fs');
   const path = require('path');
   const pgHarness = require('./helpers/pgHarness');
   const { MANIFEST_COLUMNS, toCsv, readManifest, validateManifestRows, findDrift, applyManifest } = require('../../scripts/timeTracking/backfill-tracker-owners');
   const ROOT = 'James_F__Kimmel___Associates/time_tracking/processed';
   const identity = { database: 'ds2_prod', bucket: 'ds2-561979538576' };
   const flatKey = `${ROOT}/Smith_Jane/Smith_Jane_2025.xlsx`;
   const idKey = `${ROOT}/TEST_FIXTURE_ACCOUNT_9001/user_90011/tracker.xlsx.gz`;
   const approvedRow = (overrides = {}) =>
      Object.assign({ database: identity.database, bucket: identity.bucket, legacy_account_id: '1', s3_key: flatKey, account_id: '1', user_id: '101', source: 'folder-at-backfill', owner_display_name: 'Jane Smith' }, overrides);

   describe('readManifest', () => {
      it('round-trips the dry run CSV, including quoted names with commas and a guarded leading minus', () => {
         const rows = [approvedRow({ owner_display_name: 'Smith, Jane "JJ"' }), approvedRow({ s3_key: idKey, account_id: '9001', user_id: '90011', source: 'path', owner_display_name: '-dash name' })];
         const parsed = readManifest(toCsv(rows, MANIFEST_COLUMNS));
         expect(parsed).to.have.length(2);
         expect(parsed[0].owner_display_name).to.equal('Smith, Jane "JJ"');
         expect(parsed[1].owner_display_name).to.equal('-dash name');
         expect(parsed[1].s3_key).to.equal(idKey);
      });

      it('refuses a file whose header is not the manifest header (e.g. the unattributed CSV)', () => {
         expect(() => readManifest('"s3_key","reason"\n"x","malformed"\n')).to.throw(/header/);
      });

      it('ignores blank lines, so deleting rows in a spreadsheet is fine', () => {
         const text = toCsv([approvedRow()], MANIFEST_COLUMNS) + '\n\n';
         expect(readManifest(text)).to.have.length(1);
      });
   });

   describe('validateManifestRows', () => {
      const validate = (rows, legacyAccountId = 1, target = identity) => validateManifestRows({ rows, identity: target, processedRoot: ROOT, legacyAccountId });

      it('accepts rows reviewed against this exact target', () => {
         expect(validate([approvedRow(), approvedRow({ s3_key: idKey, account_id: '9001', user_id: '90011', source: 'path' })])).to.deep.equal([]);
      });

      it('refuses rows reviewed against another database, bucket or legacy account', () => {
         expect(validate([approvedRow()], 1, { database: 'ds2_local', bucket: identity.bucket }).join()).to.match(/database/);
         expect(validate([approvedRow()], 1, { database: identity.database, bucket: 'ds2-local' }).join()).to.match(/bucket/);
         expect(validate([approvedRow()], 7).join()).to.match(/legacy account/);
      });

      it('refuses duplicates, unknown sources, non-canonical ids and malformed keys', () => {
         expect(validate([approvedRow(), approvedRow()]).join()).to.match(/duplicate/);
         expect(validate([approvedRow({ source: 'upload' })]).join()).to.match(/source/);
         expect(validate([approvedRow({ user_id: '0101' })]).join()).to.match(/canonical/);
         expect(validate([approvedRow({ s3_key: `${ROOT}/only-one-segment.xlsx` })]).join()).to.match(/malformed/);
      });

      it('refuses a flat key for any account but the legacy one, and an id-keyed row that disagrees with its own path', () => {
         expect(validate([approvedRow({ account_id: '9001' })]).join()).to.match(/legacy account/);
         expect(validate([approvedRow({ s3_key: idKey, account_id: '9001', user_id: '90012', source: 'path' })]).join()).to.match(/path names/);
      });
   });

   describe('findDrift', () => {
      it("reports Astra's case: the reviewed owner was A, a rename since then makes the fresh plan say B", () => {
         const drift = findDrift({ approved: [approvedRow({ user_id: '101' })], freshKeys: [flatKey], freshPlan: { rows: [{ s3_key: flatKey, account_id: 1, user_id: 102, source: 'folder-at-backfill' }] } });
         expect(drift).to.deep.equal([{ s3_key: flatKey, reason: 'owner-changed', approved_user_id: 101, fresh_user_id: 102 }]);
      });

      it('reports approved objects that are gone or that the fresh plan no longer attributes', () => {
         expect(findDrift({ approved: [approvedRow()], freshKeys: [], freshPlan: { rows: [] } })).to.deep.equal([{ s3_key: flatKey, reason: 'object-missing' }]);
         expect(findDrift({ approved: [approvedRow()], freshKeys: [flatKey], freshPlan: { rows: [] } })[0].reason).to.equal('now-unattributed');
      });

      it('reports nothing when the fresh plan agrees with the review', () => {
         expect(findDrift({ approved: [approvedRow()], freshKeys: [flatKey], freshPlan: { rows: [{ s3_key: flatKey, account_id: 1, user_id: 101, source: 'recorded-upload' }] } })).to.deep.equal([]);
      });
   });

   describe('applyManifest (throwaway database)', () => {
      const DB = `ds2_mig_test_backfill_apply_${process.pid}`;
      let db;
      const migration021 = () => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '021.tracker_file_owners.sql'), 'utf8');

      before(function () {
         if (!pgHarness.isAvailable()) return this.skip();
      });
      beforeEach(async () => {
         pgHarness.createThrowawayDb(DB);
         db = pgHarness.knexFor(DB);
         await db('accounts').insert([
            { account_id: 1, account_name: 'James F. Kimmel & Associates', account_type: 'business', is_account_active: true },
            { account_id: 9001, account_name: 'TEST FIXTURE ACCOUNT', account_type: 'business', is_account_active: true }
         ]);
         await db.transaction(trx => trx.raw(migration021()));
      });
      afterEach(async () => {
         if (db) await db.destroy();
         pgHarness.dropDb(DB);
      });

      it('writes exactly the approved owners, and a second run changes nothing', async () => {
         const approved = [approvedRow(), approvedRow({ s3_key: idKey, account_id: '9001', user_id: '90011', source: 'path' })];
         expect(await applyManifest(db, approved)).to.deep.equal({ approved: 2, inserted: 2, alreadyApplied: 0 });
         expect(await applyManifest(db, approved)).to.deep.equal({ approved: 2, inserted: 0, alreadyApplied: 2 });
         const rows = await db('tracker_file_owners').select('s3_key', 'account_id', 'user_id', 'source').orderBy('s3_key');
         expect(rows.map(r => [r.s3_key, r.account_id, r.user_id, r.source])).to.deep.equal([
            [flatKey, 1, 101, 'folder-at-backfill'],
            [idKey, 9001, 90011, 'path']
         ]);
      });

      it('refuses the whole run, writing nothing, when an approved key is already owned by someone else', async () => {
         await db('tracker_file_owners').insert({ s3_key: flatKey, account_id: 1, user_id: 999, source: 'upload' });
         const approved = [approvedRow({ s3_key: idKey, account_id: '9001', user_id: '90011', source: 'path' }), approvedRow()];
         let error;
         try {
            await applyManifest(db, approved);
         } catch (e) {
            error = e;
         }
         expect(error, 'expected a refusal').to.exist;
         expect(error.message).to.match(/already owned by someone else/);
         expect(await db('tracker_file_owners').where({ s3_key: idKey }).first(), 'nothing from the refused run may be written').to.equal(undefined);
         expect((await db('tracker_file_owners').where({ s3_key: flatKey }).first()).user_id, 'the existing owner is untouched').to.equal(999);
      });

      it("with drift accepted, the APPROVED owner is written, never the fresh plan's", async () => {
         const approved = [approvedRow({ user_id: '101' })];
         const drift = findDrift({ approved, freshKeys: [flatKey], freshPlan: { rows: [{ s3_key: flatKey, account_id: 1, user_id: 102, source: 'folder-at-backfill' }] } });
         expect(drift).to.have.length(1);
         await applyManifest(db, approved);
         expect((await db('tracker_file_owners').where({ s3_key: flatKey }).first()).user_id).to.equal(101);
      });
   });
});
