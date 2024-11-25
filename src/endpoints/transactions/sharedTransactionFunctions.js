const transactionsService = require('../transactions/transactions-service');
const retainerService = require('../retainer/retainer-service');
const jobService = require('../job/job-service');
const paymentsService = require('../payments/payments-service');
const { createPaymentObjectFromTransaction } = require('./transactionsObjects');

/**
 * Process a new transaction
 * @param {*} transactionTableFields - Fields for the transaction table
 * @param {*} sanitizedNewTransaction - Sanitized fields for the transaction, used to create a payment if retainer is used
 * @returns - New transaction
 */
const addNewTransaction = async (db, transactionTableFields, sanitizedNewTransaction) => {
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

   // Post new transaction, returns new transaction
   return transactionsService.createTransaction(db, newTransaction);
};

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

// export each function
module.exports = {
   addNewTransaction,
   differenceBetweenOldAndNewTransaction,
   updateRecentJobTotal,
   updateRetainerTotal,
   handleRetainerUpdate
};
