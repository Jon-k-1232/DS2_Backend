'use strict';
const { main, rows, sum, changeRows } = require('./_common');
main('null-job-transactions', true, async db => {
  const found = await rows(db, `SELECT t.transaction_id, t.customer_id, c.display_name AS customer,
    t.transaction_date::text, t.customer_invoice_id, t.is_transaction_billable, t.total_transaction,
    t.customer_job_id, j.customer_id AS job_customer_id, j.job_type_id, jt.job_description,
    t.detailed_work_description,
    CASE WHEN t.customer_job_id IS NULL THEN 'NULL job' ELSE 'foreign customer/account job' END AS anomaly,
    candidates.ids AS candidate_job_ids, candidates.n AS candidate_count, suggested.customer_job_id AS suggested_job_id,
    suggested.created_at::text AS suggested_job_created_at,
    CASE WHEN j.job_type_id IS NULL THEN 'manual review: job type unknown; do not guess from prose'
      WHEN candidates.n = 1 THEN 'relink unique same-type job'
      WHEN candidates.n > 1 THEN 'manual review: most recent suggested, multiple same-type jobs'
      ELSE 'manual review: no same-type job' END AS action
    FROM customer_transactions t JOIN customers c ON c.customer_id=t.customer_id AND c.account_id=t.account_id
    LEFT JOIN customer_jobs j ON j.customer_job_id=t.customer_job_id
    LEFT JOIN customer_job_types jt ON jt.job_type_id=j.job_type_id
    LEFT JOIN LATERAL (SELECT count(*)::int n, array_agg(k.customer_job_id ORDER BY k.created_at DESC NULLS LAST,k.customer_job_id DESC) ids
      FROM customer_jobs k WHERE k.account_id=t.account_id AND k.customer_id=t.customer_id AND k.job_type_id=j.job_type_id) candidates ON true
    LEFT JOIN LATERAL (SELECT k.* FROM customer_jobs k WHERE k.account_id=t.account_id AND k.customer_id=t.customer_id AND k.job_type_id=j.job_type_id
      ORDER BY k.created_at DESC NULLS LAST,k.customer_job_id DESC LIMIT 1) suggested ON true
    WHERE t.account_id=1 AND ((t.customer_job_id IS NULL AND t.is_transaction_billable)
      OR (j.customer_id IS DISTINCT FROM t.customer_id OR j.account_id IS DISTINCT FROM t.account_id) AND t.customer_job_id IS NOT NULL)
    ORDER BY t.customer_id,t.transaction_id`);
  return { rows: found, summary: { transactions: found.length, null_jobs: found.filter(r => r.anomaly === 'NULL job').length,
    foreign_jobs: found.filter(r => r.anomaly !== 'NULL job').length, total: sum(found, 'total_transaction'),
    repairable: found.filter(r => r.action.startsWith('relink')).length } };
}, (db, result) => changeRows(db, 'customer_transactions', 'transaction_id', result.rows.filter(r => r.action.startsWith('relink')), async r => {
  const n = await db('customer_transactions').where({ transaction_id: r.transaction_id, account_id: 1 }).update({ customer_job_id: r.suggested_job_id });
  if (n !== 1) throw new Error('Relink update count mismatch');
}));
