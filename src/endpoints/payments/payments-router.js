const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const paymentsRouter = express.Router();
paymentsRouter.param('accountID', enforceAccountId);
const paymentsService = require('./payments-service');
const invoiceService = require('../invoice/invoice-service');
const retainersService = require('../retainer/retainer-service');
const { restoreDataTypesPaymentsTableOnCreate, restoreDataTypesPaymentsTableOnUpdate } = require('./paymentsObjects');
const { createGrid } = require('../../utils/gridFunctions');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const { getCurrentChainTargets, updateObjectsWithRemainingAmounts, checkIfPaymentIsAttachedToInvoice, returnTablesWithSuccessResponse } = require('./payment-logic');
const { findMatchingRetainer } = require('../retainer/retainer-logic');

// Create a new payment
paymentsRouter.route('/createPayment/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedNewPayment = sanitizeFields(req.body.payment);
      const paymentTableFields = restoreDataTypesPaymentsTableOnCreate(sanitizedNewPayment);
      // Trust the account from the (guard-verified) URL, never the request body.
      paymentTableFields.account_id = Number(req.params.accountID);
      const { customer_invoice_id, customer_id, account_id, payment_amount, retainer_id } = paymentTableFields;

      if (!customer_invoice_id) {
         throw new Error('No invoice ID provided for this payment. If the customer has no open invoice, record the funds as a retainer/prepayment instead.');
      }

      // The row the user picked — existence and ownership checks only; the
      // amount is validated against the customer's CURRENT chain below.
      const [requestedInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, customer_invoice_id);
      if (!requestedInvoice || !Object.keys(requestedInvoice).length) {
         throw new Error('No matching invoice record found for this payment.');
      }
      if (Number(requestedInvoice.customer_id) !== Number(customer_id)) {
         throw new Error(`Invoice ${requestedInvoice.invoice_number} belongs to a different customer than this payment. Re-select the invoice.`);
      }

      // ROLLING-BALANCE GUARD. A payment may only reduce the customer's
      // current chain — older chains have been absorbed into a newer
      // beginning_balance and the billing engine's date gate never reads them,
      // so money applied there silently vanishes from every future bill.
      // If the user referenced an absorbed invoice, remap to the current chain
      // and record both numbers on the payment.
      const targets = await getCurrentChainTargets(db, account_id, customer_id);
      if (!targets.length) {
         throw new Error('This customer has no invoices to apply a payment to. Record the funds as a retainer/prepayment instead.');
      }

      const requestedRootID = requestedInvoice.parent_invoice_id || requestedInvoice.customer_invoice_id;
      let target = targets.find(t => t.parent.customer_invoice_id === requestedRootID);
      let remapMessage = '';

      if (!target) {
         target = targets.reduce((best, t) => (t.remaining > best.remaining ? t : best), targets[0]);
         if (target.remaining <= 0) {
            throw new Error(
               `Invoice ${requestedInvoice.invoice_number} was already rolled into a newer statement, and the current invoice ${target.parent.invoice_number} shows $0 remaining. ` +
                  'Record the funds as a retainer/prepayment, or run an account audit to reconcile the balance.'
            );
         }
         remapMessage = `Applied to current invoice ${target.parent.invoice_number} — the referenced invoice ${requestedInvoice.invoice_number} was already rolled into it.`;
         const marker = `[applied to ${target.parent.invoice_number}; customer referenced ${requestedInvoice.invoice_number}]`;
         paymentTableFields.note = paymentTableFields.note ? `${paymentTableFields.note} ${marker}` : marker;
      }

      if (Math.abs(target.remaining) < Math.abs(payment_amount)) {
         throw new Error(
            `Payment amount exceeds remaining balance on invoice ${target.parent.invoice_number}. Max amount that can be applied to this invoice is $${Math.abs(target.remaining)}.`
         );
      }

      // The chain's latest row carries the authoritative remaining balance —
      // never the row the user happened to pick (it may be the parent or an
      // intermediate snapshot with a stale remaining).
      const matchingInvoice = target.latestRow;
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

      // Sync the parent invoice row so balance lookups don't see a phantom.
      // The child snapshot we just inserted has the authoritative remaining/paid state;
      // mirror it onto the original parent row that customer profile + AR queries read from.
      const parentInvoiceID = invoiceInsertionObject.parent_invoice_id;
      const [parentInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, parentInvoiceID);
      if (parentInvoice && Object.keys(parentInvoice).length) {
         parentInvoice.remaining_balance_on_invoice = invoiceInsertionObject.remaining_balance_on_invoice;
         parentInvoice.is_invoice_paid_in_full = invoiceInsertionObject.is_invoice_paid_in_full;
         parentInvoice.fully_paid_date = invoiceInsertionObject.fully_paid_date;
         parentInvoice.total_payments = Number(parentInvoice.total_payments) + Math.abs(Number(payment_amount));
         await invoiceService.updateInvoice(db, parentInvoice);
      }

      const message = remapMessage ? `Successfully created payment. ${remapMessage}` : 'Successfully created payment.';

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
      // Trust the account from the (guard-verified) URL, never the request body.
      paymentTableFields.account_id = Number(req.params.accountID);
      const { customer_invoice_id, account_id, payment_amount, payment_id } = paymentTableFields;

      // If payment is invoiced, do not allow update
      await checkIfPaymentIsAttachedToInvoice(db, paymentTableFields);

      // Get payment record
      const [matchingPayment] = await paymentsService.getSinglePayment(db, payment_id, account_id);
      if (!matchingPayment) throw new Error('No matching payment record found.');
      const { payment_amount: DbPaymentAmount, customer_invoice_id: DbCustomerInvoiceID } = matchingPayment;

      // Reassigning a payment to a different invoice cannot be expressed as a
      // balance edit (two chains would need correcting) — delete and re-enter.
      if (customer_invoice_id && DbCustomerInvoiceID && Number(customer_invoice_id) !== Number(DbCustomerInvoiceID)) {
         throw new Error('Moving a payment to a different invoice is not supported. Delete the payment and re-enter it against the correct invoice.');
      }
      paymentTableFields.customer_invoice_id = DbCustomerInvoiceID;

      const amountDelta = Math.abs(Number(payment_amount)) - Math.abs(Number(DbPaymentAmount));
      if (amountDelta !== 0) {
         // The payment's snapshot row carries the chain's remaining as of this
         // payment. Only the latest snapshot may be re-priced — later snapshots
         // already build on this one.
         const [snapshotRow] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, DbCustomerInvoiceID);
         if (!snapshotRow || !Object.keys(snapshotRow).length) throw new Error('No matching invoice record found for this payment.');

         if (snapshotRow.parent_invoice_id) {
            const latestChild = await invoiceService.getLatestChildInvoice(db, account_id, snapshotRow.parent_invoice_id);
            if (latestChild && latestChild.customer_invoice_id !== snapshotRow.customer_invoice_id) {
               throw new Error('A newer payment or write-off has been applied to this invoice since this payment. Edit or delete the newer entries first.');
            }
         }

         const newRemaining = Number(snapshotRow.remaining_balance_on_invoice) - amountDelta;
         if (newRemaining < 0) {
            throw new Error(`Payment amount exceeds remaining balance on invoice ${snapshotRow.invoice_number}. Max increase is $${Number(snapshotRow.remaining_balance_on_invoice)}.`);
         }

         snapshotRow.remaining_balance_on_invoice = newRemaining;
         snapshotRow.is_invoice_paid_in_full = newRemaining === 0;
         snapshotRow.fully_paid_date = newRemaining === 0 ? new Date() : null;
         await invoiceService.updateInvoice(db, snapshotRow);

         // Mirror the corrected balance onto the parent row (AR/profile reads).
         if (snapshotRow.parent_invoice_id) {
            const [parentInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, snapshotRow.parent_invoice_id);
            if (parentInvoice && Object.keys(parentInvoice).length) {
               parentInvoice.remaining_balance_on_invoice = newRemaining;
               parentInvoice.is_invoice_paid_in_full = newRemaining === 0;
               parentInvoice.fully_paid_date = newRemaining === 0 ? new Date() : null;
               parentInvoice.total_payments = Math.max(0, Number(parentInvoice.total_payments) + amountDelta);
               await invoiceService.updateInvoice(db, parentInvoice);
            }
         }
      }

      // Update payment
      await paymentsService.updatePayment(db, paymentTableFields, account_id);

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
      // Trust the account from the (guard-verified) URL, never the request body.
      paymentTableFields.account_id = Number(req.params.accountID);
      const { payment_id, account_id } = paymentTableFields;

      const records = await checkIfPaymentIsAttachedToInvoice(db, paymentTableFields);
      const { paymentRecord, retainerRecord, paymentInvoiceRecord } = records;

      // Refuse out-of-order deletion: snapshots created after this payment
      // already bake its reduction into their remaining balance, so removing
      // an earlier payment would leave the chain telling two different stories.
      if (paymentInvoiceRecord?.parent_invoice_id) {
         const latestChild = await invoiceService.getLatestChildInvoice(db, account_id, paymentInvoiceRecord.parent_invoice_id);
         if (latestChild && latestChild.customer_invoice_id !== paymentInvoiceRecord.customer_invoice_id) {
            throw new Error('A newer payment or write-off has been applied to this invoice since this payment. Delete the newer entries first, then retry.');
         }
      }

      // Retainer used on payment, delete retainer
      if (Object.keys(retainerRecord).length) {
         await retainersService.deleteRetainer(db, retainerRecord.retainer_id, account_id);
      }

      // Reverse the parent-invoice sync that createPayment applied. Creating a
      // payment adds a child snapshot AND mirrors the reduced balance onto the
      // parent row (the one AR/profile read), incrementing total_payments.
      // Deleting must undo that, otherwise a create→delete cycle permanently
      // lowers the customer's balance by the payment amount.
      const parentInvoiceID = paymentInvoiceRecord?.parent_invoice_id;
      if (parentInvoiceID) {
         const [parentInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, parentInvoiceID);
         if (parentInvoice && Object.keys(parentInvoice).length) {
            const reversedAmount = Math.abs(Number(paymentRecord.payment_amount));
            parentInvoice.remaining_balance_on_invoice = Number(parentInvoice.remaining_balance_on_invoice) + reversedAmount;
            parentInvoice.is_invoice_paid_in_full = false;
            parentInvoice.fully_paid_date = null;
            parentInvoice.total_payments = Math.max(0, Number(parentInvoice.total_payments) - reversedAmount);
            await invoiceService.updateInvoice(db, parentInvoice);
         }
      }

      // Delete the payment and its child snapshot. Legacy payments (pre-snapshot
      // era) point directly at the PARENT invoice row — never delete that row,
      // it IS the customer's invoice; remove only the payment record.
      if (paymentInvoiceRecord?.parent_invoice_id) {
         await invoiceService.deleteInvoice(db, paymentInvoiceRecord.customer_invoice_id, account_id);
      }
      await paymentsService.deletePayment(db, payment_id, account_id);

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
