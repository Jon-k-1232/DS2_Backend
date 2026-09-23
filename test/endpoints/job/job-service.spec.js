const { buildFakeDb } = require('../transactions/_fakeDb');
const jobService = require('../../../src/endpoints/job/job-service');

const jobFamily = (accountId = 1) => [
   { customer_job_id: 501, account_id: accountId, customer_id: 100, parent_job_id: null, current_job_total: 0 },
   { customer_job_id: 502, account_id: accountId, customer_id: 100, parent_job_id: 501, current_job_total: 100 },
   { customer_job_id: 503, account_id: accountId, customer_id: 100, parent_job_id: 501, current_job_total: 250 }
];

describe('job-service.getJobFamilyIds', () => {
   it('resolves the whole family (root + versions) when given the root id', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily() });
      const ids = (await jobService.getJobFamilyIds(db, 501, 1)).sort((a, b) => a - b);
      expect(ids).to.deep.equal([501, 502, 503]);
   });

   it('resolves the same whole family when given a non-root version id', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily() });
      const ids = (await jobService.getJobFamilyIds(db, 503, 1)).sort((a, b) => a - b);
      expect(ids).to.deep.equal([501, 502, 503]);
   });

   it('returns an empty array for a job that does not exist', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily() });
      const ids = await jobService.getJobFamilyIds(db, 999999, 1);
      expect(ids).to.deep.equal([]);
   });

   it('does not pull in another account\'s job even if a family were to share an id space', async () => {
      const db = buildFakeDb({ customer_jobs: [...jobFamily(1), { customer_job_id: 900, account_id: 2, customer_id: 1, parent_job_id: null }] });
      const ids = await jobService.getJobFamilyIds(db, 900, 1); // wrong account for this id
      expect(ids).to.deep.equal([]);
   });
});

describe('job-service.deleteJobFamily', () => {
   it('deletes every row whose id is in the family, scoped to the account', async () => {
      const db = buildFakeDb({ customer_jobs: [...jobFamily(1), { customer_job_id: 900, account_id: 2, customer_id: 1, parent_job_id: null }] });
      const count = await jobService.deleteJobFamily(db, [501, 502, 503], 1);
      expect(count).to.equal(3);
      expect(db._store.customer_jobs).to.have.lengthOf(1);
      expect(db._store.customer_jobs[0].customer_job_id).to.equal(900);
   });

   it('does not delete a matching id that belongs to a different account', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily(1) });
      const count = await jobService.deleteJobFamily(db, [501, 502, 503], 2); // wrong account
      expect(count).to.equal(0);
      expect(db._store.customer_jobs).to.have.lengthOf(3);
   });

   it('is a no-op for an empty id list', async () => {
      const db = buildFakeDb({ customer_jobs: jobFamily(1) });
      const count = await jobService.deleteJobFamily(db, [], 1);
      expect(count).to.equal(0);
      expect(db._store.customer_jobs).to.have.lengthOf(3);
   });
});
