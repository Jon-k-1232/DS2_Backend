const { requireAccountRow } = require('../../utils/relatedAccount');
const express = require('express');
const { enforceAccountId } = require('../auth/account-scope');
const jobRouter = express.Router();
jobRouter.param('accountID', enforceAccountId);
const jobService = require('./job-service');
const transactionsService = require('../transactions/transactions-service');
const writeOffsService = require('../writeOffs/writeOffs-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { restoreDataTypesJobTableOnCreate, restoreDataTypesJobTableOnUpdate } = require('./jobObjects');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const dayjs = require('dayjs');
const { withTransaction, lockCustomerLedger, ruleError } = require('../payments/ledger-helpers');

/**
 * Ledger-serialize a job-family write. Job create/update/delete used to run
 * with NO lock at all, so a transaction/write-off/payment writer for the same
 * customer could interleave between this route's "nothing is linked" checks
 * and its writes (2026-09 review, finding A2) — e.g. a reassignment's checks
 * could pass while the family had nothing linked yet, a transaction land on
 * the job a moment later from a different request, and the reassignment
 * still go through, leaving that transaction and its job under different
 * customers with no refusal on either side.
 *
 * Locks the ledger of the job's CURRENT customer and — for a reassignment —
 * its destination customer too, both in sorted id order (the same convention
 * every other ledger writer uses so two writers locking the same two
 * customers in opposite request order cannot deadlock each other). Only
 * THEN re-reads the job: if it moved to a different customer while this
 * request waited for the lock, the checks the caller is about to run would
 * be checking the wrong customer's ledger, so the write is refused rather
 * than trusted. `fn(trx, storedJob)` does the actual checks + mutation.
 */
const withJobLedger = (db, accountId, jobId, nextCustomerId, fn) =>
   withTransaction(db, async trx => {
      const [before] = await jobService.getSingleJob(trx, jobId, accountId);
      if (!before) throw ruleError('Job not found.', 404);

      const ids = [...new Set([Number(before.customer_id), Number(nextCustomerId || before.customer_id)])].sort((a, b) => a - b);
      for (const id of ids) await lockCustomerLedger(trx, accountId, id);

      // Re-read under the lock: a concurrent request may have reassigned or
      // deleted this job while this one waited for the lock above.
      const [stored] = await jobService.getSingleJob(trx, jobId, accountId);
      if (!stored || Number(stored.customer_id) !== Number(before.customer_id)) {
         throw ruleError('Job changed while saving. Refresh and retry.', 409);
      }
      return fn(trx, stored);
   });

// Create a new job
jobRouter.route('/createJob/:accountID/:userID').post(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedNewJob = sanitizeFields(req.body.job);
      // Create new object with sanitized fields
      const jobTableFields = restoreDataTypesJobTableOnCreate(sanitizedNewJob);
      // Trust the account from the (guard-verified) URL, never the request body.
      jobTableFields.account_id = Number(accountID);
      jobTableFields.created_by_user_id = Number(req.user.user_id);
      // A brand new job is always a family ROOT. A client-supplied parentJobID
      // would attach it to (and corrupt) an existing family it doesn't belong
      // to — only updateRecentJobTotal creates real version rows, internally.
      jobTableFields.parent_job_id = null;

      await withTransaction(db, async trx => {
         await lockCustomerLedger(trx, accountID, jobTableFields.customer_id);
         await requireAccountRow(trx, 'customer_job_types', 'job_type_id', jobTableFields.job_type_id, accountID, 'Job type');

         // Check for duplicate job
         const duplicateJob = await jobService.findDuplicateJob(trx, jobTableFields);
         if (duplicateJob.length) throw new Error('Duplicate job');

         // Post new job
         await jobService.createJob(trx, jobTableFields);
      });
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'Error creating job.',
         status: 500
      });
   }
});

// Get job for a company
jobRouter.route('/getSingleJob/:customerJobID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { customerJobID, accountID } = req.params;

   const activeJobs = await jobService.getSingleJob(db, customerJobID, accountID);

   const activeJobData = {
      activeJobs,
      grid: createGrid(activeJobs),
      treeGrid: generateTreeGridData(activeJobs, 'customer_job_id', 'parent_job_id')
   };

   res.send({
      activeJobData,
      message: 'Successfully retrieved single job.',
      status: 200
   });
});

// Get all active jobs for a customer
jobRouter.route('/getActiveCustomerJobs/:accountID/:userID/:customerID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID, customerID } = req.params;

   const customerJobs = await jobService.getActiveCustomerJobs(db, accountID, customerID);

   const activeCustomerJobs = jobService.latestFamilyVersions(customerJobs);

   // Add display_name field for autocomplete
   activeCustomerJobs.forEach(job => (job.display_name = `${job.job_description} - ${job.customer_job_category}`));

   // Return Object
   const activeCustomerJobData = {
      activeCustomerJobs,
      grid: createGrid(activeCustomerJobs),
      treeGrid: generateTreeGridData(activeCustomerJobs, 'customer_job_id', 'parent_job_id')
   };

   res.send({
      activeCustomerJobData,
      message: 'Successfully retrieved active customer jobs.',
      status: 200
   });
});

// Update a job
jobRouter.route('/updateJob/:accountID/:userID').put(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      const sanitizedUpdatedJob = sanitizeFields(req.body.job);
      // Create new object with sanitized fields
      const jobTableFields = restoreDataTypesJobTableOnUpdate(sanitizedUpdatedJob);
      // Trust the account from the (guard-verified) URL, never the request body.
      jobTableFields.account_id = Number(accountID);

      const warning = await withJobLedger(db, accountID, jobTableFields.customer_job_id, jobTableFields.customer_id, async (trx, jobRowBeforeEdits) => {
         jobTableFields.parent_job_id = jobRowBeforeEdits.parent_job_id;
         await requireAccountRow(trx, 'customer_job_types', 'job_type_id', jobTableFields.job_type_id, accountID, 'Job type');
         let reassignWarning;

         // Repointing a job to a different customer is dangerous once billing
         // history already exists against it: a job is really a version FAMILY
         // (see deleteJob below), and a transaction/write-off/payment can
         // reference any member of the family, not just the row named in the
         // URL. Letting the reassignment through would silently strand that
         // already-recorded billing history under the OLD customer while the
         // job itself moves to the new one - refuse when anything is linked;
         // when nothing is linked, allow it but say so in the response.
         const isReassigningCustomer = Number(jobTableFields.customer_id) !== Number(jobRowBeforeEdits.customer_id);
         if (isReassigningCustomer) {
            const familyIds = await jobService.getJobFamilyIds(trx, jobTableFields.customer_job_id, accountID);

            const linkedTransactions = await transactionsService.getTransactionsByJobID(trx, accountID, familyIds);
            if (linkedTransactions.length) throw new Error('Cannot reassign this job to a different customer: transactions are linked to it or one of its prior versions.');

            const writeOffResults = await Promise.all(familyIds.map(familyId => writeOffsService.getWriteOffsByJobID(trx, accountID, familyId)));
            if (writeOffResults.some(rows => rows.length)) throw new Error('Cannot reassign this job to a different customer: write offs are linked to it or one of its prior versions.');

            // No payments-service method filters by job id; query directly (same as deleteJob below).
            const linkedPayments = await trx.select('payment_id').from('customer_payments').where('account_id', accountID).whereIn('customer_job_id', familyIds);
            if (linkedPayments.length) throw new Error('Cannot reassign this job to a different customer: payments are linked to it or one of its prior versions.');

            // Nothing is linked — checked under the SAME lock this write now
            // holds, so no writer for either customer can interleave between
            // the check above and this move. Every row in the family moves
            // together (not just the one the URL named), so no sibling
            // version row is left stranded under the old customer.
            await trx('customer_jobs').where({ account_id: Number(accountID) }).whereIn('customer_job_id', familyIds).update({ customer_id: jobTableFields.customer_id });
            reassignWarning = 'Job was reassigned to a different customer. It had no linked transactions, write-offs, or payments.';
         }

         if (jobTableFields.is_job_complete !== jobRowBeforeEdits.is_job_complete) {
            // Toggle job completion
            await jobService.toggleJobCompletion(trx, jobTableFields, accountID);
         }

         // Update job
         await jobService.updateJob(trx, jobTableFields, accountID);
         return reassignWarning;
      });

      await sendUpdatedTableWith200Response(db, res, accountID, warning);
   } catch (error) {
      console.log(error);
      res.send({
         message: error.message || 'An error occurred while updating the Job.',
         status: 500
      });
   }
});

// Delete a job
jobRouter.route('/deleteJob/:jobID/:accountID/:userID').delete(jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID, jobID } = req.params;

   try {
      // A job is really a version FAMILY: every total change inserts a new
      // row (parent_job_id -> root) rather than mutating in place. Deleting
      // only the one row the user clicked on would silently orphan its
      // sibling versions, and a transaction/write-off/payment can reference
      // ANY member of the family, not just the root - so the in-use check
      // and the delete itself must both operate on the whole family, under
      // the same customer ledger lock every other ledger writer takes.
      await withJobLedger(db, accountID, jobID, null, async trx => {
         const familyIds = await jobService.getJobFamilyIds(trx, jobID, accountID);
         if (!familyIds.length) throw new Error('Job not found.');

         const linkedTransactions = await transactionsService.getTransactionsByJobID(trx, accountID, familyIds);
         if (linkedTransactions.length) throw new Error('Transactions are linked to this job or one of its prior versions; it cannot be deleted.');

         const writeOffResults = await Promise.all(familyIds.map(familyId => writeOffsService.getWriteOffsByJobID(trx, accountID, familyId)));
         if (writeOffResults.some(rows => rows.length)) throw new Error('Write offs are linked to this job or one of its prior versions; it cannot be deleted.');

         // No payments-service method filters by job id; query directly.
         const linkedPayments = await trx.select('payment_id').from('customer_payments').where('account_id', accountID).whereIn('customer_job_id', familyIds);
         if (linkedPayments.length) throw new Error('Payments are linked to this job or one of its prior versions; it cannot be deleted.');

         // Delete every row in the family (root + prior versions).
         await jobService.deleteJobFamily(trx, familyIds, accountID);
      });
      await sendUpdatedTableWith200Response(db, res, accountID);
   } catch (error) {
      console.log(error);
      res.send({
         message: error.message || 'An error occurred while updating the Job.',
         status: 500
      });
   }
});

module.exports = jobRouter;

const sendUpdatedTableWith200Response = async (db, res, accountID, warning) => {
   // Get all jobs
   const activeJobs = await jobService.getActiveJobs(db, accountID);

   const activeJobData = {
      activeJobs,
      grid: createGrid(activeJobs),
      treeGrid: generateTreeGridData(activeJobs, 'customer_job_id', 'parent_job_id')
   };

   const response = {
      accountJobsList: { activeJobData },
      message: 'Successfully created new job.',
      status: 200
   };
   if (warning) response.warning = warning;

   res.send(response);
};
