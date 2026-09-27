const { validateLedgerInput } = require('../../utils/ledgerInput');
const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const paymentsRouter = express.Router();
paymentsRouter.param('accountID', enforceAccountId);
const paymentsService = require('./payments-service');
const { restoreDataTypesPaymentsTableOnUpdate } = require('./paymentsObjects');
const { createGrid } = require('../../utils/gridFunctions');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const { buildCreatePaymentInput, createPaymentCore, updatePaymentCore, deletePaymentCore, returnTablesWithSuccessResponse, reversePayment } = require('./payment-logic');
const { positiveIntOrNull } = require('./ledger-helpers');
const { clientSafeMessage } = require('../../utils/clientError');
const {route}=require('../../utils/ledgerAction');
const {requireAdmin}=require('../auth/jwt-auth');
const receipts=require('./receipts-service');
const receiptArgs=req=>({accountId:Number(req.user.account_id),actorId:Number(req.user.user_id),body:req.body || {},query:req.query,receiptId:req.params.receiptID,applicationId:req.params.applicationID,key:req.get('Idempotency-Key')});
paymentsRouter.get('/open-obligations',route(req=>receipts.open(req.app.get('db'),receiptArgs(req))));
paymentsRouter.get('/receipts',route(req=>receipts.list(req.app.get('db'),receiptArgs(req))));
paymentsRouter.post('/receipts',route(req=>receipts.create(req.app.get('db'),receiptArgs(req))));
paymentsRouter.get('/receipts/:receiptID',route(req=>receipts.detail(req.app.get('db'),receiptArgs(req))));
paymentsRouter.post('/receipts/:receiptID/applications/:applicationID/correct',requireAdmin,route(req=>receipts.correct(req.app.get('db'),receiptArgs(req))));
paymentsRouter.post('/receipts/:receiptID/exceptions',requireAdmin,route(req=>receipts.flag(req.app.get('db'),receiptArgs(req))));
paymentsRouter.post('/receipts/:receiptID/cancellations',requireAdmin,route(req=>receipts.cancel(req.app.get('db'),receiptArgs(req))));
paymentsRouter.post('/receipts/:receiptID/reversals',requireAdmin,route(req=>receipts.reverse(req.app.get('db'),receiptArgs(req))));
paymentsRouter.post('/receipts/:receiptID/resolve',requireAdmin,route(req=>receipts.resolve(req.app.get('db'),receiptArgs(req))));

// Create a new payment. All ledger writes (retainer draw, invoice snapshot,
// payment row, parent mirror, prepayment retainer) run in ONE transaction
// under the customer's ledger lock — see payment-logic.createPaymentCore, which
// POST /pending-payments/approve reuses.
paymentsRouter.route('/createPayment/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      validateLedgerInput(req.body.payment, 'payment', { update: false });
      const sanitizedNewPayment = sanitizeFields(req.body.payment || {});
      validateLedgerInput(sanitizedNewPayment, 'payment', { update: false });
      const input = buildCreatePaymentInput(sanitizedNewPayment, req.params.accountID, req.user?.user_id);
      const { message, paymentTableFields, payment, snapshot, prepaymentRetainer, retainerDraw } = await require('./ledger-helpers').withTransaction(db, async trx => {
         await require('../../utils/ledgerAction').actionContext(trx, Number(req.user.user_id), 'Manual payment entry');
         const result = await createPaymentCore(trx, input);
         await require('../duplicates/duplicates-service').detectCreated(trx, 'payment', result.payment, Number(req.user.user_id));
         // A manually held prepayment is a receipt, not an automatic excess split.
         if (!result.payment && result.prepaymentRetainer) {
            await require('../duplicates/duplicates-service').detectCreated(trx, 'retainer', result.prepaymentRetainer, Number(req.user.user_id));
         }
         return result;
      });
      return returnTablesWithSuccessResponse(db, res, paymentTableFields, message, {payments:payment?[payment]:[],invoices:snapshot?[snapshot]:[],retainers:[prepaymentRetainer,retainerDraw].filter(Boolean)});
   } catch (err) {
      console.log(err);
      res.status(err.code==='RECEIPT_APPLICATION_LOCKED'?409:err.inputValidation ? 400 : 200).send({
         message: err.message || 'An error occurred while creating the Payment.',
         status: err.code==='RECEIPT_APPLICATION_LOCKED'?409:err.inputValidation ? 400 : 500
      });
   }
});

// Reverse a payment (NSF / bounced check). Billed payments are immutable by
// design, so reversal is a NEW ledger event: a positive payment row that
// restores the debt on the customer's CURRENT chain (snapshot + parent
// mirror), with both rows cross-annotated. The audit engine understands
// positive payment rows as reversals (sign-aware paid sums).
paymentsRouter.route('/reversePayment/:accountID/:userID').post(requireAdmin,jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitized = sanitizeFields(req.body.payment || {});
      const { message, reversalFields, reversal, cancelledPrepayment } = await reversePayment(db, {
         accountId: Number(req.params.accountID),
         // Audit trail: the AUTHENTICATED user, never the caller-supplied URL :userID.
         userId: Number(req.user?.user_id),
         paymentId: Number(sanitized.paymentID),
         reason: (sanitized.reason || '').trim()
      });
      return returnTablesWithSuccessResponse(db, res, reversalFields, message, {payments:[reversal],retainers:cancelledPrepayment?[cancelledPrepayment]:[]});
   } catch (err) {
      console.log(err);
      res.status(err.code==='RECEIPT_APPLICATION_LOCKED'?409:200).send({
         message: err.message || 'An error occurred while reversing the payment.',
         status: err.code==='RECEIPT_APPLICATION_LOCKED'?409:500
      });
   }
});

// Get single payment. A malformed id is answered exactly like a missing one —
// it never reaches Postgres (whose driver error would echo the SQL back).
const PAYMENT_NOT_FOUND = { message: 'No matching payment record found.', status: 404 };
paymentsRouter.route('/getSinglePayment/:paymentID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   try {
      const { accountID } = req.params;
      const paymentID = positiveIntOrNull(req.params.paymentID);
      if (!paymentID) return res.send(PAYMENT_NOT_FOUND);

      const activePayments = await paymentsService.getSinglePayment(db, paymentID, accountID);

      if (!activePayments.length) return res.send(PAYMENT_NOT_FOUND);

      // Return Object
      const activePaymentData = {
         activePayments,
         grid: createGrid(activePayments)
      };

      res.send({
         activePaymentData,
         message: 'Successfully retrieved single payment.',
         status: 200
      });
   } catch (err) {
      console.log(err);
      res.send({
         message: clientSafeMessage(err, 'An error occurred while retrieving the payment.'),
         status: err.code==='RECEIPT_APPLICATION_LOCKED'?409:500
      });
   }
});

// Update a payment. Linkage (customer, invoice snapshot, retainer) comes from
// the STORED row; amount edits re-price the latest snapshot, the parent mirror
// and a retainer draw together (payment-logic.updatePaymentCore).
paymentsRouter.route('/updatePayment/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      validateLedgerInput(req.body.payment, 'payment', { update: true });
      const sanitizedUpdatedPayment = sanitizeFields(req.body.payment || {});
      validateLedgerInput(sanitizedUpdatedPayment, 'payment', { update: true });

      // Create new object with sanitized fields
      const paymentTableFields = restoreDataTypesPaymentsTableOnUpdate(sanitizedUpdatedPayment);
      // Trust the account from the (guard-verified) URL, never the request body.
      paymentTableFields.account_id = Number(req.params.accountID);

      const { message } = await updatePaymentCore(db, { accountId: paymentTableFields.account_id, paymentFields: paymentTableFields });
      return returnTablesWithSuccessResponse(db, res, paymentTableFields, message, async()=>({payments:await paymentsService.getSinglePayment(db,paymentTableFields.payment_id,paymentTableFields.account_id)}));
   } catch (err) {
      console.log(err);
      res.status(err.code==='RECEIPT_APPLICATION_LOCKED'?409:err.inputValidation ? 400 : 200).send({
         message: err.message || 'An error occurred while updating the Payment.',
         status: err.code==='RECEIPT_APPLICATION_LOCKED'?409:err.inputValidation ? 400 : 500
      });
   }
});

// Delete a payment. Only the payment id is taken from the body; everything
// else (customer, snapshot, retainer draw, prepayment, reversal link) comes from
// the stored rows (payment-logic.deletePaymentCore).
paymentsRouter.route('/deletePayment/:accountID/:userID').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedPayment = sanitizeFields(req.body.payment || {});

      // Create new object with sanitized fields
      const paymentTableFields = restoreDataTypesPaymentsTableOnUpdate(sanitizedUpdatedPayment);
      // Trust the account from the (guard-verified) URL, never the request body.
      paymentTableFields.account_id = Number(req.params.accountID);

      const { message } = await deletePaymentCore(db, { accountId: paymentTableFields.account_id, paymentId: paymentTableFields.payment_id });
      return returnTablesWithSuccessResponse(db, res, paymentTableFields, message, {deletedPayments:[paymentTableFields.payment_id]});
   } catch (err) {
      console.log(err);
      res.status(err.code==='RECEIPT_APPLICATION_LOCKED'?409:200).send({
         message: err.message || 'An error occurred while deleting the Payment.',
         status: err.code==='RECEIPT_APPLICATION_LOCKED'?409:500
      });
   }
});

module.exports = paymentsRouter;

// Get paginated payments
paymentsRouter.route('/getPayments/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { search = '' } = req.query;

   try {
      const { page, limit, offset } = getPaginationParams({
         page: req.query.page || 1,
         limit: req.query.limit || 20
      });

      const { payments, totalCount } = await paymentsService.getActivePaymentsPaginated(db, accountID, {
         limit,
         offset,
         searchTerm: typeof search === 'string' ? search.trim() : ''
      });

      const grid = createGrid(payments);
      const pagination = getPaginationMetadata(totalCount, page, limit);

      return res.status(200).send({
         paymentsList: {
            activePaymentsData: {
               activePayments: payments,
               grid,
               pagination,
               searchTerm: typeof search === 'string' ? search.trim() : ''
            }
         },
         message: 'Successfully retrieved payments.',
         status: 200
      });
   } catch (error) {
      console.error('Error fetching paginated payments:', error);
      const isPaginationError = error.message && error.message.includes('Invalid pagination');
      const statusCode = isPaginationError ? 400 : 500;
      res.status(statusCode).send({
         message: error.message || 'An error occurred while retrieving payments.',
         status: statusCode
      });
   }
});
