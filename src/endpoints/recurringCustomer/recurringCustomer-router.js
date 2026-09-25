const { committedResponse } = require('../../utils/committedResponse');
const { lockCustomerLedger } = require('../payments/ledger-helpers');
const { requireAccountRow } = require('../../utils/relatedAccount');
const express = require('express');
const dayjs = require('dayjs');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const { requireManagerOrAdmin } = require('../auth/jwt-auth');
const recurringCustomerRouter = express.Router();
recurringCustomerRouter.param('accountID', enforceAccountId);
// The Recurring Customers page lives at /customers/recurringCustomers in the
// frontend, nested inside the same ManagerAndAdminProtectedAccessRoute that
// gates all of /customers/*. Mirror that on every route here — none of these
// were previously gated at all.
recurringCustomerRouter.use(requireManagerOrAdmin);
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
   // Trust the account from the (guard-verified) URL, never the request body —
   // same rule the update route applies.
   recurringCustomerTableFields.account_id = Number(accountID);
      recurringCustomerTableFields.created_by_user_id = Number(req.user.user_id);

   const { customerID } = sanitizedNewRecurringCustomer;
   await db.transaction(async trx => {
      // Preserve the documented 422 ownership/selection error. The ledger
      // lock's statusCode-only error otherwise reaches the global handler as
      // HTTP 500. The lock still rechecks existence before any mutation.
      await requireAccountRow(trx, 'customers', 'customer_id', customerID, accountID, 'Customer');
      await lockCustomerLedger(trx, accountID, customerID);
      // update customer table
      await customerService.updateCustomerRecurringField(trx, customerID, accountID);
   
      // Post new recurring customer
      await recurringCustomerService.createRecurringCustomer(trx, recurringCustomerTableFields);
   });
   // Get all recurring customers
   return committedResponse(res, 'Successfully created new recurring customer.', async () => {
      const activeRecurringCustomers = await recurringCustomerService.getActiveRecurringCustomers(db, accountID);

      const activeRecurringCustomersData = {
         activeRecurringCustomers,
         grid: createGrid(activeRecurringCustomers)
      };

      return {
         recurringCustomersList: { activeRecurringCustomersData },
         message: 'Successfully created new recurring customer.',
         status: 200
      };
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
   // This route has no :accountID in the path, so scope to the authenticated
   // user's account rather than trusting the request body.
   const accountID = req.user.account_id;

   // restoreDataTypesRecurringCustomerTableOnUpdate needs the row's
   // customer_id as a second argument (it is not part of the update payload's
   // own identity - recurringCustomerID is), so look the existing row up
   // first. Previously this was called with only one argument, so
   // customer_id was always NaN and Postgres rejected every update; looking
   // the row up first also lets us 404 cleanly instead of running an UPDATE
   // that silently matches zero rows.
   const [existingRecurringCustomer] = await recurringCustomerService.getRecurringCustomerByID(db, accountID, sanitizedUpdatedRecurringCustomer.recurringCustomerID);
   if (!existingRecurringCustomer) {
      return res.status(404).send({ message: 'Recurring customer not found.', status: 404 });
   }

   // Create new object with sanitized fields
   const recurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnUpdate(sanitizedUpdatedRecurringCustomer, existingRecurringCustomer.customer_id);
   recurringCustomerTableFields.account_id = accountID;

   await requireAccountRow(db, 'customers', 'customer_id', existingRecurringCustomer.customer_id, accountID, 'Customer');

   // Update recurring customer
   await recurringCustomerService.updateRecurringCustomer(db, recurringCustomerTableFields);

   // Get all recurring customers
   return committedResponse(res, 'Successfully updated recurring customer.', async () => {
      const recurringCustomersData = await recurringCustomerService.getActiveRecurringCustomers(db, recurringCustomerTableFields.account_id);

      // Create grid for Mui Grid
      const grid = createGrid(recurringCustomersData);

      const recurringCustomer = {
         recurringCustomersData,
         grid
      };

      return {
         recurringCustomer,
         message: 'Successfully updated recurring customer.',
         status: 200
      };
   });
});

// Delete a recurring customer
recurringCustomerRouter.route('/deleteRecurringCustomer/:accountID/:recurringCustomerId').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID, recurringCustomerId } = req.params;

   const [existingRecurringCustomer] = await recurringCustomerService.getRecurringCustomerByID(db, accountID, recurringCustomerId);
   if (!existingRecurringCustomer) {
      return res.status(404).send({ message: 'Recurring customer not found.', status: 404 });
   }

   // Soft-delete, scoped to the (guard-verified) URL account. Also stamp
   // end_date, mirroring customer-router.js's updateCustomer deactivation
   // path (turning recurring off there sets end_date: dayjs().format()) -
   // this dedicated delete route previously only flipped the active flag and
   // left end_date untouched.
   await recurringCustomerService.deleteRecurringCustomer(db, {
      recurring_customer_id: Number(recurringCustomerId),
      account_id: Number(accountID),
      is_recurring_customer_active: false,
      end_date: dayjs().format()
   });

   // Get all recurring customers
   return committedResponse(res, 'Successfully deleted recurring customer.', async () => {
      const recurringCustomersData = await recurringCustomerService.getActiveRecurringCustomers(db, accountID);

      // Create grid for Mui Grid
      const grid = createGrid(recurringCustomersData);

      const recurringCustomer = {
         recurringCustomersData,
         grid
      };

      return {
         recurringCustomer,
         message: 'Successfully deleted recurring customer.',
         status: 200
      };
   });
});

module.exports = recurringCustomerRouter;
