const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const writeOffsRouter = express.Router();
writeOffsRouter.param('accountID', enforceAccountId);
const writeOffsService = require('./writeOffs-service');
const invoiceService = require('../invoice/invoice-service');
const { restoreDataTypesWriteOffsTableOnCreate, restoreDataTypesWriteOffsTableOnUpdate } = require('./writeOffsObjects');
const { createWriteOffCore, updateWriteOffCore, deleteWriteOffCore } = require('./writeOffs-logic');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');

// Create a new WriteOff. Invoice-linked write-offs follow the payment rules:
// current chain only (absorbed references are remapped and annotated), same
// customer only, snapshot + parent mirror in ONE transaction under the
// customer's ledger lock (writeOffs-logic.createWriteOffCore).
writeOffsRouter.route('/createWriteOffs/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const accountID = Number(req.params.accountID);

   try {
      const sanitizedNewWriteOffs = sanitizeFields(req.body.writeOff || {});

      // Create new object with sanitized fields
      const writeOffTableFields = restoreDataTypesWriteOffsTableOnCreate(sanitizedNewWriteOffs);
      // Audit trail: the AUTHENTICATED user, never a caller-supplied id
      // (loggedByUserID in the body or the URL :userID).
      if (req.user?.user_id) writeOffTableFields.created_by_user_id = Number(req.user.user_id);

      // Trust the account from the (guard-verified) URL, never the request body.
      const { message } = await createWriteOffCore(db, { accountId: accountID, writeOffFields: writeOffTableFields });

      await sendUpdatedTableWith200Response(db, res, accountID, message);
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

   try {
      // Validate before querying: a malformed id must not reach SQL (it leaked
      // the driver's error text) and an unknown/other-tenant id is a clean 404.
      const writeOffId = Number(writeOffID);
      if (!Number.isInteger(writeOffId) || writeOffId <= 0) {
         return res.send({ message: 'No matching write-off record found.', status: 404 });
      }
      const activeWriteOffs = await writeOffsService.getSingleWriteOff(db, writeOffId, accountID);
      if (!activeWriteOffs.length) {
         return res.send({ message: 'No matching write-off record found.', status: 404 });
      }

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
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while retrieving the writeOff.',
         status: 500
      });
   }
});

// update a writeOff. Refused once billed (stored-row customer, newest parent
// created_at); linkage is server-owned; amount edits re-price the latest
// snapshot + parent mirror (writeOffs-logic.updateWriteOffCore).
writeOffsRouter.route('/updateWriteOffs/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedWriteOffs = sanitizeFields(req.body.writeOff || {});

      // Create new object with sanitized fields
      const writeOffTableFields = restoreDataTypesWriteOffsTableOnUpdate(sanitizedUpdatedWriteOffs);
      // Trust the account from the (guard-verified) URL, never the request body.
      writeOffTableFields.account_id = Number(req.params.accountID);
      const { account_id } = writeOffTableFields;

      const { message } = await updateWriteOffCore(db, { accountId: account_id, writeOffFields: writeOffTableFields });

      await sendUpdatedTableWith200Response(db, res, account_id, message);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the writeOff.',
         status: 500
      });
   }
});

// delete a writeOff — symmetric to deletePayment (writeOffs-logic.deleteWriteOffCore).
writeOffsRouter.route('/deleteWriteOffs/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');

   try {
      const sanitizedUpdatedWriteOffs = sanitizeFields(req.body.writeOff || {});

      // Create new object with sanitized fields
      const writeOffTableFields = restoreDataTypesWriteOffsTableOnUpdate(sanitizedUpdatedWriteOffs);
      writeOffTableFields.account_id = Number(req.params.accountID);
      const { writeoff_id, account_id } = writeOffTableFields;

      // Only the id is taken from the body; the linkage comes from the stored row.
      const { message } = await deleteWriteOffCore(db, { accountId: account_id, writeoffId: writeoff_id });

      await sendUpdatedTableWith200Response(db, res, account_id, message);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while deleting the writeOff.',
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

const sendUpdatedTableWith200Response = async (db, res, accountID, message) => {
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
      message,
      status: 200
   });
};
