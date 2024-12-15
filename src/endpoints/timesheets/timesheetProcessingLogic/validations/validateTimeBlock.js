const { validateField } = require('./validateField');
const { validateNameFields } = require('./validateNameFields');
const { HEADER_CONFIG } = require('./csvHeaderPropertyConfig');

/**
 * Validate the time block (Rows 5 and onward)
 * @param {Array[]} rows - Rows from the lower section of the timesheet
 * @param {string[]} originalHeaders - Headers of the time block
 * @param {Object} metadata - Metadata from the name block validation
 * @param {Object} employeeLookup - A mapping of employee names to their records
 * @param {string} timesheetName - Name of the timesheet
 * @param {number} accountID - Account ID for context
 * @returns {Object[]} - Array of validated entries
 * @throws {Error} - If validation fails
 */
const validateTimeBlock = (rows, originalHeaders, metadata) => {
   const { employeeName } = metadata;

   return rows
      .map((row, index) => {
         const rowIndex = index + 6;

         // Skip blank rows
         if (row.every(cell => cell === null || cell === undefined || cell.toString().trim() === '')) {
            return null;
         }

         // Skip rows where the category is "Lunch"
         const categoryIndex = originalHeaders.indexOf('Category');
         if (categoryIndex >= 0 && row[categoryIndex]?.toLowerCase() === 'lunch') {
            return null;
         }

         const entry = { employee_name: employeeName };

         originalHeaders.forEach((header, colIndex) => {
            if (!HEADER_CONFIG[header]) return;

            const value = row[colIndex];
            const fieldName = HEADER_CONFIG[header].snakeCase;

            try {
               const validatedValue = validateField(header, value, rowIndex);
               entry[fieldName] = validatedValue;
            } catch (error) {
               throw new Error(`Error validating column "${header}" at row ${rowIndex}: ${error.message}`);
            }
         });

         validateNameFields(entry, rowIndex);

         return entry;
      })
      .filter(entry => entry !== null);
};

module.exports = validateTimeBlock;
