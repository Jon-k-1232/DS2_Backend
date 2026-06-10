const app = require('./app');
const db = require('./utils/db');
const config = require('../config');
const { NODE_PORT, HOST_IP, NODE_ENV, DATABASE_URL, S3_BUCKET_NAME, TIME_TRACKER_AI_FEATURE_FLAG } = config;
const { checkConnectivity } = require('./utils/s3');
const { smokeTest: bedrockSmokeTest } = require('./ai_integrations/bedrock');

// Refuse to boot in production on a missing/weak JWT signing secret.
config.validateSecurityConfig();

app.set('db', db);

// IAM fail-fast: when the time-tracker AI feature is on (or in test mode),
// invoke a tiny Bedrock call at boot to verify InvokeModel + Comprehend
// permissions are present. A bad IAM grant fails opaquely at runtime; this
// log line surfaces it within seconds of startup.
if (TIME_TRACKER_AI_FEATURE_FLAG && TIME_TRACKER_AI_FEATURE_FLAG !== 'off') {
   bedrockSmokeTest({ db })
      .then(result => {
         console.log(`[bedrock] smoke test ok (model=${result.requestId ? 'reached' : 'unknown'} latency=${result.latencyMs}ms cost=$${(result.cost || 0).toFixed(6)})`);
      })
      .catch(err => {
         console.error(`[bedrock] BOOT SMOKE TEST FAILED: ${err.message} — auto-ingest will not work for accounts on the flag`);
      });
}

app.listen(NODE_PORT, HOST_IP, () => {
   console.log(`Server listening at http://${HOST_IP}:${NODE_PORT}`);
   console.log(`Environment = ${NODE_ENV || 'unknown'}`);
   checkConnectivity()
      .then(isConnected => {
         if (isConnected) {
            console.log(`S3 Bucket = ${S3_BUCKET_NAME || 'unknown'} (connected)`);
         } else {
            console.log('S3 Connectivity = false');
         }
      })
      .catch(error => {
         console.warn(`S3 connectivity check encountered an error: ${error.message}`);
         console.log('S3 Connectivity = false');
      });

   const dbTimeout = setTimeout(() => {
      console.warn('Database connectivity check timed out after 10 seconds.');
      console.log('Database Connectivity = false');
   }, 10000);

   db.raw('SELECT 1')
      .then(() => {
         clearTimeout(dbTimeout);
         console.log(`Database = ${DATABASE_URL} (connected)`);
      })
      .catch(error => {
         clearTimeout(dbTimeout);
         console.warn(`Database connectivity check failed: ${error.message}`);
         console.log('Database Connectivity = false');
      });
});
