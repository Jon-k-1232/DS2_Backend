const express = require('express');
const { enforceAccountId } = require('../auth/account-scope');
const workDescriptionsRouter = express.Router();
workDescriptionsRouter.param('accountID', enforceAccountId);
const workDescriptionService = require('./workDescriptions-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { restoreDataTypesWorkDescriptionTableOnCreate, restoreDataTypesWorkDescriptionTableOnUpdate } = require('./workDescriptionsObjects');
const { createGrid } = require('../../utils/gridFunctions');
const transactionsService = require('../transactions/transactions-service');

// Create a new workDescription
workDescriptionsRouter.route('/createWorkDescription/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID, userID } = req.params;

   try {
      const sanitizedNewWorkDescription = sanitizeFields(req.body.workDescription);
      // Create new object with sanitized fields
      const workDescriptionTableFields = restoreDataTypesWorkDescriptionTableOnCreate(sanitizedNewWorkDescription, accountID, req.user.user_id);

      // Post new workType
      await workDescriptionService.createWorkDescription(db, workDescriptionTableFields);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error creating work description.',
         status: 500
      });
   }
});

// Get single work description
workDescriptionsRouter.route('/getSingleWorkDescription/:workDescriptionID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { workDescriptionID, accountID } = req.params;

   try {
      // Get single work description
      const workDescriptionData = await workDescriptionService.getSingleWorkDescription(db, workDescriptionID, accountID);

      const activeWorkDescriptionData = {
         workDescriptionData,
         grid: createGrid(workDescriptionData)
      };

      res.send({
         activeWorkDescriptionData,
         message: 'Successful',
         status: 200
      });
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error getting workDescription.',
         status: 500
      });
   }
});

// Update workDescription
workDescriptionsRouter.route('/updateWorkDescription/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedUpdatedWorkDescription = sanitizeFields(req.body.workDescription);

      // Create new object with sanitized fields
      const workDescriptionTableFields = restoreDataTypesWorkDescriptionTableOnUpdate(sanitizedUpdatedWorkDescription);
      // Trust the account from the (guard-verified) URL, never the request body.
      workDescriptionTableFields.account_id = Number(accountID);

      // Update workDescription
      const affectedRows = await workDescriptionService.updateWorkDescription(db, workDescriptionTableFields, accountID);
      if (!affectedRows) {
         return res.status(404).send({ message: 'Work description not found.', status: 404 });
      }
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error updating workDescription.',
         status: 500
      });
   }
});

// Delete workDescription
workDescriptionsRouter.route('/deleteWorkDescription/:workDescriptionID/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');
   const { workDescriptionID, accountID } = req.params;

   try {
      // Refuse with a clear message instead of letting a raw FK constraint
      // violation (general_work_description_id is NOT NULL on
      // customer_transactions) bubble up to the client.
      const linkedTransactions = await transactionsService.getTransactionsByGeneralWorkDescriptionID(db, accountID, workDescriptionID);
      if (linkedTransactions.length) {
         throw new Error('This work description is in use by one or more transactions and cannot be deleted.');
      }

      // Delete workDescription
      const affectedRows = await workDescriptionService.deleteWorkDescription(db, workDescriptionID, accountID);
      if (!affectedRows) {
         return res.status(404).send({ message: 'Work description not found.', status: 404 });
      }
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error deleting workDescription.',
         status: 500
      });
   }
});

module.exports = workDescriptionsRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID) => {
   // Get all workTypes
   const workDescriptionsData = await workDescriptionService.getActiveWorkDescriptions(db, accountID);

   const activeWorkDescriptionsData = {
      workDescriptionsData,
      grid: createGrid(workDescriptionsData)
   };

   res.send({
      workDescriptionsList: { activeWorkDescriptionsData },
      message: 'Successful',
      status: 200
   });
};
