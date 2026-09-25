const express = require('express');
const { clientSafeMessage } = require('../../utils/clientError');
const { enforceAccountId } = require('../auth/account-scope');
const billingReviewRouter = express.Router();
billingReviewRouter.param('accountID', enforceAccountId);
const asyncHandler = require('../../utils/asyncHandler');
const jsonParser = express.json();
const billingReviewService = require('./billingReview-service');
const { applyTransactionEdit, ERRORS } = require('./cascadeEdit');
const { kickOffAutoIngestForEntryIds, _isAccountAllowed: _isAutoIngestAllowed } = require('../timesheets/auto-ingest-runner');

const _statusCodeForCascadeError = code => {
   switch (code) {
      case ERRORS.NOT_FOUND:
         return 404;
      case 'SENT_INVOICE_LOCKED':
      case 'P0409':
      case ERRORS.INVOICE_LOCKED:
      case ERRORS.DATE_OUTSIDE_INVOICE:
      case ERRORS.RETAINER_NOT_EDITABLE_HERE:
      case ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM:
      case ERRORS.EDIT_WOULD_CREATE_CREDIT:
      case ERRORS.CONCURRENT_EDIT:
         return 409;
      case ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE:
      case ERRORS.INVALID_FIELD_VALUE:
         return 400;
      default:
         return 500;
   }
};

// Service-level error codes thrown by billingReview-service.
const SERVICE_ERROR_STATUS = Object.freeze({
   NOT_FOUND: 404,
   MISSING_FIELD: 400,
   INVALID_FIELD: 400,
   BAD_MODE: 400,
   ENTRY_ALREADY_APPLIED: 409,
   SENT_INVOICE_LOCKED: 409,
   P0409: 409
});

// Known (coded) errors carry messages we wrote for the reviewer; anything else
// is unexpected (knex/pg/driver) and must never reach the client verbatim.
const _errorBody = (err, status, fallback) =>
   status >= 500 ? { message: clientSafeMessage(err, fallback) } : { message: err.message, code: err.code };

const _logUnexpected = (label, err) => console.error(`[${new Date().toISOString()}] ${label} failed: ${err && err.message}`);

// GET /billing-review/distinct-entities/:accountID/:userID
// Returns the unique `entity` values (employer-of-record) for the account.
// Powers the Entity dropdown filter on the Billing Review tabs.
billingReviewRouter.route('/distinct-entities/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const entities = await billingReviewService.listDistinctEntities(db, accountId);
      res.status(200).json({ message: 'ok', entities });
   })
);

// GET /billing-review/earliest-unbilled-month/:accountID/:userID
// First of the month containing the oldest unbilled transaction (or first of
// current month if everything is billed). The Processed & Not Billed tab uses
// this as the default Start so reviewers always see the full unbilled window.
billingReviewRouter.route('/earliest-unbilled-month/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const start = await billingReviewService.earliestUnbilledMonth(db, accountId);
      res.status(200).json({ message: 'ok', start });
   })
);

// GET /billing-review/pending/:accountID/:userID — held rows + AI suggestions
billingReviewRouter.route('/pending/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const {
         hold_reason, timesheet_name,
         date_start, date_end,
         entity_contains, entity_equals,
         employee_contains, tracker_contains, notes_contains,
         ai_conf_min,
         customerId, employeeUserId, workDescId,
         sortField, sortDirection,
         page, limit
      } = req.query;
      // Validate pagination before it reaches SQL: `page=abc&limit=-3` used to
      // surface as a 500 from the driver instead of a 400.
      const pageNumber = page === undefined || page === '' ? 1 : Number(page);
      const limitNumber = limit === undefined || limit === '' ? 50 : Number(limit);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 500) {
         return res.status(400).json({ message: 'Invalid pagination parameters. page and limit must be positive integers (limit at most 500).' });
      }
      const result = await billingReviewService.listPendingHeldEntries(db, accountId, {
         holdReason: hold_reason || null,
         timesheetName: timesheet_name || null,
         dateStart: date_start || null,
         dateEnd: date_end || null,
         entityContains: entity_contains || null,
         entityEquals: entity_equals || null,
         employeeContains: employee_contains || null,
         trackerContains: tracker_contains || null,
         notesContains: notes_contains || null,
         aiConfMin: ai_conf_min != null && ai_conf_min !== '' ? Number(ai_conf_min) : null,
         customerId: customerId ? Number(customerId) : null,
         employeeUserId: employeeUserId ? Number(employeeUserId) : null,
         workDescId: workDescId ? Number(workDescId) : null,
         sortField: sortField || null,
         sortDirection: sortDirection || 'desc',
         page: pageNumber,
         limit: limitNumber
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
      // The actor is always the authenticated caller — never the URL
      // :userID, which a manager/admin can legitimately address as someone
      // else's id (enforceSelfOrPrivileged is not even registered on this
      // router's :userID) — so trusting it let the poster forge who applied
      // the entry.
      const userId = Number(req.user.user_id);
      const entryId = Number(req.params.entryID);

      try {
         const created = await billingReviewService.applyHeldEntry(db, accountId, entryId, req.body || {}, userId);
         res.status(200).json({ message: 'ok', transaction: created });
      } catch (err) {
         const status = SERVICE_ERROR_STATUS[err.code] || 500;
         if (status >= 500) _logUnexpected('applyHeldEntry', err);
         res.status(status).json({ ..._errorBody(err, status, 'The held entry could not be applied.'), field: err.field });
      }
   })
);

// GET /billing-review/weekly/:accountID/:userID?start=YYYY-MM-DD&end=YYYY-MM-DD
billingReviewRouter.route('/weekly/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const {
         start, end,
         customerId, employeeUserId, workDescId,
         jobContains, trackerContains, noteContains, entityContains, entityEquals,
         aiConfMin, billableOnly,
         unbilledOnly, aiOnly,
         sortField, sortDirection,
         page, limit
      } = req.query;
      if (!start || !end) {
         return res.status(400).json({ message: 'start and end query params are required (YYYY-MM-DD)' });
      }
      const isoRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!isoRe.test(start) || !isoRe.test(end)) {
         return res.status(400).json({ message: 'start and end must be YYYY-MM-DD format' });
      }
      const result = await billingReviewService.listConsolidatedTransactions(db, accountId, {
         startDate: start,
         endDate: end,
         customerId: customerId ? Number(customerId) : null,
         employeeUserId: employeeUserId ? Number(employeeUserId) : null,
         workDescId: workDescId ? Number(workDescId) : null,
         jobContains: jobContains || null,
         trackerContains: trackerContains || null,
         noteContains: noteContains || null,
         entityContains: entityContains || null,
         entityEquals: entityEquals || null,
         aiConfMin: aiConfMin != null && aiConfMin !== '' ? Number(aiConfMin) : null,
         billableOnly: billableOnly === 'true' ? true : billableOnly === 'false' ? false : null,
         unbilledOnly: unbilledOnly === 'true' || unbilledOnly === true,
         aiOnly: aiOnly === 'true' || aiOnly === true,
         sortField: sortField || null,
         sortDirection: sortDirection || 'desc',
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

// GET /billing-review/reprocess-count/:accountID/:userID?mode=unprocessed
// Cheap pre-flight: how many held rows would the reprocess button cover?
billingReviewRouter.route('/reprocess-count/:accountID/:userID').get(
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const mode = req.query.mode || 'unprocessed';
      try {
         const ids = await billingReviewService.listEntriesForReprocess(db, accountId, { mode, limit: 2000 });
         res.status(200).json({ message: 'ok', mode, count: ids.length, eligible: _isAutoIngestAllowed(accountId) });
      } catch (err) {
         const status = SERVICE_ERROR_STATUS[err.code] || 500;
         if (status >= 500) _logUnexpected('reprocess-count', err);
         res.status(status).json(_errorBody(err, status, 'Could not count entries to reprocess.'));
      }
   })
);

// POST /billing-review/reprocess/:accountID/:userID
// Body: { mode?: 'unprocessed' | 'errored' | 'all_held', batch_size?: 500 }
// Fires the Bedrock orchestrator for held timesheet_entries that haven't
// been through the new pipeline yet (legacy backlog or prior Bedrock errors).
// Rows that auto-insert leave the holding pool; rows that hold for a real
// reason remain visible in Needs Review. The endpoint returns immediately;
// the orchestrator runs in setImmediate.
billingReviewRouter.route('/reprocess/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.user.user_id); // authenticated actor, never the URL :userID
      const mode = (req.body && req.body.mode) || 'unprocessed';
      const batchSize = (req.body && Number(req.body.batch_size)) || 500;
      const explicitIds = Array.isArray(req.body?.ids) ? req.body.ids.map(n => Number(n)).filter(n => Number.isFinite(n)) : null;

      if (!_isAutoIngestAllowed(accountId)) {
         return res.status(503).json({
            message: 'Auto-ingest is not enabled for this account. Set TIME_TRACKER_AI_FEATURE_FLAG=test or on and add this account to TIME_TRACKER_AI_TEST_ACCOUNT_IDS to use this button.',
            code: 'flag_off'
         });
      }

      let entryIds;
      if (explicitIds && explicitIds.length) {
         entryIds = explicitIds;
      } else {
         try {
            entryIds = await billingReviewService.listEntriesForReprocess(db, accountId, { mode, limit: batchSize });
         } catch (err) {
            if (err.code === 'BAD_MODE') return res.status(400).json({ message: err.message, code: 'bad_mode' });
            _logUnexpected('reprocess', err);
            return res.status(500).json({ message: clientSafeMessage(err, 'Could not queue the reprocess job.') });
         }
      }

      if (!entryIds.length) {
         return res.status(200).json({ message: 'no entries match the reprocess criteria', queued: 0, mode });
      }

      kickOffAutoIngestForEntryIds({ db, accountId, userId, entryIds });
      return res.status(202).json({ message: 'reprocess job accepted', queued: entryIds.length, mode: explicitIds ? 'explicit_ids' : mode });
   })
);

// POST /billing-review/reprocess-with-overrides/:entryID/:accountID/:userID
// Body: { overrides: { customer_id?, customer_job_id?, general_work_description_id?,
//                      transaction_date?, logged_for_user_id?, duration_minutes? } }
// Re-runs the AI orchestrator on this entry with the reviewer's manual edits as
// trusted hints. Synchronous — returns the orchestrator outcome (auto_insert vs
// hold + reason) so the UI can show success or surface the new hold reason.
billingReviewRouter.route('/reprocess-with-overrides/:entryID/:accountID/:userID').post(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.user.user_id); // authenticated actor, never the URL :userID
      const entryId = Number(req.params.entryID);
      const overrides = (req.body && req.body.overrides) || {};

      if (!_isAutoIngestAllowed(accountId)) {
         return res.status(503).json({
            message: 'AI pipeline is not enabled for this account.',
            code: 'flag_off'
         });
      }

      try {
         const result = await billingReviewService.reprocessHeldEntryWithOverrides(db, accountId, entryId, overrides, userId);
         res.status(200).json({ message: 'ok', ...result });
      } catch (err) {
         const status = SERVICE_ERROR_STATUS[err.code] || 500;
         if (status >= 500) _logUnexpected('reprocessWithOverrides', err);
         res.status(status).json({
            ..._errorBody(err, status, 'An unexpected error occurred.'),
            ...(err.transactionId ? { transactionId: err.transactionId } : {}),
            decision: 'error'
         });
      }
   })
);

// PUT /billing-review/transaction/:transactionID/:accountID/:userID — cascade-aware edit
billingReviewRouter.route('/transaction/:transactionID/:accountID/:userID').put(
   jsonParser,
   asyncHandler(async (req, res) => {
      const db = req.app.get('db');
      const accountId = Number(req.params.accountID);
      const userId = Number(req.user.user_id); // authenticated actor, never the URL :userID
      const transactionId = Number(req.params.transactionID);
      const { updates = {}, confirmCustomerChange = false } = req.body || {};
      try {
         const result = await applyTransactionEdit({
            db,
            accountId,
            transactionId,
            updates,
            confirmCustomerChange: confirmCustomerChange === true || confirmCustomerChange === 'true',
            editingUserId: userId
         });
         res.status(200).json({ message: 'ok', ...result });
      } catch (err) {
         const status = _statusCodeForCascadeError(err.code);
         if (status >= 500) _logUnexpected('cascade transaction edit', err);
         res.status(status).json({
            ..._errorBody(err, status, 'The transaction could not be updated.'),
            invoiceId: err.invoiceId,
            ...(err.invoiceNumber ? { invoiceNumber: err.invoiceNumber } : {}),
            ...(err.field ? { field: err.field } : {})
         });
      }
   })
);

module.exports = billingReviewRouter;
