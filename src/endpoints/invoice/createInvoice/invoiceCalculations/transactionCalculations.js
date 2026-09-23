const groupAndTotalTransactions = (customer_id, invoiceQueryData, showWriteOffs) => {
   const customerTransactions = invoiceQueryData.customerTransactions[customer_id] || [];
   const customerWriteOffRecords = invoiceQueryData.customerWriteOffs[customer_id] || [];

   // Handles if showWriteoff is false than add to transactions, if showWriteOffs is true, then write offs are handles separately.
   const groupedWriteOffs = groupWriteOffsByJob(customerWriteOffRecords, showWriteOffs);

   const transactionsGroupedByJob = groupAndTotalTransactionsByJob(customerTransactions, groupedWriteOffs);
   addAdjustmentOnlyJobGroups(transactionsGroupedByJob, groupedWriteOffs);
   return totalGroupedJobsByCustomer(transactionsGroupedByJob, customerTransactions);
};

/**
 * A job-level write-down entered for a job that has NO unbilled time this cycle
 * must still credit the customer: previously it only ever reached the bill by
 * riding along with a transaction group, so with "Show Write Offs" unchecked it
 * was silently dropped and, once the statement gate moved on, lost for good.
 * Invoice-linked write-offs are excluded here (writeOffCalculations owns them).
 */
const addAdjustmentOnlyJobGroups = (transactionsGroupedByJob, groupedWriteOffs) => {
   Object.entries(groupedWriteOffs).forEach(([jobID, records]) => {
      if (transactionsGroupedByJob[jobID]) return;
      const creditRows = records.filter(writeOff => !writeOff.customer_invoice_id);
      if (!creditRows.length) return;
      const total = creditRows.reduce((acc, writeOff) => acc + Number(writeOff.writeoff_amount), 0);
      transactionsGroupedByJob[jobID] = {
         jobDescription: creditRows[0].job_description || (jobID === UNASSIGNED_JOB_KEY ? 'General credit' : 'Adjustment'),
         customerID: creditRows[0].customer_id,
         jobID: jobID === UNASSIGNED_JOB_KEY ? null : Number(jobID),
         jobTotal: total,
         jobWriteOffTotal: total,
         jobWriteOffRecords: creditRows,
         transactionRecords: []
      };
   });
};

// NOTE: if transactions is empty, but writeoffs exists..... condition to be handled in write offs calculation. this excludes if an invoice is written off. If a invoice is written off is already addressed in the outstanding invoice calculation.
// NOTE: - as written, for write offs to work, the amount outstanding must be greater than the written off amount. Needs testing.

module.exports = { groupAndTotalTransactions };

/**
 * Group writeoffs by job so to create an object map
 * @param {*} customerWriteOffRecords
 * @returns
 */
// Write-offs with neither a job nor an invoice link are general credits; they are
// grouped under an explicit key instead of the string "null".
const UNASSIGNED_JOB_KEY = 'unassigned';

const groupWriteOffsByJob = (customerWriteOffRecords, showWriteOffs) => {
   if (!customerWriteOffRecords.length || showWriteOffs) return {};
   return customerWriteOffRecords.reduce((acc, curr) => {
      const key = curr.customer_job_id == null ? UNASSIGNED_JOB_KEY : curr.customer_job_id;
      return { ...acc, [key]: [...(acc[key] || []), curr] };
   }, {});
};

/**
 *
 * @param {*} customerTransactions - Array of transactions
 * @param {*} groupedWriteOffs - Object map of writeoffs grouped by job
 */
const groupAndTotalTransactionsByJob = (customerTransactions, groupedWriteOffs) => {
   return customerTransactions.reduce((prev, transaction) => {
      const jobDescription = transaction.job_description;
      const currentJobKey = transaction.customer_job_id;
      const customerID = transaction.customer_id;

      // On job initialization, add the writeoffs to the job
      if (!prev[currentJobKey]) {
         // Access the write off records for the current job, if they exist
         const jobWriteOffRecords = groupedWriteOffs[currentJobKey] || [];
         // Total the jobs write offs
         const jobWriteOffTotal = jobWriteOffRecords.length ? jobWriteOffRecords.reduce((acc, curr) => acc + Number(curr.writeoff_amount), 0) : 0;
         // Create Job Object
         prev[currentJobKey] = { jobDescription, customerID, jobID: currentJobKey, jobTotal: 0 + jobWriteOffTotal, jobWriteOffTotal, jobWriteOffRecords, transactionRecords: [] };
      }

      // Regardless of if a monthly customer has additional work or not, if the work is billable, add it to the total. All that matters is if a transaction is billable or not.
      if (transaction.is_transaction_billable) {
         prev[currentJobKey].jobTotal += Number(transaction.total_transaction);
      }

      prev[currentJobKey].transactionRecords.push(transaction);

      return prev;
   }, {});
};

/**
 * Total all transactions per job and return an object with the total and the transaction records
 * @param {*} transactionsGroupedByJob
 * @returns {Object} { transactionsTotal: Number, transactionRecords: Array }
 */
const totalGroupedJobsByCustomer = (transactionsGroupedByJob, customerTransactions) => {
   if (!Object.values(transactionsGroupedByJob).length) return { transactionsTotal: 0, transactionRecords: [], allTransactionRecords: customerTransactions };

   return Object.values(transactionsGroupedByJob).reduce((acc, curr) => {
      if (!acc.transactionRecords) acc = { transactionsTotal: 0, transactionRecords: [], allTransactionRecords: customerTransactions };

      acc.transactionRecords.push(curr);
      acc.transactionsTotal += Number(curr.jobTotal);

      if (isNaN(acc.transactionsTotal)) {
         console.log('Transaction Total is NaN');
         throw new Error('Transaction Total is NaN');
      }
      if (acc.transactionsTotal === null || acc.transactionsTotal === undefined) {
         console.log('Transaction Total is null or undefined');
         throw new Error('Transaction Total is null or undefined');
      }
      if (typeof acc.transactionsTotal !== 'number') {
         console.log('Transaction Total is not a number');
         throw new Error('Transaction Total is not a number');
      }
      return acc;
   }, {});
};
