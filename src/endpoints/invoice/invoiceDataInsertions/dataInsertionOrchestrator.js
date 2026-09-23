const { randomUUID } = require('crypto');
const { createAndSaveZip } = require('../../../pdfCreator/zipOrchestrator');
const { restoreDataTypesInvoiceOnCreate } = require('../invoiceObjects');
const cleanAndValidateInvoiceObject = require('./schemaValidation/invoiceValidation');
const invoiceService = require('../invoice-service');
const dayjs = require('dayjs');

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Persist a finalized billing run.
 *
 * Order of operations (deliberate):
 *   1. Validate every new parent object and the batch itself (one row per
 *      customer, finite non-negative totals) BEFORE any side effect.
 *   2. Save the PDFs to S3 under a per-run, per-customer key — outside the DB
 *      transaction, so an S3 failure never leaves half-written ledger rows and a
 *      DB failure never leaves ledger rows pointing at missing files.
 *   3. One knex transaction: lock the account row and every selected customer
 *      row (sorted) so concurrent finalize / payment writers serialise on the
 *      same boundary; re-check the same-day rule, the invoice numbers and the
 *      ledger inputs under the lock; insert the parents; absorb exactly the
 *      chains whose remaining was rolled into each beginning_balance; stamp
 *      the billed transactions and uninvoiced payments with the new
 *      customer_invoice_id and require the exact expected row counts.
 *
 * Stamping is an UPDATE of the single linkage column. The previous
 * implementation re-inserted whole transaction/payment rows through an integer
 * validator, which floored every stamped quantity / unit_cost / total_transaction
 * (0.25 h → 0, $18.75 → $18) and rewrote NULL notes as the string 'null'.
 */
const dataInsertionOrchestrator = async (db, invoicesWithDetail, accountBillingInformation, pdfBuffer, userID, options = {}) => {
   if (!invoicesWithDetail || !accountBillingInformation || !pdfBuffer || !userID) {
      throw new Error('Missing necessary arguments for dataInsertionOrchestrator');
   }
   if (!invoicesWithDetail.length) return [];

   const runID = options.runID || randomUUID();
   const billingDate = options.billingDate || dayjs().format('YYYY-MM-DD');
   const allowSameDayRebill = options.allowSameDayRebill === true;
   // Moment the billing run read the ledger (DB clock, plain timestamp — set by
   // the route before fetchInitialQueryItems). Any payment / write-off / snapshot
   // committed after it was not part of the calculation.
   const runStartedAt = options.runStartedAt || null;

   // ---- 1. validate the batch -------------------------------------------------
   const customerIDs = invoicesWithDetail.map(invoice => Number(invoice.customer_id));
   if (customerIDs.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid customer id in the billing batch.');
   if (new Set(customerIDs).size !== customerIDs.length) throw new Error('A customer appears more than once in the billing batch; select each customer once.');
   invoicesWithDetail.forEach(invoice => {
      const total = Number(invoice.invoiceTotal);
      if (!Number.isFinite(total)) throw new Error(`Invoice total for customer ${invoice.customer_id} is not a number.`);
      if (total < 0) throw new Error(`Customer ${invoice.customer_id} has a credit balance (${total.toFixed(2)}); record it as a prepayment or adjust the ledger before finalizing.`);
   });

   const stampPlan = invoicesWithDetail.map(buildStampPlan);
   const accountID = Number(accountBillingInformation.account_id || invoicesWithDetail[0].customerContactInformation?.account_id);
   if (!Number.isSafeInteger(accountID)) throw new Error('Account id missing for the billing run.');

   // ---- 2. artifacts -----------------------------------------------------------
   const pdfFileLocations = await saveInvoiceImagesForDatabase(pdfBuffer, accountBillingInformation, runID).catch(err => {
      throw new Error(`Error in saving invoice images: ${err.message}`);
   });
   const pdfFileLocationsMap = pdfFileLocations.reduce((acc, { customerID, filePath }) => ({ ...acc, [customerID]: filePath }), {});
   const newCustomerInvoices = invoicesWithDetail.map(invoice => cleanAndValidateInvoiceObject(newInvoiceObject(invoice, pdfFileLocationsMap, userID, billingDate)));
   const plannedNumbers = newCustomerInvoices.map(invoice => invoice.invoice_number);
   if (new Set(plannedNumbers).size !== plannedNumbers.length) throw new Error('Duplicate invoice numbers in the billing batch.');

   // ---- 3. commit --------------------------------------------------------------
   return db.transaction(async trx => {
      await trx('accounts').where('account_id', accountID).forNoKeyUpdate();
      for (const customerID of [...customerIDs].sort((a, b) => a - b)) {
         await trx('customers').where({ account_id: accountID, customer_id: customerID }).forNoKeyUpdate();
      }

      if (!allowSameDayRebill) {
         const billedToday = await invoiceService.getParentsOnDate(trx, accountID, customerIDs, billingDate);
         if (billedToday.length) {
            throw new Error(`Customer(s) ${[...new Set(billedToday.map(r => r.customer_id))].join(', ')} were finalized today by another run. Refresh Create Invoice and submit again.`);
         }
      }

      const taken = await trx('customer_invoices').where('account_id', accountID).whereIn('invoice_number', plannedNumbers).select('invoice_number');
      if (taken.length) {
         throw new Error(`Invoice number(s) ${taken.map(t => t.invoice_number).join(', ')} were just used by another billing run. Re-open Create Invoice and submit again.`);
      }

      await assertLedgerUnchanged(trx, accountID, customerIDs, stampPlan, runStartedAt);
      if (options.ledgerFingerprint) {
         const now = await invoiceService.getLedgerFingerprint(trx, accountID, customerIDs);
         const changed = customerIDs.filter(id => (options.ledgerFingerprint[id] || '') !== (now[id] || ''));
         if (changed.length) {
            throw new Error(`The ledger for customer(s) ${changed.join(', ')} changed while the statements were being generated (a payment, write-off, invoice row or transaction was added, edited or deleted). Nothing was finalized — re-run Create Invoice.`);
         }
      }

      const createdParents = [];
      for (const invoice of newCustomerInvoices) {
         createdParents.push(await invoiceService.createInvoice(trx, invoice));
      }
      const parentByCustomer = createdParents.reduce((acc, parent) => ({ ...acc, [parent.customer_id]: parent }), {});

      const stamped = [];
      for (const plan of stampPlan) {
         const parent = parentByCustomer[plan.customer_id];
         if (!parent) throw new Error(`Parent statement missing for customer ${plan.customer_id}.`);

         // Absorb exactly the chains whose remaining became this beginning_balance.
         const absorbed = await invoiceService.zeroOutAbsorbedInvoices(trx, accountID, plan.customer_id, parent, plan.absorbedRootIDs);

         let transactionsStamped = 0;
         let paymentsStamped = 0;
         if (plan.transactionIDs.length) {
            transactionsStamped = await trx('customer_transactions')
               .where('account_id', accountID)
               .andWhere('customer_id', plan.customer_id)
               .whereIn('transaction_id', plan.transactionIDs)
               .whereNull('customer_invoice_id')
               .update({ customer_invoice_id: parent.customer_invoice_id });
            if (transactionsStamped !== plan.transactionIDs.length) {
               throw new Error(`Customer ${plan.customer_id}: ${plan.transactionIDs.length - transactionsStamped} transaction(s) on the statement were changed or billed by another run. Nothing was finalized — re-run Create Invoice.`);
            }
         }
         if (plan.paymentIDs.length) {
            paymentsStamped = await trx('customer_payments')
               .where('account_id', accountID)
               .andWhere('customer_id', plan.customer_id)
               .whereIn('payment_id', plan.paymentIDs)
               .whereNull('customer_invoice_id')
               .update({ customer_invoice_id: parent.customer_invoice_id });
            if (paymentsStamped !== plan.paymentIDs.length) {
               throw new Error(`Customer ${plan.customer_id}: a payment on the statement was changed by another run. Nothing was finalized — re-run Create Invoice.`);
            }
         }
         stamped.push({
            customer_id: plan.customer_id,
            customer_invoice_id: parent.customer_invoice_id,
            invoice_number: parent.invoice_number,
            transactionsStamped,
            paymentsStamped,
            absorbedRows: Number(absorbed) || 0
         });
      }

      return stamped;
   });
};

module.exports = dataInsertionOrchestrator;

/**
 * Refuse to commit if the ledger inputs the statements were rendered from have
 * changed: a payment/write-off/snapshot posted since the read, or a selected
 * transaction whose amount / billable flag / linkage differs from what the
 * calculation used (edits and deletes included).
 */
const assertLedgerUnchanged = async (trx, accountID, customerIDs, stampPlan, runStartedAt) => {
   if (runStartedAt) {
      const changedSince = async table => {
         const row = await trx(table).where('account_id', accountID).whereIn('customer_id', customerIDs).andWhere('created_at', '>', runStartedAt).count({ count: '*' }).first();
         return Number(row?.count || 0);
      };
      const [payments, writeOffs, invoiceRows] = await Promise.all([changedSince('customer_payments'), changedSince('customer_writeoffs'), changedSince('customer_invoices')]);
      if (payments || writeOffs || invoiceRows) {
         throw new Error(
            `The ledger changed while the statements were being generated (${payments} payment(s), ${writeOffs} write-off(s), ${invoiceRows} invoice row(s) were posted for the selected customers). Nothing was finalized — re-run Create Invoice so the statements include those entries.`
         );
      }
   }

   const expected = new Map();
   stampPlan.forEach(plan => plan.transactionSnapshot.forEach(t => expected.set(t.transaction_id, t)));
   if (!expected.size) return;
   const rows = await trx('customer_transactions')
      .where('account_id', accountID)
      .whereIn('transaction_id', [...expected.keys()])
      .select('transaction_id', 'total_transaction', 'is_transaction_billable', 'customer_invoice_id', 'customer_id');
   const byID = new Map(rows.map(r => [Number(r.transaction_id), r]));
   const drift = [];
   expected.forEach((snap, id) => {
      const row = byID.get(id);
      if (!row) return drift.push(`#${id} deleted`);
      if (row.customer_invoice_id) return drift.push(`#${id} already billed`);
      if (round2(row.total_transaction) !== round2(snap.total_transaction)) return drift.push(`#${id} amount changed`);
      if (Boolean(row.is_transaction_billable) !== Boolean(snap.is_transaction_billable)) return drift.push(`#${id} billable flag changed`);
      if (Number(row.customer_id) !== Number(snap.customer_id)) return drift.push(`#${id} moved to another customer`);
   });
   if (drift.length) {
      throw new Error(`Transactions changed while the statements were being generated (${drift.slice(0, 5).join('; ')}${drift.length > 5 ? '; …' : ''}). Nothing was finalized — re-run Create Invoice.`);
   }
};

/**
 * Which existing rows get linked to the customer's new statement:
 *   - every transaction the statement listed (billable or not — non-billable
 *     rows are shown on the statement and must not resurface next month)
 *   - payments received this period that were not applied to an invoice yet
 *   - the chain roots whose remaining was rolled into beginning_balance
 */
const buildStampPlan = invoice => {
   const {
      customer_id,
      transactions: { allTransactionRecords = [] } = {},
      payments: { allPaymentRecords = [] } = {},
      outstandingInvoices: { outstandingInvoiceRecords = [] } = {}
   } = invoice;
   const transactionSnapshot = allTransactionRecords
      .map(t => ({ transaction_id: Number(t.transaction_id), total_transaction: Number(t.total_transaction), is_transaction_billable: Boolean(t.is_transaction_billable), customer_id: Number(t.customer_id) }))
      .filter(t => Number.isInteger(t.transaction_id));
   return {
      customer_id: Number(customer_id),
      transactionIDs: transactionSnapshot.map(t => t.transaction_id),
      transactionSnapshot,
      paymentIDs: allPaymentRecords
         .filter(payment => !payment.customer_invoice_id)
         .map(payment => Number(payment.payment_id))
         .filter(Number.isInteger),
      absorbedRootIDs: [...new Set(outstandingInvoiceRecords.map(row => Number(row.parent_invoice_id || row.customer_invoice_id)).filter(Number.isInteger))]
   };
};

/**
 * Save PDF files to S3 for db lookup (one zip per customer, under the run id).
 */
const saveInvoiceImagesForDatabase = async (pdfBuffer, accountBillingInformation, runID) => {
   return Promise.all(
      pdfBuffer.map(async pdf => {
         const {
            metadata: { customerID, displayName }
         } = pdf;
         const filePath = await createAndSaveZip([pdf], accountBillingInformation, 'invoicing/invoice_images', `${displayName}.zip`, { runID, customerID });

         return { customerID, filePath };
      })
   );
};

/**
 * Creates the new parent statement row.
 *
 * total_amount_due and remaining_balance_on_invoice are the SAME number at
 * creation: the engine's invoiceTotal (= beginning balance + charges + write-off
 * credits + uninvoiced payments received). Retainers/prepayments are NOT
 * subtracted here — retainer-funded work already reduced the bill through the
 * payment created when the transaction was entered, and the statement prints the
 * retainer balance for information only.
 */
const newInvoiceObject = (invoice, pdfFileLocationsMap, userID, billingDate = dayjs().format('YYYY-MM-DD')) => {
   const {
      customer_id,
      lastInvoiceDate,
      invoiceNumber,
      dueDate,
      invoiceTotal,
      customerContactInformation: { customer_info_id, account_id } = {},
      outstandingInvoices: { outstandingInvoiceTotal } = {},
      payments: { paymentTotal } = {},
      retainers: { retainerTotal } = {},
      transactions: { transactionsTotal } = {},
      writeOffs: { writeOffTotal } = {}
   } = invoice;

   if (!Number.isFinite(Number(invoiceTotal))) throw new Error(`Invoice total for customer ${customer_id} is not a number.`);
   const amountDue = round2(invoiceTotal);

   return restoreDataTypesInvoiceOnCreate({
      account_id,
      customer_id,
      customer_info_id,
      invoice_number: invoiceNumber,
      due_date: dayjs(dueDate).format('YYYY-MM-DD'),
      beginning_balance: round2(outstandingInvoiceTotal || 0),
      total_payments: round2(paymentTotal || 0),
      total_charges: round2(transactionsTotal || 0),
      total_write_offs: round2(writeOffTotal || 0),
      total_retainers: round2(retainerTotal || 0),
      total_amount_due: amountDue,
      remaining_balance_on_invoice: amountDue,
      parent_invoice_id: null,
      // Date-only strings in the firm's billing day (passed in by the route): a
      // full ISO timestamp with an offset is re-interpreted in the database
      // session's time zone when cast to DATE and can land on the wrong day.
      invoice_date: billingDate,
      is_invoice_paid_in_full: amountDue === 0,
      fully_paid_date: amountDue === 0 ? billingDate : null,
      created_by_user_id: userID,
      start_date: lastInvoiceDate ? dayjs(lastInvoiceDate).format('YYYY-MM-DD') : billingDate,
      end_date: billingDate,
      invoice_file_location: pdfFileLocationsMap[customer_id],
      notes: null
   });
};

module.exports.newInvoiceObject = newInvoiceObject;
module.exports.buildStampPlan = buildStampPlan;
