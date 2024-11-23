const dayjs = require('dayjs');
const xlsx = require('xlsx');
const { readFile, toCamelCase } = require('./csvSharedFunctions');

const processTimesheet = async (timesheetName, processingPath, ALLOWED_HEADERS) => {
   console.log(`[${new Date().toISOString()}] Started processing "${timesheetName}".`);
   const fileData = await readFile(processingPath, timesheetName);
   const workbook = xlsx.read(fileData);
   const sheetName = workbook.SheetNames[0];
   const sheet = workbook.Sheets[sheetName];
   const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

   const validRows = rows.filter(row => row.some(cell => cell !== null && cell !== undefined && cell.toString().trim() !== ''));
   let originalHeaders = validRows[0];

   if (validRows.length <= 1) {
      throw new Error('File contains no valid data rows.');
   }

   // Ensure minimum headers
   const allHeaders = [...new Set([...originalHeaders, ...ALLOWED_HEADERS])];

   const entries = validRows.slice(1).map(row =>
      allHeaders.reduce((entry, header) => {
         // Convert header to camelCase
         const camelCaseHeader = toCamelCase(header);
         const columnIndex = originalHeaders.indexOf(header);
         // Add empty string for missing headers
         let value = columnIndex !== -1 ? row[columnIndex] : '';

         // Validate the cell value
         value = validateCellValue(header, value);

         entry[camelCaseHeader] = value;
         return entry;
      }, {})
   );

   const timePeriodStart = entries[0]?.date || null;
   const timePeriodEnd = entries.at(-1)?.date || null;

   console.log(`[${new Date().toISOString()}] Completed processing "${timesheetName}".`);
   return { timePeriod: `${timePeriodStart}_${timePeriodEnd}`, entries, sheetName, allHeaders };
};

/**
 * Validates the value of a row cell based on the header
 * @param {*} header The header of the cell
 * @param {*} value The value of the cell
 * @returns The validated value
 */
const validateCellValue = (header, value) => {
   switch (header) {
      case 'Date':
         if (typeof value === 'number') {
            value = dayjs(new Date(Math.round((value - 25569 + 1) * 86400 * 1000))).format('YYYY-MM-DD');
         } else if (typeof value === 'string' && dayjs(value).isValid()) {
            value = dayjs(value).format('YYYY-MM-DD');
         } else if (!dayjs(value).isValid()) {
            throw new Error(`Invalid value in "Date" column: "${value}" is not a valid date.`);
         }
         break;

      case 'Duration':
         if (typeof value !== 'number') {
            throw new Error(`Invalid value in "Duration" column: "${value}" is not a number, whole numbers only. Only enter minutes.`);
         }
         break;

      // Add other header-specific validations here
      default:
         // No validation for other headers currently
         break;
   }

   return value;
};

module.exports = {
   processTimesheet
};
