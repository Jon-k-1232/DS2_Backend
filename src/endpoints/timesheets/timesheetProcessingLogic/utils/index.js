const SMB2 = require('smb2');
const { FILE_SHARE_PATH, DOMAIN, USERNAME, PASSWORD } = require('../../../../../config');

const fileClient = new SMB2({
   share: FILE_SHARE_PATH,
   username: USERNAME,
   password: PASSWORD,
   domain: DOMAIN
});

/**
 * List files in a directory
 * @param {string} dirPath The path to the directory
 * @returns {Promise<string[]>} List of files in the directory
 */
const listFiles = dirPath =>
   new Promise((resolve, reject) => {
      fileClient.readdir(dirPath, (err, files) => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error listing files in directory "${dirPath}": ${err.message}`);
            return reject(err);
         }
         resolve(files);
      });
   });

/**
 * Read a file from the directory
 * @param {string} filePath The full path to the file
 * @param {string} timesheetName The name of the timesheet
 * @returns {Promise<Buffer>} The file data as a buffer
 */
const readFile = (filePath, timesheetName) =>
   new Promise((resolve, reject) => {
      fileClient.readFile(filePath, (err, data) => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error reading file "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve(data);
      });
   });

/**
 * Write a file to the directory
 * @param {string} filePath The full path to the file
 * @param {Buffer} data The file data to write
 * @param {string} timesheetName The name of the timesheet
 * @returns {Promise<void>} Resolves when the file is written successfully
 */
const writeFile = (filePath, data, timesheetName) =>
   new Promise((resolve, reject) => {
      fileClient.writeFile(filePath, data, err => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error writing file "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

/**
 * Delete a file from the directory
 * @param {string} filePath The full path to the file
 * @param {string} timesheetName The name of the timesheet
 * @returns {Promise<void>} Resolves when the file is deleted successfully
 */
const deleteFile = (filePath, timesheetName) =>
   new Promise((resolve, reject) => {
      fileClient.unlink(filePath, err => {
         if (err) {
            console.error(`[${new Date().toISOString()}] Error deleting file "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

/**
 * Move a file from one directory to another
 * @param {string} srcPath The source file path
 * @param {string} destPath The destination file path
 * @param {string} timesheetName The name of the timesheet
 * @returns {Promise<void>} Resolves when the file is moved successfully
 */
const moveFile = async (srcPath, destPath, timesheetName) => {
   try {
      const data = await readFile(srcPath, timesheetName);
      await writeFile(destPath, data, timesheetName);
      await deleteFile(srcPath, timesheetName);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error moving file "${timesheetName}": ${err.message}`);
      throw err;
   }
};

/**
 * Convert serialized Excel dates to proper format
 * @param {*} value The value to convert
 * @returns {string | *} The formatted date as a string or the original value if not a number
 */
const convertExcelDate = value => {
   if (typeof value === 'number') {
      const jsDate = new Date((value - 25569) * 86400 * 1000);
      return jsDate.toISOString().split('T')[0]; // Return as YYYY-MM-DD
   }
   return value;
};

module.exports = {
   listFiles,
   readFile,
   writeFile,
   deleteFile,
   moveFile,
   convertExcelDate
};
