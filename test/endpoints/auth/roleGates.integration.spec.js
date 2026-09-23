/**
 * Fix 2: backend role gates must mirror the frontend's role gates
 * (DS2_Frontend/src/Routes/PrimaryRouter.js, SidebarRoutes.js,
 * AdminProtectedAccess.js, ManagerAndAdminProtectedAccess.js, SuperAdminAccess.js).
 * Fix 3: notifications :userID must be self-or-privileged
 * (src/endpoints/auth/account-scope.js enforceSelfOrPrivileged).
 *
 * Driven through the real Express app (src/app.js) with real JWTs minted the
 * same way auth-service.js does, against the sandbox DB fixture account 9001
 * (test/fixtures/seed.sql): user 90013 has access_level 'admin', user 90011
 * has access_level 'employee' (i.e. NOT manager/admin/super admin — a stand-in
 * for the frontend's "User" role for gate-testing purposes, since none of the
 * role checks in this codebase special-case the literal string 'user').
 *
 * There is no Super Admin fixture user, so a throwaway one (90098) is created
 * in `before` and removed in `after` to exercise the "privileged caller is let
 * through" side of the requireSuperAdmin-gated routes.
 *
 * Skipped entirely when the sandbox DB is unreachable (see _setup.requireDb).
 */
const { requireDb, closeDb, TEST_ACCOUNT_ID } = require('../../integration/_setup');
const jwt = require('jsonwebtoken');
const supertest = global.supertest || require('supertest');
const app = require('../../../src/app');
const config = require('../../../config');

const A = TEST_ACCOUNT_ID; // 9001
const ADMIN_ID = 90013;
const ADMIN_EMAIL = 'admin+test@example.com';
const EMPLOYEE_ID = 90011;
const EMPLOYEE_EMAIL = 'eliza+test@example.com';
const SUPER_ADMIN_ID = 90098; // throwaway, created in before() / removed in after()
const SUPER_ADMIN_EMAIL = 'superadmin+test@example.com';

describe('integration: backend role gates mirror the frontend (fixes 2 & 3)', function () {
   this.timeout(30_000);

   let db;
   let adminToken;
   let employeeToken;
   let superAdminToken;

   const mint = (email, userId) => jwt.sign({ user_id: userId }, config.JWT_SECRET, { subject: email, expiresIn: '2h', algorithm: 'HS256' });
   const withAuth = (req, token) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
   const get = (url, token) => withAuth(supertest(app).get(url), token);
   const post = (url, token, body = {}) => withAuth(supertest(app).post(url), token).send(body);

   before(async function () {
      db = await requireDb.call(this);
      app.set('db', db);
      // When this file runs as part of the full `npm run test:unit` sweep
      // (not in isolation), an earlier-loaded spec (e.g. test/app.spec.js,
      // which requires src/app.js with no env file loaded) can cause
      // config.js's module-level object to be cached with an empty
      // JWT_SECRET before _setup.js's dotenv.config() (triggered by the
      // require at the top of this file) ever runs. process.env.JWT_SECRET
      // itself is correct by this point either way; config.js just cached a
      // stale read of it. Patch the shared config object directly so
      // authService's config.JWT_SECRET reads (evaluated at call time, not
      // captured at require time) see the right value regardless of load order.
      config.JWT_SECRET = process.env.JWT_SECRET || config.JWT_SECRET;

      await db('users')
         .insert({
            user_id: SUPER_ADMIN_ID,
            account_id: A,
            email: SUPER_ADMIN_EMAIL,
            display_name: 'Temp Super Admin',
            job_title: 'Owner',
            access_level: 'Super Admin',
            is_user_active: true
         })
         .onConflict('user_id')
         .merge();

      adminToken = mint(ADMIN_EMAIL, ADMIN_ID);
      employeeToken = mint(EMPLOYEE_EMAIL, EMPLOYEE_ID);
      superAdminToken = mint(SUPER_ADMIN_EMAIL, SUPER_ADMIN_ID);
   });

   after(async () => {
      if (db) {
         await db('users').where({ user_id: SUPER_ADMIN_ID, account_id: A }).del();
      }
      await closeDb();
   });

   describe('no token at all', () => {
      it('401s on a protected route regardless of role gate', async () => {
         const res = await get(`/customer/activeCustomers/${A}/${ADMIN_ID}`, null);
         expect(res.status).to.equal(401);
      });
   });

   // ── requireManagerOrAdmin-gated routes ─────────────────────────────────────
   const managerOrAdminGatedGetRoutes = [
      ['GET /customer/activeCustomers (paginated list)', `/customer/activeCustomers/${A}/${ADMIN_ID}`],
      ['GET /recurringCustomer/getActiveRecurringCustomers', `/recurringCustomer/getActiveRecurringCustomers/${A}/${ADMIN_ID}`],
      ['GET /accountsReceivable/aging', `/accountsReceivable/aging/${A}/${ADMIN_ID}`],
      ['GET /invoices/getInvoices', `/invoices/getInvoices/${A}/0`]
   ];

   managerOrAdminGatedGetRoutes.forEach(([label, url]) => {
      describe(label, () => {
         it('403s an "employee" (non-manager/admin) caller', async () => {
            const res = await get(url, employeeToken);
            expect(res.status).to.equal(403);
         });

         it('lets an "admin" caller through (200, not 401/403)', async () => {
            const res = await get(url, adminToken);
            expect(res.status).to.equal(200);
         });
      });
   });

   describe('POST /customer/createCustomer (requireManagerOrAdmin, fix 2 + fix 4)', () => {
      it('403s an "employee" caller before ever touching the body/DB', async () => {
         const res = await post(`/customer/createCustomer/${A}/${EMPLOYEE_ID}`, employeeToken, { customer: {} });
         expect(res.status).to.equal(403);
      });
   });

   describe('POST /recurringCustomer/createRecurringCustomer (requireManagerOrAdmin — previously completely ungated)', () => {
      it('403s an "employee" caller', async () => {
         const res = await post(`/recurringCustomer/createRecurringCustomer/${A}/${EMPLOYEE_ID}`, employeeToken, { recurringCustomer: {} });
         expect(res.status).to.equal(403);
      });
   });

   // ── requireSuperAdmin-gated routes ──────────────────────────────────────────
   describe('GET /accountAudit/whoami (requireSuperAdmin, gated inside account-audit-router.js itself)', () => {
      const url = `/accountAudit/whoami/${A}/${ADMIN_ID}`;

      it('403s an "employee" caller', async () => {
         expect((await get(url, employeeToken)).status).to.equal(403);
      });

      it('403s a plain "admin" caller (super admin is strictly narrower than admin)', async () => {
         expect((await get(url, adminToken)).status).to.equal(403);
      });

      it('200s a "Super Admin" caller', async () => {
         const res = await get(url, superAdminToken);
         expect(res.status).to.equal(200);
         expect(res.body.auditor.access_level).to.equal('Super Admin');
      });
   });

   describe('POST /account/createAccount (requireSuperAdmin — previously completely ungated)', () => {
      it('403s an "employee" caller', async () => {
         expect((await post('/account/createAccount', employeeToken, { account: {} })).status).to.equal(403);
      });

      it('403s a plain "admin" caller', async () => {
         expect((await post('/account/createAccount', adminToken, { account: {} })).status).to.equal(403);
      });

      it('does not 403/401 a "Super Admin" caller (gate passes; may still fail downstream on the empty body)', async () => {
         const res = await post('/account/createAccount', superAdminToken, { account: {} });
         expect(res.status).to.not.equal(401);
         expect(res.status).to.not.equal(403);
      });
   });

   describe('POST /user/createUser (requireSuperAdmin, pre-existing gate — confirms it still works after the fetchSingleUser self-or-privileged change)', () => {
      it('403s an "employee" caller', async () => {
         expect((await post(`/user/createUser/${A}/${EMPLOYEE_ID}`, employeeToken, { user: {} })).status).to.equal(403);
      });

      it('403s a plain "admin" caller', async () => {
         expect((await post(`/user/createUser/${A}/${ADMIN_ID}`, adminToken, { user: {} })).status).to.equal(403);
      });
   });

   // ── fix 2 + fix 7: fetchSingleUser must be self-or-privileged, not blanket manager/admin ──
   describe('GET /user/fetchSingleUser/:accountID/:userID (self-or-privileged, fix 2)', () => {
      it('lets an "employee" fetch their OWN record (this used to 403 on every plain-user page reload)', async () => {
         const res = await get(`/user/fetchSingleUser/${A}/${EMPLOYEE_ID}`, employeeToken);
         expect(res.status).to.equal(200);
         expect(res.body.activeUserData.activeUser.user_id).to.equal(EMPLOYEE_ID);
      });

      it('403s an "employee" fetching a DIFFERENT user\'s record', async () => {
         const res = await get(`/user/fetchSingleUser/${A}/${ADMIN_ID}`, employeeToken);
         expect(res.status).to.equal(403);
      });

      it('lets an "admin" (privileged) fetch a different user\'s record', async () => {
         const res = await get(`/user/fetchSingleUser/${A}/${EMPLOYEE_ID}`, adminToken);
         expect(res.status).to.equal(200);
         expect(res.body.activeUserData.activeUser.user_id).to.equal(EMPLOYEE_ID);
      });
   });

   // ── fix 3: notifications :userID must be self-or-privileged ────────────────
   describe('GET /notifications/:accountID/:userID (self-or-privileged, fix 3)', () => {
      it('lets an "employee" read their OWN notifications', async () => {
         const res = await get(`/notifications/${A}/${EMPLOYEE_ID}`, employeeToken);
         expect(res.status).to.equal(200);
      });

      it('403s an "employee" reading a DIFFERENT user\'s notifications', async () => {
         const res = await get(`/notifications/${A}/${ADMIN_ID}`, employeeToken);
         expect(res.status).to.equal(403);
      });

      it('lets an "admin" (privileged) read a different user\'s notifications', async () => {
         const res = await get(`/notifications/${A}/${EMPLOYEE_ID}`, adminToken);
         expect(res.status).to.equal(200);
      });
   });
});
