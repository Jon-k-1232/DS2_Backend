/**
 * Upload validation for prod-layout trackers (employee in B1, dates in B2/B3,
 * header on line 5: Date · Entity · Category · Company Name · First Name ·
 * Last Name · Duration · Time Range · Notes). Workbooks are built in memory.
 */
const xlsx = require('xlsx');
const accountUserService = require('../../../src/endpoints/user/user-service');
const { validateUploadedTracker } = require('../../../src/timeTrackerValidation/validateUploadedTracker');
const { parseDurationMinutes } = require('../../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration');
const { resolveHeaderColumns } = require('../../../src/endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig');
const { detectNonWorkReason, isLunchBreakCategory } = require('../../../src/timeTrackerValidation/nonWorkEntries');

const SERIAL_BASE = Date.UTC(1899, 11, 30);
const serial = iso => Math.round((Date.parse(`${iso}T00:00:00Z`) - SERIAL_BASE) / 86400000);
const HEADERS = ['Date', 'Entity', 'Category', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Time Range', 'Notes'];
const TODAY = new Date('2026-05-15T12:00:00');

const row = ({
   date = '2026-04-28',
   entity = 'James F. Kimmel & Associates',
   category = 'Tax Return Preparation',
   company = 'Acme Corp',
   first = '',
   last = '',
   duration = 60,
   range = '8:00-9:00',
   notes = 'Prepared 1040 and reviewed schedules'
} = {}) => [typeof date === 'string' ? serial(date) : date, entity, category, company, first, last, duration, range, notes];

const buildTracker = ({ employee = 'Joe Cook', start = '2026-04-27', end = '2026-05-01', headers = HEADERS, rows = [row()] } = {}) => {
   const aoa = [['Employee Name', employee], ['Time Tracker Start Date', serial(start)], ['Time Tracker End Date', serial(end)], [], headers, ...rows];
   const wb = xlsx.utils.book_new();
   xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(aoa), 'Time');
   return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

const validate = (opts = {}, { today = TODAY } = {}) =>
   validateUploadedTracker({ db: null, accountID: 1, userID: 16, fileBuffer: buildTracker(opts), originalFileName: 'tracker.xlsx', today });

describe('tracker upload validation (prod layout)', () => {
   let originalGetActive;
   before(() => {
      originalGetActive = accountUserService.getActiveAccountUsers;
      accountUserService.getActiveAccountUsers = async () => [{ user_id: 16, display_name: 'Joe Cook', email: 'joe@example.com' }];
   });
   after(() => {
      accountUserService.getActiveAccountUsers = originalGetActive;
   });

   it('accepts a clean prod-layout tracker; Time Range is ignored and each entry carries its spreadsheet row', async () => {
      const result = await validate({ rows: [row(), row({ date: '2026-04-29', duration: '1.5h', notes: 'Second entry' })] });
      expect(result.errors).to.deep.equal([]);
      expect(result.entries).to.have.lengthOf(2);
      expect(result.entries[0]).to.include({ date: '04/28/2026', duration: 60, company_name: 'Acme Corp', source_row: 6, non_work_reason: null });
      expect(result.entries[1]).to.include({ duration: 90, source_row: 7 });
      expect(result.entries[0]).to.not.have.property('time_range');
   });

   describe('Duration', () => {
      it('rejects negative durations instead of billing them as positive amounts', async () => {
         const result = await validate({ rows: [row({ duration: -46 })] });
         expect(result.entries).to.deep.equal([]);
         expect(result.errors.join(' ')).to.match(/greater than 0/).and.match(/row 6/);
      });

      it('rejects zero', async () => {
         const result = await validate({ rows: [row({ duration: 0 })] });
         expect(result.errors.join(' ')).to.match(/greater than 0/);
      });

      it('rejects fractional minutes and Excel time-of-day fractions rather than truncating them', async () => {
         const result = await validate({ rows: [row({ duration: 7.5 }), row({ duration: 0.0625 }), row({ duration: '1:30' })] });
         expect(result.entries).to.deep.equal([]);
         expect(result.errors).to.have.lengthOf(3);
         expect(result.errors[0]).to.match(/not a whole number of minutes/).and.match(/row 6/);
         expect(result.errors[1]).to.match(/row 7/);
         expect(result.errors[2]).to.match(/not a recognized number of minutes/).and.match(/row 8/);
      });

      it('parses explicit units', async () => {
         const result = await validate({ rows: [row({ duration: '1.5h' }), row({ duration: '90m' }), row({ duration: '1h 30m' }), row({ duration: ' 45 ' })] });
         expect(result.errors).to.deep.equal([]);
         expect(result.entries.map(e => e.duration)).to.deep.equal([90, 90, 90, 45]);
      });
   });

   describe('entry dates', () => {
      it('rejects a future-dated typo (2058) and names the row', async () => {
         const result = await validate({ rows: [row(), row({ date: '2058-04-28' })] });
         expect(result.entries).to.deep.equal([]);
         expect(result.errors).to.have.lengthOf(1);
         expect(result.errors[0]).to.contain('04/28/2058').and.contain('row 7').and.contain('04/20/2026 to 05/01/2026');
      });

      it('allows up to 7 days before the tracker start, not 8', async () => {
         const ok = await validate({ rows: [row({ date: '2026-04-20' })] });
         expect(ok.errors).to.deep.equal([]);
         const bad = await validate({ rows: [row({ date: '2026-04-19' })] });
         expect(bad.errors.join(' ')).to.contain('row 6');
      });

      it('rejects dates after the tracker end date', async () => {
         const result = await validate({ rows: [row({ date: '2026-05-02' })] });
         expect(result.errors.join(' ')).to.contain('05/02/2026');
      });

      it('rejects dates after today even inside the tracker window', async () => {
         const result = await validate({ rows: [row({ date: '2026-04-30' })] }, { today: new Date('2026-04-29T09:00:00') });
         expect(result.errors.join(' ')).to.contain('04/20/2026 to 04/29/2026');
      });
   });

   describe('header row', () => {
      it('fails the upload naming a misspelled required header instead of silently dropping the column', async () => {
         const headers = HEADERS.map(h => (h === 'Notes' ? 'Note' : h));
         const result = await validate({ headers });
         expect(result.entries).to.deep.equal([]);
         expect(result.errors).to.have.lengthOf(1);
         expect(result.errors[0]).to.contain('missing required column: "Notes"');
      });

      it('names every missing header', async () => {
         const headers = ['Date', 'Entity', 'Company Name', 'First Name', 'Last Name', 'Duration (min)', 'Notes'];
         const result = await validate({ headers, rows: [[serial('2026-04-28'), 'JFK&A', 'Acme Corp', '', '', 60, 'x']] });
         expect(result.errors[0]).to.contain('"Category"').and.contain('"Duration"');
      });

      it('matches headers case- and whitespace-insensitively', async () => {
         const headers = HEADERS.map(h => ` ${h.toUpperCase().replace(' ', '  ')} `);
         const result = await validate({ headers });
         expect(result.errors).to.deep.equal([]);
         expect(result.entries[0].notes).to.equal('Prepared 1040 and reviewed schedules');
      });

      it('rejects a duplicated column', async () => {
         const result = await validate({ headers: [...HEADERS, 'notes'], rows: [[...row(), 'second notes']] });
         expect(result.errors.join(' ')).to.contain('repeats column "Notes"');
      });

      it('resolveHeaderColumns reports columns, missing and duplicates', () => {
         const resolved = resolveHeaderColumns(['date', 'Entity', null, 42, 'Notes', 'NOTES']);
         expect(resolved.columns.map(c => c.header)).to.deep.equal(['Date', 'Entity', 'Notes', 'Notes']);
         expect(resolved.duplicates).to.deep.equal(['Notes']);
         expect(resolved.missing).to.deep.equal(['Category', 'Company Name', 'First Name', 'Last Name', 'Duration']);
      });
   });

   describe('non-work rows', () => {
      // This checks only the non_work_reason ANNOTATION validateUploadedTracker
      // produces — it says nothing about billing, since this function never
      // creates a transaction. The actual "never billable" enforcement (C4:
      // held apply AND legacy manual apply must force non-billable from the
      // STORED entry, including a Doctor Appointment attached to an EXTERNAL
      // customer) is covered end-to-end in
      // test/endpoints/billingReview/billingReview-service.spec.js and
      // test/integration/coverage-timetracking-timesheets.integration.spec.js.
      it('flags vacation / sick / holiday / personal rows as non-work (annotated via non_work_reason; kept, not dropped)', async () => {
         const result = await validate({
            rows: [
               row({ category: 'Vacation', notes: 'vacation at Arroyo Roble', duration: 480 }),
               row({ category: 'Administrative', notes: 'Sick day (approved by Jim)', duration: 480 }),
               row({ category: 'Holiday', notes: 'Memorial Day', duration: 480 }),
               row({ category: 'Personal Appointment', notes: 'Barber shop', duration: 55 }),
               row({ category: 'Monthly Services', notes: 'reviewed and calculated baseline sick pay for client payroll' }),
               row({ category: '2025 Personal Tax Return', notes: 'Prepared return' })
            ]
         });
         expect(result.errors).to.deep.equal([]);
         expect(result.entries.map(e => e.non_work_reason)).to.deep.equal(['category:vacation', 'notes:sick day', 'category:holiday', 'category:personal', null, null]);
      });

      it('drops Lunch rows regardless of case / padding', async () => {
         const result = await validate({ rows: [row({ category: ' LUNCH ' }), row({ category: 'lunch break' }), row()] });
         expect(result.errors).to.deep.equal([]);
         expect(result.entries).to.have.lengthOf(1);
         expect(result.entries[0].source_row).to.equal(8);
      });
   });

   it('coerces numeric Category / Notes / Company cells to strings instead of aborting with a TypeError', async () => {
      const result = await validate({ rows: [row({ category: 1099, notes: 1040, company: 4 })] });
      expect(result.errors).to.deep.equal([]);
      expect(result.entries[0]).to.include({ category: '1099', notes: '1040', company_name: '4' });
   });

   it('reports every bad row in one pass', async () => {
      const result = await validate({ rows: [row({ duration: -5 }), row(), row({ date: '2027-01-01' }), row({ company: '', first: 'Ann', last: '' })] });
      expect(result.entries).to.deep.equal([]);
      expect(result.errors).to.have.lengthOf(3);
      expect(result.errors.map(e => (e.match(/row (\d+)/) || [])[1])).to.deep.equal(['6', '8', '9']);
   });

   // C11 (P2): the old collector recursed once per invalid row, re-validating
   // the WHOLE array from scratch each time and growing the call stack by a
   // frame per error — a legal-sized upload with thousands of bad rows in a
   // row exhausted the stack before every error was collected. The new
   // per-row loop is O(n) time and O(1) stack depth, so it must finish AND
   // report every single error regardless of how many rows are invalid.
   describe('a large batch of invalid rows (C11: no stack growth, no truncated errors)', () => {
      it('reports all 5,000 errors, one per row, in one pass', async function () {
         this.timeout(30_000);
         const rows = Array.from({ length: 5000 }, () => row({ duration: -1 }));
         const result = await validate({ rows });
         expect(result.entries).to.deep.equal([]);
         expect(result.errors).to.have.lengthOf(5000);
         // Every reported row number is distinct and in range (6..5005).
         const rowNumbers = result.errors.map(e => Number((e.match(/row (\d+)/) || [])[1]));
         expect(rowNumbers.filter(n => Number.isFinite(n))).to.have.lengthOf(5000);
         expect(new Set(rowNumbers).size).to.equal(5000);
         expect(Math.min(...rowNumbers)).to.equal(6);
         expect(Math.max(...rowNumbers)).to.equal(5005);
      });
   });

   describe('a corrupt / unsupported workbook (C11)', () => {
      it('a corrupt XLSX (unparseable ZIP) -> a clean validation error, not a thrown exception / 500', async () => {
         // Real ZIP local-file-header magic ("PK\x03\x04") followed by garbage —
         // xlsx.read() throws "Unsupported ZIP encryption" on this shape.
         const corrupt = Buffer.concat([Buffer.from('PK\x03\x04'), require('crypto').randomBytes(200)]);
         const result = await validateUploadedTracker({ db: null, accountID: 1, userID: 16, fileBuffer: corrupt, originalFileName: 'corrupt.xlsx', today: TODAY });
         expect(result.entries).to.deep.equal([]);
         expect(result.metadata).to.equal(null);
         expect(result.errors).to.have.lengthOf(1);
         expect(result.errors[0]).to.match(/corrupt or unsupported/i);
      });
   });
});

// C7 (P2): employee resolution must use the validated entry.user_id (the
// tracker OWNER) before any name match — validation's own B1 name lookup is
// scoped to the owner only, so a duplicate display name elsewhere in the
// account roster can never cause the wrong employee's record (and rate) to be
// validated against.
describe('tracker upload validation: employee lookup is scoped to the OWNER (C7)', () => {
   let originalGetActive;
   const duplicateNamedRoster = [
      { user_id: 90011, display_name: 'Alex Jones', email: 'alex.90011@example.com' },
      { user_id: 90012, display_name: 'Alex Jones', email: 'alex.90012@example.com' }
   ];
   before(() => {
      originalGetActive = accountUserService.getActiveAccountUsers;
      accountUserService.getActiveAccountUsers = async () => duplicateNamedRoster;
   });
   after(() => {
      accountUserService.getActiveAccountUsers = originalGetActive;
   });

   const validateAsOwner = (ownerUserID, opts = {}) =>
      validateUploadedTracker({ db: null, accountID: 1, userID: ownerUserID, fileBuffer: buildTracker({ employee: 'Alex Jones', ...opts }), originalFileName: 'tracker.xlsx', today: TODAY });

   it("resolves to OWNER 90012's record — not whichever 'Alex Jones' the full roster lists first/last", async () => {
      const result = await validateAsOwner(90012);
      expect(result.errors).to.deep.equal([]);
      expect(result.metadata.userId).to.equal(90012);
      expect(result.entries.every(e => e.user_id === 90012)).to.equal(true);
   });

   it("the OTHER owner id resolves to the OTHER record (proves it is not just always picking one)", async () => {
      const result = await validateAsOwner(90011);
      expect(result.errors).to.deep.equal([]);
      expect(result.metadata.userId).to.equal(90011);
   });

   it('an owner id outside the roster is refused (B1 no longer resolves against the whole account)', async () => {
      const result = await validateAsOwner(999999);
      expect(result.entries).to.deep.equal([]);
      expect(result.errors.join(' ')).to.match(/not valid or not found/);
   });
});

describe('parseDurationMinutes', () => {
   const ok = [[90, 90], ['90', 90], ['90m', 90], ['90 min', 90], ['90 minutes', 90], ['1.5h', 90], ['1.5 hrs', 90], ['2 hours', 120], ['1h30m', 90], ['1 hr 30 min', 90], ['0.25h', 15], ['1.33h', 80]];
   ok.forEach(([input, expected]) => {
      it(`${JSON.stringify(input)} -> ${expected}`, () => {
         expect(parseDurationMinutes(input)).to.equal(expected);
      });
   });

   it('tolerates floating-point noise from formula-computed minutes', () => {
      expect(parseDurationMinutes(89.99999999)).to.equal(90);
   });

   ['-46', -46, 0, '0m', '-1.5h', 7.5, '7.5m', '1:30', 0.0625, 'abc', '1,020', 1441, '25h', NaN, '', null].forEach(input => {
      it(`rejects ${typeof input === 'number' ? String(input) : JSON.stringify(input)}`, () => {
         expect(() => parseDurationMinutes(input)).to.throw();
      });
   });
});

describe('non-work detection', () => {
   const cases = [
      [{ category: 'Vacation Day', notes: 'vacation 8 hours (approved by Jim)' }, 'category:vacation'],
      [{ category: 'Sick Day' }, 'category:sick'],
      [{ category: 'PTO' }, 'category:pto'],
      [{ category: 'Out of Office' }, 'category:out of office'],
      [{ entity: 'Holiday' }, 'entity:holiday'],
      [{ category: 'Administrative', notes: 'Out of office - walmart run' }, 'notes:out of office'],
      [{ category: 'Teleconference', notes: 'Yvonne email process discuss her vacation' }, null],
      [{ category: 'Administrative', notes: 'generated x3 Holiday observance notice' }, null],
      [{ category: 'Administrative', notes: 'Holiday pay reconciliation for client' }, null],
      [{ category: 'Client Meeting', notes: 'Lunch meeting with client re: 2025 return' }, null],
      [{ category: 'Tax Return Preparation', notes: 'client responded mike is on vacation until Monday' }, null],
      [{ category: 'Personal Tax Return' }, null],
      [{ category: 'Staff Meeting', notes: 'Lunch' }, 'notes:lunch'],
      // 'Doctor Appointment' is in the real template's Categories sheet (DEFECT fix).
      [{ category: 'Doctor Appointment' }, 'category:doctor'],
      [{ category: 'Doctor Appointment', notes: 'annual physical' }, 'category:doctor'],
      [{ category: 'Administrative', notes: 'Doctor appointment this morning' }, 'notes:doctor appointment'],
      [{ category: 'Tax Return Preparation', notes: 'Doctor requested an updated depreciation schedule for the medical practice' }, null]
   ];
   cases.forEach(([entry, expected]) => {
      it(`${JSON.stringify(entry)} -> ${expected}`, () => {
         expect(detectNonWorkReason(entry)).to.equal(expected);
      });
   });

   it('isLunchBreakCategory only matches a lunch label', () => {
      expect(isLunchBreakCategory(' Lunch ')).to.equal(true);
      expect(isLunchBreakCategory('Lunch Break')).to.equal(true);
      expect(isLunchBreakCategory('Lunch and Learn')).to.equal(false);
      expect(isLunchBreakCategory(null)).to.equal(false);
   });
});
