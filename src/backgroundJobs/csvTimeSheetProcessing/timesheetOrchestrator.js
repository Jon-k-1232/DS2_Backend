const path = require('path');
const { processTimesheet } = require('./processTimesheet');
const { formatSpreadsheet } = require('./spreadSheetFormatting');
const { listFiles, readFile, writeFile, deleteFile, moveFile, appendErrorToFile } = require('./csvSharedFunctions');
const { TIMESHEETS_PENDING_DIR, TIMESHEETS_PROCESSING_DIR, TIMESHEETS_PROCESSED_DIR, TIMESHEETS_ERROR_DIR } = require('../../../config');

// Allowed headers that must exist in the file
const ALLOWED_HEADERS = ['Date', 'Entity', 'Category', 'Employee Name', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Notes'];

const processFiles = async () => {
   console.log(`[${new Date().toISOString()}] Starting timesheet processing...`);
   try {
      const files = await listFiles(TIMESHEETS_PENDING_DIR);
      console.log(`[${new Date().toISOString()}] Found ${files.length} timesheets:`, files);

      const results = await Promise.all(
         files.map(async timesheetName => {
            const pendingPath = path.win32.join(TIMESHEETS_PENDING_DIR, timesheetName);
            const processingPath = path.win32.join(TIMESHEETS_PROCESSING_DIR, timesheetName);
            const processedPath = path.win32.join(TIMESHEETS_PROCESSED_DIR, timesheetName);
            const errorPath = path.win32.join(TIMESHEETS_ERROR_DIR, timesheetName);
            try {
               console.log(`[${new Date().toISOString()}] Starting on timesheet: "${timesheetName}"`);
               // Move the files from the pending file to processing file
               await moveFile(pendingPath, processingPath, timesheetName, 'processing', 'pending');
               const { timePeriod, entries, sheetName, allHeaders } = await processTimesheet(timesheetName, processingPath, ALLOWED_HEADERS);
               const processedFileData = formatSpreadsheet(entries, allHeaders, sheetName, timesheetName);
               // Write the processed file to the processed file directory
               await writeFile(processedPath, processedFileData, 'processed', timesheetName);
               // Delete the file from the processing directory
               await deleteFile(processingPath, 'processing', timesheetName);
               console.log(`[${new Date().toISOString()}] File: "${timesheetName}" completed successfully.`);
               return { timesheetName, timePeriod, entries };
            } catch (err) {
               console.error(`[${new Date().toISOString()}] Critical error in "${timesheetName}": ${err.message}`);
               try {
                  const errorReason = `Processing error: ${err.message}`;
                  const updatedFileData = appendErrorToFile(await readFile(processingPath), errorReason, timesheetName);
                  await writeFile(errorPath, updatedFileData, 'error directory', timesheetName);
                  await deleteFile(processingPath, 'current directory', timesheetName);
                  console.log(`[${new Date().toISOString()}] Error file created for "${timesheetName}".`);
               } catch (innerErr) {
                  console.error(`[${new Date().toISOString()}] Failed to handle error for "${timesheetName}": ${innerErr.message}`);
               }
               return { timesheetName, error: true, message: err.message };
            }
         })
      );

      // Separate successful timesheets and errors
      const successfulTimesheets = results.filter(result => result && !result.error);
      const errorDetails = results
         .filter(result => result && result.error)
         .map(result => ({
            timesheetName: result.timesheetName,
            message: result.errorMessage
         }));

      return {
         timeSheets: successfulTimesheets,
         errors: errorDetails
      };
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error accessing file share: ${err.message}`);
      return { timeSheets: [], errors: [] };
   }
};

module.exports = {
   processFiles
};
