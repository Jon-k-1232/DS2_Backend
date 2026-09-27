'use strict';
// Account 1 is READ ONLY. This does not invoke prepare, finalize, saved audit,
// email, or storage writes. The reference database is never connected.
const fs=require('fs'),path=require('path'),{performance}=require('perf_hooks'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
require('dotenv').config({path:path.join(root,'.env.local')});
process.env.NODE_ENV='test';process.env.SEND_REAL_EMAIL='false';process.env.RUN_SCHEDULED_AUTOMATIONS='false';
require('../../test/setup');
const knex=require('knex'),jwt=require('jsonwebtoken');
require('../../src/utils/auditContext');
const ctx=require('../../src/endpoints/billingEntities/entity-context');
const inv=require('../../src/endpoints/invoice/invoice-service');
const queries=require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const {calculateInvoices}=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const eligibility=require('../../src/endpoints/invoice/invoiceEligibility/invoiceEligibility');
const analytics=require('../../src/endpoints/analytics/analytics-service');
const model=require('../../src/endpoints/analytics/reporting-model');
const audit=require('../../src/endpoints/accountAudit/account-audit-service');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function main(){
 const stage=process.argv[2] || 'before';if(!['before','after'].includes(stage))throw Error('Use before or after');
 const output=path.join(root,'docs/decisions/evidence/run-H10',stage+'.json');
 if(stage==='before' && fs.existsSync(output))throw Error('Baseline already recorded; do not overwrite it');
 const db=knex({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'},pool:{min:0,max:4}});
 const out={measuredAt:new Date().toISOString(),stage,readOnly:true,phases:{},http:{},protected:{}};
 const save=()=>fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
 const token=jwt.sign({user_id:21},process.env.JWT_SECRET,{subject:'admin@jimkimmel.com',expiresIn:'4h'});
 let active=null;
 function wrap(object,key){const original=object[key];object[key]=async function(...args){const phase=active,start=performance.now();try{return await original.apply(this,args);}finally{if(phase){const entry=phase.functions[key] ||= {calls:0,ms:0};entry.calls++;entry.ms+=performance.now()-start;}}};}
 Object.keys(inv).filter(k=>/^get/.test(k)).forEach(k=>wrap(inv,k));
 for(const [object,keys] of [[require('../../src/endpoints/payments/receipt-ledger'),['creditLots','read']],[require('../../src/endpoints/corrections/corrections-service'),['statementItems']],[model,['load']]])for(const k of keys)wrap(object,k);
 async function phase(name,fn){
  const times=new Map(),groups=new Map();active={functions:{}};const phase=active;
  const begin=q=>times.set(q.__knexQueryUid,performance.now());
  const end=(_r,q)=>{const ms=performance.now()-(times.get(q.__knexQueryUid) || performance.now());const key=q.sql.replace(/\$\d+/g,'?').replace(/\s+/g,' ');const g=groups.get(key)||{sql:q.sql,bindings:q.bindings,count:0,ms:0};g.count++;g.ms+=ms;groups.set(key,g);};
  db.on('query',begin);db.on('query-response',end);const start=performance.now();
  try{const data=await fn();Object.assign(phase,{elapsedMs:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(data)),sha256:hash(data),queries:[...groups.values()].sort((a,b)=>b.ms-a.ms)});phase.queryCount=phase.queries.reduce((n,q)=>n+q.count,0);out.phases[name]=phase;save();console.log(name+': '+phase.elapsedMs.toFixed(1)+' ms, '+phase.queryCount+' queries');return data;}
  finally{db.removeListener('query',begin);db.removeListener('query-response',end);active=null;}
 }
 async function http(name,url){const samples=[];for(let i=0;i<3;i++){const start=performance.now(),r=await fetch('http://127.0.0.1:8003'+url,{headers:{Cookie:`ds2_auth=${token}`}}),body=Buffer.from(await r.arrayBuffer());if(!r.ok)throw Error(name+' returned '+r.status);samples.push({elapsedMs:performance.now()-start,bytes:body.length});}out.http[name]={url,samples,medianMs:samples.map(s=>s.elapsedMs).sort((a,b)=>a-b)[1]};save();console.log('HTTP '+name+': '+out.http[name].medianMs.toFixed(1)+' ms');}
 try{
  const entities=await ctx.entities(db,1),entity=entities.find(e=>e.is_default).billing_entity_id;
  const customers=await db('public.customers').where({account_id:1}).orderBy('customer_id');
  out.entityIds=entities.map(e=>e.billing_entity_id);out.clients=customers.length;out.defaultEntity=entity;
  out.cutoffs={asOf:require('../../src/endpoints/invoice/billingDate').billingDateToday(),recordedThrough:new Date().toISOString()};
  for(const [table,key] of [['customers','customer_id'],['customer_transactions','transaction_id'],['customer_payments','payment_id'],['customer_writeoffs','writeoff_id'],['customer_invoices','customer_invoice_id'],['timesheet_entries','timesheet_entry_id'],['users','user_id'],['audit_events','event_id']])out.protected[table]=(await db.raw('SELECT count(*)::int AS count,md5(string_agg(to_jsonb(t)::text,\'\' ORDER BY ??)) AS digest FROM ?? t WHERE account_id=1',[key,'public.'+table])).rows[0];save();
  await phase('recurringDuePreview',()=>require('../../src/endpoints/recurringCustomer/recurring-billing').due(db,{accountId:1,query:{entityId:entity}}));
  await ctx.run(entity,async()=>{
   const eligible=await phase('invoiceEligibility',()=>eligibility.findCustomersNeedingInvoices(db,1,out.cutoffs.asOf));
   out.eligibleClients=eligible.length;
   const selection=Object.fromEntries(eligible.map(c=>[c.customer_id,{customer_id:c.customer_id,showWriteOffs:false}]));
   const data=await phase('invoiceInputs',()=>queries.fetchInitialQueryItems(db,selection,1,{billingDate:out.cutoffs.asOf}));
   await phase('invoiceCalculation',async()=>calculateInvoices(Object.values(selection),data));
   await phase('previewSnapshot',()=>require('../../src/endpoints/invoice/createInvoice/billingSnapshot').readBillingSnapshot(db,{accountID:1,invoicesToCreateMap:selection,billingDate:out.cutoffs.asOf}));
   await phase('auditList',()=>audit.getAuditableCustomers(db,1));
   // Read/compute the same accounting phase as a batch audit, without saving,
   // generating a model narrative or writing a PDF.
   await phase('auditRunAllClients',async()=>{const rows=[];for(const c of customers){const [invoices,payments,writeoffs,transactions,retainers,retainerEvents,corrections]=await Promise.all([audit.getInvoices(db,1,c.customer_id),audit.getPayments(db,1,c.customer_id),audit.getWriteoffs(db,1,c.customer_id),audit.getTransactions(db,1,c.customer_id),audit.getRetainers(db,1,c.customer_id),audit.getRetainerEvents(db,1,c.customer_id),audit.getCorrections(db,1,c.customer_id)]);rows.push(require('../../src/endpoints/accountAudit/account-audit-logic').auditCustomerLedger({customer:c,invoices,payments,writeoffs,transactions,retainers,retainerEvents,corrections}));}return rows;});
   await phase('arAging',()=>require('../../src/endpoints/accountsReceivable/accounts-receivable-service').getAging(db,1,{...out.cutoffs,limit:10000}));
  });
  const opts={year:2026,entityId:entity,...out.cutoffs};
  for(const method of ['getBillingPerformance','getClientRates','getTimeAllocation','getWipAging','getJobBudgets','getTaxSeasonCapacity'])await phase(method,()=>analytics[method](db,1,opts));
  const q='?entityId='+entity;
  for(const [name,url] of [['createInvoices','/invoices/createInvoice/AccountsWithBalance/1/21'+q],['recurringDue','/recurringCustomer/due'+q],['ar','/accountsReceivable/aging/1/21'+q],['auditList','/accountAudit/customers/1/21'+q],['customerProfile','/customer/activeCustomers/customerByID/1/21/6'+q],...['billingPerformance','clientRates','timeAllocation','wipAging','jobBudgets','taxSeasonCapacity','yearEndPacket'].map(n=>[n,'/analytics/'+n+'/1/21'+q+'&year=2026'])])await http(name,url);
 }finally{save();await db.destroy();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
