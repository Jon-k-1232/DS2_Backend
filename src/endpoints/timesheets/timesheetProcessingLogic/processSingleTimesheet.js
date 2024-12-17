const xlsx = require('xlsx');
const path = require('path');
const { TIMESHEETS_PENDING_DIR, TIMESHEETS_PROCESSING_DIR, TIMESHEETS_PROCESSED_DIR, TIMESHEETS_ERROR_DIR } = require('../../../../config');
const validateNameBlock = require('./validations/validateNameBlock');
const validateTimeBlock = require('./validations/validateTimeBlock');
const validateForDatabaseInsert = require('./validations/validateForDatabaseInsert');
const { readFile, moveFile, writeFile, deleteFile } = require('./utils');
const sendErrorEmail = require('../../../utils/email/sendErrorEmail');
const sendSuccessEmail = require('../../../utils/email/sendSuccessEmail');

/**
 * Processes a single timesheet file.
 * @param {string} timesheetName - The name of the timesheet file.
 * @param {number} accountID - The ID of the account.
 * @param {object} employeeLookup - A map of employee names to their details.
 * @returns {object} The result of the processing.
 */
const processSingleTimesheet = async (timesheetName, accountID, employeeLookup) => {
   const pendingPath = path.join(TIMESHEETS_PENDING_DIR, timesheetName);
   const processingPath = path.join(TIMESHEETS_PROCESSING_DIR, timesheetName);
   const processedPath = path.join(TIMESHEETS_PROCESSED_DIR, timesheetName);
   const errorPath = path.join(TIMESHEETS_ERROR_DIR, timesheetName);

   let metadata = null;
   let entries = [];
   let fileData;

   try {
      console.log(`[${new Date().toISOString()}] Starting timesheet processing for ${timesheetName}...`);

      // Move file to processing
      await moveFile(pendingPath, processingPath, timesheetName);

      // Read and parse the file
      fileData = await readFile(processingPath, timesheetName);
      const workbook = xlsx.read(fileData);
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

      // Validate metadata
      try {
         metadata = validateNameBlock(rows.slice(0, 3), employeeLookup);
      } catch (metadataError) {
         metadata = {
            error_message: `Metadata error: ${metadataError.message}`,
            timesheet_name: timesheetName,
            account_id: accountID,
            user_id: null,
            time_tracker_start_date: null,
            time_tracker_end_date: null
         };
         entries.push(metadata);
      }

      // Validate and process time block if metadata is valid
      if (!metadata?.error_message) {
         const timeBlockRows = rows.slice(4);
         const originalHeaders = timeBlockRows[0];
         try {
            entries = validateTimeBlock(timeBlockRows.slice(1), originalHeaders, metadata);
            entries.forEach(entry => {
               entry.time_tracker_start_date = metadata.startDate;
               entry.time_tracker_end_date = metadata.endDate;
               entry.account_id = accountID;
               entry.timesheet_name = timesheetName;
               entry.user_id = metadata.userId;
            });
         } catch (timeBlockError) {
            entries.push({
               // Serialize for input into database
               error_message: JSON.stringify([timeBlockError.message]),
               timesheet_name: timesheetName,
               account_id: accountID,
               user_id: metadata?.userId || null,
               time_tracker_start_date: metadata?.startDate || null,
               time_tracker_end_date: metadata?.endDate || null
            });
         }
      }

      // Validate for database insertion
      const { validSuccess, invalidSuccess, validErrors, invalidErrors } = await validateForDatabaseInsert(entries, processingPath);

      // Handle files based on results
      if (validSuccess.length > 0) {
         await moveFile(processingPath, processedPath, timesheetName);
         console.log(`[${new Date().toISOString()}] Processed ${timesheetName} with no errors.`);
         await sendSuccessEmail(metadata.email, timesheetName, validSuccess.length, invalidSuccess.length);
      } else if (validErrors.length > 0 || invalidErrors.length > 0) {
         await writeFile(errorPath, fileData, timesheetName);
         await deleteFile(processingPath, timesheetName);
         console.log(`[${new Date().toISOString()}] Processed: ${timesheetName} but errors existed on timesheet.`);
         // Extract the first error message for the email
         const errorDetails = validErrors.length ? validErrors[0].error_message : invalidErrors[0]?.invalid_reason || 'Unknown error occurred.';
         await sendErrorEmail(metadata?.email || null, timesheetName, fileData, errorDetails);
      }

      console.log(`[${new Date().toISOString()}] Completed ${timesheetName}.`);

      return { validSuccess, invalidSuccess, validErrors, invalidErrors };
   } catch (processingError) {
      console.log(`[${new Date().toISOString()}] An error occurred while processing timesheet: ${timesheetName}.`);
      // Handle catastrophic failures during processing
      if (fileData) {
         await writeFile(errorPath, fileData, timesheetName);
         await deleteFile(processingPath, timesheetName);
      }

      await sendErrorEmail(metadata?.email || null, timesheetName, fileData, metadata?.error_message || processingError.message);

      return {
         validSuccess: [],
         invalidSuccess: [],
         validErrors: [],
         invalidErrors: [
            {
               timesheet_name: timesheetName,
               error_message: processingError.message,
               account_id: accountID,
               user_id: metadata?.userId || null,
               time_tracker_start_date: metadata?.startDate || null,
               time_tracker_end_date: metadata?.endDate || null
            }
         ]
      };
   }
};

module.exports = processSingleTimesheet;
