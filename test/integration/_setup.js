/**
 * Integration test bootstrap.
 *
 * Loads .env.dev (when present) so the dev DB is reachable. Exports a knex
 * instance and a TEST_ACCOUNT_ID. Tests that need DB access call
 * `requireDb()` in their `before` hook — if connectivity fails, the test
 * file is `skip()`ed rather than failing the whole suite. This keeps the
 * unit-test loop independent of network access while still letting the
 * integration suite run end-to-end against the dev DB locally.
 */
// DS2_ENV_FILE lets the suite target a different env file without editing this
// bootstrap. Default: the local Docker sandbox (.env.local) when it exists;
// otherwise .env.dev. Tests NEVER connect to a non-local database host unless
// DS2_TEST_ALLOW_REMOTE_DB=1 is set explicitly — the unit command only excludes
// test/integration/**, so the *.integration.spec.js files under test/endpoints
// used to reach the real dev RDS (and seed/delete fixture rows there) whenever
// DS2_ENV_FILE was unset.
const fs = require('fs');
const path = require('path');
const knex = require('knex');

const ENV_FILE = process.env.DS2_ENV_FILE || (fs.existsSync(path.join(__dirname, '..', '..', '.env.local')) ? '.env.local' : '.env.dev');
require('dotenv').config({ path: ENV_FILE, override: false });

const TEST_ACCOUNT_ID = 9001;
const TEST_ADMIN_USER_ID = 90013;
const SEED_PATH = path.join(__dirname, '..', 'fixtures', 'seed.sql');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'host.docker.internal']);
const isLocalHost = host => LOCAL_HOSTS.has(String(host || '').trim().toLowerCase());
const remoteDbAllowed = () => process.env.DS2_TEST_ALLOW_REMOTE_DB === '1';

let _db = null;
let _refusedOnce = false;
const _connect = () => {
   if (_db) return _db;
   if (!isLocalHost(process.env.DB_DEV_HOST) && !remoteDbAllowed()) {
      if (!_refusedOnce) {
         _refusedOnce = true;
         console.warn(`[test/_setup] refusing to connect to non-local DB host from ${ENV_FILE} (set DS2_ENV_FILE=.env.local for the sandbox, or DS2_TEST_ALLOW_REMOTE_DB=1 to override); DB-backed specs are skipped.`);
      }
      return null;
   }
   _db = knex({
      client: 'postgres',
      connection: {
         host: process.env.DB_DEV_HOST,
         port: Number(process.env.DB_DEV_PORT || 5432),
         user: process.env.DATABASE_USER,
         password: process.env.DATABASE_PASSWORD,
         database: process.env.DATABASE_NAME || 'ds2_dev',
         // Plain local Postgres (sandbox) has no TLS; RDS does.
         ssl: String(process.env.DB_SSL_DISABLE).toLowerCase() === 'true' ? false : { rejectUnauthorized: false }
      },
      pool: { min: 0, max: 4, acquireTimeoutMillis: 5_000, idleTimeoutMillis: 1_000 }
   });
   return _db;
};

const requireDb = async function requireDb() {
   const db = _connect();
   if (!db) {
      this.skip();
      return null;
   }
   try {
      await db.raw('SELECT 1');
      // A prod→dev restore wipes the fixture account and every integration
      // test then fails on FK violations. The seed is idempotent — re-apply
      // it whenever the account is missing.
      const { rows } = await db.raw('SELECT 1 FROM accounts WHERE account_id = ?', [TEST_ACCOUNT_ID]);
      if (!rows.length) {
         await db.raw(fs.readFileSync(SEED_PATH, 'utf8'));
      }
   } catch (e) {
      this.skip();
   }
   return db;
};

const cleanupTestData = async db => {
   try {
      await db.raw('SET session_replication_role = replica');
      await db('ai_call_log').where({ account_id: TEST_ACCOUNT_ID }).del();
      await db('notifications').where({ account_id: TEST_ACCOUNT_ID }).del();
      await db('template_downloads').where({ account_id: TEST_ACCOUNT_ID }).del();
      await db('ai_time_tracker_transaction_suggestions').where({ account_id: TEST_ACCOUNT_ID }).del();
      await db('customer_transactions').where({ account_id: TEST_ACCOUNT_ID }).del();
      await db('timesheet_entries').where({ account_id: TEST_ACCOUNT_ID }).del();
   } finally {
      await db.raw('SET session_replication_role = origin').catch(() => {});
   }
};

const closeDb = async () => {
   if (_db) {
      await _db.destroy();
      _db = null;
   }
};

module.exports = { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID };
