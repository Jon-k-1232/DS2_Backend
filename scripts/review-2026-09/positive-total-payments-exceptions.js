'use strict';
const { main, rows, sum } = require('./_common');
main('positive-total-payments-exceptions', false, async db => {
  const found = await rows(db, `WITH resolved AS (
    SELECT p.*, COALESCE(i.parent_invoice_id,i.customer_invoice_id) root_id FROM customer_payments p
    JOIN customer_invoices i ON i.customer_invoice_id=p.customer_invoice_id AND i.account_id=p.account_id AND i.customer_id=p.customer_id
    WHERE p.account_id=1
  ), sums AS (SELECT root_id, count(*)::int event_count, sum(payment_amount) signed_net,
      sum(abs(payment_amount)) magnitude, count(*) FILTER(WHERE payment_amount>0)::int positive_events FROM resolved GROUP BY root_id)
    SELECT i.customer_invoice_id,i.customer_id,c.display_name AS customer,i.invoice_number,i.invoice_date::text,
      i.total_payments AS stored_total_payments,coalesce(s.signed_net,0)::numeric(12,2) AS tagged_signed_net,
      coalesce(s.magnitude,0)::numeric(12,2) AS tagged_magnitude,coalesce(s.event_count,0) AS payment_count,
      coalesce(s.positive_events,0) AS reversal_count,
      (i.total_payments-coalesce(s.signed_net,0))::numeric(12,2) AS stored_minus_signed,
      i.remaining_balance_on_invoice,
      'manual review: migration 019 cannot safely normalize this parent' AS action
    FROM customer_invoices i JOIN customers c ON c.customer_id=i.customer_id AND c.account_id=i.account_id
    LEFT JOIN sums s ON s.root_id=i.customer_invoice_id
    WHERE i.account_id=1 AND i.parent_invoice_id IS NULL AND i.total_payments>0
      AND NOT(coalesce(s.event_count,0)>0 AND i.total_payments=s.magnitude AND s.positive_events=0)
    ORDER BY i.customer_invoice_id`);
  const ids = found.map(r => r.customer_invoice_id);
  const payments = ids.length ? await rows(db, `SELECT coalesce(i.parent_invoice_id,i.customer_invoice_id) AS root_id,p.*
    FROM customer_payments p JOIN customer_invoices i ON i.customer_invoice_id=p.customer_invoice_id
    WHERE coalesce(i.parent_invoice_id,i.customer_invoice_id)=ANY(?::int[]) ORDER BY root_id,p.created_at,p.payment_id`, [ids]) : [];
  return { rows: found, details: { payments }, summary: { parents: found.length, payment_rows: payments.length, stored_total: sum(found, 'stored_total_payments'), tagged_signed_net: sum(found, 'tagged_signed_net') } };
});
