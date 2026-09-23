/**
 * Shared HTTP-level test harness for route coverage specs.
 *
 *   const { bootHttp, tokens, expectEnvelopeOk, uniqueName } = require('./_http');
 *   let h; before(async function () { h = await bootHttp.call(this); });
 *   after(() => h.close());
 *   const res = await h.as('admin').get('/jobs/getActiveCustomerJobs/9001/90013/900101');
 *
 * Runs the real Express app (src/app) against the sandbox DB selected by
 * DS2_ENV_FILE (.env.local) and mints real HS256 JWTs with the same secret the
 * app verifies. Identities (see test/fixtures/seed.sql):
 *   admin      → 90013 admin+test@example.com   (account 9001, access_level 'admin')
 *   employee   → 90011 eliza+test@example.com   (account 9001, access_level 'employee' = a plain User)
 *   superAdmin → 21    admin@jimkimmel.com       (account 1 — READ-ONLY use, never mutate account 1)
 *   stranger   → a token whose email is not provisioned (must be rejected with 401)
 *
 * Every spec must create its own rows with `uniqueName()` prefixes and delete
 * them in `after` — other suites run against the same sandbox concurrently, so
 * never assert on account-wide counts and never wipe account-wide tables.
 */
const jwt = require('jsonwebtoken');
const supertest = require('supertest');
const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');

const IDENTITIES = {
   admin: { user_id: 90013, email: 'admin+test@example.com', account_id: 9001 },
   employee: { user_id: 90011, email: 'eliza+test@example.com', account_id: 9001 },
   superAdmin: { user_id: 21, email: 'admin@jimkimmel.com', account_id: 1 },
   stranger: { user_id: 999999, email: 'nobody+test@example.com', account_id: 9001 }
};

const mint = (identity, overrides = {}) => {
   const secret = process.env.JWT_SECRET || process.env.API_TOKEN;
   if (!secret) throw new Error('JWT_SECRET missing — run with DS2_ENV_FILE=.env.local');
   const id = { ...IDENTITIES[identity], ...overrides };
   return jwt.sign({ user_id: id.user_id }, secret, { subject: id.email, expiresIn: overrides.expiresIn || '2h', algorithm: 'HS256' });
};

const tokens = () => Object.fromEntries(Object.keys(IDENTITIES).map(k => [k, mint(k)]));

let counter = 0;
const uniqueName = (prefix = 'COV') => `${prefix}-${process.pid}-${Date.now().toString(36)}-${(counter += 1)}`;

/**
 * Boot the app once per spec file. Call with `.call(this)` inside `before` so a
 * missing sandbox skips the file instead of failing the suite.
 */
async function bootHttp() {
   const db = await requireDb.call(this);
   // Keep the config the app already cached in sync with the env file (an earlier
   // spec may have required src/app before dotenv ran).
   const config = require('../../config');
   if (process.env.JWT_SECRET) config.JWT_SECRET = process.env.JWT_SECRET;
   const app = require('../../src/app');
   app.set('db', db);
   const request = supertest(app);
   const authed = identity => {
      const token = mint(identity);
      const wrap = method => (url) => request[method](url).set('Authorization', `Bearer ${token}`);
      return { get: wrap('get'), post: wrap('post'), put: wrap('put'), delete: wrap('delete'), token };
   };
   return {
      app,
      db,
      request,
      as: authed,
      anonymous: request,
      mint,
      accountID: TEST_ACCOUNT_ID,
      adminUserID: TEST_ADMIN_USER_ID,
      employeeUserID: IDENTITIES.employee.user_id,
      close: closeDb
   };
}

/** Many legacy routes answer HTTP 200 with `{ status: 500, message }` on failure. */
const expectEnvelopeOk = (res, label = 'request') => {
   if (res.status !== 200) throw new Error(`${label}: HTTP ${res.status} — ${JSON.stringify(res.body).slice(0, 300)}`);
   if (res.body && res.body.status !== undefined && Number(res.body.status) !== 200) {
      throw new Error(`${label}: body.status ${res.body.status} — ${res.body.message}`);
   }
   return res.body;
};

const expectEnvelopeRefused = (res, pattern, label = 'request') => {
   const status = res.body && res.body.status !== undefined ? Number(res.body.status) : res.status;
   if (status === 200) throw new Error(`${label}: expected a refusal but got success — ${JSON.stringify(res.body).slice(0, 300)}`);
   if (pattern && !pattern.test(String(res.body.message || res.body.error || ''))) {
      throw new Error(`${label}: refusal message "${res.body.message || res.body.error}" did not match ${pattern}`);
   }
   return res.body;
};

module.exports = { bootHttp, mint, tokens, uniqueName, expectEnvelopeOk, expectEnvelopeRefused, IDENTITIES };
