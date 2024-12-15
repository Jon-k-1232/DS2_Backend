const express = require('express');
const healthRouter = express.Router();
const os = require('os');
const si = require('systeminformation');
const healthService = require('./health-service');
const accountService = require('../account/account-service');
const fs = require('fs');
const { NODE_ENV } = require('../../../config');

// Provide basic server status to front end.
healthRouter.route('/status/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      // for memory
      const freeMemory = os.freemem() / (1024 * 1024);
      const totalMemory = os.totalmem() / (1024 * 1024);

      // for cpu
      const cpuData = await si.currentLoad();
      const cpuLoad = cpuData.currentLoad;

      // for file system
      const [data] = await accountService.getAccount(db, accountID);
      const filePath = data?.account_company_logo;

      const memory = {
         message: freeMemory > 100 ? 'UP' : 'DOWN',
         used: `${totalMemory.toFixed(2) - freeMemory.toFixed(2)}MB`,
         total: `${totalMemory.toFixed(2)}MB`
      };

      const cpu = {
         message: cpuLoad < 90 ? 'UP' : 'DOWN',
         load: `${cpuLoad.toFixed(2)}%`
      };

      const database = {
         message: healthService.dbStatus(db) ? 'UP' : 'DOWN'
      };

      const fileSystem = {
         message: fs.existsSync(filePath) ? 'UP' : 'DOWN'
      };

      const backendEnvironmentName = NODE_ENV;

      res.send({
         memory,
         cpu,
         database,
         fileSystem,
         backendEnvironmentName,
         message: 'UP',
         status: 200
      });
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while checking the app health.',
         status: 500
      });
   }
});

module.exports = { healthRouter };
