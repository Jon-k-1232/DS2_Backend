const { bootHttp, expectEnvelopeOk } = require('./_http');
const fixture = require('./_review-fixture');
const jobService = require('../../src/endpoints/job/job-service');

describe('F23 latest job family selection', function () {
   let h, f;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   it('keeps job timestamps and selects the latest version with an ID tie-break', async () => {
      const c = await f.customer();
      const root = await f.job(c, { created_at: '2026-01-01', current_job_total: 0 });
      await f.job(c, { parent_job_id: root.customer_job_id, created_at: '2026-01-02', current_job_total: 100 });
      const latest = await f.job(c, { parent_job_id: root.customer_job_id, created_at: '2026-01-02', current_job_total: 150 });
      // A higher ID alone does not make a backdated version current.
      await f.job(c, { parent_job_id: root.customer_job_id, created_at: '2026-01-01T12:00:00', current_job_total: 50 });
      const res = expectEnvelopeOk(await h.as('admin').get(`/jobs/getActiveCustomerJobs/9001/90013/${c.customer_id}`));
      const rows = res.activeCustomerJobData.activeCustomerJobs;
      expect(rows).to.have.length(1);
      expect(rows[0].customer_job_id).to.equal(latest.customer_job_id);
      expect(Number(rows[0].current_job_total)).to.equal(150);
      expect(new Date(rows[0].created_at).getTime()).to.equal(latest.created_at.getTime());
      const profile = expectEnvelopeOk(await h.as('admin').get(`/customer/activeCustomers/customerByID/9001/90013/${c.customer_id}`));
      expect(Number(profile.customerJobData.treeGrid.rows[0].current_job_total)).to.equal(150);
   });
   it('preserves the job creator and creation date on account-wide joined lists', async () => {
      const c = await f.customer();
      const j = await f.job(c, { created_at: '2026-01-01', created_by_user_id: 90011 });
      const row = (await jobService.getActiveJobs(h.db, 9001)).find(r => r.customer_job_id === j.customer_job_id);
      expect(row.created_by_user_id).to.equal(90011);
      expect(row.created_at.getTime()).to.equal(j.created_at.getTime());
      expect(row.job_description).to.be.a('string');
   });
});
