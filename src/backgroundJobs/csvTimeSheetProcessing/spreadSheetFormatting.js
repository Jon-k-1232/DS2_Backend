const xlsx = require('xlsx');
const { toCamelCase } = require('./csvSharedFunctions');

const formatSpreadsheet = (entries, allHeaders, sheetName, timesheetName) => {
   console.log(`[${new Date().toISOString()}] Starting to update spreadsheet formatting on "${timesheetName}".`);
   const processedWorkbook = xlsx.utils.book_new();
   const formattedEntries = entries.map(entry =>
      allHeaders.reduce((formattedEntry, header) => {
         // Ensure camelCase mapping
         const camelCaseHeader = toCamelCase(header);
         // Add empty strings for missing data
         formattedEntry[header] = entry[camelCaseHeader] || '';
         return formattedEntry;
      }, {})
   );

   xlsx.utils.book_append_sheet(processedWorkbook, xlsx.utils.json_to_sheet(formattedEntries), sheetName);
   const processedFileData = xlsx.write(processedWorkbook, { type: 'buffer' });
   console.log(`[${new Date().toISOString()}] Completed spreadsheet formatting for "${timesheetName}".`);
   return processedFileData;
};

module.exports = {
   formatSpreadsheet
};
