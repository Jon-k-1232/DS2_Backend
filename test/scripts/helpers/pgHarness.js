/* eslint-disable no-console */
/**
 * Shared throwaway-Postgres helpers for scripts/** tests (the migration runner, migration 019,
 * the payment-repair transaction). Every throwaway database is named ds2_mig_test_* per the
 * sandbox rules in this session, built fresh from migrations/schema-snapshot-2026-09-22.sql,
 * and dropped when the spec finishes — nothing here ever reads or writes ds2_local or ds2_clean.
 *
 * Uses the plain `psql`/`createdb`/`dropdb` CLIs (must be on PATH) rather than a pg client
 * library, because CREATE DATABASE / DROP DATABASE cannot run inside a transaction or a pooled
 * connection — this is exactly how a human would set one up by hand.
 *
 * Connection defaults are DELIBERATELY not read from DB_DEV_HOST/DATABASE_USER/
 * DATABASE_PASSWORD: several test/endpoints/**\/*.integration.spec.js files (outside
 * test/integration/, so `--exclude 'test/integration/**'` doesn't catch them) require
 * test/integration/_setup.js, whose top-level `dotenv.config({ path: '.env.dev' })` loads the
 * REAL RDS dev host into exactly those variable names as a require-time side effect — this file
 * would silently inherit real credentials instead of the sandbox's the moment mocha's file
 * discovery happens to require one of those before this one. Use PGHARNESS_* (a name nothing
 * else in this codebase sets) to override for a different sandbox; otherwise these are the fixed
 * local sandbox values from the task environment.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const HOST = process.env.PGHARNESS_HOST || '127.0.0.1';
const PORT = process.env.PGHARNESS_PORT || '5433';
const USER = process.env.PGHARNESS_USER || 'ds2';
const PASSWORD = process.env.PGHARNESS_PASSWORD || 'ds2local';
const SCHEMA_SNAPSHOT = path.join(__dirname, '..', '..', '..', 'migrations', 'schema-snapshot-2026-09-22.sql');

const PG_ENV = Object.assign({}, process.env, { PGPASSWORD: PASSWORD });

const run = (bin, args) => execFileSync(bin, args, { env: PG_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

const CONN_ARGS = ['-h', HOST, '-p', String(PORT), '-U', USER];

/** True when the sandbox Postgres + psql client tools are reachable. Spec files skip() otherwise
 *  (same convention as test/integration/_setup.js's requireDb) rather than failing outright. */
const isAvailable = () => {
   try {
      run('psql', [...CONN_ARGS, '-d', 'postgres', '-c', 'SELECT 1']);
      return true;
   } catch (e) {
      if (process.env.PGHARNESS_DEBUG) console.error('[pgHarness] isAvailable() failed:', e.message, e.stderr && e.stderr.toString());
      return false;
   }
};

const assertThrowawayName = name => {
   if (!/^ds2_mig_test_[a-z0-9_]+$/.test(name)) {
      throw new Error(`Refusing a non-throwaway database name: "${name}" (must start with ds2_mig_test_)`);
   }
};

/** Drop (if present) and recreate `name` from the schema snapshot. Safe to call more than once. */
const createThrowawayDb = name => {
   assertThrowawayName(name);
   run('dropdb', [...CONN_ARGS, '--if-exists', name]);
   run('createdb', [...CONN_ARGS, name]);
   run('psql', [...CONN_ARGS, '-d', name, '-v', 'ON_ERROR_STOP=1', '-q', '-f', SCHEMA_SNAPSHOT]);
   return name;
};

const dropDb = name => {
   assertThrowawayName(name);
   run('dropdb', [...CONN_ARGS, '--if-exists', name]);
};

/** Apply a raw .sql file to `name` via `psql -f` — used for migration files (handles psql
 *  meta-commands / \restrict the same way a by-hand application would; a knex/pg client
 *  wouldn't). Returns stdout. */
const psqlFile = (name, file, extraArgs = []) => {
   assertThrowawayName(name);
   return run('psql', [...CONN_ARGS, '-d', name, ...extraArgs, '-f', file]).toString('utf8');
};

const knexFor = name => {
   assertThrowawayName(name);
   return require('knex')({
      client: 'pg',
      connection: { host: HOST, port: Number(PORT), user: USER, password: PASSWORD, database: name, ssl: false },
      pool: { min: 0, max: 5 }
   });
};

module.exports = { HOST, PORT, USER, PASSWORD, isAvailable, createThrowawayDb, dropDb, psqlFile, knexFor, SCHEMA_SNAPSHOT, assertThrowawayName };
