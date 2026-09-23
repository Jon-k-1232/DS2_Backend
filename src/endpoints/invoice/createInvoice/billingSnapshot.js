const invoiceService = require('../invoice-service');
const accountService = require('../../account/account-service');
const { fetchInitialQueryItems } = require('./createInvoiceQueries');

/**
 * Read everything a billing run needs in ONE consistent database snapshot.
 *
 * Finalize used to read the ledger fingerprint and then, in separate
 * statements, the payments / write-offs / retainers / transactions it prices.
 * A payment edited between those reads ($100 → $50) and restored before the
 * commit ($50 → $100) left the fingerprint and the timestamp guard satisfied
 * while the calculation had priced the intermediate $50 — the statement
 * persisted $450 on a $400 debt. Reading the fingerprint AND the pricing inputs
 * inside a single REPEATABLE READ transaction pins them to the same instant:
 * whatever state the calculation saw is exactly the state the fingerprint
 * describes, so the recheck under the finalize lock (dataInsertionOrchestrator)
 * refuses the commit whenever the ledger differs from what was priced.
 *
 * `runStartedAt` is the snapshot's transaction start (`now()` inside REPEATABLE
 * READ), taken from the database clock as a plain timestamp so it round-trips
 * exactly against the `created_at` columns.
 *
 * `hooks.afterFingerprint` exists for tests only: it runs between the
 * fingerprint read and the pricing reads so a spec can mutate the ledger from
 * another connection and prove the pricing reads still match the fingerprint.
 */
const readBillingSnapshot = async (db, { accountID, invoicesToCreateMap, billingDate, hooks = {} }) => {
   const customerIDs = Object.keys(invoicesToCreateMap).map(Number);
   return db.transaction(async readTrx => {
      // Must be the first statement of the transaction.
      await readTrx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // As TEXT: node-postgres would parse a timestamp into a millisecond Date,
      // and a payment written 800µs before the snapshot then compared as "after"
      // it (a needless "ledger changed" refusal). The text form keeps the
      // microseconds and Postgres casts it back exactly in `created_at > ?`.
      const runStartedAt = (await readTrx.raw('SELECT now()::timestamp::text AS ts')).rows[0].ts;
      const ledgerFingerprint = await invoiceService.getLedgerFingerprint(readTrx, accountID, customerIDs);
      if (hooks.afterFingerprint) await hooks.afterFingerprint();
      const [accountBillingInformation] = await accountService.getAccount(readTrx, accountID);
      const invoiceQueryData = await fetchInitialQueryItems(readTrx, invoicesToCreateMap, accountID, { billingDate });
      return { runStartedAt, ledgerFingerprint, accountBillingInformation, invoiceQueryData };
   });
};

module.exports = { readBillingSnapshot };
