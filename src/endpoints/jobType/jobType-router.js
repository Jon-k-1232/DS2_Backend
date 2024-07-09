const express = require('express');
const jobTypeRouter = express.Router();
const jobTypeService = require('./jobType-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils');
const { restoreDataTypesJobTypeTableOnCreate, restoreDataTypesJobTypeTableOnUpdate } = require('./jobTypeObjects');
const { createGrid } = require('../../helperFunctions/helperFunctions');
const jobService = require('../job/job-service');

// Create a new jobType
jobTypeRouter.route('/createJobType/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedNewJobType = sanitizeFields(req.body.jobType);

      // Create new object with sanitized fields
      const jobTypeTableFields = restoreDataTypesJobTypeTableOnCreate(sanitizedNewJobType);

      // Post new jobType
      await jobTypeService.createJobType(db, jobTypeTableFields);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error creating jobType.',
         status: 500
      });
   }
});

// Get single jobType
jobTypeRouter
   .route('/getSingleJobType/:jobTypeID/:account/:userID')
   // .all( requireAuth )
   .get(async (req, res) => {
      const db = req.app.get('db');
      const { jobTypeID, account } = req.params;

      const activeJobs = await jobTypeService.getSingleJobType(db, jobTypeID, account);

      const activeJobData = {
         activeJobs,
         grid: createGrid(activeJobs)
      };

      res.send({
         activeJobData,
         message: 'Successfully retrieved single jobType.',
         status: 200
      });
   });

// Update a jobType
jobTypeRouter.route('/updateJobType/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedUpdatedJobType = sanitizeFields(req.body.jobType);
      // Create new object with sanitized fields
      const jobTypeTableFields = restoreDataTypesJobTypeTableOnUpdate(sanitizedUpdatedJobType);

      // Update jobType
      await jobTypeService.updateJobType(db, jobTypeTableFields);
      sendUpdatedTableWith200Response(db, res, accountID);
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error updating jobType.',
         status: 500
      });
   }
});

// Delete a jobType
jobTypeRouter.route('/deleteJobType/:jobTypeID/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');
   const { jobTypeID, accountID } = req.params;

   try {
      const foundJobs = await jobService.getSingleJobType(db, jobTypeID, accountID);
      if (foundJobs.length) throw new Error('Cannot delete jobType that is in use.');

      // Delete jobType
      await jobTypeService.deleteJobType(db, jobTypeID);
      sendUpdatedTableWith200Response(db, res, accountID);
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error deleting jobType.',
         status: 500
      });
   }
});

module.exports = jobTypeRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID) => {
   // Get all jobTypes
   const jobTypesData = await jobTypeService.getActiveJobTypes(db, accountID);

   const activeJobTypesData = {
      jobTypesData,
      grid: createGrid(jobTypesData)
   };

   res.send({
      jobTypesList: { activeJobTypesData },
      message: 'Successfully deleted jobType.',
      status: 200
   });
};
