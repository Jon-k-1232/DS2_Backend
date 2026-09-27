'use strict';
// Reporting uses issued documents and source events. It never changes the ledger
// or reuses the AR total as revenue. All allocations are in integer cents.
const context = require('../billingEntities/entity-context');
const { ruleError } = require('../payments/ledger-helpers');
const { day, date, today, utcTimestamp } = require('../payments/receipt-values');
const { billingDateToday } = require('../invoice/billingDate');
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const cents = n => Math.round(Number(n || 0) * 100);
const sum = (rows, fn) => rows.reduce((n, r) => n + fn(r), 0);
const map = (rows, key) => new Map(rows.map(r => [String(r[key]), r]));
const id = n => n == null ? null : Number(n);
// PostgreSQL's historical timestamp-without-zone columns use DB wall time.
// Read JSON text to avoid the node driver's host-timezone reinterpretation.
const instant = value => Date.parse(typeof value === 'string' && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value) ? value.replace(' ','T')+'Z' : value);
// Retainers have a recorded timestamp rather than a separate deposit date.
// Translate that UTC instant into the billing calendar, retaining any legacy
// date-only evidence as a date. Knowledge cutoffs still compare UTC instants.
const depositDay = value => typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) ? value : billingDateToday(new Date(instant(value)));
function options(input = {}) {
 const year = input.year == null || input.year === '' ? Number(today().slice(0,4)) : Number(input.year);
 if (!Number.isInteger(year) || year < 1900 || year > 2100) throw ruleError('Year must be between 1900 and 2100.',400);
 const start = date(input.start || `${year}-01-01`, {future:true});
 const end = date(input.end || `${year}-12-31`, {future:true});
 const asOf = date(input.asOf || input.billingDate || (end < today() ? end : today()), {future:true});
 if (start > end) throw ruleError('Start date must be on or before end date.',400);
 const recordedThrough = utcTimestamp(input.recordedThrough || new Date().toISOString());
 const selected = input.entityId === 'all' ? null : input.entityId ?? context.current();
 if (selected != null && (!/^[1-9]\d*$/.test(String(selected)) || Number(selected)>2147483647)) throw ruleError('Select a valid business.',400);
 return {...input,year,start,end,asOf,recordedThrough,entityId:id(selected),excludeIds:(input.excludeIds || []).map(Number)};
}
const TABLES = {
 work:['customer_transactions','transaction_id'], trackers:['timesheet_entries','timesheet_entry_id'],
 invoices:['customer_invoices','customer_invoice_id'], issues:['invoice_issues','invoice_id'],
 payments:['customer_payments','payment_id'], writeoffs:['customer_writeoffs','writeoff_id'],
 retainers:['customer_retainers_and_prepayments','retainer_id'], retainerEvents:['retainer_events','event_id'],
 transfers:['billing_credit_transfers','transfer_id'], obligations:['ar_obligations','obligation_id'],
 applications:['ar_applications','application_id'], receipts:['payment_receipts','receipt_id'],
 creditLots:['client_credit_lots','credit_id'], creditEvents:['client_credit_events','event_id'],
 receiptEvents:['receipt_events','event_id'], memos:['credit_memos','memo_id'], memoReversals:['credit_memo_reversals','reversal_id'],
 voids:['invoice_voids','void_id'], rebills:['rebill_links','link_id'], refunds:['client_refunds','refund_id'],
 occurrences:['recurring_charge_occurrences','occurrence_id'], estimates:['legacy_work_cost_estimates','estimate_id'],
 legacyScopes:['legacy_billing_scopes','scope_id'], attributions:['legacy_financial_entity_attributions','attribution_id'],
 customers:['customers','customer_id'], users:['users','user_id'], jobs:['customer_jobs','customer_job_id'],
 descriptions:['customer_general_work_descriptions','general_work_description_id'], jobTypes:['customer_job_types','job_type_id'],
 entities:['billing_entities','billing_entity_id']
};
const MUTABLE = new Set(['work','trackers','invoices','payments','writeoffs','retainers','occurrences']);
// Evidence sidecars contain provenance and snapshots that aren't report inputs.
// Select their required fields before JSON encoding; preserve date/numeric JSON
// types and the historical rewind of every mutable source table.
const PROJECTIONS={
 estimates:'table_name,record_id,source_timesheet_entry_id,cost_rate_snapshot,cost_rate_source,actual_duration_minutes,duration_source,standard_value_snapshot,cost_snapshot_at',
 legacyScopes:'table_name,record_id,billing_entity_id,reporting_entity_id,reporting_basis,created_at',
 attributions:'table_name,record_id,billing_entity_id,created_at',
 jobs:'customer_job_id,account_id,customer_id,parent_job_id,job_type_id,billing_entity_id,agreed_job_amount,is_job_complete,created_at'
};
async function load(db, accountId, input = {}) {
 const o = options(input);
 if(o.entityId)await context.requireEntity(db,accountId,o.entityId,{active:false});
 return context.unscoped(async () => {
  const read = async trx => {
  if (!db.isTransaction) await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const d={options:o,accountId:Number(accountId)};
  // Sequential on this one transaction connection, one consistent snapshot.
  for(const [name,[table,key]] of Object.entries(TABLES)) {
   let rows=(await trx.raw(`SELECT row_to_json(r) AS row FROM (SELECT ${PROJECTIONS[name] || '*'} FROM ?? WHERE account_id=?) r`,[`public.${table}`,Number(accountId)])).rows.map(r=>r.row);
   if(input.recordedThrough && MUTABLE.has(name)) {
    // Rewind changed/deleted records to their first known value after the
    // requested knowledge boundary. A future insertion contributes nothing.
    const changes=(await trx.raw(`SELECT DISTINCT ON(entity_id) entity_id,before_value FROM public.audit_events WHERE account_id=? AND entity=? AND occurred_at>?::timestamptz ORDER BY entity_id,occurred_at,event_id`,[accountId,table,o.recordedThrough])).rows;
    const state=map(rows,key);
    for(const e of changes){if(e.before_value)state.set(e.entity_id,e.before_value);else state.delete(e.entity_id);}
    rows=[...state.values()];
   }
   const knowledge=Date.parse(o.recordedThrough);
   d[name]=rows.filter(r => !r.created_at || instant(r.created_at)<=knowledge);
  }
  d.policy=(await trx.raw('SELECT to_jsonb(p) AS policy FROM public.invoice_lock_policy p')).rows[0]?.policy || {};
  return prepare(d);
  };
  return db.isTransaction ? read(db) : db.transaction(read);
 });
}
function allocate(amount, weights) {
 const total=sum(weights,w=>Math.max(0,w));
 if(!weights.length)return [];
 if(!total)return weights.map((_,i)=>i===0?amount:0);
 let left=amount;return weights.map((w,i)=>{const n=i===weights.length-1?left:Math.trunc(amount*Math.max(0,w)/total);left-=n;return n;});
}
function prepare(d) {
 const o=d.options, legacy=new Map(d.legacyScopes.map(r=>[`${r.table_name}/${r.record_id}`,r]));
 const attrs=new Map(d.attributions.map(r=>[`${r.table_name}/${r.record_id}`,r.billing_entity_id]));
 const estimates=new Map(d.estimates.map(r=>[`${r.table_name}/${r.record_id}`,r]));
 const customers=map(d.customers,'customer_id'), users=map(d.users,'user_id'), desc=map(d.descriptions,'general_work_description_id');
 const entityNames=map(d.entities,'billing_entity_id');
 const jobs=map(d.jobs,'customer_job_id'), recurringWork=new Set(d.occurrences.map(r=>r.transaction_id));
 const effective=(table,key,r)=>id(r.billing_entity_id ?? legacy.get(`${table}/${r[key]}`)?.billing_entity_id ?? attrs.get(`${table}/${r[key]}`));
 const entityName=e=>entityNames.get(String(e))?.name || 'Unattributed legacy work';
 d.entityName=entityName;
 const visibleCustomer=c=>!o.excludeIds.includes(Number(c));
 for(const [name,[table,key]] of Object.entries(TABLES)) {
  if(!['entities','legacyScopes','attributions','estimates'].includes(name))d[name]=d[name].map(r=>({...r,billing_entity_id:effective(table,key,r)}));
 }
 d.trackers=d.trackers.map(t=>{
  const scope=legacy.get(`timesheet_entries/${t.timesheet_entry_id}`);
  return {...t,worked_for_entity_id:scope?id(scope.reporting_entity_id):t.billing_entity_id,
   attribution_basis:scope?.reporting_basis || 'Recorded business'};
 });
 const invoiceMap=map(d.invoices,'customer_invoice_id');
 const rootFor=invoiceId=>{let r=invoiceMap.get(String(invoiceId)),seen=new Set();while(r?.parent_invoice_id && !seen.has(r.customer_invoice_id)){seen.add(r.customer_invoice_id);r=invoiceMap.get(String(r.parent_invoice_id));}return r;};
 d.rootFor=rootFor;
 const issueMap=map(d.issues,'invoice_id');
 d.documents=d.invoices.filter(i=>!i.parent_invoice_id && visibleCustomer(i.customer_id)).flatMap(i=>{
  const issue=issueMap.get(String(i.customer_invoice_id));
  const legacyIssued=i.invoice_file_location && instant(i.created_at)<instant(d.policy.legacy_before);
  if(!issue && !legacyIssued)return [];
  if(issue && instant(issue.issued_at)>Date.parse(o.recordedThrough))return [];
  if(day(i.invoice_date)>o.asOf)return [];
  const payload=issue?.payload || {};
  return [{id:i.customer_invoice_id,customer_id:i.customer_id,billing_entity_id:i.billing_entity_id,number:i.invoice_number,date:day(i.invoice_date),issued_at:issue?.issued_at || i.created_at,payload,legacy:!issue || !!payload.legacy,parent:i,work:[],gross:0,prebill:0,net:0,corrections:0,collected:0,writeoffs:0,standard:0,labor:0,estimated_count:0,unknown_count:0}];
 });
 const docs=map(d.documents,'id');
 // Freeze work from the original issue payload whenever present. Repeated
 // statement membership is evidence, not a second work or revenue event.
 const frozen=new Map();
 for(const doc of d.documents)for(const r of doc.payload.transactions?.allTransactionRecords || [])if(r.transaction_id && !frozen.has(String(r.transaction_id)))frozen.set(String(r.transaction_id),{...r,customer_invoice_id:doc.id});
 const allSourceTrackers=new Set(d.work.map(r=>id(r.source_timesheet_entry_id || estimates.get(`customer_transactions/${r.transaction_id}`)?.source_timesheet_entry_id)).filter(Boolean));
 d.work=d.work.filter(r=>visibleCustomer(r.customer_id)).map(current=>{
  const r={...current,...frozen.get(String(current.transaction_id))};
  const est=estimates.get(`customer_transactions/${r.transaction_id}`),ls=legacy.get(`customer_transactions/${r.transaction_id}`);
  const isTime=String(r.transaction_type).toLowerCase()==='time';
  const job=jobs.get(String(r.customer_job_id));
  const eligible=current.billing_entity_id!=null && (recurringWork.has(r.transaction_id) || (job && job.customer_id===r.customer_id && desc.has(String(r.general_work_description_id))));
  const minutes=isTime?Number(r.actual_duration_minutes ?? est?.actual_duration_minutes ?? Number(r.quantity)*60):0;
  const rate=r.cost_snapshot_at?r.cost_rate_snapshot:est?.cost_rate_snapshot;
  const source=r.cost_snapshot_at?r.cost_rate_source:est?.cost_rate_source || 'unknown';
  const durationSource=r.duration_source || est?.duration_source || 'estimated from quantity';
  const workedFor=ls?id(ls.reporting_entity_id):id(current.billing_entity_id);
  const root=rootFor(r.customer_invoice_id),doc=docs.get(String(root?.customer_invoice_id));
  return {...r,eligible,billing_entity_id:current.billing_entity_id,worked_for_entity_id:workedFor,worked_for:entityName(workedFor),billed_by:doc?entityName(doc.billing_entity_id):null,billed_by_entity_id:doc?.billing_entity_id ?? null,
   attribution_basis:ls?.reporting_basis || 'Recorded business',customer:customers.get(String(r.customer_id))?.display_name || `Client ${r.customer_id}`,
   employee:users.get(String(r.logged_for_user_id))?.display_name || 'Unknown staff',staff_active:users.get(String(r.logged_for_user_id))?.is_user_active ?? false,
   work_description:desc.get(String(r.general_work_description_id))?.general_work_description || 'Uncategorized',date:day(r.transaction_date),isTime,minutes,hours:minutes/60,
   standard:cents(r.standard_value_snapshot ?? est?.standard_value_snapshot ?? Number(r.quantity)*Number(r.unit_cost)),value:cents(r.total_transaction),
   cost_rate_snapshot:rate==null?null:Number(rate),cost_rate_source:source,cost_snapshot_at:r.cost_snapshot_at || est?.cost_snapshot_at || null,duration_source:durationSource,
   cost_status:!isTime?'not applicable':rate==null?'unknown':source==='estimated' || durationSource.includes('estimated')?'estimated':'recorded',
   labor:isTime && rate!=null?Math.round(minutes/60*Number(rate)*100):0,
   source_timesheet_entry_id:r.source_timesheet_entry_id || est?.source_timesheet_entry_id || null,document:doc?.id ?? null};
 });
 const workMap=map(d.work,'transaction_id');
 const workByDocument=new Map();
 for(const w of d.work){if(!workByDocument.has(w.document))workByDocument.set(w.document,[]);workByDocument.get(w.document).push(w);}
 const usedTrackers=allSourceTrackers;
 // Only unprocessed held rows are added to work totals; processed source
 // copies remain visible in the raw tracker reconciliation, not counted twice.
 d.held=d.trackers.filter(t=>!t.is_deleted && !t.is_processed && !usedTrackers.has(t.timesheet_entry_id) && visibleCustomer(t.suggested_customer_id)).map(t=>{
  const est=estimates.get(`timesheet_entries/${t.timesheet_entry_id}`);
  return {...t,worked_for:entityName(t.worked_for_entity_id),date:day(t.date),hours:Number(t.duration)/60,standard:cents(t.standard_value_snapshot ?? est?.standard_value_snapshot),cost_rate_source:t.cost_rate_source || est?.cost_rate_source || 'unknown'};
 });
 // Assign supporting effort once. Replacement documents reuse original work
 // identity; they never create extra hours or a second cost for the same work.
 for(const doc of d.documents) {
  doc.work=[...(workByDocument.get(doc.id) || [])];
  const linked=d.rebills.find(r=>r.replacement_invoice_id===doc.id);
  if(linked){
   const refs=[...new Set((linked.lines || []).map(l=>id(l.originalTransactionId)).filter(Boolean))];
   const original=docs.get(String(linked.original_invoice_id));
   doc.work=refs.length?refs.map(i=>workMap.get(String(i))).filter(Boolean):(original?.work || []);
  }
  // Covered work can have no invoice link. Bind it to the unique generated
  // period (same client, business and inclusive service dates).
  const periods=d.occurrences.filter(p=>doc.work.some(w=>w.transaction_id===p.transaction_id));
  for(const p of periods)for(const w of d.work)if(w.isTime && !w.is_transaction_billable && !w.is_excess_to_subscription && w.customer_id===doc.customer_id && w.billing_entity_id===doc.billing_entity_id && w.date>=day(p.period_start) && w.date<=day(p.period_end) && !doc.work.some(x=>x.transaction_id===w.transaction_id))doc.work.push(w);
  const payloadRows=doc.payload.transactions?.allTransactionRecords;
  const raw=payloadRows || doc.work;
  doc.gross=sum(raw.filter(w=>w.is_transaction_billable),w=>cents(w.total_transaction));
  // For a historical document with missing line evidence, retain its saved
  // charge total and disclose the unavailable work/cost attribution.
  if(!raw.length)doc.gross=cents(doc.parent.total_charges);
  const preRows=doc.payload.writeOffs?.allWriteOffRecords || [];
  const pre=preRows.filter(w=>!w.customer_invoice_id);
  doc.prebill=pre.length?-sum(pre,w=>cents(w.writeoff_amount)):Math.max(0,doc.gross-cents(Number(doc.parent.total_charges || 0)+Number(doc.parent.total_write_offs || 0)));
  doc.net=doc.gross-doc.prebill;
  doc.fixed_fee=sum(doc.work.filter(w=>!w.isTime),w=>w.value);
  doc.recurring_fee=sum(doc.work.filter(w=>d.occurrences.some(p=>p.transaction_id===w.transaction_id)),w=>w.value);
  doc.covered_hours=sum(doc.work.filter(w=>w.isTime && !w.is_transaction_billable),w=>w.hours);
 }
 d.billingEvents=d.documents.flatMap(doc=>[{date:doc.date,customer_id:doc.customer_id,billing_entity_id:doc.billing_entity_id,invoice_id:doc.id,gross:doc.gross,prebill:doc.prebill,memos:0,voids:0,net:doc.net,kind:'issued charges'}]);
 const effect=(r,amount,field,kind)=>{
  if(day(r.effective_date)>o.asOf || !visibleCustomer(r.customer_id))return;
  const invoiceId=r.original_invoice_id || d.memos.find(m=>m.memo_id===r.memo_id)?.original_invoice_id;
  const doc=docs.get(String(invoiceId)); if(!doc)return;
  doc.corrections+=amount;
  d.billingEvents.push({date:day(r.effective_date),customer_id:r.customer_id,billing_entity_id:r.billing_entity_id,invoice_id:invoiceId,gross:0,prebill:0,memos:field==='memos'?amount:0,voids:field==='voids'?amount:0,net:-amount,kind});
 };
 for(const m of d.memos)effect(m,cents(m.amount),'memos','credit memo');
 for(const r of d.memoReversals)effect(r,-cents(r.amount),'memos','credit memo reversal');
 for(const v of d.voids)effect(v,cents(v.amount),'voids','voided new charges');
 const owner=new Map();
 for(const doc of [...d.documents].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id)){
  if(d.voids.some(v=>v.original_invoice_id===doc.id && day(v.effective_date)<=o.asOf))continue;
  for(const w of doc.work)owner.set(w.transaction_id,doc.id);
 }
 for(const doc of d.documents){
  doc.support=doc.work.filter(w=>owner.get(w.transaction_id)===doc.id);
  // These are supporting-cohort measures. A voided document no longer owns
  // its work; its replacement must not count the original fee a second time.
  doc.fixed_fee=sum(doc.support.filter(w=>!w.isTime),w=>w.value);
  doc.recurring_fee=sum(doc.support.filter(w=>d.occurrences.some(p=>p.transaction_id===w.transaction_id)),w=>w.value);
  // Recurring fee value is allocated across covered work by standard value.
  // It is not added to that same denominator again.
  const recurringIds=new Set(d.occurrences.map(p=>p.transaction_id));
  doc.weights=doc.support.map(w=>doc.covered_hours && recurringIds.has(w.transaction_id)?0:w.standard);
  doc.standard=sum(doc.weights,n=>n);
  doc.hours=sum(doc.support,w=>w.hours);doc.labor=sum(doc.support,w=>w.labor);
  doc.estimated_count=doc.support.filter(w=>w.cost_status==='estimated').length;
  doc.unknown_count=doc.support.filter(w=>w.cost_status==='unknown').length;
  if(doc.legacy && !doc.work.length && doc.net-doc.corrections>0)doc.unknown_count++;
  doc.estimated_labor=sum(doc.support.filter(w=>w.cost_status==='estimated'),w=>w.labor);
  doc.unknown_standard=sum(doc.support.filter(w=>w.cost_status==='unknown'),w=>w.standard);
  doc.net_after_corrections=doc.net-doc.corrections;
  const shares=allocate(doc.net_after_corrections,doc.weights);
  doc.attribution=doc.support.map((w,i)=>({work_id:w.transaction_id,worked_for_entity_id:w.worked_for_entity_id,worked_for:w.worked_for,billed_by_entity_id:doc.billing_entity_id,billed_by:entityName(doc.billing_entity_id),attribution_basis:w.attribution_basis,net_billed:shares[i]/100,hours:w.hours,labor_cost:w.cost_rate_snapshot==null && w.isTime?null:w.labor/100,cost_status:w.cost_status}));
  if(!doc.support.length && doc.net_after_corrections)doc.attribution.push({worked_for_entity_id:null,worked_for:'Unattributed legacy work',billed_by_entity_id:doc.billing_entity_id,billed_by:entityName(doc.billing_entity_id),attribution_basis:doc.legacy?'unattributed legacy work':'Charge only; no labor recorded',net_billed:doc.net_after_corrections/100,hours:0,labor_cost:null,cost_status:doc.legacy?'unknown':'not applicable'});
 }
 prepareCollections(d,docs,rootFor);
 return d;
}
function prepareCollections(d,docs,rootFor) {
 const o=d.options,valid=r=>!o.excludeIds.includes(Number(r.customer_id));
 const payments=map(d.payments,'payment_id'),lots=map(d.creditLots,'credit_id'),apps=map(d.applications,'application_id'),obligations=map(d.obligations,'obligation_id');
 const retainerMap=map(d.retainers,'retainer_id');
 const retainerRoot=r=>{let x=retainerMap.get(String(r)),seen=new Set();while(x?.parent_retainer_id && !seen.has(x.retainer_id)){seen.add(x.retainer_id);x=retainerMap.get(String(x.parent_retainer_id));}return x;};
 const paymentCash=new Map(),funds=new Map(),funding=[];
 for(const r of d.retainers.filter(r=>!r.parent_retainer_id)) {
  if(String(r.form_of_payment).toLowerCase()!=='transfer')funding.push({time:instant(r.created_at),kind:'deposit',root:r.retainer_id,cash:Math.max(0,-cents(r.starting_amount)),amount:Math.max(0,-cents(r.starting_amount)),id:r.retainer_id});
 }
 for(const e of d.retainerEvents)funding.push({time:instant(e.created_at),kind:e.kind==='refund'?'refund':Number(e.balance_delta)<0?'adjustment_in':'adjustment_out',root:e.root_retainer_id,amount:cents(e.amount),id:Number(e.event_id)});
 for(const t of d.transfers)funding.push({time:instant(t.created_at),kind:'transfer',root:retainerRoot(t.source_retainer_id)?.retainer_id,destination:t.destination_retainer_id,amount:cents(t.amount),id:Number(t.transfer_id)});
 for(const p of d.payments.filter(p=>p.retainer_id))funding.push({time:instant(p.created_at),kind:cents(p.payment_amount)<0?'draw':'restore',root:retainerRoot(p.retainer_id)?.retainer_id,amount:Math.abs(cents(p.payment_amount)),id:p.payment_id,original:Number(/^\[reversal of payment #(\d+)\]/.exec(p.note || '')?.[1])});
 function take(root,amount){let left=amount,cash=0;const q=funds.get(root)||[];for(const lot of q){const used=Math.min(left,lot.amount);const paid=lot.amount?Math.min(lot.cash,Math.round(used*lot.cash/lot.amount)):0;lot.amount-=used;lot.cash-=paid;left-=used;cash+=paid;if(!left)break;}return cash;}
 function add(root,amount,cash){if(!funds.has(root))funds.set(root,[]);funds.get(root).push({amount,cash});}
 for(const e of funding.sort((a,b)=>a.time-b.time || a.id-b.id)){
  if(e.kind==='deposit')add(e.root,e.amount,e.cash);
  else if(e.kind==='adjustment_in')add(e.root,e.amount,0);
  else if(e.kind==='restore'){
   // Restore the original funding mix, never turn a noncash adjustment into
   // cash. An untraceable historical restoration has no proven cash source.
   const original=payments.get(String(e.original)),originalAmount=Math.abs(cents(original?.payment_amount));
   const cash=originalAmount?Math.round(e.amount*Math.abs(paymentCash.get(e.original)||0)/originalAmount):0;
   add(e.root,e.amount,cash);paymentCash.set(e.id,-cash);
  }
  else {const cash=take(e.root,e.amount);if(e.kind==='draw')paymentCash.set(e.id,cash);if(e.kind==='transfer')add(e.destination,e.amount,cash);}
 }
 const isCash=p=>!p.retainer_id && !['retainer','prepayment','receipt application','receipt credit'].includes(String(p.form_of_payment).toLowerCase());
 for(const p of d.payments)if(isCash(p))paymentCash.set(p.payment_id,-cents(p.payment_amount));
 d.cashEvents=[];
 for(const r of d.receipts.filter(valid))if(r.source_kind==='manual')d.cashEvents.push({date:day(r.receipt_date),customer_id:r.customer_id,billing_entity_id:r.billing_entity_id,amount:cents(r.amount),kind:'cash received',source:`receipt/${r.receipt_id}`});
 // Derived receipt headers are evidence for these originals, never more cash.
 for(const p of d.payments.filter(valid))if(isCash(p))d.cashEvents.push({date:day(p.payment_date),customer_id:p.customer_id,billing_entity_id:p.billing_entity_id,amount:-cents(p.payment_amount),kind:cents(p.payment_amount)>0?'cash reversal':'cash received',source:`payment/${p.payment_id}`});
 for(const r of d.retainers.filter(r=>valid(r) && !r.parent_retainer_id && String(r.form_of_payment).toLowerCase()!=='transfer'))d.cashEvents.push({date:depositDay(r.created_at),customer_id:r.customer_id,billing_entity_id:r.billing_entity_id,amount:-cents(r.starting_amount),kind:'retainer deposit',source:`retainer/${r.retainer_id}`});
 for(const e of d.receiptEvents.filter(e=>valid(e) && ['reversed','cancelled'].includes(e.kind))){const r=d.receipts.find(r=>r.receipt_id===e.receipt_id);if(r?.source_kind==='manual')d.cashEvents.push({date:day(e.effective_date),customer_id:e.customer_id,billing_entity_id:e.billing_entity_id,amount:-cents(r.amount),kind:'cash reversal',source:`receipt-event/${e.event_id}`});}
 d.collectionEvents=[];const linkedPayments=new Set();
 const pendingBudgets=new Map();
 for(const doc of d.documents){
  const rows=doc.payload.payments?.allPaymentRecords || doc.payload.payments?.paymentRecords || [];
  const eligible=rows.filter(p=>!p.customer_invoice_id || !docs.has(String(rootFor(p.customer_invoice_id)?.customer_invoice_id)));
  if(eligible.length)pendingBudgets.set(doc.id,{cash:sum(eligible,p=>paymentCash.get(p.payment_id)||0),retainer:-sum(eligible.filter(p=>p.retainer_id),p=>cents(p.payment_amount)),total:-sum(eligible,p=>cents(p.payment_amount))});
 }
 const applicationFunding=new Map(),creditUsed=new Map();
 function fundingFor(a,seen=new Set()){
  const key=String(a.application_id);if(applicationFunding.has(key))return applicationFunding.get(key);
  if(seen.has(key))return {cash:0,retainer:0,kind:'unresolved funding'};
  seen.add(key);const amount=cents(a.amount),source=a.reversal_of?apps.get(String(a.reversal_of)):null;
  let cash=0,retainer=0,kind='noncash application';
  const lot=lots.get(String(a.credit_id));
  if(source){
   const original=fundingFor(source,seen),ratio=amount/cents(source.amount);
   cash=-Math.round(original.cash*ratio);retainer=-Math.round(original.retainer*ratio);kind=original.kind;
   if(source.credit_id && creditUsed.has(String(source.credit_id)))creditUsed.set(String(source.credit_id),creditUsed.get(String(source.credit_id))-amount);
  }else if(a.receipt_id || lot?.kind==='held_receipt'){cash=amount;kind='receipt-backed application';}
  else if(a.compatibility_payment_id){
   const p=payments.get(String(a.compatibility_payment_id));
   if(p){linkedPayments.add(p.payment_id);const total=Math.abs(cents(p.payment_amount));cash=total?Math.round(amount*Math.abs(paymentCash.get(p.payment_id)||0)/total):0;retainer=p.retainer_id?amount:0;kind=p.retainer_id?'receipt-backed retainer draw':'legacy payment application';}
  }else if(a.source_kind==='legacy_pending_payment'){
   const budget=pendingBudgets.get(Number(String(a.source_key).split('/')[1]));
   if(budget?.total>0){cash=Math.round(amount*Math.max(0,Math.min(budget.cash,budget.total))/budget.total);retainer=Math.round(amount*Math.max(0,Math.min(budget.retainer,budget.total))/budget.total);kind='pending source payments applied at issue';}
  }else if(lot){
   // Void/rebill releases non-header funding as statement credit. Trace its
   // immutable source application, including multiple rebills, instead of
   // relabeling an actual cash retainer draw as a noncash concession.
   const released=/^rebill\/\d+\/application\/(\d+)$/.exec(lot.source_key || '');
   const original=released && apps.get(released[1]);
   if(original){
    const funding=fundingFor(original,seen),total=cents(original.amount),used=creditUsed.get(String(lot.credit_id)) || 0;
    cash=Math.round((used+amount)*funding.cash/total)-Math.round(used*funding.cash/total);
    retainer=Math.round((used+amount)*funding.retainer/total)-Math.round(used*funding.retainer/total);
    creditUsed.set(String(lot.credit_id),used+amount);kind='reapplied original funding after rebill';
   }
  }
  const result={cash,retainer,kind};applicationFunding.set(key,result);return result;
 }
 for(const a of d.applications.filter(valid).sort((a,b)=>Number(a.application_id)-Number(b.application_id))){
  const obligation=obligations.get(String(a.obligation_id)),amount=cents(a.amount)*Number(a.direction);
  const {cash,retainer,kind}=fundingFor(a);
  const invoiceId=obligation?.original_invoice_id;
  d.collectionEvents.push({date:day(a.effective_date),customer_id:a.customer_id,billing_entity_id:a.billing_entity_id,invoice_id:invoiceId,cash,retainer,noncash:amount-cash,amount,kind,source:a.source_kind,application_id:a.application_id});
 }
 // Exact invoice-linked compatibility payments not represented in the new
 // subledger still count once; unlinked receipts stay out of collections.
 for(const p of d.payments.filter(valid)){
  if(linkedPayments.has(p.payment_id) || !p.customer_invoice_id || ['Receipt application','Receipt credit'].includes(p.form_of_payment))continue;
  const doc=docs.get(String(rootFor(p.customer_invoice_id)?.customer_invoice_id));if(!doc)continue;
  if(d.applications.some(a=>a.source_kind==='legacy_pending_payment' && String(a.source_key).startsWith(`issue-pending/${doc.id}/`)))continue;
  const cash=paymentCash.get(p.payment_id)||0;
  d.collectionEvents.push({date:day(p.payment_date)>doc.date?day(p.payment_date):doc.date,customer_id:p.customer_id,billing_entity_id:p.billing_entity_id,invoice_id:doc.id,cash,noncash:-cents(p.payment_amount)-cash,amount:-cents(p.payment_amount),kind:'legacy exact invoice link',source:p.retainer_id?'retainer_draw':'legacy_payment'});
 }
 for(const e of d.collectionEvents)if(e.date<=o.asOf){const doc=docs.get(String(e.invoice_id));if(doc)doc.collected+=e.cash;}
 d.writeoffEvents=d.writeoffs.filter(valid).map(w=>({date:day(w.writeoff_date),customer_id:w.customer_id,billing_entity_id:w.billing_entity_id,amount:-cents(w.writeoff_amount),invoice_id:rootFor(w.customer_invoice_id)?.customer_invoice_id,kind:w.customer_invoice_id?'bad debt write-off':'prebill concession'}));
 for(const w of d.writeoffEvents)if(w.date<=o.asOf && w.kind==='bad debt write-off'){const doc=docs.get(String(w.invoice_id));if(doc)doc.writeoffs+=w.amount;}
 d.refundEvents=[...d.refunds.map(r=>({date:day(r.effective_date),customer_id:r.customer_id,billing_entity_id:r.billing_entity_id,amount:cents(r.amount),kind:'client credit refund'})),...d.retainerEvents.filter(r=>r.kind==='refund').map(r=>({date:day(r.event_date),customer_id:r.customer_id,billing_entity_id:r.billing_entity_id,amount:cents(r.amount),kind:'retainer refund'}))].filter(valid);
 d.heldCredits=d.creditLots.filter(l=>valid(l) && day(l.effective_date)<=o.asOf).map(l=>({...l,available:cents(l.amount)+sum(d.creditEvents.filter(e=>e.credit_id===l.credit_id && day(e.effective_date)<=o.asOf),e=>cents(e.amount)*Number(e.direction))}));
}
// These indexes belong only to this already prepared snapshot. They cannot be
// reused after a write or another request and do not alter accounting rules.
const customerIndex=Symbol('report customer index');
function rowsFor(d,name,customerId){
 if(customerId==null)return d[name];
 if(!d[customerIndex])d[customerIndex]={};
 if(!d[customerIndex][name]){
  const index=new Map();for(const r of d[name]){const key=Number(r.customer_id ?? r.suggested_customer_id);if(!index.has(key))index.set(key,[]);index.get(key).push(r);}d[customerIndex][name]=index;
 }
 return d[customerIndex][name].get(Number(customerId)) || [];
}
function summarize(d, override={}) {
 const o={...d.options,...override},match=r=>(o.customerId==null || Number(r.customer_id)===Number(o.customerId)) && (o.entityId==null || Number(r.billing_entity_id)===Number(o.entityId));
 const worked=r=>(o.customerId==null || Number(r.customer_id ?? r.suggested_customer_id)===Number(o.customerId)) && (o.entityId==null || Number(r.worked_for_entity_id)===Number(o.entityId));
 const period=r=>r.date>=o.start && r.date<=o.end && r.date<=o.asOf;
 const rows=name=>rowsFor(d,name,o.customerId);
 const work=rows('work').filter(w=>worked(w) && period(w));
 const wip=rows('work').filter(w=>worked(w) && w.is_transaction_billable && !w.document && w.date<=o.asOf);
 const held=rows('held').filter(w=>worked(w) && w.date<=o.asOf);
 const events=rows('billingEvents').filter(r=>match(r) && period(r));
 const docs=rows('documents').filter(r=>match(r) && period(r));
 const collection=rows('collectionEvents').filter(r=>match(r) && period(r));
 const cash=rows('cashEvents').filter(r=>match(r) && period(r));
 const refund=rows('refundEvents').filter(r=>match(r) && period(r));
 const writeoffs=rows('writeoffEvents').filter(r=>match(r) && period(r));
 const net=sum(events,e=>e.net),cohortNet=sum(docs,r=>r.net_after_corrections),standard=sum(docs,r=>r.standard),labor=sum(docs,r=>r.labor),collected=sum(docs,r=>r.collected),badDebt=sum(docs,r=>r.writeoffs);
 const unknown=sum(docs,r=>r.unknown_count);
 const estimated=sum(docs,r=>r.estimated_count);
 return {
  work_entered_value:sum(work,w=>w.standard)/100,work_entered_hours:round(sum(work,w=>w.hours)),billable_work_value:sum(work.filter(w=>w.is_transaction_billable),w=>w.standard)/100,
  nonbillable_work_value:sum(work.filter(w=>!w.is_transaction_billable),w=>w.standard)/100,covered_hours:round(sum(work.filter(w=>!w.is_transaction_billable && !w.is_excess_to_subscription),w=>w.hours)),
  wip:sum(wip.filter(w=>w.eligible),w=>w.value)/100,held_work_value:(sum(held,w=>w.standard)+sum(wip.filter(w=>!w.eligible),w=>w.value))/100,held_work_hours:round(sum(held,w=>w.hours)),
  gross_billed:sum(events,r=>r.gross)/100,prebill_concessions:sum(events,r=>r.prebill)/100,credit_memos:sum(events,r=>r.memos)/100,voided_charges:sum(events,r=>r.voids)/100,net_billed:net/100,total_billed:net/100,
  collected:sum(collection,r=>r.cash)/100,noncash_applications:sum(collection,r=>r.noncash)/100,
  gross_cash_received:sum(cash.filter(r=>r.amount>0),r=>r.amount)/100,cash_reversed:-sum(cash.filter(r=>r.amount<0),r=>r.amount)/100,cash_returned:sum(refund,r=>r.amount)/100,
  held_receipt_credit:sum(d.heldCredits.filter(r=>match(r) && r.kind==='held_receipt'),r=>r.available)/100,statement_credit:sum(d.heldCredits.filter(r=>match(r) && r.kind==='statement_credit'),r=>r.available)/100,
  writeoffs:sum(writeoffs.filter(r=>r.kind==='bad debt write-off'),r=>r.amount)/100,entered_prebill_concessions:sum(writeoffs.filter(r=>r.kind==='prebill concession'),r=>r.amount)/100,
  retainer_use:sum(collection,r=>r.retainer ?? (r.source==='retainer_draw'?r.amount:0))/100,
  cohort_net_billed:cohortNet/100,cohort_standard_value:standard/100,cohort_hours:round(sum(docs,r=>r.hours)),cohort_collected:collected/100,cohort_writeoffs:badDebt/100,
  billing_realization_pct:standard>0?round(cohortNet/standard*100):null,collection_realization_pct:cohortNet-badDebt>0?round(collected/(cohortNet-badDebt)*100):null,
  known_labor_cost:labor/100,labor_cost:unknown?null:labor/100,margin:unknown?null:(cohortNet-labor)/100,margin_pct:unknown || cohortNet<=0?null:round((cohortNet-labor)/cohortNet*100),
  cost_status:unknown?'unknown':estimated?'estimated':'recorded',estimated_cost_count:estimated,unknown_cost_count:unknown,estimated_labor_cost:sum(docs,r=>r.estimated_labor)/100,unknown_cost_standard_value:sum(docs,r=>r.unknown_standard)/100,
  recurring_fees:sum(docs,r=>r.recurring_fee)/100,fixed_fees:sum(docs,r=>r.fixed_fee)/100,entries:work.length,issued_statements:docs.length
 };
}
const DEFINITIONS={
 work_entered:'Actual hours and standard value by service date; excludes copied tracker rows. Held tracker work is separate.',
 wip:'Eligible billable work not yet on an issued statement at As of. Held/unresolved work is separate.',
 billed:'New charges on issued statements by statement issue date, less prebill concessions and effective credit memos/voids. Balance forward, drafts and applications are excluded.',
 collected:'Receipt-backed applications by effective date, net of reversals. Cash deposits, noncash adjustments and credit transfers are separate.',
 cohort:'Statements issued in the selected period, with corrections and applications through As of. Billing realization uses the same work; collection realization uses collectible cohort net charges after bad-debt write-offs.',
 margin:'Cohort net billed less actual-hours labor at captured rates. Unknown costs suppress margin; historical rate/quantity estimates are labeled. A staff rate change affects future records only.',
 attribution:'Work filters use worked for; revenue/cash filters use billed by. Historical tracker attribution never moves ledger balances. Unresolved legacy work is explicitly unattributed.',
 recurring:'Covered effort is assigned to its client/business service period. Fee attribution is proportional to the standard value of supporting work; fee and covered standard value are never both denominators.',
 knowledge:'Recorded through is a UTC knowledge boundary. Pre-audit changes cannot be reconstructed; legacy evidence is explicitly estimated.'
};
function report(d) {
 const o=d.options;
 const docs=d.documents.filter(r=>(o.entityId==null || r.billing_entity_id===o.entityId) && r.date>=o.start && r.date<=o.end);
 return {version:2,period:{start:o.start,end:o.end,asOf:o.asOf,recordedThrough:o.recordedThrough,entityId:o.entityId,entity:o.entityId?d.entityName(o.entityId):'All businesses'},definitions:DEFINITIONS,
  totals:summarize(d),byEntity:d.entities.filter(e=>o.entityId==null || e.billing_entity_id===o.entityId).map(e=>({entity_id:e.billing_entity_id,name:e.name,active:e.active,...summarize(d,{entityId:e.billing_entity_id})})),
  unattributed_legacy_work:{value:sum(d.work.filter(w=>w.worked_for_entity_id==null && w.date>=o.start && w.date<=o.end && w.date<=o.asOf),w=>w.standard)/100,hours:round(sum(d.work.filter(w=>w.worked_for_entity_id==null && w.date>=o.start && w.date<=o.end && w.date<=o.asOf),w=>w.hours))},
  cohorts:docs.map(r=>({invoice_id:r.id,invoice_number:r.number,customer_id:r.customer_id,issue_date:r.date,billed_by:d.entityName(r.billing_entity_id),billing_entity_id:r.billing_entity_id,gross_billed:r.gross/100,prebill_concessions:r.prebill/100,corrections:r.corrections/100,net_billed:r.net_after_corrections/100,collected:r.collected/100,writeoffs:r.writeoffs/100,standard_value:r.standard/100,actual_hours:round(r.hours),labor_cost:r.unknown_count?null:r.labor/100,cost_status:r.unknown_count?'unknown':r.estimated_count?'estimated':'recorded',legacy:r.legacy})),
  attribution:docs.flatMap(r=>r.attribution.map(a=>({...a,invoice_id:r.id,invoice_number:r.number}))),
  work:d.work.filter(w=>(o.entityId==null || w.worked_for_entity_id===o.entityId) && w.date>=o.start && w.date<=o.end && w.date<=o.asOf).map(w=>({work_id:w.transaction_id,customer:w.customer,service_date:w.date,employee:w.employee,staff_active:w.staff_active,worked_for:w.worked_for,billed_by:w.billed_by,attribution_basis:w.attribution_basis,hours:round(w.hours),standard_value:w.standard/100,is_billable:w.is_transaction_billable,status:w.document?'Issued':!w.eligible?'Held':'Unissued',cost_rate:w.cost_rate_snapshot,cost_rate_source:w.cost_rate_source,cost_status:w.cost_status,labor_cost:w.cost_status==='unknown'?null:w.labor/100,duration_source:w.duration_source,cost_snapshot_at:w.cost_snapshot_at})),
  events:[...d.billingEvents.map(e=>({...e,amount:e.net/100})),...d.collectionEvents.map(e=>({...e,amount:e.cash/100}))].filter(e=>(o.entityId==null || e.billing_entity_id===o.entityId) && e.date>=o.start && e.date<=o.end && e.date<=o.asOf).map(({date,kind,amount,invoice_id,billing_entity_id})=>({date,kind,amount,invoice_id,billing_entity_id}))
 };
}
module.exports={load,prepare,summarize,report,options,round,sum,allocate,DEFINITIONS};
