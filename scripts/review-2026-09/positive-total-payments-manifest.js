'use strict';
/*
   Generates the accountant review package for migration 019's total_payments sign flip (F2,
   round-3 review). READ ONLY — never writes to the database (see _common.js's `main`, which
   opens the whole run in a REPEATABLE READ, READ ONLY transaction; --apply is refused for this
   script by never passing `repairable: true`).

   Finds every parent invoice that is ARITHMETICALLY eligible for the flip (stored
   total_payments is a positive value exactly matching the magnitude of the payments tagged to
   its chain, with no reversal/positive events) — the same condition the migration itself checks
   — grouped so a root whose tagged payments span more than one customer_id (the cross-customer
   misattribution shape from finding F2) never becomes a single candidate. Arithmetic equality is
   NOT proof of correct attribution (see migrations/019.ledger_data_normalization.sql's header
   comment and the review report) — every candidate here still needs a human to look at the
   payment list and confirm it before it goes in the manifest.

   Output (scripts/review-2026-09/out/, gitignored):
     positive-total-payments-manifest.<db>.review.csv   — one row per candidate parent, for the
       accountant: customer, invoice number, old total, signed net, payment ids, dates, amounts,
       and a possible_misattributed_reversal flag (see below).
     positive-total-payments-manifest.<db>.manifest.sql — the exact `INSERT INTO _m019_reviewed`
       block for EVERY candidate found, ready to paste into migration 019's manifest — but only
       after the accountant has reviewed the CSV and struck any row that shouldn't flip. This
       script does not know which rows are correct; it only knows which are arithmetically
       eligible. Do not paste the generated SQL in unreviewed.

   possible_misattributed_reversal: true when some OTHER payment on the account has a
   "[reversal of payment #<id>]" note naming one of THIS candidate's own payment ids — i.e. a
   reversal of one of this root's payments exists, but was recorded against a different chain.
   That is exactly the shape that produced a wrong flip before this fix (see finding F2) — a
   flagged row needs extra scrutiny, not automatic exclusion (the reversal might be unrelated).

   Usage:
      DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/positive-total-payments-manifest.js
*/
const fs = require('fs');
const path = require('path');
const { main, rows } = require('./_common');

const ACCOUNT_ID = 1;

const sqlLiteral = value => (value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const sqlArray = ids => `ARRAY[${ids.join(', ')}]`;

main('positive-total-payments-manifest', false, async db => {
   const [{ database }] = await rows(db, 'SELECT current_database() AS database');
   const candidates = await rows(
      db,
      `WITH resolved AS (
         SELECT p.payment_id, p.account_id, p.customer_id, p.payment_amount, p.payment_date, p.note,
                COALESCE(i.parent_invoice_id, i.customer_invoice_id) AS root_id
         FROM customer_payments p
         JOIN customer_invoices i ON i.customer_invoice_id = p.customer_invoice_id
         WHERE i.account_id = p.account_id AND i.customer_id = p.customer_id AND p.account_id = ?
       ), sums AS (
         SELECT root_id, account_id, customer_id,
                array_agg(payment_id ORDER BY payment_id) AS payment_ids,
                SUM(payment_amount) AS signed_net, SUM(ABS(payment_amount)) AS magnitude,
                COUNT(*) FILTER (WHERE payment_amount > 0) AS positive_events,
                COUNT(*)::int AS payment_count
         FROM resolved
         -- Grouping by customer_id too means a root whose tagged payments span more than one
         -- customer (a child invoice rolled up to a root owned by someone else) never collapses
         -- into a single candidate row — the same protection migration 019's gated UPDATE uses.
         GROUP BY root_id, account_id, customer_id
       )
       SELECT i.customer_invoice_id AS root_id, i.account_id, i.customer_id, cu.display_name AS customer_name,
              i.invoice_number, i.invoice_date::text AS invoice_date,
              i.total_payments AS expected_old_total, s.signed_net AS expected_signed_net,
              s.magnitude, s.payment_count, s.payment_ids,
              EXISTS (
                 SELECT 1 FROM customer_payments other
                 WHERE other.account_id = i.account_id
                   AND other.note ~ ('\\[reversal of payment #(' || array_to_string(s.payment_ids, '|') || ')\\]')
              ) AS possible_misattributed_reversal
       FROM customer_invoices i
       JOIN sums s ON s.root_id = i.customer_invoice_id AND s.account_id = i.account_id AND s.customer_id = i.customer_id
       JOIN customers cu ON cu.customer_id = i.customer_id AND cu.account_id = i.account_id
       WHERE i.account_id = ? AND i.parent_invoice_id IS NULL
         AND i.total_payments > 0 AND i.total_payments = s.magnitude AND s.positive_events = 0
         -- N4: quarantine any chain with conflicting ownership — mirrors migration 019's own
         -- apply-time NOT EXISTS check (see that file's header comment). A root's OWN
         -- (account/customer-scoped) group can match arithmetically while a foreign payment
         -- still sits elsewhere in the same chain via a child invoice; such a root must never
         -- become a candidate at all, not just get a corrected payment-detail listing.
         -- R2 fix (2026-09 second follow-up review): start from the LINKED INVOICES and
         -- LEFT JOIN their payments, not the other way around. Starting from
         -- customer_payments (an inner join) meant a foreign-owned child invoice with NO
         -- payment of its own was invisible to this check entirely — e.g. root 500 (customer 1)
         -- with child invoice 501 (customer 2, no payment) still flipped, because there was no
         -- "bad" payment row to find. A same-owner child with no payment must stay eligible
         -- (bad.payment_id IS NULL means "no payment to compare" — never itself a conflict).
         AND NOT EXISTS (
            SELECT 1 FROM customer_invoices linked
            LEFT JOIN customer_payments bad ON bad.customer_invoice_id = linked.customer_invoice_id
            WHERE COALESCE(linked.parent_invoice_id, linked.customer_invoice_id) = i.customer_invoice_id
              AND ((bad.payment_id IS NOT NULL
                    AND (bad.account_id, bad.customer_id) IS DISTINCT FROM (i.account_id, i.customer_id))
                OR (linked.account_id, linked.customer_id) IS DISTINCT FROM (i.account_id, i.customer_id))
         )
       ORDER BY i.customer_invoice_id`,
      [ACCOUNT_ID, ACCOUNT_ID]
   );

   // N4: derive payment detail from the exact candidate payment ids, not from "every payment
   // anywhere in the root's chain" — the old COALESCE(...)=ANY(root ids) query listed foreign
   // payments (e.g. a child invoice's own payment) that the summary row's payment_count/
   // payment_ids never counted, so the CSV/SQL detail disagreed with the manifest it was meant
   // to document.
   const ids = candidates.flatMap(c => c.payment_ids);
   const paymentDetail = ids.length
      ? await rows(
           db,
           `SELECT COALESCE(i.parent_invoice_id, i.customer_invoice_id) AS root_id, p.payment_id, p.payment_amount,
                   p.payment_date::text AS payment_date, p.form_of_payment, p.note
            FROM customer_payments p
            JOIN customer_invoices i ON i.customer_invoice_id = p.customer_invoice_id
            WHERE p.payment_id = ANY(?::int[])
            ORDER BY root_id, p.payment_id`,
           [ids]
        )
      : [];
   const paymentsByRoot = new Map();
   for (const p of paymentDetail) {
      if (!paymentsByRoot.has(p.root_id)) paymentsByRoot.set(p.root_id, []);
      paymentsByRoot.get(p.root_id).push(`#${p.payment_id} ${p.payment_amount} on ${p.payment_date} (${p.form_of_payment || 'unknown'})`);
   }

   const reviewRows = candidates.map(c => ({
      root_id: c.root_id,
      account_id: c.account_id,
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      invoice_number: c.invoice_number,
      invoice_date: c.invoice_date,
      expected_old_total: c.expected_old_total,
      expected_signed_net: c.expected_signed_net,
      payment_count: c.payment_count,
      payment_ids: c.payment_ids.join(';'),
      payments: (paymentsByRoot.get(c.root_id) || []).join(' | '),
      possible_misattributed_reversal: c.possible_misattributed_reversal,
      approved: '' // accountant fills this in (e.g. "yes"/initials) before anyone hand-picks rows into the manifest
   }));

   // The exact SQL INSERT block for EVERY arithmetically-eligible row — see the file header:
   // this is a starting point for the accountant's reviewed subset, not itself an approval.
   const manifestSql = candidates.length
      ? [
           '-- Generated by scripts/review-2026-09/positive-total-payments-manifest.js — UNREVIEWED.',
           '-- Paste only the rows the accountant approved into migrations/019.ledger_data_normalization.sql',
           `-- (after "-- accountant-reviewed rows go here"). Generated ${new Date().toISOString()} against database ${database}, account ${ACCOUNT_ID}.`,
           'INSERT INTO _m019_reviewed (account_id, customer_id, root_id, expected_old_total, expected_signed_net, expected_payment_ids) VALUES',
           candidates
              .map(
                 (c, idx) =>
                    `   (${c.account_id}, ${c.customer_id}, ${c.root_id}, ${sqlLiteral(c.expected_old_total)}, ${sqlLiteral(c.expected_signed_net)}, ${sqlArray(c.payment_ids)})` +
                    (idx === candidates.length - 1 ? ';' : ',') +
                    (c.possible_misattributed_reversal ? '  -- possible_misattributed_reversal: review payment notes before approving' : '')
              )
              .join('\n')
        ].join('\n') + '\n'
      // R4 fix (2026-09 second follow-up review): the zero-candidate branch used to drop the
      // identity line entirely, so a detached empty manifest carried no record of which
      // database/account/time it came from (probe.log:manifest:empty-identity, headerHasDB
      // false) — the filename is qualified (N5), but the file's own CONTENTS lost provenance
      // the moment it left that filename behind (copied, pasted into an email, etc).
      : `-- Generated against database ${database}, account ${ACCOUNT_ID}, at ${new Date().toISOString()}.\n-- No arithmetically-eligible parents found; nothing to review.\n`;

   // N5: DS2_REVIEW_OUT_DIR lets tests redirect this write to a private temp dir instead of the
   // shared, gitignored scripts/review-2026-09/out/ (see _common.js). The filename is also
   // qualified with the source database (N5) so runs against different databases never collide
   // and the artifact is self-describing without opening it.
   const outDir = process.env.DS2_REVIEW_OUT_DIR || path.join(__dirname, 'out');
   fs.mkdirSync(outDir, { recursive: true });
   const sqlPath = path.join(outDir, `positive-total-payments-manifest.${database.replace(/[^a-zA-Z0-9_-]/g, '_')}.account-${ACCOUNT_ID}.manifest.sql`);
   fs.writeFileSync(sqlPath, manifestSql);
   console.log(`Manifest SQL (UNREVIEWED — accountant must approve rows before pasting): ${sqlPath}`);

   return {
      rows: reviewRows,
      summary: {
         account_id: ACCOUNT_ID,
         candidates: candidates.length,
         flagged_possible_misattributed_reversal: candidates.filter(c => c.possible_misattributed_reversal).length,
         manifest_sql_path: sqlPath
      }
   };
});
