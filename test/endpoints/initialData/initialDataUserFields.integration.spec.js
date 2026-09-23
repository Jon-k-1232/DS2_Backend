/**
 * Fix 10: /initialData/initialBlob must not change payload SHAPE (the
 * frontend depends on it — customersList/recurringCustomersList/
 * teamMembersList/etc. all stay present with the same grid/pagination
 * structure), but must strip cost_rate/billing_rate/email from the
 * teamMembersList user rows for a non-privileged ("employee") caller. A
 * privileged caller (manager/admin/super admin) still sees the full rows.
 *
 * /initialData/initialBlob has no role gate at all by design (every
 * authenticated role needs the app shell on load), so this only needs one
 * employee token and one admin token — no throwaway users required.
 *
 * Driven through the real Express app against the sandbox DB fixture account
 * 9001. Skipped when the sandbox DB is unreachable.
 */
const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('../../integration/_setup');
const jwt = require('jsonwebtoken');
const supertest = global.supertest || require('supertest');
const app = require('../../../src/app');
const config = require('../../../config');

const A = TEST_ACCOUNT_ID; // 9001
const ADMIN_ID = TEST_ADMIN_USER_ID; // 90013
const ADMIN_EMAIL = 'admin+test@example.com';
const EMPLOYEE_ID = 90011;
const EMPLOYEE_EMAIL = 'eliza+test@example.com';
const SENSITIVE_FIELDS = ['cost_rate', 'billing_rate', 'email'];

describe('integration: /initialData strips sensitive user fields for non-privileged callers (fix 10)', function () {
   this.timeout(30_000);

   let db;
   let adminToken;
   let employeeToken;

   before(async function () {
      db = await requireDb.call(this);
      app.set('db', db);
      config.JWT_SECRET = process.env.JWT_SECRET || config.JWT_SECRET;
      adminToken = jwt.sign({ user_id: ADMIN_ID }, config.JWT_SECRET, { subject: ADMIN_EMAIL, expiresIn: '2h', algorithm: 'HS256' });
      employeeToken = jwt.sign({ user_id: EMPLOYEE_ID }, config.JWT_SECRET, { subject: EMPLOYEE_EMAIL, expiresIn: '2h', algorithm: 'HS256' });
   });

   after(async () => {
      await closeDb();
   });

   const fetchBlob = token => supertest(app).get(`/initialData/initialBlob/${A}/${ADMIN_ID}`).set('Authorization', `Bearer ${token}`);

   it('an "employee" (non-privileged) caller gets a teamMembersList with cost_rate/billing_rate/email stripped from every user row', async () => {
      const res = await fetchBlob(employeeToken);
      expect(res.status).to.equal(200);
      const users = res.body.teamMembersList.activeUserData.activeUsers;
      expect(users).to.be.an('array').with.length.greaterThan(0);
      users.forEach(user => {
         SENSITIVE_FIELDS.forEach(field => {
            expect(user, `user ${user.user_id} must not carry ${field}`).to.not.have.property(field);
         });
         // Non-sensitive directory fields must still be present — this is a
         // field-level strip, not a payload-shape change.
         expect(user).to.have.property('user_id');
         expect(user).to.have.property('display_name');
      });
   });

   it('an "admin" (privileged) caller still gets the full user rows, including cost_rate/billing_rate/email', async () => {
      const res = await fetchBlob(adminToken);
      expect(res.status).to.equal(200);
      const users = res.body.teamMembersList.activeUserData.activeUsers;
      expect(users).to.be.an('array').with.length.greaterThan(0);
      const withRates = users.filter(u => Object.prototype.hasOwnProperty.call(u, 'cost_rate'));
      expect(withRates.length, 'a privileged caller must still see cost_rate on at least one row').to.equal(users.length);
   });

   it('does not change the overall payload shape — every top-level list key is still present for both roles', async () => {
      const [employeeRes, adminRes] = await Promise.all([fetchBlob(employeeToken), fetchBlob(adminToken)]);
      const expectedKeys = [
         'customersList',
         'recurringCustomersList',
         'teamMembersList',
         'transactionsList',
         'invoicesList',
         'accountJobsList',
         'jobCategoriesList',
         'jobTypesList',
         'writeOffsList',
         'paymentsList',
         'accountRetainersList',
         'workDescriptionsList'
      ];
      expectedKeys.forEach(key => {
         expect(employeeRes.body, `employee response missing ${key}`).to.have.property(key);
         expect(adminRes.body, `admin response missing ${key}`).to.have.property(key);
      });
      // grid shape (columns/rows) is still derived the same way for both.
      expect(employeeRes.body.teamMembersList.activeUserData).to.have.property('grid');
      expect(employeeRes.body.teamMembersList.activeUserData.grid).to.have.property('columns');
      expect(employeeRes.body.teamMembersList.activeUserData.grid).to.have.property('rows');
   });
});
