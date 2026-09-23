const dayjs = require('dayjs');
const paymentsService = require('./payments-service');
const invoiceService = require('../invoice/invoice-service');
const retainersService = require('../retainer/retainer-service');
const { findMatchingRetainer } = require('../retainer/retainer-logic');
const { restoreDataTypesPaymentsTableOnCreate } = require('./paymentsObjects');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const {
   round2,
   withTransaction,
   ledgerNow,
   ruleError,
   lockCustomerLedger,
   lockCustomerLedgerForRow,
   isLedgerRowBilled,
   appendNoteMarker,
   removeNoteMarker,
   parsePrepaymentRetainerId,
   retainerDrawMarker,
   cancelledByReversalMarker,
   parseCancelledByReversal,
   parseOverpaymentExcess,
   parseReversalOf,
   stripReversedMarker,
   stripLinkMarkers,
   preserveSystemMarkers,
   resolveRetainerDrawForPayment
} = require('./ledger-helpers');

const INVOICES = 'customer_invoices';
const PAYMENTS = 'customer_payments';
const RETAINERS = 'customer_retainers_and_prepayments';

// ── invoice-chain helpers ────────────────────────────────────────────────────
// Kept here rather than in invoice-service: every ledger mutation in this
// module runs inside one knex transaction and reads raw rows (no joins), so a
// row can be written back column-by-column without round-tripping unrelated
// columns (created_at microseconds, invoice_date) through JS Dates.

/** Raw customer_invoices row, account-scoped. */
const getInvoiceRow = (db, accountId, invoiceId) => {
   const id = Number(invoiceId);
   if (!Number.isInteger(id) || id <= 0) return Promise.resolve(undefined);
   return db(INVOICES).where({ account_id: Number(accountId), customer_invoice_id: id }).first();
};

/**
 * Latest snapshot of a statement chain. created_at first, then id: under the
 * ledger lock, inserts happen in lock order and both keys agree.
 */
const getLatestChainRow = (db, accountId, rootInvoiceId) =>
   db(INVOICES)
      .where({ account_id: Number(accountId), parent_invoice_id: rootInvoiceId })
      .orderBy([
         { column: 'created_at', order: 'desc' },
         { column: 'customer_invoice_id', order: 'desc' }
      ])
      .first();

/**
 * The customer's newest statement (parent invoice) — the same row the billing
 * engine uses as its statement marker (invoice_date, then created_at, then id).
 * A payment / write-off whose ledger event was written at or before this
 * row's created_at TIMESTAMP is already on a bill and is immutable.
 */
const getNewestParentInvoice = (db, accountId, customerId) =>
   db(INVOICES)
      .where({ account_id: Number(accountId), customer_id: Number(customerId) })
      .andWhere(builder => builder.whereNull('parent_invoice_id').orWhereRaw('parent_invoice_id = customer_invoice_id'))
      .orderBy([
         { column: 'invoice_date', order: 'desc' },
         { column: 'created_at', order: 'desc' },
         { column: 'customer_invoice_id', order: 'desc' }
      ])
      .first();

const paidFlags = remaining => {
   const r = round2(remaining);
   return { remaining_balance_on_invoice: r, is_invoice_paid_in_full: r === 0, fully_paid_date: r === 0 ? new Date() : null };
};

/**
 * Mirror a chain's new remaining onto its PARENT row (AR / profile / pickers
 * read the parent) and move the negative-net totals by SQL arithmetic.
 * total_payments / total_write_offs are NEGATIVE nets: pass the signed ledger
 * amount being added (a payment of -200 → paymentsDelta -200).
 */
const applyParentMirror = (trx, accountId, parentInvoiceId, { remaining, paymentsDelta = 0, writeOffsDelta = 0 }) => {
   const patch = paidFlags(remaining);
   if (round2(paymentsDelta)) patch.total_payments = trx.raw('total_payments + ?', [round2(paymentsDelta)]);
   if (round2(writeOffsDelta)) patch.total_write_offs = trx.raw('total_write_offs + ?', [round2(writeOffsDelta)]);
   return trx(INVOICES).where({ account_id: Number(accountId), customer_invoice_id: parentInvoiceId }).update(patch);
};

/** Re-price one snapshot row in place (amount edits on the latest snapshot). */
const setSnapshotRemaining = (trx, accountId, invoiceId, remaining) =>
   trx(INVOICES).where({ account_id: Number(accountId), customer_invoice_id: invoiceId }).update(paidFlags(remaining));

const ABSORBED_MARKER_RE = /\[absorbed_by:/;

/** A chain explicitly closed by a newer statement (its parent or latest row carries `[absorbed_by:…]`). */
const isAbsorbedChainTarget = target => ABSORBED_MARKER_RE.test(target.parent.notes || '') || ABSORBED_MARKER_RE.test(target.latestRow.notes || '');

/**
 * Among the newest-date chains, drop the ones a newer statement explicitly
 * absorbed. Refuse posting when no live chain remains. An allowed same-day
 * re-bill leaves the first statement of the day zeroed and stamped
 * `[absorbed_by:…]` on the SAME invoice_date as the statement that absorbed
 * it; it must not stay a payment target. Genuinely independent legacy
 * same-date statements (no marker) all stay live. When every newest-date chain
 * is marked (ledger inconsistency), return no targets so callers refuse.
 */
const selectLiveChainTargets = targets => {
   const live = targets.filter(target => !isAbsorbedChainTarget(target));
   return live;
};

/**
 * Resolve the customer's CURRENT invoice chain — the only chain a new payment
 * may be applied to under the rolling-balance model (the newest parent's
 * remaining IS the customer's debt; every older chain has been absorbed into a
 * newer beginning_balance and is invisible to the billing engine's date gate).
 *
 * Returns the latest row of the current chain (the row that carries the
 * authoritative remaining balance) for every live parent sharing the newest
 * invoice_date — duplicate same-day parents are all live unless one was
 * absorbed by the other (see selectLiveChainTargets), so the caller picks
 * among them. Returns [] when the customer has no parent invoices at all.
 *
 * Throws when the customer HAS newest-date parents but every one of them is
 * marked `[absorbed_by:…]` (selectLiveChainTargets returns none) — a ledger
 * inconsistency, not an empty ledger, so callers must not fall back to a
 * generic "no invoices" message that would send the user to bank the money
 * as a prepayment instead of fixing the underlying chain.
 */
const getCurrentChainTargets = async (db, account_id, customer_id) => {
   const parents = await db
      .select('*')
      .from(INVOICES)
      .where('account_id', account_id)
      .andWhere('customer_id', customer_id)
      .whereNull('parent_invoice_id')
      .orderBy([
         { column: 'invoice_date', order: 'desc' },
         { column: 'customer_invoice_id', order: 'desc' }
      ]);

   if (!parents.length) return [];

   const newestDate = new Date(parents[0].invoice_date).toISOString().slice(0, 10);
   const currentParents = parents.filter(p => new Date(p.invoice_date).toISOString().slice(0, 10) === newestDate);

   const targets = await Promise.all(
      currentParents.map(async parent => {
         const latestChild = await getLatestChainRow(db, account_id, parent.customer_invoice_id);
         const latestRow = latestChild || parent;
         return { parent, latestRow, remaining: Number(latestRow.remaining_balance_on_invoice) || 0 };
      })
   );
   const live = selectLiveChainTargets(targets);
   if (!live.length && targets.length) {
      throw ruleError(
         `This customer's current invoice${targets.length > 1 ? 's' : ''} (${targets.map(t => t.parent.invoice_number).join(', ')}) ` +
            `${targets.length > 1 ? 'are' : 'is'} all marked absorbed by a newer statement that cannot be found. The ledger is inconsistent and cannot ` +
            'safely accept new money right now — finalize or repair the customer\'s ledger (see Account Audit) before retrying.'
      );
   }
   return live;
};

/**
 * Pick the current-chain target for an entry that referenced `requestedInvoice`.
 * `targets` come from getCurrentChainTargets, which already excludes chains a
 * same-day re-bill absorbed. A reference to an absorbed chain (older, or the
 * first statement of a same-day re-bill) is remapped to the current chain with
 * the most remaining (`remapped: true`); `zeroRemainingMessage(target)` is
 * thrown when that chain has nothing left to apply to.
 */
const pickCurrentChainTarget = (targets, requestedInvoice, zeroRemainingMessage) => {
   const requestedRootID = requestedInvoice.parent_invoice_id || requestedInvoice.customer_invoice_id;
   const direct = targets.find(t => t.parent.customer_invoice_id === requestedRootID);
   if (direct) return { target: direct, remapped: false };

   const target = targets.reduce((best, t) => (t.remaining > best.remaining ? t : best), targets[0]);
   if (target.remaining <= 0) throw ruleError(zeroRemainingMessage(target));
   return { target, remapped: true };
};

/**
 * Check if the payment has been billed. Everything is derived from STORED
 * rows: the payment's own customer (never the client-sent customer_id, which
 * used to choose whose last bill date gated the check) and the created_at
 * TIMESTAMP of that customer's newest parent invoice (a DATE compare treated
 * entries made on bill day before the run as unbilled). The comparison runs in
 * SQL (isLedgerRowBilled) so a microsecond tie is decided like the engine's gate.
 *
 * Returns `{ paymentRecord, paymentInvoiceRecord, newestParent }`. A
 * retainer-funded payment's draw is resolved by the mutation that needs it
 * (loadRetainerDrawForMutation) — exactly, never by closest timestamp.
 */
const checkIfPaymentIsAttachedToInvoice = async (db, paymentTableFields) => {
   const { payment_id, account_id } = paymentTableFields;

   const [paymentRecord] = await paymentsService.getSinglePayment(db, payment_id, account_id);
   if (!paymentRecord) throw ruleError('No matching payment record found.', 404);

   const paymentInvoiceRecord = paymentRecord.customer_invoice_id ? await getInvoiceRow(db, account_id, paymentRecord.customer_invoice_id) : undefined;
   const newestParent = await getNewestParentInvoice(db, account_id, paymentRecord.customer_id);

   // The payment's ledger event is its snapshot row (or the payment row itself
   // when it has none). Written at or before the newest statement → billed.
   const billedAnchor = paymentInvoiceRecord ? { table: INVOICES, id: paymentInvoiceRecord.customer_invoice_id } : { table: PAYMENTS, id: paymentRecord.payment_id };
   if (await isLedgerRowBilled(db, account_id, billedAnchor, newestParent)) {
      throw ruleError('Payment is attached to an invoice and cannot be deleted or Modified.', 423);
   }

   return { paymentRecord, paymentInvoiceRecord, newestParent };
};

/**
 * The draw-down snapshot a retainer-funded payment created, for a mutation that
 * is about to move it (delete / re-price): resolved exactly by
 * resolveRetainerDrawForPayment (throws rather than guess) and refused once the
 * draw itself is on a statement. null for a payment that is not retainer-funded.
 */
const loadRetainerDrawForMutation = async (trx, accountId, paymentRecord, newestParent) => {
   const draw = await resolveRetainerDrawForPayment(trx, accountId, paymentRecord);
   if (draw && (await isLedgerRowBilled(trx, accountId, { table: RETAINERS, id: draw.retainer_id }, newestParent))) {
      throw ruleError('Retainer is attached to an invoice and cannot be deleted or Modified.', 423);
   }
   return draw;
};

/** The POSITIVE reversal row recorded for payment `paymentId`, if any. */
const findReversalOf = (trx, accountId, paymentId) =>
   trx(PAYMENTS)
      .select('payment_id')
      .where({ account_id: Number(accountId) })
      .andWhere('payment_amount', '>', 0)
      .andWhere('note', 'like', `[reversal of payment #${Number(paymentId)}]%`)
      .first();

/**
 * A reversed payment stays as recorded while its reversal exists: re-pricing
 * or deleting it would leave the reversal restoring a different amount (or a
 * payment that no longer exists). Delete the reversal first.
 */
const assertNotReversed = async (trx, accountId, paymentRecord, action) => {
   const reversal = await findReversalOf(trx, accountId, paymentRecord.payment_id);
   if (reversal) {
      throw ruleError(`Payment #${paymentRecord.payment_id} has been reversed (reversal entry #${reversal.payment_id}). Delete the reversal first, then ${action} this payment.`);
   }
};

/**
 * Calculate the remaining amounts for the invoice and payment objects
 * @param {*} matchingInvoice - the chain's latest row
 * @param {*} paymentTableFields
 */
const updateObjectsWithRemainingAmounts = (matchingInvoice, paymentTableFields) => {
   const { remaining_balance_on_invoice = 0, customer_invoice_id } = matchingInvoice;
   const paymentAmount = Number(paymentTableFields.payment_amount);
   const remainingBalance = Number(remaining_balance_on_invoice);
   const remainingAmount = round2(remainingBalance + paymentAmount);

   const invoiceInsertionObject = createInvoiceObject(matchingInvoice, remainingAmount, customer_invoice_id);
   const paymentInsertionObject = paymentTableFields;

   return { paymentInsertionObject, invoiceInsertionObject, remainingAmount };
};

/** Payments / retainers / invoices lists the payment forms refresh from. */
const buildLedgerTablesPayload = async (db, accountId) => {
   const [activePayments, activeRetainers, invoicesList] = await Promise.all([
      paymentsService.getActivePayments(db, accountId),
      retainersService.getActiveRetainers(db, accountId),
      invoiceService.getInvoices(db, accountId)
   ]);

   return {
      paymentsList: { activePaymentsData: { activePayments, grid: createGrid(activePayments) } },
      accountRetainersList: {
         activeRetainerData: {
            activeRetainers,
            grid: createGrid(activeRetainers),
            treeGrid: generateTreeGridData(activeRetainers, 'retainer_id', 'parent_retainer_id')
         }
      },
      invoicesList: {
         activeInvoiceData: {
            invoicesList,
            grid: createGrid(invoicesList),
            treeGrid: generateTreeGridData(invoicesList, 'customer_invoice_id', 'parent_invoice_id')
         }
      }
   };
};

/**
 * Send back all tables with success response
 * @param {*} db
 * @param {*} res
 * @param {*} paymentTableFields
 */
const returnTablesWithSuccessResponse = async (db, res, paymentTableFields, message) => {
   const tables = await buildLedgerTablesPayload(db, paymentTableFields.account_id);
   res.send({ ...tables, message, status: 200 });
};

/**
 * Makes invoice object for insertion into invoice table
 * @param {*} matchingInvoice
 * @param {*} remainingAmount- int, not required - if provided, this amount will be used as the remaining balance
 * @returns
 */
const createInvoiceObject = (matchingInvoice, remainingAmount, customerInvoiceID) => {
   const { parent_invoice_id } = matchingInvoice;

   // Delete unneeded fields
   delete matchingInvoice.customer_invoice_id;
   delete matchingInvoice.customer_name;
   delete matchingInvoice.customer_street;
   delete matchingInvoice.customer_city;
   delete matchingInvoice.customer_state;
   delete matchingInvoice.customer_zip;
   delete matchingInvoice.customer_email;
   delete matchingInvoice.customer_phone;
   // created_at must come from the DB clock, same as every other row (the
   // cores stamp ledgerNow()). Client-stamping it with the Node process's LOCAL
   // time made snapshots sort hours before rows stamped by the (UTC) DB server.
   delete matchingInvoice.created_at;

   const remaining = round2(remainingAmount || 0);
   return {
      ...matchingInvoice,
      parent_invoice_id: parent_invoice_id > 0 ? parent_invoice_id : customerInvoiceID,
      remaining_balance_on_invoice: remaining,
      is_invoice_paid_in_full: remaining === 0,
      fully_paid_date: remaining === 0 ? new Date() : null
   };
};

// ── create ───────────────────────────────────────────────────────────────────

const flagIsTrue = value => value === true || value === 'true';

/**
 * A payment's job (create or update) must belong to the payment's OWN
 * customer — the same cross-customer guard transactions and job-level
 * write-offs already enforce. Without it, a job picked for one customer could
 * be attached to another customer's payment (contaminating that job's
 * history) while the ledger lock only protects the payment's own customer.
 * No-op when no job is selected.
 */
const assertPaymentJobOwner = async (trx, accountId, customerId, jobId) => {
   if (!jobId) return;
   const job = await trx('customer_jobs')
      .where({ account_id: Number(accountId), customer_id: Number(customerId), customer_job_id: Number(jobId) })
      .first();
   if (!job) throw ruleError('The selected job does not belong to this customer. Re-select the job.');
};

/**
 * Map a Payment-form body (`req.body.payment`, already sanitized) to the create
 * input. Shared by POST /payments/createPayment and the pending-payment
 * approval endpoint so both run the exact same path.
 *
 * `authUserId` is the AUTHENTICATED user (req.user.user_id). When present it is
 * always the recorded creator: the form's loggedByUserID and the URL :userID
 * are caller-supplied and would make the audit trail spoofable. The form value
 * is only used by internal callers that have no request identity.
 */
const buildCreatePaymentInput = (sanitizedPayment, accountId, authUserId = null) => {
   const paymentFields = restoreDataTypesPaymentsTableOnCreate(sanitizedPayment || {});
   // Trust the account from the (guard-verified) URL, never the request body.
   paymentFields.account_id = Number(accountId);
   // Link markers (`[retainer_draw:…]`, `[prepayment_retainer:…]`,
   // `[pending_payment:…]`, …) are written by the server only; the approval
   // route appends its own `[pending_payment:<id>]` after this mapping.
   paymentFields.note = stripLinkMarkers(paymentFields.note);
   const authId = Number(authUserId);
   if (Number.isInteger(authId) && authId > 0) paymentFields.created_by_user_id = authId;

   return {
      paymentFields,
      // Opt-in escape hatches from the Payment form (see helpText there):
      //  - holdAsPrepayment: customer has no open invoice — bank the funds as a
      //    prepayment retainer instead of rejecting the entry.
      //  - captureOverpayment: amount exceeds the current remaining — apply the
      //    remaining and bank the excess as a prepayment retainer.
      holdAsPrepayment: flagIsTrue(sanitizedPayment?.holdAsPrepayment),
      captureOverpayment: flagIsTrue(sanitizedPayment?.captureOverpayment)
   };
};

const createPrepaymentRetainer = (trx, paymentTableFields, amountNegative, noteSuffix) =>
   retainersService.createRetainer(trx, {
      parent_retainer_id: null,
      customer_id: paymentTableFields.customer_id,
      account_id: paymentTableFields.account_id,
      display_name: `Prepayment ${new Date().toISOString().slice(0, 10)}`,
      type_of_hold: 'Prepayment',
      starting_amount: amountNegative,
      current_amount: amountNegative,
      form_of_payment: paymentTableFields.form_of_payment,
      payment_reference_number: paymentTableFields.payment_reference_number,
      is_retainer_active: true,
      created_by_user_id: paymentTableFields.created_by_user_id,
      note: appendNoteMarker(paymentTableFields.note, noteSuffix),
      created_at: ledgerNow(trx)
   });

/**
 * Create a payment — the single code path behind POST /payments/createPayment
 * and POST /pending-payments/approve. All writes (retainer draw, invoice
 * snapshot, payment row, parent mirror, prepayment retainer) commit or roll
 * back together, under the customer's ledger lock.
 *
 * A retainer-funded payment records its draw snapshot on its note as
 * `[retainer_draw:<retainer_id>]`, an overpayment split its prepayment as
 * `[prepayment_retainer:<retainer_id>]` — update / delete / reverse follow
 * those exact links.
 *
 * Returns `{ message, paymentTableFields, payment, snapshot, prepaymentRetainer, retainerDraw }`
 * (`payment` is null when the funds were banked as a prepayment retainer;
 * `retainerDraw` is null unless the payment was retainer-funded).
 */
const createPaymentCore = (db, { paymentFields, holdAsPrepayment = false, captureOverpayment = false }) =>
   withTransaction(db, async trx => {
      // The draw / prepayment links below are this function's to write — a copy
      // arriving on the incoming note would be parsed as the real one later.
      const paymentTableFields = { ...paymentFields, note: stripLinkMarkers(paymentFields.note, ['retainer_draw', 'prepayment_retainer', 'overpayment_split', 'overpayment_excess']) };
      const { customer_invoice_id, customer_id, account_id, retainer_id } = paymentTableFields;

      const tendered = round2(Math.abs(Number(paymentTableFields.payment_amount)));
      if (!(tendered > 0)) throw ruleError('Payment amount must be greater than $0.00.', 400);
      paymentTableFields.payment_amount = -tendered;
      if (!paymentTableFields.payment_date || !dayjs(paymentTableFields.payment_date).isValid()) {
         throw ruleError('A valid payment date is required.', 400);
      }

      await lockCustomerLedger(trx, account_id, customer_id);
      await assertPaymentJobOwner(trx, account_id, customer_id, paymentTableFields.customer_job_id);

      if (!customer_invoice_id) {
         if (retainer_id) throw ruleError('A retainer-funded payment must be applied to an invoice.', 400);
         if (holdAsPrepayment) {
            const prepaymentRetainer = await createPrepaymentRetainer(trx, paymentTableFields, -tendered, '[prepayment — no open invoice at entry]');
            return {
               message: `Recorded $${tendered.toFixed(2)} as a prepayment retainer — no open invoice.`,
               paymentTableFields,
               payment: null,
               snapshot: null,
               prepaymentRetainer,
               retainerDraw: null
            };
         }
         throw ruleError('No invoice ID provided for this payment. If the customer has no open invoice, record the funds as a retainer/prepayment instead.', 400);
      }

      // The row the user picked — existence and ownership checks only; the
      // amount is validated against the customer's CURRENT chain below.
      const requestedInvoice = await getInvoiceRow(trx, account_id, customer_invoice_id);
      if (!requestedInvoice) {
         throw ruleError('No matching invoice record found for this payment.', 404);
      }
      if (Number(requestedInvoice.customer_id) !== Number(customer_id)) {
         throw ruleError(`Invoice ${requestedInvoice.invoice_number} belongs to a different customer than this payment. Re-select the invoice.`);
      }

      // ROLLING-BALANCE GUARD. A payment may only reduce the customer's
      // current chain — older chains have been absorbed into a newer
      // beginning_balance and the billing engine's date gate never reads them,
      // so money applied there silently vanishes from every future bill.
      // If the user referenced an absorbed invoice, remap to the current chain
      // and record both numbers on the payment.
      const targets = await getCurrentChainTargets(trx, account_id, customer_id);
      if (!targets.length) {
         throw ruleError('This customer has no invoices to apply a payment to. Record the funds as a retainer/prepayment instead.');
      }

      const { target, remapped } = pickCurrentChainTarget(
         targets,
         requestedInvoice,
         t =>
            `Invoice ${requestedInvoice.invoice_number} was already rolled into a newer statement, and the current invoice ${t.parent.invoice_number} shows $0 remaining. ` +
            'Record the funds as a retainer/prepayment, or run an account audit to reconcile the balance.'
      );
      let remapMessage = '';
      if (remapped) {
         remapMessage = `Applied to current invoice ${target.parent.invoice_number} — the referenced invoice ${requestedInvoice.invoice_number} was already rolled into it.`;
         paymentTableFields.note = appendNoteMarker(paymentTableFields.note, `[applied to ${target.parent.invoice_number}; customer referenced ${requestedInvoice.invoice_number}]`);
      }

      const remaining = round2(target.remaining);
      let excessToRetainer = 0;
      if (tendered > remaining) {
         // Splitting a retainer draw would just move retainer money into a new
         // prepayment; only received funds can be split.
         if (captureOverpayment && !retainer_id && remaining > 0) {
            excessToRetainer = round2(tendered - remaining);
            paymentTableFields.payment_amount = -remaining;
            paymentTableFields.note = appendNoteMarker(
               paymentTableFields.note,
               `[overpayment split: $${remaining.toFixed(2)} to ${target.parent.invoice_number}, $${excessToRetainer.toFixed(2)} to prepayment]`
            );
            remapMessage = `${remapMessage ? `${remapMessage} ` : ''}Applied $${remaining.toFixed(2)} to ${target.parent.invoice_number}; $${excessToRetainer.toFixed(2)} held as a prepayment retainer.`;
         } else {
            throw ruleError(
               `Payment amount exceeds remaining balance on invoice ${target.parent.invoice_number}. Max amount that can be applied to this invoice is $${Math.max(0, remaining)}.`
            );
         }
      }

      // Retainer-funded: draw from the chain's LATEST balance (not the row the
      // picker happened to show) and record the draw as a new chain snapshot.
      // The payment note carries the draw's id so update/delete move exactly
      // this row (never "the draw closest in time", which can be another
      // payment's).
      let retainerDraw = null;
      if (retainer_id) {
         const latestRetainer = await findMatchingRetainer(trx, retainer_id, account_id, paymentTableFields.payment_amount, customer_id);
         const { retainer_id: _latestID, created_at: _latestCreatedAt, rn: _rn, ...retainerFields } = latestRetainer;
         const newCurrent = round2(Number(latestRetainer.current_amount) + Math.abs(Number(paymentTableFields.payment_amount)));
         retainerDraw = await retainersService.createRetainer(trx, {
            ...retainerFields,
            parent_retainer_id: latestRetainer.parent_retainer_id || latestRetainer.retainer_id,
            current_amount: newCurrent,
            is_retainer_active: newCurrent < 0,
            // The draw row is written by whoever records this payment.
            created_by_user_id: paymentTableFields.created_by_user_id,
            created_at: ledgerNow(trx)
         });
         paymentTableFields.note = appendNoteMarker(paymentTableFields.note, retainerDrawMarker(retainerDraw.retainer_id));
      }

      // The chain's latest row carries the authoritative remaining balance —
      // never the row the user happened to pick (it may be the parent or an
      // intermediate snapshot with a stale remaining).
      const { invoiceInsertionObject } = updateObjectsWithRemainingAmounts({ ...target.latestRow }, paymentTableFields);

      // Snapshot first: the payment row links to it.
      const snapshot = await invoiceService.createInvoice(trx, { ...invoiceInsertionObject, created_at: ledgerNow(trx) });

      // Overpayment excess → prepayment retainer, linked from the payment note
      // so deleting the payment can take the (untouched) prepayment with it.
      let prepaymentRetainer = null;
      if (excessToRetainer > 0) {
         prepaymentRetainer = await createPrepaymentRetainer(trx, paymentTableFields, -excessToRetainer, `[overpayment excess from payment on ${target.parent.invoice_number}]`);
         paymentTableFields.note = appendNoteMarker(paymentTableFields.note, `[prepayment_retainer:${prepaymentRetainer.retainer_id}]`);
      }

      const payment = await paymentsService.createPayment(trx, {
         ...paymentTableFields,
         customer_invoice_id: snapshot.customer_invoice_id,
         created_at: ledgerNow(trx)
      });

      // Sync the parent invoice row so balance lookups don't see a phantom.
      // total_payments is a NEGATIVE net (same sign convention as the
      // customer_payments rows and the billing engine's paymentTotal), so adding
      // the (post-split) negative payment amount grows its magnitude.
      await applyParentMirror(trx, account_id, invoiceInsertionObject.parent_invoice_id, {
         remaining: invoiceInsertionObject.remaining_balance_on_invoice,
         paymentsDelta: Number(paymentTableFields.payment_amount)
      });

      const message = remapMessage ? `Successfully created payment. ${remapMessage}` : 'Successfully created payment.';
      return {
         message,
         paymentTableFields: { ...paymentTableFields, customer_invoice_id: snapshot.customer_invoice_id },
         payment,
         snapshot,
         prepaymentRetainer,
         retainerDraw
      };
   });

// ── retainer draw / prepayment helpers for update & delete ──────────────────

/**
 * A retainer-funded payment's draw snapshot may be re-priced or removed only
 * while it is the chain's latest row (later draws build on its balance) and no
 * time/charge entry references it (transaction-created 'Retainer' payments are
 * owned by that entry).
 */
const assertRetainerDrawAdjustable = async (trx, accountId, paymentRecord, drawRow) => {
   if (!drawRow) {
      throw ruleError(
         `Could not find the retainer draw recorded with payment #${paymentRecord.payment_id}, so the retainer balance cannot be adjusted automatically. Contact an administrator to reconcile retainer #${paymentRecord.retainer_id}.`
      );
   }

   const [latest] = await retainersService.getMostRecentRecordOfSingleRetainer(trx, accountId, drawRow.retainer_id);
   if (latest && latest.retainer_id !== drawRow.retainer_id) {
      throw ruleError('A newer draw has been made on this retainer since this payment. Edit or delete the newer retainer-funded entries first.');
   }

   const linkedTransaction = await trx('customer_transactions').select('transaction_id').where({ account_id: Number(accountId), retainer_id: drawRow.retainer_id }).first();
   if (linkedTransaction) {
      throw ruleError(`This payment was recorded automatically for retainer-funded time/charge entry #${linkedTransaction.transaction_id}. Edit or delete that entry instead.`);
   }
};

/**
 * The prepayment retainer an overpayment split banked from this payment:
 * `[prepayment_retainer:<id>]` on the note, or — for splits recorded before
 * that marker existed — the one Prepayment root written alongside the payment
 * for the excess amount named in the `[overpayment split: …]` marker. Several
 * legacy candidates are refused rather than guessed.
 */
const findOverpaymentPrepayment = async (trx, accountId, paymentRecord) => {
   const linkedID = parsePrepaymentRetainerId(paymentRecord.note);
   if (linkedID) {
      const row = await trx(RETAINERS).where({ account_id: Number(accountId), retainer_id: linkedID }).first();
      if (!row || Number(row.customer_id) !== Number(paymentRecord.customer_id)) return null;
      // Same defence as the legacy path below: a prepayment already claimed by
      // a DIFFERENT payment's own [prepayment_retainer:N] marker is that
      // payment's, never this one's — otherwise a second payment whose note
      // merely names the same id (typed directly, or manufactured by stripping
      // a nested marker down to something that happens to match) could claim
      // and delete another receipt's already-linked credit.
      const claimedByAnother = await trx(PAYMENTS)
         .where({ account_id: Number(accountId) })
         .andWhere('payment_id', '<>', Number(paymentRecord.payment_id))
         .andWhereRaw(`position('[prepayment_retainer:' || ? || ']' in coalesce(note, '')) > 0`, [Number(linkedID)])
         .first();
      return claimedByAnother ? null : row;
   }

   const excess = parseOverpaymentExcess(paymentRecord.note);
   if (excess == null) return null;

   const rows = await trx(`${RETAINERS} as r`)
      .select('r.*')
      .join(`${PAYMENTS} as p`, function () {
         this.on('p.account_id', '=', 'r.account_id').andOn('p.customer_id', '=', 'r.customer_id');
      })
      .where('p.payment_id', paymentRecord.payment_id)
      .andWhere('r.account_id', Number(accountId))
      .whereNull('r.parent_retainer_id')
      .andWhere('r.type_of_hold', 'Prepayment')
      .andWhere('r.starting_amount', -excess)
      .andWhere('r.note', 'like', '%[overpayment excess from payment on %')
      // A prepayment already linked to a DIFFERENT receipt via its exact
      // [prepayment_retainer:N] marker is that receipt's, never a legacy-window
      // guess for this one — otherwise a forged/coincidental legacy-shaped note
      // on a second payment could claim (and delete) another receipt's banked credit.
      .whereNotExists(function () {
         this.select(trx.raw('1'))
            .from(`${PAYMENTS} as claimed`)
            .whereRaw('claimed.account_id = r.account_id')
            .andWhereRaw('claimed.payment_id <> p.payment_id')
            .andWhereRaw(`position('[prepayment_retainer:' || r.retainer_id || ']' in coalesce(claimed.note, '')) > 0`);
      })
      .andWhereRaw(`r.created_at BETWEEN p.created_at - interval '5 seconds' AND p.created_at + interval '5 seconds'`)
      .orderBy('r.retainer_id');
   if (rows.length > 1) {
      throw ruleError(
         `Payment #${paymentRecord.payment_id} predates exact prepayment linking, and ${rows.length} prepayment retainers (${rows.map(r => `#${r.retainer_id}`).join(', ')}) match its $${excess.toFixed(2)} overpayment, so the one it banked cannot be determined. Nothing was changed — contact an administrator.`
      );
   }
   return rows[0] || null;
};

const moneyText = n => `$${Math.abs(round2(n)).toFixed(2)}`;

/**
 * How far an overpayment prepayment has been used. `untouched` = a lone root
 * whose balance still equals its starting amount and that no transaction or
 * payment references. `cancelledBy` = the payment whose NSF reversal zeroed it.
 */
const assessPrepaymentUse = async (trx, accountId, prepayment) => {
   const rootID = prepayment.parent_retainer_id || prepayment.retainer_id;
   const chain = await retainersService.getRetainerChain(trx, accountId, rootID);
   const refs = await retainersService.getRetainerChainReferences(
      trx,
      accountId,
      chain.map(r => r.retainer_id),
      null
   );
   const latest = chain[chain.length - 1] || prepayment;
   const starting = round2(Number(prepayment.starting_amount));
   const current = round2(Number(latest.current_amount));
   const untouched = chain.length === 1 && current === starting && !refs.transactions.length && !refs.payments.length;

   const uses = [];
   const drawn = round2(Math.abs(starting) - Math.abs(current));
   if (drawn > 0) uses.push(`${moneyText(drawn)} drawn`);
   if (chain.length > 1) uses.push(`${chain.length - 1} draw${chain.length === 2 ? '' : 's'} recorded`);
   if (refs.transactions.length) uses.push(`${refs.transactions.length} time/charge entr${refs.transactions.length === 1 ? 'y' : 'ies'} linked`);
   if (refs.payments.length) uses.push(`${refs.payments.length} payment${refs.payments.length === 1 ? '' : 's'} linked`);

   return { chain, refs, latest, untouched, usage: uses.join(', '), cancelledBy: parseCancelledByReversal(prepayment.note) };
};

/**
 * Deleting a split payment takes its prepayment with it — but only while the
 * prepayment is untouched (no draws, balance == starting amount, nothing
 * references it). A used prepayment blocks the delete: the excess has already
 * been spent on the customer's account. Validates only; returns the row the
 * caller deletes (or null when the payment banked no prepayment).
 */
const planOverpaymentPrepaymentRelease = async (trx, accountId, paymentRecord) => {
   const prepayment = await findOverpaymentPrepayment(trx, accountId, paymentRecord);
   if (!prepayment) return null;

   const use = await assessPrepaymentUse(trx, accountId, prepayment);
   if (use.cancelledBy === Number(paymentRecord.payment_id)) {
      throw ruleError(
         `Payment #${paymentRecord.payment_id} has been reversed and prepayment retainer #${prepayment.retainer_id} banked from its overpayment was cancelled with it. Delete the reversal first, then retry.`
      );
   }
   if (!use.untouched) {
      throw ruleError(
         `The ${moneyText(prepayment.starting_amount)} prepayment retainer #${prepayment.retainer_id} banked from this payment's overpayment has already been used. Reverse or delete the entries drawn from it first, then retry.`
      );
   }
   return prepayment;
};

/**
 * NSF reversal of an overpayment split: the bounced check never funded the
 * excess either, so its prepayment retainer must stop being spendable in the
 * same transaction. Untouched → cancelled (zeroed, deactivated, stamped
 * `[cancelled by reversal of payment #<id>]`; starting_amount keeps the banked
 * amount so deleting the reversal can restore it exactly). Already drawn on →
 * the reversal is refused: there is no automatic compensation for spent excess.
 * Validates only; returns `{ prepayment, alreadyCancelled }` or null.
 */
const planOverpaymentPrepaymentCancel = async (trx, accountId, original) => {
   const prepayment = await findOverpaymentPrepayment(trx, accountId, original);
   if (!prepayment) return null;

   const use = await assessPrepaymentUse(trx, accountId, prepayment);
   // A reversal of this payment already cancelled it (and was removed without
   // restoring it): the excess is already unspendable — leave it as it is.
   if (use.cancelledBy === Number(original.payment_id) && use.chain.length === 1 && round2(prepayment.current_amount) === 0) {
      return { prepayment, alreadyCancelled: true };
   }
   if (!use.untouched) {
      throw ruleError(
         `Cannot reverse payment #${original.payment_id}: ${moneyText(prepayment.starting_amount)} of this payment was banked as prepayment retainer #${prepayment.retainer_id} (overpayment excess), ` +
            `and that prepayment has already been used (${use.usage || 'balance changed'}). Adjust the retainer first — delete or reverse the entries drawn from retainer #${prepayment.retainer_id} ` +
            `so its balance is back to ${moneyText(prepayment.starting_amount)} — then retry the reversal.`
      );
   }
   return { prepayment, alreadyCancelled: false };
};

const applyOverpaymentPrepaymentCancel = async (trx, accountId, original, { prepayment, alreadyCancelled }) => {
   if (alreadyCancelled) return prepayment;
   const patch = { current_amount: 0, is_retainer_active: false, note: appendNoteMarker(prepayment.note, cancelledByReversalMarker(original.payment_id)) };
   await trx(RETAINERS).where({ account_id: Number(accountId), retainer_id: prepayment.retainer_id }).update(patch);
   return { ...prepayment, ...patch };
};

/**
 * Deleting an NSF reversal un-does it, including the prepayment cancellation:
 * the prepayment retainer returns to its banked amount and loses the
 * `[cancelled by reversal of payment #<id>]` marker. Reversals recorded before
 * reversals cancelled prepayments left it active — nothing to restore then.
 * Validates only; returns `{ prepayment, marker }` or null.
 */
const planCancelledPrepaymentRestore = async (trx, accountId, reversalRecord) => {
   const link = parseReversalOf(reversalRecord.note);
   if (!link) return null;
   const original = await trx(PAYMENTS).where({ account_id: Number(accountId), payment_id: link.paymentId }).first();
   if (!original || Number(original.payment_amount) >= 0) return null;

   const prepayment = await findOverpaymentPrepayment(trx, accountId, original);
   if (!prepayment) return null;
   const marker = cancelledByReversalMarker(original.payment_id);
   if (!(prepayment.note || '').includes(marker)) return null;

   const use = await assessPrepaymentUse(trx, accountId, prepayment);
   if (use.chain.length !== 1 || round2(prepayment.current_amount) !== 0 || use.refs.transactions.length || use.refs.payments.length) {
      throw ruleError(
         `Prepayment retainer #${prepayment.retainer_id} was cancelled by this reversal and has changed since, so it cannot be restored automatically. Nothing was changed — contact an administrator to reconcile retainer #${prepayment.retainer_id}.`
      );
   }
   return { prepayment, marker };
};

const applyCancelledPrepaymentRestore = async (trx, accountId, { prepayment, marker }) => {
   const starting = round2(Number(prepayment.starting_amount));
   const patch = { current_amount: starting, is_retainer_active: starting < 0, note: removeNoteMarker(prepayment.note, marker) };
   await trx(RETAINERS).where({ account_id: Number(accountId), retainer_id: prepayment.retainer_id }).update(patch);
   return { ...prepayment, ...patch };
};

/**
 * Deleting a reversal row un-does the reversal, so the original payment must
 * lose its `[reversed …]` marker (reversePayment refuses marked payments, which
 * made an un-reversed payment impossible to reverse again).
 */
const clearReversalMarker = async (trx, accountId, reversalRecord) => {
   const link = parseReversalOf(reversalRecord.note);
   if (!link) return null;

   const original = await trx(PAYMENTS).where({ account_id: Number(accountId), payment_id: link.paymentId }).first();
   if (!original || !original.note) return null;

   const note = stripReversedMarker(original.note, link.reason);
   if (note === original.note) return null;
   await trx(PAYMENTS).where({ account_id: Number(accountId), payment_id: original.payment_id }).update({ note });
   return original.payment_id;
};

// ── delete / update / reverse ────────────────────────────────────────────────

/**
 * Delete a payment: its snapshot (latest-on-chain only), the parent mirror,
 * its exact retainer draw (retainer-funded payments only), the untouched
 * prepayment its overpayment banked, and — for a reversal row — the
 * `[reversed …]` marker on the original plus the prepayment the reversal
 * cancelled. Every refusal is decided before the first write. One
 * transaction, under the customer's ledger lock.
 */
const deletePaymentCore = (db, { accountId, paymentId }) =>
   withTransaction(db, async trx => {
      await lockCustomerLedgerForRow(trx, accountId, PAYMENTS, 'payment_id', paymentId, 'No matching payment record found.');
      const { paymentRecord, paymentInvoiceRecord, newestParent } = await checkIfPaymentIsAttachedToInvoice(trx, { payment_id: Number(paymentId), account_id: Number(accountId) });
      const isReversal = Number(paymentRecord.payment_amount) > 0;

      if (paymentInvoiceRecord && Number(paymentInvoiceRecord.customer_id) !== Number(paymentRecord.customer_id)) {
         throw ruleError(`Payment #${paymentRecord.payment_id} is linked to invoice ${paymentInvoiceRecord.invoice_number} of a different customer. Contact an administrator to correct the link.`);
      }

      // Refuse out-of-order deletion: snapshots created after this payment
      // already bake its reduction into their remaining balance, so removing
      // an earlier payment would leave the chain telling two different stories.
      if (paymentInvoiceRecord?.parent_invoice_id) {
         const latestChild = await getLatestChainRow(trx, accountId, paymentInvoiceRecord.parent_invoice_id);
         if (latestChild && latestChild.customer_invoice_id !== paymentInvoiceRecord.customer_invoice_id) {
            throw ruleError('A newer payment or write-off has been applied to this invoice since this payment. Delete the newer entries first, then retry.');
         }
      }

      if (!isReversal) await assertNotReversed(trx, accountId, paymentRecord, 'delete');

      // Retainer-funded payment: exactly the draw snapshot this payment created
      // (a child row of its own chain) — the retainer gets its balance back.
      const retainerDraw = paymentRecord.retainer_id ? await loadRetainerDrawForMutation(trx, accountId, paymentRecord, newestParent) : null;
      if (paymentRecord.retainer_id) await assertRetainerDrawAdjustable(trx, accountId, paymentRecord, retainerDraw);

      // Only an ordinary (negative) payment can have banked an overpayment; a
      // reversal row's note is `[reversal of payment #N] <user reason>`.
      const prepaymentToRelease = isReversal ? null : await planOverpaymentPrepaymentRelease(trx, accountId, paymentRecord);
      const prepaymentToRestore = isReversal ? await planCancelledPrepaymentRestore(trx, accountId, paymentRecord) : null;

      // ── writes ──
      if (retainerDraw) await retainersService.deleteRetainer(trx, retainerDraw.retainer_id, accountId);
      if (prepaymentToRelease) await retainersService.deleteRetainer(trx, prepaymentToRelease.retainer_id, accountId);

      // Reverse the parent-invoice sync that createPayment applied, then drop
      // the snapshot. The parent mirror returns to the chain's state before this
      // payment (the deleted snapshot's remaining minus this payment's signed
      // amount — a reversal row is positive, so deleting it lowers the balance).
      // Legacy payments (pre-snapshot era) point directly at the PARENT invoice
      // row — never delete that row, it IS the customer's invoice.
      if (paymentInvoiceRecord?.parent_invoice_id) {
         const remainingBefore = round2(Number(paymentInvoiceRecord.remaining_balance_on_invoice) - Number(paymentRecord.payment_amount));
         await applyParentMirror(trx, accountId, paymentInvoiceRecord.parent_invoice_id, {
            remaining: remainingBefore,
            // Negative net: creation added the signed amount; deletion removes it.
            paymentsDelta: -Number(paymentRecord.payment_amount)
         });
         await invoiceService.deleteInvoice(trx, paymentInvoiceRecord.customer_invoice_id, accountId);
      }

      await paymentsService.deletePayment(trx, paymentRecord.payment_id, accountId);

      let restoredPrepayment = null;
      if (isReversal) {
         await clearReversalMarker(trx, accountId, paymentRecord);
         if (prepaymentToRestore) restoredPrepayment = await applyCancelledPrepaymentRestore(trx, accountId, prepaymentToRestore);
      }

      const message = prepaymentToRelease
         ? `Successfully deleted payment. Also removed the $${Math.abs(round2(prepaymentToRelease.starting_amount)).toFixed(2)} prepayment retainer banked from its overpayment.`
         : 'Successfully deleted payment.';
      return { message, paymentRecord, releasedPrepayment: prepaymentToRelease, restoredPrepayment, retainerDraw };
   });

/**
 * Update a payment. Linkage (customer, invoice snapshot, retainer, creator) is
 * server-owned; an amount change re-prices the payment's snapshot (latest on
 * its chain only), the parent mirror, and — for retainer-funded payments — its
 * exact retainer draw snapshot, all in one transaction. Every refusal is
 * decided before the first write.
 */
const updatePaymentCore = (db, { accountId, paymentFields }) =>
   withTransaction(db, async trx => {
      const paymentId = Number(paymentFields.payment_id);
      await lockCustomerLedgerForRow(trx, accountId, PAYMENTS, 'payment_id', paymentId, 'No matching payment record found.');

      // If payment is invoiced, do not allow update
      const { paymentRecord, paymentInvoiceRecord, newestParent } = await checkIfPaymentIsAttachedToInvoice(trx, { payment_id: paymentId, account_id: Number(accountId) });

      if (Number(paymentRecord.payment_amount) >= 0) {
         throw ruleError('Reversal entries cannot be edited. Delete the reversal and re-enter it if the amount or reason was wrong.');
      }

      // Reassigning a payment cannot be expressed as a balance edit (two chains /
      // customers / retainers would need correcting) — delete and re-enter.
      if (paymentFields.customer_invoice_id && paymentRecord.customer_invoice_id && Number(paymentFields.customer_invoice_id) !== Number(paymentRecord.customer_invoice_id)) {
         throw ruleError('Moving a payment to a different invoice is not supported. Delete the payment and re-enter it against the correct invoice.');
      }
      if (Number.isInteger(paymentFields.customer_id) && paymentFields.customer_id > 0 && paymentFields.customer_id !== Number(paymentRecord.customer_id)) {
         throw ruleError('Moving a payment to a different customer is not supported. Delete the payment and re-enter it for the correct customer.');
      }
      if (paymentFields.retainer_id && Number(paymentFields.retainer_id) !== Number(paymentRecord.retainer_id)) {
         throw ruleError('Changing the retainer that funded a payment is not supported. Delete the payment and re-enter it.');
      }
      if (paymentInvoiceRecord && Number(paymentInvoiceRecord.customer_id) !== Number(paymentRecord.customer_id)) {
         throw ruleError(`Payment #${paymentRecord.payment_id} is linked to invoice ${paymentInvoiceRecord.invoice_number} of a different customer. Contact an administrator to correct the link.`);
      }

      await assertPaymentJobOwner(trx, accountId, paymentRecord.customer_id, paymentFields.customer_job_id);

      const newAmount = round2(Math.abs(Number(paymentFields.payment_amount)));
      if (!(newAmount > 0)) throw ruleError('Payment amount must be greater than $0.00.', 400);
      const amountDelta = round2(newAmount - Math.abs(Number(paymentRecord.payment_amount)));

      if (amountDelta !== 0) {
         await assertNotReversed(trx, accountId, paymentRecord, 'edit');

         let snapshotPlan = null;
         if (paymentInvoiceRecord) {
            if (!paymentInvoiceRecord.parent_invoice_id) {
               throw ruleError(`This payment is linked directly to invoice ${paymentInvoiceRecord.invoice_number} and cannot be re-priced. Delete it and re-enter it.`);
            }

            // The payment's snapshot row carries the chain's remaining as of this
            // payment. Only the latest snapshot may be re-priced — later snapshots
            // already build on this one.
            const latestChild = await getLatestChainRow(trx, accountId, paymentInvoiceRecord.parent_invoice_id);
            if (latestChild && latestChild.customer_invoice_id !== paymentInvoiceRecord.customer_invoice_id) {
               throw ruleError('A newer payment or write-off has been applied to this invoice since this payment. Edit or delete the newer entries first.');
            }

            const snapshotRemaining = Number(paymentInvoiceRecord.remaining_balance_on_invoice);
            const newRemaining = round2(snapshotRemaining - amountDelta);
            if (newRemaining < 0) {
               throw ruleError(`Payment amount exceeds remaining balance on invoice ${paymentInvoiceRecord.invoice_number}. Max increase is $${snapshotRemaining}.`);
            }
            snapshotPlan = { newRemaining };
         }

         let drawPlan = null;
         if (paymentRecord.retainer_id) {
            const retainerDraw = await loadRetainerDrawForMutation(trx, accountId, paymentRecord, newestParent);
            await assertRetainerDrawAdjustable(trx, accountId, paymentRecord, retainerDraw);
            const newCurrent = round2(Number(retainerDraw.current_amount) + amountDelta);
            if (newCurrent > 0) {
               const maxIncrease = round2(Math.abs(Number(retainerDraw.current_amount)));
               throw ruleError(`Payment amount exceeds remaining balance on retainer. Max increase is $${maxIncrease}.`);
            }
            drawPlan = { retainerDraw, newCurrent };
         }

         // ── writes ──
         if (snapshotPlan) {
            await setSnapshotRemaining(trx, accountId, paymentInvoiceRecord.customer_invoice_id, snapshotPlan.newRemaining);
            // Mirror the corrected balance onto the parent row (AR/profile reads).
            // Negative net: growing the payment (amountDelta > 0) makes
            // total_payments more negative, shrinking it less negative.
            await applyParentMirror(trx, accountId, paymentInvoiceRecord.parent_invoice_id, { remaining: snapshotPlan.newRemaining, paymentsDelta: -amountDelta });
         }
         if (drawPlan) {
            await trx(RETAINERS)
               .where({ account_id: Number(accountId), retainer_id: drawPlan.retainerDraw.retainer_id })
               .update({ current_amount: drawPlan.newCurrent, is_retainer_active: drawPlan.newCurrent < 0 });
         }
      }

      // Only client-editable columns. customer / invoice / retainer linkage and
      // created_by are server-owned; system note markers survive note edits and
      // link markers cannot be added through one.
      const patch = {
         payment_amount: -newAmount,
         form_of_payment: paymentFields.form_of_payment,
         payment_reference_number: paymentFields.payment_reference_number,
         is_transaction_billable: paymentFields.is_transaction_billable,
         customer_job_id: paymentFields.customer_job_id,
         note: paymentFields.note === undefined ? undefined : preserveSystemMarkers(paymentRecord.note, paymentFields.note)
      };
      if (paymentFields.payment_date && dayjs(paymentFields.payment_date).isValid()) patch.payment_date = paymentFields.payment_date;
      await trx(PAYMENTS).where({ account_id: Number(accountId), payment_id: paymentId }).update(patch);

      return { message: 'Successfully updated payment.', paymentRecord };
   });

/**
 * Reverse a payment (NSF / bounced check). Billed payments are immutable, so a
 * reversal is a NEW ledger event: a POSITIVE payment row restoring the debt on
 * the customer's CURRENT chain via snapshot + parent mirror, with both rows
 * cross-annotated. The audit engine sums payments sign-aware, so positive rows
 * un-pay. No overpayment cap — restoring debt has no ceiling.
 *
 * An overpayment split is reversed as a whole: the applied part restores debt,
 * and the prepayment retainer that banked the excess (`[prepayment_retainer:<id>]`)
 * is cancelled while untouched — or the reversal is refused when it has already
 * been drawn on. Deleting the reversal restores both.
 *
 * `userId` must be the AUTHENTICATED user (the router passes req.user.user_id,
 * never the URL :userID) — it is the reversal row's created_by_user_id.
 *
 * Returns `{ message, reversalFields, reversal, cancelledPrepayment }`.
 */
const reversePayment = async (db, { accountId, userId, paymentId, reason }) => {
   if (!paymentId) throw ruleError('No payment ID provided for the reversal.', 400);
   // The reason is embedded in both notes; it must not smuggle in link markers.
   const cleanReason = String(stripLinkMarkers(reason || '') || '').trim();
   if (!cleanReason) throw ruleError('A reversal reason is required (e.g. "NSF — check #1234 returned").', 400);
   const recordedBy = Number(userId);
   if (!Number.isInteger(recordedBy) || recordedBy <= 0) throw ruleError('The user recording the reversal could not be identified.', 401);

   return withTransaction(db, async trx => {
      await lockCustomerLedgerForRow(trx, accountId, PAYMENTS, 'payment_id', paymentId, 'No matching payment record found.');
      const [original] = await paymentsService.getSinglePayment(trx, paymentId, accountId);

      if (Number(original.payment_amount) >= 0) throw ruleError('This entry is already a reversal and cannot be reversed.');
      if ((original.note || '').includes('[reversed ')) throw ruleError('This payment has already been reversed.');
      // The note marker can be edited away; the reversal row cannot.
      if (await findReversalOf(trx, accountId, paymentId)) throw ruleError('This payment has already been reversed.');
      if (original.retainer_id) throw ruleError('Retainer-funded payments cannot be reversed here — adjust the retainer instead.');

      const amount = round2(Math.abs(Number(original.payment_amount)));

      const targets = await getCurrentChainTargets(trx, accountId, original.customer_id);
      if (!targets.length) throw ruleError('This customer has no invoices; the reversal has nowhere to restore the balance.');
      const target = targets.reduce((best, t) => (t.remaining > best.remaining ? t : best), targets[0]);

      // Decided before any write: a drawn-on prepayment refuses the reversal.
      const prepaymentPlan = await planOverpaymentPrepaymentCancel(trx, accountId, original);

      const reversalFields = {
         customer_id: original.customer_id,
         account_id: accountId,
         customer_job_id: original.customer_job_id || null,
         retainer_id: null,
         payment_date: new Date(),
         payment_amount: amount, // POSITIVE: restores debt
         form_of_payment: 'Reversal',
         payment_reference_number: original.payment_reference_number || null,
         is_transaction_billable: true,
         created_by_user_id: recordedBy,
         note: `[reversal of payment #${paymentId}] ${cleanReason}`
      };

      const { paymentInsertionObject, invoiceInsertionObject } = updateObjectsWithRemainingAmounts({ ...target.latestRow }, reversalFields);
      const newInvoiceRecord = await invoiceService.createInvoice(trx, { ...invoiceInsertionObject, created_at: ledgerNow(trx) });
      const reversal = await paymentsService.createPayment(trx, { ...paymentInsertionObject, customer_invoice_id: newInvoiceRecord.customer_invoice_id, created_at: ledgerNow(trx) });

      // Parent mirror: balance went UP; net payments went DOWN (the positive
      // reversal shrinks the magnitude of the negative net).
      await applyParentMirror(trx, accountId, invoiceInsertionObject.parent_invoice_id, {
         remaining: invoiceInsertionObject.remaining_balance_on_invoice,
         paymentsDelta: amount
      });

      // The excess the bounced check "banked" never existed either.
      const cancelledPrepayment = prepaymentPlan ? await applyOverpaymentPrepaymentCancel(trx, accountId, original, prepaymentPlan) : null;

      // Cross-annotate the original so it can't be reversed twice.
      await paymentsService.updatePayment(
         trx,
         { payment_id: paymentId, note: `${original.note ? `${original.note} ` : ''}[reversed ${new Date().toISOString().slice(0, 10)}: ${cleanReason}]` },
         accountId
      );

      return {
         message: `Reversed payment #${paymentId}: $${amount.toFixed(2)} restored to ${target.parent.invoice_number}.`,
         reversalFields,
         reversal,
         cancelledPrepayment
      };
   });
};

module.exports = {
   getCurrentChainTargets,
   selectLiveChainTargets,
   pickCurrentChainTarget,
   getInvoiceRow,
   getLatestChainRow,
   getNewestParentInvoice,
   applyParentMirror,
   setSnapshotRemaining,
   updateObjectsWithRemainingAmounts,
   checkIfPaymentIsAttachedToInvoice,
   resolveRetainerDrawForPayment,
   buildLedgerTablesPayload,
   returnTablesWithSuccessResponse,
   buildCreatePaymentInput,
   createPaymentCore,
   updatePaymentCore,
   deletePaymentCore,
   reversePayment
};
