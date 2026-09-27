'use strict';
// Read-only planning followed by a hash-checked, append-only operator apply.
const fs=require('fs'),{randomUUID}=require('crypto');
const ctx=require('../src/endpoints/billingEntities/entity-context');
const {storage}=require('../src/utils/auditContext');
const {sha,lockAccount}=require('../src/endpoints/billingEntities/entities-service');
const legacy=require('../src/endpoints/payments/legacy-obligations');
const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined;
async function main(){
 const database=get('--database'),accountId=Number(get('--account')),file=get('--manifest');
 if(!['ds2_local','ds2_clean','ds2_scenarios'].includes(database) || !Number.isInteger(accountId) || accountId<1 || !file)throw Error('Require an authorized local --database, --account and --manifest.');
 const db=require('knex')({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database},pool:{min:0,max:2}});
 const plan=async trx=>{
  if(database==='ds2_local' && accountId===1 && !await trx('billing_cutover_amendments').where({account_id:accountId}).first())throw Error('Apply the corrected default legacy scope before deriving obligations.');
  const entities=await ctx.entities(trx,accountId),customers=await trx('customers').where({account_id:accountId}).orderBy('customer_id'),scopes=[];
  for(const c of customers)for(const e of entities){
   const scope={accountId,customerId:c.customer_id,entityId:e.billing_entity_id};
   const report=await ctx.run(scope.entityId,()=>legacy.plan(trx,scope));
   if(report.sources.length || report.paymentSources.length || report.retainerSources.length)scopes.push(report);
  }
  return {version:1,database,accountId,scopes};
 };
 try{await storage.run({source:'system/legacy-obligation-derivation',accountId,correlationId:randomUUID(),reason:get('--reason')},async()=>{
  if(!args.includes('--apply')){
   const manifest=await db.transaction(async trx=>{await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return plan(trx);});
   const totals={billedCents:manifest.scopes.reduce((n,s)=>n+s.billedCents,0),unresolvedCents:manifest.scopes.reduce((n,s)=>n+s.unresolvedCents,0),statementCreditCents:manifest.scopes.reduce((n,s)=>n+s.statementCreditCents,0),scopes:manifest.scopes.length};
   fs.writeFileSync(file,JSON.stringify({manifest,manifestHash:sha(JSON.stringify(manifest)),totals},null,2),{flag:'wx'});console.log(JSON.stringify(totals));
  }else{
   const reviewed=JSON.parse(fs.readFileSync(file,'utf8')),reason=get('--reason');if(!reason?.trim())throw Error('A reason is required.');
   if(reviewed.manifest.database!==database || reviewed.manifest.accountId!==accountId || sha(JSON.stringify(reviewed.manifest))!==reviewed.manifestHash)throw Error('Manifest identity or hash differs.');
   const result=await db.transaction(async trx=>{
    await lockAccount(trx,accountId,'',reason);
    const current=await plan(trx);if(sha(JSON.stringify(current))!==reviewed.manifestHash)throw Error('Source evidence changed. Re-plan and review before applying.');
    let inserted=0;
    for(const report of current.scopes){const scope={accountId,customerId:report.customerId,entityId:report.entityId};await ctx.run(scope.entityId,async()=>{
     if(!await trx('ar_derivations').where({account_id:accountId,customer_id:scope.customerId,billing_entity_id:scope.entityId}).first())inserted++;
     await legacy.ensure(trx,scope);
     const state=await require('../src/endpoints/payments/receipt-ledger').read(trx,scope);
     if(state.billedCents!==report.billedCents)throw Error(`Opening reconciliation failed for client ${scope.customerId}, business ${scope.entityId}.`);
    });}
    return {manifestHash:reviewed.manifestHash,scopes:current.scopes.length,inserted,reason,billedCents:reviewed.totals.billedCents,sourceRowsChanged:0};
   });fs.writeFileSync(file+'.applied.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
  }
 });}finally{await db.destroy();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
