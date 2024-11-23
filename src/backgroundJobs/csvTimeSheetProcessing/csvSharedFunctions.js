const SMB2 = require('smb2');
const xlsx = require('xlsx');
const dayjs = require('dayjs');
const { FILE_SHARE_PATH, DOMAIN, USERNAME, PASSWORD } = require('../../../config');

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

const readFile = (filePath, timesheetName) =>
   new Promise((resolve, reject) => {
      console.log(`[${new Date().toISOString()}] Reading timesheet: "${timesheetName}".`);
      fileClient.readFile(filePath, (err, data) => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error reading timesheet "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve(data);
      });
   });

const writeFile = (filePath, data, writeToDirectoryName, timesheetName) =>
   new Promise((resolve, reject) => {
      console.log(`[${new Date().toISOString()}] Writing "${timesheetName}" to ${writeToDirectoryName}.`);
      fileClient.writeFile(filePath, data, err => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error Writing file "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

const deleteFile = (filePath, deleteFromDirectoryName, timesheetName) =>
   new Promise((resolve, reject) => {
      console.log(`[${new Date().toISOString()}] Deleting "${timesheetName}" from ${deleteFromDirectoryName}.`);
      fileClient.unlink(filePath, err => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error Deleting timesheet "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

const moveFile = async (srcPath, destPath, timesheetName, writeToDirectoryName = '', deleteFromDirectoryName = '') => {
   try {
      console.log(`[${new Date().toISOString()}] In progress of moving "${timesheetName}" to ${writeToDirectoryName}.`);
      const data = await readFile(srcPath, timesheetName);
      await writeFile(destPath, data, writeToDirectoryName, timesheetName);
      await deleteFile(srcPath, deleteFromDirectoryName, timesheetName);
      console.log(`[${new Date().toISOString()}] "${timesheetName}" successfully moved to "${writeToDirectoryName}".`);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Move of timesheet: "${timesheetName}" failed. Error: ${err.message}`);
      throw err;
   }
};

const appendErrorToFile = (fileData, errorReason) => {
   const workbook = xlsx.read(fileData);
   const sheetName = workbook.SheetNames[0];
   const sheet = workbook.Sheets[sheetName];
   const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

   // Find the index of the 'Date' column
   const dateColumnIndex = rows[0]?.findIndex(header => header.toLowerCase() === 'date');

   // Process rows to fix serialized numbers in the 'Date' column if the column exists
   const processedRows =
      dateColumnIndex !== -1
         ? rows.map((row, rowIndex) => {
              if (rowIndex === 0) return row; // Skip the header row
              const updatedRow = [...row];
              const cellValue = updatedRow[dateColumnIndex];
              if (typeof cellValue === 'number') {
                 // Convert serialized number to a readable date format
                 updatedRow[dateColumnIndex] = dayjs(new Date(Math.round((cellValue - 25569 + 1) * 86400 * 1000))).format('YYYY-MM-DD');
              }
              return updatedRow;
           })
         : rows;

   // Append the error message as a new row
   const updatedRows = [...processedRows, [`ERROR DETECTED: ${errorReason}`]];

   // Convert updated rows back to a sheet
   const updatedSheet = xlsx.utils.aoa_to_sheet(updatedRows);
   workbook.Sheets[sheetName] = updatedSheet;

   // Return the updated file as a buffer
   return xlsx.write(workbook, { type: 'buffer' });
};

module.exports = {
   toCamelCase,
   listFiles,
   readFile,
   writeFile,
   deleteFile,
   moveFile,
   appendErrorToFile
};
