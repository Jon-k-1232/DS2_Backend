'use strict';
// Replay both posting gates in PostgreSQL (timestamps retain microsecond precision).
// Stored totals constrain showWriteOffs; that historic switch is not persisted.
const { main, rows, cents, money, sum } = require('./_common');
main('billday-writeoff-double-credit', false, async db => {
  // The reviewed population lives in the checkout (billday-writeoff-ids.json), not
  // in scripts/review-2026-09/out/ — that directory is gitignored (generated
  // evidence), so a script that depended on a CSV there could never run from a
  // fresh clone. See migrations/README.md / REPORT.md for how these 61 ids were
  // derived.
  const ids = [...new Set(require('./billday-writeoff-ids.json'))];
  if (ids.length !== 61) throw new Error('Expected the reviewed 61-write-off population');
  const candidates = await rows(db, `SELECT w.writeoff_id,w.customer_id,c.display_name AS customer,w.writeoff_amount,
    w.customer_invoice_id,w.customer_job_id,w.created_at::text AS entered_at,
    b.customer_invoice_id AS bill_day_id,b.invoice_number AS bill_day_statement,b.created_at::text AS bill_day_created,
    b.invoice_date::text AS bill_day_date
    FROM customer_writeoffs w JOIN customers c ON c.customer_id=w.customer_id AND c.account_id=w.account_id
    LEFT JOIN LATERAL (SELECT p.* FROM customer_invoices p WHERE p.account_id=w.account_id AND p.customer_id=w.customer_id
      AND p.parent_invoice_id IS NULL AND w.created_at>=p.invoice_date AND w.created_at<p.created_at
      AND w.created_at::date=p.created_at::date ORDER BY p.created_at,p.customer_invoice_id LIMIT 1) b ON true
    WHERE w.account_id=1 AND w.writeoff_id=ANY(?::int[]) ORDER BY w.customer_id,w.writeoff_id`, [ids]);
  if(candidates.length!==ids.length || candidates.some(r=>!r.bill_day_id)) throw new Error('Population no longer matches database/bill-day statements; review manifest');
  const customers=[...new Set(candidates.map(r=>r.customer_id))];
  const statements=await rows(db, `SELECT p.customer_invoice_id,p.customer_id,p.invoice_number,p.invoice_date::text,p.created_at::text,
    p.total_write_offs,p.total_charges,prev.customer_invoice_id AS previous_id,prev.invoice_number AS previous_statement,
    prev.invoice_date::text AS old_cutoff_date,prev.created_at::text AS new_cutoff_timestamp,
    coalesce((SELECT sum(t.total_transaction) FILTER(WHERE t.is_transaction_billable) FROM customer_transactions t
      JOIN customer_invoices linked ON linked.customer_invoice_id=t.customer_invoice_id
      WHERE coalesce(linked.parent_invoice_id,linked.customer_invoice_id)=p.customer_invoice_id AND t.account_id=p.account_id AND t.customer_id=p.customer_id),0)::numeric(14,2) AS stamped_gross_charges,
    (SELECT count(*)::int FROM customer_transactions t JOIN customer_invoices li ON li.customer_invoice_id=t.customer_invoice_id
      WHERE coalesce(li.parent_invoice_id,li.customer_invoice_id)=p.customer_invoice_id AND t.account_id=p.account_id AND t.customer_id=p.customer_id
        AND t.is_transaction_billable) AS stamped_billable_count,
    EXISTS(SELECT 1 FROM customer_transactions t JOIN customer_invoices li ON li.customer_invoice_id=t.customer_invoice_id
      WHERE coalesce(li.parent_invoice_id,li.customer_invoice_id)=p.customer_invoice_id AND t.total_transaction<0) AS has_negative_charge
    FROM customer_invoices p LEFT JOIN LATERAL (SELECT q.* FROM customer_invoices q
      WHERE q.account_id=p.account_id AND q.customer_id=p.customer_id AND q.parent_invoice_id IS NULL
      AND (q.created_at,q.customer_invoice_id)<(p.created_at,p.customer_invoice_id)
      ORDER BY q.invoice_date DESC,q.created_at DESC,q.customer_invoice_id DESC LIMIT 1) prev ON true
    WHERE p.account_id=1 AND p.parent_invoice_id IS NULL AND p.customer_id=ANY(?::int[])
    ORDER BY p.customer_id,p.created_at,p.customer_invoice_id`,[customers]);
  const events=await rows(db, `SELECT p.customer_invoice_id AS statement_id,w.writeoff_id,w.writeoff_amount,w.customer_invoice_id AS linked_row,
    w.customer_job_id,root.invoice_date::text AS linked_chain_date,
    (prev.customer_invoice_id IS NULL OR w.created_at>=prev.invoice_date) AS old_gate,
    (prev.customer_invoice_id IS NULL OR w.created_at>prev.created_at) AS new_gate,
    (w.customer_invoice_id IS NULL OR prev.invoice_date IS NULL OR root.invoice_date IS NULL OR root.invoice_date<prev.invoice_date) AS direct_credit,
    EXISTS(SELECT 1 FROM customer_transactions t JOIN customer_invoices ti ON ti.customer_invoice_id=t.customer_invoice_id
      JOIN customer_jobs j ON j.customer_job_id=t.customer_job_id JOIN customer_job_types jt ON jt.job_type_id=j.job_type_id
      WHERE coalesce(ti.parent_invoice_id,ti.customer_invoice_id)=p.customer_invoice_id AND t.account_id=p.account_id AND t.customer_id=p.customer_id
        AND t.customer_job_id=w.customer_job_id) AS matching_stamped_job,
    (w.customer_invoice_id IS NOT NULL AND root.customer_invoice_id IS NOT NULL AND root.invoice_date=prev.invoice_date
      AND linked.created_at<=p.created_at) AS reflected_in_previous_chain
    FROM customer_invoices p JOIN customer_writeoffs w ON w.account_id=p.account_id AND w.customer_id=p.customer_id AND w.created_at<p.created_at
    LEFT JOIN customer_invoices linked ON linked.customer_invoice_id=w.customer_invoice_id
    LEFT JOIN customer_invoices root ON root.customer_invoice_id=coalesce(linked.parent_invoice_id,linked.customer_invoice_id)
    LEFT JOIN LATERAL (SELECT q.* FROM customer_invoices q WHERE q.account_id=p.account_id AND q.customer_id=p.customer_id AND q.parent_invoice_id IS NULL
      AND (q.created_at,q.customer_invoice_id)<(p.created_at,p.customer_invoice_id)
      ORDER BY q.invoice_date DESC,q.created_at DESC,q.customer_invoice_id DESC LIMIT 1) prev ON true
    WHERE p.account_id=1 AND p.parent_invoice_id IS NULL AND p.customer_id=ANY(?::int[])
    ORDER BY p.customer_invoice_id,w.writeoff_id`,[customers]);
  const byStatement=new Map();
  for(const e of events) { if(!byStatement.has(e.statement_id)) byStatement.set(e.statement_id,[]); byStatement.get(e.statement_id).push(e); }
  const evidence=[];
  const modeById=new Map();
  for(const p of statements) {
    const es=(byStatement.get(p.customer_invoice_id)||[]).filter(e=>e.old_gate);
    const shown=es.filter(e=>e.direct_credit).reduce((n,e)=>n+cents(e.writeoff_amount),0n);
    const hidden=es.filter(e=>e.linked_row && e.direct_credit).reduce((n,e)=>n+cents(e.writeoff_amount),0n);
    const hiddenJobs=es.filter(e=>e.matching_stamped_job).reduce((n,e)=>n+cents(e.writeoff_amount),0n);
    const newEvents=(byStatement.get(p.customer_invoice_id)||[]).filter(e=>e.new_gate);
    const newShown=newEvents.filter(e=>e.direct_credit).reduce((n,e)=>n+cents(e.writeoff_amount),0n);
    const newHidden=newEvents.filter(e=>e.linked_row && e.direct_credit).reduce((n,e)=>n+cents(e.writeoff_amount),0n);
    const newHiddenJobs=newEvents.filter(e=>e.matching_stamped_job).reduce((n,e)=>n+cents(e.writeoff_amount),0n);
    const gross=cents(p.stamped_gross_charges),storedCharges=cents(p.total_charges);
    // Historical finalization truncated every stamped transaction dollar amount.
    // Permit less than $1 per billable row of lost fractions and less than $1
    // of issue-total truncation. This is a reconciliation bound, not restored data.
    const fitsCharges=adjustment=>{
      const residual=storedCharges-gross-adjustment;
      if(!p.stamped_billable_count) return residual===0n;
      const bound=BigInt(p.stamped_billable_count)*100n;
      return residual < bound && residual > (p.has_negative_charge ? -bound : -100n);
    };
    const modes=[],newModes=[];
    if(cents(p.total_write_offs)===shown && fitsCharges(0n)) modes.push('shown');
    if(cents(p.total_write_offs)===hidden && fitsCharges(hiddenJobs)) modes.push('hidden');
    if(cents(p.total_write_offs)===newShown && fitsCharges(0n)) newModes.push('shown');
    if(cents(p.total_write_offs)===newHidden && fitsCharges(newHiddenJobs)) newModes.push('hidden');
    modeById.set(p.customer_invoice_id,{old:modes,new:newModes});
    evidence.push({...p,old_shown_writeoffs:money(shown),old_hidden_writeoffs:money(hidden),hidden_job_reduction:money(hiddenJobs),
      new_shown_writeoffs:money(newShown),new_hidden_writeoffs:money(newHidden),new_hidden_job_reduction:money(newHiddenJobs),
      admissible_old_modes:modes.join('|')||'none',admissible_new_modes:newModes.join('|')||'none',
      shown_charge_residual:money(storedCharges-gross),hidden_charge_residual:money(storedCharges-gross-hiddenJobs),
      new_hidden_charge_residual:money(storedCharges-gross-newHiddenJobs)});
  }
  function times(e,mode,gate) {
    if(!e || !e[gate]) return 0;
    return mode==='shown' ? Number(e.direct_credit) : Number(!!e.linked_row && e.direct_credit)+Number(e.matching_stamped_job);
  }
  const detail=[];
  for(const w of candidates) {
    const billIndex=statements.findIndex(p=>p.customer_invoice_id===w.bill_day_id);
    const firstEvent=(byStatement.get(w.bill_day_id)||[]).find(e=>e.writeoff_id===w.writeoff_id);
    const firstModes=modeById.get(w.bill_day_id).old;
    const firstCounts=firstModes.map(m=>times(firstEvent,m,'old_gate') + Number(!!firstEvent?.reflected_in_previous_chain));
    const firstMin=firstCounts.length ? Math.min(...firstCounts):0;
    const firstMax=firstCounts.length ? Math.max(...firstCounts):1;
    const subsequent=statements.slice(billIndex+1).filter(p=>p.customer_id===w.customer_id);
    for(const p of subsequent) {
      const e=(byStatement.get(p.customer_invoice_id)||[]).find(x=>x.writeoff_id===w.writeoff_id);
      const modeInfo=modeById.get(p.customer_invoice_id);
      const modes=modeInfo.old;
      const diffs=modes.map(m=>times(e,m,'old_gate')-times(e,m,'new_gate'));
      const min=diffs.length ? Math.min(...diffs):0;
      const max=diffs.length ? Math.max(...diffs):Math.max(times(e,'shown','old_gate')-times(e,'shown','new_gate'),times(e,'hidden','old_gate')-times(e,'hidden','new_gate'));
      const supported=firstMin>0 && !modeInfo.new.length ? Math.max(0,min):0;
      const possible=firstMax>0 && (modes.length || !modeInfo.new.length) ? Math.max(0,max):0;
      detail.push({...w,later_id:p.customer_invoice_id,later_statement:p.invoice_number,later_date:p.invoice_date,
        old_cutoff_date:p.old_cutoff_date,new_cutoff_timestamp:p.new_cutoff_timestamp,
        old_gate:!!e?.old_gate,new_gate:!!e?.new_gate,matching_stamped_job:!!e?.matching_stamped_job,
        first_modes:firstModes.join('|'),later_modes:modes.join('|'),later_new_modes:modeInfo.new.join('|'),first_reflected_min:firstMin,
        old_credits_if_shown:times(e,'shown','old_gate'),new_credits_if_shown:times(e,'shown','new_gate'),
        old_credits_if_hidden:times(e,'hidden','old_gate'),new_credits_if_hidden:times(e,'hidden','new_gate'),
        recredit_supported:money(-cents(w.writeoff_amount)*BigInt(supported)),
        recredit_possible:money(-cents(w.writeoff_amount)*BigInt(possible)),
        conclusion:supported>0 ? 're-credit supported within truncation bounds; verify issued PDF' : possible>0 ? 'manual review: historical display mode/totals ambiguous' : 'no repeat credit supported; see gates and old/new reconciliation'});
    }
    if(!subsequent.length) detail.push({...w,conclusion:'no later statement',recredit_supported:'0.00',recredit_possible:'0.00'});
  }
  const report=customers.map(customer_id=>{
    const ws=candidates.filter(w=>w.customer_id===customer_id),ds=detail.filter(d=>d.customer_id===customer_id);
    return {customer_id,customer:ws[0].customer,population_writeoffs:ws.length,population_signed_amount:sum(ws,'writeoff_amount'),
      amount_credited_twice_supported:sum(ds,'recredit_supported'),amount_credited_twice_possible:sum(ds,'recredit_possible'),
      supported_statements:[...new Set(ds.filter(d=>cents(d.recredit_supported)>0n).map(d=>d.later_statement))].join('; '),
      possible_statements:[...new Set(ds.filter(d=>cents(d.recredit_possible)>0n).map(d=>d.later_statement))].join('; ')};
  });
  return {rows:report,details:{population:candidates,replay:detail,statement_evidence:evidence},summary:{customers:report.length,population: candidates.length,
    population_signed_amount:sum(candidates,'writeoff_amount'),subsequent_comparisons:detail.length,
    supported_double_credit:sum(report,'amount_credited_twice_supported'),possible_double_credit:sum(report,'amount_credited_twice_possible'),
    supported_customers:report.filter(r=>cents(r.amount_credited_twice_supported)>0n).length,
    possible_customers:report.filter(r=>cents(r.amount_credited_twice_possible)>0n).length}};
});
