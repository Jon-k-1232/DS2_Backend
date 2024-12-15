const { listFiles } = require('./utils');
const { TIMESHEETS_PENDING_DIR } = require('../../../../config');
const processSingleTimesheet = require('./processSingleTimesheet');
const accountUserService = require('../../user/user-service');
const db = require('../../../utils/db');

const processTimesheetBatch = async accountID => {
   console.log(`[${new Date().toISOString()}] Starting timesheet batch processing for account ID: ${accountID}...`);

   try {
      const employeeList = await accountUserService.getActiveAccountUsers(db, accountID);
      const employeeLookup = Object.fromEntries(employeeList.map(employee => [employee.display_name, employee]));

      const files = await listFiles(TIMESHEETS_PENDING_DIR);
      console.log(`[${new Date().toISOString()}] Found ${files.length} timesheet(s) in pending directory:`, files);

      const results = await Promise.all(files.map(file => processSingleTimesheet(file, accountID, employeeLookup)));

      // Categorize results
      const validSuccessEntries = results.flatMap(result => result.validSuccess || []);
      const invalidSuccessEntries = results.flatMap(result => result.invalidSuccess || []);
      const validErrorEntries = results.flatMap(result => result.validErrors || []);
      const invalidErrorEntries = results.flatMap(result => result.invalidErrors || []);

      console.log(`[${new Date().toISOString()}] Timesheet batch completed for account ID: ${accountID}...`);

      return { validSuccessEntries, invalidSuccessEntries, validErrorEntries, invalidErrorEntries, error: null };
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Batch processing failed for account ${accountID}: ${err.message}`);
      return {
         validSuccessEntries: [],
         invalidSuccessEntries: [],
         validErrorEntries: [],
         invalidErrorEntries: [],
         error: err.message
      };
   }
};

module.exports = processTimesheetBatch;
