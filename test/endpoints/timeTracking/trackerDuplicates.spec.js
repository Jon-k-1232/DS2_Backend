const { computeEntryFingerprint, planTrackerDedupe, findTrackerDuplicates } = require('../../../src/endpoints/timeTracking/trackerDuplicates');

const base = {
   account_id: 1,
   user_id: 11,
   employee_name: 'Kati Strough',
   date: '2026-04-15',
   entity: 'James F. Kimmel & Associates',
   category: 'Administrative',
   company_name: 'James F. Kimmel & Associates',
   first_name: null,
   last_name: null,
   duration: 5,
   notes: 'processed payment'
};
const e = overrides => ({ ...base, ...overrides });
// Existing DB row as node-pg returns it (DATE -> local-midnight Date).
const existing = (overrides, timesheetName = 'Strough_Kati_April-15-2026_04-59-44PM.xlsx', id) => {
   const row = e(overrides);
   const [y, m, d] = row.date.split('-').map(Number);
   return { ...row, date: new Date(y, m - 1, d), timesheet_name: timesheetName, created_at: new Date('2026-04-15T23:59:44Z'), timesheet_entry_id: id };
};

describe('trackerDuplicates fingerprint', () => {
   it('is stable across case, whitespace and DB-vs-upload date representations', () => {
      const fromUpload = e({ notes: '  Processed   PAYMENT ', entity: 'james f. kimmel & associates' });
      const fromDb = existing({});
      expect(computeEntryFingerprint(fromUpload)).to.equal(computeEntryFingerprint(fromDb));
   });

   it('ignores Category (same work re-uploaded with a corrected category is still a duplicate)', () => {
      expect(computeEntryFingerprint(e({ category: 'Billing' }))).to.equal(computeEntryFingerprint(e({})));
   });

   it('changes with duration, notes, date, customer names, entity, employee or user', () => {
      const fp = computeEntryFingerprint(e({}));
      for (const change of [{ duration: 6 }, { notes: 'processed payments' }, { date: '2026-04-16' }, { company_name: 'Acme' }, { first_name: 'Ann' }, { last_name: 'Lee' }, { entity: 'KFA' }, { employee_name: 'Joe Cook' }, { user_id: 16 }, { account_id: 2 }]) {
         expect(computeEntryFingerprint(e(change)), JSON.stringify(change)).to.not.equal(fp);
      }
   });
});

describe('trackerDuplicates planTrackerDedupe', () => {
   it('(a) flags an identical earlier upload of the same period (multiset equal, incl. repeated rows)', () => {
      const entries = [e({}), e({}), e({ notes: 'filed f8879s', duration: 10 })];
      const samePeriodRows = [existing({}, 'A.xlsx', 1), existing({}, 'A.xlsx', 2), existing({ notes: 'filed f8879s', duration: 10 }, 'A.xlsx', 3)];
      const plan = planTrackerDedupe({ entries, sourceRows: [6, 7, 8], samePeriodRows, sameDateRows: samePeriodRows });
      expect(plan.identicalUpload).to.include({ timesheet_name: 'A.xlsx', row_count: 3 });
      expect(plan.toInsertIndexes).to.deep.equal([]);
   });

   it('(a) does not treat a subset / superset upload as identical', () => {
      const samePeriodRows = [existing({}, 'A.xlsx', 1)];
      const plan = planTrackerDedupe({ entries: [e({}), e({ notes: 'new work', duration: 30 })], samePeriodRows, sameDateRows: samePeriodRows });
      expect(plan.identicalUpload).to.equal(null);
      expect(plan.toInsertIndexes).to.deep.equal([1]);
   });

   it('(b) cumulative re-upload: skips the days already ingested, inserts the new days, reports the skipped rows', () => {
      const earlier = [existing({ date: '2026-04-15' }, 'Apr15.xlsx', 1), existing({ date: '2026-04-15', notes: 'staff meeting', duration: 30 }, 'Apr15.xlsx', 2)];
      const entries = [e({ date: '2026-04-15' }), e({ date: '2026-04-15', notes: 'staff meeting', duration: 30 }), e({ date: '2026-04-16', notes: 'new day' })];
      const plan = planTrackerDedupe({ entries, sourceRows: [6, 7, 8], samePeriodRows: [], sameDateRows: earlier });
      expect(plan.identicalUpload).to.equal(null);
      expect(plan.toInsertIndexes).to.deep.equal([2]);
      expect(plan.duplicates).to.have.lengthOf(2);
      expect(plan.duplicates[0]).to.deep.include({ row: 6, date: '2026-04-15', duration: 5 });
      expect(plan.duplicates[0].duplicate_of.timesheet_name).to.equal('Apr15.xlsx');
   });

   it('(b) multiset: two identical rows in the new file vs one existing -> skip one, insert one', () => {
      const plan = planTrackerDedupe({ entries: [e({}), e({})], sourceRows: [6, 7], sameDateRows: [existing({}, 'A.xlsx', 1)] });
      expect(plan.toInsertIndexes).to.deep.equal([1]);
      expect(plan.duplicates.map(d => d.row)).to.deep.equal([6]);
   });

   it('(b) a row returned by both lookups is only counted once', () => {
      const row = existing({}, 'A.xlsx', 1);
      const plan = planTrackerDedupe({ entries: [e({}), e({})], sameDateRows: [row, row] });
      expect(plan.toInsertIndexes).to.deep.equal([1]);
   });

   it('inserts everything when nothing exists yet', () => {
      const plan = planTrackerDedupe({ entries: [e({}), e({ duration: 10 })] });
      expect(plan).to.deep.equal({ identicalUpload: null, toInsertIndexes: [0, 1], duplicates: [] });
   });
});

// DEFECT fix regression: a PROCESSED (already billed) entry that gets soft-deleted
// (or an unprocessed one a manager cleaned up) must still block a re-upload of the
// same work — see the module doc comment. findTrackerDuplicates used to filter both
// its lookups on is_deleted = false, so re-uploading the ORIGINAL tracker after that
// row was deleted walked right past it and billed the same line a second time.
describe('findTrackerDuplicates DB query shape', () => {
   // findTrackerDuplicates runs its two lookups (samePeriodRows, then
   // sameDateRows) as trx('timesheet_entries') called twice, in that order,
   // inside one Promise.all — this stub hands back rowsByCall[0] for the
   // first call and rowsByCall[1] for the second, and (optionally) records
   // every .where() filter object it was asked to apply.
   const fakeTrx = (rowsByCall, seenFilters = []) => {
      let call = -1;
      return () => {
         call += 1;
         const rows = rowsByCall[call] || [];
         const chain = {
            where(cond) {
               seenFilters.push(cond);
               return chain;
            },
            whereIn: () => chain,
            select: () => Promise.resolve(rows)
         };
         return chain;
      };
   };

   // C9: samePeriodRows/sameDateRows are no longer a blind is_deleted = false
   // filter (a soft-deleted-but-billed row must still count — see the test
   // right below), but they are also no longer UNFILTERED — a row that was
   // deleted while still pending, with no billing/training link, now has to
   // clear a grouped "retained history" predicate (_retainedHistory in
   // trackerDuplicates.js) so the advertised "delete the bad row, re-upload
   // the corrected tracker" workflow actually works (see the real-DB coverage
   // in coverage-timetracking-timesheets.integration.spec.js). This shape
   // check only proves that predicate is a GROUPED function, never a naive
   // top-level { is_deleted: false }.
   it('filters retained history via a grouped predicate, never a blind top-level is_deleted filter', async () => {
      const billedThenDeleted = { ...existing({}, 'A.xlsx', 1), is_deleted: true, is_processed: true };
      const seenFilters = [];
      const trx = fakeTrx([[billedThenDeleted], [billedThenDeleted]], seenFilters);
      await findTrackerDuplicates(trx, { accountId: 1, userId: 11, startDate: '2026-04-15', endDate: '2026-04-15', entries: [e({})], sourceRows: [6] });
      // Each of the two lookups makes its usual plain-object base filter PLUS
      // one grouped retained-history predicate (a function, not a plain
      // object where a naive filter would carry an is_deleted key).
      expect(seenFilters.length, 'both lookups ran (base filter + retained-history filter, each)').to.equal(4);
      const plainObjectFilters = seenFilters.filter(cond => typeof cond !== 'function');
      expect(plainObjectFilters.length, 'exactly one plain base filter per lookup').to.equal(2);
      plainObjectFilters.forEach(cond => expect(cond, JSON.stringify(cond)).to.not.have.property('is_deleted'));
      const groupedFilters = seenFilters.filter(cond => typeof cond === 'function');
      expect(groupedFilters.length, 'exactly one grouped retained-history predicate per lookup').to.equal(2);
   });

   it('a soft-deleted row with matching content is still reported as a duplicate (not re-inserted)', async () => {
      const billedThenDeleted = { ...existing({}, 'A.xlsx', 1), is_deleted: true, is_processed: true };
      // samePeriodRows empty (different period than the row) so the identicalUpload
      // short-circuit doesn't fire — this exercises the per-row (sameDateRows)
      // multiset path instead, which is what a cumulative/partial re-upload hits.
      const trx = fakeTrx([[], [billedThenDeleted]]);
      const plan = await findTrackerDuplicates(trx, { accountId: 1, userId: 11, startDate: '2026-04-20', endDate: '2026-04-20', entries: [e({})], sourceRows: [6] });
      expect(plan.toInsertIndexes, 'the deleted-but-billed row is NOT re-inserted').to.deep.equal([]);
      expect(plan.duplicates).to.have.lengthOf(1);
      expect(plan.duplicates[0].duplicate_of.timesheet_name).to.equal('A.xlsx');
   });
});
