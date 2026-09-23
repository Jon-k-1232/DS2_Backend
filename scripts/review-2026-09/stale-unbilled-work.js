'use strict';
const { main, rows, sum } = require('./_common');
main('stale-unbilled-work', false, async db => {
  const found = await rows(db, `SELECT c.customer_id,c.display_name AS customer,max(p.invoice_date)::text AS newest_statement_date,
    count(*)::int AS transaction_count,sum(t.total_transaction)::numeric(14,2) AS total,
    min(t.transaction_date)::text AS oldest_date,max(t.transaction_date)::text AS newest_stale_date,
    count(*) FILTER(WHERE j.customer_job_id IS NULL OR jt.job_type_id IS NULL)::int AS blocked_by_missing_job_join,
    count(*) FILTER(WHERE j.customer_id<>t.customer_id OR j.account_id<>t.account_id)::int AS foreign_job_count,
    NOT EXISTS(SELECT 1 FROM customer_transactions newer WHERE newer.account_id=c.account_id AND newer.customer_id=c.customer_id
      AND newer.customer_invoice_id IS NULL AND newer.is_transaction_billable AND newer.transaction_date>max(p.invoice_date)) AS no_newer_unbilled_work
    FROM customers c
    JOIN LATERAL (SELECT invoice_date FROM customer_invoices WHERE account_id=c.account_id AND customer_id=c.customer_id
      AND parent_invoice_id IS NULL ORDER BY invoice_date DESC,created_at DESC,customer_invoice_id DESC LIMIT 1) p ON true
    JOIN customer_transactions t ON t.account_id=c.account_id AND t.customer_id=c.customer_id
    LEFT JOIN customer_jobs j ON j.customer_job_id=t.customer_job_id
    LEFT JOIN customer_job_types jt ON jt.job_type_id=j.job_type_id
    WHERE c.account_id=1 AND c.is_customer_active AND t.is_transaction_billable AND t.customer_invoice_id IS NULL AND t.transaction_date<=p.invoice_date
    GROUP BY c.account_id,c.customer_id,c.display_name ORDER BY c.customer_id`);
  return { rows: found, summary: { customers: found.length, transactions: found.reduce((n,r)=>n+r.transaction_count,0), total: sum(found, 'total'),
    customers_without_newer_work: found.filter(r=>r.no_newer_unbilled_work).length,
    blocked_by_missing_job_join: found.reduce((n,r)=>n+r.blocked_by_missing_job_join,0) } };
});
