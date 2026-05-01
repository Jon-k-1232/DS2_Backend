/**
 * Builds synthetic time-tracker XLSX fixtures matching the parser's
 * expected layout (csvHeaderPropertyConfig.js). Run:
 *
 *   node test/fixtures/buildTrackerFixtures.js
 *
 * Produces:
 *   test/fixtures/timetrackers/clean.xlsx       (50 rows, all match seed)
 *   test/fixtures/timetrackers/mixed.xlsx       (100 rows, ~20% messy)
 *   test/fixtures/timetrackers/volume.xlsx      (600 rows, concurrency stress)
 *   test/fixtures/timetrackers/adversarial.xlsx (30 rows w/ PII in notes)
 *
 * Mirrors the layout produced by the user's S3 templates. When AWS creds are
 * available, swap these in by running the user's actual template through the
 * same generator (or replace this script with an S3 fetch).
 */
const path = require('path');
const ExcelJS = require('exceljs');

const OUTPUT_DIR = path.join(__dirname, 'timetrackers');

const SEED_CUSTOMERS = ['Acme Corp', 'Globex Industries', 'Smith, John', 'Smith, Jane', 'Wayne Enterprises'];
const SEED_EMPLOYEES = ['Eliza Smith', 'Bob Jones'];
const SEED_CATEGORIES = ['Tax Compliance', 'Bookkeeping', 'Consulting'];

const HEADERS = [
   'Date',
   'Entity',
   'Category',
   'Employee Name',
   'Company Name',
   'First Name',
   'Last Name',
   'Duration',
   'Notes'
];

const _addNameBlock = (sheet, employee, startDate, endDate) => {
   sheet.getCell('A1').value = 'Employee Name';
   sheet.getCell('B1').value = employee;
   sheet.getCell('A2').value = 'Time Tracker Start Date';
   sheet.getCell('B2').value = startDate;
   sheet.getCell('A3').value = 'Time Tracker End Date';
   sheet.getCell('B3').value = endDate;
};

const _addHeaders = sheet => {
   const headerRow = sheet.getRow(5);
   HEADERS.forEach((h, i) => {
      headerRow.getCell(i + 1).value = h;
   });
   headerRow.commit();
};

const _appendRow = (sheet, rowIdx, row) => {
   const r = sheet.getRow(rowIdx);
   r.getCell(1).value = row.date;
   r.getCell(2).value = row.entity;
   r.getCell(3).value = row.category;
   r.getCell(4).value = row.employee_name;
   r.getCell(5).value = row.company_name || '';
   r.getCell(6).value = row.first_name || '';
   r.getCell(7).value = row.last_name || '';
   r.getCell(8).value = row.duration;
   r.getCell(9).value = row.notes;
   r.commit();
};

const buildSheet = ({ employee, startDate, endDate, rows }) => {
   const wb = new ExcelJS.Workbook();
   const ws = wb.addWorksheet('TimeTracker');
   _addNameBlock(ws, employee, startDate, endDate);
   _addHeaders(ws);
   rows.forEach((row, i) => _appendRow(ws, 6 + i, row));
   return wb;
};

const _pick = (arr, i) => arr[i % arr.length];

const buildClean = () => {
   const rows = [];
   for (let i = 0; i < 50; i++) {
      rows.push({
         date: '2026-04-27',
         entity: _pick(SEED_CUSTOMERS, i),
         category: _pick(SEED_CATEGORIES, i),
         employee_name: 'Eliza Smith',
         company_name: '',
         first_name: '',
         last_name: '',
         duration: 60 + (i % 5) * 15,
         notes:
            i % 3 === 0
               ? 'Prepared 1040 individual return — reviewed Schedule A and B'
               : i % 3 === 1
                  ? 'Monthly bookkeeping reconciliation — bank and credit card accounts'
                  : 'Client consultation on tax projection for next quarter'
      });
   }
   return buildSheet({ employee: 'Eliza Smith', startDate: '2026-04-27', endDate: '2026-05-03', rows });
};

const buildMixed = () => {
   const rows = [];
   for (let i = 0; i < 100; i++) {
      // 80 clean rows
      if (i < 80) {
         rows.push({
            date: '2026-04-27',
            entity: _pick(SEED_CUSTOMERS, i),
            category: _pick(SEED_CATEGORIES, i),
            employee_name: 'Bob Jones',
            duration: 30 + (i % 4) * 30,
            notes: i % 2 === 0 ? 'Prepared 1040 return for client' : 'Bookkeeping reconciliation'
         });
         continue;
      }
      const messyType = (i - 80) % 5;
      if (messyType === 0) {
         // Brand new customer not in DB
         rows.push({ date: '2026-04-28', entity: 'Brand New Co', category: 'Consulting', employee_name: 'Bob Jones', duration: 60, notes: 'Initial onboarding meeting' });
      } else if (messyType === 1) {
         // Vague notes
         rows.push({ date: '2026-04-28', entity: 'Acme Corp', category: 'Consulting', employee_name: 'Bob Jones', duration: 30, notes: 'work' });
      } else if (messyType === 2) {
         // Unknown employee
         rows.push({ date: '2026-04-29', entity: 'Globex Industries', category: 'Consulting', employee_name: 'Mystery Employee', duration: 45, notes: 'reviewed financial statements' });
      } else if (messyType === 3) {
         // Last-name-first form, individual customer
         rows.push({ date: '2026-04-30', entity: 'Smith, J', category: 'Tax Compliance', employee_name: 'Bob Jones', duration: 90, notes: 'completed individual tax filing for the smith family' });
      } else {
         // Typo'd customer
         rows.push({ date: '2026-05-01', entity: 'Acmme Corp', category: 'Bookkeeping', employee_name: 'Bob Jones', duration: 60, notes: 'reconciled accounts' });
      }
   }
   return buildSheet({ employee: 'Bob Jones', startDate: '2026-04-27', endDate: '2026-05-03', rows });
};

const buildVolume = () => {
   const rows = [];
   for (let i = 0; i < 600; i++) {
      rows.push({
         date: i % 5 === 0 ? '2026-04-27' : i % 5 === 1 ? '2026-04-28' : i % 5 === 2 ? '2026-04-29' : i % 5 === 3 ? '2026-04-30' : '2026-05-01',
         entity: _pick(SEED_CUSTOMERS, i),
         category: _pick(SEED_CATEGORIES, i),
         employee_name: i % 2 === 0 ? 'Eliza Smith' : 'Bob Jones',
         duration: 30 + (i % 8) * 15,
         notes: i % 3 === 0 ? 'Prepared 1040 return' : i % 3 === 1 ? 'Bookkeeping reconciliation' : 'Client consultation'
      });
   }
   return buildSheet({ employee: 'Eliza Smith', startDate: '2026-04-27', endDate: '2026-05-03', rows });
};

const buildAdversarial = () => {
   const rows = [];
   const piiPatterns = [
      'sent invoice copy to John Smith at john.smith@example.com',
      'called (555) 123-4567 and confirmed the appointment',
      'reviewed SSN 123-45-6789 on the W-9 form',
      'discussed payment with Acme Corp CFO',
      'mailed package to 123 Main St, Phoenix, AZ 85003',
      'wired $1,200 to bank account 0123456789',
      'text from +1 (480) 555-0199 about deadline',
      'forwarded email from cfo@globex.com',
      'follow-up note: Eliza Smith handled the audit prep',
      'paid by card 4111-1111-1111-1111 ending 1111'
   ];
   for (let i = 0; i < 30; i++) {
      rows.push({
         date: '2026-04-29',
         entity: _pick(SEED_CUSTOMERS, i),
         category: _pick(SEED_CATEGORIES, i),
         employee_name: 'Eliza Smith',
         duration: 60,
         notes: _pick(piiPatterns, i)
      });
   }
   return buildSheet({ employee: 'Eliza Smith', startDate: '2026-04-27', endDate: '2026-05-03', rows });
};

const main = async () => {
   const fs = require('fs');
   if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
   const builders = [
      ['clean.xlsx', buildClean],
      ['mixed.xlsx', buildMixed],
      ['volume.xlsx', buildVolume],
      ['adversarial.xlsx', buildAdversarial]
   ];
   for (const [name, fn] of builders) {
      const wb = fn();
      const out = path.join(OUTPUT_DIR, name);
      await wb.xlsx.writeFile(out);
      console.log('wrote', out);
   }
};

if (require.main === module) {
   main().catch(err => {
      console.error(err);
      process.exit(1);
   });
}

module.exports = { buildClean, buildMixed, buildVolume, buildAdversarial, buildSheet, HEADERS };
