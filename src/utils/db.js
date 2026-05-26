const knex = require('knex');
const { DATABASE_URL, DATABASE_USER, DATABASE_PASSWORD, DATABASE_HOST } = require('../../config');

const DATABASE_PORT = Number(process.env.DB_DEV_PORT || 5432);

const db = knex({
   client: 'postgres',
   connection: {
      host: DATABASE_HOST,
      port: DATABASE_PORT,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      database: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
   },
   pool: {
      min: 2,
      // Bumped from 10 to 20 to keep pace with auto-ingest concurrency.
      // Each in-flight orchestrator row holds ~1 connection during its
      // db.transaction; with AUTO_INGEST_CONCURRENCY=8 that leaves ~12
      // connections free for normal request handling. Postgres
      // max_connections=181 has plenty more headroom if we need to push.
      max: Number(process.env.PG_POOL_MAX || 20),
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000
   }
});

module.exports = db;
