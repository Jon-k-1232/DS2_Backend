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
