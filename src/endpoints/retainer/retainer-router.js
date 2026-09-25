const { committedResponse } = require('../../utils/committedResponse');
const { validateLedgerInput } = require('../../utils/ledgerInput');
const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const retainerRouter = express.Router();
retainerRouter.param('accountID', enforceAccountId);
const retainerService = require('./retainer-service');
const { restoreDataTypesRetainersTableOnCreate, restoreDataTypesRetainersTableOnUpdate } = require('./retainerObjects');
const { createRetainerCore, updateRetainerCore, deleteRetainerCore } = require('./retainer-logic');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');

// Create a new retainer
retainerRouter.route('/createRetainer/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      validateLedgerInput(req.body.retainer, 'retainer', { update: false });
      const sanitizedNewRetainer = sanitizeFields(req.body.retainer || {});
      validateLedgerInput(sanitizedNewRetainer, 'retainer', { update: false });

      // Create new object with sanitized fields
      const retainerTableFields = restoreDataTypesRetainersTableOnCreate(sanitizedNewRetainer);
      // Audit trail: the AUTHENTICATED user, never a caller-supplied id
      // (loggedByUserID in the body or the URL :userID).
      if (req.user?.user_id) retainerTableFields.created_by_user_id = Number(req.user.user_id);

      // Post new retainer. The account comes from the (guard-verified) URL and
      // the customer must belong to it; see retainer-logic.createRetainerCore.
      await require('../payments/ledger-helpers').withTransaction(db, async trx => {
         await require('../../utils/ledgerAction').actionContext(trx, Number(req.user.user_id), 'Manual retainer entry');
         const row = await createRetainerCore(trx, { accountId: Number(accountID), retainerFields: retainerTableFields });
         await require('../duplicates/duplicates-service').detectCreated(trx, 'retainer', row, Number(req.user.user_id));
      });
      await sendUpdatedTableWith200Response(db, res, accountID, 'Successfully created new retainer.');
   } catch (err) {
      console.log(err);
      res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 200).send({
         message: err.message || 'An error occurred while creating the Retainer.',
         status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 500
      });
   }
});

// Update a retainer
retainerRouter.route('/updateRetainer/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      validateLedgerInput(req.body.retainer, 'retainer', { update: true });
      const sanitizedUpdatedRetainer = sanitizeFields(req.body.retainer || {});
      validateLedgerInput(sanitizedUpdatedRetainer, 'retainer', { update: true });

      // Create new object with sanitized fields
      const retainerTableFields = restoreDataTypesRetainersTableOnUpdate(sanitizedUpdatedRetainer);
      // Trust the account from the (guard-verified) URL, never the request body.
      retainerTableFields.account_id = Number(accountID);

      // Update retainer — preserves the chain's draw history (balance shifts by
      // the starting-amount delta; active flag follows the balance).
      await updateRetainerCore(db, { accountId: Number(accountID), retainerFields: retainerTableFields });
      await sendUpdatedTableWith200Response(db, res, accountID, 'Successfully updated retainer.');
   } catch (err) {
      console.log(err);
      res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 200).send({
         message: err.message || 'An error occurred while updating the Retainer.',
         status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 500
      });
   }
});

// Delete a retainer
retainerRouter.route('/deleteRetainer/:retainerID/:accountID/:userID').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { retainerID, accountID } = req.params;

   try {
      // Refuses while ANY row of the retainer's chain is referenced by a
      // transaction or payment, or the chain has draw-down snapshots (draws
      // reference the snapshot ids, so checking only this row missed them).
      await deleteRetainerCore(db, { accountId: Number(accountID), retainerId: Number(retainerID) });
      await sendUpdatedTableWith200Response(db, res, accountID, 'Successfully deleted retainer.');
   } catch (err) {
      console.log(err);
      res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : 200).send({
         message: err.message || 'An error occurred while deleting the Retainer.',
         status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : 500
      });
   }
});

// get single retainer
retainerRouter.route('/getSingleRetainer/:retainerID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');

   try {
      const { retainerID, accountID } = req.params;
      // Validate before querying: a malformed id must not reach SQL, and an
      // unknown/other-tenant id is a clean 404 rather than a generic failure.
      const retainerId = Number(retainerID);
      if (!Number.isInteger(retainerId) || retainerId <= 0) {
         return res.send({ message: 'No matching retainer record found.', status: 404 });
      }
      const activeRetainer = await retainerService.getSingleRetainer(db, accountID, retainerId);

      if (!activeRetainer.length) {
         return res.send({ message: 'No matching retainer record found.', status: 404 });
      }

      const activeRetainerData = {
         activeRetainer,
         grid: createGrid(activeRetainer),
         treeGrid: generateTreeGridData(activeRetainer, 'retainer_id', 'parent_retainer_id')
      };

      res.send({
         activeRetainerData,
         message: 'Successfully retrieved single retainer.',
         status: 200
      });
   } catch (err) {
      res.send({
         message: 'Failure to retrieve single retainer.',
         status: 500
      });
   }
});

// Get active retainers for a customer
retainerRouter.route('/getActiveRetainers/:customerID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID, customerID } = req.params;
   try {
      const activeRetainers = await retainerService.getMostRecentRecordOfCustomerRetainers(db, accountID, customerID);

      const activeRetainerData = {
         activeRetainers,
         grid: createGrid(activeRetainers),
         treeGrid: generateTreeGridData(activeRetainers, 'retainer_id', 'parent_retainer_id')
      };

      res.send({
         activeRetainerData,
         message: 'Successfully retrieved active retainers.',
         status: 200
      });
   } catch (err) {
      res.send({
         message: 'Failure to retrieve active retainers.',
         status: 500
      });
   }
});

const eventService = require('./retainer-events');
const { route: eventRoute } = require('../../utils/ledgerAction');
retainerRouter.get('/:retainerID/events/:accountID/:userID', eventRoute(req => eventService.history(req.app.get('db'), Number(req.params.accountID), req.params.retainerID)));
retainerRouter.post('/:retainerID/events/:accountID/:userID', jsonParser, eventRoute(req => eventService.createEvent(req.app.get('db'), {accountId:Number(req.params.accountID),actorId:Number(req.user.user_id),retainerId:req.params.retainerID,body:req.body})));

module.exports = retainerRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID, message = 'Successfully created new retainer.') => {
   return committedResponse(res, message, async () => {
      // Get all retainers
      const activeRetainers = await retainerService.getActiveRetainers(db, accountID);

      const activeRetainerData = {
         activeRetainers,
         grid: createGrid(activeRetainers),
         treeGrid: generateTreeGridData(activeRetainers, 'retainer_id', 'parent_retainer_id')
      };

      return {
         accountRetainersList: { activeRetainerData },
         message,
         status: 200
      };
   });
};
