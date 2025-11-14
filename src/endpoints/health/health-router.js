const express = require('express');
const healthRouter = express.Router();
const os = require('os');
const si = require('systeminformation');
const healthService = require('./health-service');
const { checkConnectivity } = require('../../utils/s3');
const { NODE_ENV } = require('../../../config');
const timeTrackerStaffService = require('../timeTrackerStaff/timeTrackerStaff-service');
const { sendEmail } = require('../../utils/email/sendEmail');

const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const HEALTH_ALERT_CACHE = new Map();

// Simple health check for AWS ECS/ALB
healthRouter.get('/check', (req, res) => {
   res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Provide basic server status to front end.
healthRouter.route('/backend/stats/:accountID/:userID').get(async (req, res) => {
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
      const s3Connected = await checkConnectivity();

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
         message: s3Connected ? 'UP' : 'DOWN'
      };

      const backendEnvironmentName = NODE_ENV;
      const serviceStatuses = [
         { name: 'Memory', status: memory },
         { name: 'CPU', status: cpu },
         { name: 'Database', status: database },
         { name: 'File System', status: fileSystem }
      ];

      const issues = serviceStatuses.filter(service => service.status.message !== 'UP');

      if (issues.length) {
         const isProduction = NODE_ENV === 'production';
         const cacheKey = `${accountID}`;
         const now = Date.now();
         const signature = issues.map(issue => `${issue.name}:${issue.status.message}`).join('|');
         const lastEntry = HEALTH_ALERT_CACHE.get(cacheKey) || { timestamp: 0, signature: '' };

         if (now - lastEntry.timestamp > ALERT_COOLDOWN_MS || lastEntry.signature !== signature) {
            if (!isProduction) {
               console.warn(`[${new Date().toISOString()}] Health issue(s) detected in ${NODE_ENV} for account ${accountID}. Skipping email alerts in non-production environments.`);
            } else {
               try {
                  const staffRecords = await timeTrackerStaffService.listActiveEmailsByAccount(db, Number(accountID));
                  const recipientEmails = (staffRecords || []).map(record => record.email).filter(Boolean);

                  if (recipientEmails.length) {
                     const subject = `DS2 Health Alert: ${issues.map(issue => issue.name).join(', ')} issue(s) detected`;
                     const bodyLines = [
                        `The DS2 health check detected issue(s) for account ${accountID} at ${new Date().toLocaleString()}.`,
                        '',
                        'Status summary:',
                        ...serviceStatuses.map(service => ` - ${service.name}: ${service.status.message}`)
                     ];

                     await sendEmail({
                        recipientEmails,
                        subject,
                        body: bodyLines.join('\n')
                     });
                  } else {
                     console.warn(`[${new Date().toISOString()}] Health alert detected for account ${accountID} but no active time tracker staff emails were found.`);
                  }
               } catch (emailError) {
                  console.error(`[${new Date().toISOString()}] Failed to send health alert email for account ${accountID}: ${emailError.message}`);
               }
            }

            HEALTH_ALERT_CACHE.set(cacheKey, { timestamp: now, signature });
         }
      }

      res.send({
         memory,
         cpu,
         database,
         fileSystem,
         backendEnvironmentName,
         message: issues.length ? 'DEGRADED' : 'UP',
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
