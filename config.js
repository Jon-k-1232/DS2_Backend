const config = {
   NODE_PORT: process.env.NODE_ENV === 'production' ? process.env.NODE_PORT_PROD : process.env.NODE_PORT_DEV,
   NODE_ENV: process.env.NODE_ENV,
   FRONT_END_URL: process.env.NODE_ENV === 'production' ? process.env.FRONT_END_URL_PROD : process.env.FRONT_END_URL_DEV,
   DATABASE_HOST: process.env.NODE_ENV === 'production' ? process.env.DB_PROD_HOST : process.env.DB_DEV_HOST,
   HOST_IP: process.env.NODE_ENV === 'production' ? process.env.HOST_IP_PROD : process.env.HOST_IP_DEV,
   DATABASE_USER: process.env.DATABASE_USER,
   DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
   DATABASE_URL: process.env.NODE_ENV === 'production' ? 'ds_2' : 'ds2_dev',
   // DATABASE_URL: process.env.NODE_ENV === 'production' ? 'ds2_dev' : 'ds_2',
   API_TOKEN: process.env.API_TOKEN,
   JWT_EXPIRATION: process.env.JWT_EXPIRATION,
   DOMAIN: process.env.DOMAIN,
   FROM_EMAIL: process.env.FROM_EMAIL,
   FROM_EMAIL_SMTP: process.env.FROM_EMAIL_SMTP,
   FROM_EMAIL_USERNAME: process.env.FROM_EMAIL_USERNAME,
   FROM_EMAIL_PASSWORD: process.env.FROM_EMAIL_PASSWORD,
   S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
   S3_REGION: process.env.S3_REGION,
   S3_ENDPOINT: process.env.S3_ENDPOINT ? process.env.S3_ENDPOINT.replace(/\/+$/, '') : undefined,
   S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
   S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY
};

module.exports = config;
