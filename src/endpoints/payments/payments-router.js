const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const paymentsRouter = express.Router();
const paymentsService = require('./payments-service');
const invoiceService = require('../invoice/invoice-service');
const retainersService = require('../retainer/retainer-service');
const { restoreDataTypesPaymentsTableOnCreate, restoreDataTypesPaymentsTableOnUpdate } = require('./paymentsObjects');
const { createGrid } = require('../../utils/gridFunctions');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const { findInvoice, updateObjectsWithRemainingAmounts, checkIfPaymentIsAttachedToInvoice, returnTablesWithSuccessResponse } = require('./payment-logic');
const { findMatchingRetainer } = require('../retainer/retainer-logic');

// Create a new payment
paymentsRouter.route('/createPayment/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedNewPayment = sanitizeFields(req.body.payment);
      const paymentTableFields = restoreDataTypesPaymentsTableOnCreate(sanitizedNewPayment);
      const { customer_invoice_id, account_id, payment_amount, retainer_id } = paymentTableFields;

      if (!customer_invoice_id) {
         throw new Error('No invoice ID provided for this payment.');
      }

      // Need to find the invoice that the payment is being applied to
      const matchingInvoice = await findInvoice(db, customer_invoice_id, account_id, payment_amount);
      const insertionObjects = updateObjectsWithRemainingAmounts(matchingInvoice, paymentTableFields);
      const { paymentInsertionObject, invoiceInsertionObject } = insertionObjects;

      // Handle for if a retainer/prepayment is being used to pay the invoice
      if (retainer_id) {
         const matchingRetainer = await findMatchingRetainer(db, retainer_id, account_id, payment_amount);
         const newRemainingRetainerAmount = Number(matchingRetainer.current_amount) + Math.abs(payment_amount);
         const newRetainerParentID = matchingRetainer.parent_retainer_id ? matchingRetainer.parent_retainer_id : matchingRetainer.retainer_id;
         delete matchingRetainer.retainer_id;
         delete matchingRetainer.created_at;
         const updatedRetainer = { ...matchingRetainer, current_amount: newRemainingRetainerAmount, parent_retainer_id: newRetainerParentID };
         await retainersService.createRetainer(db, updatedRetainer);
      }

      // Need to insert a new invoice first before payments because payments needs the customer_invoice_id to link the payment with the invoice change record.
      const newInvoiceRecord = await invoiceService.createInvoice(db, invoiceInsertionObject);
      const paymentInsertionWithInvoiceID = { ...paymentInsertionObject, customer_invoice_id: newInvoiceRecord.customer_invoice_id };

      // Post the new payment
      await paymentsService.createPayment(db, paymentInsertionWithInvoiceID);

      const message = 'Successfully created payment.';

      return returnTablesWithSuccessResponse(db, res, paymentTableFields, message);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while creating the Payment.',
         status: 500
      });
   }
});

// Get single payment
paymentsRouter.route('/getSinglePayment/:paymentID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   try {
      const { paymentID, accountID } = req.params;

      const activePayments = await paymentsService.getSinglePayment(db, paymentID, accountID);

      if (!activePayments.length) throw new Error('No matching payment record found.');

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
         message: err.message || 'An error occurred while updating the Payment.',
         status: 500
      });
   }
});

// Update a payment
paymentsRouter.route('/updatePayment/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedPayment = sanitizeFields(req.body.payment);

      // Create new object with sanitized fields
      const paymentTableFields = restoreDataTypesPaymentsTableOnUpdate(sanitizedUpdatedPayment);
      const { customer_invoice_id, account_id, payment_amount, payment_id } = paymentTableFields;

      // If payment is invoiced, do not allow update
      await checkIfPaymentIsAttachedToInvoice(db, paymentTableFields);

      // Get payment record
      const [matchingPayment] = await paymentsService.getSinglePayment(db, payment_id, account_id);
      const { payment_amount: DbPaymentAmount, customer_invoice_id: DbCustomerInvoiceID } = matchingPayment || {};

      // ToDo - re write this if block to update the invoice object with whatever new values need to be insert. factors = customerID change, invoiceID change, amount change, invoice Number change
      if (DbPaymentAmount !== payment_amount || DbCustomerInvoiceID !== customer_invoice_id) {
         // Get invoice record, update invoice, update payment
         const [matchingInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, customer_invoice_id);
         const { remaining_balance_on_invoice } = matchingInvoice || {};
         const preOriginalPaymentInvoiceAmount = Math.abs(DbPaymentAmount) + remaining_balance_on_invoice;
         const newInvoiceRemaining = preOriginalPaymentInvoiceAmount + payment_amount;

         // update Invoice Object
         matchingInvoice.remaining_balance_on_invoice = newInvoiceRemaining;
         matchingInvoice.is_invoice_paid_in_full = newInvoiceRemaining === 0 ? true : false;
         matchingInvoice.fully_paid_date = newInvoiceRemaining === 0 ? new Date() : null;

         // Update invoice
         await invoiceService.updateInvoice(db, matchingInvoice);
      }

      // Update payment
      await paymentsService.updatePayment(db, paymentTableFields);

      const message = 'Successfully updated payment.';
      return returnTablesWithSuccessResponse(db, res, paymentTableFields, message);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the Payment.',
         status: 500
      });
   }
});

// Delete a payment
paymentsRouter.route('/deletePayment/:accountID/:userID').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedPayment = sanitizeFields(req.body.payment);

      // Create new object with sanitized fields
      const paymentTableFields = restoreDataTypesPaymentsTableOnUpdate(sanitizedUpdatedPayment);
      const { payment_id, account_id } = paymentTableFields;

      const records = await checkIfPaymentIsAttachedToInvoice(db, paymentTableFields);
      const { retainerRecord, paymentInvoiceRecord } = records;

      // Retainer used on payment, delete retainer
      if (Object.keys(retainerRecord).length) {
         await retainersService.deleteRetainer(db, retainerRecord.retainer_id, account_id);
      }

      // Delete the payment and the invoice
      await invoiceService.deleteInvoice(db, paymentInvoiceRecord.customer_invoice_id);
      await paymentsService.deletePayment(db, payment_id);

      const message = 'Successfully deleted payment.';
      return returnTablesWithSuccessResponse(db, res, paymentTableFields, message);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while deleting the Payment.',
         status: 500
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
