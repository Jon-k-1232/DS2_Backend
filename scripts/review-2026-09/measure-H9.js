'use strict';
// Local, read-only account-scale measurements. No app startup or cloud clients.
const fs=require('fs'),path=require('path'),{performance}=require('perf_hooks');
const root=path.resolve(__dirname,'../..'),env=require('dotenv').parse(fs.readFileSync(path.join(root,'.env.local')));
const knex=require('knex'),jwt=require('jsonwebtoken');
async function main(){
 const db=knex({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'},pool:{min:0,max:1}});
 try{
  const out={measuredAt:new Date().toISOString(),readOnly:true};
  const token=jwt.sign({user_id:21},env.JWT_SECRET,{subject:'admin@jimkimmel.com',expiresIn:'1h'}),headers={Cookie:`ds2_auth=${token}`};
  async function measure(url){const start=performance.now();const r=await fetch('http://127.0.0.1:8003'+url,{headers});const body=await r.text();const elapsedMs=performance.now()-start;if(!r.ok)throw Error(`Local measurement returned ${r.status}`);return {status:r.status,bytes:Buffer.byteLength(body),gzipBytes:require('zlib').gzipSync(body).length,elapsedMs};}
  out.login=await measure('/initialData/initialBlob/1/21');
  const clients=await db('customer_jobs').where({account_id:1}).select('customer_id').count('* as count').groupBy('customer_id').orderBy('count','desc').limit(3);
  out.jobs=[];for(const c of clients){const runs=[];for(let i=0;i<7;i++)runs.push(await measure('/jobs/getActiveCustomerJobs/1/21/'+c.customer_id+'?limit=100'));out.jobs.push({clientId:c.customer_id,historyRows:Number(c.count),runs});}
  const entity=(await db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  out.entityId=entity;out.explain={};out.businessJobs=[];
  for(const c of clients){const runs=[];for(let i=0;i<7;i++)runs.push(await measure('/jobs/getActiveCustomerJobs/1/21/'+c.customer_id+'?limit=100&entityId='+entity));out.businessJobs.push({clientId:c.customer_id,historyRows:Number(c.count),runs});}
  out.currentCycleJobs=[];for(const c of clients){const runs=[];for(let i=0;i<7;i++)runs.push(await measure('/jobs/getActiveCustomerJobs/1/21/'+c.customer_id+'?limit=100&currentCycle=true&entityId='+entity));out.currentCycleJobs.push({clientId:c.customer_id,historyRows:Number(c.count),runs});}
  async function explain(name,action,entityScope=false){
   const queries=[];const capture=q=>{if(/^select /i.test(q.sql))queries.push(q);};db.on('query',capture);try{if(entityScope)await require('../../src/endpoints/billingEntities/entity-context').run(entity,action);else await action();}finally{db.removeListener('query',capture);}
   out.explain[name]=[];
   for(const q of queries){const numbered=[];let sql=q.sql.replace(/\$(\d+)/g,(_,n)=>{numbered.push(q.bindings[Number(n)-1]);return '?';});const bindings=numbered.length?numbered:q.bindings;
    const plan=await db.transaction(async trx=>{await trx.raw("SELECT set_config('app.billing_entity_id',?,true), set_config('search_path',?,true)",[String(entity),entityScope?'billing_scope,public':'public']);return (await trx.raw('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,bindings)).rows[0]['QUERY PLAN'];});
    out.explain[name].push({sql,bindings,plan});
   }
  }
  const jobs=require('../../src/endpoints/job/job-service'),customers=require('../../src/endpoints/customer/customer-service'),retainers=require('../../src/endpoints/retainer/retainer-service');
  await explain('clientJobs',()=>jobs.getJobsPage(db,1,{customerId:clients[0].customer_id,latest:true,limit:100}));
  await explain('selectiveClientJobs',()=>jobs.getJobsPage(db,1,{customerId:clients[2].customer_id,latest:true,limit:100}));
  await explain('businessClientJobs',()=>jobs.getJobsPage(db,1,{customerId:clients[0].customer_id,latest:true,limit:100}),true);
  await explain('businessCurrentCycleJobs',()=>jobs.getJobsPage(db,1,{customerId:clients[0].customer_id,latest:true,currentCycle:true,limit:100}),true);
  await explain('businessJobsRegister',()=>jobs.getJobsPage(db,1,{latest:true,limit:20}),true);
  await explain('clientSearch',()=>customers.searchCustomers(db,1,{searchTerm:'a',limit:50}));
  await explain('businessRetainers',()=>retainers.getRetainersPage(db,1,{limit:20}),true);
  const invoices=require('../../src/endpoints/invoice/invoice-service'),payments=require('../../src/endpoints/payments/payments-service');
  out.profileHistoryClients={};
  for(const [name,table,service,method] of [['businessClientInvoices','customer_invoices',invoices,'getCustomerInvoiceByID'],['businessClientPayments','customer_payments',payments,'getActivePaymentsForCustomer'],['businessClientRetainers','customer_retainers_and_prepayments',retainers,'getCustomerRetainersByID']]){
   const largest=await db('public.'+table).where({account_id:1}).whereNotNull('customer_id').select('customer_id').count('* as count').groupBy('customer_id').orderBy('count','desc').first();
   out.profileHistoryClients[name]=largest || {customer_id:clients[0].customer_id,count:0};
   await explain(name,()=>service[method](db,1,out.profileHistoryClients[name].customer_id),true);
  }
  out.indexes=(await db.raw("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('customer_jobs','customers','customer_retainers_and_prepayments','customer_transactions','customer_invoices','customer_payments') ORDER BY tablename,indexname")).rows;
  fs.writeFileSync(path.join(root,'docs/decisions/evidence/run-H9/api-after.json'),JSON.stringify(out,null,2));
  console.log(JSON.stringify({login:out.login,jobs:out.jobs.map(c=>({...c,runs:c.runs.map(r=>r.elapsedMs)})),businessJobs:out.businessJobs.map(c=>({...c,runs:c.runs.map(r=>r.elapsedMs)})),currentCycleJobs:out.currentCycleJobs.map(c=>({...c,runs:c.runs.map(r=>r.elapsedMs)})),plans:Object.fromEntries(Object.entries(out.explain).map(([k,v])=>[k,v.map(p=>p.plan[0]['Execution Time'])]))},null,2));
 }finally{await db.destroy();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
