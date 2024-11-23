const SMB2 = require('smb2');
const path = require('path');
const xlsx = require('xlsx');
const dayjs = require('dayjs');
const { FILE_SHARE_PATH, DOMAIN, USERNAME, PASSWORD, TIMESHEETS_PENDING_DIR, TIMESHEETS_PROCESSING_DIR, TIMESHEETS_PROCESSED_DIR, TIMESHEETS_ERROR_DIR } = require('../../config');

// Allowed headers that must exist in the file
const ALLOWED_HEADERS = ['Date', 'Entity', 'Category', 'Employee Name', 'Company Name', 'First Name', 'Last Name', 'Duration', 'Notes'];

const fileClient = new SMB2({
   share: FILE_SHARE_PATH,
   username: USERNAME,
   password: PASSWORD,
   domain: DOMAIN
});
// Convert to camelCase
const toCamelCase = str => str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase());

const listFiles = dirPath =>
   new Promise((resolve, reject) => {
      fileClient.readdir(dirPath, (err, files) => {
         if (err) return reject(err);
         resolve(files);
      });
   });

const readFile = filePath =>
   new Promise((resolve, reject) => {
      console.log(`[${new Date().toISOString()}] Reading timesheet: "${filePath}".`);
      fileClient.readFile(filePath, (err, data) => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error reading timesheet "${filePath}": ${err.message}`);
            return reject(err);
         }
         resolve(data);
      });
   });

const writeFile = (filePath, data, writeToDirectoryName) =>
   new Promise((resolve, reject) => {
      console.log(`[${new Date().toISOString()}] Writing timesheet to ${writeToDirectoryName}.`);
      fileClient.writeFile(filePath, data, err => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error Writing file "${filePath}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

const deleteFile = (filePath, deleteFromDirectoryName) =>
   new Promise((resolve, reject) => {
      console.log(`[${new Date().toISOString()}] Deleting timesheet from ${deleteFromDirectoryName}.`);
      fileClient.unlink(filePath, err => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error Deleting timesheet "${filePath}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

const moveFile = async (srcPath, destPath, fileName = '', writeToDirectoryName = '', deleteFromDirectoryName = '') => {
   try {
      console.log(`[${new Date().toISOString()}] In progress of moving timesheet to ${writeToDirectoryName}.`);
      const data = await readFile(srcPath);
      await writeFile(destPath, data, writeToDirectoryName);
      await deleteFile(srcPath, deleteFromDirectoryName);
      console.log(`[${new Date().toISOString()}] Timesheet successfully moved to "${writeToDirectoryName}".`);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Move of timesheet: "${fileName}" failed. Error: ${err.message}`);
      throw err;
   }
};

const appendErrorToFile = (fileData, errorReason) => {
   const workbook = xlsx.read(fileData);
   const sheetName = workbook.SheetNames[0];
   const sheet = workbook.Sheets[sheetName];
   const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
   rows.push([`ERROR DETECTED: ${errorReason}`]);
   const updatedSheet = xlsx.utils.aoa_to_sheet(rows);
   workbook.Sheets[sheetName] = updatedSheet;
   return xlsx.write(workbook, { type: 'buffer' });
};

const processFiles = async () => {
   console.log(`[${new Date().toISOString()}] Starting timesheet processing...`);

   try {
      const files = await listFiles(TIMESHEETS_PENDING_DIR);
      console.log(`[${new Date().toISOString()}] Found ${files.length} timesheets:`, files);

      const results = await Promise.all(
         files.map(async file => {
            const pendingPath = path.win32.join(TIMESHEETS_PENDING_DIR, file);
            const processingPath = path.win32.join(TIMESHEETS_PROCESSING_DIR, file);
            const processedPath = path.win32.join(TIMESHEETS_PROCESSED_DIR, file);
            const errorPath = path.win32.join(TIMESHEETS_ERROR_DIR, file);

            try {
               console.log(`[${new Date().toISOString()}] Starting on timesheet: "${file}"`);
               await moveFile(pendingPath, processingPath, file, 'processing', 'pending');
               console.log(`[${new Date().toISOString()}] Started processing timesheet.`);
               const fileData = await readFile(processingPath);
               const workbook = xlsx.read(fileData);
               const sheetName = workbook.SheetNames[0];
               const sheet = workbook.Sheets[sheetName];
               const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

               const validRows = rows.filter(row => row.some(cell => cell !== null && cell !== undefined && cell.toString().trim() !== ''));
               let originalHeaders = validRows[0];

               if (validRows.length <= 1) {
                  throw new Error('File contains no valid data rows.');
               }

               // Ensure minimum headers
               const allHeaders = [...new Set([...originalHeaders, ...ALLOWED_HEADERS])];

               const entries = validRows.slice(1).map(row =>
                  allHeaders.reduce((entry, header) => {
                     // Convert header to camelCase
                     const camelCaseHeader = toCamelCase(header);
                     const columnIndex = originalHeaders.indexOf(header);
                     let value = columnIndex !== -1 ? row[columnIndex] : ''; // Add empty string for missing headers

                     if (header === 'Date') {
                        if (typeof value === 'number') {
                           value = dayjs(new Date(Math.round((value - 25569 + 1) * 86400 * 1000))).format('YYYY-MM-DD');
                        } else if (typeof value === 'string' && dayjs(value).isValid()) {
                           value = dayjs(value).format('YYYY-MM-DD');
                        }
                     }

                     entry[camelCaseHeader] = value;
                     return entry;
                  }, {})
               );

               const timePeriodStart = entries[0]?.date || null;
               const timePeriodEnd = entries.at(-1)?.date || null;
               console.log(entries[0]);
               console.log(`[${new Date().toISOString()}] Completed processing timesheet.`);
               console.log(`[${new Date().toISOString()}] Starting to update spreadsheet formatting.`);

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
               console.log(`[${new Date().toISOString()}] Completed spreadsheet formatting.`);

               await writeFile(processedPath, processedFileData, 'processed');
               await deleteFile(processingPath, 'processing');
               console.log(`[${new Date().toISOString()}] File: "${file}" completed successfully.`);
               return { fileName: file, timePeriod: `${timePeriodStart}_${timePeriodEnd}`, entries };
            } catch (err) {
               console.error(`[${new Date().toISOString()}] Critical error in "${file}": ${err.message}`);
               try {
                  const errorReason = `Processing error: ${err.message}`;
                  const updatedFileData = appendErrorToFile(await readFile(processingPath), errorReason);
                  await writeFile(errorPath, updatedFileData);
                  await deleteFile(processingPath);
               } catch (innerErr) {
                  console.error(`[${new Date().toISOString()}] Failed to handle error for "${file}": ${innerErr.message}`);
               }
               return null;
            }
         })
      );

      return {
         timeSheets: results.filter(result => result !== null),
         errors: results.filter(result => result === null)
      };
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error accessing file share: ${err.message}`);
      return { timeSheets: [], errors: [] };
   }
};

module.exports = {
   processFiles
};
