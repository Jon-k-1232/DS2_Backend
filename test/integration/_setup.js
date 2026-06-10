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
require('dotenv').config({ path: '.env.dev', override: false });

const fs = require('fs');
const path = require('path');
const knex = require('knex');

const TEST_ACCOUNT_ID = 9001;
const TEST_ADMIN_USER_ID = 90013;
const SEED_PATH = path.join(__dirname, '..', 'fixtures', 'seed.sql');

let _db = null;
const _connect = () => {
   if (_db) return _db;
   _db = knex({
      client: 'postgres',
      connection: {
         host: process.env.DB_DEV_HOST,
         user: process.env.DATABASE_USER,
         password: process.env.DATABASE_PASSWORD,
         database: process.env.DATABASE_NAME || 'ds2_dev',
         ssl: { rejectUnauthorized: false }
      },
      pool: { min: 0, max: 4, acquireTimeoutMillis: 5_000, idleTimeoutMillis: 1_000 }
   });
   return _db;
};

const requireDb = async function requireDb() {
   const db = _connect();
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
