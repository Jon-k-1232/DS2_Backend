'use strict';
// Authorized local sandbox inventory only. Never reads the reference database.
const fs=require('fs'),path=require('path');
const ctx=require('../src/endpoints/billingEntities/entity-context');
const {auditCustomerLedger}=require('../src/endpoints/accountAudit/account-audit-logic');
const db=require('knex')({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local'},pool:{min:0,max:2}});
const output=path.resolve(process.argv[2] || 'docs/decisions/evidence/run-H1');
const keys={customers:'customer_id',customer_transactions:'transaction_id',customer_payments:'payment_id',customer_writeoffs:'writeoff_id',customer_invoices:'customer_invoice_id',timesheet_entries:'timesheet_entry_id',users:'user_id',customer_retainers_and_prepayments:'retainer_id',recurring_customers:'recurring_customer_id',customer_quotes:'customer_quote_id',customer_jobs:'customer_job_id'};
const csv=rows=>{if(!rows.length)return '';const fields=Object.keys(rows[0]);const q=v=>'"'+String(v==null?'':typeof v==='object'?JSON.stringify(v):v).replaceAll('"','""')+'"';return fields.map(q).join(',')+'\n'+rows.map(r=>fields.map(f=>q(r[f])).join(',')).join('\n')+'\n';};
const money=n=>Math.round(Number(n)*100)/100;
async function financialInventory(trx,entities){
 const sources={invoices:'customer_invoices',payments:'customer_payments',writeoffs:'customer_writeoffs',transactions:'customer_transactions',retainers:'customer_retainers_and_prepayments',retainerEvents:'retainer_events'};
 const read=async()=>Object.fromEntries(await Promise.all(Object.entries(sources).map(async([key,table])=>[key,await trx(table).select('*',trx.raw('created_at::text AS created_at_exact')).where({account_id:1})])));
 const legacy=await ctx.unscoped(read),scoped=await ctx.run(null,read),customers=await trx('customers').where({account_id:1}).orderBy('customer_id');
 const project=(customer,data,entityId,stripEntity=false)=>{
  const selected=Object.fromEntries(Object.entries(data).map(([key,rows])=>[key,rows.filter(r=>r.customer_id===customer.customer_id && (entityId==null || r.billing_entity_id===entityId)).map(r=>stripEntity?Object.fromEntries(Object.entries(r).filter(([k])=>k!=='billing_entity_id')):r)]));
  const audit=auditCustomerLedger({customer,...selected}),t=audit.totals;
  return {customer_id:customer.customer_id,billing_entity_id:entityId,B:t.outstanding_invoices,U:t.unbilled_billable_on_jobs,P:money(t.audit_balance-t.outstanding_invoices-t.unbilled_billable_on_jobs),N:t.audit_balance,held_funds:t.retainer_available};
 };
 const before=customers.map(c=>project(c,legacy,null,true));
 const after=customers.flatMap(c=>entities.map(e=>({...project(c,scoped,e.billing_entity_id),business:e.name})));
 const billingDate=require('../src/endpoints/invoice/billingDate').billingDateToday();
 const held=customers.map(c=>{
  const rows=scoped.transactions.filter(t=>t.customer_id===c.customer_id && t.billing_entity_id===null && !t.customer_invoice_id && t.is_transaction_billable);
  const eligible=rows.filter(t=>t.customer_job_id && (!t.transaction_date || require('dayjs')(t.transaction_date).format('YYYY-MM-DD')<=billingDate));
  return {customer_id:c.customer_id,unresolved_work:money(rows.reduce((n,t)=>n+Number(t.total_transaction),0)),unresolved_eligible_work:money(eligible.reduce((n,t)=>n+Number(t.total_transaction),0))};
 });
 const total=rows=>Object.fromEntries(['B','U','P','N','held_funds'].map(k=>[k,money(rows.reduce((n,r)=>n+r[k],0))]));
 const pre=total(before),post=total(after),eligibleHeld=money(held.reduce((n,r)=>n+r.unresolved_eligible_work,0));
 const reconciliation={B:money(post.B-pre.B),U_including_held:money(post.U+eligibleHeld-pre.U),P:money(post.P-pre.P),N_including_held:money(post.N+eligibleHeld-pre.N),held_funds:money(post.held_funds-pre.held_funds)};
 const defaultId=entities.find(e=>e.is_default)?.billing_entity_id;
 const perClientDifferences=before.flatMap(original=>after.filter(row=>row.customer_id===original.customer_id).flatMap(row=>['B','U','P','N','held_funds'].filter(key=>money(row[key]-(row.billing_entity_id===defaultId?original[key]:0))!==0).map(key=>({customerId:row.customer_id,entityId:row.billing_entity_id,key,expected:row.billing_entity_id===defaultId?original[key]:0,actual:row[key]}))));
 return {before,after,held,perClientDifferences,totals:{legacyUnpartitionedRecomputed:pre,after:post,unresolved_work:money(held.reduce((n,r)=>n+r.unresolved_work,0)),unresolved_eligible_work:eligibleHeld,reconciliation},method:'Legacy values recomputed from the hash-verified original physical rows with business attribution omitted; not a captured pre-migration engine run. After values use the effective business views. B=billed; U=eligible work; P=signed pending adjustments; N=B+U+P. Held funds are separate. H2 amendment keeps every legacy opening component in the default business; other businesses start at zero. Only new unmatched work is held for review. Nonzero reconciliation differences require review, not a balancing write.'};
}
(async()=>{
 const baseline=JSON.parse(fs.readFileSync(path.join(output,'account1-before.json'),'utf8'));
 const report=await db.transaction(async trx=>{
  await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables={};
  for(const [table,key] of Object.entries(keys)){
   const rows=await trx(`${table} as t`).select(`${key} as id`,trx.raw("encode(sha256(convert_to((to_jsonb(t)-'billing_entity_id')::text,'UTF8')),'hex') AS sha256")).where('account_id',1).orderBy(key);
   const old=new Map(baseline.tables[table].map(r=>[r.id,r.sha256]));const changed=rows.filter(r=>old.has(r.id) && old.get(r.id)!==r.sha256).map(r=>r.id);const added=rows.filter(r=>!old.has(r.id)).map(r=>r.id);const present=new Set(rows.map(r=>r.id));const removed=[...old.keys()].filter(id=>!present.has(id));
   const hasBusiness=await trx.schema.hasColumn(table,'billing_entity_id');
   const physicalBusinessAssignments=hasBusiness?Number((await trx(table).where({account_id:1}).whereNotNull('billing_entity_id').count({n:'*'}).first()).n):0;
   tables[table]={referenceCount:old.size,currentCount:rows.length,changed,added,removed,physicalBusinessAssignments};
  }
  const evidence={};for(const table of ['billing_entities','billing_entity_aliases','billing_cutovers','legacy_financial_entity_attributions','billing_entity_reviews','billing_entity_resolutions','billing_cutover_positions','billing_cutover_links','billing_cutover_allocations','billing_cutover_allocation_links','billing_credit_transfers','billing_entity_invoice_sequences','financial_requests','billing_cutover_amendments','legacy_billing_scopes','ar_derivations','ar_obligations','ar_applications','ar_obligation_carriers','payment_receipts','client_credit_lots','client_credit_events','receipt_events'])evidence[table]=await trx(table).where({account_id:1});
  const tracker=(await trx.raw('SELECT entity,count(*)::integer AS rows,ds2_normalize_entity(entity) AS normalized,ds2_entity_match(1,entity) AS candidate_ids FROM timesheet_entries WHERE account_id=1 GROUP BY entity ORDER BY rows DESC')).rows;
  const artifactInventory=await trx('customer_invoices').select('customer_invoice_id','invoice_number','invoice_file_location').where({account_id:1}).whereNotNull('invoice_file_location');
  const events=(await trx.raw("SELECT source,entity,action,count(*)::integer AS rows FROM audit_events WHERE account_id=1 GROUP BY source,entity,action ORDER BY source,entity,action")).rows;
  const financial=await financialInventory(trx,evidence.billing_entities);
  const heldLegacy=(await trx.raw("SELECT count(*)::int AS count FROM legacy_billing_scopes s WHERE s.account_id=1 AND public.ds2_effective_entity(s.account_id,s.table_name,s.record_id,NULL) IS NULL")).rows[0].count;
  const auditVerification=(await trx.raw('SELECT ds2_verify_audit(1) AS verification')).rows[0].verification;
  return {generatedAt:new Date().toISOString(),database:'ds2_local',accountId:1,reference:'Retained reference census in FINAL_REPORT.md; ds2_ref_20260922 not accessed',tables,tracker,events,evidence,artifactInventory,financial,heldLegacy,auditVerification,
   reviewedDefault:'James F. Kimmel & Associates',openingTotal:evidence.billing_cutover_positions.reduce((n,p)=>n+Math.round(Number(p.opening_amount)*100),0)/100,
   originalFieldsChanged:0,artifactNote:'Original DB rows and artifact locations are hash compared. Original remote artifact bytes were not fetched: AWS access is forbidden. H1/H2 write no original artifact keys.',
   unresolvedNote:'Zero pre-cutover work is held. Tracker attribution is for reporting only. Candidate legacy moves are read-only until an admin explicitly reassigns identified unbilled work with a reason. Only unmatched new work is held.'};
 });
 report.candidates=await require('../src/endpoints/billingEntities/cutover-amendment').candidates(db,1);
 fs.mkdirSync(output,{recursive:true});
 for(const [table,rows] of Object.entries(report.evidence))fs.writeFileSync(path.join(output,table+'.csv'),csv(rows));
 for(const [name,rows] of Object.entries(report.financial))if(Array.isArray(rows))fs.writeFileSync(path.join(output,'financial-'+name+'.csv'),csv(rows));
 report.financial={totals:report.financial.totals,perClientDifferences:report.financial.perClientDifferences,method:report.financial.method};
 const counts=Object.fromEntries(Object.entries(report.evidence).map(([k,v])=>[k,v.length]));delete report.evidence;report.insertedEvidenceCounts=counts;
 const changed=Object.entries(report.tables).filter(([,t])=>t.changed.length || t.added.length || t.removed.length || t.physicalBusinessAssignments);report.originalFieldsChanged=changed.reduce((n,[,t])=>n+t.changed.length,0);report.preserved=changed.length===0;
 fs.writeFileSync(path.join(output,'account1-cutover-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({preserved:report.preserved,tables:report.tables,insertedEvidenceCounts:counts,openingTotal:report.openingTotal},null,2));
 if(changed.length || report.heldLegacy || report.financial.perClientDifferences.length || !report.auditVerification.valid || Object.values(report.financial.totals.reconciliation).some(value=>value!==0))process.exitCode=1;
 await db.destroy();
})().catch(async e=>{console.error(e);await db.destroy();process.exitCode=1;});
