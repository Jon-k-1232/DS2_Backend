const { spawnSync } = require('child_process');

describe('F26 job type refresh rejection', () => {
   for (const method of ['put', 'delete']) it(`handles a failed refresh after a committed ${method}`, () => {
      // Isolation prevents the old detached rejection from killing mocha.
      const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', `
         const assert = require('assert');
         require('./src/utils/relatedAccount').requireAccountRow = async () => ({});
         const service = require('./src/endpoints/jobType/jobType-service');
         require('./src/endpoints/job/job-service').getSingleJobType = async () => [];
         let committed = false, response;
         service.getSingleJobType = async () => [{ job_type_id: 1 }];
         service.updateJobType = service.deleteJobType = async () => { committed = true; return 1; };
         service.getActiveJobTypes = async () => { throw new Error('refresh unavailable'); };
         const router = require('./src/endpoints/jobType/jobType-router');
         const handler = router.stack.find(l => l.route && l.route.methods.${method}).route.stack.slice(-1)[0].handle;
         (async () => {
            await handler({ app: { get: () => ({}) }, params: { accountID: 9001, jobTypeID: 1 },
               body: { jobType: { jobTypeID: 1, customerJobCategoryID: 900301 } } },
               { send: data => { response = data; } });
            await new Promise(r => setImmediate(r));
            assert.equal(committed, true);
            assert.equal(response.status, 200);
            assert.equal(response.committed, true);
            assert.match(response.message, /^Successfully/);
            assert.match(response.warnings.join(' '), /saved.*Reload.*do not submit/);
         })().catch(e => { console.error(e); process.exitCode = 1; });
      `], { cwd: process.cwd(), encoding: 'utf8' });
      expect(result.status, result.stderr || result.stdout).to.equal(0);
   });
});
