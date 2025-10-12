const archiver = require('archiver');
const { PassThrough } = require('stream');
const dayjs = require('dayjs');
const { putObject } = require('../utils/s3');
const { sanitizeAccountName } = require('../utils/invoicePath');

/**
 * Creates a ZIP file from given buffers and metadata, and saves it to S3.
 *
 * @param {Array} pdfBuffersWithMetadata Array of objects containing `buffer` and `metadata`.
 * @param {Object} accountBillingInformation Contains account name details.
 * @param {string} fileParentDirectoryName Name of the parent directory for the ZIP file.
 * @param {string} zippedFileName Name of the resulting ZIP file.
 * @returns {Promise<string>} S3 object key for the created ZIP file.
 */
const createAndSaveZip = async (pdfBuffersWithMetadata, accountBillingInformation, fileParentDirectoryName, zippedFileName) => {
   const now = dayjs().format('MM-DD-YYYY_T_HH_mm_ss');
   const accountName = sanitizeAccountName(accountBillingInformation?.account_name);

   if (!accountName) {
      throw new Error('Account name is required to generate invoice storage path.');
   }
   const keySegments = [accountName, fileParentDirectoryName, now].filter(Boolean);
   const directoryKey = keySegments.join('/');
   const s3Key = `${directoryKey}/${zippedFileName}`;

   try {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const passThrough = new PassThrough();
      const chunks = [];

      passThrough.on('data', chunk => {
         chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      const archiveCompleted = new Promise((resolve, reject) => {
         passThrough.on('end', resolve);
         passThrough.on('error', reject);
         archive.on('error', reject);
      });

      archive.pipe(passThrough);

      pdfBuffersWithMetadata.forEach(({ buffer, metadata }) => {
         if (Buffer.isBuffer(buffer) && metadata?.displayName && metadata?.type) {
            const fileName = `${metadata.displayName}.${metadata.type}`;
            archive.append(buffer, { name: fileName });
         } else {
            throw new Error(`Invalid buffer or metadata: ${JSON.stringify({ buffer, metadata })}`);
         }
      });

      archive.finalize();

      await archiveCompleted;

      const zipBuffer = Buffer.concat(chunks);
      await putObject(s3Key, zipBuffer, 'application/zip');

      return s3Key;
   } catch (error) {
      console.error(`Error creating ZIP file: ${error.message}`);
      throw error;
   }
};

module.exports = { createAndSaveZip };
