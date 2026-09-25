'use strict';

// Every scenario entry point imports this BEFORE importing the application or
// opening a connection. Environment overrides are validated, never replaced.
const path = require('path');
const root = path.resolve(__dirname, '../..');
require('dotenv').config({ path: process.env.DS2_ENV_FILE || path.join(root, '.env.scenarios') });

function assertScenarioEnvironment(env = process.env) {
   if (!['127.0.0.1', 'localhost'].includes(env.DB_DEV_HOST) || Number(env.DB_DEV_PORT) !== 5433 ||
       !/^ds2_scenarios[a-z0-9_]*$/.test(env.DATABASE_NAME || '') || env.DATABASE_URL || env.DB_PROD_HOST) {
      throw new Error('SCENARIO SAFETY: require loopback PostgreSQL :5433 and database ds2_scenarios*, without DATABASE_URL/DB_PROD_HOST.');
   }
   let endpoint;
   try { endpoint = new URL(env.S3_ENDPOINT); } catch (_) { /* fail closed below */ }
   if (!endpoint || endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.port !== '9000' ||
       !['ds2-clean', 'ds2-scenarios'].includes(env.S3_BUCKET_NAME)) {
      throw new Error('SCENARIO SAFETY: require local MinIO :9000 and ds2-clean/ds2-scenarios bucket.');
   }
   if (env.DATABASE_USER !== 'ds2') throw new Error('SCENARIO SAFETY: require sandbox ds2 user.');
}
assertScenarioEnvironment();

// Defense in depth: no DNS, AWS, metadata service, email or other external TCP
// destination can be reached from a scenario process, including optional AI.
const net = require('net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
   const first = Array.isArray(args[0]) ? args[0][0] : args[0];
   const host = typeof first === 'object' && first !== null ? first.host : (typeof args[1] === 'string' ? args[1] : undefined);
   if (host && !['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'].includes(host)) {
      throw new Error(`SCENARIO SAFETY: non-loopback network destination refused: ${host}`);
   }
   return connect.apply(this, args);
};
process.env.AWS_EC2_METADATA_DISABLED = 'true';
process.env.AWS_ACCESS_KEY_ID = 'scenario-offline';
process.env.AWS_SECRET_ACCESS_KEY = 'scenario-offline';
delete process.env.AWS_PROFILE;
process.env.NODE_ENV = 'test';
module.exports = { assertScenarioEnvironment, root };
