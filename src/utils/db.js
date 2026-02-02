const knex = require('knex');
const { DATABASE_URL, DATABASE_USER, DATABASE_PASSWORD, DATABASE_HOST } = require('../../config');

const db = knex({
   client: 'postgres',
   connection: {
      host: DATABASE_HOST,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      database: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
   },
   pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000
   }
});

module.exports = db;
