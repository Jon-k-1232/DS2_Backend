const fs = require('fs/promises');
const path = require('path');
const { FILE_SHARE_PATH } = require('../../../../../config');

/**
 * Timeout Wrapper
 */
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${ms} ms`)), ms))]);

/**
 * List files in a subdirectory under the mounted volume
 */
const listFiles = async (subdir = '') => {
   const dirPath = path.join(FILE_SHARE_PATH, subdir);

   try {
      console.log(`[${new Date().toISOString()}] Listing files in: "${dirPath}"`);
      const files = await fs.readdir(dirPath);
      console.log(`[${new Date().toISOString()}] Found ${files.length} file(s).`);
      return files;
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error listing files: ${err.message}`);
      throw err;
   }
};

/**
 * Read a file
 */
const readFile = async (relativePath, timesheetName) => {
   const filePath = path.join(FILE_SHARE_PATH, relativePath);
   try {
      console.log(`[${new Date().toISOString()}] Reading file: "${timesheetName}"`);
      return await fs.readFile(filePath);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error reading file "${timesheetName}": ${err.message}`);
      throw err;
   }
};

/**
 * Write a file
 */
const writeFile = async (relativePath, data, timesheetName) => {
   const filePath = path.join(FILE_SHARE_PATH, relativePath);
   try {
      console.log(`[${new Date().toISOString()}] Writing file: "${timesheetName}"`);
      await fs.writeFile(filePath, data);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error writing file "${timesheetName}": ${err.message}`);
      throw err;
   }
};

/**
 * Delete a file
 */
const deleteFile = async (relativePath, timesheetName) => {
   const filePath = path.join(FILE_SHARE_PATH, relativePath);
   try {
      console.log(`[${new Date().toISOString()}] Deleting file: "${timesheetName}"`);
      await fs.unlink(filePath);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting file "${timesheetName}": ${err.message}`);
      throw err;
   }
};

/**
 * Move a file from one relative path to another
 */
const moveFile = async (srcRelativePath, destRelativePath, timesheetName) => {
   const srcPath = path.join(FILE_SHARE_PATH, srcRelativePath);
   const destPath = path.join(FILE_SHARE_PATH, destRelativePath);
   try {
      console.log(`[${new Date().toISOString()}] Moving file "${timesheetName}"`);
      await fs.rename(srcPath, destPath);
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Error moving file "${timesheetName}": ${err.message}`);
      throw err;
   }
};

/**
 * Convert serialized Excel dates to ISO format
 */
const convertExcelDate = value => {
   if (value === undefined || value === null) {
      return null;
   }

   if (typeof value === 'number') {
      const jsDate = new Date((value - 25569) * 86400 * 1000);
      return jsDate.toISOString().split('T')[0];
   }

   if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
   }

   return value;
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
