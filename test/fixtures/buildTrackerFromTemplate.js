/* eslint-disable no-console */
/**
 * Build a dummy time tracker from the REAL template (the file the app serves from
 * S3 `time_tracking/tracker_versions/` — locally mirrored in MinIO, or fetched via
 * GET /time-tracking/template/latest). Layout (sheet 'Time'):
 *   B1 = employee display name, B2 = tracker start date, B3 = tracker end date,
 *   row 5 headers: Date | Entity | Category | Company Name | First Name | Last Name | Duration | Time Range | Notes
 *   data from row 6. Duration is MINUTES. Company Name is the customer (or the
 *   firm's own entity for internal time); First/Last Name are used for individuals.
 *
 * Usage (module):
 *   const { buildTrackerFromTemplate } = require('./buildTrackerFromTemplate');
 *   const buffer = buildTrackerFromTemplate({ templateBuffer, employeeName: 'Eliza Smith',
 *      startDate: '2026-09-14', endDate: '2026-09-19', rows: [{ date: '2026-09-14', entity: 'James F. Kimmel & Associates',
 *      category: '2025 Individual Tax Return', companyName: 'Acme Corp', duration: 45, timeRange: '0900-0945', notes: 'prepared 1040' }] });
 *
 * Usage (CLI): node test/fixtures/buildTrackerFromTemplate.js <template.xlsx> <out.xlsx> [rows.json]
 *
 * SheetJS drops the template's data-validation dropdowns on write; that does not
 * matter for upload testing (the server only reads cell values) but such a file
 * must never be re-uploaded as a template version.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const dayjs = require('dayjs');

const HEADERS = ['Date', 'Entity', 'Category', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Time Range', 'Notes'];
const fmtDate = d => (d ? dayjs(d).format('M/D/YY') : '');

const buildTrackerFromTemplate = ({ templateBuffer, templatePath, employeeName, startDate, endDate, rows = [], sheetName = 'Time' }) => {
   const wb = templateBuffer ? XLSX.read(templateBuffer, { type: 'buffer', cellStyles: true }) : XLSX.readFile(templatePath, { cellStyles: true });
   const ws = wb.Sheets[sheetName];
   if (!ws) throw new Error(`Template has no '${sheetName}' sheet (sheets: ${wb.SheetNames.join(', ')})`);

   const setCell = (addr, value) => {
      if (value === undefined || value === null || value === '') {
         delete ws[addr];
         return;
      }
      ws[addr] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) };
   };

   setCell('B1', employeeName);
   setCell('B2', fmtDate(startDate));
   setCell('B3', fmtDate(endDate));
   HEADERS.forEach((h, i) => setCell(XLSX.utils.encode_cell({ r: 4, c: i }), h));

   rows.forEach((row, i) => {
      const r = 5 + i;
      const values = [
         fmtDate(row.date),
         row.entity ?? '',
         row.category ?? '',
         row.companyName ?? '',
         row.firstName ?? '',
         row.lastName ?? '',
         row.duration === undefined || row.duration === null || row.duration === '' ? '' : Number(row.duration),
         row.timeRange ?? '',
         row.notes ?? ''
      ];
      values.forEach((v, c) => setCell(XLSX.utils.encode_cell({ r, c }), v));
   });

   // Clear any leftover rows below the data we wrote and reset the range.
   const lastRow = 5 + Math.max(rows.length, 1);
   const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:I6');
   for (let r = lastRow; r <= range.e.r; r += 1) {
      for (let c = 0; c < HEADERS.length; c += 1) delete ws[XLSX.utils.encode_cell({ r, c })];
   }
   ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(lastRow - 1, 5), c: HEADERS.length - 1 } });

   return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

/** Read the data rows back (mirrors what the server parses) — handy for asserting round-trips. */
const readTrackerRows = buffer => {
   const wb = XLSX.read(buffer, { type: 'buffer' });
   const ws = wb.Sheets.Time;
   const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
   return {
      employeeName: grid[0]?.[1] || '',
      startDate: grid[1]?.[1] || '',
      endDate: grid[2]?.[1] || '',
      headers: grid[4] || [],
      rows: grid.slice(5).filter(r => r.some(c => String(c).trim() !== ''))
   };
};

module.exports = { buildTrackerFromTemplate, readTrackerRows, HEADERS };

if (require.main === module) {
   const [templatePath, outPath, rowsJson] = process.argv.slice(2);
   if (!templatePath || !outPath) {
      console.log('usage: node test/fixtures/buildTrackerFromTemplate.js <template.xlsx> <out.xlsx> [rows.json]');
      process.exit(1);
   }
   const spec = rowsJson ? JSON.parse(fs.readFileSync(rowsJson, 'utf8')) : { employeeName: 'Eliza Smith', startDate: '2026-09-14', endDate: '2026-09-19', rows: [] };
   fs.writeFileSync(outPath, buildTrackerFromTemplate({ templatePath, ...spec }));
   console.log(`wrote ${outPath} (${spec.rows.length} rows)`);
}
