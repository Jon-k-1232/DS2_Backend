const config = {
   NODE_PORT: process.env.NODE_ENV === 'production' ? process.env.NODE_PORT_PROD : process.env.NODE_PORT_DEV,
   NODE_ENV: process.env.NODE_ENV,
   FRONT_END_URL: process.env.NODE_ENV === 'production' ? process.env.FRONT_END_URL_PROD : process.env.FRONT_END_URL_DEV,
   DATABASE_HOST: process.env.NODE_ENV === 'production' ? process.env.DB_PROD_HOST : process.env.DB_DEV_HOST,
   HOST_IP: process.env.NODE_ENV === 'production' ? process.env.HOST_IP_PROD : process.env.HOST_IP_DEV,
   DATABASE_USER: process.env.DATABASE_USER,
   DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
   DATABASE_URL: process.env.NODE_ENV === 'production' ? 'ds_2' : 'ds2_dev',
   TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://@localhost/ds_2',
   API_TOKEN: process.env.API_TOKEN,
   JWT_EXPIRATION: process.env.JWT_EXPIRATION,
   DEFAULT_PDF_SAVE_LOCATION: process.env.NODE_ENV === 'production' ? process.env.PRODUCTION_PDF_SAVE_LOCATION : process.env.DEVELOPMENT_PDF_SAVE_LOCATION
};

module.exports = config;
