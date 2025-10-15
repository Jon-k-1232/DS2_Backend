const xlsx = require('xlsx');
const accountUserService = require('../endpoints/user/user-service');
const validateNameBlock = require('../endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock');
const validateTimeBlock = require('../endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock');

const normalizeRow = row => {
   if (!Array.isArray(row)) return [];
   return row.map(cell => (cell === undefined || cell === null ? '' : cell));
};

const isRowBlank = row => normalizeRow(row).every(cell => cell.toString().trim() === '');

const blankRowAtIndex = (rows, index) =>
   rows.map((row, idx) => (idx === index ? normalizeRow(row).map(() => '') : row));

const extractRowIndex = errorMessage => {
   const match = errorMessage.match(/row\s+(\d+)/i);
   if (!match) return null;
   const parsed = Number(match[1]);
   return Number.isFinite(parsed) ? parsed - 6 : null;
};

const gatherTimeBlockValidation = (rows, originalHeaders, metadata, visited = new Set()) => {
   try {
      const validatedEntries = validateTimeBlock(rows, originalHeaders, metadata) || [];
      return { entries: validatedEntries, errors: [] };
   } catch (error) {
      const invalidIndex = extractRowIndex(error.message);
      if (invalidIndex === null || visited.has(invalidIndex)) {
         return { entries: [], errors: [error.message] };
      }

      const updatedVisited = new Set(visited).add(invalidIndex);
      const sanitizedRows = blankRowAtIndex(rows, invalidIndex);
      const { entries, errors } = gatherTimeBlockValidation(sanitizedRows, originalHeaders, metadata, updatedVisited);
      return { entries, errors: [error.message, ...errors] };
   }
};

const buildEmployeeLookup = employeeList =>
   Object.fromEntries(
      (employeeList || []).map(employee => [employee.display_name, employee]).filter(([name]) => !!name)
   );

const validateUploadedTracker = async ({ db, accountID, userID, fileBuffer, originalFileName }) => {
   if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
      return {
         errors: ['The uploaded file is empty or unreadable.'],
         metadata: null,
         entries: []
      };
   }

   const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
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
   const employeeLookup = buildEmployeeLookup(employeeList);

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

   let entries = [];
   if (!validationErrors.length) {
      const nonBlankRows = timeEntryRows.filter(row => !isRowBlank(row));

      if (!nonBlankRows.length) {
         validationErrors.push('Time tracker does not contain any time entry rows.');
      } else {
         const { entries: timeEntries, errors } = gatherTimeBlockValidation(
            timeEntryRows,
            originalHeaders,
            metadata
         );
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
