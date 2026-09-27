'use strict';
const model=require('./reporting-model');
const {lockCustomerLedger}=require('../payments/ledger-helpers');
const {billingDateToday}=require('../invoice/billingDate');
const {round,sum}=model;
// A packet may pass its one prepared repeatable-read snapshot. This is an
// explicit in-request value, never a cross-request cache or client parameter.
const load=(db,accountId,input,prepared)=>prepared?Promise.resolve({...prepared,options:model.options(input)}):model.load(db,accountId,input);
const median=values=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:round((s[i-1]+s[i])/2);};
const selected=(d,w)=>d.options.entityId==null || w.worked_for_entity_id===d.options.entityId;
const groups=(rows,key)=>{const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return [...m.entries()];};
const DEFAULT_EXCLUDE_NAME_PATTERNS=['LTDFH%','James F%Kimmel%Associate%','Kimmel Financial Partner%','Jim Kimmel Insurance Agenc%'];
const service={
 async getBillingPerformance(db,accountId,input={},prepared){return model.report(await load(db,accountId,input,prepared));},
 async getClientRates(db,accountId,input={},prepared) {
  const currentYear=Number(input.year || billingDateToday().slice(0,4));
  const yearsBack=Number(input.yearsBack ?? 6);
  if(!Number.isInteger(yearsBack) || yearsBack<1 || yearsBack>15)throw require('../payments/ledger-helpers').ruleError('Years back must be from 1 to 15.',400);
  const startYear=currentYear-yearsBack+1,years=Array.from({length:yearsBack},(_,i)=>startYear+i);
  const d=await load(db,accountId,{...input,start:`${startYear}-01-01`,end:`${currentYear}-12-31`},prepared);
  const clients=[],firmYears={},ratesByYear=new Map();
  for(const c of d.customers.filter(c=>!d.options.excludeIds.includes(c.customer_id))){
   const client={customer_id:c.customer_id,display_name:c.display_name,is_commercial:c.is_commercial_customer,is_active:c.is_customer_active,years:{}};
   for(const y of years){
    const s=model.summarize(d,{customerId:c.customer_id,start:`${y}-01-01`,end:`${y}-12-31`});
    if(!s.entries && !s.issued_statements && !s.total_billed)continue;
    const docs=d.documents.filter(r=>r.customer_id===c.customer_id && (d.options.entityId==null || r.billing_entity_id===d.options.entityId) && r.date.startsWith(String(y)));
    const timeBilled=sum(docs,r=>r.standard?Math.round(r.net_after_corrections*sum(r.support.filter(w=>w.isTime),w=>w.standard)/r.standard):0)/100;
    const rate=s.cohort_hours>0?round(timeBilled/s.cohort_hours):null;
    client.years[y]={...s,hours:s.cohort_hours,billed_hours:s.cohort_hours,time_billed:round(timeBilled),charges_billed:round(s.total_billed-timeBilled),effective_rate:rate,realization_pct:s.billing_realization_pct};
    if(rate!=null && s.cohort_hours>=1){if(!ratesByYear.has(y))ratesByYear.set(y,[]);ratesByYear.get(y).push({customer_id:c.customer_id,rate});}
   }
   if(Object.keys(client.years).length)clients.push(client);
  }
  const agreements=await db('public.customer_rate_agreements').where({account_id:Number(accountId)}).where('agreement_year','>=',startYear);
  for(const c of clients)for(const [y,r] of Object.entries(c.years)){const a=agreements.find(a=>a.customer_id===c.customer_id && a.agreement_year===Number(y));r.agreed_rate=a?Number(a.agreed_rate):null;r.rate_variance=a && r.effective_rate!=null?round(r.effective_rate-Number(a.agreed_rate)):null;}
  for(const [year,rows] of ratesByYear){const rates=rows.map(r=>r.rate);firmYears[year]={clients:rows.length,median_rate:median(rates),avg_rate:round(sum(rows,r=>r.rate)/rows.length)};for(const r of rows)clients.find(c=>c.customer_id===r.customer_id).years[year].firm_percentile=Math.round(rates.filter(n=>n<r.rate).length/rates.length*100);}
  const lastFullYear=currentYear-1,priorYear=currentYear-2,growths=[];
  for(const c of clients){const a=c.years[priorYear]?.effective_rate,b=c.years[lastFullYear]?.effective_rate;if(a && b)growths.push((b-a)/a);}
  const growth=median(growths)||0;
  for(const c of clients){const last=c.years[lastFullYear]?.effective_rate ?? null,prior=c.years[priorYear]?.effective_rate ?? null;Object.assign(c,{last_full_year_rate:last,current_year_rate:c.years[currentYear]?.effective_rate ?? null,yoy_pct:last && prior?round((last-prior)/prior*100):null,suggested_rate:last?round(last*(1+growth)):null});}
  return {version:2,definitions:model.DEFINITIONS,clients:clients.sort((a,b)=>a.display_name.localeCompare(b.display_name)),years,firm:{years:firmYears,median_yoy_pct:round(growth*100),last_full_year:lastFullYear,suggestion_formula:`last full-year issued cohort rate (${lastFullYear}) × (1 + firm median YoY ${round(growth*100)}%)`}};
 },
 async getTimeAllocation(db,accountId,input={},prepared){
  const y=Number(input.year || billingDateToday().slice(0,4));
  const d=await load(db,accountId,{...input,year:y,asOf:input.asOf || `${y}-12-31`},prepared);
  const work=d.work.filter(w=>selected(d,w) && w.date>=d.options.start && w.date<=d.options.end && w.date<=d.options.asOf);
  const summaryRows=rows=>{const h=sum(rows,w=>w.hours),b=sum(rows.filter(w=>w.is_transaction_billable),w=>w.hours);return {hours:round(h),billable_hours:round(b),nonbillable_hours:round(h-b),work_entered_value:sum(rows,w=>w.standard)/100,entries:rows.length};};
  const events=d.billingEvents.filter(e=>(d.options.entityId==null || e.billing_entity_id===d.options.entityId) && e.date>=d.options.start && e.date<=d.options.end && e.date<=d.options.asOf);
  const descBilled=new Map();
  for(const e of events){const doc=d.documents.find(r=>r.id===e.invoice_id);const support=doc?.support || [],shares=model.allocate(e.net,doc?.weights || []);if(!support.length)descBilled.set('Charge only / unattributed',(descBilled.get('Charge only / unattributed')||0)+e.net);support.forEach((w,i)=>descBilled.set(w.work_description,(descBilled.get(w.work_description)||0)+shares[i]));}
  const descriptions=new Map(groups(work,w=>w.work_description));for(const k of descBilled.keys())if(!descriptions.has(k))descriptions.set(k,[]);
  const customerIds=new Set([...work.map(w=>w.customer_id),...events.map(e=>e.customer_id)]);
  const totals=summaryRows(work),billed=sum(events,e=>e.net)/100;
  return {version:2,definitions:model.DEFINITIONS,year:y,availableYears:[...new Set(d.work.filter(w=>selected(d,w)).map(w=>Number(w.date.slice(0,4))))].filter(n=>n<=Number(billingDateToday().slice(0,4))+1).sort((a,b)=>b-a),
   summary:{...totals,total_hours:totals.hours,billable_pct:totals.hours>0?round(totals.billable_hours/totals.hours*100):null,billed_amount:billed,held_hours:round(sum(d.held.filter(w=>selected(d,w) && w.date>=d.options.start && w.date<=d.options.end && w.date<=d.options.asOf),w=>w.hours))},
   byWorkDescription:[...descriptions].map(([label,rows])=>({work_description:label,...summaryRows(rows),billed_amount:(descBilled.get(label)||0)/100})).sort((a,b)=>b.hours-a.hours),
   byCustomer:[...customerIds].map(customerId=>({customer_id:customerId,customer:d.customers.find(c=>c.customer_id===customerId)?.display_name || `Client ${customerId}`,...summaryRows(work.filter(w=>w.customer_id===customerId)),billed_amount:sum(events.filter(e=>e.customer_id===customerId),e=>e.net)/100})).sort((a,b)=>b.hours-a.hours || a.customer_id-b.customer_id).slice(0,20),
   monthly:[...new Set([...work.map(w=>Number(w.date.slice(5,7))),...events.map(e=>Number(e.date.slice(5,7)))])].sort((a,b)=>a-b).map(month=>({month,...summaryRows(work.filter(w=>Number(w.date.slice(5,7))===month)),billed_amount:sum(events.filter(e=>Number(e.date.slice(5,7))===month),e=>e.net)/100})),
   trackerByCategory:groups(d.trackers.filter(t=>!t.is_deleted && selected(d,t) && !d.options.excludeIds.includes(t.suggested_customer_id) && require('../payments/receipt-values').day(t.date)>=d.options.start && require('../payments/receipt-values').day(t.date)<=d.options.end && require('../payments/receipt-values').day(t.date)<=d.options.asOf),t=>String(t.category||'').trim() || '(uncategorized)').map(([category,rows])=>({category,hours:round(sum(rows,r=>Number(r.duration)/60)),entries:rows.length}))
  };
 },
 upsertRateAgreement(db,accountId,{customerId,year,agreedRate,notes,userId}){return db.transaction(async trx=>{await lockCustomerLedger(trx,accountId,customerId);return trx.raw(`INSERT INTO customer_rate_agreements(account_id,customer_id,agreement_year,agreed_rate,notes,created_by_user_id) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,customer_id,agreement_year) DO UPDATE SET agreed_rate=EXCLUDED.agreed_rate,notes=EXCLUDED.notes RETURNING *`,[accountId,customerId,year,agreedRate,notes||null,userId]).then(r=>r.rows[0]);});},
 async getWipAging(db,accountId,input={},prepared){
  const asOf=input.asOf || input.billingDate || billingDateToday();
  const d=await load(db,accountId,{...input,asOf},prepared);
  const wip=d.work.filter(w=>selected(d,w) && w.is_transaction_billable && !w.document);
  const result=groups(wip,w=>w.customer_id).map(([customerId,rows])=>{
   const due=rows.filter(w=>w.date<=asOf && w.eligible),future=rows.filter(w=>w.date>asOf),held=rows.filter(w=>w.date<=asOf && !w.eligible);
   const age=w=>Math.floor((Date.parse(asOf)-Date.parse(w.date))/86400000);
   const c=d.customers.find(c=>c.customer_id===customerId),oldest=due.map(w=>w.date).sort()[0]||null;
   return {customer_id:customerId,display_name:c?.display_name,is_active:c?.is_customer_active,unbilled_amount:sum(due,w=>w.value)/100,unbilled_hours:round(sum(due,w=>w.hours)),entries:due.length,oldest_date:oldest,days_old:oldest?age({date:oldest}):null,
    bucket_0_30:sum(due.filter(w=>age(w)<=30),w=>w.value)/100,bucket_31_60:sum(due.filter(w=>age(w)>30 && age(w)<=60),w=>w.value)/100,bucket_61_90:sum(due.filter(w=>age(w)>60 && age(w)<=90),w=>w.value)/100,bucket_over_90:sum(due.filter(w=>age(w)>90),w=>w.value)/100,future_dated_count:future.length,future_dated_amount:sum(future,w=>w.value)/100,held_amount:sum(held,w=>w.value)/100,asOf};
  }).filter(r=>r.entries || r.future_dated_count || r.held_amount);
  for(const [customerId,rows] of groups(d.held.filter(w=>selected(d,w) && w.date<=asOf),w=>w.suggested_customer_id)){
   let row=result.find(r=>r.customer_id===customerId);if(!row){const c=d.customers.find(c=>c.customer_id===customerId);row={customer_id:customerId ?? 'unassigned',display_name:c?.display_name || 'Unassigned tracker work',is_active:c?.is_customer_active ?? true,unbilled_amount:0,unbilled_hours:0,entries:0,oldest_date:null,days_old:null,bucket_0_30:0,bucket_31_60:0,bucket_61_90:0,bucket_over_90:0,future_dated_count:0,future_dated_amount:0,held_amount:0,asOf};result.push(row);}
   row.held_amount=round((row.held_amount||0)+sum(rows,w=>w.standard)/100);row.held_hours=round(sum(rows,w=>w.hours));row.held_entries=rows.length;
  }
  return result.sort((a,b)=>String(a.oldest_date||'9999').localeCompare(String(b.oldest_date||'9999')) || String(a.customer_id).localeCompare(String(b.customer_id))); 
 },
 async getJobBudgets(db,accountId,input={},prepared){
  const d=await load(db,accountId,input,prepared),jobMap=new Map(d.jobs.map(j=>[j.customer_job_id,j]));
  const root=id=>{const j=jobMap.get(id);return j?.parent_job_id || id;};
  return d.jobs.filter(j=>!j.parent_job_id && Number(j.agreed_job_amount)>0 && !d.options.excludeIds.includes(j.customer_id) && (!d.options.entityId || !j.billing_entity_id || j.billing_entity_id===d.options.entityId)).map(j=>{
   const work=d.work.filter(w=>selected(d,w) && root(w.customer_job_id)===j.customer_job_id && w.is_transaction_billable && w.date<=d.options.asOf);
   const actual=sum(work,w=>w.value)/100,budget=Number(j.agreed_job_amount);
   return {customer_job_id:j.customer_job_id,customer_id:j.customer_id,customer_name:d.customers.find(c=>c.customer_id===j.customer_id)?.display_name,job_description:d.jobTypes.find(t=>t.job_type_id===j.job_type_id)?.job_description,budget,actual,work_entered_value:actual,wip:sum(work.filter(w=>!w.document),w=>w.value)/100,consumed_pct:budget>0?round(actual/budget*100):null,remaining:round(budget-actual),is_complete:!!j.is_job_complete};
  }).sort((a,b)=>String(a.customer_name).localeCompare(String(b.customer_name)));
 },
 async getTaxSeasonCapacity(db,accountId,input={},prepared){
  const y=Number(input.year || billingDateToday().slice(0,4)),d=await load(db,accountId,{...input,year:y,asOf:input.asOf || `${y}-12-31`},prepared);
  const week=date=>{const dt=new Date(date+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()+4-(dt.getUTCDay()||7));return Math.ceil(((dt-new Date(Date.UTC(dt.getUTCFullYear(),0,1)))/86400000+1)/7);};
  const season=year=>groups(d.work.filter(w=>selected(d,w) && w.isTime && w.date>=`${year}-01-01` && w.date<=`${year}-04-15` && w.date<=d.options.asOf),w=>`${w.logged_for_user_id}/${week(w.date)}`).map(([key,rows])=>({user_id:rows[0].logged_for_user_id,employee:rows[0].employee,is_active:rows[0].staff_active,week:Number(key.split('/')[1]),hours:round(sum(rows,w=>w.hours))})).sort((a,b)=>a.employee.localeCompare(b.employee)||a.user_id-b.user_id||a.week-b.week);
  return {version:2,year:y,current:season(y),prior:season(y-1),basis:'Actual service hours; inactive staff retained; quantity-only records estimated'};
 },
 async getExcludableCustomers(db,accountId){
  const like=DEFAULT_EXCLUDE_NAME_PATTERNS.map(()=> 'display_name ILIKE ?').join(' OR ');
  const all=await db.raw(`SELECT customer_id,display_name,is_customer_active,(${like}) AS default_excluded FROM public.customers WHERE account_id=? ORDER BY display_name`,[...DEFAULT_EXCLUDE_NAME_PATTERNS,accountId]);
  return {customers:all.rows.filter(r=>r.is_customer_active || r.default_excluded).map(({customer_id,display_name})=>({customer_id,display_name})),defaultExcludedIds:all.rows.filter(r=>r.default_excluded).map(r=>r.customer_id)};
 }
};
module.exports=service;
