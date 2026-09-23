const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const { HEADER_CONFIG } = require('./csvHeaderPropertyConfig');
const { parseDurationMinutes } = require('./parseDuration');

dayjs.extend(utc); // Extend Day.js to handle UTC dates

/**
 * Spreadsheet cells arrive typed (a Category of 1099 or Notes of "1040" come
 * through as numbers). Text columns are coerced to trimmed strings instead of
 * being rejected — or crashing later on `.toLowerCase()` / `.trim()`.
 * @param {*} value
 * @returns {string}
 */
const cellToString = value => {
   if (value === undefined || value === null) return '';
   if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : dayjs(value).format('MM/DD/YYYY');
   return String(value).trim();
};

/**
 * Validate a field based on its header and type
 * @param {*} header - The field header (canonical HEADER_CONFIG name)
 * @param {*} value - The field value
 * @param {*} rowIndex - The row index
 * @returns {*} The validated field value
 */
const validateField = (header, value, rowIndex) => {
   const config = HEADER_CONFIG[header];

   if (!config) {
      throw new Error(`Unexpected header "${header}" at row ${rowIndex}`);
   }

   const { type, allowEmpty } = config;
   const normalizedValue = typeof value === 'string' ? value.trim() : value;
   const isEmpty = normalizedValue === undefined || normalizedValue === null || normalizedValue === '';

   if (!allowEmpty && isEmpty) {
      throw new Error(`Missing required value in column "${header}" at row ${rowIndex}`);
   }

   switch (type) {
      case 'date':
         if (!isEmpty) {
            // Handle both Excel serialized dates and regular date strings
            const parsedDate = !isNaN(normalizedValue)
               ? dayjs.utc((normalizedValue - 25569) * 86400 * 1000) // Treat Excel serialized date as UTC
               : dayjs(normalizedValue); // String or other date format

            if (!parsedDate.isValid()) {
               throw new Error(`Invalid date value in column "${header}" at row ${rowIndex}`);
            }
            return parsedDate.format('MM/DD/YYYY'); // Ensure consistent MM/DD/YYYY format
         }
         break;

      case 'duration':
         if (isEmpty) return null;
         try {
            return parseDurationMinutes(normalizedValue);
         } catch (err) {
            throw new Error(`${err.message} (column "${header}" at row ${rowIndex})`);
         }

      case 'int':
         if (!isEmpty) {
            const numeric = Number(normalizedValue);
            if (!Number.isInteger(numeric)) {
               throw new Error(`Invalid integer value in column "${header}" at row ${rowIndex}`);
            }
            return numeric;
         }
         break;

      case 'string':
         return cellToString(value);

      default:
         throw new Error(`Unknown field type "${type}" for column "${header}" at row ${rowIndex}`);
   }

   return value;
};

module.exports = { validateField, cellToString };
