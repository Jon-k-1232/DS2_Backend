const config = {
   NODE_PORT: process.env.NODE_ENV === 'production' ? process.env.NODE_PORT_PROD : process.env.NODE_PORT_DEV,
   NODE_ENV: process.env.NODE_ENV,
   FRONT_END_URL: process.env.NODE_ENV === 'production' ? process.env.FRONT_END_URL_PROD : process.env.FRONT_END_URL_DEV,
   DATABASE_HOST: process.env.NODE_ENV === 'production' ? process.env.DB_PROD_HOST : process.env.DB_DEV_HOST,
   HOST_IP: process.env.NODE_ENV === 'production' ? process.env.HOST_IP_PROD : process.env.HOST_IP_DEV,
   DATABASE_USER: process.env.DATABASE_USER,
   DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
   DATABASE_URL: process.env.DATABASE_NAME || (process.env.NODE_ENV === 'production' ? 'ds2_prod' : 'ds2_dev'),
   API_TOKEN: process.env.API_TOKEN,
   // JWT signing secret. Prefer JWT_SECRET (delivered via Secrets Manager);
   // fall back to the legacy API_TOKEN env for backward compatibility.
   JWT_SECRET: process.env.JWT_SECRET || process.env.API_TOKEN,
   JWT_EXPIRATION: process.env.JWT_EXPIRATION,
   GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
   GOOGLE_WORKSPACE_DOMAIN: process.env.GOOGLE_WORKSPACE_DOMAIN,
   CORS_ORIGIN: process.env.CORS_ORIGIN,
   FROM_EMAIL: process.env.FROM_EMAIL,
   S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
   S3_REGION: process.env.S3_REGION,
   S3_ENDPOINT: process.env.S3_ENDPOINT ? process.env.S3_ENDPOINT.replace(/\/+$/, '') : undefined,
   S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
   S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
   BEDROCK_REGION: process.env.BEDROCK_REGION || 'us-west-2',
   BEDROCK_MODEL_TIMETRACKER: process.env.BEDROCK_MODEL_TIMETRACKER || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
   BEDROCK_MODEL_TIMETRACKER_FAST: process.env.BEDROCK_MODEL_TIMETRACKER_FAST || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
   LLM_LOG_BUCKET: process.env.LLM_LOG_BUCKET || '',
   TIME_TRACKER_AI_FEATURE_FLAG: process.env.TIME_TRACKER_AI_FEATURE_FLAG || 'off',
   TIME_TRACKER_AI_TEST_ACCOUNT_IDS: process.env.TIME_TRACKER_AI_TEST_ACCOUNT_IDS || '',
   AUTO_INSERT_CONFIDENCE_THRESHOLD: Number(process.env.AUTO_INSERT_CONFIDENCE_THRESHOLD || 0.85)
};

// Fail fast on a missing/weak JWT signing secret. A short, low-entropy secret
// makes HS256 tokens forgeable (full auth bypass), so in production we refuse
// to boot. In dev/test we only warn so local runs aren't blocked.
const validateSecurityConfig = () => {
   const secret = config.JWT_SECRET || '';
   const tooWeak = secret.length < 32;
   if (tooWeak) {
      const message = `JWT signing secret is missing or too weak (length ${secret.length}; require >= 32 random chars). Set JWT_SECRET to a cryptographically-random value.`;
      if (config.NODE_ENV === 'production') {
         throw new Error(message);
      }
      console.warn(`[config] WARNING: ${message}`);
   }
};

module.exports = config;
module.exports.validateSecurityConfig = validateSecurityConfig;
