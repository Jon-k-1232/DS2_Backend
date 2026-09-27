const { committedResponse } = require('../../utils/committedResponse');
const express = require('express');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { enforceAccountId } = require('../auth/account-scope');
const transactionsRouter = express.Router();
transactionsRouter.param('accountID', enforceAccountId);
const transactionsService = require('./transactions-service');
const accountUserService = require('../user/user-service');
const retainerService = require('../retainer/retainer-service');
const paymentsService = require('../payments/payments-service');
const jobService = require('../job/job-service');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const { fetchUserTime } = require('./transactionLogic');
const dayjs = require('dayjs');
const { addNewTransaction, updateTransactionCore, deleteTransactionCore } = require('./sharedTransactionFunctions');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const { csvRow } = require('../analytics/csv-util');
// A generated fee owns a permanent period. Deletion means a reasoned skip;
// direct time-entry editing cannot erase its recurrence or bypass the version.
async function recurringChange(req, res) {
   const transactionId = req.body?.transaction?.transactionID || req.body?.transaction?.transaction_id;
   if (!/^[1-9]\d*$/.test(String(transactionId))) return false;
   try {
      const row = await req.app.get('db')('recurring_charge_occurrences').where({ account_id: req.user.account_id, transaction_id: Number(transactionId) }).first();
      if (!row) return false;
      if (req.method !== 'DELETE') return res.status(409).send({ status: 409, message: 'Edit recurring charges in Billing → Recurring plans so the period and reason stay together.' });
      const result = await require('../recurringCustomer/recurring-billing').changeOccurrence(req.app.get('db'), {
         accountId: Number(req.user.account_id), actorId: Number(req.user.user_id), occurrenceId: row.occurrence_id,
         body: req.body.transaction, key: req.get('Idempotency-Key')
      }, true);
      return res.send({ status: 200, ...result });
   } catch (error) { const status = error.statusCode || (error.code === 'P0409' ? 409 : 500); return res.status(status).send({ status, message: status === 500 ? 'Unable to change the recurring charge. Nothing was saved.' : error.message }); }
}

const DEFAULT_TRANSACTIONS_PAGE_SIZE = 20;
const TRANSACTION_EXPORT_COLUMNS = [
   'transaction_id',
   'billing_entity_id',
   'billing_entity_name',
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

// Create, update and delete run through the ledger cores in
// sharedTransactionFunctions: ONE knex transaction under the customer's ledger
// lock (the customer-row lock payments / write-offs / retainers / finalize
// take; see lockTransactionLedger for why it is FOR NO KEY UPDATE). The
// stored row is re-read after locking and decides billed status, amounts and
// retainer funding; job totals, the retainer draw, the auto 'Retainer' payment
// and the transaction row commit or roll back together.

// Create a new transaction
transactionsRouter.route('/createTransaction/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const sanitizedNewTransaction = sanitizeFields(req.body.transaction || {});
      // Trust the account from the (guard-verified) URL, never the request body.
      const accountID = Number(req.params.accountID);
      sanitizedNewTransaction.account_id = accountID;
      // The AUTHENTICATED user is always the recorded creator — loggedByUserID
      // in the body is caller-supplied and would make the audit trail spoofable.
      sanitizedNewTransaction.loggedByUserID = Number(req.user.user_id);

      const created = await require('../payments/ledger-helpers').withTransaction(db, async trx => {
         await require('../../utils/ledgerAction').actionContext(trx, Number(req.user.user_id), 'Manual transaction entry');
         const row = await addNewTransaction(trx, sanitizedNewTransaction);
         await require('../duplicates/duplicates-service').detectCreated(trx, 'transaction', row, Number(req.user.user_id));
         return row;
      });

      return sendUpdatedTableWith200Response(db, res, accountID, {changed:{transactions:[created]}});
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
      if (await recurringChange(req, res)) return;
      // Trust the account from the (guard-verified) URL, never the request body.
      const accountID = Number(req.params.accountID);
      const { warning, transaction } = await updateTransactionCore(db, {
         accountId: accountID,
         actorId: Number(req.user.user_id),
         transaction: sanitizeFields(req.body.transaction || {})
      });

      await sendUpdatedTableWith200Response(db, res, accountID, {warning,changed:{transactions:[transaction]}});
   } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).send({ message: error.message || 'An error occurred while updating the transaction.', status });
   }
});

// Delete a transaction
transactionsRouter.route('/deleteTransaction/:accountID/:userID').delete(async (req, res) => {
   const db = req.app.get('db');
   try {
      if (await recurringChange(req, res)) return;
      // Trust the account from the (guard-verified) URL, never the request body.
      const accountID = Number(req.params.accountID);
      const { warning, transaction } = await deleteTransactionCore(db, {
         accountId: accountID,
         actorId: Number(req.user.user_id),
         transaction: sanitizeFields(req.body.transaction || {})
      });

      await sendUpdatedTableWith200Response(db, res, accountID, {warning,changed:{deletedTransactions:[transaction.transaction_id]}});
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
      const names=require('../../utils/auditContext').storage.getStore()?.billingEntityNames || {};
      const csv = generateTransactionsCsv(transactions.map(row=>({...row,billing_entity_name:names[row.billing_entity_id] || 'Assignment needed'})), TRANSACTION_EXPORT_COLUMNS);
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

// Get a specific transaction. A non-numeric or unknown id is a clean refusal
// in the app's envelope (like getSingleRetainer), never an empty success or a
// raw 500 from Postgres rejecting the cast.
transactionsRouter.route('/getSingleTransaction/:customerID/:transactionID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const customerID = Number(req.params.customerID);
   const transactionID = Number(req.params.transactionID);

   try {
      const isId = value => Number.isSafeInteger(value) && value > 0;
      const transactionData = isId(customerID) && isId(transactionID) ? await transactionsService.getSingleTransaction(db, accountID, customerID, transactionID) : [];
      if (!transactionData.length) {
         return res.send({ message: 'No matching transaction record found.', status: 404 });
      }

      const activeTransactionsData = {
         transactionData,
         grid: createGrid(transactionData)
      };

      res.send({
         activeTransactionsData,
         message: 'Successfully retrieved specific transaction.',
         status: 200
      });
   } catch (error) {
      console.log(error);
      res.send({
         message: 'Failure to retrieve single transaction.',
         status: 500
      });
   }
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

      return await sendUpdatedTableWith200Response(db, res, accountID, { userTime }, false);
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

const sendUpdatedTableWith200Response = async (db, res, accountID, additionalItems = {}, afterCommit = true) => {
   const loadTables = async () => {
      return {...await require('../../utils/listPayload').firstPages(db,accountID,['transactions','retainers','payments']),...additionalItems};
   };
   return afterCommit ? committedResponse(res, 'Successful.', loadTables) : res.send(await loadTables());
};

// Cells go through the shared csv-util: user-entered text that a spreadsheet
// would run as a formula (leading = + - @ TAB CR) is neutralised with a leading
// apostrophe, numeric strings such as '-225.00' stay numbers, and dates keep
// their ISO timestamp.
const generateTransactionsCsv = (rows, columns) => {
   const orderedColumns = Array.isArray(columns) && columns.length ? columns : Object.keys(rows[0] || {});
   const header = orderedColumns.join(',');
   const dataLines = rows.map(row => csvRow(orderedColumns.map(column => row[column])));
   return [header, ...dataLines].join('\n');
};
