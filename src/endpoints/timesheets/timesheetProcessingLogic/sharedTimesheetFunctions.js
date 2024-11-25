const SMB2 = require('smb2');
const xlsx = require('xlsx');
const dayjs = require('dayjs');
const { FILE_SHARE_PATH, DOMAIN, USERNAME, PASSWORD } = require('../../../../config');

const fileClient = new SMB2({
   share: FILE_SHARE_PATH,
   username: USERNAME,
   password: PASSWORD,
   domain: DOMAIN
});

// Convert to snakeCase
const toSnakeCase = str =>
   str
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
/**
 * List files in a directory
 * @param {*} dirPath The path to the directory
 * @returns Promise that resolves with the list of files in the directory
 */
const listFiles = dirPath =>
   new Promise((resolve, reject) => {
      fileClient.readdir(dirPath, (err, files) => {
         if (err) return reject(err);
         resolve(files);
      });
   });

/**
 * Read a file from the directory
 * @param {*} filePath The path to the file
 * @param {*} timesheetName The name of the timesheet
 * @returns Promise that resolves with the file data
 */
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

/**
 * Write a file to the directory
 * @param {*} filePath The path to the file
 * @param {*} data The data to write to the file
 * @param {*} writeToDirectoryName The name of the directory to write the file to
 * @param {*} timesheetName The name of the timesheet
 * @returns Promise that resolves when the file is written successfully
 */
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

/**
 * Delete a file
 * @param {*} filePath Path to the file to delete
 * @param {*} deleteFromDirectoryName The name of the directory to delete the file from
 * @param {*} timesheetName The name of the timesheet
 * @returns Promise that resolves when the file is deleted successfully
 */
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

/**
 * Move a file from one directory to another
 * @param {*} srcPath The source path of the file
 * @param {*} destPath The destination path of the file
 * @param {*} timesheetName The name of the timesheet
 * @param {*} writeToDirectoryName The name of the directory to write the file to
 * @param {*} deleteFromDirectoryName The name of the directory to delete the file from
 * @returns Promise that resolves when the file is moved successfully
 */
const moveFile = async (srcPath, destPath, timesheetName, writeToDirectoryName = '', deleteFromDirectoryName = '') => {
   try {
      console.log(`[${new Date().toISOString()}] In progress of moving "${timesheetName}" to ${writeToDirectoryName}.`);
      // Validate the file exists in source
      const data = await readFile(srcPath, timesheetName);
      // Write the file to the destination
      await writeFile(destPath, data, writeToDirectoryName, timesheetName);
      // Validate the file was written to destination
      await readFile(destPath, timesheetName);
      // Delete the file from the source
      await deleteFile(srcPath, deleteFromDirectoryName, timesheetName);
      console.log(`[${new Date().toISOString()}] "${timesheetName}" successfully moved to "${writeToDirectoryName}".`);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Move of timesheet: "${timesheetName}" failed. Error: ${err.message}`);
      throw err;
   }
};

/**
 * Append an error message to the end of the file
 * @param {*} fileData The data of the file
 * @param {*} errorReason The reason for the error
 * @returns The updated file as a buffer
 */
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
              // Skip the header row
              if (rowIndex === 0) return row;
              const updatedRow = [...row];
              const cellValue = updatedRow[dateColumnIndex];
              if (typeof cellValue === 'number') {
                 // Convert serialized number to a readable date format
                 updatedRow[dateColumnIndex] = dayjs(new Date(Math.round((cellValue - 25569 + 1) * 86400 * 1000))).format('YYYY/MM/DD');
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
   toSnakeCase,
   listFiles,
   readFile,
   writeFile,
   deleteFile,
   moveFile,
   appendErrorToFile
};
