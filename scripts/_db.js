/* eslint-disable no-console */
/*
   Shared knex factory for the diagnostic scripts.

   Default behaviour is unchanged (read .env.prod, connect to ds2_prod over TLS).
   Env overrides let the same scripts run against the local sandbox copy:

      DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js

   Honoured variables: DS2_ENV_FILE, DATABASE_NAME, DB_HOST, DB_DEV_PORT, DB_SSL_DISABLE.

   Host selection (2026-09 fix): this used to be `DB_HOST || DB_PROD_HOST || DB_DEV_HOST`,
   which silently preferred a PROD host over a DEV host whenever both happened to be present
   in process.env — e.g. a stray DB_PROD_HOST exported in the parent shell, or two scripts /
   test files sharing one Node process where an earlier makeDb() call left DB_PROD_HOST set
   (dotenv never overwrites an already-set process.env var, so that leftover value would
   silently survive into a later call meant for dev). A dev-targeted script or test could end
   up pointed at prod without ever passing a prod flag.

   Selection is now explicit and keyed off the RESOLVED env file (DS2_ENV_FILE, or the
   caller's `envFile`) rather than ambient process.env presence:
     1. process.env.DB_HOST — an explicit cross-cutting override, wherever it came from. Always wins.
     2. Otherwise, whichever single *_HOST variable the resolved env file itself defines, read
        straight off disk (DB_HOST, then DB_DEV_HOST, then DB_PROD_HOST) — never a blanket
        "prefer prod" fallback across whatever else happens to be in process.env. If a file
        somehow defined more than one, dev wins.
   There is no implicit fallback to a prod host, and (N3 fix, 2026-09 follow-up review) no
   implicit fallback to pg's own PGHOST/localhost default either: a file that defines neither
   DB_HOST nor DB_DEV_HOST nor DB_PROD_HOST (and no caller passed an explicit DB_HOST) used to
   resolve to `host: undefined` and was documented as "fails fast at connection time" — but it
   doesn't. node-postgres treats an undefined host as "not specified" and falls back to
   process.env.PGHOST, then to its own localhost default, so a hostless env file could silently
   connect to whatever ambient PGHOST happened to be set (config-probe.log: a synthetic
   PGHOST=billing-prod.example.invalid was never seen by looksLikeProd, since the guard only ever
   sees `host: undefined`, yet the connection would actually have gone to that host). makeDb()
   now throws synchronously instead of ever handing back a client configured with an undefined
   host — see the explicit check below.

   Second N3 fix: `dotenv.config({ path: resolvedPath })` used to run as a side effect of every
   call, mutating process.env for good. Harmless for host selection (which already read fileVars
   straight off disk, per the comment above) but NOT for DATABASE_USER/DATABASE_PASSWORD/
   DATABASE_NAME/DB_DEV_PORT/DB_SSL_DISABLE, which were read straight off process.env — and
   dotenv never overwrites an already-set var. So a second makeDb() call for a DIFFERENT env file
   later in the same process silently kept the FIRST file's values for any of those
   (config-probe.log's "two-file-calls" case: a second call naming its own DB_DEV_HOST/
   DATABASE_NAME/DATABASE_USER/DB_DEV_PORT still came back with the FIRST file's host, database,
   user and port). makeDb() no longer calls dotenv.config() at all; every field below is resolved
   through `value()`, which checks the real cross-cutting process.env override first (an
   explicit DB_HOST etc. a caller set on purpose) and otherwise reads straight from THIS call's
   own fileVars — never a value some earlier, unrelated call happened to leave behind.
*/
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const makeDb = ({ envFile = '.env.prod', database = 'ds2_prod', poolMax = 4 } = {}) => {
   const resolvedEnv = process.env.DS2_ENV_FILE || envFile;
   const resolvedPath = path.resolve(process.cwd(), resolvedEnv);

   // Parsed straight from the file (not process.env) so host selection below can't pick up a
   // value some earlier, unrelated makeDb() call left behind in this same process. No
   // dotenv.config() call here (N3 fix) — see the header comment: that used to mutate
   // process.env for every field below, not just host.
   const fileVars = fs.existsSync(resolvedPath) ? dotenv.parse(fs.readFileSync(resolvedPath)) : {};
   const value = key => process.env[key] || fileVars[key];

   const host = process.env.DB_HOST || fileVars.DB_HOST || fileVars.DB_DEV_HOST || fileVars.DB_PROD_HOST;
   // N3 fix: never let an undefined host reach the pg driver, which would silently resolve it
   // from PGHOST or localhost instead of failing — see the header comment.
   if (!host || !String(host).trim()) throw new Error(`No explicit database host in ${resolvedEnv}; refusing driver fallback to PGHOST/localhost`);
   const sslDisabled = String(value('DB_SSL_DISABLE')).toLowerCase() === 'true';

   const connection = {
      host,
      port: Number(value('DB_DEV_PORT') || 5432),
      user: value('DATABASE_USER'),
      password: value('DATABASE_PASSWORD'),
      database: value('DATABASE_NAME') || database,
      ssl: sslDisabled ? false : { rejectUnauthorized: false }
   };

   console.error(`[db] ${connection.user}@${connection.host}:${connection.port}/${connection.database} ssl=${sslDisabled ? 'off' : 'on'} (env ${resolvedEnv})`);

   return require('knex')({ client: 'pg', connection, pool: { min: 0, max: poolMax } });
};

module.exports = { makeDb };
