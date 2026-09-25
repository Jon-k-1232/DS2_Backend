const { lockCustomerLedger } = require('../payments/ledger-helpers');
const { requireAccountRow } = require('../../utils/relatedAccount');
const express = require('express');
const jsonParser = express.json();
const { enforceAccountId } = require('../auth/account-scope');
const customerRouter = express.Router();
customerRouter.param('accountID', enforceAccountId);
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
const { buildStatementData, renderStatementPdf } = require('./customer-statement');

// Create New Customer
customerRouter
   .route('/createCustomer/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   // Trust account_id / created_by_user_id from the authenticated request —
   // the URL account (already guard-verified by enforceAccountId against
   // req.user.account_id) and the session user — never from the request
   // body. The body previously supplied accountID directly (and userID for
   // created_by_user_id on customer_information), so any caller reaching this
   // route could write a customer into an arbitrary account_id / attribute
   // creation to an arbitrary user_id.
   const trustedAccountId = Number(req.params.accountID);
   const trustedUserId = Number(req.user.user_id);
   const sanitizedNewCustomer = sanitizeFields(req.body.customer);

   try {
      // Create new object with sanitized fields
      const customerTableFields = restoreDataTypesCustomersOnCreate(sanitizedNewCustomer);
      customerTableFields.account_id = trustedAccountId;

      // Check for duplicate customer
      const customers = await customerService.getActiveCustomers(db, trustedAccountId);
      const duplicateCustomerDisplay = customers.find(customer => customer.display_name === customerTableFields.display_name);
      if (duplicateCustomerDisplay) throw new Error('Customer already exists with that name.');

      // customers + customer_information (+ recurring_customers, when the new
      // customer is flagged recurring) are inserted atomically. Previously
      // each insert ran independently against the plain `db` connection, so a
      // failure on customer_information (or the recurring insert) left a real,
      // permanent customers row behind with no contact record and no normal
      // way to reach it — getActiveCustomers/getCustomerByID both INNER JOIN
      // customer_information, so the orphan wouldn't even show up to fix.
      await db.transaction(async trx => {
         // Post new customer
         const customerData = await customerService.createCustomer(trx, customerTableFields);
         if (!Object.keys(customerData).length) throw new Error('Error Inserting Customer Into Customer Table.');

         // Need the customer number to post to customer_information table, then merge customer to sanitizedData, then insert
         const { customer_id } = customerData;
         const updatedWithCustomerID = { ...sanitizedNewCustomer, customer_id };
         const customerInfoTableFields = restoreDataTypesCustomersInformationOnCreate(updatedWithCustomerID);
         customerInfoTableFields.account_id = trustedAccountId;
         customerInfoTableFields.created_by_user_id = trustedUserId;

         // Post new customer information
         const customerInfo = await customerService.createCustomerInformation(trx, customerInfoTableFields);
         if (!Object.keys(customerInfo).length) throw new Error('Error Inserting Customer Into Customer Information Table.');

         // Check for recurring customer
         if (customerTableFields.is_recurring) {
            const recurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnCreate(sanitizedNewCustomer, customer_id);
            recurringCustomerTableFields.account_id = trustedAccountId;
            recurringCustomerTableFields.created_by_user_id = trustedUserId;
            const recurringCustomer = await recurringCustomerService.createRecurringCustomer(trx, recurringCustomerTableFields);
            if (!Object.keys(recurringCustomer).length) throw new Error('Error Inserting Customer Into Recurring Customer Table.');
         }
      });

      // call active customers
      const activeCustomers = await customerService.getActiveCustomers(db, trustedAccountId);
      const activeRecurringCustomers = await recurringCustomerService.getActiveRecurringCustomers(db, trustedAccountId);

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
         message: err.message || 'An error occurred while creating the customer.',
         status: 500
      });
   }
});

// Get customer by ID, and all associated data for customer profile
customerRouter
   .route('/activeCustomers/customerByID/:accountID/:userID/:customerID')
   .all(requireManagerOrAdmin)
   .get(async (req, res) => {
   const db = req.app.get('db');
   try {
   const { accountID, customerID } = req.params;

   const [[customerContactData], customerRetainers, customerPayments, customerInvoices, customerTransactions, customerJobs] = await Promise.all([
      customerService.getCustomerByID(db, accountID, customerID),
      retainerService.getCustomerRetainersByID(db, accountID, customerID),
      paymentsService.getActivePaymentsForCustomer(db, accountID, customerID),
      invoiceService.getCustomerInvoiceByID(db, accountID, customerID),
      transactionsService.getCustomerTransactionsByID(db, accountID, customerID),
      jobService.getActiveCustomerJobs(db, accountID, customerID)
   ]);

   if (!customerContactData) {
      return res.status(404).send({ message: 'Customer not found.', status: 404 });
   }

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

   const jobTreeGrid = generateTreeGridData(customerJobs, 'customer_job_id', 'parent_job_id');
   const latestJobs = new Map(jobService.latestFamilyVersions(customerJobs)
      .map(job => [job.parent_job_id || job.customer_job_id, job]));
   jobTreeGrid.rows.forEach(parentRow => {
      const latest = latestJobs.get(parentRow.customer_job_id);
      if (latest) parentRow.current_job_total = Number(latest.current_job_total) || 0;
   });

   const customerJobData = {
      customerJobs,
      grid: createGrid(customerJobs),
      treeGrid: jobTreeGrid
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
   } catch (err) {
      // Express 4 never forwards awaited rejections — without this, a single
      // failed query (e.g. a non-numeric customerID reaching knex) escapes as
      // an unhandled rejection and kills the process on Node 20.
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while retrieving the customer profile.',
         status: 500
      });
   }
});

// Customer statement PDF — opening balance, activity in range, closing balance.
customerRouter
   .route('/statement/:accountID/:userID/:customerID')
   .all(requireManagerOrAdmin)
   .get(async (req, res) => {
   const db = req.app.get('db');
   try {
      const { accountID, customerID } = req.params;
      const { start, end } = req.query;

      const statementData = await buildStatementData(db, accountID, customerID, { start, end });
      const pdfBuffer = await renderStatementPdf(statementData, statementData.accountInfo || {});

      const safeName = String(statementData.customer.display_name || customerID).replace(/[^a-z0-9]+/gi, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="statement_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf"`);
      return res.status(200).send(pdfBuffer);
   } catch (err) {
      console.log(err);
      res.status(500).send({
         message: err.message || 'An error occurred while generating the statement.',
         status: 500
      });
   }
});

// Update Customer
customerRouter
   .route('/updateCustomer/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedCustomer = sanitizeFields(req.body.customer);
      const { customerID } = sanitizedUpdatedCustomer;

      // Restore data types and map to DB fields
      const customerTableFields = restoreDataTypesCustomersOnUpdate(sanitizedUpdatedCustomer);
      const customerInfoTableFields = restoreDataTypesCustomersInformationOnUpdate(sanitizedUpdatedCustomer);
      // Trust the account from the (guard-verified) URL, never the request body.
      const trustedAccountId = Number(req.params.accountID);
      customerTableFields.account_id = trustedAccountId;
      customerInfoTableFields.account_id = trustedAccountId;
      const createRecurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnCreate(sanitizedUpdatedCustomer, customerID);
      const updateRecurringCustomerTableFields = restoreDataTypesRecurringCustomerTableOnUpdate(sanitizedUpdatedCustomer, customerID);
      createRecurringCustomerTableFields.account_id = trustedAccountId;
      createRecurringCustomerTableFields.created_by_user_id = Number(req.user.user_id);
      updateRecurringCustomerTableFields.account_id = trustedAccountId;

      await db.transaction(async trx => {
         await lockCustomerLedger(trx, trustedAccountId, customerID);
         await requireAccountRow(trx, 'customers', 'customer_id', customerID, trustedAccountId, 'Customer');
         if (Number(sanitizedUpdatedCustomer.recurringCustomerID) > 0) {
            const recurring = await requireAccountRow(trx, 'recurring_customers', 'recurring_customer_id', sanitizedUpdatedCustomer.recurringCustomerID, trustedAccountId, 'Recurring customer');
            if (Number(recurring.customer_id) !== Number(customerID)) throw new Error('Recurring row does not belong to this customer.');
         }
   
         // Post new customer information
         const updatedCustomer = await customerService.updateCustomer(trx, customerTableFields);
         if (!updatedCustomer) throw new Error('Customer was not found.');
         const updatedContact = await customerService.updateCustomerInformation(trx, customerInfoTableFields);
         if (updatedContact !== 1) throw new Error('Customer contact was not found in this account.');
   
         // Condition: Adding customer to recurring
         if (sanitizedUpdatedCustomer.isCustomerRecurring && !sanitizedUpdatedCustomer.recurringCustomerID) {
            await recurringCustomerService.createRecurringCustomer(trx, createRecurringCustomerTableFields);
            // Condition: Customer is recurring but will need deactivated
         } else if (!sanitizedUpdatedCustomer.isCustomerRecurring && sanitizedUpdatedCustomer.recurringCustomerID > 0) {
            const addedEndDate = { ...updateRecurringCustomerTableFields, end_date: dayjs().format(), is_recurring_customer_active: false };
            await recurringCustomerService.deleteRecurringCustomer(trx, addedEndDate);
            // Condition: Customer is recurring and needs info updated
         } else if (sanitizedUpdatedCustomer.isCustomerRecurring && sanitizedUpdatedCustomer.recurringCustomerID > 0) {
            await recurringCustomerService.updateRecurringCustomer(trx, updateRecurringCustomerTableFields);
         }
         await recurringCustomerService.reconcileCustomerRecurringFlag(trx, trustedAccountId, customerID);
      });

      // Call active customers
      const activeCustomers = await customerService.getActiveCustomers(db, trustedAccountId);
      const activeRecurringCustomers = await recurringCustomerService.getActiveRecurringCustomers(db, trustedAccountId);

      const activeCustomerData = {
         activeCustomers,
         grid: createGrid(activeCustomers)
      };

      const activeRecurringCustomersData = {
         activeRecurringCustomers,
         grid: createGrid(activeRecurringCustomers)
      };

      // Deactivating a customer (is_customer_active -> false) is the supported
      // alternative to deleteCustomer's hard-delete-with-no-related-records
      // rule, so it must NOT be blocked by an open balance or unbilled
      // billable work — but the caller should be warned rather than have it
      // happen silently and the debt/hours fall out of the active lists.
      const warnings = customerTableFields.is_customer_active === false
         ? await customerService.getDeactivationWarnings(db, trustedAccountId, customerTableFields.customer_id)
         : [];

      res.send({
         customersList: { activeCustomerData },
         recurringCustomersList: { activeRecurringCustomersData },
         warnings,
         message: 'Successfully updated customer.',
         status: 200
      });
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while updating the customer.',
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
         const customerId = Number(customerID);
         if (!Number.isInteger(customerId) || customerId <= 0) {
            return res.send({ message: 'No matching customer record found.', status: 404 });
         }
         const deleted = await db.transaction(async trx => {
            const existing = await trx('customers').select('customer_id')
               .where({ account_id: Number(accountID), customer_id: customerId }).forNoKeyUpdate().first();
            if (!existing) return false;

            // Raw existence checks include inactive/history rows and malformed
            // legacy relations that a joined list would hide. Hold the same
            // customer lock as job and ledger writers until deletion commits.
            for (const table of ['customer_jobs', 'customer_retainers_and_prepayments',
               'customer_invoices', 'customer_payments', 'customer_writeoffs',
               'customer_transactions', 'recurring_customers', 'customer_quotes']) {
               if (await trx(table).where({ account_id: Number(accountID), customer_id: customerId }).first()) {
                  throw new Error('Cannot delete customer with associated jobs, retainers, invoices, payments, write-offs, transactions, recurring customers, or quotes. Please disable customer instead.');
               }
            }
            await trx('customer_information').where({ account_id: Number(accountID), customer_id: customerId }).del();
            await customerService.deleteCustomer(trx, customerId, accountID);
            return true;
         });
         if (!deleted) return res.send({ message: 'No matching customer record found.', status: 404 });

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
customerRouter
   .route('/activeCustomers/:accountID/:userID')
   .all(requireManagerOrAdmin)
   .get(async (req, res) => {
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
