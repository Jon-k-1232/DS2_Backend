const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils');
const transactionsRouter = express.Router();
const transactionsService = require('./transactions-service');
const accountUserService = require('../user/user-service');
const retainerService = require('../retainer/retainer-service');
const paymentsService = require('../payments/payments-service');
const jobService = require('../job/job-service');
const { restoreDataTypesTransactionsTableOnCreate, restoreDataTypesTransactionsTableOnUpdate, createPaymentObjectFromTransaction } = require('./transactionsObjects');
const { createGrid, generateTreeGridData } = require('../../helperFunctions/helperFunctions');
const { fetchUserTime } = require('./transactionLogic');
const dayjs = require('dayjs');

// Create a new transaction
transactionsRouter.route('/createTransaction/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedNewTransaction = sanitizeFields(req.body.transaction);

      // Create new object with sanitized fields
      const transactionTableFields = restoreDataTypesTransactionsTableOnCreate(sanitizedNewTransaction);

      const { total_transaction, retainer_id, customer_job_id, account_id } = transactionTableFields;

      // Update job total
      await updateRecentJobTotal(db, customer_job_id, account_id, total_transaction);

      const newRetainer = await updateRetainerTotal(db, retainer_id, account_id, total_transaction);
      const newRetainerID = newRetainer?.retainer_id || null;
      const newTransaction = { ...transactionTableFields, retainer_id: newRetainerID };

      if (retainer_id) {
         const newPayment = createPaymentObjectFromTransaction(sanitizedNewTransaction);
         // post payment
         await paymentsService.createPayment(db, newPayment);
      }

      // Post new transaction
      await transactionsService.createTransaction(db, newTransaction);

      return sendUpdatedTableWith200Response(db, res, account_id);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while creating the transaction.',
         status: 500
      });
   }
});

// Update a transaction
transactionsRouter.route('/updateTransaction/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedUpdatedTransaction = sanitizeFields(req.body.transaction);

      // Create new object with sanitized fields
      const transactionTableFields = restoreDataTypesTransactionsTableOnUpdate(sanitizedUpdatedTransaction);
      const { account_id, customer_job_id, customer_invoice_id } = transactionTableFields;

      // If transaction is attached to an invoice, do not allow update
      if (customer_invoice_id) {
         throw new Error('Transaction is attached to an invoice and cannot be updated.');
      }

      // Get original transaction and decide if a positive or negative change in order to update the job record
      const transactionDifferences = await differenceBetweenOldAndNewTransaction(db, transactionTableFields);
      const { areAmountsDifferent, transactionTotalDifference } = transactionDifferences;

      // Update the retainer if there is one
      const newRetainer = await handleRetainerUpdate(db, transactionDifferences, transactionTableFields);
      const newRetainerID = newRetainer?.retainer_id || null;
      const newTransaction = { ...transactionTableFields, retainer_id: newRetainerID };

      // Update job total
      if (areAmountsDifferent) {
         await updateRecentJobTotal(db, customer_job_id, account_id, transactionTotalDifference);
      }

      // Update transaction
      await transactionsService.updateTransaction(db, newTransaction);

      await sendUpdatedTableWith200Response(db, res, account_id);
   } catch (error) {
      console.log(error);
      res.send({
         message: error.message || 'An error occurred while updating the transaction.',
         status: 500
      });
   }
});

// Delete a transaction
transactionsRouter.route('/deleteTransaction/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');

   try {
      const sanitizedUpdatedTransaction = sanitizeFields(req.body.transaction);

      // Create new object with sanitized fields
      const transactionTableFields = restoreDataTypesTransactionsTableOnUpdate(sanitizedUpdatedTransaction);
      const { customer_job_id, transaction_id, account_id, customer_invoice_id, retainer_id } = transactionTableFields;

      // If transaction is attached to an invoice, do not allow delete
      if (customer_invoice_id) throw new Error('Transaction is attached to an invoice and cannot be deleted.');

      // Get original transaction and decide if a positive or negative change in order to update the job record
      const transactionDifferences = await differenceBetweenOldAndNewTransaction(db, transactionTableFields, 'delete');
      const { transactionTotalDifference } = transactionDifferences;

      // Update the retainer if there is one - puts the amount to be deleted back on the retainer.
      await handleRetainerUpdate(db, transactionDifferences, transactionTableFields);

      // Update job total
      await updateRecentJobTotal(db, customer_job_id, account_id, transactionTotalDifference);

      // Delete transaction
      await transactionsService.deleteTransaction(db, transaction_id);
      await sendUpdatedTableWith200Response(db, res, account_id);
   } catch (error) {
      console.log(error);
      res.send({
         message: error.message || 'An error occurred while deleting the transaction.',
         status: 500
      });
   }
});

// Get a specific transaction
transactionsRouter.route('/getSingleTransaction/:customerID/:transactionID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { customerID, transactionID, accountID } = req.params;

   // Get specific transaction
   const transactionData = await transactionsService.getSingleTransaction(db, accountID, customerID, transactionID);

   const activeTransactionsData = {
      transactionData,
      grid: createGrid(transactionData)
   };

   res.send({
      activeTransactionsData,
      message: 'Successfully retrieved specific transaction.',
      status: 200
   });
});

// Get all employee transactions
transactionsRouter.route('/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { startDate, endDate, accountID } = req.params;
   const startingDate = startDate ? startDate : dayjs(startDate).format();
   const endingDate = endDate ? endDate : dayjs(endDate).format();

   try {
      const [activeUsers, transactions] = await Promise.all([
         await accountUserService.getActiveAccountUsers(db, accountID),
         await transactionsService.getTransactionsBetweenDates(db, accountID, dayjs(startingDate).format(), dayjs(endingDate).format())
      ]);

      const userTime = fetchUserTime(activeUsers, transactions, 'Time');
      // const userChargeCount = fetchUserTime(activeUsers, transactions, 'Charge');

      return sendUpdatedTableWith200Response(db, res, accountID, { userTime });
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while fetching user time.',
         status: 500
      });
   }
});

module.exports = transactionsRouter;

/**
 * Find if the amounts are different between the original and updated transaction and the difference amount
 * @param {*} db
 * @param {*} transactionTableFields
 * @returns
 */
const differenceBetweenOldAndNewTransaction = async (db, transactionTableFields, aggregationType) => {
   const { account_id, customer_id, transaction_id } = transactionTableFields;
   // Get original transaction and decide if a positive or negative change in order to update the job record
   const [originalTransaction] = await transactionsService.getSingleTransaction(db, account_id, customer_id, transaction_id);
   if (!Object.keys(originalTransaction).length) throw new Error('Transaction was not found.');

   const originalTransactionTotal = Number(originalTransaction?.total_transaction);
   const updatedTransactionTotal = Number(transactionTableFields?.total_transaction);
   const transactionTotalDifference = aggregationType !== 'delete' ? updatedTransactionTotal - originalTransactionTotal : -Math.abs(originalTransactionTotal);
   const areAmountsDifferent = originalTransactionTotal !== updatedTransactionTotal;

   return { areAmountsDifferent, transactionTotalDifference, originalTransaction };
};

/**
 * Find the most recent job and update the job total
 * @param {*} db
 * @param {*} customerJobID
 * @param {*} accountID
 * @param {*} transactionTotalDifference
 */
const updateRecentJobTotal = async (db, customerJobID, accountID, transactionTotalDifference) => {
   const recentJob = await jobService.getRecentJob(db, customerJobID, accountID);

   if (!Object.keys(recentJob).length) throw new Error('Job was not found.');

   // Grabbing all the matching customer jobs transactions to add them all together.
   const matchingCustomerJobs = await transactionsService.getAllSpecificCustomerJobTransactions(db, accountID, customerJobID);
   const transactionTotals = matchingCustomerJobs ? matchingCustomerJobs.map(transaction => Number(transaction.total_transaction)) : 0;
   const totalsWithNewTransactionAmount = transactionTotals.concat(Number(transactionTotalDifference));

   const { parent_job_id } = recentJob;

   const updatedJobAmount = totalsWithNewTransactionAmount.reduce((acc, curr) => acc + curr, 0);
   const parentJobID = !parent_job_id ? customerJobID : parent_job_id;

   // Create new object with updated job total
   const updatedJob = { ...recentJob, parent_job_id: parentJobID, current_job_total: updatedJobAmount };

   // Post new Job record
   return jobService.createJob(db, updatedJob);
};

/**
 * Update a retainer value.
 * @param {*} db
 * @param {*} retainer_id
 * @param {*} account_id
 * @param {*} total_transaction
 * @returns
 */
const updateRetainerTotal = async (db, retainer_id, account_id, total_transaction) => {
   if (!retainer_id) return {};

   // Fetch retainer data
   const [retainer] = await retainerService.getMostRecentRecordOfSingleRetainer(db, account_id, retainer_id);

   if (!Object.keys(retainer).length) throw new Error('Retainer was not found.');

   if (Math.abs(retainer.current_amount) < total_transaction) {
      throw new Error('Retainer does not have enough balance to cover the transaction.');
   }

   const parent_retainer_id = retainer?.parent_retainer_id || retainer?.retainer_id;
   const current_amount = Number(retainer?.current_amount) + Number(total_transaction);
   const is_retainer_active = current_amount === 0 ? false : true;

   const updatedRetainer = { ...retainer, parent_retainer_id, current_amount, is_retainer_active };

   // Remove retainer_id to avoid primary key constraint violation, using throwaways _ to remove properties
   const { retainer_id: _, created_at: _createdAt, ...updatedRetainerWithoutID } = updatedRetainer;

   // Post new Retainer record
   return retainerService.createRetainer(db, updatedRetainerWithoutID);
};

/**
 * Update a retainer value.
 * @param {*} db
 * @param {*} transactionDifferences
 * @param {*} transactionTableFields
 */
const handleRetainerUpdate = async (db, transactionDifferences, transactionTableFields) => {
   if (!transactionTableFields.retainer_id) return {};

   const { account_id } = transactionTableFields;
   const { transactionTotalDifference, originalTransaction } = transactionDifferences;

   // Grabs the most recent record of the retainer/ prepayment
   const [mostRecentRetainer] = await retainerService.getMostRecentRecordOfSingleRetainer(db, account_id, transactionTableFields.retainer_id);

   if (!Object.keys(mostRecentRetainer).length) throw new Error('Retainer was not found.');

   // Disallow retainer change for now
   if (originalTransaction.retainer_id !== transactionTableFields.retainer_id) {
      throw new Error('Please contact support. Retainer/ Prepayment change not allowed at this time.');
   }

   // Handle if new amount is greater than retainer
   if (transactionTotalDifference > Math.abs(mostRecentRetainer.current_amount)) {
      throw new Error('Edited transaction amount is greater than the current retainer balance.');
   }

   const parent_retainer_id = mostRecentRetainer?.parent_retainer_id || mostRecentRetainer?.retainer_id;
   const current_amount = Number(mostRecentRetainer.current_amount) + Number(transactionTotalDifference);
   const is_retainer_active = current_amount === 0 ? false : true;

   const newRetainerRecord = {
      ...mostRecentRetainer,
      parent_retainer_id,
      current_amount,
      is_retainer_active
   };

   // Remove the retainer_id to avoid duplicate key error
   const { retainer_id: _, created_at: _createdAt, ...newRetainerRecordWithoutRetainerId } = newRetainerRecord;

   // Insert new retainer record
   return retainerService.createRetainer(db, newRetainerRecordWithoutRetainerId);

   // Todo edge cases -
   // retainer not changed, and amount greater than retainer.
   // --- retainer not changed, and amount less than retainer.
   // --- retainer not changed, and but amount was changed and there is a retainer that is newer than the selected retainer. Amount overage or under would need checked.
   // retainer changed, and amount greater than retainer.
   // --- retainer changed, and amount less than retainer.
   // --- retainer changed, and amount changed.
};

/**
 *
 * @param {*} db
 * @param {*} res
 * @param {*} accountID
 */
const sendUpdatedTableWith200Response = async (db, res, accountID, additionalItems = {}) => {
   // Get all transactions
   const [activeTransactions, activeRetainers, activeJobs, activePayments] = await Promise.all([
      transactionsService.getActiveTransactions(db, accountID),
      retainerService.getActiveRetainers(db, accountID),
      jobService.getActiveJobs(db, accountID),
      paymentsService.getActivePayments(db, accountID)
   ]);

   const activePaymentsData = {
      activePayments,
      grid: createGrid(activePayments)
   };

   const activeTransactionsData = {
      activeTransactions,
      grid: createGrid(activeTransactions)
   };

   const activeRetainerData = {
      activeRetainers,
      grid: createGrid(activeRetainers),
      treeGrid: generateTreeGridData(activeRetainers, 'retainer_id', 'parent_retainer_id')
   };

   const activeJobData = {
      activeJobs,
      grid: createGrid(activeJobs),
      treeGrid: generateTreeGridData(activeJobs, 'customer_job_id', 'parent_job_id')
   };

   res.send({
      ...additionalItems,
      transactionsList: { activeTransactionsData },
      accountRetainersList: { activeRetainerData },
      accountJobsList: { activeJobData },
      paymentsList: { activePaymentsData },
      message: 'Successful.',
      status: 200
   });
};
