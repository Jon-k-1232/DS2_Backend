/**
 * Route coverage — Billing Review READ endpoints (the six routes the coverage
 * matrix reported as unreferenced). The mutation routes (PUT edit, POST
 * reprocess, PUT transaction cascade) are exercised by
 * cascade-edit-recompute.integration.spec.js and the ingestion specs.
 *
 * Mount gates (src/app.js): requireAuth, requireManagerOrAdmin,
 * limitMutationsOnly — so every GET here needs a manager+ token for the URL's
 * own account.
 *
 * Run:
 *   DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js \
 *     test/integration/coverage-billing-review.integration.spec.js --exit --timeout 120000
 */
const { bootHttp } = require('./_http');

describe('integration: coverage — billing-review read routes', function () {
   this.timeout(120_000);

   const A = 9001;
   const U = 90013;
   const EMP = 90011;
   let h;

   before(async function () {
      h = await bootHttp.call(this);
   });

   after(async () => {
      if (h) await h.close();
   });

   const gateTests = (method, path) => {
      it('401s without a token', async () => {
         const res = await h.anonymous[method](path(A, U));
         expect(res.status).to.equal(401);
      });
      it('403s an "employee" caller — requireManagerOrAdmin mount gate', async () => {
         const res = await h.as('employee')[method](path(A, EMP));
         expect(res.status).to.equal(403);
      });
      it("403s when the URL account is not the caller's own (cross-tenant)", async () => {
         const res = await h.as('admin')[method](path(1, U));
         expect(res.status).to.equal(403);
      });
   };

   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /billing-review/distinct-entities/:accountID/:userID', () => {
      const path = (a, u) => `/billing-review/distinct-entities/${a}/${u}`;
      gateTests('get', path);
      it('happy path: returns the account\'s distinct entity list', async () => {
         const res = await h.as('admin').get(path(A, U));
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('ok');
         expect(res.body.entities).to.be.an('array');
         res.body.entities.forEach(e => expect(e).to.be.a('string'));
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /billing-review/earliest-unbilled-month/:accountID/:userID', () => {
      const path = (a, u) => `/billing-review/earliest-unbilled-month/${a}/${u}`;
      gateTests('get', path);
      it('happy path: returns a YYYY-MM-DD start (or null when nothing is unbilled)', async () => {
         const res = await h.as('admin').get(path(A, U));
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('ok');
         if (res.body.start !== null) expect(String(res.body.start)).to.match(/^\d{4}-\d{2}-\d{2}/);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /billing-review/pending/:accountID/:userID', () => {
      const path = (a, u) => `/billing-review/pending/${a}/${u}`;
      gateTests('get', path);
      it('happy path: a paginated list of held entries with a total', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?page=1&limit=5`);
         expect(res.status).to.equal(200);
         const body = res.body;
         const list = body.entries || body.items || body.rows || body.data;
         expect(list, `list key in ${Object.keys(body).join(',')}`).to.be.an('array');
         expect(list.length).to.be.at.most(5);
         const total = body.total ?? body.totalCount ?? body.pagination?.total ?? body.pagination?.totalCount;
         expect(total, 'a total/pagination figure is returned').to.not.equal(undefined);
      });
      it('validation: a hold_reason filter never returns rows with another hold reason', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?hold_reason=low_ai_confidence&limit=20`);
         expect(res.status).to.equal(200);
         const list = res.body.entries || res.body.items || res.body.rows || res.body.data || [];
         list.forEach(row => expect(row.hold_reason).to.equal('low_ai_confidence'));
      });
      it('validation: a nonsense page or page size is refused with 400, never a 500', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?page=abc&limit=-3`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/pagination/i);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /billing-review/weekly/:accountID/:userID', () => {
      const path = (a, u) => `/billing-review/weekly/${a}/${u}`;
      gateTests('get', path);
      it('validation: start and end are required', async () => {
         const res = await h.as('admin').get(path(A, U));
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/start and end/i);
      });
      it('validation: start/end must be YYYY-MM-DD', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?start=09/01/2026&end=09/07/2026`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/YYYY-MM-DD/);
      });
      it('happy path: a valid week returns the consolidated transaction list', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?start=2026-09-01&end=2026-09-07`);
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('ok');
         const rows = res.body.transactions || res.body.rows || res.body.items || res.body.entries;
         expect(rows, `rows key in ${Object.keys(res.body).join(',')}`).to.be.an('array');
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /billing-review/pre-invoice/:accountID/:userID', () => {
      const path = (a, u) => `/billing-review/pre-invoice/${a}/${u}`;
      gateTests('get', path);
      it('validation: customerId, start and end are all required', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?customerId=900101`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.match(/customerId, start, end/);
      });
      it('happy path: a customer/period returns the consolidated list plus an anomaly check', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?customerId=900101&start=2026-09-01&end=2026-09-30`);
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('ok');
         expect(res.body).to.have.property('anomaly');
      });
      it('tenancy: another account\'s customer id yields an empty/anomaly-free result, never that tenant\'s rows', async () => {
         // Customer 1 belongs to account 1 (production copy). The query is scoped
         // by the URL account, so nothing from account 1 may come back.
         const res = await h.as('admin').get(`${path(A, U)}?customerId=1&start=2020-01-01&end=2030-12-31`);
         expect(res.status).to.equal(200);
         const rows = res.body.transactions || res.body.rows || res.body.items || res.body.entries || [];
         expect(rows).to.deep.equal([]);
      });
   });

   // ─────────────────────────────────────────────────────────────────────────
   describe('GET /billing-review/reprocess-count/:accountID/:userID', () => {
      const path = (a, u) => `/billing-review/reprocess-count/${a}/${u}`;
      gateTests('get', path);
      it('happy path: default mode is "unprocessed" and reports a count + eligibility', async () => {
         const res = await h.as('admin').get(path(A, U));
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('ok');
         expect(res.body.mode).to.equal('unprocessed');
         expect(res.body.count).to.be.a('number');
         expect(res.body.eligible).to.be.a('boolean');
      });
      it('validation: an unknown mode is refused with a 4xx, never a 500', async () => {
         const res = await h.as('admin').get(`${path(A, U)}?mode=everything-please`);
         expect(res.status).to.be.within(400, 499);
      });
   });
});
