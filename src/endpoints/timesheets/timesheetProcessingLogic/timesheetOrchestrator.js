const path = require('path');
const { validateAndTransformTimesheet } = require('./validateAndTransformTimesheet');
const { listFiles, readFile, writeFile, deleteFile, moveFile, appendErrorToFile } = require('./sharedTimesheetFunctions');
const { TIMESHEETS_PENDING_DIR, TIMESHEETS_PROCESSING_DIR, TIMESHEETS_PROCESSED_DIR, TIMESHEETS_ERROR_DIR } = require('../../../../config');

/**
 * Wrap a function with error handling
 * @param {*} fn - Function to wrap
 * @param  {...any} args - Arguments to pass to the function
 * @returns {Promise<any>} - Promise that resolves with the result of the function or rejects with an error message
 */
const withErrorHandling = async (fn, ...args) => {
   try {
      return await fn(...args);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error in ${fn.name}: ${err.message}`);
      // Rethrow to allow higher-level handling if needed
      throw err;
   }
};

/**
 * Process a single timesheet file
 * @param {*} timesheetName - Name of the timesheet
 * @returns {Promise<{entries: any[], timesheet_name: string} | {timesheet_name: string, error: boolean, error_message: string, account_id: number}>}
 */
const handleFileProcessing = async timesheetName => {
   const pendingPath = path.win32.join(TIMESHEETS_PENDING_DIR, timesheetName);
   const processingPath = path.win32.join(TIMESHEETS_PROCESSING_DIR, timesheetName);
   const processedPath = path.win32.join(TIMESHEETS_PROCESSED_DIR, timesheetName);
   const errorPath = path.win32.join(TIMESHEETS_ERROR_DIR, timesheetName);

   console.log(`[${new Date().toISOString()}] Starting on timesheet: "${timesheetName}"`);

   try {
      // Move the file to processing from pending
      await withErrorHandling(moveFile, pendingPath, processingPath, timesheetName, 'processing', 'pending');

      // Process the timesheet
      const entries = await withErrorHandling(validateAndTransformTimesheet, timesheetName, processingPath);

      // Move the file to processed from processing
      await withErrorHandling(moveFile, processingPath, processedPath, timesheetName, 'processed', 'processing');

      console.log(`[${new Date().toISOString()}] File: "${timesheetName}" completed successfully.`);
      return { entries, timesheet_name: timesheetName }; // Return entries as an array
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Critical error in "${timesheetName}": ${err.message}`);

      // Handle error by creating an error file
      await handleErrorFile(processingPath, errorPath, timesheetName, err.message);
      const account_id = 1;
      return { timesheet_name: timesheetName, error: true, error_message: err.message, account_id };
   }
};

/**
 * Handle errors in processing by creating an error excel file, placing in the error directory, and deleting the processing file
 * @param {*} processingPath - Path to the processing file
 * @param {*} errorPath - Path to the error file
 * @param {*} timesheetName - Name of the timesheet
 * @param {*} errorReason - Reason for the error
 * @returns {Promise<void>} - Promise that resolves when the error file is created
 */
const handleErrorFile = async (processingPath, errorPath, timesheetName, errorReason) => {
   try {
      const updatedFileData = appendErrorToFile(await withErrorHandling(readFile, processingPath, timesheetName), `Processing error: ${errorReason}`, timesheetName);
      await withErrorHandling(writeFile, errorPath, updatedFileData, 'error directory', timesheetName);
      await withErrorHandling(deleteFile, processingPath, 'processing', timesheetName);
      console.log(`[${new Date().toISOString()}] Error file created for "${timesheetName}".`);
   } catch (innerErr) {
      console.error(`[${new Date().toISOString()}] Failed to handle error for "${timesheetName}": ${innerErr.message}`);
   }
};

/**
 * Orchestrator, process all timesheets in the pending directory
 * @returns {Promise<{timesheetEntries: any[], timesheetErrors: {timesheet_name: string, error_message: string, account_id: number}[]}>}
 */
const processFiles = async () => {
   console.log(`[${new Date().toISOString()}] Starting timesheet processing...`);
   try {
      const files = await withErrorHandling(listFiles, TIMESHEETS_PENDING_DIR);
      console.log(`[${new Date().toISOString()}] Found ${files.length} timesheets:`, files);

      const results = await Promise.all(files.map(handleFileProcessing));

      // Separate successful timesheets and errors
      const successfulEntries = results.filter(result => !result.error).flatMap(timesheet => timesheet.entries);

      const errorDetails = results.filter(result => result.error).map(({ timesheet_name, error_message, account_id }) => ({ timesheet_name, error_message, account_id }));

      return {
         timesheetEntries: successfulEntries,
         timesheetErrors: errorDetails
      };
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error accessing file share: ${err.message}`);
      return { timesheetEntries: [], timesheetErrors: [] };
   }
};

module.exports = {
   processFiles
};
