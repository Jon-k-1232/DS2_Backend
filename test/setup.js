// When a sandbox env file is named (DS2_ENV_FILE=.env.local) load it FIRST so its
// S3/DB settings win over the placeholder defaults below — otherwise the finalize
// path in integration specs pointed at a non-existent bucket.
if (process.env.DS2_ENV_FILE) {
   require('dotenv').config({ path: process.env.DS2_ENV_FILE, override: false });
}
// These existing specs exercise account provisioning, which necessarily writes
// accounts other than fixture 9001. The owner's ds2_local allowance is limited
// to that fixture, so enforce the clean-room target even for the standard
// DS2_ENV_FILE=.env.local single-file integration command.
const provisioningSpecs = new Set([
   'coverage-account-users-auth-misc.integration.spec.js',
   'review-account-atomicity.integration.spec.js'
]);
if (process.argv.some(arg => provisioningSpecs.has(require('path').basename(arg)))) {
   if (!['127.0.0.1','localhost','::1'].includes(process.env.DB_DEV_HOST) || Number(process.env.DB_DEV_PORT) !== 5433) {
      throw new Error('Account provisioning tests require local PostgreSQL on port 5433.');
   }
   process.env.DATABASE_NAME = 'ds2_clean';
}
// Always run the app in test mode: the sandbox env file says NODE_ENV=development,
// which would arm the rate limiters (cascading 429s when several specs share a
// process) and start the scheduled reminder jobs inside mocha. config.js only
// branches on 'production', so DB/S3 settings from the env file are unaffected.
process.env.NODE_ENV = 'test';
process.env.S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'test-bucket';
process.env.S3_REGION = process.env.S3_REGION || 'us-east-1';
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost';
process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || 'test-key';
process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || 'test-secret';

const { expect } = require('chai');
const supertest = require('supertest');

global.expect = expect;
global.supertest = supertest;

// Owner sandbox rule: test processes can never reach AWS or another remote host.
const net = require('net');
const testConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
   const first = Array.isArray(args[0]) ? args[0][0] : args[0];
   const host = typeof first === 'object' && first !== null ? first.host : (typeof args[1] === 'string' ? args[1] : undefined);
   if (host && !['127.0.0.1','localhost','::1','::ffff:127.0.0.1'].includes(host)) throw new Error(`TEST SAFETY: remote network refused: ${host}`);
   return testConnect.apply(this,args);
};
process.env.AWS_EC2_METADATA_DISABLED = 'true';
