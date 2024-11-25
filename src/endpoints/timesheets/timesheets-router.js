const express = require('express');
const timesheetsRouter = express.Router();
const timesheetsService = require('./timesheets-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils');
const timesheetOrchestrator = require('./timesheetProcessingLogic/timesheetOrchestrator');
const { addNewTransaction } = require('../transactions/sharedTransactionFunctions');
const { handleNewEntriesWithTransaction, handleNewErrorsWithTransaction, resolveMatchingErrorsWithTransaction, fetchOutstandingData } = require('./timesheetFunctions');

// Manually run timesheet processing job
timesheetsRouter.route('/runManualJob/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   // Start transaction. If any part of the process fails, rollback the transaction.
   const trx = await db.transaction();

   try {
      // Process files to get timesheet entries and errors
      const { timesheetEntries, timesheetErrors } = await timesheetOrchestrator.processFiles();

      // Run the operations in parallel within the transaction
      await Promise.all([
         handleNewEntriesWithTransaction(trx, timesheetEntries),
         handleNewErrorsWithTransaction(trx, timesheetErrors),
         resolveMatchingErrorsWithTransaction(trx, accountID, timesheetEntries)
      ]);

      // Commit the transaction
      await trx.commit();

      // Fetch outstanding data after successful processing
      const { outstandingTimesheetEntries, outstandingTimesheetErrors } = await fetchOutstandingData(db, accountID);

      // Send response
      res.send({
         outstandingTimesheetEntries,
         outstandingTimesheetErrors,
         message: 'Successfully processed timesheets.',
         status: 200
      });
   } catch (err) {
      // Rollback the transaction on error
      await trx.rollback();
      console.error(`[${new Date().toISOString()}] Error processing timesheets: ${err.message}`);
      res.status(500).send({
         message: 'Failed to process timesheets.',
         error: err.message,
         status: 500
      });
   }
});

// Get all outstanding timesheetEntries
timesheetsRouter.route('/getTimesheetEntries/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   try {
      const outstandingTimesheetEntries = await timesheetsService.getOutstandingTimesheetEntries(db, accountID);
      const outstandingTimesheetErrors = await timesheetsService.getOutstandingTimesheetErrors(db, accountID);

      res.send({
         outstandingTimesheetEntries,
         outstandingTimesheetErrors,
         message: 'Successfully retrieved timesheets.',
         status: 200
      });
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error retrieving timesheets.',
         status: 500
      });
   }
});

// Move timesheet entry to transactions. Update the entry in the timesheets table. Create a transaction, then add the new transaction to the transactions table.
timesheetsRouter.route('/moveToTransactions/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { entry } = req.body;
   try {
      // Contains properties of timesheet entry AND transaction.
      const sanitizedEntry = sanitizeFields(entry);

      // Restore data types of timesheet entry on create
      // todo - Create transaction object. Verify if this will work or if new object is needed.
      const transactionTableFields = restoreDataTypesTransactionsTableOnCreate(sanitizedEntry);
      // Restore timesheet entry object from sanitized data types of entry
      // todo - Create timesheet object.
      const timesheetEntry = restoreTimesheetEntryTypesOnUpdate(sanitizedEntry);
      timesheetEntry.isProcessed = true;

      // Update entry in timesheets table
      await timesheetsService.updateTimesheetEntry(db, accountID, timesheetEntry);

      /**
       * todo - the sanitizedEntry contains the properties of the timesheet entry and the transaction.
       * On the front end, each timesheet entry needs to show timesheet entry fields and transaction fields. jobType, jobCategory, Retainer, etc.
       */

      // Handles updating Jobs, Retainers, etc.
      await addNewTransaction(db, transactionTableFields, sanitizedEntry);

      // Return updated timesheets table, transactions, etc.
      res.send({
         message: 'Successfully moved timesheet entry to transactions.',
         status: 200
      });
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error creating timesheet.',
         status: 500
      });
   }
});

// Delete a timesheet entry
timesheetsRouter.route('/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');
   const { timesheetEntryID, accountID } = req.params;

   try {
      // Retrieve timesheet entry
      const foundEntry = await timesheetsService.getSingleTimesheetEntry(db, accountID, timesheetEntryID);
      // Update foundEntry to have isDeleted = true
      foundEntry.is_deleted = true;
      // Update timesheet entry - Requirement calls to keep the record, so this will just update the entry to isDeleted = true so it wont be returned in the getTimesheets call
      await timesheetsService.updateTimesheetEntry(db, foundEntry);

      res.send({
         message: 'Successfully deleted timesheet entry.',
         status: 200
      });
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error deleting timesheet entry.',
         status: 500
      });
   }
});

// delete time sheet error
timesheetsRouter.route('/deleteTimesheetError/:timesheetErrorID/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');
   const { timesheetErrorID, accountID } = req.params;

   try {
      // Retrieve timesheet entry
      const foundError = await timesheetsService.getSingleTimesheetError(db, accountID, timesheetErrorID);

      foundError.is_resolved = true;
      // Update timesheet error - Requirement calls to keep the record, so this will just update the entry to isDeleted = true so it wont be returned in the getTimesheets call
      await timesheetsService.updateTimesheetError(db, foundError);

      res.send({
         message: 'Successfully deleted timesheet entry.',
         status: 200
      });
   } catch (error) {
      console.error(error.message);
      res.send({
         message: error.message || 'Error deleting timesheet entry.',
         status: 500
      });
   }
});

module.exports = timesheetsRouter;

/**
 Transaction table properties:
     transaction_id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
     account_id integer NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
     customer_id integer NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
     customer_job_id integer REFERENCES customer_jobs(customer_job_id),
     retainer_id integer NULL,
     customer_invoice_id integer NULL,
     logged_for_user_id integer NOT NULL REFERENCES users(user_id),
     general_work_description_id integer NOT NULL REFERENCES customer_general_work_descriptions(general_work_description_id),
     detailed_work_description text,
     transaction_date date NOT NULL,
     transaction_type varchar(50) NOT NULL,
     quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
     unit_cost DECIMAL(10, 2) NOT NULL,
     total_transaction DECIMAL(10, 2) NOT NULL,
     is_transaction_billable boolean NOT NULL,
     is_excess_to_subscription boolean NOT NULL,
     created_at timestamp DEFAULT NOW(),
     created_by_user_id integer NOT NULL REFERENCES users(user_id),
     note text

 ready, not yet insert
CREATE TABLE timesheet_entries (
    timesheet_entry_id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    entity TEXT,
    category TEXT,
    employee_name TEXT,
    company_name TEXT,
    first_name TEXT,
    last_name TEXT,
    duration INTEGER NOT NULL,
    notes TEXT NOT NULL,
    timesheet_name TEXT NOT NULL,
    is_processed BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

ready, not yet insert
   TimesheetError properties:
CREATE TABLE timesheet_errors (
    timesheet_error_id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    timesheet_name TEXT NOT NULL,
    error_message TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    notes TEXT
); 
 */
