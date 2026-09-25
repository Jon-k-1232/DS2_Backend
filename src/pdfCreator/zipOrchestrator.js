const archiver = require('archiver');
const { PassThrough } = require('stream');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { putObject } = require('../utils/s3');

/**
 * Creates a ZIP file from given buffers and metadata, and saves it to S3.
 *
 * @param {Array} pdfBuffersWithMetadata Array of objects containing `buffer` and `metadata`.
 * @param {Object} accountBillingInformation Contains account name details.
 * @param {string} fileParentDirectoryName Name of the parent directory for the ZIP file.
 * @param {string} zippedFileName Name of the resulting ZIP file.
 * @returns {Promise<string>} S3 object key for the created ZIP file.
 */
const createAndSaveZip = async (pdfBuffersWithMetadata, accountBillingInformation, fileParentDirectoryName, zippedFileName, options = {}) => {
   const now = dayjs().format('MM-DD-YYYY_T_HH_mm_ss');
   // review/full-audit-2026-09 finding 1: this used to re-derive the S3
   // namespace via sanitizeAccountName(accountBillingInformation.account_name)
   // — a MUTABLE field — on every call. accountBillingInformation always
   // comes from accountService.getAccount()'s `SELECT *` (see
   // billingSnapshot.js's readBillingSnapshot), so storage_slug is already
   // present on the row; see src/utils/storageSlug.js.
   const accountSlug = accountBillingInformation?.storage_slug;

   if (!accountSlug) {
      throw new Error('Account storage slug is required to generate invoice storage path.');
   }
   // Keys used to be second-resolution + display name only, so two runs in the
   // same second (or two customers sharing a display name) overwrote each other's
   // statement ZIP — including a failed run replacing a committed one. Every key
   // now carries a per-run id and, for per-customer files, the customer id.
   const runID = options.runID || randomUUID();
   const customerSegment = options.customerID != null ? `customer_${options.customerID}` : null;
   const keySegments = [accountSlug, fileParentDirectoryName, `${now}_${runID}`, customerSegment].filter(Boolean);
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

      const usedNames = new Set();
      pdfBuffersWithMetadata.forEach(({ buffer, metadata }) => {
         if (Buffer.isBuffer(buffer) && metadata?.displayName && metadata?.type) {
            const safe = value => String(value).replace(/[^\p{L}\p{N}._-]+/gu, '_');
            const customer = metadata.customerID != null ? `_customer_${safe(metadata.customerID)}` : '';
            const base = `${safe(metadata.displayName)}${customer}`;
            const extension = safe(metadata.type);
            let fileName = `${base}.${extension}`;
            for (let n = 2; usedNames.has(fileName.toLowerCase()); n++) fileName = `${base}_${n}.${extension}`;
            usedNames.add(fileName.toLowerCase());
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
