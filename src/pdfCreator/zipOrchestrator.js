const archiver = require('archiver');
const fs = require('fs');
const fsPromises = fs.promises;
const dayjs = require('dayjs');
const config = require('../../config');

/**
 *
 * @param {*} pdfBuffersWithMetadata
 * @param {*} accountBillingInformation
 * @param {*} fileParentDirectoryName
 * @param {*} zippedFileName
 * @returns
 */
const createAndSaveZip = async (pdfBuffersWithMetadata, accountBillingInformation, fileParentDirectoryName, zippedFileName) => {
   return new Promise(async (resolve, reject) => {
      const now = dayjs().format('MM-DD-YYYY_T_HH_mm_ss');
      const accountName = accountBillingInformation.account_name.replace(/[^a-zA-Z0-9]/g, '_');
      const fileLocation = `${config.DEFAULT_PDF_SAVE_LOCATION}/${accountName}/${fileParentDirectoryName}/${now}`;

      // Use fsPromises.mkdir here
      await fsPromises.mkdir(fileLocation, { recursive: true });

      // Create a file to stream archive data to.
      const output = fs.createWriteStream(`${fileLocation}/${zippedFileName}`);
      const archive = archiver('zip', {
         zlib: { level: 9 } // Sets the compression level.
      });

      // Listen for all archive data to be written
      output.on('close', () => resolve(`${fileLocation}/${zippedFileName}`));

      // Catch errors
      archive.on('error', err => reject(err));

      // Pipe archive data to the file
      archive.pipe(output);

      // Append PDF files to the archive
      pdfBuffersWithMetadata.forEach(({ buffer, metadata }) => {
         // Validate
         if (Buffer.isBuffer(buffer)) {
            const fileName = `${metadata.displayName}.${metadata.type}`;
            archive.append(buffer, { name: fileName });
         } else {
            console.error(`Buffer is not a buffer: ${buffer}`);
            throw new Error(`Buffer is not a buffer: ${buffer}`);
         }
      });

      // Finalize the archive
      archive.finalize();

      return `${fileLocation}/${zippedFileName}`;
   });
};

module.exports = { createAndSaveZip };
