/* eslint-disable no-console */
/*
   Reconcile payments that were tagged to an absorbed (rolled-forward) invoice
   chain. The billing engine's date gate never reads those chains, so the money
   never reduced any bill — the customer keeps being charged for amounts they
   already paid.

   Two populations:

   1. PENDING (repairable here): payments entered since the customer's CURRENT
      last bill, tagged to an older chain. The next billing run hasn't happened
      yet, so applying the payment to the current chain now fixes the next bill.
      --apply creates a corrective snapshot on the current chain, mirrors the
      parent, and annotates the payment's note. The original (stale) chain rows
      are left untouched — zeroOutAbsorbedInvoices cleans them on the next run.

   2. HISTORICAL (report-only): payments whose mis-tagging already flowed into
      one or more later bills. Those statements compounded the error into
      beginning balances; correcting them is a per-customer restatement that
      needs human review. This script lists them with full context.

   Usage:
      node scripts/repair-mistagged-payments.js              # dry run vs dev DB
      node scripts/repair-mistagged-payments.js --env prod   # dry run vs prod
      node scripts/repair-mistagged-payments.js --apply      # write fixes (PENDING set only)
      DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/repair-mistagged-payments.js   # sandbox copy

   SIGN CONVENTION: customer_invoices.total_payments is a NEGATIVE net (same
   sign as customer_payments rows), exactly what the payments CRUD writes. The
   parent mirror is updated by ADDING the signed payment amount. Prod still
   holds legacy parents with a POSITIVE magnitude (sign-mixed column): --apply
   refuses to touch a parent whose total_payments is positive (normalise it with
   migration 019 / accountant review first) and never applies reversal rows.

   TRANSACTION / LOCK (2026-09-23, finding F1): --apply used to run the snapshot
   insert, the parent update and the payment retag as three separate,
   unlocked writes. A failure after the first write (or a concurrent write to
   the same customer from anywhere else in the app — payments CRUD, another
   repair run, finalize) could leave the ledger half-fixed: credit applied to
   the new chain, but the payment still pointing at the old one (double
   count), or vice versa. Every repair now runs inside ONE knex transaction
   that first takes the customer's ledger lock (lockCustomerLedger — the same
   lock every other ledger writer takes) and only THEN re-reads and
   re-classifies the candidate payment, so a payment that was fixed or
   changed by someone else between the dry-run scan and this call is noticed
   under the lock instead of being fixed twice.
*/

const { lockCustomerLedger, ledgerNow } = require('../src/endpoints/payments/ledger-helpers');
const { getCurrentChainTargets } = require('../src/endpoints/payments/payment-logic');

const SIGN_WARNING = [
   '************************************************************************',
   '* WARNING: customer_invoices.total_payments is SIGN-MIXED in prod.     *',
   '* Legacy parents store a POSITIVE magnitude; June-2026+ code stores a  *',
   '* NEGATIVE net. This script ADDS the signed (negative) payment amount  *',
   '* and SKIPS any target parent whose total_payments is still positive.  *',
   '* Do not hand-edit total_payments without checking which convention   *',
   '* the row uses (migration 019 lists the unresolved positive parents).  *',
   '************************************************************************'
].join('\n');

const ACCOUNT_ID = 1;
const fmt = n => `$${Math.abs(Number(n || 0)).toFixed(2)}`;
const fmtDate = d => (d ? new Date(d).toISOString().slice(0, 10) : '—');

/**
 * `db` is any knex-compatible query runner — the plain connection for the CLI's read-only scan,
 * or a transaction so `applyFix` below can re-classify a candidate under the customer's ledger
 * lock using the SAME transaction as every write that follows.
 */
const findMistaggedPayments = async (db, accountId = ACCOUNT_ID) => {
   const { rows } = await db.raw(
      `
      WITH pay AS (
         SELECT p.payment_id, p.customer_id, p.payment_amount, p.created_at, p.note,
                COALESCE(i.parent_invoice_id, i.customer_invoice_id) AS chain_root
         FROM customer_payments p
         JOIN customer_invoices i ON i.customer_invoice_id = p.customer_invoice_id
         WHERE p.account_id = :accountId
      ),
      -- Newest statement per customer, ordered exactly like the billing
      -- engine's statement marker (getLastInvoiceMarkersByCustomerID).
      newest_parent AS (
         SELECT DISTINCT ON (customer_id) customer_id, customer_invoice_id, invoice_number, invoice_date, created_at
         FROM customer_invoices
         WHERE parent_invoice_id IS NULL AND account_id = :accountId
         ORDER BY customer_id, invoice_date DESC, created_at DESC, customer_invoice_id DESC
      )
      -- Mis-tagged = the chain was ALREADY absorbed when the payment was
      -- entered (a newer parent existed). Payments correctly applied to the
      -- then-current chain that was later rolled forward are healthy history.
      SELECT pay.payment_id, pay.customer_id, c.display_name, pay.payment_amount, pay.note,
             pay.created_at, root.invoice_number AS tagged_chain_invoice, root.invoice_date AS chain_date,
             np.invoice_number AS current_invoice, np.invoice_date AS last_bill_date,
             -- Statement gate (same as the engine): only payments entered AFTER
             -- the current statement row are still ahead of the next bill; a
             -- bill-day payment entered before the run already flowed into it.
             (pay.created_at > np.created_at) AS is_pending
      FROM pay
      JOIN newest_parent np ON np.customer_id = pay.customer_id
      JOIN customer_invoices root ON root.customer_invoice_id = pay.chain_root
      JOIN customers c ON c.customer_id = pay.customer_id
      JOIN LATERAL (
         SELECT max(invoice_date) AS max_parent_date
         FROM customer_invoices at_entry
         WHERE at_entry.customer_id = pay.customer_id
           AND at_entry.parent_invoice_id IS NULL
           AND at_entry.created_at <= pay.created_at
      ) at_entry ON true
      WHERE root.invoice_date < at_entry.max_parent_date
        AND (pay.note IS NULL OR pay.note NOT LIKE '%[reconciled to %')
      ORDER BY pay.customer_id, pay.created_at
      `,
      { accountId }
   );
   return rows;
};

/**
 * Apply one repair inside a single knex transaction: take the customer's ledger lock FIRST
 * (lockCustomerLedger — the same SELECT ... FOR NO KEY UPDATE every payment/write-off/retainer
 * mutation and finalize take), THEN re-fetch and re-classify the candidate payment under that
 * lock, and use the SAME transaction for the snapshot insert, the parent update and the payment
 * retag. If any write in that sequence fails, or the candidate is no longer a pending mis-tag by
 * the time the lock is granted (already fixed by a concurrent run, or changed underneath us),
 * the whole transaction rolls back — never a partial credit, never an orphaned retag.
 */
const applyFix = (db, candidate, accountId = ACCOUNT_ID) =>
   db.transaction(async trx => {
      await lockCustomerLedger(trx, accountId, candidate.customer_id);
      const current = await findMistaggedPayments(trx, accountId);
      const payment = current.find(p => p.payment_id === candidate.payment_id && p.customer_id === candidate.customer_id && p.is_pending);
      if (!payment) {
         console.log(`   SKIP payment #${candidate.payment_id}: no longer a pending mis-tag under lock (already fixed, or reclassified since the scan) — no write made.`);
         return false;
      }
      return applyLockedFix(trx, payment, accountId);
   });

/** The actual writes, run inside applyFix's transaction with the customer's ledger lock held. */
const applyLockedFix = async (trx, payment, accountId = ACCOUNT_ID) => {
   const signedAmount = Number(payment.payment_amount);
   if (!(signedAmount < 0)) {
      console.log(`   SKIP payment #${payment.payment_id}: not a receipt (amount ${signedAmount}) — reversals need manual review.`);
      return false;
   }
   const targets = await getCurrentChainTargets(trx, accountId, payment.customer_id);
   const live = targets.filter(t => t.remaining > 0);
   if (!live.length) {
      console.log(`   SKIP payment #${payment.payment_id}: current chain has $0 remaining — needs manual review.`);
      return false;
   }
   const target = live.reduce((best, t) => (t.remaining > best.remaining ? t : best), live[0]);
   const amount = Math.abs(Number(payment.payment_amount));
   if (target.remaining < amount) {
      console.log(`   SKIP payment #${payment.payment_id}: ${fmt(payment.payment_amount)} exceeds current remaining ${fmt(target.remaining)} — needs manual review.`);
      return false;
   }

   const newRemaining = Number((target.remaining - amount).toFixed(2));
   const { latestRow, parent } = target;
   if (Number(parent.total_payments) > 0) {
      console.log(
         `   SKIP payment #${payment.payment_id}: ${parent.invoice_number} total_payments is a legacy POSITIVE magnitude (${parent.total_payments}) — normalise the sign first.`
      );
      return false;
   }

   const snapshot = { ...latestRow };
   delete snapshot.customer_invoice_id;
   snapshot.parent_invoice_id = parent.customer_invoice_id;
   snapshot.remaining_balance_on_invoice = newRemaining;
   snapshot.is_invoice_paid_in_full = newRemaining === 0;
   snapshot.fully_paid_date = newRemaining === 0 ? new Date() : null;
   // Wall clock AFTER the ledger lock was granted, same rule as every other ledger writer
   // (ledger-helpers.ledgerNow) — NOT deleted-and-left-to-the-DB-default, which would stamp the
   // transaction's BEGIN time and could sort a row that waited on the lock before rows it
   // logically followed.
   snapshot.created_at = ledgerNow(trx);
   snapshot.notes = `[reconciliation: payment #${payment.payment_id} re-applied from ${payment.tagged_chain_invoice}]`;

   const [inserted] = await trx('customer_invoices').insert(snapshot).returning('*');

   await trx('customer_invoices')
      .where({ customer_invoice_id: parent.customer_invoice_id, account_id: accountId })
      .update({
         remaining_balance_on_invoice: newRemaining,
         is_invoice_paid_in_full: newRemaining === 0,
         fully_paid_date: newRemaining === 0 ? new Date() : null,
         // NEGATIVE-net convention (payments CRUD does the same): add the signed
         // payment amount so the magnitude of payments received grows.
         total_payments: trx.raw('total_payments + ?', [signedAmount])
      });

   const marker = `[reconciled to ${parent.invoice_number}; was tagged to ${payment.tagged_chain_invoice}]`;
   await trx('customer_payments')
      .where({ payment_id: payment.payment_id, account_id: accountId })
      .update({
         customer_invoice_id: inserted.customer_invoice_id,
         note: payment.note ? `${payment.note} ${marker}` : marker
      });

   console.log(`   FIXED payment #${payment.payment_id}: ${fmt(payment.payment_amount)} now reduces ${parent.invoice_number} (remaining ${fmt(target.remaining)} -> ${fmt(newRemaining)}).`);
   return true;
};

module.exports = { findMistaggedPayments, applyFix, applyLockedFix, ACCOUNT_ID, SIGN_WARNING, fmt, fmtDate };

if (require.main === module) {
   const args = process.argv.slice(2);
   const APPLY = args.includes('--apply');
   const ENV = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';

   // DS2_ENV_FILE (sandbox) goes through the shared script factory; otherwise the
   // original explicit dev / prod connection is used unchanged.
   const knex = process.env.DS2_ENV_FILE
      ? require('./_db').makeDb({ envFile: ENV === 'prod' ? '.env.prod' : '.env.dev', database: ENV === 'prod' ? 'ds2_prod' : 'ds2_dev', poolMax: 4 })
      : (() => {
           require('dotenv').config({ path: ENV === 'prod' ? '.env.prod' : '.env.dev' });
           return require('knex')({
              client: 'pg',
              connection: {
                 host: ENV === 'prod' ? process.env.DB_PROD_HOST : process.env.DB_DEV_HOST,
                 user: process.env.DATABASE_USER,
                 password: process.env.DATABASE_PASSWORD,
                 database: ENV === 'prod' ? 'ds2_prod' : 'ds2_dev',
                 port: 5432,
                 ssl: { rejectUnauthorized: false }
              },
              pool: { min: 0, max: 4 }
           });
        })();

   (async () => {
      console.log(`Mis-tagged payment reconciliation — ${ENV} DB, ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
      console.log(`${SIGN_WARNING}\n`);

      const all = await findMistaggedPayments(knex);
      const pending = all.filter(p => p.is_pending);
      const historical = all.filter(p => !p.is_pending);

      console.log(`PENDING (entered since the customer's current bill — repairable): ${pending.length}`);
      for (const p of pending) {
         console.log(
            `   #${p.payment_id} ${p.display_name}: ${fmt(p.payment_amount)} on ${fmtDate(p.created_at)} -> ${p.tagged_chain_invoice} (${fmtDate(p.chain_date)}), current bill ${p.current_invoice} (${fmtDate(p.last_bill_date)})`
         );
         if (APPLY) await applyFix(knex, p);
      }

      console.log(`\nHISTORICAL (already flowed into later bills — review manually): ${historical.length}`);
      const byCustomer = new Map();
      historical.forEach(p => {
         if (!byCustomer.has(p.customer_id)) byCustomer.set(p.customer_id, []);
         byCustomer.get(p.customer_id).push(p);
      });
      byCustomer.forEach(list => {
         const total = list.reduce((s, p) => s + Math.abs(Number(p.payment_amount)), 0);
         console.log(`   ${list[0].display_name}: ${list.length} payment(s), ${fmt(total)} total`);
         list.forEach(p =>
            console.log(`      #${p.payment_id} ${fmt(p.payment_amount)} on ${fmtDate(p.created_at)} -> ${p.tagged_chain_invoice} (${fmtDate(p.chain_date)})`)
         );
      });

      if (!APPLY && pending.length) console.log(`\nRe-run with --apply to fix the ${pending.length} pending payment(s).`);
      await knex.destroy();
   })().catch(err => {
      console.error(err);
      process.exit(1);
   });
}
