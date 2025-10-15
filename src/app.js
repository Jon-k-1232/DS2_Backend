require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const { NODE_ENV } = require('../config');
const app = express();
const automationOrchestrator = require('./automations/automationOrchestrator');
const customerRouter = require('./endpoints/customer/customer-router');
const transactions = require('./endpoints/transactions/transactions-router');
const user = require('./endpoints/user/user-router');
const company = require('./endpoints/job/job-router');
const invoices = require('./endpoints/invoice/invoice-router');
const authentication = require('./endpoints/auth/auth-router');
const jobCategoriesRouter = require('./endpoints/jobCategories/jobCategories-router');
const paymentsRouter = require('./endpoints/payments/payments-router');
const jobTypeRouter = require('./endpoints/jobType/jobType-router');
const quotesRouter = require('./endpoints/quotes/quotes-router');
const recurringCustomerRouter = require('./endpoints/recurringCustomer/recurringCustomer-router');
const accountRouter = require('./endpoints/account/account-router');
const retainerRouter = require('./endpoints/retainer/retainer-router');
const writeOffsRouter = require('./endpoints/writeOffs/writeOffs-router');
const initialDataRouter = require('./endpoints/initialData/initialData-router');
const workDescriptionsRouter = require('./endpoints/workDescriptions/workDescriptions-router');
const { healthRouter } = require('./endpoints/health/health-router');
const cookieParser = require('cookie-parser');
const { requireAuth } = require('./endpoints/auth/jwt-auth');
const timesheetsRouter = require('./endpoints/timesheets/timesheets-router');
const timeTrackingRouter = require('./endpoints/timeTracking/timeTracking-router');
const timeTrackerStaffRouter = require('./endpoints/timeTrackerStaff/timeTrackerStaff-router');

// Middleware
app.use(cookieParser());
app.use(
   morgan((tokens, req, res) => {
      const ipAddress = req.ip;
      const currentTime = new Date().toLocaleString();
      const responseTime = parseFloat(tokens['response-time'](req, res)).toFixed(3);
      const formattedResponseTime = responseTime.padStart(7, ' ').padEnd(10, '');
      const status = tokens.status(req, res);
      const method = tokens.method(req, res);
      const endpoint = tokens.url(req, res);
      return `[${currentTime}] - ${ipAddress} - ${method} - Status: ${status} - Response Time: ${formattedResponseTime}ms - ${endpoint}`;
   })
);
app.use(helmet());
app.use(express.json());
app.use(
   cors({
      origin: '*'
   })
);

/* ///////////////////////////\\\\  USER ENDPOINTS  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
app.use('/auth', authentication);
app.use('/customer', requireAuth, customerRouter);
app.use('/jobs', requireAuth, company);
app.use('/transactions', requireAuth, transactions);
// app.use('/transactions', transactions);
app.use('/user', requireAuth, user);
app.use('/invoices', requireAuth, invoices);
app.use('/jobCategories', requireAuth, jobCategoriesRouter);
app.use('/account', requireAuth, accountRouter);
app.use('/jobTypes', requireAuth, jobTypeRouter);
app.use('/quotes', requireAuth, quotesRouter);
app.use('/payments', requireAuth, paymentsRouter);
app.use('/recurringCustomer', requireAuth, recurringCustomerRouter);
app.use('/retainers', requireAuth, retainerRouter);
app.use('/writeOffs', requireAuth, writeOffsRouter);
app.use('/initialData', requireAuth, initialDataRouter);
app.use('/workDescriptions', requireAuth, workDescriptionsRouter);
app.use('/timesheets', timesheetsRouter);
app.use('/time-tracking', timeTrackingRouter);
app.use('/time-tracker-staff', requireAuth, timeTrackerStaffRouter);
app.use('/health', healthRouter);

/* ///////////////////////////\\\\  BACKGROUND JOBS  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
automationOrchestrator.scheduledAutomations();

/* ///////////////////////////\\\\  ERROR HANDLER  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
app.use((err, req, res, next) => {
   const statusCode = err.status || 500;
   const errorMessage = NODE_ENV === 'production' ? 'Server error' : err.message;

   console.error(err.stack); // Log the error stack (only in development)
   res.status(statusCode).json({
      message: errorMessage,
      ...(NODE_ENV !== 'production' && { error: err }) // Include full error details in development
   });
});

module.exports = app;
