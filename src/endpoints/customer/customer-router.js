const express = require('express');
const jsonParser = express.json();
const customerRouter = express.Router();
const customerService = require('./customer-service');
const invoiceService = require('../invoice/invoice-service');
const transactionsService = require('../transactions/transactions-service');
const jobService = require('../job/job-service');
const recurringCustomerService = require('../recurringCustomer/recurringCustomer-service');
const retainerService = require('../retainer/retainer-service');
const paymentsService = require('../payments/payments-service');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { requireManagerOrAdmin } = require('../auth/jwt-auth');
const { restoreDataTypesRecurringCustomerTableOnCreate, restoreDataTypesRecurringCustomerTableOnUpdate } = require('../recurringCustomer/recurringCustomerObjects');
const {
   restoreDataTypesCustomersOnCreate,
   restoreDataTypesCustomersInformationOnCreate,
   restoreDataTypesCustomersOnUpdate,
   restoreDataTypesCustomersInformationOnUpdate
} = require('./customerObjects');
const dayjs = require('dayjs');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');

// Create New Customer
customerRouter.route('/createCustomer/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const sanitizedNewCustomer = sanitizeFields(req.body.customer);

   try {
      // Create new object with sanitized fields
      const customerTableFields = restoreDataTypesCustomersOnCreate(sanitizedNewCustomer);

      // Check for duplicate customer
      const customers = await customerService.getActiveCustomers(db, accountID);
      const duplicateCustomerDisplay = customers.find(customer => customer.display_name === customerTableFields.display_name);
      if (duplicateCustomerDisplay) throw new Error('Customer already exists with that name.');

      // Post new customer
      const customerData = await customerService.createCustomer(db, customerTableFields);

      if (!Object.keys(customerData).length) throw new Error('Error Inserting Customer Into Customer Table.');

      // Need the customer number to post to customer_information table, then merge customer to sanitizedData, then insert
      const { customer_id, account_id } = customerData;
      const updatedWithCustomerID = { ...sanitizedNewCustomer, customer_id };
      const customerInfoTableFields = restoreDataTypesCustomersInformationOnCreate(updatedWithCustomerID);

      // Post new customer information
      const customerInfo = await customerService.createCustomerInformation(db, customerInfoTableFields);
      if (!Object.keys(customerInfo).length) throw new Error('Error Inserting Customer Into Customer Information Table.');

      // Check for recurring customer
      if (customerTableFields.is_recurring) {
         const recurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnCreate(sanitizedNewCustomer, customer_id);
         const recurringCustomer = await recurringCustomerService.createRecurringCustomer(db, recurringCustomerTableFields);
         if (!Object.keys(recurringCustomer).length) throw new Error('Error Inserting Customer Into Recurring Customer Table.');
      }

      // call active customers
      const activeCustomers = await customerService.getActiveCustomers(db, account_id);
      const activeRecurringCustomers = await recurringCustomerService.getActiveRecurringCustomers(db, account_id);

      const activeCustomerData = {
         activeCustomers,
         grid: createGrid(activeCustomers)
      };

      const activeRecurringCustomersData = {
         activeRecurringCustomers,
         grid: createGrid(activeRecurringCustomers)
      };

      res.send({
         customersList: { activeCustomerData },
         recurringCustomersList: { activeRecurringCustomersData },
         message: 'Successfully created customer.',
         status: 200
      });
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while creating the Retainer.',
         status: 500
      });
   }
});

// Get customer by ID, and all associated data for customer profile
customerRouter.route('/activeCustomers/customerByID/:accountID/:userID/:customerID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID, customerID } = req.params;

   const [customerContactData] = await customerService.getCustomerByID(db, accountID, customerID);
   const customerRetainers = await retainerService.getCustomerRetainersByID(db, accountID, customerID);
   const customerPayments = await paymentsService.getActivePaymentsForCustomer(db, accountID, customerID);
   const customerInvoices = await invoiceService.getCustomerInvoiceByID(db, accountID, customerID);
   const customerTransactions = await transactionsService.getCustomerTransactionsByID(db, accountID, customerID);
   const customerJobs = await jobService.getActiveCustomerJobs(db, accountID, customerID);

   const customerData = {
      customerData: customerContactData,
      grid: createGrid(customerContactData)
   };

   const customerRetainerData = {
      customerRetainers,
      grid: createGrid(customerRetainers),
      treeGrid: generateTreeGridData(customerRetainers, 'retainer_id', 'parent_retainer_id')
   };

   const customerPaymentData = {
      customerPayments,
      grid: createGrid(customerPayments)
   };

   const customerInvoiceData = {
      customerInvoices,
      grid: createGrid(customerInvoices),
      treeGrid: generateTreeGridData(customerInvoices, 'customer_invoice_id', 'parent_invoice_id')
   };

   const customerTransactionData = {
      customerTransactions,
      grid: createGrid(customerTransactions)
   };

   const customerJobData = {
      customerJobs,
      grid: createGrid(customerJobs),
      treeGrid: generateTreeGridData(customerJobs, 'customer_job_id', 'parent_job_id')
   };

   res.send({
      customerData,
      customerRetainerData,
      customerPaymentData,
      customerInvoiceData,
      customerTransactionData,
      customerJobData,
      message: 'Successfully Retrieved Data.',
      status: 200
   });
});

// Update Customer
customerRouter.route('/updateCustomer/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedCustomer = sanitizeFields(req.body.customer);
      const { customerID, accountID } = sanitizedUpdatedCustomer;

      // Restore data types and map to DB fields
      const customerTableFields = restoreDataTypesCustomersOnUpdate(sanitizedUpdatedCustomer);
      const customerInfoTableFields = restoreDataTypesCustomersInformationOnUpdate(sanitizedUpdatedCustomer);
      const createRecurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnCreate(sanitizedUpdatedCustomer, customerID);
      const updateRecurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnUpdate(sanitizedUpdatedCustomer, customerID);

      // Post new customer information
      await customerService.updateCustomer(db, customerTableFields);
      await customerService.updateCustomerInformation(db, customerInfoTableFields);

      // Condition: Adding customer to recurring
      if (sanitizedUpdatedCustomer.isCustomerRecurring && !sanitizedUpdatedCustomer.recurringCustomerID) {
         await recurringCustomerService.createRecurringCustomer(db, createRecurringCustomerTableFields);
         // Condition: Customer is recurring but will need deactivated
      } else if (!sanitizedUpdatedCustomer.isCustomerRecurring && sanitizedUpdatedCustomer.recurringCustomerID > 0) {
         const addedEndDate = { ...updateRecurringCustomerTableFields, end_date: dayjs().format(), is_recurring_customer_active: false };
         await recurringCustomerService.deleteRecurringCustomer(db, addedEndDate);
         // Condition: Customer is recurring and needs info updated
      } else if (sanitizedUpdatedCustomer.isCustomerRecurring && sanitizedUpdatedCustomer.recurringCustomerID > 0) {
         await recurringCustomerService.updateRecurringCustomer(db, updateRecurringCustomerTableFields);
      }

      // Call active customers
      const activeCustomers = await customerService.getActiveCustomers(db, accountID);
      const activeRecurringCustomers = await recurringCustomerService.getActiveRecurringCustomers(db, accountID);

      const activeCustomerData = {
         activeCustomers,
         grid: createGrid(activeCustomers)
      };

      const activeRecurringCustomersData = {
         activeRecurringCustomers,
         grid: createGrid(activeRecurringCustomers)
      };

      res.send({
         customersList: { activeCustomerData },
         recurringCustomersList: { activeRecurringCustomersData },
         message: 'Successfully updated customer.',
         status: 200
      });
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while creating the Retainer.',
         status: 500
      });
   }
});

// Delete Customer
customerRouter
   .route('/deleteCustomer/:customerID/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .delete(jsonParser, async (req, res) => {
      const db = req.app.get('db');
      const { customerID, accountID } = req.params;

      try {
         // check for Jobs, Retainers, Invoices, Payments, Transactions, Recurring Customers. if any exist, throw error
         const customerJobs = await jobService.getActiveCustomerJobs(db, accountID, customerID);
         const customerRetainers = await retainerService.getCustomerRetainersByID(db, accountID, customerID);
         const customerInvoices = await invoiceService.getCustomerInvoiceByID(db, accountID, customerID);
         const customerPayments = await paymentsService.getActivePaymentsForCustomer(db, accountID, customerID);
         const customerTransactions = await transactionsService.getCustomerTransactionsByID(db, accountID, customerID);
         const customerRecurring = await recurringCustomerService.getRecurringCustomerByID(db, accountID, customerID);

         if (customerJobs.length || customerRetainers.length || customerInvoices.length || customerPayments.length || customerTransactions.length || customerRecurring.length) {
            throw new Error('Cannot delete customer with associated jobs, retainers, invoices, payments, transactions, or recurring customers. Please disable customer instead.');
         }

         // delete customer
         await customerService.deleteCustomer(db, customerID);

         // call active customers
         const activeCustomers = await customerService.getActiveCustomers(db, accountID);

         const activeCustomerData = {
            activeCustomers,
            grid: createGrid(activeCustomers)
         };

         res.send({
            customersList: { activeCustomerData },
            message: 'Successfully deleted customer.',
            status: 200
         });
      } catch (err) {
         console.log(err);
         res.send({
            message: err.message || 'An error occurred while deleting the Customer.',
            status: 500
         });
      }
   });

module.exports = customerRouter;

// Paginated active customers
customerRouter.route('/activeCustomers/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { search = '' } = req.query;

   try {
      const { page, limit, offset } = getPaginationParams({
         page: req.query.page || 1,
         limit: req.query.limit || 20
      });

      const { customers, totalCount } = await customerService.getActiveCustomersPaginated(db, accountID, {
         limit,
         offset,
         searchTerm: typeof search === 'string' ? search.trim() : ''
      });

      const grid = createGrid(customers);
      const pagination = getPaginationMetadata(totalCount, page, limit);

      return res.status(200).send({
         customersList: {
            activeCustomerData: {
               activeCustomers: customers,
               grid,
               pagination,
               searchTerm: typeof search === 'string' ? search.trim() : ''
            }
         },
         message: 'Successfully retrieved customers.',
         status: 200
      });
   } catch (error) {
      console.error('Error fetching paginated customers:', error);
      const isPaginationError = error.message && error.message.includes('Invalid pagination');
      const statusCode = isPaginationError ? 400 : 500;
      res.status(statusCode).send({
         message: error.message || 'An error occurred while retrieving customers.',
         status: statusCode
      });
   }
});
