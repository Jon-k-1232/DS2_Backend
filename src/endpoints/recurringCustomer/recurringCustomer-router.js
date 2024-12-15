const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const recurringCustomerRouter = express.Router();
const recurringCustomerService = require('./recurringCustomer-service');
const customerService = require('../customer/customer-service');
const { restoreDataTypesRecurringCustomerTableOnCreate, restoreDataTypesRecurringCustomerTableOnUpdate } = require('./recurringCustomerObjects');
const { createGrid } = require('../../utils/gridFunctions');

// Create a new recurring customer
recurringCustomerRouter.route('/createRecurringCustomer/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const sanitizedNewRecurringCustomer = sanitizeFields(req.body.recurringCustomer);

   // Create new object with sanitized fields
   const recurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnCreate(sanitizedNewRecurringCustomer);

   const { customerID } = sanitizedNewRecurringCustomer;
   // update customer table
   await customerService.updateCustomerRecurringField(db, customerID, accountID);

   // Post new recurring customer
   await recurringCustomerService.createRecurringCustomer(db, recurringCustomerTableFields);
   // Get all recurring customers
   const activeRecurringCustomers = await recurringCustomerService.getActiveRecurringCustomers(db, accountID);

   const activeRecurringCustomersData = {
      activeRecurringCustomers,
      grid: createGrid(activeRecurringCustomers)
   };

   res.send({
      recurringCustomersList: { activeRecurringCustomersData },
      message: 'Successfully created new recurring customer.',
      status: 200
   });
});

// Get all active recurring customers
recurringCustomerRouter.route('/getActiveRecurringCustomers/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   const activeRecurringCustomers = await recurringCustomerService.getActiveRecurringCustomers(db, accountID);

   // Create Mui Grid
   const grid = createGrid(activeRecurringCustomers);

   // Return Object
   const activeRecurringCustomersData = {
      activeRecurringCustomers,
      grid
   };

   res.send({
      activeRecurringCustomersData,
      message: 'Successfully retrieved all active recurring customers.',
      status: 200
   });
});

// Update a recurring customer
recurringCustomerRouter.route('/updateRecurringCustomer').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const sanitizedUpdatedRecurringCustomer = sanitizeFields(req.body.recurringCustomer);

   // Create new object with sanitized fields
   const recurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnUpdate(sanitizedUpdatedRecurringCustomer);

   // Update recurring customer
   await recurringCustomerService.updateRecurringCustomer(db, recurringCustomerTableFields);

   // Get all recurring customers
   const recurringCustomersData = await recurringCustomerService.getActiveRecurringCustomers(db, recurringCustomerTableFields.account_id);

   // Create grid for Mui Grid
   const grid = createGrid(recurringCustomersData);

   const recurringCustomer = {
      recurringCustomersData,
      grid
   };

   res.send({
      recurringCustomer,
      message: 'Successfully updated recurring customer.',
      status: 200
   });
});

// Delete a recurring customer
recurringCustomerRouter.route('/deleteRecurringCustomer/:accountID/:recurringCustomerId').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID, recurringCustomerId } = req.params;

   // Delete recurring customer
   await recurringCustomerService.deleteRecurringCustomer(db, recurringCustomerId);

   // Get all recurring customers
   const recurringCustomersData = await recurringCustomerService.getActiveRecurringCustomers(db, accountID);

   // Create grid for Mui Grid
   const grid = createGrid(recurringCustomersData);

   const recurringCustomer = {
      recurringCustomersData,
      grid
   };

   res.send({
      recurringCustomer,
      message: 'Successfully deleted recurring customer.',
      status: 200
   });
});

module.exports = recurringCustomerRouter;
