'use strict';
const fs=require('fs'),knex=require('knex'),jwt=require('jsonwebtoken'),supertest=require('supertest'),{performance}=require('perf_hooks');
const app=require('../../src/app'),ctx=require('../../src/endpoints/billingEntities/entity-context');
const original=require('../helpers/h10-original'),{bytes,digest}=require('../helpers/h10-equivalence');
const base='src/endpoints/',evidence={budgets:{},equivalence:[]};
describe('H10 account-scale budgets and original-reader equivalence',function(){
 this.timeout(180000);let db,old,token,entities,customers,cutoff;
 before(async function(){
  if(process.env.DB_DEV_HOST!=='127.0.0.1'||Number(process.env.DB_DEV_PORT)!==5433||process.env.DATABASE_NAME!=='ds2_local')throw Error('Only local ds2_local is allowed');
  db=knex({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'},pool:{min:0,max:4}});
  const count=await db('public.customer_transactions').where({account_id:1}).count('* as n').first();
  if(Number(count.n)<39000){evidence.datasetAbsent=true;this.skip();return;}
  customers=await db('public.customers').where({account_id:1}).orderBy('customer_id');entities=await ctx.entities(db,1);
  cutoff={asOf:require('../../src/endpoints/invoice/billingDate').billingDateToday(),recordedThrough:new Date().toISOString()};
  old=app.get('db');app.set('db',db);token=jwt.sign({user_id:21},process.env.JWT_SECRET,{subject:'admin@jimkimmel.com',expiresIn:'1h'});
 });
 after(async()=>{if(old)app.set('db',old);if(db)await db.destroy();fs.mkdirSync('docs/decisions/evidence/run-H10',{recursive:true});fs.writeFileSync('docs/decisions/evidence/run-H10/budgets-equivalence.json',JSON.stringify(evidence,null,2));});
 async function equal(name,actual,expected){expect(bytes(actual),name).eq(bytes(expected));evidence.equivalence.push({name,sha256:digest(actual)});}
 it('all 338 clients in every business retain identical complete invoice calculations',async()=>{
  const modulePath=base+'invoice/createInvoice/createInvoiceQueries.js',engine=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
  const selection=Object.fromEntries(customers.map(c=>[c.customer_id,{customer_id:c.customer_id,showWriteOffs:false}]));
  for(const e of entities)await ctx.run(e.billing_entity_id,async()=>{
   const actual=await require('../../'+modulePath).fetchInitialQueryItems(db,selection,1,{billingDate:cutoff.asOf});
   const expected=await original(modulePath).fetchInitialQueryItems(db,selection,1,{billingDate:cutoff.asOf});
   await equal('pricing inputs business '+e.billing_entity_id,actual,expected);
   for(const showWriteOffs of [false,true]){
    const selected=Object.values(selection).map(c=>({...c,showWriteOffs}));
    const a=engine.calculateInvoices(selected,actual),b=engine.calculateInvoices(selected,expected);
    for(let i=0;i<a.length;i++)await equal(`invoice ${a[i].customer_id}/${e.billing_entity_id}, showWriteOffs=${showWriteOffs}`,a[i],b[i]);
   }
   const eligibility=base+'invoice/invoiceEligibility/invoiceEligibility.js';
   await equal('eligibility '+e.billing_entity_id,await require('../../'+eligibility).findCustomersNeedingInvoices(db,1,cutoff.asOf),await original(eligibility).findCustomersNeedingInvoices(db,1,cutoff.asOf));
  });
 });
 it('every view row equals the independent original SQL attribution function',async()=>{
  for(const e of [null,...entities.map(e=>e.billing_entity_id)])await ctx.run(e,()=>db.transaction(async trx=>{
   for(const [table,key] of [['customer_transactions','transaction_id'],['customer_jobs','customer_job_id']]){
    const actual=(await trx.raw('SELECT to_jsonb(r) AS row FROM ?? r WHERE account_id=1 ORDER BY ??',['billing_reads.'+table,key])).rows;
    const expected=(await trx.raw(`SELECT to_jsonb(r)||jsonb_build_object('billing_entity_id',public.ds2_effective_entity(account_id,?,??,billing_entity_id)) AS row FROM ?? r WHERE account_id=1 AND (?::integer IS NULL OR public.ds2_effective_entity(account_id,?,??,billing_entity_id)=?::integer ${table==='customer_jobs'?'OR billing_entity_id IS NULL':''}) ORDER BY ??`,[table,key,'public.'+table,e,table,key,e,key])).rows;
    expect(JSON.stringify(actual)).eq(JSON.stringify(expected));evidence.equivalence.push({name:`view ${table}/${e}`,rows:actual.length,sha256:digest(actual)});
   }
  }));
 });
 for(const scopeName of ['default','all'])it(`original AR matches exactly in ${scopeName} business scope at current and historical cutoffs`,async()=>{
  const p=base+'accountsReceivable/accounts-receivable-service.js';
  await ctx.run(scopeName==='default'?entities[0].billing_entity_id:null,async()=>{
   for(const asOf of [cutoff.asOf,'2025-12-31']){
    const options={...cutoff,asOf,limit:10000};
    const actual=await require('../../'+p).getAging(db,1,options),expected=await original(p).getAging(db,1,options);
    // AR's stable sort/pagination is part of its public contract.
    expect(JSON.stringify(actual)).eq(JSON.stringify(expected));await equal(`AR ${scopeName}/${asOf}`,actual,expected);
   }
  });
 });
 for(const method of ['getBillingPerformance','getClientRates','getTimeAllocation','getWipAging','getJobBudgets','getTaxSeasonCapacity'])it(`${method}: identical reports for each business and all businesses`,async()=>{
  const p=base+'analytics/analytics-service.js';
  for(const e of [null,...entities.map(e=>e.billing_entity_id)]){
   const options={...cutoff,year:2026,entityId:e || 'all'};
   const actual=await require('../../'+p)[method](db,1,options),expected=await original(p)[method](db,1,options);
   expect(JSON.stringify(actual)).eq(JSON.stringify(expected));await equal(method+'/'+e,actual,expected);
  }
 });
 for(const [name,path,budget] of [
  ['createInvoices','/invoices/createInvoice/AccountsWithBalance/1/21',1000],['AR','/accountsReceivable/aging/1/21',1000],['auditList','/accountAudit/customers/1/21',1500],
  ...['billingPerformance','clientRates','timeAllocation','wipAging','jobBudgets','taxSeasonCapacity'].map(n=>[n,'/analytics/'+n+'/1/21',2000])
 ])it(`${name} satisfies its ${budget} ms API budget with real account-scale data`,async()=>{
  const samples=[];for(let i=0;i<4;i++){
   const start=performance.now(),r=await supertest(app).get(path+'?entityId='+entities[0].billing_entity_id+'&year=2026').set('Authorization','Bearer '+token);
   expect(r.status).eq(200);expect(r.body.status).eq(200);if(i)samples.push(performance.now()-start);
  }
  const median=[...samples].sort((a,b)=>a-b)[1];evidence.budgets[name]={budget,samples,median};expect(median,name).at.most(budget);
 });
});
