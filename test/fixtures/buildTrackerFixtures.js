/**
 * Builds synthetic time-tracker XLSX fixtures in the REAL prod layout
 * (verified against prod trackers; see buildDummyTrackerFromReal.js):
 *
 *   B1 = Employee Name (one employee per tracker — there is NO per-row employee column)
 *   B2 / B3 = Time Tracker Start / End Date (Excel serial dates)
 *   Line 5 = headers: Date · Entity · Category · Company Name · First Name · Last Name · Duration · Time Range · Notes
 *   Line 6+ = data. Entity is the EMPLOYER (JFK&A / KFA), never the customer;
 *             the customer is Company Name (business) or First + Last Name (individual).
 *
 * Customers / employees are the integration fixture account 9001 (test/fixtures/seed.sql):
 *   Acme Corp (job) · Globex Industries (job) · Smith, John (job) · Smith, Jane (NO job) · Wayne Enterprises (NO job)
 *   Employees: Eliza Smith (90011, $75/h) · Bob Jones (90012, $90/h)
 *
 * Run:  node test/fixtures/buildTrackerFixtures.js
 * Produces:
 *   test/fixtures/timetrackers/clean.xlsx       (45 rows, every row resolvable -> auto-insert)
 *   test/fixtures/timetrackers/mixed.xlsx       (32 rows, 20 clean + known messy cases)
 *   test/fixtures/timetrackers/volume.xlsx      (600 rows, concurrency stress)
 *   test/fixtures/timetrackers/adversarial.xlsx (30 rows w/ PII in notes, resolvable customers)
 */
const path = require('path');
const ExcelJS = require('exceljs');

const OUTPUT_DIR = path.join(__dirname, 'timetrackers');

const HEADERS = ['Date', 'Entity', 'Category', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Time Range', 'Notes'];
const ENTITY_JKA = 'James F. Kimmel & Associates';
const ENTITY_KFA = 'Kimmel Financial Advisors';

const CUSTOMERS = Object.freeze({
   ACME: { company: 'Acme Corp' },
   GLOBEX: { company: 'Globex Industries' },
   JOHN_SMITH: { first: 'John', last: 'Smith' },
   JANE_SMITH: { first: 'Jane', last: 'Smith' },
   WAYNE: { company: 'Wayne Enterprises' }
});
const RESOLVABLE = [CUSTOMERS.ACME, CUSTOMERS.GLOBEX, CUSTOMERS.JOHN_SMITH];
const CATEGORIES = ['Tax Return Preparation', 'Monthly Services', 'Phone Call'];

const SERIAL_BASE = Date.UTC(1899, 11, 30);
const toSerial = isoDate => Math.round((Date.parse(`${isoDate}T00:00:00Z`) - SERIAL_BASE) / 86400000);

const _clock = minutes => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

const buildSheet = ({ employee, startDate, endDate, rows }) => {
   const wb = new ExcelJS.Workbook();
   const ws = wb.addWorksheet('Time');
   ws.getCell('A1').value = 'Employee Name';
   ws.getCell('B1').value = employee;
   ws.getCell('A2').value = 'Time Tracker Start Date';
   ws.getCell('B2').value = toSerial(startDate);
   ws.getCell('A3').value = 'Time Tracker End Date';
   ws.getCell('B3').value = toSerial(endDate);

   const headerRow = ws.getRow(5);
   HEADERS.forEach((header, i) => {
      headerRow.getCell(i + 1).value = header;
   });
   headerRow.font = { bold: true };
   headerRow.commit();

   let clockMinutes = 8 * 60;
   let lastDate = null;
   rows.forEach((row, i) => {
      if (row.date !== lastDate) {
         clockMinutes = 8 * 60;
         lastDate = row.date;
      }
      const customer = row.customer || {};
      const r = ws.getRow(6 + i);
      r.getCell(1).value = toSerial(row.date);
      r.getCell(1).numFmt = 'mm/dd/yyyy';
      r.getCell(2).value = row.entity || ENTITY_JKA;
      r.getCell(3).value = row.category;
      r.getCell(4).value = customer.company || '';
      r.getCell(5).value = customer.first || '';
      r.getCell(6).value = customer.last || '';
      r.getCell(7).value = row.duration;
      r.getCell(8).value = typeof row.duration === 'number' ? `${_clock(clockMinutes)}-${_clock(clockMinutes + row.duration)}` : '';
      r.getCell(9).value = row.notes;
      r.commit();
      if (typeof row.duration === 'number') clockMinutes += row.duration;
   });
   return wb;
};

const _pick = (arr, i) => arr[i % arr.length];
const WEEK = ['2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01'];
const CLEAN_NOTES = [
   'Prepared 1040 individual return and reviewed Schedule A and B',
   'Monthly bookkeeping reconciliation for bank and credit card accounts',
   'Client consultation on the tax projection for next quarter'
];

const buildClean = () => {
   const rows = [];
   for (let i = 0; i < 45; i++) {
      rows.push({
         date: WEEK[Math.floor(i / 9)],
         category: _pick(CATEGORIES, i),
         customer: _pick(RESOLVABLE, i),
         duration: [15, 30, 45, 60, 90][i % 5],
         notes: `${_pick(CLEAN_NOTES, i)} (item ${i + 1})`
      });
   }
   return buildSheet({ employee: 'Eliza Smith', startDate: '2026-04-27', endDate: '2026-05-01', rows });
};

// Messy rows and what the orchestrator must do with them (stubbed Bedrock):
const MIXED_MESSY = [
   { customer: { company: 'Brand New Co' }, category: 'Phone Call', duration: 60, notes: 'Initial onboarding meeting with prospective client', expect: 'no_matching_customer' },
   { customer: { company: 'Brand New Co' }, category: 'Phone Call', duration: 30, notes: 'Follow-up call about engagement letter', expect: 'no_matching_customer' },
   { customer: { company: 'Smith' }, category: 'Tax Return Preparation', duration: 45, notes: 'Worked on the Smith household return', expect: 'ambiguous_customer_match' },
   { customer: { company: 'Smith' }, category: 'Phone Call', duration: 15, notes: 'Returned call from the Smiths', expect: 'ambiguous_customer_match' },
   { customer: { company: 'Acmme Corp' }, category: 'Monthly Services', duration: 60, notes: 'Reconciled accounts payable subledger', expect: 'ambiguous_customer_match' },
   { customer: { company: 'Acmme Corp' }, category: 'Monthly Services', duration: 30, notes: 'Entered vendor bills', expect: 'ambiguous_customer_match' },
   { customer: CUSTOMERS.JANE_SMITH, category: 'Tax Return Preparation', duration: 90, notes: 'Prepared individual return', expect: 'missing_required_field' },
   { customer: CUSTOMERS.WAYNE, category: 'Monthly Services', duration: 60, notes: 'Reviewed payroll register', expect: 'missing_required_field' },
   { customer: CUSTOMERS.ACME, category: 'Administrative', duration: 30, notes: 'work', expect: 'ambiguous_category' },
   { customer: CUSTOMERS.GLOBEX, category: 'Administrative', duration: 15, notes: 'misc', expect: 'ambiguous_category' },
   { customer: CUSTOMERS.ACME, category: 'Vacation', duration: 480, notes: 'vacation day (approved)', expect: 'auto_insert_non_billable' },
   { customer: CUSTOMERS.GLOBEX, category: 'Tax Return Preparation', duration: 60, notes: 'Prepared 2025 Form 1120 draft', expect: 'auto_insert' }
];

const buildMixed = () => {
   const rows = [];
   for (let i = 0; i < 20; i++) {
      rows.push({
         date: WEEK[i % 5],
         entity: i % 4 === 0 ? ENTITY_KFA : ENTITY_JKA,
         category: _pick(CATEGORIES, i),
         customer: _pick(RESOLVABLE, i),
         duration: 30 + (i % 4) * 30,
         notes: i % 2 === 0 ? `Prepared 1040 return for client (${i + 1})` : `Bookkeeping reconciliation (${i + 1})`
      });
   }
   MIXED_MESSY.forEach((messy, i) => rows.push({ date: WEEK[(i + 1) % 5], ...messy }));
   return buildSheet({ employee: 'Bob Jones', startDate: '2026-04-27', endDate: '2026-05-01', rows });
};

const buildVolume = () => {
   const rows = [];
   for (let i = 0; i < 600; i++) {
      rows.push({
         date: WEEK[i % 5],
         category: _pick(CATEGORIES, i),
         customer: _pick(RESOLVABLE, i),
         duration: 30 + (i % 8) * 15,
         notes: `${i % 3 === 0 ? 'Prepared 1040 return' : i % 3 === 1 ? 'Bookkeeping reconciliation' : 'Client consultation'} #${i + 1}`
      });
   }
   return buildSheet({ employee: 'Eliza Smith', startDate: '2026-04-27', endDate: '2026-05-01', rows });
};

const ADVERSARIAL_NOTES = [
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

const buildAdversarial = () => {
   const rows = [];
   for (let i = 0; i < 30; i++) {
      rows.push({
         date: '2026-04-29',
         category: _pick(CATEGORIES, i),
         customer: _pick(RESOLVABLE, i),
         duration: 60,
         notes: `${_pick(ADVERSARIAL_NOTES, i)} [${i + 1}]`
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

module.exports = {
   buildClean,
   buildMixed,
   buildVolume,
   buildAdversarial,
   buildSheet,
   toSerial,
   HEADERS,
   CUSTOMERS,
   MIXED_MESSY,
   ENTITY_JKA,
   ENTITY_KFA
};
