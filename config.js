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
   JWT_EXPIRATION: process.env.JWT_EXPIRATION,
   FROM_EMAIL: process.env.FROM_EMAIL,
   S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
   S3_REGION: process.env.S3_REGION,
   S3_ENDPOINT: process.env.S3_ENDPOINT ? process.env.S3_ENDPOINT.replace(/\/+$/, '') : undefined,
   S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
   S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
   OPENAI_API_BASE_URL: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com',
   // Optional: When set, the AI training uploader will submit sanitized examples
   // to this OpenAI Vector Store ID as files for retrieval-augmented generation.
   OPENAI_VECTOR_STORE_ID: process.env.OPENAI_VECTOR_STORE_ID || ''
};

module.exports = config;
