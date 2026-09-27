'use strict';
// Supplementary profile calculation timings. The old reader runs against the
// restored original scoped views; source/audit data stays database-read-only.
const fs=require('fs'),{performance}=require('perf_hooks');
require('dotenv').config({path:'.env.local'});require('../../test/setup');
const ctx=require('../../src/endpoints/billingEntities/entity-context'),original=require('../../test/helpers/h10-original');
const Client=require('knex/lib/dialects/postgres'),query=Client.prototype.query;let prior=false;
Client.prototype.query=function(connection,input){
 if(prior){
  const sql=typeof input==='string'?input:input.sql;
  // Only qualify the two affected read views. The original nonlocking views
  // restored by049 have the exact pre-H10 definitions. No schema mutation.
  const qualified=sql.replace(/\b(from|join) "(customer_transactions|customer_jobs)"(\s+as\s+"[^"]+")?/gi,(_all,verb,table,alias)=>`${verb} "billing_scope"."${table}"${alias || ` AS "${table}"`}`);
  input=typeof input==='string'?qualified:{...input,sql:qualified};
 }
 return query.call(this,connection,input);
};
const db=require('knex')({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'},pool:{min:0,max:4}});
async function main(){
 const out={readOnly:true,client:6,method:'Supplemental replay of frozen original readers with original SQL views vs optimized readers; unchanged source data; no profile POST, upload or write.',before:{},after:{}};
 const date=require('../../src/endpoints/invoice/billingDate').billingDateToday(),entities=await ctx.entities(db,1),selection={6:{customer_id:6,showWriteOffs:false}};
 const engine=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
 const values={},cutoff={asOf:date,recordedThrough:new Date().toISOString()};
 const customers=await db('public.customers').where({account_id:1}).orderBy('customer_id');
 for(const stage of ['before','after']){
  prior=stage==='before';values[stage]={};
  for(const name of ['allBusinessBalances','singleBusinessCalculation']){
   const samples=[];let count=0,result;
   const listener=()=>count++;
   for(let i=0;i<4;i++){
    count=0;db.on('query',listener);const start=performance.now();
    if(name==='allBusinessBalances')result=await require('../../src/endpoints/billingEntities/balances').list(db,1,6);
    else result=await ctx.run(entities[0].billing_entity_id,async()=>{
     const p='src/endpoints/invoice/createInvoice/createInvoiceQueries.js';
     const data=await (prior?original(p):require('../../'+p)).fetchInitialQueryItems(db,selection,1,{billingDate:date});
     return engine.calculateInvoices(Object.values(selection),data);
    });
    const ms=performance.now()-start;db.removeListener('query',listener);if(i)samples.push(ms);
   }
   out[stage][name]={samples,medianMs:[...samples].sort((a,b)=>a-b)[1],queries:count};values[stage][name]=result;
  }
  // Same read-only phase as runAuditBatch: customer/raw independent ledger,
  // engine cross-check in a savepoint, and receivables section. Do not invoke
  // the write/narrative/PDF portions of the audit job on protected account1.
  const audit=require('../../src/endpoints/accountAudit/account-audit-service');
  const auditLogic=require('../../src/endpoints/accountAudit/account-audit-logic');
  const p='src/endpoints/invoice/createInvoice/createInvoiceQueries.js';
  const invoiceReader=prior?original(p):require('../../'+p);
  let count=0;const listener=()=>count++;db.on('query',listener);const start=performance.now(),rows=[];
  await ctx.run(entities[0].billing_entity_id,async()=>{
   for(const c of customers)rows.push(await db.transaction(async trx=>{
    await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const customer=await audit.getCustomer(trx,1,c.customer_id);
    const [invoices,payments,writeoffs,transactions,retainers,retainerEvents]=await Promise.all(['getInvoices','getPayments','getWriteoffs','getTransactions','getRetainers','getRetainerEvents'].map(method=>audit[method](trx,1,c.customer_id)));
    const corrections=await audit.getCorrections(trx,1,c.customer_id);
    const result=auditLogic.auditCustomerLedger({customer,invoices,payments,writeoffs,transactions,retainers,retainerEvents,corrections});
    const selected={[c.customer_id]:{customer_id:c.customer_id,showWriteOffs:false}};
    const app=await trx.transaction(async sp=>engine.calculateInvoices(Object.values(selected),await invoiceReader.fetchInitialQueryItems(sp,selected,1)));
    const receivables=await require('../../src/endpoints/payments/receivables-report').read(trx,1,c.customer_id,cutoff);
    const {generated_at,...stableAudit}=result; // execution timestamp is not ledger evidence
    return {result:stableAudit,app,receivables};
   }));
  });
  const elapsedMs=performance.now()-start;db.removeListener('query',listener);
  out[stage].auditRunReadPhase={elapsedMs,queries:count,clients:rows.length};values[stage].auditRunReadPhase=rows;
  console.log(stage+' complete Audit read phase: '+elapsedMs.toFixed(1)+' ms / '+count+' queries');
 }
 out.equalityNote='Complete calculation data compared; only the Audit execution timestamp generated_at is excluded.';
 out.equal=require('../../test/helpers/h10-equivalence').bytes(values.before)===require('../../test/helpers/h10-equivalence').bytes(values.after);
 if(!out.equal)throw Error('Profile balance replay differs');
 fs.writeFileSync('docs/decisions/evidence/run-H10/profile-balances.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.destroy());
