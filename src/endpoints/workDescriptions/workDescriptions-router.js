const express = require('express');
const workDescriptionsRouter = express.Router();
const workDescriptionService = require('./workDescriptions-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils');
const { restoreDataTypesWorkDescriptionTableOnCreate, restoreDataTypesWorkDescriptionTableOnUpdate } = require('./workDescriptionsObjects');
const { createGrid } = require('../../helperFunctions/helperFunctions');

// Create a new workDescription
workDescriptionsRouter.route('/createWorkDescription/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID, userID } = req.params;

   try {
      const sanitizedNewWorkDescription = sanitizeFields(req.body.workDescription);
      // Create new object with sanitized fields
      const workDescriptionTableFields = restoreDataTypesWorkDescriptionTableOnCreate(sanitizedNewWorkDescription, accountID, userID);

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
      const workDescriptionData = await workDescriptionService.getSingleWorkDescription(db, workDescriptionID);

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

      // Update workDescription
      await workDescriptionService.updateWorkDescription(db, workDescriptionTableFields);
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
      // Delete workDescription
      await workDescriptionService.deleteWorkDescription(db, workDescriptionID);
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
