const express = require('express');
const jobCategoriesRouter = express.Router();
const jobCategoriesService = require('./jobCategories-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { createGrid } = require('../../utils/gridFunctions');
const { restoreDataTypesJobCategoriesOnCreate, restoreDataTypesJobCategoriesOnUpdate } = require('./jobCategoriesObjects');
const jobTypeService = require('../jobType/jobType-service');

// Create a new job category
jobCategoriesRouter.route('/createJobCategory/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedNewJobCategory = sanitizeFields(req.body.jobCategory);

      // Create new object with sanitized fields
      const jobCategoriesTableFields = restoreDataTypesJobCategoriesOnCreate(sanitizedNewJobCategory);

      // Post new job category
      await jobCategoriesService.createJobCategory(db, jobCategoriesTableFields);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the Job Category.',
         status: 500
      });
   }
});

// Edit a job category
jobCategoriesRouter.route('/updateJobCategory/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedUpdatedJobCategory = sanitizeFields(req.body.jobCategory);

      // Create new object with sanitized fields
      const jobCategoriesTableFields = restoreDataTypesJobCategoriesOnUpdate(sanitizedUpdatedJobCategory);

      // Update the Job category
      await jobCategoriesService.updateJobCategory(db, jobCategoriesTableFields);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the Job Category.',
         status: 500
      });
   }
});

// Delete a job category
jobCategoriesRouter.route('/deleteJobCategory/:jobCategoryID/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');
   const { jobCategoryID, accountID } = req.params;

   try {
      const foundJobTypes = await jobTypeService.getJobTypesByJobCategoryID(db, accountID, jobCategoryID);
      if (foundJobTypes.length) throw new Error('Job Category is in use by Job Types.');

      // Delete the Job category
      await jobCategoriesService.deleteJobCategory(db, jobCategoryID);
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the Job Category.',
         status: 500
      });
   }
});

// get single job category
jobCategoriesRouter.route('/getSingleJobCategory/:jobCategoryID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { jobCategoryID } = req.params;
   const activeJobCategory = await jobCategoriesService.getSingleJobCategory(db, jobCategoryID);

   const activeJobCategoriesData = {
      activeJobCategory,
      grid: createGrid(activeJobCategory)
   };

   res.send({
      activeJobCategoriesData,
      message: 'Successfully retrieved job category.',
      status: 200
   });
});

module.exports = jobCategoriesRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID) => {
   // Get all Job Categories
   const activeJobCategories = await jobCategoriesService.getActiveJobCategories(db, accountID);

   const activeJobCategoriesData = {
      activeJobCategories,
      grid: createGrid(activeJobCategories)
   };

   res.send({
      jobCategoriesList: { activeJobCategoriesData },
      message: 'Successfully deleted job category.',
      status: 200
   });
};
