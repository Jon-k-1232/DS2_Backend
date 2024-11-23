const csvTimesheetProcessing = require('./csvTimesheetProcessing');
const schedule = require('node-schedule');

const startJobs = async () => {
   console.log(`[${new Date().toISOString()}] Scheduled job triggered.`);
   const timesheets = await csvTimesheetProcessing.processFiles();
   console.log(timesheets);
   // schedule.scheduleJob('59 23 * * 5', async () => {
   //    console.log(`[${new Date().toISOString()}] Scheduled job triggered.`);
   //    try {
   //       const timesheets = await csvTimesheetProcessing.processFiles();
   //       console.log(`[${new Date().toISOString()}] Scheduled job completed successfully.`);
   //    } catch (error) {
   //       console.error(`[${new Date().toISOString()}] Scheduled job failed: ${error.message}`);
   //    }
   // });
};

module.exports = {
   startJobs
};
