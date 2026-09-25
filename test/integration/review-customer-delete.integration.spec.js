const { bootHttp, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const fixture = require('./_review-fixture');
const jobService = require('../../src/endpoints/job/job-service');

describe('F24/F25 customer deletion integrity', function () {
   let h, f, quoteIds = [];
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => {
      if (h) {
         await h.db('customer_quotes').where({ account_id: 9001 }).whereIn('customer_quote_id', quoteIds).del();
         await f.cleanup(); await h.close();
      }
   });
   const remove = c => h.as('admin').delete(`/customer/deleteCustomer/${c.customer_id}/9001/90013`);
   it('F24 deletes all owned contacts with an unused customer', async () => {
      const c = await f.customer();
      await f.insert('customer_information', { customer_id: c.customer_id, customer_email: 'private@example.test', customer_state: 'AZ', is_customer_physical_address: false, is_customer_billing_address: false, is_this_address_active: false, is_customer_mailing_address: true, created_by_user_id: 90013 });
      expectEnvelopeOk(await remove(c));
      expect(await h.db('customer_information').where({ account_id: 9001, customer_id: c.customer_id })).to.have.length(0);
   });
   it('F24 preserves a customer and contacts with quote-only history', async () => {
      const c = await f.customer();
      const quote = await f.insert('customer_quotes', { customer_id: c.customer_id, amount_quoted: 100, is_quote_active: false, created_by_user_id: 90013, notes: 'F24 quote guard' });
      quoteIds.push(quote.customer_quote_id);
      expectEnvelopeRefused(await remove(c), /disable/i);
      expect(await h.db('customer_information').where({ account_id: 9001, customer_id: c.customer_id })).to.have.length(1);
   });
   it('F25 waits for a concurrent job writer before checking history', async () => {
      const c = await f.customer();
      const original = jobService.createJob;
      let entered, release;
      const enteredPromise = new Promise(r => { entered = r; });
      const releasePromise = new Promise(r => { release = r; });
      let writer, deletion;
      jobService.createJob = async (...args) => { entered(); await releasePromise; return original(...args); };
      try {
         writer = h.as('admin').post('/jobs/createJob/9001/90013').send({ job: { customerID: c.customer_id, jobTypeID: 900201, quoteAmount: 0 } }).then(r => r);
         await enteredPromise;
         deletion = remove(c).then(r => r);
         // Observe the second connection waiting for the writer's account or
         // customer lock (auditContext takes the account lock first).
         let waiting = false;
         for (let i = 0; i < 100 && !waiting; i++) {
            const { rows } = await h.db.raw("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND (query ILIKE '%customers%' OR query ILIKE '%pg_advisory_xact_lock%')");
            waiting = rows.length > 0;
            if (!waiting) await new Promise(r => setTimeout(r, 20));
         }
         expect(waiting, 'delete waits on the writer').to.equal(true);
         release();
         expectEnvelopeOk(await writer);
         expectEnvelopeRefused(await deletion, /disable/i);
         expect(await h.db('customers').where({ account_id: 9001, customer_id: c.customer_id })).to.have.length(1);
         expect(await h.db('customer_jobs').where({ account_id: 9001, customer_id: c.customer_id })).to.have.length(1);
      } finally {
         release(); jobService.createJob = original;
         await Promise.all([writer, deletion]);
      }
   });
   it('F25 counts raw jobs even when their type join is missing', async () => {
      const c = await f.customer();
      const foreignType = await h.db('customer_job_types').whereNot('account_id', 9001).first('job_type_id');
      await f.job(c, { job_type_id: foreignType.job_type_id });
      expectEnvelopeRefused(await remove(c), /disable/i);
   });
});
