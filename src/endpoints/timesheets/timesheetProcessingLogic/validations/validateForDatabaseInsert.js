const { readFile, writeFile } = require('../utils');
const path = require('path');
const { TIMESHEETS_ERROR_DIR } = require('../../../../../config');

const SUCCESS_REQUIRED_FIELDS = ['employee_name', 'time_tracker_start_date', 'time_tracker_end_date', 'account_id', 'timesheet_name'];
const ERROR_REQUIRED_FIELDS = ['error_message', 'time_tracker_start_date', 'time_tracker_end_date', 'account_id', 'timesheet_name'];

/**
 * Handles invalid errors by saving the file in the error directory and logging the reason
 * @param {Object} invalidError - The invalid error object
 * @param {string} invalidReason - Reason why the error is invalid
 * @param {string} processingPath - Path to the processing file
 * @returns {Object} - The invalid error object with additional information
 */
const handleInvalidError = async (invalidError, invalidReason, processingPath) => {
   const errorFilePath = path.join(TIMESHEETS_ERROR_DIR, invalidError.timesheet_name);

   try {
      const fileData = await readFile(processingPath, invalidError.timesheet_name);
      await writeFile(errorFilePath, fileData, invalidError.timesheet_name);
      console.log(`[${new Date().toISOString()}] Invalid error file saved for "${invalidError.timesheet_name}" with reason: ${invalidReason}`);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Failed to save invalid error file for "${invalidError.timesheet_name}": ${err.message}`);
   }

   return { ...invalidError, invalid_reason: invalidReason };
};

/**
 * Categorizes results into valid success, invalid success, valid errors, and invalid errors
 * @param {Array<Object>} results - List of entries to validate
 * @param {string} processingPath - Path to the processing directory
 * @returns {Object} - Categorized entries
 */
const validateForDatabaseInsert = async (results, processingPath) => {
   const validSuccess = [];
   const invalidSuccess = [];
   const validErrors = [];
   const invalidErrors = [];

   console.log(`[${new Date().toISOString()}] === Running Validation for Database Insert ===`);

   await Promise.all(
      results.map(async result => {
         if (!result.error_message) {
            // Handle success entries
            const isValidSuccess = SUCCESS_REQUIRED_FIELDS.every(field => result[field] !== undefined && result[field] !== null);
            if (isValidSuccess) {
               validSuccess.push(result);
            } else {
               invalidSuccess.push({ ...result, invalid_reason: 'Missing required fields in success entry' });
            }
         } else {
            // Handle error entries
            const isValidError = ERROR_REQUIRED_FIELDS.every(field => result[field] !== undefined && result[field] !== null && result[field] !== '');
            if (isValidError) {
               validErrors.push(result);
            } else {
               const invalidError = await handleInvalidError(result, result.error_message, processingPath);
               invalidErrors.push(invalidError);
            }
         }
      })
   );

   console.log(`[${new Date().toISOString()}] === Validation for Database Insert Completed ===`);

   return { validSuccess, invalidSuccess, validErrors, invalidErrors };
};

module.exports = validateForDatabaseInsert;
