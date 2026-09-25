const internalCustomers = require('../timesheets/internal-customers');
const { validateTransactionPrice } = require('./transactionPricing');
const { requireAccountRow } = require('../../utils/relatedAccount');
const dayjs = require('dayjs');
const transactionsService = require('./transactions-service');
const retainerService = require('../retainer/retainer-service');
const jobService = require('../job/job-service');
const paymentsService = require('../payments/payments-service');
const {
   round2,
   withTransaction,
   ledgerNow,
   ruleError,
   isLedgerRowBilled,
   retainerDrawMarker,
   parseRetainerDrawId,
   resolveRetainerDrawForPayment,
   lockCustomerLedger
} = require('../payments/ledger-helpers');
const { getNewestParentInvoice } = require('../payments/payment-logic');
const { restoreDataTypesTransactionsTableOnCreate, restoreDataTypesTransactionsTableOnUpdate, normalizeTransactionType } = require('./transactionsObjects');
const aiCategoryTrainingService = require('../aiIntegration/ai-category-training-service');

/*
 * Time / charge entries on the customer ledger
 * ────────────────────────────────────────────
 * Create, update and delete each run in ONE knex transaction that first takes
 * the customer's ledger lock (the customer-row lock payments, write-offs,
 * retainers and finalize take — see lockTransactionLedger for the lock mode)
 * and only THEN reads the stored rows it decides on: billed status, amounts,
 * retainer balances. Job totals, the retainer draw, the auto 'Retainer' payment
 * and the transaction row commit or roll back together. Callers that already
 * hold a transaction (time-tracker ingestion, held-entry apply) are joined.
 *
 * Retainer funding. A billable entry that selects a retainer/prepayment draws
 * its amount from that retainer chain (a draw-down snapshot row) and gets an
 * auto-created 'Retainer' payment that credits the next statement. The link is
 * exact:
 *    customer_transactions.retainer_id  = the draw snapshot id D
 *    customer_payments.note             carries `[retainer_draw:D]`
 * (marker + resolveRetainerDrawForPayment are shared with the payments module,
 * which therefore sends edits/deletes of these payments back to the entry).
 * Funding follows the entry's billable contribution, not just its amount:
 *    funded  ⇔  billable ∧ retainer selected ∧ amount > $0
 * Making a funded entry non-billable (or $0) removes exactly its draw and its
 * payment; making an unfunded entry billable with a retainer funds it; amount,
 * date and job edits keep the payment in step. The retainer chain must belong
 * to the entry's own customer. Entries funded before the marker existed are
 * matched on customer / chain / amount / date (an ambiguous match is refused)
 * and their retainer is corrected with a compensating snapshot.
 */

const TRANSACTIONS = 'customer_transactions';
const PAYMENTS = 'customer_payments';
const RETAINERS = 'customer_retainers_and_prepayments';

const RETAINER_CHANGE_MESSAGE = 'Please contact support. Retainer/ Prepayment change not allowed at this time.';
const RETAINER_REMOVE_MESSAGE =
   'This entry is paid from a retainer/prepayment. Removing the retainer from it is not supported — mark the entry non-billable (which returns the amount to the retainer), or delete it and re-enter it.';
const BILLED_PAYMENT_MESSAGES = {
   update: 'The retainer payment linked to this transaction has already been billed; the amount, date and job can no longer change. Contact support.',
   unfund: 'The retainer payment linked to this transaction has already been billed; the entry can no longer be made non-billable or $0. Contact support.',
   delete: 'The retainer payment linked to this transaction has already been billed and cannot be removed. Contact support.'
};
const NO_PAYMENT_WARNING = 'This transaction is linked to a retainer but no matching retainer payment record was found; nothing to sync.';

/**
 * Calendar date (YYYY-MM-DD) of a DATE value. node-pg returns DATE columns as
 * a local-midnight Date, so the local calendar date is the stored one.
 */
const toCalendarDate = value => {
   if (value == null || value === '') return null;
   if (value instanceof Date) return dayjs(value).format('YYYY-MM-DD');
   const text = String(value);
   return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : dayjs(text).format('YYYY-MM-DD');
};

/**
 * An auto 'Retainer' payment is billed once finalize linked it to a statement,
 * or when it was written at or before the customer's newest statement (the
 * payments module's billed gate — compared inside Postgres, microsecond-exact).
 */
const isPaymentBilled = async (trx, payment, newestParent) =>
   payment.customer_invoice_id != null || isLedgerRowBilled(trx, payment.account_id, { table: PAYMENTS, id: payment.payment_id }, newestParent);

/**
 * Cross-customer job guard: verifies the given customer_job_id actually
 * belongs to the given customer (and account). Without this, a job picked
 * for one customer could be attached to another customer's transaction (a
 * data-entry artifact the billing engine then has to work around).
 * @param {*} db
 * @param {*} customerJobID
 * @param {*} customerID
 * @param {*} accountID
 * @returns the job row, for callers that want it
 */
const assertJobBelongsToCustomer = async (db, customerJobID, customerID, accountID) => {
   const [job] = await jobService.getSingleJob(db, customerJobID, accountID);
   if (!job) throw new Error('Selected job was not found.');
   if (Number(job.customer_id) !== Number(customerID)) {
      throw new Error('Selected job does not belong to this customer.');
   }
   return job;
};

// ── retainer chain ───────────────────────────────────────────────────────────

const copyableRetainerFields = row => {
   const { retainer_id: _id, created_at: _createdAt, rn: _rn, ...fields } = row;
   return fields;
};

/**
 * Every row of the retainer chain `retainerId` belongs to (root + draw-down
 * snapshots, oldest first). Refused unless the WHOLE chain belongs to this
 * customer of this account — a transaction may only ever spend its own
 * customer's retainer. A picker id, a stored draw id and a payment's retainer
 * id all resolve to the same chain.
 */
const loadOwnedRetainerChain = async (trx, { accountId, customerId, retainerId }) => {
   const rootId = await retainerService.resolveRetainerRootID(trx, Number(accountId), retainerId);
   const chain = rootId ? await retainerService.getRetainerChain(trx, Number(accountId), rootId) : [];
   if (!chain.length) throw ruleError('Retainer was not found.', 404);
   if (chain.some(row => Number(row.customer_id) !== Number(customerId) || Number(row.account_id) !== Number(accountId))) {
      throw ruleError('The selected retainer/prepayment belongs to a different customer than this transaction.');
   }
   return { rootId: Number(rootId), chain, latest: chain[chain.length - 1] };
};

/**
 * Validate a new draw against the chain's LATEST balance (the same ownership
 * and availability rules as the payment path's findMatchingRetainer). No writes.
 */
const planRetainerDraw = async (trx, { accountId, customerId, retainerId, amount }) => {
   const { rootId, latest } = await loadOwnedRetainerChain(trx, { accountId, customerId, retainerId });
   const available = round2(Math.max(0, -Number(latest.current_amount)));
   if (!latest.is_retainer_active || available <= 0) {
      throw ruleError('The selected retainer/prepayment has no remaining balance.');
   }
   if (available < round2(amount)) {
      throw ruleError(`Retainer does not have enough balance to cover the transaction. Available: $${available.toFixed(2)}.`);
   }
   return { rootId, latest, amount: round2(amount) };
};

/**
 * Record a planned draw as a new snapshot on the chain (stamped under the
 * lock). `actorId` is the AUTHENTICATED user recording this draw (the
 * caller's actorId, falling back to the stored transaction's creator) —
 * never copied forward from the retainer chain's own creator, which would
 * misattribute this specific draw event to whoever opened the retainer.
 */
const writeRetainerDraw = (trx, { rootId, latest, amount }, actorId) => {
   const next = round2(Number(latest.current_amount) + amount);
   return retainerService.createRetainer(trx, {
      ...copyableRetainerFields(latest),
      created_by_user_id: actorId,
      parent_retainer_id: rootId,
      current_amount: next,
      is_retainer_active: next < 0,
      created_at: ledgerNow(trx)
   });
};

/** Move each row's running balance by `delta` (+ draws more, − gives back). */
const shiftRetainerRows = async (trx, accountId, rows, delta) => {
   const amount = round2(delta);
   if (!amount) return;
   for (const row of rows) {
      const next = round2(Number(row.current_amount) + amount);
      await trx(RETAINERS).where({ account_id: Number(accountId), retainer_id: row.retainer_id }).update({ current_amount: next, is_retainer_active: next < 0 });
   }
};

/** Largest increase every one of `rows` can absorb without a balance going above $0. */
const retainerHeadroom = rows => round2(Math.max(0, Math.min(...rows.map(row => -Number(row.current_amount)))));

/**
 * Legacy entries (no exact draw link): correct the chain with a new snapshot
 * of `delta` on top of its latest balance, exactly as these entries always were.
 * `actorId` is the AUTHENTICATED user recording THIS compensating write (see
 * the created_by_user_id comment on writeRetainerDraw above) — copyableRetainerFields
 * strips retainer_id/created_at/rn but keeps every other column from the
 * chain's latest row, including its created_by_user_id, so without an
 * explicit override here the snapshot would silently inherit whoever created
 * (or last compensated) the chain instead of whoever is acting now.
 */
const appendCompensatingSnapshot = (trx, { chainInfo, delta, actorId }) => {
   const next = round2(Number(chainInfo.latest.current_amount) + round2(delta));
   return retainerService.createRetainer(trx, {
      ...copyableRetainerFields(chainInfo.latest),
      created_by_user_id: Number(actorId),
      parent_retainer_id: chainInfo.rootId,
      current_amount: next,
      is_retainer_active: next < 0,
      created_at: ledgerNow(trx)
   });
};

// ── the auto 'Retainer' payment ──────────────────────────────────────────────

/** The payment a funded entry credits the next statement with. */
const buildAutoRetainerPayment = (transaction, { rootId, drawId }) => ({
   account_id: Number(transaction.account_id),
   customer_id: Number(transaction.customer_id),
   customer_job_id: Number(transaction.customer_job_id) || null,
   retainer_id: rootId,
   customer_invoice_id: null,
   payment_date: toCalendarDate(transaction.transaction_date),
   payment_amount: -round2(transaction.total_transaction),
   form_of_payment: 'Retainer',
   payment_reference_number: 'Retainer',
   is_transaction_billable: true,
   // The actor recording THIS payment, not the entry's logged-for employee —
   // see the created_by_user_id comment on writeRetainerDraw above.
   created_by_user_id: Number(transaction.created_by_user_id),
   note: retainerDrawMarker(drawId)
});

/**
 * Resolves the retainer CHAIN ROOT id for a given retainer row id. Each
 * draw-down against a retainer inserts a NEW ledger row linked to the same
 * chain via parent_retainer_id, so two rows that both belong to the same
 * retainer/prepayment can carry different raw ids. Delegates to
 * retainerService.resolveRetainerRootID, which also handles a root row that
 * no longer exists (surviving snapshots still resolve to the same id).
 * @param {*} db
 * @param {*} accountID
 * @param {*} retainerID
 * @returns {Promise<number|null>}
 */
const resolveRetainerChainRoot = (db, accountID, retainerID) => {
   if (!retainerID) return Promise.resolve(null);
   return retainerService.resolveRetainerRootID(db, accountID, retainerID);
};

/**
 * LEGACY fallback: candidate auto-created 'Retainer' payment(s) for a
 * retainer-funded transaction written before the `[retainer_draw:…]` marker.
 * Correlated by: same account/customer, same retainer CHAIN (the payment kept
 * the retainer id the user selected, which can differ from the transaction's
 * own stored retainer_id), form_of_payment 'Retainer', payment_amount =
 * -total_transaction, and payment_date = transaction_date. Returns EVERY
 * match (including already-billed ones) — callers decide what an unexpected
 * count means.
 * @param {*} db
 * @param {*} transaction - a STORED customer_transactions row (account_id, customer_id, retainer_id, transaction_date, total_transaction)
 * @returns {Promise<Array>}
 */
const findLinkedRetainerPayments = async (db, transaction) => {
   const { account_id, customer_id, retainer_id, transaction_date, total_transaction } = transaction || {};
   if (!retainer_id) return [];

   const chainRoot = await resolveRetainerChainRoot(db, account_id, retainer_id);
   if (chainRoot == null) return [];

   const candidates = await db
      .select('customer_payments.*')
      .from('customer_payments')
      .where('customer_payments.account_id', account_id)
      .andWhere('customer_payments.customer_id', customer_id)
      .andWhere('customer_payments.form_of_payment', 'Retainer')
      .andWhere('customer_payments.payment_amount', -Math.abs(Number(total_transaction)))
      .andWhere('customer_payments.payment_date', toCalendarDate(transaction_date));

   const matches = [];
   for (const payment of candidates) {
      const paymentChainRoot = await resolveRetainerChainRoot(db, account_id, payment.retainer_id);
      if (paymentChainRoot != null && paymentChainRoot === chainRoot) matches.push(payment);
   }
   return matches;
};

/**
 * The auto-created 'Retainer' payment of a funded (STORED) transaction:
 *  - exact:  the one payment of this customer whose note carries
 *            `[retainer_draw:<transaction.retainer_id>]`
 *  - legacy: findLinkedRetainerPayments, never a payment that carries some
 *            other draw's marker
 * Returns `{ payment, exact, warning }`; more than one candidate is refused —
 * we cannot tell which payment belongs to this entry. No billed checks here.
 * (A legacy entry's retainer is corrected with a compensating snapshot, so
 * no existing draw row has to be identified for it.)
 */
const resolveAutoRetainerPayment = async (db, transaction) => {
   if (!transaction?.retainer_id) return { payment: null, exact: false, warning: null };

   const marker = retainerDrawMarker(transaction.retainer_id);
   const marked = (
      await db(PAYMENTS)
         .where({ account_id: Number(transaction.account_id), customer_id: Number(transaction.customer_id) })
         .whereRaw("position(? in coalesce(note, '')) > 0", [marker])
   ).filter(payment => String(payment.note || '').includes(marker));
   if (marked.length > 1) {
      throw ruleError(`Multiple payments are linked to this entry's retainer draw #${Number(transaction.retainer_id)} — contact support.`);
   }
   if (marked.length === 1) return { payment: marked[0], exact: true, warning: null };

   const legacy = (await findLinkedRetainerPayments(db, transaction)).filter(payment => parseRetainerDrawId(payment.note) == null);
   if (legacy.length > 1) throw ruleError('Multiple candidate retainer payments found for this transaction — contact support.');
   if (legacy.length === 1) return { payment: legacy[0], exact: false, warning: null };
   return { payment: null, exact: false, warning: NO_PAYMENT_WARNING };
};

/**
 * Resolves the single linked 'Retainer' payment for a retainer-funded
 * transaction under the safety contract callers need before mutating it:
 *  - > 1 candidate match => throws (we cannot safely guess).
 *  - exactly 1 match that is already linked to an invoice => throws.
 *  - exactly 1 match, unbilled => returned as `payment`.
 *  - 0 matches => `payment: null` plus a `warning` string.
 * @param {*} db
 * @param {*} transaction - a STORED customer_transactions row
 * @param {*} options.refuseIfBilledMessage - error message when the single match is already billed
 */
const resolveLinkedRetainerPayment = async (db, transaction, { refuseIfBilledMessage } = {}) => {
   if (!transaction?.retainer_id) return { payment: null, warning: null };
   const { payment, warning } = await resolveAutoRetainerPayment(db, transaction);
   if (payment && payment.customer_invoice_id != null) {
      throw new Error(refuseIfBilledMessage || 'The retainer payment linked to this transaction has already been billed. Contact support.');
   }
   return { payment, warning };
};

/**
 * The draw snapshot of an EXACTLY linked funded entry, checked before it is
 * re-priced or removed: a draw-down row of the entry's chain whose own
 * movement equals the entry's amount, referenced by no other entry, and not on
 * a statement yet. Anything else means the ledger no longer says what the
 * marker claims — refuse rather than guess.
 */
const inspectExactDraw = async (trx, { stored, chain, newestParent }) => {
   const drawId = Number(stored.retainer_id);
   const index = chain.findIndex(row => Number(row.retainer_id) === drawId);
   const refuse = reason => ruleError(`The retainer draw #${drawId} recorded for this entry ${reason}. Contact support to reconcile it.`);
   if (index <= 0 || !chain[index].parent_retainer_id) throw refuse('is not a draw-down row of its retainer');

   const draw = chain[index];
   const amount = round2(stored.total_transaction);
   const movement = round2(Number(draw.current_amount) - Number(chain[index - 1].current_amount));
   if (movement !== amount) throw refuse(`drew $${movement.toFixed(2)}, not this entry's $${amount.toFixed(2)}`);

   const sharers = await trx(TRANSACTIONS).select('transaction_id').where({ account_id: Number(stored.account_id), retainer_id: drawId });
   if (sharers.some(row => Number(row.transaction_id) !== Number(stored.transaction_id))) throw refuse('is also referenced by another entry');

   if (await isLedgerRowBilled(trx, stored.account_id, { table: RETAINERS, id: drawId }, newestParent)) {
      throw ruleError('The retainer draw for this entry is already on a statement and cannot be changed. Contact support.', 423);
   }
   return { index, draw, movement };
};

/**
 * Everything a change to a funded entry needs, resolved and validated with no
 * writes: its payment (refused when billed / ambiguous) and — for an exact
 * link whose draw will move — the inspected draw row.
 */
const resolveFundingLink = async (trx, { stored, chainInfo, movesDraw, billedMessage }) => {
   const { payment, exact, warning } = await resolveAutoRetainerPayment(trx, stored);
   const newestParent = await getNewestParentInvoice(trx, stored.account_id, stored.customer_id);
   if (payment && (await isPaymentBilled(trx, payment, newestParent))) throw ruleError(billedMessage, 423);

   let draw = null;
   if (exact) {
      // The payments module's own resolver must agree that the marker names
      // this entry's draw (a draw row of the payment's chain and customer).
      const markedDraw = await resolveRetainerDrawForPayment(trx, stored.account_id, payment);
      if (!markedDraw || Number(markedDraw.retainer_id) !== Number(stored.retainer_id)) {
         throw ruleError(`Retainer payment #${payment.payment_id} is not linked to this entry's retainer draw. Contact support to reconcile it.`);
      }
      if (round2(-Number(payment.payment_amount)) !== round2(stored.total_transaction)) {
         throw ruleError(`Retainer payment #${payment.payment_id} no longer matches this entry's amount. Contact support to reconcile it.`);
      }
      if (movesDraw) draw = await inspectExactDraw(trx, { stored, chain: chainInfo.chain, newestParent });
   }
   return { payment, exact, warning, draw };
};

/** Refuse an amount increase the retainer cannot cover. */
const assertRetainerCanAbsorb = (chainInfo, link, delta) => {
   if (!(delta > 0)) return;
   const headroom = link.exact ? retainerHeadroom(chainInfo.chain.slice(link.draw.index)) : retainerHeadroom([chainInfo.latest]);
   if (headroom < round2(delta)) {
      throw ruleError(`Edited transaction amount is greater than the current retainer balance. This entry can increase by at most $${headroom.toFixed(2)}.`);
   }
};

/** Re-price a funded entry's draw by `delta` (exact: in place; legacy: compensating snapshot). */
const repriceFundedDraw = (trx, { accountId, chainInfo, link, delta, actorId }) => {
   if (!round2(delta)) return null;
   if (link.exact) return shiftRetainerRows(trx, accountId, chainInfo.chain.slice(link.draw.index), delta);
   return appendCompensatingSnapshot(trx, { chainInfo, delta, actorId });
};

/**
 * Give a funded entry's amount back to its retainer. Exact link: delete the
 * entry's own draw row and lift every later row by the same amount, so every
 * other draw on the chain keeps its own size. Legacy: compensating snapshot.
 */
const reverseFundedDraw = async (trx, { accountId, chainInfo, link, amount, actorId }) => {
   if (link.exact) {
      const { index, draw, movement } = link.draw;
      await shiftRetainerRows(trx, accountId, chainInfo.chain.slice(index + 1), -movement);
      await retainerService.deleteRetainer(trx, draw.retainer_id, accountId);
      return;
   }
   await appendCompensatingSnapshot(trx, { chainInfo, delta: -round2(amount), actorId });
};

/** Keep an auto 'Retainer' payment's amount, date and job equal to its entry's. */
const syncAutoRetainerPayment = (trx, { payment, transaction }) => {
   const patch = {};
   const amount = -round2(transaction.total_transaction);
   if (round2(payment.payment_amount) !== amount) patch.payment_amount = amount;
   const date = toCalendarDate(transaction.transaction_date);
   if (toCalendarDate(payment.payment_date) !== date) patch.payment_date = date;
   const jobId = Number(transaction.customer_job_id) || null;
   if ((Number(payment.customer_job_id) || null) !== jobId) patch.customer_job_id = jobId;
   if (!Object.keys(patch).length) return Promise.resolve(payment);
   return paymentsService.updatePayment(trx, { payment_id: payment.payment_id, ...patch }, transaction.account_id);
};

// ── jobs ─────────────────────────────────────────────────────────────────────

/**
 * Find if the amounts are different between the original and updated
 * transaction and the difference amount. (Read-only helper; the write paths
 * below re-read the stored row under the ledger lock instead.)
 * @param {*} db
 * @param {*} transactionTableFields
 * @returns
 */
const differenceBetweenOldAndNewTransaction = async (db, transactionTableFields, aggregationType) => {
   const { account_id, customer_id, transaction_id } = transactionTableFields;
   // Get original transaction and decide if a positive or negative change in order to update the job record
   const [originalTransaction] = await transactionsService.getSingleTransaction(db, account_id, customer_id, transaction_id);
   if (!originalTransaction || !Object.keys(originalTransaction).length) throw new Error('Transaction was not found.');

   const originalTransactionTotal = Number(originalTransaction?.total_transaction);
   const updatedTransactionTotal = Number(transactionTableFields?.total_transaction);
   const transactionTotalDifference = aggregationType !== 'delete' ? updatedTransactionTotal - originalTransactionTotal : -Math.abs(originalTransactionTotal);
   const areAmountsDifferent = originalTransactionTotal !== updatedTransactionTotal;
   // Whether this update moves the transaction onto a different job. Not
   // meaningful for a delete (there is no "new" job).
   const isJobDifferent = aggregationType !== 'delete' && Number(originalTransaction.customer_job_id) !== Number(transactionTableFields.customer_job_id);

   return { areAmountsDifferent, isJobDifferent, transactionTotalDifference, originalTransaction, originalTransactionTotal, updatedTransactionTotal };
};

/**
 * Find the most recent job and update the job total. Must run BEFORE the
 * transaction row itself is written: the job's transactions are summed as
 * stored, plus this change's delta.
 *
 * Sums the WHOLE version FAMILY (jobService.getJobFamilyIds), not just the
 * one customerJobID passed in: a job's history spans every version row a
 * prior total change created (root + each new row this function itself
 * appends below), and transactions logged against an EARLIER version never
 * move to the newest one — only summing the family gives the true total.
 * @param {*} db
 * @param {*} customerJobID
 * @param {*} accountID
 * @param {*} transactionTotalDifference
 */
const updateRecentJobTotal = async (db, customerJobID, accountID, transactionTotalDifference) => {
   const recentJob = await jobService.getRecentJob(db, customerJobID, accountID);

   if (!recentJob || !Object.keys(recentJob).length) throw new Error('Job was not found.');

   // Grabbing every transaction on any job id in this job's version family to add them all together.
   const familyIds = await jobService.getJobFamilyIds(db, customerJobID, accountID);
   const matchingCustomerJobs = await transactionsService.getTransactionsByJobID(db, accountID, familyIds);
   const transactionTotals = matchingCustomerJobs ? matchingCustomerJobs.map(transaction => Number(transaction.total_transaction)) : 0;
   const totalsWithNewTransactionAmount = transactionTotals.concat(Number(transactionTotalDifference));

   const { parent_job_id } = recentJob;

   const updatedJobAmount = totalsWithNewTransactionAmount.reduce((acc, curr) => acc + curr, 0);
   const parentJobID = !parent_job_id ? customerJobID : parent_job_id;

   // Create new object with updated job total
   const updatedJob = { ...recentJob, parent_job_id: parentJobID, current_job_total: updatedJobAmount, created_at: ledgerNow(db) };

   // Post new Job record
   return jobService.createJob(db, updatedJob);
};

// ── funding decision ─────────────────────────────────────────────────────────

/**
 * What a save does to an entry's retainer funding (pure):
 *   funded now,  saved non-billable or $0      → 'unfund'
 *   funded now,  retainer cleared (billable)   → refused (ambiguous; see message)
 *   funded now,  a retainer still selected     → 'retain' (caller refuses a different chain)
 *   not funded,  billable + retainer + > $0    → 'fund'
 *   otherwise                                  → 'none'
 */
const decideFundingAction = ({ isFunded, isBillable, requestedRetainerId, amount }) => {
   const positive = round2(amount) > 0;
   if (isFunded) {
      if (!isBillable || !positive) return 'unfund';
      if (!requestedRetainerId) throw ruleError(RETAINER_REMOVE_MESSAGE);
      return 'retain';
   }
   return isBillable && requestedRetainerId && positive ? 'fund' : 'none';
};

// ── write paths ──────────────────────────────────────────────────────────────

/**
 * The customer's ledger lock for time/charge writes: the same row, mode
 * (FOR NO KEY UPDATE) and contract as every other ledger writer — see
 * ledger-helpers.lockCustomerLedger for why the mode must not be FOR UPDATE
 * (ingestion claims already hold a key-share lock on the customer row through
 * the timesheet_entries.suggested_customer_id foreign key).
 */
const lockTransactionLedger = (trx, accountId, customerId) => lockCustomerLedger(trx, accountId, customerId);

/**
 * Lock the ledger of the customer that owns the STORED transaction, then
 * re-read the row so every decision below uses what is persisted after any
 * concurrent finalize / edit committed.
 */
const loadStoredTransactionForWrite = async (trx, { accountId, transactionId, customerId, customerMismatchMessage }) => {
   const rowId = Number(transactionId);
   if (!Number.isInteger(rowId) || rowId <= 0) throw ruleError('Transaction was not found.', 404);
   const owner = await trx(TRANSACTIONS).select('customer_id').where({ account_id: Number(accountId), transaction_id: rowId }).first();
   if (!owner) throw ruleError('Transaction was not found.', 404);
   const lockedCustomerId = await lockTransactionLedger(trx, accountId, owner.customer_id);

   const stored = await trx(TRANSACTIONS).where({ account_id: Number(accountId), transaction_id: rowId }).forNoKeyUpdate().first();
   await require('../invoice/sentInvoiceLocks').assertUnlocked(trx, accountId, TRANSACTIONS, rowId);
   if (!stored) throw ruleError('Transaction was not found.', 404);
   if (Number(stored.customer_id) !== lockedCustomerId) {
      throw ruleError('This transaction was changed by someone else while it was being saved. Refresh and try again.', 409);
   }
   if (Number(customerId) !== lockedCustomerId) {
      throw customerMismatchMessage ? ruleError(customerMismatchMessage) : ruleError('Transaction was not found.', 404);
   }
   return stored;
};

/**
 * Record an AI category training example without PII. Runs in a SAVEPOINT:
 * a failed insert must not abort the enclosing ledger transaction (Postgres
 * would refuse every later statement and turn the COMMIT into a rollback).
 */
const recordCategoryTrainingExample = async (trx, input, created) => {
   try {
      const { timesheetEntryID, aiSuggestion } = input || {};
      // Prefer the created record's category; fall back to the incoming selection.
      const finalGwdId = created?.general_work_description_id || Number(input?.selectedGeneralWorkDescriptionID) || null;
      const finalGwdLabel = input?.selectedGeneralWorkDescription?.general_work_description || null;
      if (!created?.transaction_id || !finalGwdId) return;

      const trainingExample = {
         account_id: created.account_id,
         timesheet_entry_id: Number(timesheetEntryID) || null,
         transaction_id: created.transaction_id,
         original_category: input?.category || null,
         suggested_category: aiSuggestion?.suggested_category || null,
         // Prefer label if available, else fall back to ID string
         final_category: finalGwdLabel || String(finalGwdId),
         ai_reason: aiSuggestion?.ai_reason || null,
         ai_confidence: aiSuggestion?.ai_confidence ?? null,
         ai_source: aiSuggestion?.source || 'ai',
         original_notes: null, // do not store raw notes here
         sanitized_notes: aiSuggestion?.sanitized_notes || null,
         duration_minutes: Number(input?.minutes) || null,
         entity: input?.entity || null,
         uploaded_to_vector_store: false
      };

      await trx.transaction(savepoint => aiCategoryTrainingService.insert(savepoint, trainingExample));
   } catch (e) {
      // Non-blocking: training example logging should not fail transaction creation
      console.error(`[${new Date().toISOString()}] Failed to insert AI category training example: ${e.message}`);
   }
};

/**
 * Create a time/charge entry. One transaction under the customer's ledger
 * lock: job guard, retainer ownership/balance, job total, retainer draw, the
 * transaction row and its auto 'Retainer' payment. Shared by the Transactions
 * form, the time-tracker ingestion paths and held-entry apply (which pass
 * their own transaction and are joined).
 * @param {*} db - knex instance or an open knex transaction
 * @param {*} sanitizedNewTransaction - camelCase form body (see restoreDataTypesTransactionsTableOnCreate)
 * @returns the created customer_transactions row
 */
const applyBillabilityPolicy = async (trx, fields) => {
   if (!fields.is_transaction_billable) return;
   const customer = await trx('customers').where({ account_id: fields.account_id, customer_id: fields.customer_id }).first();
   if (!customer || customer.is_billable === false || await internalCustomers.isInternalCustomer(trx, fields.account_id, fields.customer_id)) {
      fields.is_transaction_billable = false;
   }
};

const addNewTransaction = async (db, sanitizedNewTransaction) => {
   // Parse before taking any lock (pure; the transaction_type normaliser
   // throws on bad input). A new entry is never already billed: the invoice
   // link is set only by finalize.
   const fields = { ...restoreDataTypesTransactionsTableOnCreate(validateTransactionPrice(sanitizedNewTransaction || {})), customer_invoice_id: null };

   return withTransaction(db, async trx => {
      const { account_id, customer_id, customer_job_id, retainer_id } = fields;
      const amount = round2(fields.total_transaction);

      await lockTransactionLedger(trx, account_id, customer_id);
      await applyBillabilityPolicy(trx, fields);

      await requireAccountRow(trx, 'users', 'user_id', fields.logged_for_user_id, fields.account_id, 'Employee');
      await requireAccountRow(trx, 'customer_general_work_descriptions', 'general_work_description_id', fields.general_work_description_id, fields.account_id, 'Work description');

      // Cross-customer job guard - refuse before any writes happen.
      await assertJobBelongsToCustomer(trx, customer_job_id, customer_id, account_id);

      // A NON-billable (or $0) entry never draws on a retainer - there is no
      // charge for it to fund. Ownership + balance are validated before any write.
      const drawPlan =
         retainer_id && fields.is_transaction_billable && amount > 0 ? await planRetainerDraw(trx, { accountId: account_id, customerId: customer_id, retainerId: retainer_id, amount }) : null;

      await updateRecentJobTotal(trx, customer_job_id, account_id, fields.total_transaction);

      const draw = drawPlan ? await writeRetainerDraw(trx, drawPlan, fields.created_by_user_id) : null;
      const created = await transactionsService.createTransaction(trx, { ...fields, retainer_id: draw ? draw.retainer_id : null });
      if (draw) {
         await paymentsService.createPayment(trx, { ...buildAutoRetainerPayment(created, { rootId: drawPlan.rootId, drawId: draw.retainer_id }), created_at: ledgerNow(trx) });
      }

      await recordCategoryTrainingExample(trx, sanitizedNewTransaction, created);
      return created;
   });
};

/**
 * Update a time/charge entry. Under the customer's ledger lock the STORED row
 * is re-read and decides everything: billed entries are immutable, the job
 * must belong to the customer, and the retainer funding follows the new
 * billable contribution (see decideFundingAction). Returns
 * `{ transaction, action, warning }`.
 * @param {*} db - knex instance or an open knex transaction
 * @param {*} options.accountId - trusted account (URL param), never the body's
 * @param {*} options.transaction - camelCase form body (see restoreDataTypesTransactionsTableOnUpdate)
 * @param {*} options.actorId - the AUTHENTICATED user making this edit (req.user.user_id);
 *    recorded as the creator of any NEW draw/payment this edit writes (a 'fund'
 *    action). Falls back to the stored transaction's own creator for internal
 *    callers with no request identity. Never affects the transaction row's own
 *    created_by_user_id, which restoreDataTypesTransactionsTableOnUpdate omits
 *    entirely so an edit can never overwrite the original creator.
 */
const updateTransactionCore = async (db, { accountId, transaction, actorId }) => {
   const fields = { ...restoreDataTypesTransactionsTableOnUpdate(validateTransactionPrice(transaction || {})), account_id: Number(accountId) };

   return withTransaction(db, async trx => {
      const accountID = fields.account_id;
      const stored = await loadStoredTransactionForWrite(trx, {
         accountId: accountID,
         transactionId: fields.transaction_id,
         customerId: fields.customer_id,
         customerMismatchMessage: 'Moving a transaction to a different customer is not supported. Delete it and re-enter it for the correct customer.'
      });

      // If the STORED transaction is attached to an invoice, do not allow update.
      if (stored.customer_invoice_id) throw ruleError('Transaction is attached to an invoice and cannot be updated.', 423);

      await requireAccountRow(trx, 'users', 'user_id', fields.logged_for_user_id, fields.account_id, 'Employee');
      await requireAccountRow(trx, 'customer_general_work_descriptions', 'general_work_description_id', fields.general_work_description_id, fields.account_id, 'Work description');

      // Cross-customer job guard - refuse before any writes happen.
      await assertJobBelongsToCustomer(trx, fields.customer_job_id, fields.customer_id, accountID);

      await applyBillabilityPolicy(trx, fields);

      const customerID = Number(stored.customer_id);
      const oldTotal = round2(stored.total_transaction);
      const newTotal = round2(fields.total_transaction);
      const amountDelta = round2(newTotal - oldTotal);
      const jobChanged = Number(stored.customer_job_id) !== Number(fields.customer_job_id);
      const dateChanged = toCalendarDate(stored.transaction_date) !== toCalendarDate(fields.transaction_date);

      const action = decideFundingAction({
         isFunded: Boolean(stored.retainer_id),
         isBillable: Boolean(fields.is_transaction_billable),
         requestedRetainerId: fields.retainer_id,
         amount: newTotal
      });

      // ---- resolve + validate every retainer / payment change before writing ----
      let drawPlan = null;
      let chainInfo = null;
      let link = null;
      if (action === 'fund') {
         drawPlan = await planRetainerDraw(trx, { accountId: accountID, customerId: customerID, retainerId: fields.retainer_id, amount: newTotal });
      } else if (action === 'unfund' || action === 'retain') {
         // The draw is the STORED retainer_id, never the client's; its chain must be this customer's.
         chainInfo = await loadOwnedRetainerChain(trx, { accountId: accountID, customerId: customerID, retainerId: stored.retainer_id });
         if (action === 'retain') {
            const requestedRoot = await retainerService.resolveRetainerRootID(trx, accountID, fields.retainer_id);
            if (Number(requestedRoot) !== chainInfo.rootId) throw ruleError(RETAINER_CHANGE_MESSAGE);
         }
         const touchesPayment = action === 'unfund' || amountDelta !== 0 || dateChanged || jobChanged;
         if (touchesPayment) {
            link = await resolveFundingLink(trx, {
               stored,
               chainInfo,
               movesDraw: action === 'unfund' || amountDelta !== 0,
               billedMessage: action === 'unfund' ? BILLED_PAYMENT_MESSAGES.unfund : BILLED_PAYMENT_MESSAGES.update
            });
            if (action === 'retain') assertRetainerCanAbsorb(chainInfo, link, amountDelta);
         }
      }

      // ---- writes ----
      // Job total(s): a job change with no amount change (or vice versa) must
      // still recompute. Job totals are now summed across the whole VERSION
      // FAMILY (updateRecentJobTotal), so moving an entry between two version
      // rows of the SAME family is not really a cross-family move at all —
      // the family's total already includes this entry under its OLD total
      // (still stored), so the "-oldTotal on the old family / +newTotal on the
      // new family" two-call form would double count (the new family's re-sum
      // re-reads the same still-unmoved rows the old call already netted out,
      // since a job-version row carries no transactions of its own). Treat a
      // same-family move exactly like an amount-only edit: one call applying
      // just the delta.
      const sameJobFamily = jobChanged && (await jobService.getJobFamilyIds(trx, fields.customer_job_id, accountID)).includes(Number(stored.customer_job_id));
      if (jobChanged && !sameJobFamily) {
         await updateRecentJobTotal(trx, stored.customer_job_id, accountID, -oldTotal);
         await updateRecentJobTotal(trx, fields.customer_job_id, accountID, newTotal);
      } else if (amountDelta) {
         await updateRecentJobTotal(trx, fields.customer_job_id, accountID, amountDelta);
      }

      const recordingActorId = Number(actorId || stored.created_by_user_id);
      let retainerId = null;
      let draw = null;
      if (action === 'fund') {
         draw = await writeRetainerDraw(trx, drawPlan, recordingActorId);
         retainerId = draw.retainer_id;
      } else if (action === 'retain') {
         retainerId = stored.retainer_id;
         if (link) await repriceFundedDraw(trx, { accountId: accountID, chainInfo, link, delta: amountDelta, actorId: recordingActorId });
      } else if (action === 'unfund') {
         await reverseFundedDraw(trx, { accountId: accountID, chainInfo, link, amount: oldTotal, actorId: recordingActorId });
      }

      const [updated] = await trx(TRANSACTIONS)
         .where({ account_id: accountID, transaction_id: stored.transaction_id })
         .update({ ...fields, retainer_id: retainerId })
         .returning('*');

      if (action === 'fund') {
         await paymentsService.createPayment(trx, {
            ...buildAutoRetainerPayment({ ...updated, created_by_user_id: recordingActorId }, { rootId: drawPlan.rootId, drawId: draw.retainer_id }),
            created_at: ledgerNow(trx)
         });
      } else if (action === 'unfund' && link.payment) {
         await paymentsService.deletePayment(trx, link.payment.payment_id, accountID);
      } else if (action === 'retain' && link && link.payment) {
         await syncAutoRetainerPayment(trx, { payment: link.payment, transaction: updated });
      }

      return { transaction: updated, action, warning: (link && link.warning) || null };
   });
};

/**
 * Delete a time/charge entry: under the customer's ledger lock, the STORED
 * row decides (billed → refused). Its job total drops, its retainer draw is
 * given back and its auto 'Retainer' payment removed — all or nothing.
 * Returns `{ transaction, warning }`.
 * @param {*} db - knex instance or an open knex transaction
 * @param {*} options.accountId - trusted account (URL param), never the body's
 * @param {*} options.transaction - camelCase form body (transactionID + customerID are what matter)
 * @param {*} options.actorId - the AUTHENTICATED user performing the delete (req.user.user_id);
 *    recorded as the creator of a compensating retainer snapshot a legacy
 *    (unmarked) funded entry's delete writes. Falls back to the stored
 *    transaction's own creator for internal callers with no request identity.
 */
const deleteTransactionCore = async (db, { accountId, transaction, actorId }) => {
   // Deletion is an identity-only operation. Validate ownership below and use
   // the locked stored amounts, type, job and funding; create/update pricing
   // validation must not block an ID-only delete or trust stale form values.
   if (transaction?.transactionType != null) normalizeTransactionType(transaction.transactionType);
   const fields = { account_id: Number(accountId), transaction_id: Number(transaction?.transactionID), customer_id: Number(transaction?.customerID) };

   return withTransaction(db, async trx => {
      const accountID = fields.account_id;
      const stored = await loadStoredTransactionForWrite(trx, { accountId: accountID, transactionId: fields.transaction_id, customerId: fields.customer_id });

      // If the STORED transaction is attached to an invoice, do not allow delete.
      if (stored.customer_invoice_id) throw ruleError('Transaction is attached to an invoice and cannot be deleted.', 423);

      let chainInfo = null;
      let link = null;
      if (stored.retainer_id) {
         chainInfo = await loadOwnedRetainerChain(trx, { accountId: accountID, customerId: stored.customer_id, retainerId: stored.retainer_id });
         link = await resolveFundingLink(trx, { stored, chainInfo, movesDraw: true, billedMessage: BILLED_PAYMENT_MESSAGES.delete });
      }

      await updateRecentJobTotal(trx, stored.customer_job_id, accountID, -round2(stored.total_transaction));
      if (link) {
         await reverseFundedDraw(trx, { accountId: accountID, chainInfo, link, amount: round2(stored.total_transaction), actorId: Number(actorId || stored.created_by_user_id) });
      }
      await transactionsService.deleteTransaction(trx, stored.transaction_id, accountID);
      if (link && link.payment) await paymentsService.deletePayment(trx, link.payment.payment_id, accountID);

      return { transaction: stored, warning: (link && link.warning) || null };
   });
};

// export each function
module.exports = {
   applyBillabilityPolicy,
   assertJobBelongsToCustomer,
   addNewTransaction,
   updateTransactionCore,
   deleteTransactionCore,
   lockTransactionLedger,
   decideFundingAction,
   differenceBetweenOldAndNewTransaction,
   updateRecentJobTotal,
   loadOwnedRetainerChain,
   retainerDrawMarker,
   parseRetainerDrawId,
   resolveRetainerChainRoot,
   findLinkedRetainerPayments,
   resolveAutoRetainerPayment,
   resolveLinkedRetainerPayment
};
