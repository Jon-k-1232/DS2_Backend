const { sendEmail } = require('./sendEmail');

// Send final summary email
const sendFinalSummaryEmailForAutomation = async (timesheetsProcessedSuccessfully, timesheetsWithErrors, automationName) => {
   try {
      await sendEmail({
         body: `DS2 Automation has been completed on your account.\n\nAutomation Name: ${automationName}\n\nTimesheets Processed Successfully: ${timesheetsProcessedSuccessfully}\n\nTimesheets With Errors: ${timesheetsWithErrors}`,
         subject: `DS2 Automation Summary`
      });
      console.log(`[${new Date().toISOString()}] Sent final summary email.`);
   } catch (emailErr) {
      console.error(`[${new Date().toISOString()}] Failed to send final summary email: ${emailErr.message}`);
   }
};

module.exports = { sendFinalSummaryEmailForAutomation };
