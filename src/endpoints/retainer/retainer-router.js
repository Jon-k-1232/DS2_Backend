const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils');
const retainerRouter = express.Router();
const retainerService = require('./retainer-service');
const { restoreDataTypesRetainersTableOnCreate, restoreDataTypesRetainersTableOnUpdate } = require('./retainerObjects');
const { createGrid, generateTreeGridData } = require('../../helperFunctions/helperFunctions');
const transactionsService = require('../transactions/transactions-service');

// Create a new retainer
retainerRouter.route('/createRetainer/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedNewRetainer = sanitizeFields(req.body.retainer);

      // Create new object with sanitized fields
      const retainerTableFields = restoreDataTypesRetainersTableOnCreate(sanitizedNewRetainer);

      // Post new retainer
      await retainerService.createRetainer(db, retainerTableFields);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while creating the Retainer.',
         status: 500
      });
   }
});

// Update a retainer
retainerRouter.route('/updateRetainer/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedUpdatedRetainer = sanitizeFields(req.body.retainer);

      // Create new object with sanitized fields
      const retainerTableFields = restoreDataTypesRetainersTableOnUpdate(sanitizedUpdatedRetainer);

      // Update retainer
      await retainerService.updateRetainer(db, retainerTableFields);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the Retainer.',
         status: 500
      });
   }
});

// Delete a retainer
retainerRouter.route('/deleteRetainer/:retainerID/:accountID/:userID').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { retainerID, accountID } = req.params;

   try {
      // Check transactions table for retainerID. If transactions exist it mean the reatiner is linked to a transaction and cannot be deleted
      const linkedTransactions = await transactionsService.getTransactionsByRetainerID(db, retainerID);

      if (linkedTransactions.length) throw new Error('Transactions are linked to retainer: ' + error.message);

      // Delete retainer
      await retainerService.deleteRetainer(db, retainerID, accountID);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while deleting the Retainer.',
         status: 500
      });
   }
});

// get single retainer
retainerRouter.route('/getSingleRetainer/:retainerID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');

   try {
      const { retainerID, accountID } = req.params;
      const activeRetainer = await retainerService.getSingleRetainer(db, accountID, retainerID);

      if (!activeRetainer.length) throw new Error('Error no retainer found: ' + error.message);

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

module.exports = retainerRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID) => {
   // Get all retainers
   const activeRetainers = await retainerService.getActiveRetainers(db, accountID);

   const activeRetainerData = {
      activeRetainers,
      grid: createGrid(activeRetainers),
      treeGrid: generateTreeGridData(activeRetainers, 'retainer_id', 'parent_retainer_id')
   };

   res.send({
      accountRetainersList: { activeRetainerData },
      message: 'Successfully created new retainer.',
      status: 200
   });
};
