/**
 * HTTP-level route coverage: src/endpoints/job/**, jobType/**, jobCategories/**,
 * workDescriptions/**, quotes/**.
 *
 * Tenancy/role-gate baseline (src/app.js): all five routers here are mounted
 * with `requireAuth, requireManagerOrAdmin` —
 *   app.use('/jobs', requireAuth, requireManagerOrAdmin, company);
 *   app.use('/jobCategories', requireAuth, requireManagerOrAdmin, jobCategoriesRouter);
 *   app.use('/jobTypes', requireAuth, requireManagerOrAdmin, jobTypeRouter);
 *   app.use('/quotes', requireAuth, requireManagerOrAdmin, quotesRouter);
 *   app.use('/workDescriptions', requireAuth, requireManagerOrAdmin, workDescriptionsRouter);
 * matching '/invoices' and '/accountsReceivable', and matching the frontend,
 * which wraps the ENTIRE Jobs section
 * (DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/JobRoutes.js, every route)
 * in <ManagerAndAdminProtectedAccessRoute> (admin/manager/super admin only —
 * DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js). A plain
 * 'employee' access_level now gets a 403 on every route below (previously
 * none of these five routers had any role gate at all); that UI-vs-API
 * mismatch used to be a GAP and is now closed, exercised explicitly below.
 *
 * Tenancy note for jobTypes/jobCategories/workDescriptions/quotes UPDATE and
 * DELETE: none of those four routers pre-checks that the target row exists
 * for the caller's account before writing (job's updateJob/deleteJob DO
 * pre-check, via getSingleJob/getJobFamilyIds); they go straight to an
 * `UPDATE ... WHERE id = ? AND account_id = ?` / `DELETE ... WHERE id = ? AND
 * account_id = ?` and now check the affected-row count afterward. A request
 * naming another tenant's row id (while correctly scoped via the caller's OWN
 * account in the URL/token) matches zero rows, so the route answers a clean
 * 404 rather than a misleading 200 "success" envelope. Every "account-1 row
 * is untouchable" test below proves the isolation with a read-only SELECT and
 * the 404 response.
 */
const { expect } = require('chai');
const { bootHttp, uniqueName, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');

describe('Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes)', function () {
   let h;
   const FOREIGN_ACCOUNT_ID = 1; // real tenant (account 1) — read-only reference, never mutated
   const NOT_FOUND_ID = 999999999;
   const FIXTURE_CATEGORY_ID = 90001; // 'Tax Compliance' (test/fixtures/seed.sql)
   const FIXTURE_CUSTOMER_A = 900101; // Acme Corporation
   const FIXTURE_CUSTOMER_B = 900102; // Globex Industries
   const FIXTURE_CUSTOMER_NO_JOBS = 900104; // Jane Smith — no fixture job pre-exists for this customer
   const FIXTURE_WORK_DESCRIPTION_ID = 90031;
   const FIXTURE_JOB_ID = 9001001; // permanent fixture job (customer 900101), safe FK target for quotes

   // Rows this spec creates, tracked for FK-safe cleanup in `after`.
   const created = {
      transactions: [],
      writeoffs: [],
      payments: [],
      quotes: [],
      jobs: [],
      jobTypes: [],
      jobCategories: [],
      workDescriptions: []
   };

   // Account-1 sample rows, fetched read-only once so the tenancy tests don't
   // need to guess real prod ids. Never written to. (customer_quotes has no
   // account-1 equivalent — quotes is a dead endpoint with no real usage, so
   // the quotes coverage below is a fully self-contained round trip on
   // account 9001's own fixtures instead of an account-1 tenancy check.)
   let acct1JobCategory, acct1JobType, acct1WorkDescription, acct1Job;

   before(async function () {
      h = await bootHttp.call(this);
      acct1JobCategory = await h.db('customer_job_categories').where('account_id', FOREIGN_ACCOUNT_ID).first();
      acct1JobType = await h.db('customer_job_types').where('account_id', FOREIGN_ACCOUNT_ID).first();
      acct1WorkDescription = await h.db('customer_general_work_descriptions').where('account_id', FOREIGN_ACCOUNT_ID).first();
      acct1Job = await h.db('customer_jobs').where('account_id', FOREIGN_ACCOUNT_ID).first();
   });

   after(async function () {
      if (!h) return;
      const { db } = h;
      try {
         if (created.transactions.length) await db('customer_transactions').whereIn('transaction_id', created.transactions).del();
         if (created.writeoffs.length) await db('customer_writeoffs').whereIn('writeoff_id', created.writeoffs).del();
         if (created.payments.length) await db('customer_payments').whereIn('payment_id', created.payments).del();
         if (created.quotes.length) await db('customer_quotes').whereIn('customer_quote_id', created.quotes).del();
         if (created.jobs.length) await db('customer_jobs').whereIn('customer_job_id', created.jobs).del();
         // Belt-and-suspenders: a version row a test created without pushing
         // its own id to created.jobs (easy to miss — a family has more than
         // one row) can still reference one of this run's job types. The
         // whereIn delete below is one all-or-nothing statement, so a single
         // leftover reference fails every job type in the batch, not just the
         // one it's attached to. Sweep customer_jobs by job_type_id too (this
         // account's transactions/write-offs/payments are already gone above)
         // so one tracking gap can never strand the rest of this run's cleanup.
         if (created.jobTypes.length) await db('customer_jobs').whereIn('job_type_id', created.jobTypes).del();
         if (created.jobTypes.length) await db('customer_job_types').whereIn('job_type_id', created.jobTypes).del();
         if (created.jobCategories.length) await db('customer_job_categories').whereIn('customer_job_category_id', created.jobCategories).del();
         if (created.workDescriptions.length) await db('customer_general_work_descriptions').whereIn('general_work_description_id', created.workDescriptions).del();
      } finally {
         await h.close();
      }
   });

   // ---------------------------------------------------------------------
   // Fixture helpers — every create goes through the real HTTP route (so the
   // route itself is exercised as part of setup too) and is tagged with
   // uniqueName() so it can be found again via a plain DB read and cleaned up.
   // ---------------------------------------------------------------------
   const actingUserID = identity => (identity === 'employee' ? h.employeeUserID : h.adminUserID);

   const mkJobCategory = async (identity, overrides = {}) => {
      const uid = actingUserID(identity);
      const category = uniqueName('JCAT');
      const body = { accountID: h.accountID, category, isActive: true, createdBy: uid, ...overrides };
      const res = await h.as(identity).post(`/jobCategories/createJobCategory/${h.accountID}/${uid}`).send({ jobCategory: body });
      expectEnvelopeOk(res, 'mkJobCategory');
      const row = await h.db('customer_job_categories').where({ account_id: h.accountID, customer_job_category: category }).first();
      expect(row, 'job category row should exist after create').to.exist;
      created.jobCategories.push(row.customer_job_category_id);
      return row;
   };

   const mkJobType = async (identity, categoryID, overrides = {}) => {
      const uid = actingUserID(identity);
      const jobDescription = uniqueName('JTYPE');
      const body = {
         accountID: h.accountID,
         userID: uid,
         customerJobCategory: categoryID,
         jobDescription,
         bookRate: 100,
         estimatedStraightTime: 60,
         ...overrides
      };
      const res = await h.as(identity).post(`/jobTypes/createJobType/${h.accountID}/${uid}`).send({ jobType: body });
      expectEnvelopeOk(res, 'mkJobType');
      const row = await h.db('customer_job_types').where({ account_id: h.accountID, job_description: jobDescription }).first();
      expect(row, 'job type row should exist after create').to.exist;
      created.jobTypes.push(row.job_type_id);
      return row;
   };

   const mkJob = async (identity, customerID, jobTypeID, overrides = {}) => {
      const uid = actingUserID(identity);
      const body = {
         accountID: h.accountID,
         userID: uid,
         customerID,
         jobTypeID,
         quoteAmount: 0,
         agreedJobAmount: 500,
         isQuote: false,
         notes: uniqueName('job-note'),
         ...overrides
      };
      const res = await h.as(identity).post(`/jobs/createJob/${h.accountID}/${uid}`).send({ job: body });
      expectEnvelopeOk(res, 'mkJob');
      const row = await h.db('customer_jobs').where({ account_id: h.accountID, customer_id: customerID, job_type_id: jobTypeID }).first();
      expect(row, 'job row should exist after create').to.exist;
      created.jobs.push(row.customer_job_id);
      return row;
   };

   const mkWorkDescription = async (identity, overrides = {}) => {
      const uid = actingUserID(identity);
      const generalWorkDescription = uniqueName('WD');
      const body = { generalWorkDescription, estimatedTime: 30, isGeneralWorkDescriptionActive: true, ...overrides };
      const res = await h.as(identity).post(`/workDescriptions/createWorkDescription/${h.accountID}/${uid}`).send({ workDescription: body });
      expectEnvelopeOk(res, 'mkWorkDescription');
      const row = await h.db('customer_general_work_descriptions').where({ account_id: h.accountID, general_work_description: generalWorkDescription }).first();
      expect(row, 'work description row should exist after create').to.exist;
      created.workDescriptions.push(row.general_work_description_id);
      return row;
   };

   const mkQuote = async (identity, overrides = {}) => {
      const uid = actingUserID(identity);
      const notes = uniqueName('QUOTE');
      const body = {
         account_id: h.accountID,
         customer_id: FIXTURE_CUSTOMER_A,
         customer_job_id: FIXTURE_JOB_ID,
         amount_quoted: 1234.56,
         is_quote_active: true,
         created_by_user_id: uid,
         notes,
         ...overrides
      };
      const res = await h.as(identity).post('/quotes/createQuote').send({ quote: body });
      expectEnvelopeOk(res, 'mkQuote');
      const row = await h.db('customer_quotes').where({ account_id: h.accountID, notes }).first();
      expect(row, 'quote row should exist after create').to.exist;
      created.quotes.push(row.customer_quote_id);
      return row;
   };

   // Direct-DB fixtures for the "in use" delete guards — these tables have no
   // bearing on this spec's own router area, so we insert the minimum valid
   // row rather than going through the transactions/writeOffs/payments APIs.
   const insertTransactionForJob = async (jobID, customerID, overrides = {}) => {
      const [row] = await h
         .db('customer_transactions')
         .insert({
            account_id: h.accountID,
            customer_id: customerID,
            customer_job_id: jobID,
            logged_for_user_id: h.employeeUserID,
            general_work_description_id: FIXTURE_WORK_DESCRIPTION_ID,
            detailed_work_description: uniqueName('txn'),
            transaction_date: '2026-01-15',
            transaction_type: 'Time',
            quantity: 1,
            unit_cost: 75,
            total_transaction: 75,
            is_transaction_billable: true,
            is_excess_to_subscription: false,
            created_by_user_id: h.adminUserID,
            ...overrides
         })
         .returning('*');
      created.transactions.push(row.transaction_id);
      return row;
   };

   const insertWriteoffForJob = async (jobID, customerID, overrides = {}) => {
      const [row] = await h
         .db('customer_writeoffs')
         .insert({
            account_id: h.accountID,
            customer_id: customerID,
            customer_job_id: jobID,
            writeoff_date: '2026-01-15',
            writeoff_amount: -50,
            transaction_type: 'Writeoff',
            writeoff_reason: uniqueName('writeoff'),
            created_by_user_id: h.adminUserID,
            ...overrides
         })
         .returning('*');
      created.writeoffs.push(row.writeoff_id);
      return row;
   };

   const insertPaymentForJob = async (jobID, customerID, overrides = {}) => {
      const [row] = await h
         .db('customer_payments')
         .insert({
            account_id: h.accountID,
            customer_id: customerID,
            customer_job_id: jobID,
            payment_date: '2026-01-15',
            payment_amount: -100,
            form_of_payment: 'Check',
            is_transaction_billable: true,
            created_by_user_id: h.adminUserID,
            ...overrides
         })
         .returning('*');
      created.payments.push(row.payment_id);
      return row;
   };

   // =======================================================================
   // POST /jobs/createJob/:accountID/:userID
   // =======================================================================
   describe('POST /jobs/createJob/:accountID/:userID', () => {
      it('happy path: creates a job and returns the updated jobs list', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const notes = uniqueName('happy-job-note');
         const res = await h
            .as('admin')
            .post(`/jobs/createJob/${h.accountID}/${h.adminUserID}`)
            .send({
               job: {
                  accountID: h.accountID,
                  userID: h.adminUserID,
                  customerID: FIXTURE_CUSTOMER_NO_JOBS,
                  jobTypeID: jobType.job_type_id,
                  quoteAmount: 0,
                  agreedJobAmount: 750.25,
                  isQuote: false,
                  notes
               }
            });
         const body = expectEnvelopeOk(res, 'createJob happy path');
         const jobs = body.accountJobsList.activeJobData.activeJobs;
         expect(jobs, 'response should carry the account-wide jobs list').to.be.an('array');
         const listed = jobs.find(j => j.customer_id === FIXTURE_CUSTOMER_NO_JOBS && j.job_type_id === jobType.job_type_id);
         expect(listed, 'newly created job should appear in the response list').to.exist;

         const row = await h.db('customer_jobs').where({ account_id: h.accountID, customer_id: FIXTURE_CUSTOMER_NO_JOBS, job_type_id: jobType.job_type_id }).first();
         expect(row, 'job row should exist in the DB').to.exist;
         created.jobs.push(row.customer_job_id);
         expect(Number(row.agreed_job_amount)).to.equal(750.25);
         expect(row.notes).to.equal(notes);
         expect(row.is_quote).to.equal(false);
         expect(row.is_job_complete).to.equal(false);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.post(`/jobs/createJob/${h.accountID}/${h.adminUserID}`).send({ job: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h
            .as('admin')
            .post(`/jobs/createJob/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`)
            .send({ job: { customerID: FIXTURE_CUSTOMER_A, jobTypeID: 900201 } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no job payload (synchronous validation failure, no row written)', async () => {
         const res = await h.as('admin').post(`/jobs/createJob/${h.accountID}/${h.adminUserID}`).send({});
         // sanitizeFields(req.body.job) throws before jobService.createJob is ever
         // reachable, so by construction nothing can have been written.
         expectEnvelopeRefused(res, undefined, 'createJob missing body');
      });

      it('rejects a duplicate customer+jobType combination and writes no second row', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);

         const res = await h
            .as('admin')
            .post(`/jobs/createJob/${h.accountID}/${h.adminUserID}`)
            .send({ job: { accountID: h.accountID, userID: h.adminUserID, customerID: FIXTURE_CUSTOMER_A, jobTypeID: jobType.job_type_id, quoteAmount: 0, agreedJobAmount: 1, isQuote: false, notes: 'dup-attempt' } });
         expectEnvelopeRefused(res, /duplicate job/i, 'createJob duplicate guard');

         const rows = await h.db('customer_jobs').where({ account_id: h.accountID, customer_id: FIXTURE_CUSTOMER_A, job_type_id: jobType.job_type_id });
         expect(rows).to.have.lengthOf(1);
         expect(rows[0].customer_job_id).to.equal(job.customer_job_id);
      });
   });

   // =======================================================================
   // GET /jobs/getSingleJob/:customerJobID/:accountID/:userID
   // =======================================================================
   describe('GET /jobs/getSingleJob/:customerJobID/:accountID/:userID', () => {
      it('happy path: returns the job by id', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id, { notes: 'get-single-note' });

         const res = await h.as('admin').get(`/jobs/getSingleJob/${job.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleJob happy path');
         expect(body.activeJobData.activeJobs).to.be.an('array').with.lengthOf(1);
         expect(body.activeJobData.activeJobs[0].customer_job_id).to.equal(job.customer_job_id);
         expect(body.activeJobData.activeJobs[0].notes).to.equal('get-single-note');
         expect(body.activeJobData.grid).to.have.keys(['columns', 'rows']);
         expect(body.activeJobData.treeGrid).to.exist;
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.get(`/jobs/getSingleJob/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').get(`/jobs/getSingleJob/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('403 for an employee (manager+ required)', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         const res = await h.as('employee').get(`/jobs/getSingleJob/${job.customer_job_id}/${h.accountID}/${h.employeeUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean empty result for a not-found id (no crash)', async () => {
         const res = await h.as('admin').get(`/jobs/getSingleJob/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleJob not-found');
         expect(body.activeJobData.activeJobs).to.deep.equal([]);
      });
   });

   // =======================================================================
   // GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID
   // =======================================================================
   describe('GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID', () => {
      it('happy path: lists the customer\'s jobs with a computed display_name', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_NO_JOBS, jobType.job_type_id);

         const res = await h.as('admin').get(`/jobs/getActiveCustomerJobs/${h.accountID}/${h.adminUserID}/${FIXTURE_CUSTOMER_NO_JOBS}`);
         const body = expectEnvelopeOk(res, 'getActiveCustomerJobs happy path');
         const listed = body.activeCustomerJobData.activeCustomerJobs.find(j => j.customer_job_id === job.customer_job_id);
         expect(listed, 'created job should be listed').to.exist;
         expect(listed.display_name).to.equal(`${jobType.job_description} - Tax Compliance`);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.get(`/jobs/getActiveCustomerJobs/${h.accountID}/${h.adminUserID}/${FIXTURE_CUSTOMER_A}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').get(`/jobs/getActiveCustomerJobs/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}/${FIXTURE_CUSTOMER_A}`);
         expect(res.status).to.equal(403);
      });

      it('returns an empty list for a customer with no jobs, without crashing', async () => {
         const res = await h.as('admin').get(`/jobs/getActiveCustomerJobs/${h.accountID}/${h.adminUserID}/${NOT_FOUND_ID}`);
         const body = expectEnvelopeOk(res, 'getActiveCustomerJobs not-found customer');
         expect(body.activeCustomerJobData.activeCustomerJobs).to.deep.equal([]);
      });
   });

   // =======================================================================
   // PUT /jobs/updateJob/:accountID/:userID
   // =======================================================================
   describe('PUT /jobs/updateJob/:accountID/:userID', () => {
      it('happy path: updates job fields and toggles is_job_complete', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id, { notes: 'before-update' });

         const res = await h
            .as('admin')
            .put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`)
            .send({
               job: {
                  accountID: h.accountID,
                  userID: h.adminUserID,
                  customerJobID: job.customer_job_id,
                  customerID: job.customer_id,
                  jobTypeID: job.job_type_id,
                  quoteAmount: 0,
                  agreedJobAmount: 999.99,
                  isQuote: false,
                  isJobComplete: true,
                  notes: 'after-update'
               }
            });
         const body = expectEnvelopeOk(res, 'updateJob happy path');
         const listed = body.accountJobsList.activeJobData.activeJobs.find(j => j.customer_job_id === job.customer_job_id);
         expect(listed.notes).to.equal('after-update');

         const row = await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first();
         expect(Number(row.agreed_job_amount)).to.equal(999.99);
         expect(row.notes).to.equal('after-update');
         expect(row.is_job_complete).to.equal(true);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`).send({ job: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').put(`/jobs/updateJob/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`).send({ job: { customerJobID: 1 } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no job payload', async () => {
         const res = await h.as('admin').put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`).send({});
         expectEnvelopeRefused(res, undefined, 'updateJob missing body');
      });

      it('returns a clean refusal for a not-found customerJobID', async () => {
         const res = await h
            .as('admin')
            .put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`)
            .send({ job: { accountID: h.accountID, userID: h.adminUserID, customerJobID: NOT_FOUND_ID, customerID: FIXTURE_CUSTOMER_A, jobTypeID: 900201, quoteAmount: 0, agreedJobAmount: 1, isQuote: false } });
         expectEnvelopeRefused(res, /job not found/i, 'updateJob not-found');
      });

      it('refuses reassigning a job to a different customer while a transaction is linked to it', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         const txn = await insertTransactionForJob(job.customer_job_id, FIXTURE_CUSTOMER_A);

         const res = await h
            .as('admin')
            .put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`)
            .send({
               job: {
                  accountID: h.accountID,
                  userID: h.adminUserID,
                  customerJobID: job.customer_job_id,
                  customerID: FIXTURE_CUSTOMER_B, // reassigned away from FIXTURE_CUSTOMER_A
                  jobTypeID: job.job_type_id,
                  quoteAmount: 0,
                  agreedJobAmount: 500,
                  isQuote: false,
                  notes: job.notes
               }
            });
         // job-router.js now refuses to repoint a job to a different customer
         // while transactions/write-offs/payments are linked to it or one of
         // its prior versions (see deleteJob's identical family-wide guard) -
         // repointing would silently strand this already-recorded transaction
         // under the OLD customer while the job itself moved to the new one.
         expectEnvelopeRefused(res, /cannot reassign this job to a different customer/i, 'updateJob blocked cross-customer reassignment');

         const updatedJob = await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first();
         expect(Number(updatedJob.customer_id), 'job must stay on its original customer').to.equal(FIXTURE_CUSTOMER_A);
         const linkedTxn = await h.db('customer_transactions').where('transaction_id', txn.transaction_id).first();
         expect(Number(linkedTxn.customer_id)).to.equal(FIXTURE_CUSTOMER_A);
      });

      it('allows reassigning a job to a different customer when nothing is linked to it, and returns a warning', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);

         const res = await h
            .as('admin')
            .put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`)
            .send({
               job: {
                  accountID: h.accountID,
                  userID: h.adminUserID,
                  customerJobID: job.customer_job_id,
                  customerID: FIXTURE_CUSTOMER_B,
                  jobTypeID: job.job_type_id,
                  quoteAmount: 0,
                  agreedJobAmount: 500,
                  isQuote: false,
                  notes: job.notes
               }
            });
         const body = expectEnvelopeOk(res, 'updateJob unlinked cross-customer reassignment');
         expect(body.warning, 'response should carry a warning about the reassignment').to.match(/reassigned to a different customer/i);

         const updatedJob = await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first();
         expect(Number(updatedJob.customer_id)).to.equal(FIXTURE_CUSTOMER_B);
      });

      // ── A2 (2026-09 review) ─────────────────────────────────────────────
      it('A2: reassigning an unlinked job moves EVERY version row in its family, not just the one named in the request', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const root = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         // What updateRecentJobTotal writes on a total change: a version row
         // pointing parent_job_id -> root, same customer as the root.
         const [version] = await h
            .db('customer_jobs')
            .insert({ ...root, customer_job_id: undefined, parent_job_id: root.customer_job_id, current_job_total: 250, created_at: undefined })
            .returning('*');
         created.jobs.push(version.customer_job_id);

         const res = await h
            .as('admin')
            .put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`)
            .send({
               job: {
                  accountID: h.accountID,
                  userID: h.adminUserID,
                  customerJobID: root.customer_job_id, // reassigning via the ROOT id
                  customerID: FIXTURE_CUSTOMER_B,
                  jobTypeID: root.job_type_id,
                  quoteAmount: 0,
                  agreedJobAmount: 500,
                  isQuote: false,
                  notes: root.notes
               }
            });
         const body = expectEnvelopeOk(res, 'updateJob family-wide reassignment');
         expect(body.warning).to.match(/reassigned to a different customer/i);

         const rootNow = await h.db('customer_jobs').where('customer_job_id', root.customer_job_id).first();
         const versionNow = await h.db('customer_jobs').where('customer_job_id', version.customer_job_id).first();
         expect(Number(rootNow.customer_id), 'the root moved').to.equal(FIXTURE_CUSTOMER_B);
         expect(Number(versionNow.customer_id), 'the prior version row moved with it — no sibling left stranded under the old customer').to.equal(FIXTURE_CUSTOMER_B);
      });

      it('A2: a transaction-create racing a job reassignment for the same customer never leaves the transaction and its job on different customers', async () => {
         // Before the 2026-09 fix, job create/update/delete ran with no ledger
         // lock at all: a transaction writer for the job's customer could land
         // between the reassignment's "nothing is linked yet" check and its
         // write, leaving the transaction under one customer and the job under
         // another with no refusal on either side. Both routes now take the
         // SAME customer ledger lock, so racing them for real must always
         // leave the transaction and the job agreeing on one customer.
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         const tag = uniqueName('A2-race');

         const txnBody = {
            accountID: h.accountID,
            customerID: FIXTURE_CUSTOMER_A,
            customerJobID: job.customer_job_id,
            selectedRetainerID: null,
            loggedForUserID: h.adminUserID,
            loggedByUserID: h.adminUserID,
            selectedGeneralWorkDescriptionID: FIXTURE_WORK_DESCRIPTION_ID,
            detailedJobDescription: tag,
            transactionDate: '2026-01-15',
            transactionType: 'Time',
            quantity: 1,
            unitCost: 50,
            totalTransaction: 50,
            isTransactionBillable: true,
            isInAdditionToMonthlyCharge: false,
            note: tag
         };
         const reassignBody = {
            accountID: h.accountID,
            userID: h.adminUserID,
            customerJobID: job.customer_job_id,
            customerID: FIXTURE_CUSTOMER_B,
            jobTypeID: job.job_type_id,
            quoteAmount: 0,
            agreedJobAmount: 500,
            isQuote: false,
            notes: job.notes
         };

         const [txnRes, jobRes] = await Promise.all([
            h.as('admin').post(`/transactions/createTransaction/${h.accountID}/${h.adminUserID}`).send({ transaction: txnBody }),
            h.as('admin').put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`).send({ job: reassignBody })
         ]);

         const txnCreated = Number(txnRes.body.status) === 200;
         const jobReassigned = Number(jobRes.body.status) === 200;
         expect(txnCreated, 'exactly one of the two racing requests succeeds').to.not.equal(jobReassigned);

         const createdTxn = await h.db('customer_transactions').where({ account_id: h.accountID, customer_job_id: job.customer_job_id, detailed_work_description: tag }).first();
         if (createdTxn) created.transactions.push(createdTxn.transaction_id);
         const jobRow = await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first();
         expect(Boolean(createdTxn)).to.equal(txnCreated);

         if (txnCreated) {
            // The transaction landed first — the reassignment's OWN linked-
            // transactions check (running under the same lock) must have seen
            // it and refused, so the job never moved.
            expect(jobRes.body.message).to.match(/transactions are linked/i);
            expect(Number(jobRow.customer_id)).to.equal(FIXTURE_CUSTOMER_A);
            expect(Number(createdTxn.customer_id)).to.equal(FIXTURE_CUSTOMER_A);
         } else {
            // The reassignment landed first — the transaction-create's own
            // job-ownership check must have seen the NEW customer and refused,
            // so no transaction was left pointing at a job under a different customer.
            expect(Number(jobRow.customer_id)).to.equal(FIXTURE_CUSTOMER_B);
            expect(txnRes.body.message).to.match(/does not belong to this customer/i);
         }
      });

      it('A2: rolls back a family-wide reassignment against real Postgres if the final job-row write fails', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         // A sibling version in the SAME family — what updateRecentJobTotal
         // writes on a total change (see the successful family-wide
         // reassignment test above). Without one, this test has a family of
         // size one and cannot distinguish a per-row rollback from a true
         // family-wide one.
         const [sibling] = await h
            .db('customer_jobs')
            .insert({ ...job, customer_job_id: undefined, parent_job_id: job.customer_job_id, current_job_total: 250, created_at: undefined })
            .returning('*');
         created.jobs.push(sibling.customer_job_id);

         const res = await h
            .as('admin')
            .put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`)
            .send({
               job: {
                  accountID: h.accountID,
                  userID: h.adminUserID,
                  customerJobID: job.customer_job_id,
                  customerID: FIXTURE_CUSTOMER_B,
                  jobTypeID: jobType.job_type_id,
                  quoteAmount: 1e20, // Numeric overflow on the FINAL write, after the family move
                  agreedJobAmount: 500,
                  isQuote: false,
                  notes: job.notes
               }
            });

         expectEnvelopeRefused(res, /overflow|numeric|out of range/i, 'updateJob rollback on oversized quote');
         const jobRow = await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first();
         const siblingRow = await h.db('customer_jobs').where('customer_job_id', sibling.customer_job_id).first();
         // The family-wide customer_id move — an earlier write in the SAME
         // transaction — must not have stuck once the later write failed, on
         // the named row OR its sibling.
         expect(Number(jobRow.customer_id), 'reassignment rolled back with the rest of the transaction').to.equal(FIXTURE_CUSTOMER_A);
         expect(Number(jobRow.job_type_id)).to.equal(jobType.job_type_id);
         expect(Number(siblingRow.customer_id), 'the sibling version rolled back too — the whole family, not just the named row').to.equal(FIXTURE_CUSTOMER_A);
      });

      it('cannot update an account-1 job even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1Job) return this.skip();
         const res = await h
            .as('admin')
            .put(`/jobs/updateJob/${h.accountID}/${h.adminUserID}`)
            .send({
               job: {
                  accountID: h.accountID,
                  userID: h.adminUserID,
                  customerJobID: acct1Job.customer_job_id,
                  customerID: acct1Job.customer_id,
                  jobTypeID: acct1Job.job_type_id,
                  quoteAmount: 99999,
                  agreedJobAmount: 99999,
                  isQuote: false,
                  notes: 'HACKED'
               }
            });
         // job-router.js pre-checks existence scoped to the caller's account
         // (getSingleJob WHERE customer_job_id=X AND account_id=9001), so an
         // account-1 id resolves to "not found" — a clean refusal, not a
         // misleading 200.
         expectEnvelopeRefused(res, /job not found/i, 'cross-tenant job update');
         const after = await h.db('customer_jobs').where('customer_job_id', acct1Job.customer_job_id).first();
         expect(after).to.deep.equal(acct1Job);
      });
   });

   // =======================================================================
   // DELETE /jobs/deleteJob/:jobID/:accountID/:userID
   // =======================================================================
   describe('DELETE /jobs/deleteJob/:jobID/:accountID/:userID', () => {
      it('happy path: deletes a job family with no linked rows', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);

         const res = await h.as('admin').delete(`/jobs/deleteJob/${job.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeOk(res, 'deleteJob happy path');
         const after = await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first();
         expect(after).to.be.undefined;
         created.jobs = created.jobs.filter(id => id !== job.customer_job_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.delete(`/jobs/deleteJob/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').delete(`/jobs/deleteJob/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean refusal for a not-found jobID', async () => {
         const res = await h.as('admin').delete(`/jobs/deleteJob/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /job not found/i, 'deleteJob not-found');
      });

      it('is blocked while a transaction references the job', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         await insertTransactionForJob(job.customer_job_id, FIXTURE_CUSTOMER_A);

         const res = await h.as('admin').delete(`/jobs/deleteJob/${job.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /transactions are linked/i, 'deleteJob blocked by transaction');
         expect(await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first(), 'job must survive').to.exist;
      });

      it('is blocked while a write-off references the job', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         await insertWriteoffForJob(job.customer_job_id, FIXTURE_CUSTOMER_A);

         const res = await h.as('admin').delete(`/jobs/deleteJob/${job.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /write offs are linked/i, 'deleteJob blocked by write-off');
         expect(await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first(), 'job must survive').to.exist;
      });

      it('is blocked while a payment references the job', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const job = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         await insertPaymentForJob(job.customer_job_id, FIXTURE_CUSTOMER_A);

         const res = await h.as('admin').delete(`/jobs/deleteJob/${job.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /payments are linked/i, 'deleteJob blocked by payment');
         expect(await h.db('customer_jobs').where('customer_job_id', job.customer_job_id).first(), 'job must survive').to.exist;
      });

      it('checks links across the whole version family, not just the row named in the URL', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const root = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         // Simulate a "total changed" version row the way updateRecentJobTotal
         // would elsewhere in the app (not exercised by this router — inserted
         // directly here just to test the family walk in deleteJob).
         const [child] = await h
            .db('customer_jobs')
            .insert({
               account_id: h.accountID,
               parent_job_id: root.customer_job_id,
               customer_id: root.customer_id,
               job_type_id: root.job_type_id,
               current_job_total: 0,
               is_quote: false,
               is_job_complete: false,
               created_by_user_id: h.adminUserID,
               notes: uniqueName('version')
            })
            .returning('*');
         created.jobs.push(child.customer_job_id);

         // Link a transaction only to the CHILD version, then try to delete the ROOT.
         await insertTransactionForJob(child.customer_job_id, root.customer_id);

         const res = await h.as('admin').delete(`/jobs/deleteJob/${root.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /transactions are linked/i, 'deleteJob family guard');
         expect(await h.db('customer_jobs').where('customer_job_id', root.customer_job_id).first()).to.exist;
         expect(await h.db('customer_jobs').where('customer_job_id', child.customer_job_id).first()).to.exist;
      });

      it('deletes every row in a clean version family together', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const root = await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);
         const [child] = await h
            .db('customer_jobs')
            .insert({
               account_id: h.accountID,
               parent_job_id: root.customer_job_id,
               customer_id: root.customer_id,
               job_type_id: root.job_type_id,
               current_job_total: 0,
               is_quote: false,
               is_job_complete: false,
               created_by_user_id: h.adminUserID,
               notes: uniqueName('version')
            })
            .returning('*');
         created.jobs.push(child.customer_job_id);

         const res = await h.as('admin').delete(`/jobs/deleteJob/${root.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeOk(res, 'deleteJob family happy path');
         expect(await h.db('customer_jobs').where('customer_job_id', root.customer_job_id).first()).to.be.undefined;
         expect(await h.db('customer_jobs').where('customer_job_id', child.customer_job_id).first()).to.be.undefined;
         created.jobs = created.jobs.filter(id => id !== root.customer_job_id && id !== child.customer_job_id);
      });

      it('cannot delete an account-1 job even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1Job) return this.skip();
         const res = await h.as('admin').delete(`/jobs/deleteJob/${acct1Job.customer_job_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /job not found/i, 'cross-tenant job delete');
         const after = await h.db('customer_jobs').where('customer_job_id', acct1Job.customer_job_id).first();
         expect(after).to.deep.equal(acct1Job);
      });
   });

   // =======================================================================
   // POST /jobCategories/createJobCategory/:accountID/:userID
   // =======================================================================
   describe('POST /jobCategories/createJobCategory/:accountID/:userID', () => {
      it('happy path: creates an active job category', async () => {
         const category = uniqueName('JCAT-happy');
         const res = await h
            .as('admin')
            .post(`/jobCategories/createJobCategory/${h.accountID}/${h.adminUserID}`)
            .send({ jobCategory: { accountID: h.accountID, category, isActive: true, createdBy: h.adminUserID } });
         const body = expectEnvelopeOk(res, 'createJobCategory happy path');
         const listed = body.jobCategoriesList.activeJobCategoriesData.activeJobCategories.find(c => c.customer_job_category === category);
         expect(listed, 'new category should appear in the active list').to.exist;

         const row = await h.db('customer_job_categories').where({ account_id: h.accountID, customer_job_category: category }).first();
         expect(row).to.exist;
         created.jobCategories.push(row.customer_job_category_id);
         expect(row.is_job_category_active).to.equal(true);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.post(`/jobCategories/createJobCategory/${h.accountID}/${h.adminUserID}`).send({ jobCategory: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').post(`/jobCategories/createJobCategory/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`).send({ jobCategory: { category: 'x' } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no jobCategory payload', async () => {
         const res = await h.as('admin').post(`/jobCategories/createJobCategory/${h.accountID}/${h.adminUserID}`).send({});
         expectEnvelopeRefused(res, undefined, 'createJobCategory missing body');
      });

      it('uses the authenticated creator when body createdBy is omitted', async () => {
         const category = uniqueName('JCAT-invalid');
         const res = await h
            .as('admin')
            .post(`/jobCategories/createJobCategory/${h.accountID}/${h.adminUserID}`)
            .send({ jobCategory: { accountID: h.accountID, category, isActive: true } }); // Body creator is optional and never authoritative
         expectEnvelopeOk(res, 'createJobCategory session creator');
         const row = await h.db('customer_job_categories').where({ account_id: h.accountID, customer_job_category: category }).first();
         expect(row).to.exist;
         created.jobCategories.push(row.customer_job_category_id);
         expect(Number(row.created_by_user_id)).to.equal(h.adminUserID);
      });
   });

   // =======================================================================
   // PUT /jobCategories/updateJobCategory/:accountID/:userID
   // =======================================================================
   describe('PUT /jobCategories/updateJobCategory/:accountID/:userID', () => {
      it('happy path: renames a category', async () => {
         const category = await mkJobCategory('admin');
         const renamed = `${category.customer_job_category}-renamed`;

         const res = await h
            .as('admin')
            .put(`/jobCategories/updateJobCategory/${h.accountID}/${h.adminUserID}`)
            .send({ jobCategory: { accountID: h.accountID, customerJobCategoryID: category.customer_job_category_id, selectedNewJobCategory: renamed, isJobCategoryActive: true, createdByUserID: h.adminUserID } });
         expectEnvelopeOk(res, 'updateJobCategory happy path');

         const row = await h.db('customer_job_categories').where('customer_job_category_id', category.customer_job_category_id).first();
         expect(row.customer_job_category).to.equal(renamed);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.put(`/jobCategories/updateJobCategory/${h.accountID}/${h.adminUserID}`).send({ jobCategory: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').put(`/jobCategories/updateJobCategory/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`).send({ jobCategory: { customerJobCategoryID: 1 } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no jobCategory payload', async () => {
         const res = await h.as('admin').put(`/jobCategories/updateJobCategory/${h.accountID}/${h.adminUserID}`).send({});
         expectEnvelopeRefused(res, undefined, 'updateJobCategory missing body');
      });

      it('returns a clean 404 for a not-found id (0 rows affected)', async () => {
         const res = await h
            .as('admin')
            .put(`/jobCategories/updateJobCategory/${h.accountID}/${h.adminUserID}`)
            .send({ jobCategory: { accountID: h.accountID, customerJobCategoryID: NOT_FOUND_ID, selectedNewJobCategory: 'nope', isJobCategoryActive: true, createdByUserID: h.adminUserID } });
         expect(res.status).to.equal(404);
      });

      it('persists is_job_category_active = false and removes the category from the active list', async () => {
         const category = await mkJobCategory('admin');
         const res = await h
            .as('admin')
            .put(`/jobCategories/updateJobCategory/${h.accountID}/${h.adminUserID}`)
            .send({ jobCategory: { accountID: h.accountID, customerJobCategoryID: category.customer_job_category_id, selectedNewJobCategory: category.customer_job_category, isJobCategoryActive: false, createdByUserID: h.adminUserID } });
         const body = expectEnvelopeOk(res, 'updateJobCategory deactivate');

         const row = await h.db('customer_job_categories').where('customer_job_category_id', category.customer_job_category_id).first();
         expect(row.is_job_category_active).to.equal(false);
         // getActiveJobCategories filters `is_job_category_active = true`, so a
         // deactivated category must disappear from the list this same
         // response carries.
         expect(body.jobCategoriesList.activeJobCategoriesData.activeJobCategories.some(c => c.customer_job_category_id === category.customer_job_category_id)).to.equal(false);
      });

      it('cannot update an account-1 job category even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1JobCategory) return this.skip();
         const res = await h
            .as('admin')
            .put(`/jobCategories/updateJobCategory/${h.accountID}/${h.adminUserID}`)
            .send({ jobCategory: { accountID: h.accountID, customerJobCategoryID: acct1JobCategory.customer_job_category_id, selectedNewJobCategory: 'HACKED', isJobCategoryActive: true, createdByUserID: h.adminUserID } });
         // The WHERE account_id=9001 clause matches zero rows for an account-1
         // id, and the router now checks the affected-row count, so this comes
         // back as a clean 404 rather than a misleading 200.
         expect(res.status).to.equal(404);
         const after = await h.db('customer_job_categories').where('customer_job_category_id', acct1JobCategory.customer_job_category_id).first();
         expect(after).to.deep.equal(acct1JobCategory);
      });
   });

   // =======================================================================
   // DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID
   // =======================================================================
   describe('DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID', () => {
      it('happy path: deletes an unused category', async () => {
         const category = await mkJobCategory('admin');
         const res = await h.as('admin').delete(`/jobCategories/deleteJobCategory/${category.customer_job_category_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeOk(res, 'deleteJobCategory happy path');
         expect(await h.db('customer_job_categories').where('customer_job_category_id', category.customer_job_category_id).first()).to.be.undefined;
         created.jobCategories = created.jobCategories.filter(id => id !== category.customer_job_category_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.delete(`/jobCategories/deleteJobCategory/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').delete(`/jobCategories/deleteJobCategory/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean 404 for a not-found id', async () => {
         const res = await h.as('admin').delete(`/jobCategories/deleteJobCategory/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(404);
      });

      it('is blocked while a job type references the category', async () => {
         const category = await mkJobCategory('admin');
         const jobType = await mkJobType('admin', category.customer_job_category_id);

         const res = await h.as('admin').delete(`/jobCategories/deleteJobCategory/${category.customer_job_category_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /in use by job types/i, 'deleteJobCategory blocked by jobType');
         expect(await h.db('customer_job_categories').where('customer_job_category_id', category.customer_job_category_id).first(), 'category must survive').to.exist;
         void jobType;
      });

      it('cannot delete an account-1 job category even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1JobCategory) return this.skip();
         const res = await h.as('admin').delete(`/jobCategories/deleteJobCategory/${acct1JobCategory.customer_job_category_id}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(404);
         const after = await h.db('customer_job_categories').where('customer_job_category_id', acct1JobCategory.customer_job_category_id).first();
         expect(after).to.deep.equal(acct1JobCategory);
      });
   });

   // =======================================================================
   // GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID
   // =======================================================================
   describe('GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID', () => {
      it('happy path: returns the category by id', async () => {
         const category = await mkJobCategory('admin');
         const res = await h.as('admin').get(`/jobCategories/getSingleJobCategory/${category.customer_job_category_id}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleJobCategory happy path');
         expect(body.activeJobCategoriesData.activeJobCategory).to.be.an('array').with.lengthOf(1);
         expect(body.activeJobCategoriesData.activeJobCategory[0].customer_job_category_id).to.equal(category.customer_job_category_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.get(`/jobCategories/getSingleJobCategory/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').get(`/jobCategories/getSingleJobCategory/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('403 for an employee (manager+ required)', async () => {
         const category = await mkJobCategory('admin');
         const res = await h.as('employee').get(`/jobCategories/getSingleJobCategory/${category.customer_job_category_id}/${h.accountID}/${h.employeeUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean empty result for a not-found id (no crash)', async () => {
         const res = await h.as('admin').get(`/jobCategories/getSingleJobCategory/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleJobCategory not-found');
         expect(body.activeJobCategoriesData.activeJobCategory).to.deep.equal([]);
      });
   });

   // =======================================================================
   // POST /jobTypes/createJobType/:accountID/:userID
   // =======================================================================
   describe('POST /jobTypes/createJobType/:accountID/:userID', () => {
      it('happy path: creates a job type, defaulting is_job_type_active to true', async () => {
         const jobDescription = uniqueName('JTYPE-happy');
         const res = await h
            .as('admin')
            .post(`/jobTypes/createJobType/${h.accountID}/${h.adminUserID}`)
            .send({ jobType: { accountID: h.accountID, userID: h.adminUserID, customerJobCategory: FIXTURE_CATEGORY_ID, jobDescription, bookRate: 80, estimatedStraightTime: 45 } });
         const body = expectEnvelopeOk(res, 'createJobType happy path');
         expect(body.jobTypesList.activeJobTypesData.jobTypesData.find(t => t.job_description === jobDescription)).to.exist;

         const row = await h.db('customer_job_types').where({ account_id: h.accountID, job_description: jobDescription }).first();
         expect(row).to.exist;
         created.jobTypes.push(row.job_type_id);
         expect(row.is_job_type_active).to.equal(true);
         expect(row.book_rate).to.equal(80);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.post(`/jobTypes/createJobType/${h.accountID}/${h.adminUserID}`).send({ jobType: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').post(`/jobTypes/createJobType/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`).send({ jobType: { jobDescription: 'x' } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no jobType payload', async () => {
         const res = await h.as('admin').post(`/jobTypes/createJobType/${h.accountID}/${h.adminUserID}`).send({});
         expectEnvelopeRefused(res, undefined, 'createJobType missing body');
      });

      it('uses the authenticated creator when body userID is omitted', async () => {
         const jobDescription = uniqueName('JTYPE-invalid');
         const res = await h
            .as('admin')
            .post(`/jobTypes/createJobType/${h.accountID}/${h.adminUserID}`)
            .send({ jobType: { accountID: h.accountID, customerJobCategory: FIXTURE_CATEGORY_ID, jobDescription, bookRate: 1, estimatedStraightTime: 1 } }); // Body creator is optional and never authoritative
         expectEnvelopeOk(res, 'createJobType session creator');
         const row = await h.db('customer_job_types').where({ account_id: h.accountID, job_description: jobDescription }).first();
         expect(row).to.exist;
         created.jobTypes.push(row.job_type_id);
         expect(Number(row.created_by_user_id)).to.equal(h.adminUserID);
      });
   });

   // =======================================================================
   // GET /jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID
   // =======================================================================
   describe('GET /jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID', () => {
      it('happy path: returns the job type by id', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const res = await h.as('admin').get(`/jobTypes/getSingleJobType/${jobType.job_type_id}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleJobType happy path');
         expect(body.activeJobData.activeJobs).to.be.an('array').with.lengthOf(1);
         expect(body.activeJobData.activeJobs[0].job_type_id).to.equal(jobType.job_type_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.get(`/jobTypes/getSingleJobType/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').get(`/jobTypes/getSingleJobType/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('403 for an employee (manager+ required)', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const res = await h.as('employee').get(`/jobTypes/getSingleJobType/${jobType.job_type_id}/${h.accountID}/${h.employeeUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean empty result for a not-found id (no crash)', async () => {
         const res = await h.as('admin').get(`/jobTypes/getSingleJobType/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleJobType not-found');
         expect(body.activeJobData.activeJobs).to.deep.equal([]);
      });
   });

   // =======================================================================
   // PUT /jobTypes/updateJobType/:accountID/:userID
   // =======================================================================
   describe('PUT /jobTypes/updateJobType/:accountID/:userID', () => {
      it('happy path: updates job type fields', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const res = await h
            .as('admin')
            .put(`/jobTypes/updateJobType/${h.accountID}/${h.adminUserID}`)
            .send({ jobType: { accountID: h.accountID, userID: h.adminUserID, jobTypeID: jobType.job_type_id, customerJobCategory: FIXTURE_CATEGORY_ID, jobDescription: jobType.job_description, bookRate: 250, estimatedStraightTime: 15, isActive: true } });
         expectEnvelopeOk(res, 'updateJobType happy path');
         const row = await h.db('customer_job_types').where('job_type_id', jobType.job_type_id).first();
         expect(row.book_rate).to.equal(250);
         expect(row.estimated_straight_time).to.equal(15);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.put(`/jobTypes/updateJobType/${h.accountID}/${h.adminUserID}`).send({ jobType: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').put(`/jobTypes/updateJobType/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`).send({ jobType: { jobTypeID: 1 } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no jobType payload', async () => {
         const res = await h.as('admin').put(`/jobTypes/updateJobType/${h.accountID}/${h.adminUserID}`).send({});
         expectEnvelopeRefused(res, undefined, 'updateJobType missing body');
      });

      it('returns a clean 404 for a not-found id (0 rows affected)', async () => {
         const res = await h
            .as('admin')
            .put(`/jobTypes/updateJobType/${h.accountID}/${h.adminUserID}`)
            .send({ jobType: { accountID: h.accountID, userID: h.adminUserID, jobTypeID: NOT_FOUND_ID, customerJobCategory: FIXTURE_CATEGORY_ID, jobDescription: 'nope', bookRate: 1, estimatedStraightTime: 1, isActive: true } });
         expect(res.status).to.equal(404);
      });

      it('persists is_job_type_active = false', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const res = await h
            .as('admin')
            .put(`/jobTypes/updateJobType/${h.accountID}/${h.adminUserID}`)
            .send({ jobType: { accountID: h.accountID, userID: h.adminUserID, jobTypeID: jobType.job_type_id, customerJobCategory: FIXTURE_CATEGORY_ID, jobDescription: jobType.job_description, bookRate: jobType.book_rate, estimatedStraightTime: jobType.estimated_straight_time, isActive: false } });
         expectEnvelopeOk(res, 'updateJobType deactivate');
         const row = await h.db('customer_job_types').where('job_type_id', jobType.job_type_id).first();
         expect(row.is_job_type_active).to.equal(false);
      });

      // DEFECT: jobType-service.js getActiveJobTypes (src/endpoints/jobType/jobType-service.js:18-25,
      // used by every create/update/delete response to build
      // jobTypesList.activeJobTypesData.jobTypesData) has no `is_job_type_active`
      // filter, unlike its siblings: jobCategories-service.js:2-4
      // getActiveJobCategories and workDescriptions-service.js:2-4
      // getActiveWorkDescriptions both `.where(<active column>, true)`. A
      // deactivated job type therefore never disappears from the "active" list.
      // Real user impact: DS2_Frontend/src/Pages/Jobs/JobForms/AddJob/
      // FormSubComponents/NewJobSelections.js:11-17 builds the New/Edit Job
      // "job description" dropdown straight from this same jobTypesData array,
      // filtered only by category — never by is_job_type_active — so staff can
      // still pick a job type after it has been deactivated.
      it('excludes a deactivated job type from the active jobTypesList', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const res = await h
            .as('admin')
            .put(`/jobTypes/updateJobType/${h.accountID}/${h.adminUserID}`)
            .send({ jobType: { accountID: h.accountID, userID: h.adminUserID, jobTypeID: jobType.job_type_id, customerJobCategory: FIXTURE_CATEGORY_ID, jobDescription: jobType.job_description, bookRate: jobType.book_rate, estimatedStraightTime: jobType.estimated_straight_time, isActive: false } });
         const body = expectEnvelopeOk(res, 'updateJobType deactivate (defect check)');
         const stillListedAsActive = body.jobTypesList.activeJobTypesData.jobTypesData.some(t => t.job_type_id === jobType.job_type_id);
         expect(stillListedAsActive, 'a deactivated job type should not appear in the active list').to.equal(false);
      });

      it('cannot update an account-1 job type even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1JobType) return this.skip();
         const res = await h
            .as('admin')
            .put(`/jobTypes/updateJobType/${h.accountID}/${h.adminUserID}`)
            .send({ jobType: { accountID: h.accountID, userID: h.adminUserID, jobTypeID: acct1JobType.job_type_id, customerJobCategory: acct1JobType.customer_job_category_id, jobDescription: 'HACKED', bookRate: 1, estimatedStraightTime: 1, isActive: true } });
         expect(res.status).to.equal(404);
         const after = await h.db('customer_job_types').where('job_type_id', acct1JobType.job_type_id).first();
         expect(after).to.deep.equal(acct1JobType);
      });
   });

   // =======================================================================
   // DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID
   // =======================================================================
   describe('DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID', () => {
      it('happy path: deletes an unused job type', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         const res = await h.as('admin').delete(`/jobTypes/deleteJobType/${jobType.job_type_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeOk(res, 'deleteJobType happy path');
         expect(await h.db('customer_job_types').where('job_type_id', jobType.job_type_id).first()).to.be.undefined;
         created.jobTypes = created.jobTypes.filter(id => id !== jobType.job_type_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.delete(`/jobTypes/deleteJobType/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').delete(`/jobTypes/deleteJobType/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean 404 for a not-found id', async () => {
         const res = await h.as('admin').delete(`/jobTypes/deleteJobType/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(404);
      });

      it('is blocked while a job references the job type', async () => {
         const jobType = await mkJobType('admin', FIXTURE_CATEGORY_ID);
         await mkJob('admin', FIXTURE_CUSTOMER_A, jobType.job_type_id);

         const res = await h.as('admin').delete(`/jobTypes/deleteJobType/${jobType.job_type_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /cannot delete jobtype that is in use/i, 'deleteJobType blocked by job');
         expect(await h.db('customer_job_types').where('job_type_id', jobType.job_type_id).first(), 'jobType must survive').to.exist;
      });

      it('cannot delete an account-1 job type even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1JobType) return this.skip();
         const res = await h.as('admin').delete(`/jobTypes/deleteJobType/${acct1JobType.job_type_id}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(404);
         const after = await h.db('customer_job_types').where('job_type_id', acct1JobType.job_type_id).first();
         expect(after).to.deep.equal(acct1JobType);
      });
   });

   // =======================================================================
   // POST /workDescriptions/createWorkDescription/:accountID/:userID
   // =======================================================================
   describe('POST /workDescriptions/createWorkDescription/:accountID/:userID', () => {
      it('happy path: creates an active work description', async () => {
         const generalWorkDescription = uniqueName('WD-happy');
         const res = await h
            .as('admin')
            .post(`/workDescriptions/createWorkDescription/${h.accountID}/${h.adminUserID}`)
            .send({ workDescription: { generalWorkDescription, estimatedTime: 20, isGeneralWorkDescriptionActive: true } });
         const body = expectEnvelopeOk(res, 'createWorkDescription happy path');
         expect(body.workDescriptionsList.activeWorkDescriptionsData.workDescriptionsData.find(d => d.general_work_description === generalWorkDescription)).to.exist;

         const row = await h.db('customer_general_work_descriptions').where({ account_id: h.accountID, general_work_description: generalWorkDescription }).first();
         expect(row).to.exist;
         created.workDescriptions.push(row.general_work_description_id);
         // created_by_user_id comes from the URL :userID, not the body, for this route.
         expect(row.created_by_user_id).to.equal(h.adminUserID);
         expect(row.is_general_work_description_active).to.equal(true);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.post(`/workDescriptions/createWorkDescription/${h.accountID}/${h.adminUserID}`).send({ workDescription: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').post(`/workDescriptions/createWorkDescription/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`).send({ workDescription: { generalWorkDescription: 'x' } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no workDescription payload', async () => {
         const res = await h.as('admin').post(`/workDescriptions/createWorkDescription/${h.accountID}/${h.adminUserID}`).send({});
         expectEnvelopeRefused(res, undefined, 'createWorkDescription missing body');
      });

      it('rejects an invalid estimatedTime (NaN, NOT NULL column) and writes no row', async () => {
         const generalWorkDescription = uniqueName('WD-invalid');
         const res = await h
            .as('admin')
            .post(`/workDescriptions/createWorkDescription/${h.accountID}/${h.adminUserID}`)
            .send({ workDescription: { generalWorkDescription, isGeneralWorkDescriptionActive: true } }); // estimatedTime omitted -> NaN
         expectEnvelopeRefused(res, undefined, 'createWorkDescription invalid estimatedTime');
         const row = await h.db('customer_general_work_descriptions').where({ account_id: h.accountID, general_work_description: generalWorkDescription }).first();
         expect(row, 'no row should be written when estimated_time is invalid').to.be.undefined;
      });
   });

   // =======================================================================
   // GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID
   // =======================================================================
   describe('GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID', () => {
      it('happy path: returns the work description by id', async () => {
         const wd = await mkWorkDescription('admin');
         const res = await h.as('admin').get(`/workDescriptions/getSingleWorkDescription/${wd.general_work_description_id}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleWorkDescription happy path');
         expect(body.activeWorkDescriptionData.workDescriptionData).to.be.an('array').with.lengthOf(1);
         expect(body.activeWorkDescriptionData.workDescriptionData[0].general_work_description_id).to.equal(wd.general_work_description_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.get(`/workDescriptions/getSingleWorkDescription/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').get(`/workDescriptions/getSingleWorkDescription/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('403 for an employee (manager+ required)', async () => {
         const wd = await mkWorkDescription('admin');
         const res = await h.as('employee').get(`/workDescriptions/getSingleWorkDescription/${wd.general_work_description_id}/${h.accountID}/${h.employeeUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean empty result for a not-found id (no crash)', async () => {
         const res = await h.as('admin').get(`/workDescriptions/getSingleWorkDescription/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         const body = expectEnvelopeOk(res, 'getSingleWorkDescription not-found');
         expect(body.activeWorkDescriptionData.workDescriptionData).to.deep.equal([]);
      });
   });

   // =======================================================================
   // PUT /workDescriptions/updateWorkDescription/:accountID/:userID
   // =======================================================================
   describe('PUT /workDescriptions/updateWorkDescription/:accountID/:userID', () => {
      it('happy path: updates work description fields', async () => {
         const wd = await mkWorkDescription('admin');
         const res = await h
            .as('admin')
            .put(`/workDescriptions/updateWorkDescription/${h.accountID}/${h.adminUserID}`)
            .send({ workDescription: { accountID: h.accountID, generalWorkDescriptionID: wd.general_work_description_id, generalWorkDescription: wd.general_work_description, estimatedTime: 99, isGeneralWorkDescriptionActive: true, createdByUserID: wd.created_by_user_id } });
         expectEnvelopeOk(res, 'updateWorkDescription happy path');
         const row = await h.db('customer_general_work_descriptions').where('general_work_description_id', wd.general_work_description_id).first();
         expect(row.estimated_time).to.equal(99);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.put(`/workDescriptions/updateWorkDescription/${h.accountID}/${h.adminUserID}`).send({ workDescription: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').put(`/workDescriptions/updateWorkDescription/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`).send({ workDescription: { generalWorkDescriptionID: 1 } });
         expect(res.status).to.equal(403);
      });

      it('rejects a request with no workDescription payload', async () => {
         const res = await h.as('admin').put(`/workDescriptions/updateWorkDescription/${h.accountID}/${h.adminUserID}`).send({});
         expectEnvelopeRefused(res, undefined, 'updateWorkDescription missing body');
      });

      it('returns a clean 404 for a not-found id (0 rows affected)', async () => {
         const res = await h
            .as('admin')
            .put(`/workDescriptions/updateWorkDescription/${h.accountID}/${h.adminUserID}`)
            .send({ workDescription: { accountID: h.accountID, generalWorkDescriptionID: NOT_FOUND_ID, generalWorkDescription: 'nope', estimatedTime: 1, isGeneralWorkDescriptionActive: true, createdByUserID: h.adminUserID } });
         expect(res.status).to.equal(404);
      });

      it('persists is_general_work_description_active = false and removes it from the active list', async () => {
         const wd = await mkWorkDescription('admin');
         const res = await h
            .as('admin')
            .put(`/workDescriptions/updateWorkDescription/${h.accountID}/${h.adminUserID}`)
            .send({ workDescription: { accountID: h.accountID, generalWorkDescriptionID: wd.general_work_description_id, generalWorkDescription: wd.general_work_description, estimatedTime: wd.estimated_time, isGeneralWorkDescriptionActive: false, createdByUserID: wd.created_by_user_id } });
         const body = expectEnvelopeOk(res, 'updateWorkDescription deactivate');

         const row = await h.db('customer_general_work_descriptions').where('general_work_description_id', wd.general_work_description_id).first();
         expect(row.is_general_work_description_active).to.equal(false);
         // getActiveWorkDescriptions filters `is_general_work_description_active = true`.
         expect(body.workDescriptionsList.activeWorkDescriptionsData.workDescriptionsData.some(d => d.general_work_description_id === wd.general_work_description_id)).to.equal(false);
      });

      it('cannot update an account-1 work description even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1WorkDescription) return this.skip();
         const res = await h
            .as('admin')
            .put(`/workDescriptions/updateWorkDescription/${h.accountID}/${h.adminUserID}`)
            .send({ workDescription: { accountID: h.accountID, generalWorkDescriptionID: acct1WorkDescription.general_work_description_id, generalWorkDescription: 'HACKED', estimatedTime: 1, isGeneralWorkDescriptionActive: true, createdByUserID: acct1WorkDescription.created_by_user_id } });
         expect(res.status).to.equal(404);
         const after = await h.db('customer_general_work_descriptions').where('general_work_description_id', acct1WorkDescription.general_work_description_id).first();
         expect(after).to.deep.equal(acct1WorkDescription);
      });
   });

   // =======================================================================
   // DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID
   // =======================================================================
   describe('DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID', () => {
      it('happy path: deletes an unused work description', async () => {
         const wd = await mkWorkDescription('admin');
         const res = await h.as('admin').delete(`/workDescriptions/deleteWorkDescription/${wd.general_work_description_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeOk(res, 'deleteWorkDescription happy path');
         expect(await h.db('customer_general_work_descriptions').where('general_work_description_id', wd.general_work_description_id).first()).to.be.undefined;
         created.workDescriptions = created.workDescriptions.filter(id => id !== wd.general_work_description_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.delete(`/workDescriptions/deleteWorkDescription/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').delete(`/workDescriptions/deleteWorkDescription/${NOT_FOUND_ID}/${FOREIGN_ACCOUNT_ID}/${h.adminUserID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean 404 for a not-found id', async () => {
         const res = await h.as('admin').delete(`/workDescriptions/deleteWorkDescription/${NOT_FOUND_ID}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(404);
      });

      it('is blocked while a transaction references the work description', async () => {
         const wd = await mkWorkDescription('admin');
         await insertTransactionForJob(FIXTURE_JOB_ID, FIXTURE_CUSTOMER_A, { general_work_description_id: wd.general_work_description_id });

         const res = await h.as('admin').delete(`/workDescriptions/deleteWorkDescription/${wd.general_work_description_id}/${h.accountID}/${h.adminUserID}`);
         expectEnvelopeRefused(res, /in use by one or more transactions/i, 'deleteWorkDescription blocked by transaction');
         expect(await h.db('customer_general_work_descriptions').where('general_work_description_id', wd.general_work_description_id).first(), 'work description must survive').to.exist;
      });

      it('cannot delete an account-1 work description even when scoped through the caller\'s own account/token (row untouched)', async function () {
         if (!acct1WorkDescription) return this.skip();
         const res = await h.as('admin').delete(`/workDescriptions/deleteWorkDescription/${acct1WorkDescription.general_work_description_id}/${h.accountID}/${h.adminUserID}`);
         expect(res.status).to.equal(404);
         const after = await h.db('customer_general_work_descriptions').where('general_work_description_id', acct1WorkDescription.general_work_description_id).first();
         expect(after).to.deep.equal(acct1WorkDescription);
      });
   });

   // =======================================================================
   // POST /quotes/createQuote  — GAP: dead endpoint, no frontend caller.
   // grep across DS2_Frontend/src found no live reference to /quotes/* (only a
   // commented-out route in SidebarRoutes.js:121 and InvoiceRoutes.js:36).
   // quotesObjects.js also reads raw snake_case keys (account_id, customer_id,
   // amount_quoted, ...) instead of the camelCase shape every other form here
   // uses, consistent with nothing ever having built a real payload for it.
   // Covered below for CRUD + tenancy correctness anyway, per instructions.
   // =======================================================================
   describe('POST /quotes/createQuote', () => {
      it('happy path: creates a quote for the caller\'s own account', async () => {
         const quote = await mkQuote('admin');
         expect(Number(quote.amount_quoted)).to.equal(1234.56);
         expect(quote.is_quote_active).to.equal(true);
         expect(quote.customer_job_id).to.equal(FIXTURE_JOB_ID);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.post('/quotes/createQuote').send({ quote: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a request with no quote payload', async () => {
         const res = await h.as('admin').post('/quotes/createQuote').send({});
         expectEnvelopeRefused(res, undefined, 'createQuote missing body');
      });

      it('ignores a spoofed account_id in the body and scopes the new row to the caller\'s real account (no :accountID in this route to guard)', async () => {
         const notes = uniqueName('QUOTE-spoof');
         const res = await h
            .as('admin')
            .post('/quotes/createQuote')
            .send({ quote: { account_id: FOREIGN_ACCOUNT_ID, customer_id: FIXTURE_CUSTOMER_A, customer_job_id: FIXTURE_JOB_ID, amount_quoted: 1, is_quote_active: true, created_by_user_id: h.adminUserID, notes } });
         expectEnvelopeOk(res, 'createQuote account_id spoof');

         const row = await h.db('customer_quotes').where('notes', notes).first();
         expect(row, 'quote should have been created').to.exist;
         created.quotes.push(row.customer_quote_id);
         expect(row.account_id).to.equal(h.accountID);
         expect(await h.db('customer_quotes').where({ account_id: FOREIGN_ACCOUNT_ID, notes }).first(), 'no row should ever land under account 1').to.be.undefined;
      });

      it('403 for an employee (manager+ required)', async () => {
         const res = await h
            .as('employee')
            .post('/quotes/createQuote')
            .send({ quote: { account_id: h.accountID, customer_id: FIXTURE_CUSTOMER_A, customer_job_id: FIXTURE_JOB_ID, amount_quoted: 1, is_quote_active: true, created_by_user_id: h.employeeUserID, notes: uniqueName('QUOTE-403') } });
         expect(res.status).to.equal(403);
      });
   });

   // =======================================================================
   // GET /quotes/getActiveQuotes/:accountID/:quoteID
   // =======================================================================
   describe('GET /quotes/getActiveQuotes/:accountID/:quoteID', () => {
      it('happy path: lists quotes scoped to the caller\'s account', async () => {
         const quote = await mkQuote('admin');
         const res = await h.as('admin').get(`/quotes/getActiveQuotes/${h.accountID}/${quote.customer_quote_id}`);
         const body = expectEnvelopeOk(res, 'getActiveQuotes happy path');
         expect(body.activeQuoteData.activeQuotes.some(q => q.customer_quote_id === quote.customer_quote_id)).to.equal(true);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.get(`/quotes/getActiveQuotes/${h.accountID}/1`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').get(`/quotes/getActiveQuotes/${FOREIGN_ACCOUNT_ID}/1`);
         expect(res.status).to.equal(403);
      });
   });

   // =======================================================================
   // PUT /quotes/updateQuote
   // =======================================================================
   describe('PUT /quotes/updateQuote', () => {
      it('happy path: updates quote fields', async () => {
         const quote = await mkQuote('admin');
         const res = await h
            .as('admin')
            .put('/quotes/updateQuote')
            .send({ quote: { customer_quote_id: quote.customer_quote_id, account_id: h.accountID, customer_id: quote.customer_id, customer_job_id: quote.customer_job_id, amount_quoted: 4321, is_quote_active: false, created_by_user_id: h.adminUserID, notes: quote.notes } });
         expectEnvelopeOk(res, 'updateQuote happy path');
         const row = await h.db('customer_quotes').where('customer_quote_id', quote.customer_quote_id).first();
         expect(Number(row.amount_quoted)).to.equal(4321);
         expect(row.is_quote_active).to.equal(false);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.put('/quotes/updateQuote').send({ quote: {} });
         expect(res.status).to.equal(401);
      });

      it('rejects a request with no quote payload', async () => {
         const res = await h.as('admin').put('/quotes/updateQuote').send({});
         expectEnvelopeRefused(res, undefined, 'updateQuote missing body');
      });

      it('ignores a spoofed account_id in the body and still updates the caller\'s own row (no :accountID in this route to guard)', async () => {
         const quote = await mkQuote('admin');
         const res = await h
            .as('admin')
            .put('/quotes/updateQuote')
            .send({ quote: { customer_quote_id: quote.customer_quote_id, account_id: FOREIGN_ACCOUNT_ID, customer_id: quote.customer_id, customer_job_id: quote.customer_job_id, amount_quoted: 55, is_quote_active: true, created_by_user_id: h.adminUserID, notes: quote.notes } });
         expectEnvelopeOk(res, 'updateQuote account_id spoof');
         const row = await h.db('customer_quotes').where('customer_quote_id', quote.customer_quote_id).first();
         expect(row.account_id).to.equal(h.accountID);
         expect(Number(row.amount_quoted)).to.equal(55);
      });

      it('returns a clean 404 for a not-found id (0 rows affected)', async () => {
         const res = await h
            .as('admin')
            .put('/quotes/updateQuote')
            .send({ quote: { customer_quote_id: NOT_FOUND_ID, account_id: h.accountID, customer_id: FIXTURE_CUSTOMER_A, customer_job_id: FIXTURE_JOB_ID, amount_quoted: 1, is_quote_active: true, created_by_user_id: h.adminUserID, notes: 'nope' } });
         expect(res.status).to.equal(404);
      });

      it('403 for an employee (manager+ required)', async () => {
         const quote = await mkQuote('admin');
         const res = await h
            .as('employee')
            .put('/quotes/updateQuote')
            .send({ quote: { customer_quote_id: quote.customer_quote_id, account_id: h.accountID, customer_id: quote.customer_id, customer_job_id: quote.customer_job_id, amount_quoted: 10, is_quote_active: true, created_by_user_id: h.employeeUserID, notes: quote.notes } });
         expect(res.status).to.equal(403);
      });
   });

   // =======================================================================
   // DELETE /quotes/deleteQuote/:accountID/:quoteID
   // =======================================================================
   describe('DELETE /quotes/deleteQuote/:accountID/:quoteID', () => {
      it('happy path: deletes a quote', async () => {
         const quote = await mkQuote('admin');
         const res = await h.as('admin').delete(`/quotes/deleteQuote/${h.accountID}/${quote.customer_quote_id}`);
         expectEnvelopeOk(res, 'deleteQuote happy path');
         expect(await h.db('customer_quotes').where('customer_quote_id', quote.customer_quote_id).first()).to.be.undefined;
         created.quotes = created.quotes.filter(id => id !== quote.customer_quote_id);
      });

      it('rejects a request with no token', async () => {
         const res = await h.anonymous.delete(`/quotes/deleteQuote/${h.accountID}/${NOT_FOUND_ID}`);
         expect(res.status).to.equal(401);
      });

      it('rejects a URL account that is not the caller\'s tenant', async () => {
         const res = await h.as('admin').delete(`/quotes/deleteQuote/${FOREIGN_ACCOUNT_ID}/${NOT_FOUND_ID}`);
         expect(res.status).to.equal(403);
      });

      it('returns a clean 404 for a not-found id', async () => {
         const res = await h.as('admin').delete(`/quotes/deleteQuote/${h.accountID}/${NOT_FOUND_ID}`);
         expect(res.status).to.equal(404);
      });

      // Self-contained in place of an account-1 tenancy check: quotes is a
      // dead endpoint (see the GAP comment above POST /quotes/createQuote)
      // with no rows anywhere in account 1's real (production-copied) data,
      // so an "account-1 row is untouchable" test like the job / jobCategory
      // / jobType / workDescription ones above could never find a fixture
      // and always skipped at runtime. Cross-tenant protection for quotes is
      // already covered elsewhere in this file (the URL-account and
      // spoofed-body-account_id tests above); this test instead exercises
      // the full read -> update -> delete lifecycle end to end on a quote
      // this run creates for itself, through the real routes.
      it('a self-contained read -> update -> delete lifecycle for a quote created for one of account 9001\'s own fixture customers', async () => {
         const quote = await mkQuote('admin');

         const getRes = await h.as('admin').get(`/quotes/getActiveQuotes/${h.accountID}/${quote.customer_quote_id}`);
         const getBody = expectEnvelopeOk(getRes, 'lifecycle getActiveQuotes');
         expect(getBody.activeQuoteData.activeQuotes.some(q => q.customer_quote_id === quote.customer_quote_id)).to.equal(true);

         const updateRes = await h
            .as('admin')
            .put('/quotes/updateQuote')
            .send({
               quote: {
                  customer_quote_id: quote.customer_quote_id,
                  account_id: h.accountID,
                  customer_id: quote.customer_id,
                  customer_job_id: quote.customer_job_id,
                  amount_quoted: 9999.99,
                  is_quote_active: false,
                  created_by_user_id: h.adminUserID,
                  notes: quote.notes
               }
            });
         expectEnvelopeOk(updateRes, 'lifecycle updateQuote');
         const updatedRow = await h.db('customer_quotes').where('customer_quote_id', quote.customer_quote_id).first();
         expect(Number(updatedRow.amount_quoted)).to.equal(9999.99);
         expect(updatedRow.is_quote_active).to.equal(false);

         const deleteRes = await h.as('admin').delete(`/quotes/deleteQuote/${h.accountID}/${quote.customer_quote_id}`);
         expectEnvelopeOk(deleteRes, 'lifecycle deleteQuote');
         expect(await h.db('customer_quotes').where('customer_quote_id', quote.customer_quote_id).first()).to.be.undefined;
         created.quotes = created.quotes.filter(id => id !== quote.customer_quote_id);
      });
   });
});
