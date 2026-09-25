const express = require('express');
const path = require('path');
const dayjs = require('dayjs');
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const { putObject, getObject, deleteObject, listObjects } = require('../../utils/s3');
const { canonicalSourceFile, pendingPaymentsService, PAYMENTS_PENDING_PREFIX, PAYMENTS_PROCESSED_PREFIX, PAYMENTS_AUTOMATION_ACCOUNT_ID } = require('./pendingPayments-service');
const { validatePendingPaymentExists, validateCanApprove, validateCanDelete } = require('./pendingPayments-logic');
const { buildCreatePaymentInput, createPaymentCore, buildLedgerTablesPayload } = require('../payments/payment-logic');
const { appendNoteMarker } = require('../payments/ledger-helpers');
const { clientSafeMessage } = require('../../utils/clientError');
const { isSafeBareFilename } = require('../../utils/downloadAuthorization');

const { enforceAccountId } = require('../auth/account-scope');
const pendingPaymentsRouter = express.Router();
pendingPaymentsRouter.param('accountID', enforceAccountId);
const jsonParser = express.json();
const rawUploadParser = express.raw({ type: () => true, limit: '25mb' });

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Refusal for the `:paymentID` routes: a not-found (incl. a malformed id) keeps
 * its 404; anything else stays a 500 whose message never carries driver / SQL
 * text in production.
 */
const sendPendingPaymentError = (res, error, fallback) => {
   const statusCode = error.statusCode || 500;
   res.status(statusCode).send({ message: error.statusCode ? error.message : clientSafeMessage(error, fallback), status: statusCode });
};

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
      // Same contract as GET /payments/getPayments: bad paging input is a 400.
      const isPaginationError = Boolean(error.message && error.message.includes('Invalid pagination'));
      const statusCode = isPaginationError ? 400 : 500;
      res.status(statusCode).send({
         message: isPaginationError ? error.message : clientSafeMessage(error, 'An error occurred while retrieving pending payments.'),
         status: statusCode
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
      sendPendingPaymentError(res, error, 'An error occurred while retrieving the pending payment.');
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
      if (!updated) throw httpError(409, 'Payment state changed; refresh before deleting.');
      const counts = await pendingPaymentsService.getTabCounts(db, accountID);

      return res.status(200).send({
         payment: updated,
         counts,
         message: 'Payment deleted successfully.',
         status: 200
      });
   } catch (error) {
      console.error('Error soft-deleting pending payment:', error);
      sendPendingPaymentError(res, error, 'An error occurred while deleting the pending payment.');
   }
});

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// POST /pending-payments/approve/:accountID/:userID
// One-step approval: posts the reviewed payment AND marks the pending row
// processed in ONE transaction, so a retry or double-click can never post the
// same check twice (the legacy flow was two client calls with no link between
// them: POST /payments/createPayment, then PUT /approve/:paymentID/...).
//
// Body: { pendingPaymentId: <customer_payments_processed.payment_id>,
//         payment: <exactly the `payment` object POST /payments/createPayment takes> }
//
// - The pending row is locked (SELECT … FOR UPDATE); an already processed or
//   deleted row, or one a payment was already posted from, answers 409.
// - The payment goes through payment-logic.createPaymentCore — the same code
//   path as /payments/createPayment (current-chain guard, overpayment split,
//   retainer draw, ledger lock). Its note gets `[pending_payment:<id>]`.
// - The pending row is marked processed and its note gets
//   `[posted_payment:<payment_id>]` (no column exists for the link).
// Success: HTTP 200 { status: 200, message, payment, pendingPayment, counts,
//   paymentsList, accountRetainersList, invoicesList } — the lists have the same
//   shape as the /payments/createPayment response.
// Failure: HTTP 400 (bad body) / 404 (not found) / 409 (already processed) /
//   422 (payment rule refused, e.g. amount exceeds the remaining) / 500, with
//   { status: <same code>, message }.
pendingPaymentsRouter.route('/approve/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const accountID = Number(req.params.accountID);

   try {
      const pendingPaymentId = Number(req.body?.pendingPaymentId);
      if (!Number.isInteger(pendingPaymentId) || pendingPaymentId <= 0) {
         throw httpError(400, 'pendingPaymentId is required.');
      }
      const { payment } = req.body || {};
      if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
         throw httpError(400, 'payment is required.');
      }

      const input = buildCreatePaymentInput(sanitizeFields(payment), accountID, req.user?.user_id);

      const result = await db.transaction(async trx => {
         const pending = await pendingPaymentsService.getPendingPaymentForUpdate(trx, pendingPaymentId, accountID);
         if (!pending) throw httpError(404, 'Pending payment record not found.');
         try {
            validateCanApprove(pending);
         } catch (err) {
            throw httpError(409, err.message);
         }
         const alreadyPosted = await pendingPaymentsService.findPostedPaymentForPending(trx, pendingPaymentId, accountID);
         if (alreadyPosted) {
            throw httpError(409, `Payment #${alreadyPosted.payment_id} was already posted from this pending payment.`);
         }

         const created = await createPaymentCore(trx, {
            ...input,
            paymentFields: { ...input.paymentFields, note: appendNoteMarker(input.paymentFields.note, `[pending_payment:${pendingPaymentId}]`) }
         });

         const postedMarker = created.payment ? `[posted_payment:${created.payment.payment_id}]` : `[posted_prepayment_retainer:${created.prepaymentRetainer.retainer_id}]`;
         const pendingPayment = await pendingPaymentsService.markAsProcessed(trx, pendingPaymentId, accountID, {
            note: appendNoteMarker(pending.note, postedMarker)
         });
         return { created, pendingPayment };
      });

      const [tables, counts] = await Promise.all([buildLedgerTablesPayload(db, accountID), pendingPaymentsService.getTabCounts(db, accountID)]);

      return res.status(200).send({
         ...tables,
         payment: result.created.payment,
         prepaymentRetainer: result.created.prepaymentRetainer,
         pendingPayment: result.pendingPayment,
         counts,
         message: result.created.message,
         status: 200
      });
   } catch (error) {
      console.error('Error approving pending payment:', error);
      const statusCode = error.statusCode || 500;
      // Rule refusals carry a user-facing message; an unexpected failure may be a
      // raw driver/SQL error, which must not reach the client in production.
      const message = error.statusCode ? error.message : clientSafeMessage(error, 'An error occurred while approving the payment.');
      res.status(statusCode).send({ message, status: statusCode });
   }
});

// PUT /pending-payments/approve/:paymentID/:accountID/:userID
// RETIRED: this legacy two-step flow marked a pending payment "processed"
// without ever posting a ledger entry (no lock, no createPaymentCore call) —
// a receipt could be reported as approved with no payment, retainer or
// invoice movement behind it. POST /pending-payments/approve replaced it
// 2026: it posts the payment AND marks the row processed atomically, under
// the customer's ledger lock. Kept as a 410 so any caller still on the old
// two-step flow gets a clear, actionable failure instead of a silent no-op.
pendingPaymentsRouter.route('/approve/:paymentID/:accountID/:userID').put(jsonParser, (req, res) => {
   res.status(410).send({
      status: 410,
      message: 'This endpoint no longer posts payments. Use POST /pending-payments/approve/:accountID/:userID with { pendingPaymentId, payment } — it posts the ledger entry and marks the pending payment processed atomically.'
   });
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

      // Filename hygiene: this route only ever accepts a BARE filename — it
      // prepends its own fixed prefix below — so no path separator, '..',
      // backslash, control byte, or residual '%' (see isSafeBareFilename /
      // downloadAuthorization.js) may reach the S3 key.
      if (!isSafeBareFilename(decodedName)) {
         return res.status(400).json({ message: 'Invalid file name.', status: 400 });
      }

      // review/full-audit-2026-09 finding 3: this whole route is wired to
      // exactly one Lambda that only ever watches account 1's exact prefix
      // (see PAYMENTS_AUTOMATION_ACCOUNT_ID in pendingPayments-service.js) —
      // there is no per-account variant of this feature to give anyone
      // else. Silently accepting another account's upload here would drop
      // it into a location nothing will ever process (an orphan S3 object,
      // no DB row, since only that Lambda ever inserts into
      // customer_payments_processed) — a worse failure than a clear refusal.
      if (Number(accountID) !== PAYMENTS_AUTOMATION_ACCOUNT_ID) {
         return res.status(403).json({ message: 'Automatic payment PDF processing is not available for this account.', status: 403 });
      }

      const canonicalName = `${decodedName.slice(0, -path.extname(decodedName).length)}${ext}`;
      const s3Key = `${PAYMENTS_PENDING_PREFIX}/${canonicalName}`;
      await putObject(s3Key, req.body, fileTypeHeader, {
         // The AUTHENTICATED uploader — the URL :userID is caller-supplied.
         'uploaded-by': String(req.user?.user_id ?? ''),
         'account-id': String(accountID),
         'upload-date': dayjs().toISOString()
      });

      return res.status(200).send({
         message: 'File uploaded successfully. Processing will begin shortly.',
         fileName: canonicalName,
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
   let { fileName } = req.body;

   try {
      if (!fileName) {
         return res.status(400).json({ message: 'File name is required.', status: 400 });
      }

      if (!isSafeBareFilename(fileName)) {
         return res.status(400).json({ message: 'Invalid file name.', status: 400 });
      }
      fileName = canonicalSourceFile(fileName);

      // review/full-audit-2026-09 finding 3: a fileName with zero rows for
      // THIS account used to fall straight through to the S3 delete call
      // below regardless — any account could delete any other account's
      // object under the shared prefix just by naming it. The DB is the
      // only record of which account a file belongs to (see
      // accountOwnsSourceFile), so ownership is checked before any S3 call;
      // a miss is refused exactly like "this file doesn't exist" — never
      // distinguished from "it exists but isn't yours."
      const owns = await pendingPaymentsService.accountOwnsSourceFile(db, fileName, accountID);
      if (!owns) {
         return res.status(404).json({ message: 'File not found.', status: 404 });
      }

      // Lock every extracted row so approval cannot commit while its evidence
      // is being removed. S3 failure rolls back queue flags and is retryable.
      await db.transaction(async trx => {
         const rows = await pendingPaymentsService.lockSourceFile(trx, fileName, accountID);
         if (!rows.length) throw httpError(404, 'File not found.');
         if (rows.some(row => row.is_payment_processed)) throw httpError(400, 'Cannot delete this file because some payments have already been processed.');
         const archived = await listObjects(`${PAYMENTS_PROCESSED_PREFIX}/`);
         const keys = archived.filter(obj => obj.Key.endsWith(`/${fileName}`)).map(obj => obj.Key);
         for (const key of [...new Set([...keys, `${PAYMENTS_PENDING_PREFIX}/${fileName}`])]) await deleteObject(key);
         await pendingPaymentsService.softDeleteBySourceFile(trx, fileName, accountID);
      });

      const counts = await pendingPaymentsService.getTabCounts(db, accountID);

      return res.status(200).send({
         counts,
         message: 'File and associated pending payments deleted.',
         status: 200
      });
   } catch (error) {
      console.error('Error deleting payment file:', error);
      res.status(error.statusCode || 500).send({ message: error.message, status: error.statusCode || 500 });
   }
});

// GET /pending-payments/file-preview/:accountID/:userID
// Stream a PDF from S3 for preview
pendingPaymentsRouter.route('/file-preview/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   let { fileName } = req.query;

   try {
      if (!fileName) {
         return res.status(400).json({ message: 'File name is required.', status: 400 });
      }

      if (!isSafeBareFilename(fileName)) {
         return res.status(400).json({ message: 'Invalid file name.', status: 400 });
      }
      fileName = canonicalSourceFile(fileName);

      // review/full-audit-2026-09 finding 3: this route had NO ownership
      // check at all — it scanned every subfolder under the shared
      // processed-payments prefix (account-agnostic) and, failing that, the
      // shared pending prefix, then streamed back whatever matched the
      // caller-supplied name. Any authenticated account could preview any
      // other account's payment PDF just by guessing or learning its name.
      // Refusing before either S3 call (see accountOwnsSourceFile) also
      // means a non-owner can no longer even trigger the unscoped
      // listObjects scan.
      const owns = await pendingPaymentsService.accountOwnsSourceFile(db, fileName, accountID, { includeDeleted: false });
      if (!owns) {
         return res.status(404).send({ message: 'File not found.', status: 404 });
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
