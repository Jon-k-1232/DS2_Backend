require('dotenv').config();
// Must be required before any router is required/mounted: it patches Express's
// route/router methods so a rejected promise inside an async handler is
// forwarded to next(err) automatically. Without this, an async handler that
// forgets try/catch throws an unhandled rejection on Node 20 and crashes the
// process instead of hitting the error-handling middleware below.
require('express-async-errors');
const auditContext = require('./utils/auditContext');
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
const { requireAuth, requireSuperAdmin, requireManagerOrAdmin } = require('./endpoints/auth/jwt-auth');
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
// Default express.json() limit is 100kb. A month-end "select all" invoice
// creation/billing-review payload (every outstanding customer + line detail)
// can approach that ceiling; raise it so legitimate large payloads aren't
// rejected with a 413 mid-billing-run.
app.use(express.json({ limit: '1mb' }));
app.use(auditContext.middleware);
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

// The API/expensive limiters are skipped under test, and on a LOCAL sandbox
// started with DISABLE_RATE_LIMIT=true: a full browser end-to-end run (70
// tests, one worker) issues far more than 300 requests a minute from one
// client and was failing on 429s. Never set this in a deployed environment —
// the auth limiter below is never skipped.
const rateLimitDisabled = String(process.env.DISABLE_RATE_LIMIT).toLowerCase() === 'true';
const skipRateLimit = () => NODE_ENV === 'test' || rateLimitDisabled;

// General throttle for all authenticated API traffic. Generous enough not to
// affect normal use, but caps abuse/scraping by a single client. Disabled under
// test so the suite isn't rate-limited.
const apiLimiter = rateLimit({
   windowMs: 60 * 1000,
   max: 300,
   standardHeaders: true,
   legacyHeaders: false,
   skip: skipRateLimit,
   message: { error: 'Too many requests, please slow down.', status: 429 }
});

// Tighter cap for endpoints that trigger Bedrock/Comprehend (real $ cost) or
// other heavy work, to bound cost-abuse and DoS from a single authenticated user.
const expensiveLimiter = rateLimit({
   windowMs: 60 * 1000,
   max: 30,
   standardHeaders: true,
   legacyHeaders: false,
   skip: skipRateLimit,
   message: { error: 'Too many requests for this resource, please slow down.', status: 429 }
});

app.use(apiLimiter);
app.use(require('./endpoints/invoice/sentInvoiceLocks').lockResponseMiddleware);
app.use('/auth', authLimiter, authentication);
app.use('/customer', requireAuth, customerRouter);
// The frontend wraps /transactions/*, /jobs/*, /customers/*, /invoices/* in
// ManagerAndAdminProtectedAccessRoute — plain 'User' staff only use
// time-tracking upload/history. Mirror that here on every router below whose
// UI lives behind that gate (jobs + its master-data siblings, transactions,
// payments, write-offs, retainers, pending-payments review, billing-review,
// time-tracker-staff); previously most of these had no server-side role
// check at all, so a plain employee token could reach them directly.
app.use('/jobs', requireAuth, requireManagerOrAdmin, company);
app.use('/transactions', requireAuth, requireManagerOrAdmin, transactions);
// app.use('/transactions', transactions);
app.use('/user', requireAuth, user);
// Every page under /invoices/* (invoices grid, quotes, createInvoice,
// accountsReceivable, invoice detail) is wrapped in ManagerAndAdminProtectedAccessRoute
// in the frontend (DS2_Frontend/src/Routes/PrimaryRouter.js) — mirror that here
// rather than leaving individual routes (e.g. createInvoice) ungated.
app.use('/invoices', requireAuth, requireManagerOrAdmin, invoices);
app.use('/jobCategories', requireAuth, requireManagerOrAdmin, jobCategoriesRouter);
app.use('/account', requireAuth, accountRouter);
app.use('/jobTypes', requireAuth, requireManagerOrAdmin, jobTypeRouter);
app.use('/quotes', requireAuth, requireManagerOrAdmin, quotesRouter);
app.use('/payments', requireAuth, requireManagerOrAdmin, paymentsRouter);
app.use('/recurringCustomer', requireAuth, recurringCustomerRouter);
app.use('/duplicates', requireAuth, requireManagerOrAdmin, require('./endpoints/duplicates/duplicates-router'));
app.use('/retainers', requireAuth, requireManagerOrAdmin, retainerRouter);
app.use('/writeOffs', requireAuth, requireManagerOrAdmin, writeOffsRouter);
app.use('/initialData', requireAuth, initialDataRouter);
app.use('/workDescriptions', requireAuth, requireManagerOrAdmin, workDescriptionsRouter);
app.use('/timesheets', requireAuth, timesheetsRouter);
app.use('/time-tracking', requireAuth, timeTrackingRouter);
app.use('/time-tracker-staff', requireAuth, requireManagerOrAdmin, timeTrackerStaffRouter);
app.use('/api/health', healthRouter);
app.use('/healthz', healthRouter); // AWS health check endpoint (no auth)
app.use('/ai-integration', requireAuth, expensiveLimiter, aiIntegrationRouter);
app.use('/pending-payments', requireAuth, requireManagerOrAdmin, pendingPaymentsRouter);
// Bedrock-backed mutations stay behind the expensive limiter; the GET list and
// poll routes (the Needs Review tab polls reprocess-count every few seconds)
// must not burn the 30-req/min budget or the tab freezes in 'Processing…'.
const limitMutationsOnly = (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : expensiveLimiter(req, res, next));
app.use('/billing-review', requireAuth, requireManagerOrAdmin, limitMutationsOnly, billingReviewRouter);
app.use('/notifications', requireAuth, notificationsRouter);
// NOTE: account-audit-router.js already does `.use(requireAuth, requireSuperAdmin)`
// internally (checked while reviewing this mount) — matches the frontend's
// AuditorProtectedAccessRoute (super-admin only), so no change needed here.
app.use('/accountAudit', requireAuth, limitMutationsOnly, accountAuditRouter);
// Deterministic hard record: Admin and Super Admin only. Separate from AI Audit.
app.use('/auditRecord', requireAuth, require('./endpoints/auditRecord/audit-record-router'));
// Accounts Receivable lives under /invoices/accountsReceivable in the frontend,
// inside the same ManagerAndAdminProtectedAccessRoute wrapper as the rest of
// the Invoices section.
app.use('/accountsReceivable', requireAuth, requireManagerOrAdmin, accountsReceivableRouter);
app.use('/analytics', requireAuth, requireSuperAdmin, analyticsRouter);

/* ///////////////////////////\\\\  BACKGROUND JOBS  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
if (NODE_ENV !== 'test') {
   automationOrchestrator.scheduledAutomations();
}

/* ///////////////////////////\\\\  ERROR HANDLER  ////\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*/
app.use((err, req, res, next) => {
   const statusCode = err.code === 'P0409' ? 409 : (err.statusCode || err.status || 500);
   if (err.code === 'P0409' || err.code === 'SENT_INVOICE_LOCKED') return res.status(409).send({ message: err.message, status: 409, code: 'SENT_INVOICE_LOCKED' });
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
