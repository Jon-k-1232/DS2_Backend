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
*/

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ENV = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';

require('dotenv').config({ path: ENV === 'prod' ? '.env.prod' : '.env.dev' });
const knex = require('knex')({
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

const { getCurrentChainTargets } = require('../src/endpoints/payments/payment-logic');

const ACCOUNT_ID = 1;
const fmt = n => `$${Math.abs(Number(n || 0)).toFixed(2)}`;
const fmtDate = d => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const findMistaggedPayments = async () => {
   const { rows } = await knex.raw(
      `
      WITH pay AS (
         SELECT p.payment_id, p.customer_id, p.payment_amount, p.created_at, p.note,
                COALESCE(i.parent_invoice_id, i.customer_invoice_id) AS chain_root
         FROM customer_payments p
         JOIN customer_invoices i ON i.customer_invoice_id = p.customer_invoice_id
         WHERE p.account_id = :accountId
      ),
      newest_parent AS (
         SELECT DISTINCT ON (customer_id) customer_id, customer_invoice_id, invoice_number, invoice_date
         FROM customer_invoices
         WHERE parent_invoice_id IS NULL AND account_id = :accountId
         ORDER BY customer_id, invoice_date DESC, customer_invoice_id DESC
      )
      -- Mis-tagged = the chain was ALREADY absorbed when the payment was
      -- entered (a newer parent existed). Payments correctly applied to the
      -- then-current chain that was later rolled forward are healthy history.
      SELECT pay.payment_id, pay.customer_id, c.display_name, pay.payment_amount, pay.note,
             pay.created_at, root.invoice_number AS tagged_chain_invoice, root.invoice_date AS chain_date,
             np.invoice_number AS current_invoice, np.invoice_date AS last_bill_date,
             (pay.created_at >= np.invoice_date) AS is_pending
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
      { accountId: ACCOUNT_ID }
   );
   return rows;
};

const applyFix = async payment => {
   const targets = await getCurrentChainTargets(knex, ACCOUNT_ID, payment.customer_id);
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

   const snapshot = { ...latestRow };
   delete snapshot.customer_invoice_id;
   snapshot.parent_invoice_id = parent.customer_invoice_id;
   snapshot.remaining_balance_on_invoice = newRemaining;
   snapshot.is_invoice_paid_in_full = newRemaining === 0;
   snapshot.fully_paid_date = newRemaining === 0 ? new Date() : null;
   delete snapshot.created_at; // DB clock, same as every other row
   snapshot.notes = `[reconciliation: payment #${payment.payment_id} re-applied from ${payment.tagged_chain_invoice}]`;

   const [inserted] = await knex('customer_invoices').insert(snapshot).returning('*');

   await knex('customer_invoices')
      .where({ customer_invoice_id: parent.customer_invoice_id, account_id: ACCOUNT_ID })
      .update({
         remaining_balance_on_invoice: newRemaining,
         is_invoice_paid_in_full: newRemaining === 0,
         fully_paid_date: newRemaining === 0 ? new Date() : null,
         total_payments: knex.raw('total_payments + ?', [amount])
      });

   const marker = `[reconciled to ${parent.invoice_number}; was tagged to ${payment.tagged_chain_invoice}]`;
   await knex('customer_payments')
      .where({ payment_id: payment.payment_id, account_id: ACCOUNT_ID })
      .update({
         customer_invoice_id: inserted.customer_invoice_id,
         note: payment.note ? `${payment.note} ${marker}` : marker
      });

   console.log(`   FIXED payment #${payment.payment_id}: ${fmt(payment.payment_amount)} now reduces ${parent.invoice_number} (remaining ${fmt(target.remaining)} -> ${fmt(newRemaining)}).`);
   return true;
};

(async () => {
   console.log(`Mis-tagged payment reconciliation — ${ENV} DB, ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

   const all = await findMistaggedPayments();
   const pending = all.filter(p => p.is_pending);
   const historical = all.filter(p => !p.is_pending);

   console.log(`PENDING (entered since the customer's current bill — repairable): ${pending.length}`);
   for (const p of pending) {
      console.log(
         `   #${p.payment_id} ${p.display_name}: ${fmt(p.payment_amount)} on ${fmtDate(p.created_at)} -> ${p.tagged_chain_invoice} (${fmtDate(p.chain_date)}), current bill ${p.current_invoice} (${fmtDate(p.last_bill_date)})`
      );
      if (APPLY) await applyFix(p);
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
