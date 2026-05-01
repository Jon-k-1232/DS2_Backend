const express = require('express');
const billingReviewRouter = express.Router();
const asyncHandler = require('../../utils/asyncHandler');
const jsonParser = express.json();
const billingReviewService = require('./billingReview-service');
const { applyTransactionEdit, ERRORS } = require('./cascadeEdit');

const _statusCodeForCascadeError = code => {
   switch (code) {
      case ERRORS.NOT_FOUND:
         return 404;
      case ERRORS.INVOICE_LOCKED:
      case ERRORS.DATE_OUTSIDE_INVOICE:
      case ERRORS.RETAINER_NOT_EDITABLE_HERE:
         return 409;
      case ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM:
         return 409;
      default:
         return 500;
   }
};

// GET /billing-review/pending/:accountID/:userID — held rows + AI suggestions
billingReviewRouter.route('/pending/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const { hold_reason, timesheet_name, page, limit } = req.query;
      const result = await billingReviewService.listPendingHeldEntries(db, accountId, {
         holdReason: hold_reason || null,
         timesheetName: timesheet_name || null,
         page: page || 1,
         limit: limit || 50
      });
      res.status(200).json({ message: 'ok', ...result });
   })
);

// PUT /billing-review/:entryID/:accountID/:userID — apply reviewer edits to a held row
billingReviewRouter.route('/:entryID/:accountID/:userID').put(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.params.userID);
      const entryId = Number(req.params.entryID);

      try {
         const created = await billingReviewService.applyHeldEntry(db, accountId, entryId, req.body || {}, userId);
         res.status(200).json({ message: 'ok', transaction: created });
      } catch (err) {
         const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'MISSING_FIELD' ? 400 : 500;
         console.error(`[${new Date().toISOString()}] applyHeldEntry failed: ${err.message}`);
         res.status(status).json({ message: err.message, code: err.code, field: err.field });
      }
   })
);

// GET /billing-review/weekly/:accountID/:userID?start=YYYY-MM-DD&end=YYYY-MM-DD
billingReviewRouter.route('/weekly/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const { start, end, customerId, employeeUserId, page, limit } = req.query;
      if (!start || !end) {
         return res.status(400).json({ message: 'start and end query params are required (YYYY-MM-DD)' });
      }
      const result = await billingReviewService.listConsolidatedTransactions(db, accountId, {
         startDate: start,
         endDate: end,
         customerId: customerId ? Number(customerId) : null,
         employeeUserId: employeeUserId ? Number(employeeUserId) : null,
         page: page || 1,
         limit: limit || 200
      });
      res.status(200).json({ message: 'ok', ...result });
   })
);

// GET /billing-review/pre-invoice/:accountID/:userID?customerId=&start=&end=
billingReviewRouter.route('/pre-invoice/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const { customerId, start, end } = req.query;
      if (!customerId || !start || !end) {
         return res.status(400).json({ message: 'customerId, start, end query params are all required' });
      }
      const list = await billingReviewService.listConsolidatedTransactions(db, accountId, {
         startDate: start,
         endDate: end,
         customerId: Number(customerId)
      });
      const anomaly = await billingReviewService.invoiceAnomalyCheck(db, accountId, {
         customerId: Number(customerId),
         periodStart: start,
         periodEnd: end
      });
      res.status(200).json({ message: 'ok', ...list, anomaly });
   })
);

// PUT /billing-review/transaction/:transactionID/:accountID/:userID — cascade-aware edit
billingReviewRouter.route('/transaction/:transactionID/:accountID/:userID').put(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.params.userID);
      const transactionId = Number(req.params.transactionID);
      const { updates = {}, confirmCustomerChange = false } = req.body || {};
      try {
         const result = await applyTransactionEdit({
            db,
            accountId,
            transactionId,
            updates,
            confirmCustomerChange,
            editingUserId: userId
         });
         res.status(200).json({ message: 'ok', ...result });
      } catch (err) {
         const status = _statusCodeForCascadeError(err.code);
         res.status(status).json({ message: err.message, code: err.code, invoiceId: err.invoiceId });
      }
   })
);

module.exports = billingReviewRouter;
