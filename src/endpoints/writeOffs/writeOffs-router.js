const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const writeOffsRouter = express.Router();
writeOffsRouter.param('accountID', enforceAccountId);
const writeOffsService = require('./writeOffs-service');
const invoiceService = require('../invoice/invoice-service');
const { restoreDataTypesWriteOffsTableOnCreate, restoreDataTypesWriteOffsTableOnUpdate, convertWriteOffToPayment } = require('./writeOffsObjects');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const { unableToCompleteRequest } = require('../../serverResponses/errors');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
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

         // Mirror the reduced balance onto the parent row, same as createPayment —
         // AR/profile/payment pickers read the parent, and without this every
         // invoice write-off leaves the parent telling a stale balance.
         const parentInvoiceID = invoiceInsertionObject.parent_invoice_id;
         const [parentInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, parentInvoiceID);
         if (parentInvoice && Object.keys(parentInvoice).length) {
            parentInvoice.remaining_balance_on_invoice = invoiceInsertionObject.remaining_balance_on_invoice;
            parentInvoice.is_invoice_paid_in_full = invoiceInsertionObject.is_invoice_paid_in_full;
            parentInvoice.fully_paid_date = invoiceInsertionObject.fully_paid_date;
            parentInvoice.total_write_offs = Number(parentInvoice.total_write_offs) + Math.abs(Number(writeoff_amount));
            await invoiceService.updateInvoice(db, parentInvoice);
         }
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
      // Trust the account from the (guard-verified) URL, never the request body.
      writeOffTableFields.account_id = Number(req.params.accountID);
      const { customer_invoice_id, account_id } = writeOffTableFields;

      // If payment is attached to an invoice, do not allow delete
      if (customer_invoice_id) {
         const reason = 'Record is attached to an invoice and cannot be deleted or modified.';
         unableToCompleteRequest(res, reason, 423);
         return;
      }

      // Update writeOff
      await writeOffsService.updateWriteOff(db, writeOffTableFields, account_id);

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
      writeOffTableFields.account_id = Number(req.params.accountID);
      const { writeoff_id, account_id } = writeOffTableFields;

      // Use the stored linkage, never the id the client sends — deleting an
      // arbitrary invoice row via this route was possible otherwise.
      const [writeOffRecord] = await writeOffsService.getSingleWriteOff(db, writeoff_id, account_id);
      if (!writeOffRecord) {
         throw new Error('Unable to find write-off record.');
      }

      // Once a write-off has been counted on a bill, deleting it would silently
      // un-credit a statement the customer already received.
      const lastInvoiceDates = await invoiceService.getLastInvoiceDatesByCustomerID(db, account_id, [writeOffRecord.customer_id]);
      const lastInvoiceDate = lastInvoiceDates[writeOffRecord.customer_id];
      if (lastInvoiceDate && writeOffRecord.created_at <= new Date(lastInvoiceDate)) {
         throw new Error('Write-off is attached to an invoice that has already been billed and cannot be deleted or modified.');
      }

      if (writeOffRecord.customer_invoice_id) {
         const [linkedRow] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, writeOffRecord.customer_invoice_id);

         if (linkedRow && linkedRow.parent_invoice_id) {
            // Same ordering rule as payments: later snapshots bake this
            // write-off's reduction into their remaining.
            const latestChild = await invoiceService.getLatestChildInvoice(db, account_id, linkedRow.parent_invoice_id);
            if (latestChild && latestChild.customer_invoice_id !== linkedRow.customer_invoice_id) {
               throw new Error('A newer payment or write-off has been applied to this invoice since this write-off. Delete the newer entries first, then retry.');
            }

            // Reverse the parent mirror before removing the snapshot.
            const [parentInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, account_id, linkedRow.parent_invoice_id);
            if (parentInvoice && Object.keys(parentInvoice).length) {
               const reversedAmount = Math.abs(Number(writeOffRecord.writeoff_amount));
               parentInvoice.remaining_balance_on_invoice = Number(parentInvoice.remaining_balance_on_invoice) + reversedAmount;
               parentInvoice.is_invoice_paid_in_full = false;
               parentInvoice.fully_paid_date = null;
               parentInvoice.total_write_offs = Math.max(0, Number(parentInvoice.total_write_offs) - reversedAmount);
               await invoiceService.updateInvoice(db, parentInvoice);
            }

            await invoiceService.deleteInvoice(db, linkedRow.customer_invoice_id, account_id);
         }
         // Legacy write-offs may point directly at the parent row — never delete it.
      }

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

// Paginated write-offs list
writeOffsRouter.route('/getWriteOffs/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { search = '' } = req.query;

   try {
      const { page, limit, offset } = getPaginationParams({
         page: req.query.page || 1,
         limit: req.query.limit || 20
      });

      const { writeoffs, totalCount } = await writeOffsService.getActiveWriteOffsPaginated(db, accountID, {
         limit,
         offset,
         searchTerm: typeof search === 'string' ? search.trim() : ''
      });

      const grid = createGrid(writeoffs);
      const pagination = getPaginationMetadata(totalCount, page, limit);

      return res.status(200).send({
         writeOffsList: {
            activeWriteOffsData: {
               activeWriteOffs: writeoffs,
               grid,
               pagination,
               searchTerm: typeof search === 'string' ? search.trim() : ''
            }
         },
         message: 'Successfully retrieved write-offs.',
         status: 200
      });
   } catch (error) {
      console.error('Error fetching paginated write-offs:', error);
      const isPaginationError = error.message && error.message.includes('Invalid pagination');
      const statusCode = isPaginationError ? 400 : 500;
      res.status(statusCode).send({
         message: error.message || 'An error occurred while retrieving write-offs.',
         status: statusCode
      });
   }
});

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
