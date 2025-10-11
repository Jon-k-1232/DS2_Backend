const app = require('./app');
const db = require('./utils/db');
const { NODE_PORT, HOST_IP, NODE_ENV, DATABASE_URL } = require('../config');
const { checkConnectivity } = require('./utils/s3');

app.set('db', db);

app.listen(NODE_PORT, HOST_IP, () => {
   console.log(`Server listening at http://${HOST_IP}:${NODE_PORT}`);
   console.log(`Environment = ${NODE_ENV || 'unknown'}`);
   console.log(`Database = ${DATABASE_URL}`);
   checkConnectivity()
      .then(isConnected => {
         console.log(`S3 Connectivity = ${isConnected}`);
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
         console.log('Database Connectivity = true');
      })
      .catch(error => {
         clearTimeout(dbTimeout);
         console.warn(`Database connectivity check failed: ${error.message}`);
         console.log('Database Connectivity = false');
      });
});
