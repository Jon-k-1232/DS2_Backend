'use strict';
// Same planner/posting service as the admin API; no private data-repair shortcut.
// Local targets only in this checkout. A production operator reviews this policy
// before running the coordinated rollout; this program never connects remotely.
const fs=require('fs');
const {randomUUID}=require('crypto');
const svc=require('../src/endpoints/billingEntities/cutover-amendment');
const {storage}=require('../src/utils/auditContext');
const args=process.argv.slice(2),get=n=>args[args.indexOf(n)+1];
async function main(){
 const database=get('--database'),accountId=Number(get('--account')),file=get('--manifest');
 if(!['ds2_local','ds2_clean','ds2_scenarios'].includes(database) || !Number.isInteger(accountId) || accountId<1 || !file)throw Error('Require --database <authorized local sandbox> --account <id> --manifest <path>.');
 const db=require('knex')({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database},pool:{min:0,max:2}});
 try{await storage.run({source:'system/cutover-amendment',accountId,correlationId:randomUUID(),reason:get('--reason')},async()=>{
  if(args.includes('--apply')){
   const plan=JSON.parse(fs.readFileSync(file,'utf8'));
   if(plan.database!==database || plan.manifest.accountId!==accountId)throw Error('Manifest database/account does not match.');
   const response=await svc.apply(db,{accountId,body:{manifestHash:plan.manifestHash,reason:get('--reason')},key:plan.requestKey});
   fs.writeFileSync(file+'.applied.json',JSON.stringify(response,null,2),{flag:'wx'});console.log(JSON.stringify(response));
  }else{
   const plan=await svc.plan(db,accountId);
   fs.writeFileSync(file,JSON.stringify({database,requestKey:randomUUID(),...plan,candidates:await svc.candidates(db,accountId)},null,2),{flag:'wx'});
   console.log(JSON.stringify({manifest:file,hash:plan.manifestHash,rows:plan.manifest.rows.length,guards:plan.manifest.guards,applied:plan.applied}));
  }
 });}finally{await db.destroy();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
