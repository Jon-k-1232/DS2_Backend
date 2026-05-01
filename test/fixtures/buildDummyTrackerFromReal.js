/**
 * Builds a fully-sanitized dummy time tracker that matches the REAL prod
 * layout (verified against /tmp/_real_tracker_sample.xlsx pulled from
 * s3://ds2-561979538576/James_F__Kimmel___Associates/time_tracking/processed/...
 * for read-only schema reference).
 *
 * Uses REAL customer + employee names from the local dev DB (account_id=1)
 * so the matcher actually has something to match against during local
 * regression. Notes are sanitized — no real client phone numbers / emails /
 * SSNs are present, only test patterns designed to exercise the redaction
 * pipeline. Output is local-only — never written back to S3.
 *
 * Real layout:
 *   B1 = Employee Name, B2/B3 = start/end dates (Excel serial)
 *   Row 5 = headers: Date | Entity | Category | Company Name | First Name | Last Name | Duration | Time Range | Notes
 *   Row 6+ = data
 *
 * Output: writes to /tmp/dummy_tracker_for_local_test.xlsx ONLY. Run:
 *   node test/fixtures/buildDummyTrackerFromReal.js
 */
const ExcelJS = require('exceljs');

const OUT = '/tmp/dummy_tracker_for_local_test.xlsx';
const SERIAL_BASE = new Date(Date.UTC(1899, 11, 30));
const _toSerial = isoDate => Math.round((new Date(isoDate + 'T00:00:00Z') - SERIAL_BASE) / (24 * 60 * 60 * 1000));

const HEADERS = ['Date', 'Entity', 'Category', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Time Range', 'Notes'];

// Real customer names from dev DB account 1 (each has at least one customer_job).
const C1 = '4D Asset Management, LLC';
const C2 = 'Cahoon Customs';
const C3 = 'Desert Wind Law';
const C4 = 'DL Wilford LLC';
const C5 = 'Natalie Smith';
const C6 = 'Aaron Bird';

// Categories that exist in dev DB account 1: Accounting, Insurance, Rental Property, Securities.
// (The free-text Category column on the spreadsheet is just a hint to the
// AI; the GWD lookup is what powers the auto-insert. We use job-category
// names as the spreadsheet "Category" since that's the human-friendly term.)
const CAT_ACCT = 'Accounting';
const CAT_INS = 'Insurance';
const CAT_RENT = 'Rental Property';
const CAT_SEC = 'Securities';

const ROWS = [
   // --- Block A: clean / clear notes / matching customer → AUTO_INSERT (with AI flag on) ---
   ['2026-04-27', C1, CAT_ACCT,  C1, null, null, 60, '8:00-9:00',   'Monthly bookkeeping reconciliation; bank and credit card accounts'],
   ['2026-04-27', C1, CAT_ACCT,  C1, null, null, 45, '9:00-9:45',   'Reviewed prior month bank reconciliation discrepancies'],
   ['2026-04-27', C2, CAT_ACCT,  C2, null, null, 60, '10:00-11:00', 'Q1 bookkeeping reconciliation; entered AP invoices'],
   ['2026-04-27', C3, CAT_ACCT,  C3, null, null, 30, '11:00-11:30', 'Reviewed payroll register and confirmed federal deposits'],
   ['2026-04-27', C4, CAT_RENT,  C4, null, null, 30, '13:00-13:30', 'Reconciled rental property income for Q1'],
   ['2026-04-28', C1, CAT_ACCT,  C1, null, null, 90, '8:00-9:30',   'Continued books cleanup; entered prior period adjustments'],
   ['2026-04-28', C2, CAT_ACCT,  C2, null, null, 60, '10:00-11:00', 'Recorded vendor bills and payroll for the month'],

   // --- Block B: individual customer (last-name-first parsing path) ---
   ['2026-04-28', C5, CAT_SEC,   null, 'Natalie', 'Smith', 75, '13:00-14:15', 'Reviewed Q1 brokerage statements and recorded gains/losses'],
   ['2026-04-28', C6, CAT_SEC,   null, 'Aaron',   'Bird',  60, '14:30-15:30', 'Annual portfolio review; rebalance recommendation'],

   // --- Block C: ambiguous "4D Asset" alone — should fuzzy match high then auto_insert ---
   ['2026-04-29', '4D Asset',    CAT_ACCT, '4D Asset Management', null, null, 45, '8:00-8:45', 'Quick check-in on Q1 close timing'],

   // --- Block D: brand-new customer NOT in dev DB → HOLD new_customer_needs_addition ---
   ['2026-04-29', 'Initech Industries', CAT_ACCT, 'Initech Industries', 'Pat', 'Reynolds', 60, '9:00-10:00', 'Initial onboarding meeting; gathered W-9 and ownership info'],

   // --- Block E: vague notes → HOLD ambiguous_category / low_ai_confidence ---
   ['2026-04-29', C1, CAT_ACCT,  C1, null, null, 30, '10:00-10:30', 'work'],
   ['2026-04-29', C1, CAT_ACCT,  C1, null, null, 15, '10:30-10:45', 'misc'],

   // --- Block F: notes containing PII patterns (Comprehend / string-fallback should redact) ---
   ['2026-04-29', C1, CAT_ACCT,  C1, null, null, 15, '11:00-11:15', 'Called CFO at (555) 123-4567 regarding Q1 tax estimate'],
   ['2026-04-29', C2, CAT_ACCT,  C2, null, null, 10, '11:15-11:25', 'Emailed billing@example.com confirming invoice receipt'],
   ['2026-04-29', C1, CAT_ACCT,  C1, null, null, 20, '13:00-13:20', 'Updated W-9 with SSN 123-45-6789 on file in client folder'],

   // --- Block G: more clean rows on 2026-04-30 ---
   ['2026-04-30', C1, CAT_ACCT,  C1, null, null, 60, '8:00-9:00',   'Prepared monthly close package; reviewed trial balance'],
   ['2026-04-30', C3, CAT_ACCT,  C3, null, null, 45, '9:00-9:45',   'Bank reconciliation for operating account'],
   ['2026-04-30', C4, CAT_RENT,  C4, null, null, 30, '10:00-10:30', 'Quarterly rental income reconciliation'],
   ['2026-04-30', C2, CAT_ACCT,  C2, null, null, 90, '13:00-14:30', 'Continued AP entry; reconciled credit card statement'],

   // --- Block H: short rows mimicking real "Email" / "Phone Call" / "Securities" categories ---
   ['2026-05-01', C1, CAT_ACCT,  C1, null, null, 10, '8:00-8:10',   'Replied to client question about extension filing'],
   ['2026-05-01', C2, CAT_ACCT,  C2, null, null, 15, '8:10-8:25',   'Sent quarterly P&L summary to controller'],
   ['2026-05-01', C5, CAT_SEC,   null, 'Natalie', 'Smith', 20, '8:30-8:50', 'Discussed dividend reinvestment for Q2'],
   ['2026-05-01', C1, CAT_ACCT,  C1, null, null, 60, '9:00-10:00',  'Reviewed YTD P&L and discussed variances with client'],

   // --- Block I: edge-case very short note — likely held ambiguous_category ---
   ['2026-05-01', C2, CAT_ACCT,  C2, null, null, 30, '10:00-10:30', '?'],

   // --- Block J: a couple more clean to round out the period ---
   ['2026-05-01', C1, CAT_ACCT,  C1, null, null, 45, '13:00-13:45', 'Reviewed estimated tax payment vouchers'],
   ['2026-05-01', C3, CAT_ACCT,  C3, null, null, 30, '14:00-14:30', 'Wrap-up call on Q2 planning']
];

const main = async () => {
   const wb = new ExcelJS.Workbook();
   wb.creator = 'DS2 local-test fixture (account 1)';
   wb.created = new Date();
   const ws = wb.addWorksheet('Time');

   ws.getCell('A1').value = 'Employee Name';
   ws.getCell('B1').value = 'Joe Cook';            // user_id 16, active in account 1
   ws.getCell('A2').value = 'Time Tracker Start Date';
   ws.getCell('B2').value = _toSerial('2026-04-27');
   ws.getCell('A3').value = 'Time Tracker End Date';
   ws.getCell('B3').value = _toSerial('2026-05-03');

   const headerRow = ws.getRow(5);
   HEADERS.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
   headerRow.font = { bold: true };
   headerRow.commit();

   ROWS.forEach((row, idx) => {
      const r = ws.getRow(6 + idx);
      r.getCell(1).value = _toSerial(row[0]);
      r.getCell(1).numFmt = 'yyyy-mm-dd';
      for (let i = 1; i < HEADERS.length; i++) {
         r.getCell(i + 1).value = row[i] == null ? '' : row[i];
      }
      r.commit();
   });

   await wb.xlsx.writeFile(OUT);
   console.log('wrote', OUT);
   console.log('rows:', ROWS.length, '| employee:', 'Joe Cook (user_id 16)', '| period: 2026-04-27 → 2026-05-03');
};

if (require.main === module) {
   main().catch(err => { console.error(err); process.exit(1); });
}
