'use strict';
const { main, rows, sum, changeRows } = require('./_common');
main('mirror-desync', true, async db => {
  const found = await rows(db, `SELECT p.customer_invoice_id, p.customer_id, c.display_name AS customer,
    p.invoice_number, p.invoice_date::text, p.remaining_balance_on_invoice AS parent_remaining,
    p.is_invoice_paid_in_full AS parent_paid, ch.customer_invoice_id AS latest_child_id,
    ch.created_at::text AS child_created_at, ch.remaining_balance_on_invoice AS child_remaining,
    ch.is_invoice_paid_in_full AS child_paid, ch.fully_paid_date::text AS child_fully_paid_date,
    CASE WHEN ch.account_id <> p.account_id OR ch.customer_id <> p.customer_id OR ch.remaining_balance_on_invoice IS NULL
      THEN 'manual review: invalid child ownership/balance' ELSE 're-mirror remaining and paid state' END AS action
    FROM customer_invoices p JOIN customers c ON c.customer_id=p.customer_id AND c.account_id=p.account_id
    JOIN LATERAL (SELECT * FROM customer_invoices WHERE parent_invoice_id=p.customer_invoice_id
      ORDER BY created_at DESC NULLS LAST, customer_invoice_id DESC LIMIT 1) ch ON true
    WHERE p.account_id=1 AND p.parent_invoice_id IS NULL
      AND (p.remaining_balance_on_invoice IS DISTINCT FROM ch.remaining_balance_on_invoice
        OR p.is_invoice_paid_in_full IS DISTINCT FROM ch.is_invoice_paid_in_full)
    ORDER BY p.customer_invoice_id`);
  return { rows: found, summary: { parents: found.length, parent_remaining: sum(found, 'parent_remaining'), child_remaining: sum(found, 'child_remaining'), repairable: found.filter(r => r.action.startsWith('re-mirror')).length } };
}, (db, result) => changeRows(db, 'customer_invoices', 'customer_invoice_id', result.rows.filter(r => r.action.startsWith('re-mirror')), async r => {
  const n = await db('customer_invoices').where({ customer_invoice_id: r.customer_invoice_id, account_id: 1 }).update({
    remaining_balance_on_invoice: r.child_remaining, is_invoice_paid_in_full: r.child_paid, fully_paid_date: r.child_fully_paid_date
  });
  if (n !== 1) throw new Error('Mirror update count mismatch');
}));
