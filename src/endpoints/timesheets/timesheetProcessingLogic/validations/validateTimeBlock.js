const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { validateField, cellToString } = require('./validateField');
const { validateNameFields } = require('./validateNameFields');
const { HEADER_CONFIG, resolveHeaderColumns, describeHeaderProblems } = require('./csvHeaderPropertyConfig');
const { detectNonWorkReason, isLunchBreakCategory } = require('../../../../timeTrackerValidation/nonWorkEntries');

dayjs.extend(customParseFormat);

// Entries may start this many days before the tracker's Start Date (late
// stragglers from the previous period) but never after its End Date or today.
const ENTRY_DATE_LOOKBACK_DAYS = Number(process.env.TRACKER_ENTRY_LOOKBACK_DAYS || 7);
const META_DATE_FORMATS = ['MM-DD-YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

const _parseStrictDate = value => {
   if (!value) return null;
   if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : dayjs(value).startOf('day');
   const parsed = dayjs(String(value).trim(), META_DATE_FORMATS, true);
   return parsed.isValid() ? parsed.startOf('day') : null;
};

/**
 * Allowed entry-date range for a tracker: [start - LOOKBACK, min(end, today)].
 * Returns null when the tracker window itself is unknown (the name-block
 * validator reports that separately).
 */
const computeEntryDateWindow = (metadata = {}, today = new Date()) => {
   const start = _parseStrictDate(metadata && metadata.startDate);
   const end = _parseStrictDate(metadata && metadata.endDate);
   if (!start || !end) return null;
   const todayDay = dayjs(today).startOf('day');
   const earliest = start.subtract(ENTRY_DATE_LOOKBACK_DAYS, 'day');
   const latest = end.isBefore(todayDay) ? end : todayDay;
   return { earliest, latest };
};

const _isBlankRow = row => !Array.isArray(row) || row.every(cell => cell === null || cell === undefined || cell.toString().trim() === '');

/**
 * Validate the time block (Rows 5 and onward)
 * @param {Array[]} rows - Data rows below the header (sheet line 6 onward)
 * @param {string[]} originalHeaders - Raw header cells (sheet line 5)
 * @param {Object} metadata - Metadata from the name block validation
 * @param {{ today?: Date, firstRow?: number }} [options] `firstRow` is the
 *   spreadsheet line number of `rows[0]` (default 6, the first data row below
 *   the header) — callers validating a single extracted row in isolation
 *   (validateUploadedTracker.gatherTimeBlockValidation) pass the row's real
 *   position so error messages still name the correct sheet line.
 * @returns {Object[]} - Array of validated entries. Each carries `source_row`
 *   (spreadsheet line number) and `non_work_reason` (null for client work);
 *   neither is a DB column.
 * @throws {Error} - If validation fails (message names the row)
 */
const validateTimeBlock = (rows, originalHeaders, metadata, { today = new Date(), firstRow = 6 } = {}) => {
   const { employeeName } = metadata || {};

   const headerProblems = describeHeaderProblems(originalHeaders);
   if (headerProblems.length) {
      throw new Error(headerProblems.join(' '));
   }
   const { columns } = resolveHeaderColumns(originalHeaders);
   const categoryColumn = columns.find(c => c.header === 'Category');
   const window = computeEntryDateWindow(metadata, today);

   return rows
      .map((row, index) => {
         const rowIndex = index + firstRow;

         if (_isBlankRow(row)) return null;

         // Lunch breaks are not time worked; dropped as before (now robust to
         // case/whitespace and to non-string cells).
         if (categoryColumn && isLunchBreakCategory(cellToString(row[categoryColumn.index]))) {
            return null;
         }

         const entry = { employee_name: employeeName };

         columns.forEach(({ index: colIndex, header }) => {
            try {
               entry[HEADER_CONFIG[header].snakeCase] = validateField(header, row[colIndex], rowIndex);
            } catch (error) {
               throw new Error(`Error validating column "${header}" at row ${rowIndex}: ${error.message}`);
            }
         });

         validateNameFields(entry, rowIndex);

         if (window && entry.date) {
            const entryDate = dayjs(entry.date, 'MM/DD/YYYY', true);
            if (!entryDate.isValid() || entryDate.isBefore(window.earliest) || entryDate.isAfter(window.latest)) {
               throw new Error(
                  `Date "${entry.date}" at row ${rowIndex} is outside the allowed range ${window.earliest.format('MM/DD/YYYY')} to ${window.latest.format('MM/DD/YYYY')}. ` +
                     `Entries may be dated up to ${ENTRY_DATE_LOOKBACK_DAYS} days before the tracker Start Date (B2), and never after the End Date (B3) or today.`
               );
            }
         }

         entry.source_row = rowIndex;
         entry.non_work_reason = detectNonWorkReason(entry);
         return entry;
      })
      .filter(entry => entry !== null);
};

module.exports = validateTimeBlock;
module.exports.computeEntryDateWindow = computeEntryDateWindow;
module.exports.ENTRY_DATE_LOOKBACK_DAYS = ENTRY_DATE_LOOKBACK_DAYS;
