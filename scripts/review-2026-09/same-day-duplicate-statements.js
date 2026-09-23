'use strict';
const { main, rows, changeRows } = require('./_common');
main('same-day-duplicate-statements', true, async db => {
  const pairs = await rows(db, `SELECT a.customer_id,c.display_name AS customer,a.invoice_date::text,
    count(*) OVER(PARTITION BY a.customer_id,a.invoice_date)::int AS pair_count,
    a.customer_invoice_id AS first_id,a.invoice_number AS first_statement,a.created_at::text AS first_created_at,
    a.beginning_balance AS first_bb,a.total_charges AS first_charges,a.total_amount_due AS first_due,
    a.remaining_balance_on_invoice AS first_remaining,a.is_invoice_paid_in_full AS first_paid,
    b.customer_invoice_id AS second_id,b.invoice_number AS second_statement,b.created_at::text AS second_created_at,
    b.beginning_balance AS second_bb,b.total_charges AS second_charges,b.total_amount_due AS second_due,
    b.remaining_balance_on_invoice AS second_remaining,b.is_invoice_paid_in_full AS second_paid
    FROM customer_invoices a JOIN customer_invoices b ON b.account_id=a.account_id AND b.customer_id=a.customer_id
      AND b.invoice_date=a.invoice_date AND b.parent_invoice_id IS NULL
      AND (b.created_at,b.customer_invoice_id)>(a.created_at,a.customer_invoice_id)
    JOIN customers c ON c.customer_id=a.customer_id AND c.account_id=a.account_id
    WHERE a.account_id=1 AND a.parent_invoice_id IS NULL ORDER BY a.customer_id,a.invoice_date,a.created_at,b.created_at`);
  const ids = [...new Set(pairs.flatMap(r => [r.first_id,r.second_id]))];
  const payments = ids.length ? await rows(db, `SELECT coalesce(i.parent_invoice_id,i.customer_invoice_id) AS root_id,p.*
    FROM customer_payments p JOIN customer_invoices i ON i.customer_invoice_id=p.customer_invoice_id
    WHERE coalesce(i.parent_invoice_id,i.customer_invoice_id)=ANY(?::int[]) ORDER BY root_id,p.created_at,p.payment_id`, [ids]) : [];
  const writeoffs = ids.length ? await rows(db, `SELECT coalesce(i.parent_invoice_id,i.customer_invoice_id) AS root_id,w.*
    FROM customer_writeoffs w JOIN customer_invoices i ON i.customer_invoice_id=w.customer_invoice_id
    WHERE coalesce(i.parent_invoice_id,i.customer_invoice_id)=ANY(?::int[]) ORDER BY root_id,w.created_at,w.writeoff_id`, [ids]) : [];
  const dependencies = ids.length ? await rows(db, `SELECT p.customer_invoice_id,
    (SELECT count(*)::int FROM customer_transactions t WHERE t.customer_invoice_id=p.customer_invoice_id) AS stamped_transactions,
    (SELECT count(*)::int FROM customer_invoices ch WHERE ch.parent_invoice_id=p.customer_invoice_id) AS child_snapshots,
    (SELECT count(*)::int FROM customer_invoices x WHERE x.notes LIKE '%[absorbed_by:'||p.invoice_number||'@%') AS absorption_references
    FROM customer_invoices p WHERE p.customer_invoice_id=ANY(?::int[])`, [ids]) : [];
  const targets = [];
  for (const r of pairs) {
    // Current stored remaining is the deliberately strict automatic-repair predicate.
    const secondMatch = r.second_charges === '0.00' && r.second_bb === r.first_remaining && Number(r.second_bb)>0;
    const firstMatch = r.first_charges === '0.00' && r.first_bb === r.second_remaining && Number(r.first_bb)>0;
    r.duplicate_id = secondMatch !== firstMatch ? (secondMatch ? r.second_id : r.first_id) : null;
    r.likely_historical_duplicate = r.second_charges === '0.00' && (r.second_bb === r.first_due || secondMatch) ? r.second_id : null;
    r.first_chain_payment_count = payments.filter(p=>p.root_id===r.first_id).length;
    r.first_chain_paid_credit = payments.some(p=>p.root_id===r.first_id && Number(p.payment_amount)<0);
    r.second_chain_payment_count = payments.filter(p=>p.root_id===r.second_id).length;
    r.first_chain_writeoff_count = writeoffs.filter(w=>w.root_id===r.first_id).length;
    r.second_chain_writeoff_count = writeoffs.filter(w=>w.root_id===r.second_id).length;
    const dep = dependencies.find(d=>d.customer_invoice_id===r.duplicate_id);
    r.duplicate_stamped_transactions = dep?.stamped_transactions ?? null;
    r.duplicate_child_snapshots = dep?.child_snapshots ?? null;
    const reasons = [];
    if (!r.duplicate_id) reasons.push('no unique zero-charge parent matching other current remaining');
    if (r.pair_count !== 1) reasons.push('more than two same-day parents');
    if (dep?.stamped_transactions) reasons.push('stamped transactions');
    if (dep?.child_snapshots) reasons.push('child snapshots');
    if (dep?.absorption_references) reasons.push('other rows reference its absorption');
    if (payments.some(p=>p.root_id===r.duplicate_id)) reasons.push('tagged payments');
    if (writeoffs.some(w=>w.root_id===r.duplicate_id)) reasons.push('tagged write-offs');
    r.action = reasons.length ? `manual review: ${reasons.join('; ')}` : `delete empty duplicate parent ${r.duplicate_id}`;
    if (!reasons.length) targets.push({customer_invoice_id:r.duplicate_id});
    r.accountant_note = r.first_chain_paid_credit ? 'Payments were tagged to the first chain; review payment history before any further adjustment.' : 'Review issued statement and carry-forward history.';
  }
  return {rows:pairs,details:{payments,writeoffs,dependencies},targets,summary:{customers:new Set(pairs.map(r=>r.customer_id)).size,pairs:pairs.length,
    pairs_2026:pairs.filter(r=>r.invoice_date.startsWith('2026')).length,repairable:targets.length,manual_review:pairs.length-targets.length}};
}, (db,result)=>changeRows(db,'customer_invoices','customer_invoice_id',result.targets,async r=>{
  const n=await db('customer_invoices').where({customer_invoice_id:r.customer_invoice_id,account_id:1}).whereNull('parent_invoice_id').del();
  if(n!==1) throw new Error('Delete count mismatch');
}));
