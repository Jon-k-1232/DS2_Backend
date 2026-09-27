const { committedResponse } = require('../../utils/committedResponse');
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

// Job-only receipt/credit links are protected even when the family has no work.
const assertJobCreditsUnlocked = async (trx, accountId, familyIds) => {
   const { assertUnlocked } = require('../invoice/sentInvoiceLocks');
   for (const [table,key] of [['customer_payments','payment_id'],['customer_writeoffs','writeoff_id']]) {
      const rows = await trx(table).where({account_id:Number(accountId)}).whereIn('customer_job_id',familyIds).select(key);
      for (const row of rows) await assertUnlocked(trx,accountId,table,row[key]);
   }
};

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

      const createdJob = await withTransaction(db, async trx => {
         await lockCustomerLedger(trx, accountID, jobTableFields.customer_id);
         await requireAccountRow(trx, 'customer_job_types', 'job_type_id', jobTableFields.job_type_id, accountID, 'Job type');

         // Check for duplicate job
         const duplicateJob = await jobService.findDuplicateJob(trx, jobTableFields);
         if (duplicateJob.length) throw new Error('Duplicate job');

         // Post new job
         return jobService.createJob(trx, jobTableFields);
      });
      await sendUpdatedTableWith200Response(db, res, accountID, undefined, async()=>({ jobs: await jobService.getActiveCustomerJobs(db,accountID,createdJob.customer_id).where('customer_jobs.customer_job_id',createdJob.customer_job_id) }));
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

   const activeJobs = await require('../../utils/actorNames')(db,accountID,await jobService.getSingleJob(db, customerJobID, accountID),'created_by_user_id','created_by_user_name');

   if(activeJobs.length){
      const job=activeJobs[0],root=job.parent_job_id || job.customer_job_id;
      // An edit may refer to an older version that is absent from the first
      // page. Hydrate that exact row's labels without loading its client's
      // history, and keep the raw service used by ledger writers unchanged.
      const [details] = await jobService.getActiveCustomerJobs(db, accountID, job.customer_id)
         .where('customer_jobs.customer_job_id', job.customer_job_id);
      if (details) Object.assign(job, details);
      const family=db('customer_jobs').where({account_id:Number(accountID)}).where(b=>b.where('customer_job_id',root).orWhere('parent_job_id',root)).select('customer_job_id');
      job.dependencies={};
      for(const [kind,table,key] of [['transactions','customer_transactions','transaction_id'],['writeoffs','customer_writeoffs','writeoff_id'],['payments','customer_payments','payment_id']]){
         const query=db(table).where({account_id:Number(accountID)}).whereIn('customer_job_id',family.clone());
         const count=await query.clone().count('* as count').first();
         job.dependencies[kind]=await query.select('*').orderBy(key,'desc').limit(100);
         job.dependencies[kind+'Count']=Number(count.count);
      }
   }
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

// Bounded read contracts. No account-wide job payload is exposed.
const {lookupParams}=require('../../utils/lookupParams');
const {getPaginationMetadata}=require('../../utils/pagination');
const readJobs=async(req,res)=>{
   try {
      const options=lookupParams(req.query),customerId=req.params.customerID;
      if(req.query.currentCycle!=null){
         if(!customerId || !['true','false'].includes(req.query.currentCycle))throw ruleError('Invalid currentCycle; use true or false on a client lookup.',400);
         options.currentCycle=req.query.currentCycle==='true';
      }
      if(customerId){
         if(!/^[1-9]\d*$/.test(customerId) || Number(customerId)>2147483647)throw ruleError('Invalid customer.',400);
         if(!await req.app.get('db')('customers').where({account_id:Number(req.params.accountID),customer_id:Number(customerId)}).first())throw ruleError('Customer not found.',404);
      }
      for(const key of ['jobTypeId','categoryId'])if(req.query[key]!=null){if(typeof req.query[key]!=='string'|| !/^[1-9]\d*$/.test(req.query[key]) || Number(req.query[key])>2147483647)throw ruleError('Invalid '+key+'.',400);options[key]=Number(req.query[key]);}
      const {jobs,totalCount}=await jobService.getJobsPage(req.app.get('db'),req.params.accountID,{...options,customerId,latest:true});
      const pagination=getPaginationMetadata(totalCount,options.page,options.limit);
      res.send({status:200,...(customerId ? {activeCustomerJobData:{activeCustomerJobs:jobs,pagination}} : {accountJobsList:{activeJobData:{activeJobs:jobs,pagination,partial:true}}})});
   }catch(e){const status=e.statusCode||500;res.status(status).send({status,message:status===500?'Unable to load jobs. Try again.':e.message});}
};
jobRouter.get('/getJobs/:accountID/:userID',readJobs);
jobRouter.get('/getActiveCustomerJobs/:accountID/:userID/:customerID',readJobs);

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
            await assertJobCreditsUnlocked(trx,accountID,familyIds);

            const linkedTransactions = await transactionsService.getTransactionsByJobID(trx, accountID, familyIds);
            for (const t of linkedTransactions) await require('../invoice/sentInvoiceLocks').assertUnlocked(trx, accountID, 'customer_transactions', t.transaction_id);
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

      await sendUpdatedTableWith200Response(db, res, accountID, warning, async()=>({jobs:await jobService.getSingleJob(db,jobTableFields.customer_job_id,accountID)}));
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
         await assertJobCreditsUnlocked(trx,accountID,familyIds);

         const linkedTransactions = await transactionsService.getTransactionsByJobID(trx, accountID, familyIds);
            for (const t of linkedTransactions) await require('../invoice/sentInvoiceLocks').assertUnlocked(trx, accountID, 'customer_transactions', t.transaction_id);
         if (linkedTransactions.length) throw new Error('Transactions are linked to this job or one of its prior versions; it cannot be deleted.');

         const writeOffResults = await Promise.all(familyIds.map(familyId => writeOffsService.getWriteOffsByJobID(trx, accountID, familyId)));
         if (writeOffResults.some(rows => rows.length)) throw new Error('Write offs are linked to this job or one of its prior versions; it cannot be deleted.');

         // No payments-service method filters by job id; query directly.
         const linkedPayments = await trx.select('payment_id').from('customer_payments').where('account_id', accountID).whereIn('customer_job_id', familyIds);
         if (linkedPayments.length) throw new Error('Payments are linked to this job or one of its prior versions; it cannot be deleted.');

         // Delete every row in the family (root + prior versions).
         await jobService.deleteJobFamily(trx, familyIds, accountID);
      });
      await sendUpdatedTableWith200Response(db, res, accountID, undefined, {deletedJobs:[Number(jobID)]});
   } catch (error) {
      console.log(error);
      res.send({
         message: error.message || 'An error occurred while updating the Job.',
         status: 500
      });
   }
});

module.exports = jobRouter;

const sendUpdatedTableWith200Response = async (db,res,accountID,warning,changed={}) => committedResponse(res,'Successfully saved job changes.',async()=>({
   ...await require('../../utils/listPayload').firstPage(db,accountID,'jobs'),changed:typeof changed==='function'?await changed():changed,...(warning?{warning}:{})
}));
