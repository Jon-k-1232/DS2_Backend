require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { NODE_ENV, CORS_ORIGIN } = require('../config');
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
const { requireAuth, requireSuperAdmin } = require('./endpoints/auth/jwt-auth');
const timesheetsRouter = require('./endpoints/timesheets/timesheets-router');
const timeTrackingRouter = require('./endpoints/timeTracking/timeTracking-router');
const timeTrackerStaffRouter = require('./endpoints/timeTrackerStaff/timeTrackerStaff-router');
const aiIntegrationRouter = require('./endpoints/aiIntegration/aiIntegration-router');
const pendingPaymentsRouter = require('./endpoints/pendingPayments/pendingPayments-router');
const billingReviewRouter = require('./endpoints/billingReview/billingReview-router');
const notificationsRouter = require('./endpoints/notifications/notifications-router');
const accountAuditRouter = require('./endpoints/accountAudit/account-audit-router');
const accountsReceivableRouter = require('./endpoints/accountsReceivable/accounts-receivable-router');
const analyticsRouter = require('./endpoints/analytics/analytics-router');

// Behind one reverse proxy (nginx). Trusting exactly one hop lets express-rate-limit
// and req.ip see the real client IP from X-Forwarded-For without being spoofable
// beyond the proxy.
app.set('trust proxy', 1);

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
const corsOrigins = (CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(
   cors({
      origin: corsOrigins.length ? corsOrigins : false,
      credentials: true
   })
);

/* ///////////////////////////\\\\  USER ENDPOINTS  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
// Auth endpoints are rate-limited to mitigate brute-force credential probing.
const authLimiter = rateLimit({
   windowMs: 15 * 60 * 1000,
   max: 30,
   standardHeaders: true,
   legacyHeaders: false,
   message: { error: 'Too many auth requests, please try again later.', status: 429 }
});

// General throttle for all authenticated API traffic. Generous enough not to
// affect normal use, but caps abuse/scraping by a single client. Disabled under
// test so the suite isn't rate-limited.
const apiLimiter = rateLimit({
   windowMs: 60 * 1000,
   max: 300,
   standardHeaders: true,
   legacyHeaders: false,
   skip: () => NODE_ENV === 'test',
   message: { error: 'Too many requests, please slow down.', status: 429 }
});

// Tighter cap for endpoints that trigger Bedrock/Comprehend (real $ cost) or
// other heavy work, to bound cost-abuse and DoS from a single authenticated user.
const expensiveLimiter = rateLimit({
   windowMs: 60 * 1000,
   max: 30,
   standardHeaders: true,
   legacyHeaders: false,
   skip: () => NODE_ENV === 'test',
   message: { error: 'Too many requests for this resource, please slow down.', status: 429 }
});

app.use(apiLimiter);
app.use('/auth', authLimiter, authentication);
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
app.use('/timesheets', requireAuth, timesheetsRouter);
app.use('/time-tracking', requireAuth, timeTrackingRouter);
app.use('/time-tracker-staff', requireAuth, timeTrackerStaffRouter);
app.use('/api/health', healthRouter);
app.use('/healthz', healthRouter); // AWS health check endpoint (no auth)
app.use('/ai-integration', requireAuth, expensiveLimiter, aiIntegrationRouter);
app.use('/pending-payments', requireAuth, pendingPaymentsRouter);
app.use('/billing-review', requireAuth, expensiveLimiter, billingReviewRouter);
app.use('/notifications', requireAuth, notificationsRouter);
app.use('/accountAudit', requireAuth, expensiveLimiter, accountAuditRouter);
app.use('/accountsReceivable', requireAuth, accountsReceivableRouter);
app.use('/analytics', requireAuth, requireSuperAdmin, analyticsRouter);

/* ///////////////////////////\\\\  BACKGROUND JOBS  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
if (NODE_ENV !== 'test') {
   automationOrchestrator.scheduledAutomations();
}

/* ///////////////////////////\\\\  ERROR HANDLER  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
app.use((err, req, res, next) => {
   const statusCode = err.status || 500;
   const errorMessage = NODE_ENV === 'production' ? 'Server error' : err.message;

   if (NODE_ENV === 'production') {
      // Log compact info in prod to avoid leaking implementation details into shared logs
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${statusCode}: ${err.message || 'unknown'}`);
   } else {
      console.error(err.stack);
   }

   res.status(statusCode).json({
      message: errorMessage,
      ...(NODE_ENV !== 'production' && { error: err })
   });
});

module.exports = app;
