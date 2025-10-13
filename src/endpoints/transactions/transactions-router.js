const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const transactionsRouter = express.Router();
const transactionsService = require('./transactions-service');
const accountUserService = require('../user/user-service');
const retainerService = require('../retainer/retainer-service');
const paymentsService = require('../payments/payments-service');
const jobService = require('../job/job-service');
const { restoreDataTypesTransactionsTableOnCreate, restoreDataTypesTransactionsTableOnUpdate } = require('./transactionsObjects');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const { fetchUserTime } = require('./transactionLogic');
const dayjs = require('dayjs');
const { addNewTransaction, differenceBetweenOldAndNewTransaction, updateRecentJobTotal, handleRetainerUpdate } = require('./sharedTransactionFunctions');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');

const DEFAULT_TRANSACTIONS_PAGE_SIZE = 20;
const TRANSACTION_EXPORT_COLUMNS = [
   'transaction_id',
   'customer_id',
   'customer_name',
   'transaction_type',
   'quantity',
   'unit_cost',
   'total_transaction',
   'customer_invoice_id',
   'retainer_id',
   'is_transaction_billable',
   'is_excess_to_subscription',
   'transaction_date',
   'created_at',
   'logged_for_user_name',
   'job_description',
   'general_work_description',
   'detailed_work_description'
];

// Create a new transaction
transactionsRouter.route('/createTransaction/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedNewTransaction = sanitizeFields(req.body.transaction);
      const { accountID } = sanitizedNewTransaction;

      await addNewTransaction(db, sanitizedNewTransaction);

      return sendUpdatedTableWith200Response(db, res, accountID);
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

// Get paginated transactions
transactionsRouter.route('/getTransactions/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { search = '' } = req.query;

   try {
      const { page, limit, offset } = getPaginationParams({
         page: req.query.page || 1,
         limit: req.query.limit || DEFAULT_TRANSACTIONS_PAGE_SIZE
      });

      const transactionsList = await buildActiveTransactionsList(db, accountID, {
         page,
         limit,
         offset,
         searchTerm: search
      });

      res.send({
         transactionsList,
         message: 'Successfully retrieved transactions.',
         status: 200
      });
   } catch (error) {
      console.log(error);
      const isPaginationError = error.message && error.message.includes('Invalid pagination');
      const statusCode = isPaginationError ? 400 : 500;
      res.status(statusCode).send({
         message: error.message || 'An error occurred while retrieving the transactions.',
         status: statusCode
      });
   }
});

transactionsRouter.route('/exportTransactions/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { search = '' } = req.query;

   try {
      const transactions = await transactionsService.getActiveTransactionsForExport(db, accountID, search);
      const csv = generateTransactionsCsv(transactions, TRANSACTION_EXPORT_COLUMNS);
      const fileName = `transactions_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.status(200).send(csv);
   } catch (error) {
      console.log(error);
      res.status(500).send({
         message: error.message || 'An error occurred while exporting the transactions.',
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
 *
 * @param {*} db
 * @param {*} res
 * @param {*} accountID
 */
async function buildActiveTransactionsList(db, accountID, { page = 1, limit = DEFAULT_TRANSACTIONS_PAGE_SIZE, offset, searchTerm = '' } = {}) {
   const normalizedSearch = typeof searchTerm === 'string' ? searchTerm.trim() : '';
   const derivedOffset = typeof offset === 'number' ? offset : (page - 1) * limit;

   const { transactions, totalCount } = await transactionsService.getActiveTransactionsPaginated(db, accountID, {
      limit,
      offset: derivedOffset,
      searchTerm: normalizedSearch
   });

   const grid = createGrid(transactions);
   const pagination = getPaginationMetadata(totalCount, page, limit);

   return {
      activeTransactionsData: {
         activeTransactions: transactions,
         grid,
         pagination,
         searchTerm: normalizedSearch
      }
   };
}

const sendUpdatedTableWith200Response = async (db, res, accountID, additionalItems = {}) => {
   const [transactionsList, activeRetainers, activeJobs, activePayments] = await Promise.all([
      buildActiveTransactionsList(db, accountID),
      retainerService.getActiveRetainers(db, accountID),
      jobService.getActiveJobs(db, accountID),
      paymentsService.getActivePayments(db, accountID)
   ]);

   const activePaymentsData = {
      activePayments,
      grid: createGrid(activePayments)
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
      transactionsList,
      accountRetainersList: { activeRetainerData },
      accountJobsList: { activeJobData },
      paymentsList: { activePaymentsData },
      message: 'Successful.',
      status: 200
   });
};

const generateTransactionsCsv = (rows, columns) => {
   const orderedColumns = Array.isArray(columns) && columns.length ? columns : Object.keys(rows[0] || {});
   const header = orderedColumns.join(',');
   const dataLines = rows.map(row => orderedColumns.map(column => escapeCsvValue(row[column])).join(','));
   return [header, ...dataLines].join('\n');
};

const escapeCsvValue = value => {
   if (value === null || value === undefined) return '';
   if (value instanceof Date) return value.toISOString();

   const stringValue = `${value}`;
   if (/[",\n\r]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
   }

   return stringValue;
};
