const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const { HEADER_CONFIG } = require('./csvHeaderPropertyConfig');

dayjs.extend(utc); // Extend Day.js to handle UTC dates

/**
 * Validate a field based on its header and type
 * @param {*} header - The field header
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

   if (!allowEmpty && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required value in column "${header}" at row ${rowIndex}`);
   }

   switch (type) {
      case 'date':
         if (value) {
            // Handle both Excel serialized dates and regular date strings
            const parsedDate = !isNaN(value)
               ? dayjs.utc((value - 25569) * 86400 * 1000) // Treat Excel serialized date as UTC
               : dayjs(value); // String or other date format

            if (!parsedDate.isValid()) {
               throw new Error(`Invalid date value in column "${header}" at row ${rowIndex}`);
            }
            return parsedDate.format('MM/DD/YYYY'); // Ensure consistent MM/DD/YYYY format
         }
         break;

      case 'int':
         if (value !== undefined && value !== null) {
            const intValue = parseInt(value, 10);
            if (isNaN(intValue)) {
               throw new Error(`Invalid integer value in column "${header}" at row ${rowIndex}`);
            }
            return intValue;
         }
         break;

      case 'string':
         if (value && typeof value !== 'string') {
            throw new Error(`Invalid string value in column "${header}" at row ${rowIndex}`);
         }
         return value?.trim() || '';

      default:
         throw new Error(`Unknown field type "${type}" for column "${header}" at row ${rowIndex}`);
   }

   return value;
};

module.exports = { validateField };
