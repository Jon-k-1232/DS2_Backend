const xlsx = require('xlsx');
const accountUserService = require('../endpoints/user/user-service');
const validateNameBlock = require('../endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock');
const validateTimeBlock = require('../endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock');
const { describeHeaderProblems } = require('../endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig');

const normalizeRow = row => {
   if (!Array.isArray(row)) return [];
   return row.map(cell => (cell === undefined || cell === null ? '' : cell));
};

const isRowBlank = row => normalizeRow(row).every(cell => cell.toString().trim() === '');

// Validate every data row, collecting one error per bad row, in a single
// forward pass — one call to validateTimeBlock per row, each row numbered via
// `firstRow` exactly as it would be validated in place within the full sheet.
// (Previously: on a row error the offending row was blanked and the WHOLE
// array re-validated recursively. That re-validated every earlier row again
// on every new error — O(n^2) — and grew the call stack by one frame per
// invalid row, so a large tracker with thousands of bad rows in a row
// exhausted the stack ("Maximum call stack size exceeded") before every error
// was collected. A flat loop is O(n) time and O(1) stack depth regardless of
// how many rows are invalid.)
const gatherTimeBlockValidation = (rows, originalHeaders, metadata, options) => {
   const entries = [];
   const errors = [];
   rows.forEach((row, index) => {
      try {
         entries.push(...validateTimeBlock([row], originalHeaders, metadata, { ...options, firstRow: index + 6 }));
      } catch (error) {
         errors.push(error.message);
      }
   });
   return { entries, errors };
};

const buildEmployeeLookup = employeeList =>
   Object.fromEntries(
      (employeeList || []).map(employee => [employee.display_name, employee]).filter(([name]) => !!name)
   );

/**
 * Parse + validate an uploaded tracker workbook.
 * @param {{ db, accountID, userID, fileBuffer: Buffer, originalFileName?: string, today?: Date }} args
 *   `today` bounds entry dates (defaults to now; injectable for tests).
 * @returns {Promise<{ errors: string[], metadata: object|null, entries: object[] }>}
 */
const validateUploadedTracker = async ({ db, accountID, userID, fileBuffer, originalFileName, today = new Date() }) => {
   if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
      return {
         errors: ['The uploaded file is empty or unreadable.'],
         metadata: null,
         entries: []
      };
   }

   let workbook;
   try {
      workbook = xlsx.read(fileBuffer, { type: 'buffer' });
   } catch (parseError) {
      return {
         errors: ['The uploaded workbook is corrupt or unsupported. Please re-save it as XLSX/XLS and try again.'],
         metadata: null,
         entries: []
      };
   }
   const sheetName = workbook.SheetNames?.[0];

   if (!sheetName) {
      return {
         errors: ['The uploaded file does not contain any worksheets.'],
         metadata: null,
         entries: []
      };
   }

   const sheet = workbook.Sheets[sheetName];
   const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) || [];

   if (!rows.length) {
      return {
         errors: ['The uploaded file does not contain any data.'],
         metadata: null,
         entries: []
      };
   }

   const employeeList = await accountUserService.getActiveAccountUsers(db, accountID);
   // Scope the B1 name->record lookup to the tracker's OWNER (the validated
   // :userID/ownerUserID the upload is being saved under) rather than the
   // whole account's active roster. Two employees can share a display name
   // ("Alex Jones" hired twice at different rates); buildEmployeeLookup keys
   // by display_name and the LAST equal-named entry silently wins, which used
   // to let a tracker validate against — and later be priced from — the WRONG
   // "Alex Jones" record whenever the wrong one happened to sort later.
   // Filtering to just the intended owner makes the match (and therefore
   // metadata.userId, and every entry's user_id) unambiguous by construction.
   const employeeLookup = buildEmployeeLookup((employeeList || []).filter(employee => Number(employee.user_id) === Number(userID)));

   const validationErrors = [];
   let metadata = null;

   try {
      metadata = validateNameBlock(rows.slice(0, 3), employeeLookup);
   } catch (nameError) {
      validationErrors.push(nameError.message);
   }

   if (metadata && Number(metadata.userId) !== Number(userID)) {
      validationErrors.push('Uploaded tracker belongs to a different user. Users can only submit their own trackers.');
   }

   const timeBlockRows = rows.slice(4);
   const originalHeaders = timeBlockRows[0] || [];
   const timeEntryRows = timeBlockRows.slice(1);

   if (!validationErrors.length && (!originalHeaders.length || originalHeaders.every(header => !header))) {
      validationErrors.push('Time tracker is missing the time entry header row.');
   }

   // A misspelled / missing required header used to silently drop the whole
   // column (e.g. every row's Notes or Category vanished). Fail loudly instead.
   if (!validationErrors.length) {
      validationErrors.push(...describeHeaderProblems(originalHeaders));
   }

   let entries = [];
   if (!validationErrors.length) {
      const nonBlankRows = timeEntryRows.filter(row => !isRowBlank(row));

      if (!nonBlankRows.length) {
         validationErrors.push('Time tracker does not contain any time entry rows.');
      } else {
         const { entries: timeEntries, errors } = gatherTimeBlockValidation(timeEntryRows, originalHeaders, metadata, { today });
         if (errors.length) {
            validationErrors.push(...errors);
         } else {
            entries = timeEntries.map(entry => ({
               ...entry,
               time_tracker_start_date: metadata.startDate,
               time_tracker_end_date: metadata.endDate,
               timesheet_name: originalFileName || '',
               user_id: metadata.userId
            }));
         }
      }
   }

   return {
      errors: [...new Set(validationErrors)],
      metadata,
      entries
   };
};

module.exports = { validateUploadedTracker };
