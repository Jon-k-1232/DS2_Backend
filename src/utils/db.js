const knex = require('knex');
const fs = require('fs');
const path = require('path');
const { DATABASE_URL, DATABASE_USER, DATABASE_PASSWORD, DATABASE_HOST } = require('../../config');

const DATABASE_PORT = Number(process.env.DB_DEV_PORT || 5432);

// TLS to Postgres/RDS. Previously this used rejectUnauthorized:false, which
// encrypts but does NOT verify the server certificate — leaving the connection
// open to MITM. We now pin the Amazon RDS CA bundle and verify the cert. A
// developer pointing at a plain local Postgres can opt out with DB_SSL_DISABLE=true.
const resolveDbSsl = () => {
   if (String(process.env.DB_SSL_DISABLE).toLowerCase() === 'true') {
      return false;
   }

   const caPath = process.env.DB_SSL_CA_PATH || path.join(__dirname, '..', '..', 'certs', 'rds-global-bundle.pem');
   let ca;
   try {
      ca = fs.readFileSync(caPath, 'utf8');
   } catch (err) {
      ca = undefined;
   }

   const rejectEnv = process.env.DB_SSL_REJECT_UNAUTHORIZED;
   const rejectUnauthorized = rejectEnv != null ? String(rejectEnv).toLowerCase() === 'true' : Boolean(ca);

   return ca ? { ca, rejectUnauthorized } : { rejectUnauthorized };
};

const db = knex({
   client: 'postgres',
   connection: {
      host: DATABASE_HOST,
      port: DATABASE_PORT,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      database: DATABASE_URL,
      ssl: resolveDbSsl()
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
