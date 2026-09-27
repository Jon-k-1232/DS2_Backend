'use strict';
const fs=require('fs'),{performance}=require('perf_hooks'),assert=require('assert');
require('dotenv').config({path:'.env.local'});require('../../test/setup');require('../../src/utils/auditContext');
const original=require('../../test/helpers/h10-original'),ctx=require('../../src/endpoints/billingEntities/entity-context');
const db=require('knex')({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'},pool:{min:0,max:4}});
const base='src/endpoints/';
const canonical=x=>Array.isArray(x)?x.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):x && typeof x==='object' && !(x instanceof Date)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
async function compare(name,fn,oldFn){const start=performance.now(),actual=await fn(),elapsedMs=performance.now()-start;console.log(name+' optimized '+elapsedMs.toFixed(1)+' ms');const expected=await oldFn();try{assert.strictEqual(JSON.stringify(canonical(actual)),JSON.stringify(canonical(expected)));console.log(name+' IDENTICAL');}catch(e){fs.writeFileSync('/tmp/H10-actual.json',JSON.stringify(actual,null,2));fs.writeFileSync('/tmp/H10-expected.json',JSON.stringify(expected,null,2));throw Error(name+' differs; inspect /tmp/H10-{actual,expected}.json');}return actual;}
async function main(){
 const opts={asOf:require('../../src/endpoints/invoice/billingDate').billingDateToday(),recordedThrough:new Date().toISOString(),year:2026};
 const entities=await ctx.entities(db,1),ids=(await db('public.customers').where({account_id:1}).select('customer_id')).map(c=>c.customer_id);
 for(const entity of entities.slice(0,1))await ctx.run(entity.billing_entity_id,async()=>{
  const p='invoice/invoiceEligibility/invoiceEligibility.js';
  await compare('eligibility',()=>require('../../'+base+p).findCustomersNeedingInvoices(db,1,opts.asOf),()=>original(base+p).findCustomersNeedingInvoices(db,1,opts.asOf));
  const q='invoice/createInvoice/createInvoiceQueries.js',selection=Object.fromEntries(ids.map(customer_id=>[customer_id,{customer_id,showWriteOffs:false}]));
  await compare('engine inputs',()=>require('../../'+base+q).fetchInitialQueryItems(db,selection,1,{billingDate:opts.asOf}),()=>original(base+q).fetchInitialQueryItems(db,selection,1,{billingDate:opts.asOf}));
  const a='accountsReceivable/accounts-receivable-service.js';
  await compare('AR',()=>require('../../'+base+a).getAging(db,1,{...opts,limit:10000}),()=>original(base+a).getAging(db,1,{...opts,limit:10000}));
 });
 for(const method of ['getBillingPerformance','getClientRates','getTimeAllocation','getWipAging','getJobBudgets','getTaxSeasonCapacity']){
  const a='analytics/analytics-service.js';await compare(method,()=>require('../../'+base+a)[method](db,1,{...opts,entityId:entities[0].billing_entity_id}),()=>original(base+a)[method](db,1,{...opts,entityId:entities[0].billing_entity_id}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.destroy());
