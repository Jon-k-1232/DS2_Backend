const dayjs = require('dayjs');
const isBetween = require('dayjs/plugin/isBetween');
const xlsx = require('xlsx');
const { readFile, toSnakeCase } = require('./sharedTimesheetFunctions');

dayjs.extend(isBetween);

// Combined header configuration with expected data types
const HEADER_CONFIG = {
   Date: { snakeCase: 'date', type: 'date', allowEmpty: false },
   Entity: { snakeCase: 'entity', type: 'string', allowEmpty: true },
   Category: { snakeCase: 'category', type: 'string', allowEmpty: true },
   'Employee Name': { snakeCase: 'employee_name', type: 'string', allowEmpty: false },
   'Company Name': { snakeCase: 'company_name', type: 'string', allowEmpty: true },
   'First Name': { snakeCase: 'first_name', type: 'string', allowEmpty: true },
   'Last Name': { snakeCase: 'last_name', type: 'string', allowEmpty: true },
   Duration: { snakeCase: 'duration', type: 'int', allowEmpty: false },
   Notes: { snakeCase: 'notes', type: 'string', allowEmpty: false }
};

const ALLOWED_HEADERS = Object.keys(HEADER_CONFIG);

/**
 * Checks if a date is within the range of one month ago to one week from today.
 * @param {*} date The date to check.
 * @returns {boolean}  True if the date is within the range, false otherwise.
 */
const isDateInRange = date => {
   const dateToCheck = dayjs(date);
   const oneMonthAgo = dayjs().subtract(1, 'month');
   const oneWeekFromToday = dayjs().add(1, 'week');
   return dateToCheck.isBetween(oneMonthAgo, oneWeekFromToday, 'day', '[]');
};

/**
 * Validates the value of a row cell based on the header.
 * @param {*} header The header of the cell.
 * @param {*} value The value of the cell.
 * @param {*} rowIndex The current row index (1-based).
 * @returns The validated value.
 */
const validateCellValue = (header, value, rowIndex) => {
   switch (header) {
      case 'Date':
         if (typeof value === 'string' && value.startsWith('ERROR DETECTED')) {
            throw new Error(`Error message found in the "Date" column at row ${rowIndex}. Please remove it.`);
         }

         if (typeof value === 'number') {
            value = dayjs(new Date(Math.round((value - 25569 + 1) * 86400 * 1000))).format('MM/DD/YYYY');
         } else if (typeof value === 'string' && dayjs(value).isValid()) {
            value = dayjs(value).format('MM/DD/YYYY');
         } else if (!dayjs(value).isValid()) {
            throw new Error(`Invalid date value in "Date" column at row ${rowIndex}. Value: "${value}"`);
         }

         if (!isDateInRange(value)) {
            throw new Error(`Date value in "Date" column at row ${rowIndex} is not within the expected range. Value: "${value}"`);
         }
         break;

      case 'Duration':
         if (typeof value !== 'number') {
            throw new Error(`Invalid duration value in "Duration" column at row ${rowIndex}. Value must be a whole number (minutes). Value: "${value}"`);
         }
         break;

      default:
         break;
   }

   return value;
};

/**
 * Handles data type conversion for specific headers.
 * @param {string} header The column header.
 * @param {any} value The cell value.
 * @param {number} rowIndex The current row index (1-based).
 * @returns {any} The value converted to the expected data type.
 */
function handleDataType(header, value, rowIndex) {
   const config = HEADER_CONFIG[header];
   const expectedType = config?.type;
   const allowEmpty = config?.allowEmpty;

   switch (expectedType) {
      case 'date':
         // Convert serialized number to a readable date format
         const dateValue = dayjs(new Date(Math.round((value - 25569 + 1) * 86400 * 1000))).format('YYYY/MM/DD');
         if (!dayjs(value).isValid()) {
            throw new Error(`Invalid date value in column "${header}" at row ${rowIndex}. Value: "${value}"`);
         }
         // Format the valid date directly
         return dateValue;

      case 'int':
         const intValue = parseInt(value, 10);
         if (isNaN(intValue)) {
            throw new Error(`Invalid integer value in column "${header}" at row ${rowIndex}. Value: "${value}"`);
         }
         return intValue;

      case 'string':
         if (!allowEmpty && (value === undefined || value === null || value.toString().trim() === '')) {
            throw new Error(`Invalid string value in column "${header}" at row ${rowIndex}. Value cannot be empty.`);
         }
         return value?.toString() || '';

      default:
         // If no type is defined, return the value as-is
         return value;
   }
}

/**
 * Validates and transforms a timesheet file into a list of timesheet entries.
 * @param {*} timesheetName Name of the timesheet file.
 * @param {*} processingPath Path to the timesheet file.
 * @returns {Promise<{timePeriod: string, entries: any[]}>} Object containing the time period and list of timesheet entries.
 */
const validateAndTransformTimesheet = async (timesheetName, processingPath) => {
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

   // Filter original headers to include only allowed headers
   const filteredHeaders = originalHeaders.filter(header => ALLOWED_HEADERS.includes(header));

   const entries = validRows.slice(1).map((row, index) => {
      const entry = filteredHeaders.reduce((entry, header) => {
         const config = HEADER_CONFIG[header] || {};
         const snakeCaseHeader = config.snakeCase || toSnakeCase(header);
         const columnIndex = originalHeaders.indexOf(header);
         let value = columnIndex !== -1 ? row[columnIndex] : '';

         // Process the value based on its expected data type
         value = handleDataType(header, value, index + 2);

         // Validate the cell value, passing the row number (index + 2 to account for 1-based Excel rows and skipping the header row)
         value = validateCellValue(header, value, index + 2);

         entry[snakeCaseHeader] = value;
         return entry;
      }, {});

      // Add timesheet name
      entry.timesheet_name = timesheetName;
      // Add default account ID
      entry.account_id = 1;
      return entry;
   });

   console.log(`[${new Date().toISOString()}] Completed processing "${timesheetName}".`);
   return entries;
};

module.exports = {
   validateAndTransformTimesheet
};
