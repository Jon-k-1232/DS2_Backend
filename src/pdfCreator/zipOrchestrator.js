const archiver = require('archiver');
const fs = require('fs');
const fsPromises = fs.promises;
const dayjs = require('dayjs');
const config = require('../../config');

/**
 * Creates a ZIP file from given buffers and metadata, and saves it to disk.
 *
 * @param {Array} pdfBuffersWithMetadata Array of objects containing `buffer` and `metadata`.
 * @param {Object} accountBillingInformation Contains account name details.
 * @param {string} fileParentDirectoryName Name of the parent directory for the ZIP file.
 * @param {string} zippedFileName Name of the resulting ZIP file.
 * @returns {Promise<string>} Path to the created ZIP file.
 */
const createAndSaveZip = async (pdfBuffersWithMetadata, accountBillingInformation, fileParentDirectoryName, zippedFileName) => {
   const now = dayjs().format('MM-DD-YYYY_T_HH_mm_ss');
   const accountName = accountBillingInformation.account_name.replace(/[^a-zA-Z0-9]/g, '_');
   const fileLocation = `${config.DEFAULT_PDF_SAVE_LOCATION}/${accountName}/${fileParentDirectoryName}/${now}`;

   try {
      // Ensure the directory exists
      await fsPromises.mkdir(fileLocation, { recursive: true });

      // Define the full path for the ZIP file
      const zipFilePath = `${fileLocation}/${zippedFileName}`;

      // Create a file stream for the ZIP file
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      // Handle stream events
      await new Promise((resolve, reject) => {
         output.on('close', resolve);
         archive.on('error', reject);

         // Pipe archive data to the file stream
         archive.pipe(output);

         // Append files to the archive
         pdfBuffersWithMetadata.forEach(({ buffer, metadata }) => {
            if (Buffer.isBuffer(buffer) && metadata?.displayName && metadata?.type) {
               const fileName = `${metadata.displayName}.${metadata.type}`;
               archive.append(buffer, { name: fileName });
            } else {
               throw new Error(`Invalid buffer or metadata: ${JSON.stringify({ buffer, metadata })}`);
            }
         });

         // Finalize the archive
         archive.finalize();
      });

      return zipFilePath;
   } catch (error) {
      console.error(`Error creating ZIP file: ${error.message}`);
      throw error;
   }
};

module.exports = { createAndSaveZip };
