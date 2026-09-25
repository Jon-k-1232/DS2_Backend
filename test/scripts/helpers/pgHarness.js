// Owner decision run: logical fixture names map to ds2_clean. Tests are serial.
// Reset only this explicitly authorized clean-room database; never create/drop databases.
/* eslint-disable no-console */
/** Migration tests serialize through the authorized ds2_clean sandbox only.
 * Logical names identify test cases, not databases. Each case rebuilds public
 * schema; teardown restores the migrated clean-room seed. No production,
 * reference database or ds2_local account-1 writes are permitted.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const DATABASE = 'ds2_clean';

const HOST = process.env.PGHARNESS_HOST || '127.0.0.1';
const PORT = process.env.PGHARNESS_PORT || '5433';
const USER = process.env.PGHARNESS_USER || 'ds2';
const PASSWORD = process.env.PGHARNESS_PASSWORD || 'ds2local';
const SCHEMA_SNAPSHOT = path.join(__dirname, '..', '..', '..', 'migrations', 'schema-snapshot-2026-09-22.sql');

if (HOST !== '127.0.0.1' || Number(PORT) !== 5433 || USER !== 'ds2') throw new Error('Migration tests require the authorized local sandbox.');

const PG_ENV = Object.assign({}, process.env, { PGPASSWORD: PASSWORD });

const run = (bin, args) => execFileSync(bin, args, { env: PG_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

const CONN_ARGS = ['-h', HOST, '-p', String(PORT), '-U', USER];

/** True when the sandbox Postgres + psql client tools are reachable. Spec files skip() otherwise
 *  (same convention as test/integration/_setup.js's requireDb) rather than failing outright. */
const isAvailable = () => {
   try {
      run('psql', [...CONN_ARGS, '-d', DATABASE, '-c', 'SELECT 1']);
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
   run('psql', [...CONN_ARGS, '-d', DATABASE, '-X', '-1', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
   run('psql', [...CONN_ARGS, '-d', DATABASE, '-X', '-1', '-v', 'ON_ERROR_STOP=1', '-q', '-f', SCHEMA_SNAPSHOT]);
   return name;
};

const dropDb = name => {
   assertThrowawayName(name);
   createThrowawayDb(name);
   const dir = path.dirname(SCHEMA_SNAPSHOT);
   for (const f of fs.readdirSync(dir).filter(f => /^\d{3}\./.test(f) && Number(f.slice(0,3)) > 18).sort()) psqlFile(name, path.join(dir,f), ['-X','-1','-v','ON_ERROR_STOP=1']);
   psqlFile(name, path.join(__dirname,'../../fixtures/clean-room-seed.sql'), ['-X','-1','-v','ON_ERROR_STOP=1']);
};

/** Apply a raw .sql file to `name` via `psql -f` — used for migration files (handles psql
 *  meta-commands / \restrict the same way a by-hand application would; a knex/pg client
 *  wouldn't). Returns stdout. */
const psqlFile = (name, file, extraArgs = []) => {
   assertThrowawayName(name);
   return run('psql', [...CONN_ARGS, '-d', DATABASE, ...extraArgs, '-f', file]).toString('utf8');
};

const knexFor = name => {
   assertThrowawayName(name);
   return require('knex')({
      client: 'pg',
      connection: { host: HOST, port: Number(PORT), user: USER, password: PASSWORD, database: DATABASE, ssl: false },
      pool: { min: 0, max: 5 }
   });
};

module.exports = { DATABASE, HOST, PORT, USER, PASSWORD, isAvailable, createThrowawayDb, dropDb, psqlFile, knexFor, SCHEMA_SNAPSHOT, assertThrowawayName };
