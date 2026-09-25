const express = require('express');
const path = require('path');
const { enforceAccountId } = require('../auth/account-scope');
const invoiceRouter = express.Router();
invoiceRouter.param('accountID', enforceAccountId);
const invoiceService = require('./invoice-service');
const accountService = require('../account/account-service');
const transactionsService = require('../transactions/transactions-service');
const paymentsService = require('../payments/payments-service');
const writeOffsService = require('../writeOffs/writeOffs-service');
const retainersService = require('../retainer/retainer-service');
const jsonParser = express.json();
const { sanitizeFields } = require('../../utils/sanitizeFields');
const { findCustomersNeedingInvoices } = require('./invoiceEligibility/invoiceEligibility');
const { createGrid, filterGridByColumnName, generateTreeGridData } = require('../../utils/gridFunctions');
const { fetchInitialQueryItems } = require('./createInvoice/createInvoiceQueries');
const { readBillingSnapshot } = require('./createInvoice/billingSnapshot');
const { calculateInvoices } = require('./createInvoice/invoiceCalculations/calculateInvoices');
const { addInvoiceDetails } = require('./createInvoice/addDetailToInvoice/addInvoiceDetail');
const { createPDFInvoices } = require('../../utils/createAndSavePDFs');
const { createCsvData } = require('./createInvoiceCsv/createInvoiceCsv');
const { createAndSaveZip } = require('../../pdfCreator/zipOrchestrator');
const dataInsertionOrchestrator = require('./invoiceDataInsertions/dataInsertionOrchestrator');
const { requireManagerOrAdmin } = require('../auth/jwt-auth');
const { getObject } = require('../../utils/s3');
const { resolveOwnDownloadPrefixes, isAuthorizedDownloadKey } = require('../../utils/downloadAuthorization');
const { getPaginationParams, getPaginationMetadata } = require('../../utils/pagination');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const { randomUUID } = require('crypto');

// The firm's billing calendar day (America/Phoenix by default) — see billingDate.js.
const { billingDateToday } = require('./billingDate');

// GET all invoices
invoiceRouter.route('/getInvoices/:accountID/:invoiceID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   const activeInvoices = await invoiceService.getInvoices(db, accountID);

   // Return Object
   const activeInvoiceData = {
      activeInvoices,
      grid: createGrid(activeInvoices),
      treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id')
   };

   res.send({
      activeInvoiceData,
      message: 'Successfully retrieved invoices.',
      status: 200
   });
});

// Delete invoice
invoiceRouter
   .route('/deleteInvoice/:accountID/:invoiceID')
   .all(requireManagerOrAdmin)
   .delete(async (req, res) => {
      const db = req.app.get('db');
      const { accountID, invoiceID } = req.params;

      try {
         // Row type first: a snapshot always has its payment/write-off tagged, so
         // the generic "linked rows" refusal would hide the useful guidance.
         const [targetInvoice] = await invoiceService.getInvoiceByInvoiceRowID(db, accountID, invoiceID);
         if (!targetInvoice) throw new Error('Invoice not found.');
         if (targetInvoice.parent_invoice_id) {
            // Snapshot rows exist only as the ledger trail of a payment or
            // write-off; removing one directly desynchronises the chain.
            throw new Error('This row is a payment/write-off snapshot. Delete or reverse the payment or write-off instead.');
         }

         // check from transactions, writeoffs, and retainers, payments, and writeoffs
         const foundTransactions = await transactionsService.getTransactionsForInvoice(db, accountID, invoiceID);
         const foundPayments = await paymentsService.getPaymentsForInvoice(db, accountID, invoiceID);
         const foundWriteoffs = await writeOffsService.getWriteoffsForInvoice(db, accountID, invoiceID);

         if (foundTransactions.length || foundPayments.length || foundWriteoffs.length) {
            throw new Error('Cannot delete invoice with transactions, retainers, payments, or writeoffs.');
         }

         // A parent statement that has payment/write-off snapshots, or that
         // absorbed earlier balances into its beginning_balance (those rows were
         // zeroed and marked absorbed_by), IS the customer's ledger position.
         // Deleting it would erase collectible debt with nothing to fall back on.
         if (/\[absorbed_by:[^\]]+\]/.test(targetInvoice.notes || '')) {
            throw new Error(`Invoice ${targetInvoice.invoice_number} was rolled into a later statement (see its notes) and is part of that statement's history; it cannot be deleted.`);
         }
         if (!targetInvoice.parent_invoice_id) {
            const latestChild = await invoiceService.getLatestChildInvoice(db, accountID, invoiceID);
            if (latestChild) {
               throw new Error(`Invoice ${targetInvoice.invoice_number} has payment or write-off activity recorded against it and cannot be deleted. Delete or reverse those entries first.`);
            }
            const absorbedRows = await invoiceService.countRowsAbsorbedBy(db, accountID, targetInvoice.customer_id, targetInvoice.invoice_number);
            if (absorbedRows > 0 || Number(targetInvoice.beginning_balance) !== 0) {
               throw new Error(
                  `Invoice ${targetInvoice.invoice_number} rolled ${absorbedRows} earlier statement row(s) into its beginning balance ($${Number(targetInvoice.beginning_balance).toFixed(2)}). Deleting it would erase that debt; void it with an adjustment instead.`
               );
            }
         }

         await db.transaction(async trx => {
            // Re-check dependencies under the customer lock so a payment posted
            // between the checks above and the delete cannot be orphaned.
            await trx('customers').where({ account_id: accountID, customer_id: targetInvoice.customer_id }).forNoKeyUpdate();
            // The structural/history guards above ran unlocked: a finalize that
            // committed in between may have rolled this statement into a newer
            // one (zeroed + `[absorbed_by:…]`). Re-read the row under the lock
            // and repeat them, or the successor's beginning balance loses the
            // statement that explains it.
            const current = await trx('customer_invoices').where({ account_id: accountID, customer_invoice_id: invoiceID }).forNoKeyUpdate().first();
            if (!current) throw new Error('Invoice not found.');
            if (Number(current.customer_id) !== Number(targetInvoice.customer_id)) throw new Error('Invoice changed customer while being deleted; refresh and try again.');
            const absorbedNow = await invoiceService.countRowsAbsorbedBy(trx, accountID, current.customer_id, current.invoice_number);
            if (current.parent_invoice_id || /\[absorbed_by:[^\]]+\]/.test(current.notes || '') || Number(current.beginning_balance) !== 0 || absorbedNow > 0) {
               throw new Error(`Invoice ${current.invoice_number} became part of statement history while being deleted (a later statement rolled it forward); it cannot be deleted.`);
            }
            const [txns, pays, wos, kids] = await Promise.all([
               trx('customer_transactions').where({ account_id: accountID, customer_invoice_id: invoiceID }).count({ count: '*' }).first(),
               trx('customer_payments').where({ account_id: accountID, customer_invoice_id: invoiceID }).count({ count: '*' }).first(),
               trx('customer_writeoffs').where({ account_id: accountID, customer_invoice_id: invoiceID }).count({ count: '*' }).first(),
               trx('customer_invoices').where({ account_id: accountID, parent_invoice_id: invoiceID }).count({ count: '*' }).first()
            ]);
            if ([txns, pays, wos, kids].some(r => Number(r?.count || 0) > 0)) {
               throw new Error('Invoice gained linked activity while being deleted; refresh and try again.');
            }
            await invoiceService.deleteInvoice(trx, invoiceID, accountID);
         });
         const activeInvoices = await invoiceService.getInvoices(db, accountID);

         // Return Object
         const activeInvoiceData = {
            activeInvoices,
            grid: createGrid(activeInvoices),
            treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id')
         };

         res.send({
            invoicesList: { activeInvoiceData },
            message: 'Successfully deleted invoice.',
            status: 200
         });
      } catch (error) {
         res.send({
            message: error.message || 'An error occurred while deleting the invoice.',
            status: 500
         });
      }
   });

// Get accounts with a balance to generate invoices
invoiceRouter.route('/createInvoice/AccountsWithBalance/:accountID/:invoiceID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   const billingDate = billingDateToday();
   const activeOutstandingBalances = await findCustomersNeedingInvoices(db, accountID, billingDate);

   // Run the same invoice calculation engine used at submission time so the
   // frontend can show — and accurately filter on — the real invoice total for
   // each customer (retainers, write-offs, etc. all applied).
   let invoiceTotalMap = {};
   try {
      const invoicesToCreate = activeOutstandingBalances.map(c => ({ customer_id: c.customer_id, showWriteOffs: false }));
      const invoicesToCreateMap = invoicesToCreate.reduce((map, obj) => ({ ...map, [obj.customer_id]: obj }), {});
      const invoiceQueryData = await fetchInitialQueryItems(db, invoicesToCreateMap, accountID, { billingDate });
      const calculated = calculateInvoices(invoicesToCreate, invoiceQueryData);
      invoiceTotalMap = calculated.reduce((map, inv) => ({ ...map, [inv.customer_id]: Number(inv.invoiceTotal || 0) }), {});
   } catch (e) {
      console.warn('[AccountsWithBalance] invoice pre-calc failed, totals will be 0:', e.message);
   }

   // Merge the real invoice_total into each eligibility row
   const balancesWithTotals = activeOutstandingBalances.map(c => ({
      ...c,
      invoice_total: invoiceTotalMap[c.customer_id] ?? 0
   }));

   // Most recent audit per customer — only counts as "passed" if the audit's
   // independently-recomputed balance matched the app's invoice total.  If the
   // most recent audit FAILED (mismatch), last_audit_at stays null so the grid
   // renders blank instead of a misleading green check.
   const customerIds = balancesWithTotals.map(c => c.customer_id);
   let lastAuditMap = {};
   try {
      const latestAudits = await db('account_audits')
         .select(db.raw('DISTINCT ON (customer_id) customer_id, created_at AS last_audit_at, audit_balance AS last_audit_balance, app_invoice_total AS last_app_invoice_total'))
         .where('account_id', accountID)
         .whereIn('customer_id', customerIds)
         .where('status', 'completed')
         .orderByRaw('customer_id, created_at DESC');
      lastAuditMap = latestAudits.reduce((map, a) => ({ ...map, [a.customer_id]: a }), {});
   } catch (e) {
      console.warn('[AccountsWithBalance] audit lookup failed:', e.message);
   }

   const balancesWithAudits = balancesWithTotals.map(c => {
      const a = lastAuditMap[c.customer_id];
      const passed =
         a &&
         a.last_app_invoice_total != null &&
         a.last_audit_balance != null &&
         Math.abs(Number(a.last_audit_balance) - Number(a.last_app_invoice_total)) < 0.01;
      return {
         ...c,
         last_audit_at: passed ? a.last_audit_at : null
      };
   });

   const fullGrid = createGrid(balancesWithAudits);

   // Columns kept in the row payload:
   //   customer_id      — hidden in UI, needed for submission
   //   write_off_count  — hidden in UI, needed by Write Offs Present indicator
   // Count columns (retainer/transaction/invoice) are dropped entirely.
   const activeOutstandingBalancesData = {
      activeOutstandingBalances: balancesWithAudits,
      grid: filterGridByColumnName(fullGrid, [
         'customer_id', 'business_name', 'customer_name', 'display_name',
         'write_off_count', 'outstanding_invoice_total', 'billable_transactions_total',
         'invoice_total', 'last_audit_at', 'last_invoice_number', 'last_invoice_date', 'billed_today'
      ])
   };

   res.send({
      outstandingBalanceList: { activeOutstandingBalancesData },
      message: 'Successfully retrieved balance.',
      status: 200
   });
});

// Create an invoice or multiple invoices
invoiceRouter.route('/createInvoice/:accountID/:userID').post(requireManagerOrAdmin, jsonParser, async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   // The acting user comes from the verified session, never from the URL.
   const userID = req.user && req.user.user_id ? req.user.user_id : req.params.userID;

   // Sanitize fields
   const sanitizedData = sanitizeFields(req.body.invoiceConfiguration || {});
   const { invoicesToCreate: requestedInvoices = [], invoiceCreationSettings = {} } = sanitizedData;
   const { isFinalized, isRoughDraft, isCsvOnly, globalInvoiceNote } = invoiceCreationSettings;
   const allowSameDayRebill = invoiceCreationSettings.allowSameDayRebill === true || invoiceCreationSettings.allowSameDayRebill === 'true';

   let committedResult = null;
   try {
      if (!Array.isArray(requestedInvoices) || !requestedInvoices.length) {
         throw new Error('Select at least one customer to invoice.');
      }
      const requestedIDs = requestedInvoices.map(c => Number(c.customer_id));
      if (requestedIDs.some(id => !Number.isSafeInteger(id) || id <= 0)) {
         throw new Error('Invalid customer selection.');
      }
      if (new Set(requestedIDs).size !== requestedIDs.length) {
         throw new Error('A customer was selected more than once; select each customer once.');
      }
      const billingDate = billingDateToday();
      const runID = randomUUID();

      // SAME-DAY RE-FINALIZE GUARD. Running Create Invoice twice in one day for
      // the same customer produced a second parent statement whose beginning
      // balance absorbed the first while both stayed outstanding — the customer's
      // computed debt doubled (4 live cases found in the 2026 ledger). Finalizing
      // now skips customers who already have a statement dated today unless the
      // caller explicitly opts in with allowSameDayRebill (the second statement
      // then absorbs the first by chain identity instead of being summed with it).
      const skippedCustomers = [];
      let invoicesToCreate = requestedInvoices;
      if (isFinalized && !allowSameDayRebill) {
         const billedToday = await invoiceService.getParentsOnDate(db, accountID, requestedIDs, billingDate);
         const billedTodayByCustomer = billedToday.reduce((map, row) => ({ ...map, [row.customer_id]: row }), {});
         invoicesToCreate = requestedInvoices.filter(customer => {
            const existing = billedTodayByCustomer[Number(customer.customer_id)];
            if (!existing) return true;
            skippedCustomers.push({
               customer_id: Number(customer.customer_id),
               display_name: customer.display_name || customer.customer_name || null,
               invoice_number: existing.invoice_number,
               reason: `Already finalized today as ${existing.invoice_number}. Re-bill on another day, or resubmit with "allow same-day re-bill" to absorb today's statement into a new one.`
            });
            return false;
         });
      }

      if (!invoicesToCreate.length) {
         const activeInvoices = await invoiceService.getInvoices(db, accountID);
         return res.send({
            invoicesWithDetail: [],
            fileLocation: '',
            skippedCustomers,
            invoicesList: { activeInvoiceData: { activeInvoices, grid: createGrid(activeInvoices), treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id') } },
            message: `No invoices created — ${skippedCustomers.length} customer(s) skipped (see details).`,
            status: 200
         });
      }

      // Create map of customer_id and object as value. Needed later when matching calculated invoices with invoice details
      const invoicesToCreateMap = invoicesToCreate.reduce((map, obj) => ({ ...map, [obj.customer_id]: obj }), {});
      // One consistent REPEATABLE READ snapshot for the ledger fingerprint, the
      // run start time and every pricing input (see billingSnapshot.js): a
      // payment edited and restored while the statements are being rendered can
      // no longer leave an intermediate amount in the calculation. The
      // fingerprint is re-checked under the finalize lock and the commit is
      // refused when the ledger differs from what was priced.
      const { runStartedAt, ledgerFingerprint, accountBillingInformation, invoiceQueryData } = await readBillingSnapshot(db, {
         accountID,
         invoicesToCreateMap,
         billingDate
      });
      let calculatedInvoices = calculateInvoices(invoicesToCreate, invoiceQueryData);

      // Credit balances cannot be finalized yet: the next cycle would drop the
      // credit (negative remaining is not carried forward). Skip them with a
      // reason instead of issuing a statement that loses the customer's money.
      if (isFinalized) {
         calculatedInvoices = calculatedInvoices.filter(inv => {
            if (Number.isFinite(Number(inv.invoiceTotal)) && Number(inv.invoiceTotal) >= 0) return true;
            const requested = invoicesToCreateMap[inv.customer_id] || {};
            skippedCustomers.push({
               customer_id: Number(inv.customer_id),
               display_name: requested.display_name || requested.customer_name || null,
               invoice_number: null,
               reason: `Credit balance of $${Math.abs(Number(inv.invoiceTotal || 0)).toFixed(2)} — record it as a prepayment/retainer or adjust the ledger before finalizing.`
            });
            return false;
         });
         if (!calculatedInvoices.length) {
            const activeInvoices = await invoiceService.getInvoices(db, accountID);
            return res.send({
               invoicesWithDetail: [],
               fileLocation: '',
               skippedCustomers,
               invoicesList: { activeInvoiceData: { activeInvoices, grid: createGrid(activeInvoices), treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id') } },
               message: `No invoices created — ${skippedCustomers.length} customer(s) skipped (already finalized today or credit balance).`,
               status: 200
            });
         }
      }

      const invoicesWithDetail = await addInvoiceDetails(calculatedInvoices, invoiceQueryData, invoicesToCreateMap, accountBillingInformation, globalInvoiceNote, billingDate);

      let fileLocation = '';

      if (isCsvOnly || isRoughDraft || isFinalized) {
         const csvBuffer = createCsvData(invoicesWithDetail);
         const pdfBuffer = await createPDFInvoices(invoicesWithDetail);
         const filesToZip = pdfBuffer.concat(csvBuffer);

         if (isFinalized) {
            // Ledger first: if the run cannot be committed, no downloadable
            // "final" artifact must exist for it. The statements + CSV report go
            // into one zip under the run id.
            const committedInvoices = await dataInsertionOrchestrator(db, invoicesWithDetail, accountBillingInformation, pdfBuffer, userID, { runStartedAt, billingDate, allowSameDayRebill, runID, ledgerFingerprint });
            committedResult = { committed: true, committedInvoices, invoicesWithDetail, skippedCustomers, fileLocation: '', status: 200 };
            fileLocation = await createAndSaveZip(isCsvOnly ? filesToZip : pdfBuffer, accountBillingInformation, 'invoicing/final_invoices', 'zipped_files.zip', { runID });
            committedResult.fileLocation = fileLocation;
         } else if (isCsvOnly && isRoughDraft) {
            fileLocation = await createAndSaveZip(filesToZip, accountBillingInformation, 'invoicing/csv_report_and_draft_invoices', 'zipped_files.zip', { runID });
         } else if (isCsvOnly) {
            fileLocation = await createAndSaveZip([csvBuffer], accountBillingInformation, 'invoicing/csv_report', 'zipped_files.zip', { runID });
         } else if (isRoughDraft) {
            fileLocation = await createAndSaveZip(pdfBuffer, accountBillingInformation, 'invoicing/draft_invoices', 'zipped_files.zip', { runID });
         }
      }

      // get invoices table data
      const activeInvoices = await invoiceService.getInvoices(db, accountID);

      // Return Object
      const activeInvoiceData = {
         activeInvoices,
         grid: createGrid(activeInvoices),
         treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id')
      };

      const createdCount = isFinalized ? invoicesWithDetail.length : 0;
      const message = isFinalized
         ? `Finalized ${createdCount} invoice(s).${skippedCustomers.length ? ` Skipped ${skippedCustomers.length} customer(s) (see details).` : ''}`
         : 'Successfully generated invoice preview.';

      res.send({
         ...(committedResult || {}),
         invoicesWithDetail,
         fileLocation,
         skippedCustomers,
         invoicesList: { activeInvoiceData },
         message,
         status: 200
      });
   } catch (error) {
      console.error(`[createInvoice] ${error.message}`);
      if (committedResult) {
         return res.send({
            ...committedResult,
            message: `Finalized ${committedResult.committedInvoices.length} invoice(s).`,
            warnings: ['Billing committed, but the combined download or invoice-list refresh failed. Retrieve the saved individual files from Invoices; do not finalize again.']
         });
      }
      res.send({
         message: error.message,
         status: 500
      });
   }
});

invoiceRouter.route('/downloadFile/:accountID/:userID').get(async (req, res) => {
   try {
      const { accountID } = req.params;
      const rawLocation = req.query.fileLocation;

      if (typeof rawLocation !== 'string' || rawLocation.trim().length === 0) {
         throw new Error('Invalid or no file path.');
      }

      // No decoding here: Express's own query-string parser already decodes
      // the value once, and a SECOND decode is exactly how a double-encoded
      // separator (e.g. '..' sent as %252e%252e) would have smuggled a
      // traversal past validation. Anything left over is taken literally and
      // must pass the syntax + ownership checks below as-is (see
      // utils/downloadAuthorization.js for the full rationale).
      const s3Key = rawLocation.trim();

      // Authorize BEFORE touching S3: resolve the areas of the bucket this
      // authenticated account actually owns for this route (its invoicing exports) and refuse anything else — including the shared
      // time-tracking template and any other account's prefix — with a 403,
      // never a silent normalize-and-continue. See finding 1,
      // review/full-audit-2026-09: this route used to fetch whatever key it
      // was handed, which let a key obtained from the (separately-guarded)
      // GET /time-tracking/template/list route be downloaded here instead.
      const db = req.app.get('db');
      const [accountRow] = await accountService.getAccount(db, accountID);
      // Astra round 9, finding 1: storage_slug (immutable), not account_name
      // (mutable) — see utils/storageSlug.js.
      const allowedPrefixes = resolveOwnDownloadPrefixes({ storageSlug: accountRow?.storage_slug });

      if (!isAuthorizedDownloadKey(s3Key, allowedPrefixes)) {
         return res.status(403).send({ message: 'You do not have access to this file.', status: 403 });
      }

      try {
         const { body, metadata } = await getObject(s3Key);

         if (!body || !Buffer.isBuffer(body)) {
            throw new Error('File does not exist.');
         }

         const filename = path.basename(s3Key);

         if (metadata?.contentType) {
            res.set('Content-Type', metadata.contentType);
         }

         if (metadata?.contentLength) {
            res.set('Content-Length', `${metadata.contentLength}`);
         }

         return res.status(200).attachment(filename).send(body);
      } catch (s3Error) {
         console.warn(`Unable to retrieve ${s3Key} from S3: ${s3Error.message}`);
      }

      throw new Error('File does not exist.');
   } catch (error) {
      res.status(400).send({
         message: error.message
      });
   }
});

// fetch invoice details
invoiceRouter.route('/getInvoiceDetails/:invoiceID/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID, invoiceID } = req.params;

   const [invoiceDetails] = await invoiceService.getInvoiceByInvoiceRowID(db, accountID, invoiceID);
   if (!invoiceDetails) {
      return res.status(404).send({ message: 'Invoice not found.', status: 404 });
   }
   const { start_date, end_date, customer_id } = invoiceDetails;
   // Update the remaining balance on the invoice. In either case of fetching the selected invoice, or the parent invoice, the current remaining balance is required to be fetched.
   // The chain's current balance lives on its latest snapshot: resolve the root
   // first (a snapshot id used to return nothing and left the stale value).
   const chainRootID = invoiceDetails.parent_invoice_id || Number(invoiceID);
   const currentBalance = await invoiceService.getRemainingInvoiceAmount(db, accountID, chainRootID);
   if (currentBalance) invoiceDetails.remaining_balance_on_invoice = currentBalance.remaining_balance_on_invoice;

   // Payments and write-offs are tagged to the SNAPSHOT row they created, not to
   // the parent — read the whole chain so the Payments / Write-offs tabs are not
   // empty for every statement that has activity.
   const chainRowIDs = await invoiceService.getInvoiceChainRowIDs(db, accountID, chainRootID);
   const invoiceTransactions = await db('customer_transactions').where('account_id', accountID).whereIn('customer_invoice_id', chainRowIDs);
   const invoicePayments = await db('customer_payments').where('account_id', accountID).whereIn('customer_invoice_id', chainRowIDs).orderBy('created_at', 'asc');
   const invoiceWriteoffs = await db('customer_writeoffs').where('account_id', accountID).whereIn('customer_invoice_id', chainRowIDs).orderBy('created_at', 'asc');
   // Retainers active during the statement window — THIS customer's only (the
   // date-window query is account-wide).
   const invoiceRetainers = (await retainersService.getRetainersBetweenDates(db, accountID, start_date, end_date)).filter(retainer => Number(retainer.customer_id) === Number(customer_id));
   const lastBillDate = await invoiceService.getLastInvoiceDatesByCustomerID(db, accountID, [customer_id]);
   // getOutstandingInvoices expects the whole { customer_id: date } map.
   const customerOutstandingInvoices = await invoiceService.getOutstandingInvoices(db, accountID, [customer_id], lastBillDate);
   const invoiceOutstandingInvoices = customerOutstandingInvoices[customer_id];

   // create grid objects
   const invoiceTransactionsData = {
      invoiceTransactions,
      grid: createGrid(invoiceTransactions)
   };

   const invoicePaymentsData = {
      invoicePayments,
      grid: createGrid(invoicePayments)
   };

   const invoiceWriteoffsData = {
      invoiceWriteoffs,
      grid: createGrid(invoiceWriteoffs)
   };

   const invoiceRetainersData = {
      invoiceRetainers,
      grid: createGrid(invoiceRetainers),
      treeGrid: generateTreeGridData(invoiceRetainers, 'retainer_id', 'parent_retainer_id')
   };

   const invoiceOutstandingInvoicesData = {
      invoiceOutstandingInvoices,
      grid: createGrid(invoiceOutstandingInvoices),
      treeGrid: generateTreeGridData(invoiceOutstandingInvoices, 'customer_invoice_id', 'parent_invoice_id')
   };

   res.send({
      invoiceDetails,
      invoiceTransactionsData,
      invoicePaymentsData,
      invoiceWriteoffsData,
      invoiceRetainersData,
      invoiceOutstandingInvoicesData,
      message: 'Successfully retrieved invoice details.',
      status: 200
   });
});

module.exports = invoiceRouter;

// Paginated invoices list
invoiceRouter.route('/getInvoicesPaginated/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;
   const { search = '' } = req.query;

   try {
      const { page, limit, offset } = getPaginationParams({
         page: req.query.page || 1,
         limit: req.query.limit || 20
      });

      const { invoices, totalCount } = await invoiceService.getInvoicesPaginated(db, accountID, {
         limit,
         offset,
         searchTerm: typeof search === 'string' ? search.trim() : ''
      });

      const grid = createGrid(invoices);
      const pagination = getPaginationMetadata(totalCount, page, limit);

      return res.status(200).send({
         invoicesList: {
            activeInvoiceData: {
               activeInvoices: invoices,
               grid,
               pagination,
               searchTerm: typeof search === 'string' ? search.trim() : ''
            }
         },
         message: 'Successfully retrieved invoices.',
         status: 200
      });
   } catch (error) {
      console.error('Error fetching paginated invoices:', error);
      const isPaginationError = error.message && error.message.includes('Invalid pagination');
      const statusCode = isPaginationError ? 400 : 500;
      res.status(statusCode).send({
         message: error.message || 'An error occurred while retrieving invoices.',
         status: statusCode
      });
   }
});
