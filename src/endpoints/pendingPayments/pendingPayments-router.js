const express = require('express');
const path = require('path');
const dayjs = require('dayjs');
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const { putObject, getObject, deleteObject } = require('../../utils/s3');
const { pendingPaymentsService, PAYMENTS_PENDING_PREFIX } = require('./pendingPayments-service');
const { validatePendingPaymentExists, validateCanApprove, validateCanDelete } = require('./pendingPayments-logic');

const pendingPaymentsRouter = express.Router();
const jsonParser = express.json();
const rawUploadParser = express.raw({ type: () => true, limit: '25mb' });

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// GET /pending-payments/list/:accountID/:userID
// Paginated list with filters: status (new|processed|all), month, year, search
pendingPaymentsRouter.route('/list/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { search = '', status = 'new', month, year } = req.query;

   try {
      const { page, limit, offset } = getPaginationParams({
         page: req.query.page || 1,
         limit: req.query.limit || 20
      });

      const { payments, totalCount } = await pendingPaymentsService.getPendingPaymentsPaginated(
         db, accountID, {
            limit, offset,
            searchTerm: typeof search === 'string' ? search.trim() : '',
            status,
            month: month ? Number(month) : null,
            year: year ? Number(year) : null
         }
      );

      const pagination = getPaginationMetadata(totalCount, page, limit);

      return res.status(200).send({
         payments,
         pagination,
         message: 'Successfully retrieved pending payments.',
         status: 200
      });
   } catch (error) {
      console.error('Error fetching pending payments:', error);
      res.status(500).send({
         message: error.message || 'An error occurred while retrieving pending payments.',
         status: 500
      });
   }
});

// GET /pending-payments/counts/:accountID/:userID
// Tab badge counts
pendingPaymentsRouter.route('/counts/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const counts = await pendingPaymentsService.getTabCounts(db, accountID);
      return res.status(200).send({ counts, message: 'Success', status: 200 });
   } catch (error) {
      console.error('Error fetching pending payment counts:', error);
      res.status(500).send({ message: error.message, status: 500 });
   }
});

// GET /pending-payments/single/:paymentID/:accountID/:userID
// Single pending payment for review dialog
pendingPaymentsRouter.route('/single/:paymentID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { paymentID, accountID } = req.params;

   try {
      const record = await validatePendingPaymentExists(db, paymentID, accountID);
      return res.status(200).send({ payment: record, message: 'Success', status: 200 });
   } catch (error) {
      console.error('Error fetching single pending payment:', error);
      res.status(500).send({ message: error.message, status: 500 });
   }
});

// PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID
// Soft delete a pending payment
pendingPaymentsRouter.route('/soft-delete/:paymentID/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { paymentID, accountID } = req.params;

   try {
      const record = await validatePendingPaymentExists(db, paymentID, accountID);
      validateCanDelete(record);

      const updated = await pendingPaymentsService.softDeletePendingPayment(db, paymentID, accountID);
      const counts = await pendingPaymentsService.getTabCounts(db, accountID);

      return res.status(200).send({
         payment: updated,
         counts,
         message: 'Payment deleted successfully.',
         status: 200
      });
   } catch (error) {
      console.error('Error soft-deleting pending payment:', error);
      res.status(500).send({ message: error.message, status: 500 });
   }
});

// PUT /pending-payments/approve/:paymentID/:accountID/:userID
// Mark a pending payment as processed (called AFTER the real payment is created)
pendingPaymentsRouter.route('/approve/:paymentID/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { paymentID, accountID } = req.params;

   try {
      const record = await validatePendingPaymentExists(db, paymentID, accountID);
      validateCanApprove(record);

      const updated = await pendingPaymentsService.markAsProcessed(db, paymentID, accountID);
      const counts = await pendingPaymentsService.getTabCounts(db, accountID);

      return res.status(200).send({
         payment: updated,
         counts,
         message: 'Payment approved and processed.',
         status: 200
      });
   } catch (error) {
      console.error('Error approving pending payment:', error);
      res.status(500).send({ message: error.message, status: 500 });
   }
});

// POST /pending-payments/upload/:accountID/:userID
// Upload a PDF to S3 processing_pending/ (triggers Lambda in prod)
pendingPaymentsRouter.post('/upload/:accountID/:userID', rawUploadParser, async (req, res) => {
   const { accountID } = req.params;
   const fileNameHeader = req.headers['x-file-name'];
   const fileTypeHeader = req.headers['x-file-type'] || 'application/pdf';

   try {
      if (!fileNameHeader) {
         return res.status(400).json({ message: 'Missing file name header.', status: 400 });
      }

      if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) {
         return res.status(400).json({ message: 'Uploaded file is empty or missing.', status: 400 });
      }

      if (req.body.length > MAX_UPLOAD_BYTES) {
         return res.status(400).json({ message: 'File exceeds the 10MB size limit.', status: 400 });
      }

      const decodedName = decodeURIComponent(fileNameHeader);
      const ext = path.extname(decodedName).toLowerCase();

      if (ext !== '.pdf') {
         return res.status(400).json({ message: 'Only PDF files are accepted.', status: 400 });
      }

      const s3Key = `${PAYMENTS_PENDING_PREFIX}/${decodedName}`;
      await putObject(s3Key, req.body, fileTypeHeader, {
         'uploaded-by': String(req.params.userID),
         'account-id': String(accountID),
         'upload-date': dayjs().toISOString()
      });

      return res.status(200).send({
         message: 'File uploaded successfully. Processing will begin shortly.',
         fileName: decodedName,
         s3Key,
         status: 200
      });
   } catch (error) {
      console.error('Error uploading payment file:', error);
      res.status(500).send({ message: error.message || 'Upload failed.', status: 500 });
   }
});

// GET /pending-payments/files/:accountID/:userID
// List uploaded files with their processing status
pendingPaymentsRouter.route('/files/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const files = await pendingPaymentsService.getDistinctSourceFiles(db, accountID);
      return res.status(200).send({ files, message: 'Success', status: 200 });
   } catch (error) {
      console.error('Error fetching payment files:', error);
      res.status(500).send({ message: error.message, status: 500 });
   }
});

// DELETE /pending-payments/file/:accountID/:userID
// Delete a file from S3 + soft-delete associated unprocessed payments
pendingPaymentsRouter.route('/file/:accountID/:userID').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { fileName } = req.body;

   try {
      if (!fileName) {
         return res.status(400).json({ message: 'File name is required.', status: 400 });
      }

      // Check if any payments from this file have been processed
      const hasProcessed = await pendingPaymentsService.hasProcessedPaymentsForFile(db, fileName, accountID);
      if (hasProcessed) {
         return res.status(400).json({
            message: 'Cannot delete this file because some payments have already been processed.',
            status: 400
         });
      }

      // Soft-delete associated pending payments
      await pendingPaymentsService.softDeleteBySourceFile(db, fileName, accountID);

      // Try to delete from both S3 locations (pending and processed)
      try {
         await deleteObject(`${PAYMENTS_PENDING_PREFIX}/${fileName}`);
      } catch (s3Err) {
         console.warn(`Could not delete from processing_pending: ${s3Err.message}`);
      }

      const counts = await pendingPaymentsService.getTabCounts(db, accountID);

      return res.status(200).send({
         counts,
         message: 'File and associated pending payments deleted.',
         status: 200
      });
   } catch (error) {
      console.error('Error deleting payment file:', error);
      res.status(500).send({ message: error.message, status: 500 });
   }
});

// GET /pending-payments/file-preview/:accountID/:userID
// Stream a PDF from S3 for preview
pendingPaymentsRouter.route('/file-preview/:accountID/:userID').get(async (req, res) => {
   const { accountID } = req.params;
   const { fileName } = req.query;

   try {
      if (!fileName) {
         return res.status(400).json({ message: 'File name is required.', status: 400 });
      }

      // Try processed folder first (organized by month), then pending
      const processedPrefix = 'James_F__Kimmel___Associates/payments/processed_payments';
      let fileData;

      try {
         // Search processed subfolders
         const { listObjects } = require('../../utils/s3');
         const objects = await listObjects(`${processedPrefix}/`);
         const match = objects.find(obj => obj.Key.endsWith(`/${fileName}`));
         if (match) {
            fileData = await getObject(match.Key);
         }
      } catch (err) {
         // Not in processed, try pending
      }

      if (!fileData) {
         fileData = await getObject(`${PAYMENTS_PENDING_PREFIX}/${fileName}`);
      }

      res.set('Content-Type', fileData.metadata.contentType || 'application/pdf');
      res.set('Content-Length', fileData.body.length);
      return res.send(fileData.body);
   } catch (error) {
      console.error('Error fetching file preview:', error);
      res.status(404).send({ message: 'File not found.', status: 404 });
   }
});

module.exports = pendingPaymentsRouter;
