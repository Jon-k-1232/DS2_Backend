/*
 * Config for `postgrator` (invoked via the "migrate" npm script:
 * `postgrator --config postgrator-config.js`).
 *
 * postgrator-cli v7 / postgrator v7 read this file as a plain object and use
 * it purely to supply *defaults* for their own CLI options — see
 * node_modules/postgrator-cli/lib/command-line-options.js (option
 * definitions: driver, host, port, database, username, password,
 * migration-pattern, schema-table, validate-checksum, ssl) and
 * node_modules/postgrator-cli/lib/postgrator-cli.js (getPostgratorOptions /
 * getClientOptions, which read those exact keys off this object — camelCase
 * `migrationPattern`, not `migrationDirectory`; `username`, not `user`).
 * There is no `connectionString` option in v7 — postgrator-cli builds the pg
 * connection field-by-field — so the previous `migrationDirectory` /
 * `connectionString` keys here were silently ignored, and the
 * "migrate": "postgrator --config postgrator-config.js --migration-directory
 * migrations" script additionally passed a CLI flag
 * (--migration-directory) that doesn't exist at all in v7 and made every
 * invocation throw UNKNOWN_OPTION before it got anywhere near the database.
 *
 * Migration file naming: postgrator requires
 * "<version>.<do|undo>.<description>.sql" (node_modules/postgrator/postgrator.js
 * getMigrations() splits the basename on "." and only treats a file as
 * runnable when the 2nd segment is literally "do"/"undo"). This repo's
 * migrations/NNN.description.sql files don't have that segment, so even with
 * this file fixed, postgrator parses them, sees 0 files whose action === "do",
 * and completes "successfully" having applied nothing — see
 * migrations/README.md. Fixing that needs either renaming the migration
 * files (out of scope for this pass — see the review notes) or applying them
 * by hand as today. This file only fixes what's fixable at the config layer:
 * the crash on load, the dead connection settings, and a hard refusal to ever
 * point at ds2_prod.
 *
 * Env: loads process.env.DS2_ENV_FILE || '.env.dev' (so plain `npm run
 * migrate` defaults to dev, never prod) and reads connection settings from
 * DB_DEV_HOST / DB_DEV_PORT / DATABASE_USER / DATABASE_PASSWORD /
 * DATABASE_NAME / DB_SSL_DISABLE — the same variables src/utils/db.js and
 * scripts/_db.js use. DB_PROD_HOST is intentionally never read here: this
 * tool has no code path to a prod host at all, on top of the DATABASE_NAME
 * guard below.
 */
const path = require('path');

require('dotenv').config({
   path: path.resolve(process.cwd(), process.env.DS2_ENV_FILE || '.env.dev')
});

const databaseName = process.env.DATABASE_NAME || '';

// Prod has no postgrator schemaversion tracking and is migrated by hand
// (psql -d ds2_prod -f migrations/NNN....sql — see migrations/README.md and
// the "Apply prod migrations by hand" note). Refuse outright rather than let
// a wrong env file / stray DATABASE_NAME touch it.
if (databaseName === 'ds2_prod') {
   throw new Error(
      'postgrator-config.js: refusing to run against DATABASE_NAME=ds2_prod. ' +
      'Prod is migrated by hand (psql -d ds2_prod -f migrations/NNN....sql), never via `npm run migrate`. ' +
      'See DS2_Backend/migrations/README.md.'
   );
}

const sslDisabled = String(process.env.DB_SSL_DISABLE).toLowerCase() === 'true';

module.exports = {
   migrationPattern: 'migrations/*',
   driver: 'pg',
   host: process.env.DB_DEV_HOST,
   port: Number(process.env.DB_DEV_PORT || 5432),
   database: databaseName,
   username: process.env.DATABASE_USER,
   password: process.env.DATABASE_PASSWORD,
   ssl: sslDisabled ? false : { rejectUnauthorized: false }
};
