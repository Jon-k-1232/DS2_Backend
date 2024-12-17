const SMB2 = require('smb2');
const { FILE_SHARE_PATH, DOMAIN, USERNAME, PASSWORD } = require('../../../../../config');

/**
 * Creates a new SMB client instance
 */
const createSMBClient = () => {
   return new SMB2({
      share: FILE_SHARE_PATH,
      username: USERNAME,
      password: PASSWORD,
      domain: DOMAIN,
      timeout: 10000
   });
};

/**
 * List files in a directory
 */
const listFiles = dirPath =>
   withTimeout(
      new Promise((resolve, reject) => {
         const fileClient = createSMBClient();
         console.log(`[${new Date().toISOString()}] Attempting to list files in directory: "${dirPath}"`);
         fileClient.readdir(dirPath, (err, files) => {
            fileClient.close();
            if (err) {
               console.error(`[${new Date().toISOString()}] Error listing files: ${err.message}`);
               return reject(err);
            }
            console.log(`[${new Date().toISOString()}] Successfully listed ${files.length} file(s).`);
            resolve(files);
         });
      }),
      10000
   );

/**
 * Read a file from the directory
 */
const readFile = (filePath, timesheetName) =>
   new Promise((resolve, reject) => {
      const fileClient = createSMBClient();
      console.log(`[${new Date().toISOString()}] Reading file: "${timesheetName}"`);
      fileClient.readFile(filePath, (err, data) => {
         fileClient.close();
         if (err) {
            console.error(`[${new Date().toISOString()}] Error reading file "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve(data);
      });
   });

/**
 * Write a file to the directory
 */
const writeFile = (filePath, data, timesheetName) =>
   new Promise((resolve, reject) => {
      const fileClient = createSMBClient();
      console.log(`[${new Date().toISOString()}] Writing file: "${timesheetName}"`);
      fileClient.writeFile(filePath, data, err => {
         fileClient.close();
         if (err) {
            console.error(`[${new Date().toISOString()}] Error writing file "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

/**
 * Delete a file from the directory
 */
const deleteFile = (filePath, timesheetName) =>
   new Promise((resolve, reject) => {
      const fileClient = createSMBClient();
      console.log(`[${new Date().toISOString()}] Deleting file: "${timesheetName}"`);
      fileClient.unlink(filePath, err => {
         fileClient.close();
         if (err) {
            console.error(`[${new Date().toISOString()}] Error deleting file "${timesheetName}": ${err.message}`);
            return reject(err);
         }
         resolve();
      });
   });

/**
 * Move a file from one directory to another
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

/**
 * Timeout Wrapper
 */
const withTimeout = (promise, ms) => {
   return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${ms} ms`)), ms))]);
};

module.exports = {
   listFiles,
   readFile,
   writeFile,
   deleteFile,
   moveFile,
   convertExcelDate,
   withTimeout
};
