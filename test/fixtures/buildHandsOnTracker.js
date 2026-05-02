/**
 * Builds a fresh dummy time tracker for hands-on end-to-end testing.
 * Uses real customer + employee names from dev DB account 1 so that
 * tier-1 customer match resolves and the orchestrator can auto-insert.
 *
 * Output: /tmp/handson_tracker.xlsx AND ~/Downloads/handson_tracker.xlsx
 *   (both copies; the Downloads copy is what the user opens to upload).
 *
 * Layout matches the real prod tracker schema (Date · Entity · Category ·
 * Company Name · First Name · Last Name · Duration · Time Range · Notes,
 * with employee in cell B1).
 */
const ExcelJS = require('exceljs');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SERIAL_BASE = new Date(Date.UTC(1899, 11, 30));
const _toSerial = isoDate => Math.round((new Date(isoDate + 'T00:00:00Z') - SERIAL_BASE) / (24 * 60 * 60 * 1000));

const HEADERS = ['Date', 'Entity', 'Category', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Time Range', 'Notes'];

// Real customer display_names from account 1 — all have customer_jobs.
// These are specifically chosen so tier-1 exact-name match resolves and
// the orchestrator can auto-insert without LLM tiebreak.
const C = {
   ACME: '4D Asset Management, LLC',
   ALAN: 'Alan and Pauly Heller',
   AMY: 'Amy Roth',
   ALEX: 'Alex  Ropars',
   ANDREW: 'Andrew Nazzal',
   AARON: 'Aaron Bird',
   ADELENE: 'Adelene Waldo'
};

const ROWS = [
   // ============================================================
   // Block A — clean rows that SHOULD auto-insert
   // (real customer, clear notes, employee match)
   // ============================================================
   ['2026-05-04', C.ACME,    'Accounting',     C.ACME,    null, null, 60, '8:00-9:00',   'Monthly bookkeeping reconciliation; bank and credit card accounts'],
   ['2026-05-04', C.ACME,    'Accounting',     C.ACME,    null, null, 30, '9:00-9:30',   'Reviewed prior month bank reconciliation discrepancies and adjusting entries'],
   ['2026-05-04', C.ALAN,    'Securities',     null,      'Alan',  'Heller',  45, '10:00-10:45', 'Quarterly portfolio review and rebalance discussion with client'],
   ['2026-05-04', C.AMY,     'Securities',     null,      'Amy',   'Roth',    30, '11:00-11:30', 'Reviewed Q1 brokerage statements and recorded gains'],
   ['2026-05-05', C.ALEX,    'Accounting',     null,      'Alex',  'Ropars',  60, '8:00-9:00',   'Recorded vendor bills and reconciled credit card statement'],
   ['2026-05-05', C.ANDREW,  'Accounting',     null,      'Andrew','Nazzal',  45, '9:00-9:45',   'Q1 close package review; trial balance reconciliation'],
   ['2026-05-05', C.AARON,   'Securities',     null,      'Aaron', 'Bird',    30, '10:00-10:30', 'Annual portfolio review meeting; rebalance recommendations'],
   ['2026-05-05', C.ADELENE, 'Accounting',     null,      'Adelene','Waldo',  60, '11:00-12:00', 'Monthly bookkeeping; entered AP invoices and reconciled bank account'],

   // ============================================================
   // Block B — ambiguous notes; should HOLD with low_ai_confidence
   // ============================================================
   ['2026-05-06', C.ACME,    'Accounting',     C.ACME,    null, null, 30, '8:00-8:30',   'work'],
   ['2026-05-06', C.AMY,     'Securities',     null,      'Amy',   'Roth',    15, '8:30-8:45',   'misc'],

   // ============================================================
   // Block C — brand-new customer NOT in DB; should HOLD with new_customer_needs_addition
   // ============================================================
   ['2026-05-06', 'Initech Industries', 'Accounting', 'Initech Industries', 'Pat', 'Reynolds', 60, '9:00-10:00', 'Initial onboarding meeting; gathered W-9 and ownership info'],

   // ============================================================
   // Block D — notes with PII (Comprehend should redact before sending to AI)
   // ============================================================
   ['2026-05-06', C.ACME,    'Accounting',     C.ACME,    null, null, 15, '10:00-10:15', 'Called CFO at (555) 123-4567 regarding Q1 estimated tax payment'],
   ['2026-05-06', C.ANDREW,  'Email',          null,      'Andrew','Nazzal',  10, '10:15-10:25', 'Emailed billing@example.com confirming invoice receipt'],
   ['2026-05-06', C.ALAN,    'Accounting',     null,      'Alan',  'Heller',  20, '10:30-10:50', 'Updated W-9 with SSN 123-45-6789 in client folder'],

   // ============================================================
   // Block E — clean rows on a third day (rounds out a 1-week tracker)
   // ============================================================
   ['2026-05-07', C.ACME,    'Accounting',     C.ACME,    null, null, 90, '8:00-9:30',   'Continued books cleanup; entered prior period adjustments and trial balance'],
   ['2026-05-07', C.ADELENE, 'Email',          null,      'Adelene','Waldo',  15, '10:00-10:15', 'Replied to client question about extension filing deadline'],
   ['2026-05-07', C.AARON,   'Investment Account Review', null, 'Aaron', 'Bird', 30, '10:30-11:00', 'Reviewed allocation and recorded dividend reinvestment for Q2'],

   // ============================================================
   // Block F — short Email + Filing rows (mix of categories)
   // ============================================================
   ['2026-05-08', C.AMY,     'Email',          null,      'Amy',   'Roth',    10, '8:00-8:10',   'Sent quarterly P&L summary to controller'],
   ['2026-05-08', C.ALEX,    'Filing',         null,      'Alex',  'Ropars',  20, '8:30-8:50',   'Filed quarterly payroll tax forms for Q1'],
   ['2026-05-08', C.ANDREW,  'Teleconference', null,      'Andrew','Nazzal',  30, '9:00-9:30',   'Conference call with client to review prior month financials'],
   ['2026-05-08', C.ACME,    'Accounting',     C.ACME,    null, null, 60, '9:30-10:30',  'Reviewed estimated tax payment vouchers and Q2 projection'],

   // ============================================================
   // Block G — final clean rows + one ambiguous "?" row
   // ============================================================
   ['2026-05-08', C.ALAN,    'Securities',     null,      'Alan',  'Heller',  30, '11:00-11:30', 'Wrap-up call on Q2 portfolio planning and tax-loss harvesting'],
   ['2026-05-08', C.AMY,     'Accounting',     null,      'Amy',   'Roth',    15, '13:00-13:15', '?']
];

const main = async () => {
   const wb = new ExcelJS.Workbook();
   wb.creator = 'DS2 hands-on regression fixture';
   wb.created = new Date();
   const ws = wb.addWorksheet('Time');

   // Name block — Joe Cook is user_id 16, active in account 1.
   // The validator requires the submitter to match this, so when uploading
   // pick "Joe Cook" from the Submitting For dropdown.
   ws.getCell('A1').value = 'Employee Name';
   ws.getCell('B1').value = 'Joe Cook';
   ws.getCell('A2').value = 'Time Tracker Start Date';
   ws.getCell('B2').value = _toSerial('2026-05-04');
   ws.getCell('A3').value = 'Time Tracker End Date';
   ws.getCell('B3').value = _toSerial('2026-05-08');

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

   const tmpPath = '/tmp/handson_tracker.xlsx';
   const downloadsDir = path.join(os.homedir(), 'Downloads');
   const downloadsPath = path.join(downloadsDir, 'handson_tracker.xlsx');

   await wb.xlsx.writeFile(tmpPath);
   if (fs.existsSync(downloadsDir)) {
      fs.copyFileSync(tmpPath, downloadsPath);
   }
   console.log('Wrote', tmpPath);
   if (fs.existsSync(downloadsPath)) console.log('Wrote', downloadsPath);
   console.log('Rows:', ROWS.length, '| Employee: Joe Cook (user_id 16) | Period: 2026-05-04 → 2026-05-08');
};

if (require.main === module) {
   main().catch(err => { console.error(err); process.exit(1); });
}
