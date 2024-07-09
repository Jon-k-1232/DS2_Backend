const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils');
const writeOffsRouter = express.Router();
const writeOffsService = require('./writeOffs-service');
const invoiceService = require('../invoice/invoice-service');
const { restoreDataTypesWriteOffsTableOnCreate, restoreDataTypesWriteOffsTableOnUpdate, convertWriteOffToPayment } = require('./writeOffsObjects');
const { createGrid, generateTreeGridData } = require('../../helperFunctions/helperFunctions');
const { unableToCompleteRequest } = require('../../serverResponses/errors');
const { findInvoice, updateObjectsWithRemainingAmounts } = require('../payments/payment-logic');

// Create a new WriteOff
writeOffsRouter.route('/createWriteOffs/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedNewWriteOffs = sanitizeFields(req.body.writeOff);

      // Create new object with sanitized fields
      const writeOffTableFields = restoreDataTypesWriteOffsTableOnCreate(sanitizedNewWriteOffs);
      const { customer_invoice_id, account_id, writeoff_amount } = writeOffTableFields;

      // Condition for if an invoice is selected for write off rather than a job.
      if (customer_invoice_id) {
         // in order to reuse the payment logic, we need to convert the write off object to a payment object
         const paymentTableFields = convertWriteOffToPayment(writeOffTableFields);
         // reusing the payment logic to create a invoice record for the write off
         const matchingInvoice = await findInvoice(db, customer_invoice_id, account_id, writeoff_amount, paymentTableFields);
         const newInsertionObjects = updateObjectsWithRemainingAmounts(matchingInvoice, paymentTableFields);
         const { invoiceInsertionObject } = newInsertionObjects;
         // Need to insert invoice first before write offs because payments needs the customer_invoice_id to link the payment with the invoice change record.
         const newInvoiceRecord = await invoiceService.createInvoice(db, invoiceInsertionObject);
         // This gets the new invoice id from the payment logic
         const newInvoiceID = newInvoiceRecord?.customer_invoice_id;
         // Update the write off object with the new invoice id. We need the updated invoice number for if an edit or deletion to the write off is completed.
         writeOffTableFields.customer_invoice_id = newInvoiceID;
      }

      // Post new writeOff
      await writeOffsService.createWriteOff(db, writeOffTableFields);

      sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while creating the writeOff.',
         status: 500
      });
   }
});

// Get a single WriteOff
writeOffsRouter.route('/getSingleWriteOff/:writeOffID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { writeOffID, accountID } = req.params;

   const activeWriteOffs = await writeOffsService.getSingleWriteOff(db, writeOffID, accountID);

   // Return Object
   const activeWriteOffsData = {
      activeWriteOffs,
      grid: createGrid(activeWriteOffs)
   };

   res.send({
      activeWriteOffsData,
      message: 'Successfully retrieved single writeOff.',
      status: 200
   });
});

// update a writeOff
writeOffsRouter.route('/updateWriteOffs/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedWriteOffs = sanitizeFields(req.body.writeOff);

      // Create new object with sanitized fields
      const writeOffTableFields = restoreDataTypesWriteOffsTableOnUpdate(sanitizedUpdatedWriteOffs);
      const { customer_invoice_id, account_id } = writeOffTableFields;

      // If payment is attached to an invoice, do not allow delete
      if (customer_invoice_id) {
         const reason = 'Record is attached to an invoice and cannot be deleted or modified.';
         unableToCompleteRequest(res, reason, 423);
         return;
      }

      // Update writeOff
      await writeOffsService.updateWriteOff(db, writeOffTableFields);

      sendUpdatedTableWith200Response(db, res, account_id);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the writeOff.',
         status: 500
      });
   }
});

// delete a writeOff
writeOffsRouter.route('/deleteWriteOffs/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');

   try {
      const sanitizedUpdatedWriteOffs = sanitizeFields(req.body.writeOff);

      // Create new object with sanitized fields
      const writeOffTableFields = restoreDataTypesWriteOffsTableOnUpdate(sanitizedUpdatedWriteOffs);
      const { customer_invoice_id, writeoff_id, account_id } = writeOffTableFields;

      // find the invoice record to check it exists
      const invoiceRecord = await writeOffsService.getSingleWriteOff(db, writeoff_id, account_id);
      if (!invoiceRecord.length) {
         throw new Error('Unable to find invoice record.');
      }

      // Delete invoice record
      await invoiceService.deleteInvoice(db, customer_invoice_id, account_id);

      // Delete writeOff
      await writeOffsService.deleteWriteOff(db, writeoff_id, account_id);
      sendUpdatedTableWith200Response(db, res, account_id);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while deleting the Retainer.',
         status: 500
      });
   }
});

module.exports = writeOffsRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID) => {
   // Get all writeOff
   const activeWriteOffs = await writeOffsService.getActiveWriteOffs(db, accountID);
   const activeInvoices = await invoiceService.getInvoices(db, accountID);

   // Return Object
   const activeWriteOffsData = {
      activeWriteOffs,
      grid: createGrid(activeWriteOffs)
   };

   const activeInvoiceData = {
      activeInvoices,
      grid: createGrid(activeInvoices),
      treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id')
   };

   res.send({
      invoicesList: { activeInvoiceData },
      writeOffsList: { activeWriteOffsData },
      message: 'Successfully deleted writeOff.',
      status: 200
   });
};
