// When a sandbox env file is named (DS2_ENV_FILE=.env.local) load it FIRST so its
// S3/DB settings win over the placeholder defaults below — otherwise the finalize
// path in integration specs pointed at a non-existent bucket.
if (process.env.DS2_ENV_FILE) {
   require('dotenv').config({ path: process.env.DS2_ENV_FILE, override: false });
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
