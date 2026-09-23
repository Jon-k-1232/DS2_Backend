/**
 * Shared CSV cell helpers for the report exports (Analytics, Accounts
 * Receivable, year-end packet).
 *
 * csvCell(value) — one RFC 4180 cell:
 *   - null / undefined → empty cell;
 *   - finite numbers are written as-is (NaN / ±Infinity → empty);
 *   - Dates → ISO timestamp (use csvDate for date-only columns);
 *   - FORMULA INJECTION: a STRING that a spreadsheet would evaluate as a
 *     formula — first character '=', '+', '-', '@', TAB or CR — is prefixed
 *     with a single quote so Excel / Sheets / LibreOffice show it as text
 *     (OWASP "CSV Injection"). Customer names, notes and work descriptions are
 *     user-entered, so '=HYPERLINK(…)' in a display name must not execute.
 *   - NUMERIC GUARD: numeric strings are never prefixed — node-postgres returns
 *     NUMERIC columns as strings ('-225.00'), and a negative amount must stay a
 *     number in the spreadsheet;
 *   - cells containing a double quote, comma, CR or LF are wrapped in double
 *     quotes with embedded quotes doubled.
 *
 * csvDate(value) — date-only cell as YYYY-MM-DD ('' when empty/invalid).
 * String(dateObject).slice(0, 10) yields 'Tue Mar 01', not a date.
 */
const dayjs = require('dayjs');

const NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",\r\n]/;

const isNumericString = s => NUMERIC_STRING.test(s);

const csvCell = value => {
   if (value === null || value === undefined) return '';
   if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
   if (typeof value === 'bigint') return String(value);
   if (typeof value === 'boolean') return value ? 'true' : 'false';

   let s;
   if (value instanceof Date) {
      s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
   } else {
      s = String(value);
   }

   if (FORMULA_TRIGGER.test(s) && !isNumericString(s)) s = `'${s}`;
   return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csvDate = value => {
   if (value === null || value === undefined || value === '') return '';
   if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
   const d = dayjs(value);
   return d.isValid() ? d.format('YYYY-MM-DD') : '';
};

/** One CSV line from an array of raw cell values. */
const csvRow = cells => cells.map(csvCell).join(',');

module.exports = { csvCell, csvDate, csvRow, isNumericString };
