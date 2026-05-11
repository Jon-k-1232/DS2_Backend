const express = require('express');
const jsonParser = express.json();
const accountAuditRouter = express.Router();

const authService = require('../auth/auth-service');
const accountAuditService = require('./account-audit-service');
const { auditCustomerLedger } = require('./account-audit-logic');
const { isAllowedAuditor, ACCOUNT_AUDIT_ALLOWED_NAMES } = require('./auditAllowlist');
const { generateAuditNarrative } = require('./account-audit-narrative');
const { buildAuditPdf } = require('./account-audit-pdf');
const { putObject, getObject } = require('../../utils/s3');
const { fetchInitialQueryItems } = require('../invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../invoice/createInvoice/invoiceCalculations/calculateInvoices');

// Call the app's own balance engine for one customer. This is the canonical
// "what would the app invoice this customer right now" number — the same
// formula that drives the invoice eligibility screen. Returns null on
// failure so a transient app-side error never aborts an audit.
const computeAppBalance = async (db, accountId, customerId) => {
   const invoicesToCreateMap = { [customerId]: { customer_id: customerId, showWriteOffs: false } };
   const invoicesToCreate = [invoicesToCreateMap[customerId]];
   const invoiceQueryData = await fetchInitialQueryItems(db, invoicesToCreateMap, accountId);
   const r = calculateInvoices(invoicesToCreate, invoiceQueryData);
   if (!r || !r.length) return null;
   return {
      invoiceTotal: Number(r[0].invoiceTotal),
      outstandingInvoiceTotal: Number(r[0].outstandingInvoices?.outstandingInvoiceTotal || 0),
      transactionsTotal: Number(r[0].transactions?.transactionsTotal || 0),
      paymentTotal: Number(r[0].payments?.paymentTotal || 0),
      writeOffTotal: Number(r[0].writeOffs?.writeOffTotal || 0),
      retainerTotal: Number(r[0].retainers?.retainerTotal || 0)
   };
};

const requireAdminAuditor = async (req, res, next) => {
   try {
      const authHeader = req.get('Authorization') || '';
      if (!authHeader.toLowerCase().startsWith('bearer ')) {
         return res.status(401).send({ message: 'Missing bearer token', status: 401 });
      }
      const token = authHeader.slice(7);
      const payload = authService.verifyJwt(token);

      const [userRow] = await req.app
         .get('db')('user_login')
         .join('users', 'user_login.user_id', '=', 'users.user_id')
         .where({
            'user_login.user_name': payload.sub,
            'user_login.is_login_active': true,
            'users.is_user_active': true
         })
         .select('users.user_id', 'users.display_name', 'users.access_level', 'users.account_id');

      if (!userRow) {
         return res.status(403).send({ message: 'Unauthorized', status: 403 });
      }
      const isAdmin = (userRow.access_level || '').toLowerCase() === 'admin';
      if (!isAdmin || !isAllowedAuditor(userRow.display_name)) {
         return res.status(403).send({ message: 'Unauthorized', status: 403 });
      }
      req.auditUser = userRow;
      next();
   } catch (err) {
      console.error('Account audit auth error:', err.message);
      return res.status(401).send({ message: 'Unauthorized', status: 401 });
   }
};

accountAuditRouter.use(requireAdminAuditor);

// GET /accountAudit/whoami — lets the frontend confirm access without leaking the allowlist
accountAuditRouter.get('/whoami/:accountID/:userID', (req, res) => {
   res.send({
      status: 200,
      auditor: {
         user_id: req.auditUser.user_id,
         display_name: req.auditUser.display_name,
         access_level: req.auditUser.access_level
      },
      allowlist_size: ACCOUNT_AUDIT_ALLOWED_NAMES.length
   });
});

// GET /accountAudit/customers/:accountID/:userID?page=1&limit=25&search=foo
accountAuditRouter.get('/customers/:accountID/:userID', async (req, res) => {
   const db = req.app.get('db');
   try {
      const accountId = Number(req.params.accountID);
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const offset = (page - 1) * limit;
      const search = (req.query.search || '').toString();

      const { totalCount, rows } = await accountAuditService.getAuditableCustomers(db, accountId, {
         search,
         limit,
         offset
      });

      res.send({
         status: 200,
         customers: rows.map(r => {
            const auditBal = r.last_audit_balance == null ? null : Number(r.last_audit_balance);
            const appBal = r.last_app_invoice_total == null ? null : Number(r.last_app_invoice_total);
            const diff = auditBal != null && appBal != null ? Math.round((auditBal - appBal) * 100) / 100 : null;
            return {
               customer_id: r.customer_id,
               display_name: r.display_name || r.customer_name || r.business_name,
               business_name: r.business_name,
               is_commercial: !!r.is_commercial_customer,
               last_audit_at: r.last_audit_at,
               last_audit_id: r.last_audit_id,
               last_audit_balance: auditBal,
               last_app_invoice_total: appBal,
               last_balance_difference: diff,
               last_discrepancy_count: r.last_discrepancy_count == null ? null : Number(r.last_discrepancy_count)
            };
         }),
         pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / limit))
         }
      });
   } catch (err) {
      console.error('Account audit list error:', err);
      res.status(500).send({ message: err.message || 'Error listing customers.', status: 500 });
   }
});

// POST /accountAudit/run/:accountID/:userID  body: { customer_ids: [int], notes? }
accountAuditRouter.post('/run/:accountID/:userID', jsonParser, async (req, res) => {
   const db = req.app.get('db');
   try {
      const accountId = Number(req.params.accountID);
      const { customer_ids = [], notes = null } = req.body || {};
      if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
         return res.status(400).send({ message: 'No customers selected.', status: 400 });
      }
      if (customer_ids.length > 50) {
         return res.status(400).send({ message: 'Limit 50 customers per batch.', status: 400 });
      }
      const ids = customer_ids.map(Number).filter(n => Number.isFinite(n));

      const results = [];
      for (const customerId of ids) {
         try {
            const customer = await accountAuditService.getCustomer(db, accountId, customerId);
            if (!customer) {
               results.push({ customer_id: customerId, status: 'failed', error: 'Customer not found.' });
               continue;
            }
            const [invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
               accountAuditService.getInvoices(db, accountId, customerId),
               accountAuditService.getPayments(db, accountId, customerId),
               accountAuditService.getWriteoffs(db, accountId, customerId),
               accountAuditService.getTransactions(db, accountId, customerId),
               accountAuditService.getRetainers(db, accountId, customerId)
            ]);
            const result = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });

            // Run the app's own balance engine alongside our audit so we can
            // surface any divergence. Wrapped so an app-side bug doesn't
            // prevent the audit row from being saved.
            let appBalance = null;
            let appBalanceError = null;
            try {
               appBalance = await computeAppBalance(db, accountId, customerId);
            } catch (e) {
               appBalanceError = (e.message || String(e)).slice(0, 500);
               console.warn(`[audit] app balance failed for ${customerId}: ${appBalanceError}`);
            }

            // Best-effort narrative — never blocks the audit if Bedrock is down.
            let narrative = null;
            try {
               narrative = await generateAuditNarrative({
                  auditResult: result,
                  accountId,
                  userId: req.auditUser.user_id,
                  db
               });
            } catch (e) {
               console.warn(`[audit] narrative generation skipped: ${e.message}`);
            }

            const auditRow = {
               account_id: accountId,
               customer_id: customerId,
               run_by_user_id: req.auditUser.user_id,
               run_by_display_name: req.auditUser.display_name,
               status: 'completed',
               total_invoiced: result.totals.total_invoiced,
               total_paid: result.totals.total_paid,
               total_transactions: result.totals.total_transactions,
               total_writeoffs: result.totals.total_writeoffs,
               outstanding_invoices: result.totals.outstanding_invoices,
               unbilled_billable: result.totals.unbilled_billable,
               unbilled_payments: result.totals.unbilled_payments,
               unbilled_writeoffs: result.totals.unbilled_writeoffs,
               audit_balance: result.totals.audit_balance,
               strict_ledger_balance: result.totals.strict_ledger_balance,
               discrepancy_count: result.discrepancies.length,
               discrepancies: JSON.stringify(result.discrepancies),
               ledger: JSON.stringify(result.ledger),
               summary: JSON.stringify({
                  customer: result.customer,
                  totals: result.totals,
                  invoice_breakdown: result.invoice_breakdown,
                  retainers: result.retainers,
                  methodology: result.methodology,
                  generated_at: result.generated_at
               }),
               notes: notes || null,
               app_invoice_total: appBalance ? appBalance.invoiceTotal : null,
               app_balance_error: appBalanceError,
               narrative: narrative?.narrative || null,
               narrative_findings: narrative ? JSON.stringify(narrative.findings) : null,
               narrative_actions: narrative ? JSON.stringify(narrative.actions) : null,
               narrative_model: narrative?.model || null,
               narrative_cost_usd: narrative?.cost ?? null,
               narrative_request_id: narrative?.requestId || null
            };

            const [saved] = await accountAuditService.insertAudit(db, auditRow);

            // Best-effort PDF render + S3 upload — also doesn't block the audit.
            try {
               const summaryObj = JSON.parse(auditRow.summary);
               const pdfBuffer = await buildAuditPdf({
                  audit: {
                     audit_id: saved.audit_id,
                     created_at: saved.created_at,
                     run_by_display_name: saved.run_by_display_name,
                     narrative: saved.narrative,
                     narrative_findings: narrative?.findings || [],
                     narrative_actions: narrative?.actions || [],
                     discrepancies: result.discrepancies,
                     ledger: result.ledger
                  },
                  summary: summaryObj
               });
               const ts = new Date().toISOString().replace(/[:.]/g, '-');
               const s3Key = `account_audits/${accountId}/${customerId}/audit-${saved.audit_id}-${ts}.pdf`;
               await putObject(s3Key, pdfBuffer, 'application/pdf', {
                  auditid: String(saved.audit_id),
                  customerid: String(customerId)
               });
               await db('account_audits')
                  .where({ audit_id: saved.audit_id })
                  .update({ pdf_s3_key: s3Key, pdf_generated_at: db.fn.now() });
               saved.pdf_s3_key = s3Key;
            } catch (e) {
               console.warn(`[audit] PDF/S3 step skipped for audit ${saved.audit_id}: ${e.message}`);
            }

            results.push({
               customer_id: customerId,
               status: 'completed',
               audit_id: saved.audit_id,
               audit_balance: Number(saved.audit_balance),
               app_invoice_total: appBalance ? appBalance.invoiceTotal : null,
               balance_difference: appBalance ? Number(saved.audit_balance) - appBalance.invoiceTotal : null,
               strict_ledger_balance: Number(saved.strict_ledger_balance),
               discrepancy_count: saved.discrepancy_count,
               pdf_available: !!saved.pdf_s3_key,
               narrative_available: !!saved.narrative,
               created_at: saved.created_at
            });
         } catch (err) {
            console.error(`Audit failed for customer ${customerId}:`, err);
            try {
               const [saved] = await accountAuditService.insertAudit(db, {
                  account_id: accountId,
                  customer_id: customerId,
                  run_by_user_id: req.auditUser.user_id,
                  run_by_display_name: req.auditUser.display_name,
                  status: 'failed',
                  error_message: err.message?.slice(0, 1000) || 'Unknown error'
               });
               results.push({ customer_id: customerId, status: 'failed', audit_id: saved.audit_id, error: err.message });
            } catch (_) {
               results.push({ customer_id: customerId, status: 'failed', error: err.message });
            }
         }
      }

      res.send({ status: 200, results });
   } catch (err) {
      console.error('Account audit run error:', err);
      res.status(500).send({ message: err.message || 'Error running audits.', status: 500 });
   }
});

// GET /accountAudit/audit/:auditID/:accountID/:userID  — full detail incl. ledger + discrepancies
accountAuditRouter.get('/audit/:auditID/:accountID/:userID', async (req, res) => {
   const db = req.app.get('db');
   try {
      const accountId = Number(req.params.accountID);
      const auditId = Number(req.params.auditID);
      const audit = await accountAuditService.getAuditById(db, accountId, auditId);
      if (!audit) return res.status(404).send({ message: 'Audit not found.', status: 404 });

      const parse = v => (v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v));
      res.send({
         status: 200,
         audit: {
            ...audit,
            total_invoiced: Number(audit.total_invoiced),
            total_paid: Number(audit.total_paid),
            total_transactions: Number(audit.total_transactions),
            total_writeoffs: Number(audit.total_writeoffs),
            outstanding_invoices: Number(audit.outstanding_invoices),
            unbilled_billable: Number(audit.unbilled_billable),
            unbilled_payments: Number(audit.unbilled_payments),
            unbilled_writeoffs: Number(audit.unbilled_writeoffs),
            audit_balance: Number(audit.audit_balance),
            strict_ledger_balance: Number(audit.strict_ledger_balance),
            app_invoice_total: audit.app_invoice_total == null ? null : Number(audit.app_invoice_total),
            balance_difference:
               audit.app_invoice_total == null
                  ? null
                  : Math.round((Number(audit.audit_balance) - Number(audit.app_invoice_total)) * 100) / 100,
            narrative_cost_usd: audit.narrative_cost_usd == null ? null : Number(audit.narrative_cost_usd),
            discrepancies: parse(audit.discrepancies),
            ledger: parse(audit.ledger),
            summary: parse(audit.summary),
            narrative_findings: parse(audit.narrative_findings) || [],
            narrative_actions: parse(audit.narrative_actions) || []
         }
      });
   } catch (err) {
      console.error('Account audit detail error:', err);
      res.status(500).send({ message: err.message || 'Error fetching audit.', status: 500 });
   }
});

// GET /accountAudit/audit/:auditID/pdf/:accountID/:userID — stream the saved PDF (or rebuild on the fly)
accountAuditRouter.get('/audit/:auditID/pdf/:accountID/:userID', async (req, res) => {
   const db = req.app.get('db');
   try {
      const accountId = Number(req.params.accountID);
      const auditId = Number(req.params.auditID);
      const audit = await accountAuditService.getAuditById(db, accountId, auditId);
      if (!audit) return res.status(404).send({ message: 'Audit not found.', status: 404 });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="audit-${auditId}.pdf"`);

      if (audit.pdf_s3_key) {
         try {
            const { body } = await getObject(audit.pdf_s3_key);
            return res.end(body);
         } catch (e) {
            console.warn(`[audit] S3 fetch failed for ${audit.pdf_s3_key}, rebuilding: ${e.message}`);
         }
      }

      // Fallback: rebuild on the fly so the user always gets something.
      const parse = v => (v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v));
      const pdf = await buildAuditPdf({
         audit: {
            audit_id: audit.audit_id,
            created_at: audit.created_at,
            run_by_display_name: audit.run_by_display_name,
            narrative: audit.narrative,
            narrative_findings: parse(audit.narrative_findings) || [],
            narrative_actions: parse(audit.narrative_actions) || [],
            discrepancies: parse(audit.discrepancies) || [],
            ledger: parse(audit.ledger) || []
         },
         summary: parse(audit.summary) || {}
      });
      return res.end(pdf);
   } catch (err) {
      console.error('Account audit pdf error:', err);
      res.status(500).send({ message: err.message || 'Error returning PDF.', status: 500 });
   }
});

// GET /accountAudit/customer/:customerID/:accountID/:userID — list audits for a customer (no ledger payload)
accountAuditRouter.get('/customer/:customerID/:accountID/:userID', async (req, res) => {
   const db = req.app.get('db');
   try {
      const accountId = Number(req.params.accountID);
      const customerId = Number(req.params.customerID);
      const audits = await accountAuditService.getAuditsForCustomer(db, accountId, customerId);
      res.send({
         status: 200,
         audits: audits.map(a => ({
            audit_id: a.audit_id,
            created_at: a.created_at,
            run_by_display_name: a.run_by_display_name,
            status: a.status,
            audit_balance: Number(a.audit_balance),
            app_invoice_total: a.app_invoice_total == null ? null : Number(a.app_invoice_total),
            balance_difference:
               a.app_invoice_total == null
                  ? null
                  : Math.round((Number(a.audit_balance) - Number(a.app_invoice_total)) * 100) / 100,
            strict_ledger_balance: Number(a.strict_ledger_balance),
            outstanding_invoices: Number(a.outstanding_invoices),
            unbilled_billable: Number(a.unbilled_billable),
            unbilled_writeoffs: Number(a.unbilled_writeoffs),
            total_invoiced: Number(a.total_invoiced),
            total_paid: Number(a.total_paid),
            total_writeoffs: Number(a.total_writeoffs),
            discrepancy_count: a.discrepancy_count,
            notes: a.notes,
            narrative: a.narrative,
            pdf_available: !!a.pdf_s3_key,
            error_message: a.error_message
         }))
      });
   } catch (err) {
      console.error('Account audit customer-list error:', err);
      res.status(500).send({ message: err.message || 'Error fetching customer audits.', status: 500 });
   }
});

module.exports = accountAuditRouter;
