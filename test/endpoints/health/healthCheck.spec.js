/**
 * Fix 8: /healthz must stay cheap (no DB call — it's polled far more often),
 * but /api/health/check should actually probe the DB. healthService.dbStatus
 * existed but was dead code (never called from any router), so /check always
 * reported "ok" even with the DB fully down.
 *
 * Uses a stub `db` (via app.set('db', ...)) instead of the real sandbox
 * Postgres so this spec has no external dependency and always runs.
 */
const express = require('express');
const supertest = global.supertest || require('supertest');
const { healthRouter } = require('../../../src/endpoints/health/health-router');
const healthService = require('../../../src/endpoints/health/health-service');

const buildApp = db => {
   const app = express();
   // Same dual-mount as src/app.js: /api/health -> /check + /, /healthz -> /.
   app.use('/api/health', healthRouter);
   app.use('/healthz', healthRouter);
   app.set('db', db);
   return app;
};

describe('fix 8: /api/health/check runs a real DB probe; /healthz stays cheap', () => {
   it('healthService.dbStatus runs SELECT 1 (a true connectivity probe, not a table-dependent query)', async () => {
      let sql = null;
      const stubDb = { raw: query => { sql = query; return Promise.resolve({ rows: [{ '?column?': 1 }] }); } };
      await healthService.dbStatus(stubDb);
      expect(sql).to.equal('SELECT 1');
   });

   it('GET /api/health/check reports 200 + db: "ok" when the DB probe succeeds', async () => {
      const app = buildApp({ raw: () => Promise.resolve({ rows: [{ '?column?': 1 }] }) });
      const res = await supertest(app).get('/api/health/check');
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('ok');
      expect(res.body.db).to.equal('ok');
      expect(res.body.timestamp).to.be.a('string');
   });

   it('GET /api/health/check reports 503 + db: "error" when the DB probe fails (previously always reported ok)', async () => {
      const app = buildApp({ raw: () => Promise.reject(new Error('connection refused')) });
      const res = await supertest(app).get('/api/health/check');
      expect(res.status).to.equal(503);
      expect(res.body.status).to.equal('error');
      expect(res.body.db).to.equal('error');
      expect(res.body.message).to.equal('connection refused');
   });

   it('GET /healthz stays cheap: 200 with no DB call at all, even when the DB is broken', async () => {
      let dbWasCalled = false;
      const app = buildApp({ raw: () => { dbWasCalled = true; return Promise.reject(new Error('should never be reached')); } });
      const res = await supertest(app).get('/healthz');
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ status: 'ok' });
      expect(dbWasCalled, '/healthz must not touch the DB').to.equal(false);
   });
});
