const express = require('express');
const jobRouter = require('../../../src/endpoints/job/job-router');
const jobService = require('../../../src/endpoints/job/job-service');
const { buildFakeDb } = require('../transactions/_fakeDb');

const ACCOUNT = 1;
const USER = 21;

const makeApp = db => {
   const app = express();
   app.set('db', db);
   app.use((req, res, next) => {
      req.user = { account_id: ACCOUNT, user_id: USER, access_level: 'admin' };
      next();
   });
   app.use('/job', jobRouter);
   return app;
};

// A job "family": root 501 plus two version rows created by
// updateRecentJobTotal as the total changed over time (502, 503 both point
// parent_job_id -> 501).
const jobFamily = () => [
   { customer_job_id: 501, account_id: ACCOUNT, customer_id: 100, parent_job_id: null, current_job_total: 0, job_type_id: 1 },
   { customer_job_id: 502, account_id: ACCOUNT, customer_id: 100, parent_job_id: 501, current_job_total: 100, job_type_id: 1 },
   { customer_job_id: 503, account_id: ACCOUNT, customer_id: 100, parent_job_id: 501, current_job_total: 250, job_type_id: 1 }
];

// A2 (2026-09 review): job create/update/delete now run under lockCustomerLedger,
// which needs a `customers` row for every customer id it locks.
const baseCustomers = () => [
   { customer_id: 100, account_id: ACCOUNT },
   { customer_id: 200, account_id: ACCOUNT }
];

const updateBody = overrides => ({
   customerJobID: 501,
   customerID: 100,
   jobTypeID: 1,
   currentJobTotal: 0,
   isJobComplete: false,
   isQuote: false,
   userID: USER,
   quoteAmount: 0,
   ...overrides
});

describe('job-router DELETE /deleteJob (family-aware guard)', () => {
   const del = (db, jobID) => supertest(makeApp(db)).delete(`/job/deleteJob/${jobID}/${ACCOUNT}/${USER}`).send({});

   it('deletes every row in the family when nothing references any of them', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });

      const res = await del(db, 501); // delete via the root id

      expect(res.body.status).to.equal(200);
      expect(db._store.customer_jobs).to.have.lengthOf(0);
   });

   it('refuses when a transaction references a SIBLING VERSION row, not just the id that was clicked', async () => {
      // Deleting the ROOT (501); the only linked transaction points at a later
      // version (502) in the same family - the old per-id-only check missed this.
      const db = buildFakeDb({
         customer_jobs: jobFamily(),
         customer_transactions: [{ transaction_id: 1, account_id: ACCOUNT, customer_job_id: 502 }],
         customer_writeoffs: [],
         customer_payments: [],
         customers: baseCustomers()
      });

      const res = await del(db, 501);

      expect(res.body.status).to.equal(500);
      expect(res.body.message).to.match(/Transactions are linked/);
      // Refused - nothing in the family was deleted.
      expect(db._store.customer_jobs).to.have.lengthOf(3);
   });

   it('refuses when a write-off references any row in the family', async () => {
      const db = buildFakeDb({
         customer_jobs: jobFamily(),
         customer_transactions: [],
         customer_writeoffs: [{ writeoff_id: 1, account_id: ACCOUNT, customer_job_id: 503 }],
         customer_payments: [],
         customers: baseCustomers()
      });

      const res = await del(db, 501);

      expect(res.body.status).to.equal(500);
      expect(res.body.message).to.match(/Write offs are linked/);
      expect(db._store.customer_jobs).to.have.lengthOf(3);
   });

   it('refuses when a payment references any row in the family (previously not checked at all)', async () => {
      const db = buildFakeDb({
         customer_jobs: jobFamily(),
         customer_transactions: [],
         customer_writeoffs: [],
         customer_payments: [{ payment_id: 1, account_id: ACCOUNT, customer_job_id: 502 }],
         customers: baseCustomers()
      });

      const res = await del(db, 501);

      expect(res.body.status).to.equal(500);
      expect(res.body.message).to.match(/Payments are linked/);
      expect(db._store.customer_jobs).to.have.lengthOf(3);
   });

   it('deletes the whole family even when a non-root version id is the one requested', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });

      const res = await del(db, 503); // delete via a version id, not the root

      expect(res.body.status).to.equal(200);
      expect(db._store.customer_jobs).to.have.lengthOf(0);
   });

   it('reports a clear error for a job that does not exist', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });

      const res = await del(db, 999999);

      expect(res.body.status).to.equal(500);
      expect(res.body.message).to.match(/Job not found/);
   });
});

// A2 (2026-09 review): create/update/delete now run under the customer ledger
// lock (lockCustomerLedger), re-read the job under that lock, and keep every
// check + the family mutation itself inside the same transaction.
describe('job-router — ledger-serialized create/update (A2)', () => {
   describe('POST /createJob', () => {
      const create = (db, job) => supertest(makeApp(db)).post(`/job/createJob/${ACCOUNT}/${USER}`).send({ job });

      it('a brand new job is always a family root — a client-supplied parentJobID cannot attach it to an existing family', async () => {
         const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });

         const res = await create(db, { customerID: 100, jobTypeID: 2, parentJobID: 501, currentJobTotal: 0, isJobComplete: false, isQuote: false, userID: USER, quoteAmount: 0 });

         expect(res.body.status).to.equal(200);
         const created = db._store.customer_jobs.find(j => j.job_type_id === 2);
         expect(created, 'the new job was written').to.exist;
         expect(created.parent_job_id).to.equal(null);
      });

      it('still refuses a duplicate job (same job_type_id + customer) inside the new lock/transaction wrapper', async () => {
         const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });

         const res = await create(db, { customerID: 100, jobTypeID: 1, currentJobTotal: 0, isJobComplete: false, isQuote: false, userID: USER, quoteAmount: 0 });

         expect(res.body.status).to.equal(500);
         expect(res.body.message).to.match(/Duplicate job/);
         expect(db._store.customer_jobs).to.have.lengthOf(3);
      });
   });

   describe('PUT /updateJob', () => {
      const update = (db, job) => supertest(makeApp(db)).put(`/job/updateJob/${ACCOUNT}/${USER}`).send({ job });

      it('reports a clear error when updating a job that does not exist', async () => {
         const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });

         const res = await update(db, updateBody({ customerJobID: 999999 }));

         expect(res.body.status).to.equal(500);
         expect(res.body.message).to.match(/Job not found/);
      });

      it('reassigning an unlinked job moves the WHOLE family to the new customer, not just the targeted row', async () => {
         const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });

         const res = await update(db, updateBody({ customerID: 200 }));

         expect(res.body.status).to.equal(200);
         expect(res.body.warning).to.match(/reassigned to a different customer/);
         expect(db._store.customer_jobs.map(j => j.customer_id)).to.deep.equal([200, 200, 200]);
      });

      it('refuses reassignment when a transaction is linked to any family member, leaving the whole family under the original customer', async () => {
         const db = buildFakeDb({
            customer_jobs: jobFamily(),
            customer_transactions: [{ transaction_id: 1, account_id: ACCOUNT, customer_job_id: 503 }],
            customer_writeoffs: [],
            customer_payments: [],
            customers: baseCustomers()
         });

         const res = await update(db, updateBody({ customerID: 200 }));

         expect(res.body.status).to.equal(500);
         expect(res.body.message).to.match(/transactions are linked/);
         expect(db._store.customer_jobs.map(j => j.customer_id)).to.deep.equal([100, 100, 100]);
      });

      it('rolls back the whole update — including an earlier completion-toggle write — if the final write fails', async () => {
         const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });
         const before = structuredClone(db._store.customer_jobs);
         const originalUpdateJob = jobService.updateJob;
         jobService.updateJob = async () => {
            throw new Error('simulated failure after the completion toggle');
         };

         try {
            const res = await update(db, updateBody({ isJobComplete: true }));
            expect(res.body.status).to.equal(500);
            expect(res.body.message).to.match(/simulated failure/);
            // toggleJobCompletion ran (in the same transaction) BEFORE the failing
            // updateJob call — its write must not have stuck.
            expect(db._store.customer_jobs).to.deep.equal(before);
         } finally {
            jobService.updateJob = originalUpdateJob;
         }
      });

      it('refuses with a concurrent-edit message when the job moved to a different customer between the two lock-window reads', async () => {
         // withJobLedger re-reads the job AFTER acquiring the lock and compares it
         // against the read it took BEFORE the lock. Simulate a concurrent writer
         // that reassigned the job in that window (e.g. another request's own
         // withJobLedger, which this test cannot literally interleave against a
         // synchronous fake db) by making the SECOND read disagree with the first.
         const db = buildFakeDb({ customer_jobs: jobFamily(), customer_transactions: [], customer_writeoffs: [], customer_payments: [], customers: baseCustomers() });
         const originalGetSingleJob = jobService.getSingleJob;
         let calls = 0;
         jobService.getSingleJob = async (...args) => {
            calls += 1;
            const rows = await originalGetSingleJob(...args);
            return calls === 2 && rows[0] ? [{ ...rows[0], customer_id: 999 }] : rows;
         };

         try {
            const res = await update(db, updateBody({}));
            expect(res.body.status).to.equal(500);
            expect(res.body.message).to.match(/changed while saving/);
         } finally {
            jobService.getSingleJob = originalGetSingleJob;
         }
      });
   });
});
