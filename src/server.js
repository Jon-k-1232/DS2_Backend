const app = require('./app');
const db = require('./utils/db');
const { NODE_PORT, HOST_IP } = require('../config');

app.set('db', db);

app.listen(NODE_PORT, HOST_IP, () => {
   console.log(`Server listening at http://${HOST_IP}:${NODE_PORT}`);
});
