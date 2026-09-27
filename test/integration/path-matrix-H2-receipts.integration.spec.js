'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {randomUUID}=require('crypto');
const {today}=require('./_scenario');
describe('H2 receipt routes: atomic refusals and administrator decisions',function(){
 this.timeout(180000);let s,entity,c,job,receipt,open,body;
 const req=(method,path,data,role='sa',key=randomUUID())=>{let r=s.request[method](path);if(role)r=r.set('Authorization','Bearer '+s.token(role));if(key)r=r.set('Idempotency-Key',key);return data===undefined?r:r.send(data);};
 const load=async()=>ok(await req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${entity}`));
 const detail=async()=>ok(await req('get',`/payments/receipts/${receipt.receipt_id}`));
 const refusal=(fn,code,pattern=/.+/)=>s.refused(fn,code,code,pattern);
 before(async()=>{s=await new PathScenario().boot();entity=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;c=await s.customer('H2 Path Client');job=await s.job(c);for(const amount of [300,450,400]){await s.work(c,job,amount,{entityId:entity});await s.finalize([c],{entityId:entity,allowSameDayRebill:true});}open=await load();body={customerId:c.id,entityId:entity,amount:100,date:today(),method:'check',reference:'MATRIX',ledgerFingerprint:open.ledgerFingerprint,allocations:[{obligationId:open.obligations[0].obligation_id,amount:100}]};});
 after(async()=>{if(s)await s.close();});
 for(const [label,patch,code] of [
  ['missing client',{customerId:null},400],['missing business',{entityId:null},400],['foreign business',{entityId:2147483646},404],['foreign client',{customerId:2147483646},404],
  ['zero check',{amount:0},400],['negative check',{amount:-1},400],['fractional cent',{amount:'1.001'},400],['invalid date',{date:'2026-02-30'},400],['future date',{date:'2099-01-01'},400],
  ['invalid method',{method:'wire'},400],['missing check reference',{reference:''},400],['too much applied',{amount:99},400],['zero allocation',{allocations:[{obligationId:'1',amount:0}]},400],
  ['negative allocation',{allocations:[{obligationId:'1',amount:-1}]},400],['invalid invoice',{allocations:[{obligationId:'wrong',amount:1}]},400],['missing invoice',{allocations:[{obligationId:'2147483646',amount:1}],reason:'Move to selected invoice'},404],
  ['missing list version',{ledgerFingerprint:''},400],['stale list',{ledgerFingerprint:'old'},409],['missing allocations',{allocations:null},400],['holding debt without a reason',{allocations:[]},400]
 ])it(`rejects ${label} without writing any table`,()=>refusal(()=>req('post','/payments/receipts',{...body,...patch}),code));
 it('requires a valid retry key',()=>refusal(()=>req('post','/payments/receipts',body,'sa','invalid'),400));
 it('rejects repeated invoice lines',()=>refusal(()=>req('post','/payments/receipts',{...body,amount:200,allocations:[...body.allocations,...body.allocations]}),400));
 it('rejects an application above the invoice remaining amount',()=>refusal(()=>req('post','/payments/receipts',{...body,amount:301,allocations:[{obligationId:open.obligations[0].obligation_id,amount:301}]}),409));
 for(const [path,query] of [['open-obligations',()=>`?customerId=${c.id}&entityId=${entity}`],['receipts',()=>'' ],['receipts/2147483646',()=>'' ]]){
  it(`requires authentication for GET ${path}`,()=>refusal(()=>req('get',`/payments/${path}${query()}`,undefined,null),401));
  it(`denies employees GET ${path}`,()=>refusal(()=>req('get',`/payments/${path}${query()}`,undefined,'staff'),403));
 }
 it('denies employees receiving money',()=>refusal(()=>req('post','/payments/receipts',body,'staff'),403));
 it('returns not found for a missing receipt',()=>refusal(()=>req('get','/payments/receipts/2147483646'),404));
 it('rolls back an inserted receipt when its application write fails',()=>s.queryFault(/insert into "ar_applications"/,()=>refusal(()=>req('post','/payments/receipts',body),500)));
 it('rolls back applications and snapshots when excess credit fails',()=>s.queryFault(/insert into "client_credit_lots"/,()=>refusal(()=>req('post','/payments/receipts',{...body,amount:1500,allocations:open.obligations.map(o=>({obligationId:o.obligation_id,amount:o.openCents/100}))}),500)));
 it('records money for a manager, replays an exact retry, rejects changed retry and stale screen',async()=>{
  await s.db('users').where({user_id:3,account_id:1}).update({access_level:'Manager'});
  try{const key=randomUUID(),result=ok(await req('post','/payments/receipts',body,'staff',key));receipt=result.receipt;const before=await s.allState();expect(ok(await req('post','/payments/receipts',body,'staff',key))).to.deep.equal(result);expect(await s.allState()).to.deep.equal(before);await refusal(()=>req('post','/payments/receipts',{...body,reference:'Changed'},'staff',key),409);await refusal(()=>req('post','/payments/receipts',body,'staff'),409);}
  finally{await s.db('users').where({user_id:3,account_id:1}).update({access_level:'Employee'});}
 });
 it('detects a duplicate at receipt level with no write',async()=>{const state=await load();await refusal(()=>req('post','/payments/receipts',{...body,ledgerFingerprint:state.ledgerFingerprint}),409,/duplicate/i);});
 for(const role of ['Manager','Employee'])for(const suffix of ['applications/1/correct','exceptions','reversals','resolve'])it(`${role} cannot ${suffix}`,async()=>{
  await s.db('users').where({user_id:3,account_id:1}).update({access_level:role});try{await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/${suffix}`,{reason:'Unauthorized change'},'staff'),403);}finally{await s.db('users').where({user_id:3,account_id:1}).update({access_level:'Employee'});}
 });
 it('admin corrects one unissued application with reversal and replacement',async()=>{const d=await detail(),state=await load();ok(await req('post',`/payments/receipts/${receipt.receipt_id}/applications/${d.applications[0].application_id}/correct`,{amount:100,obligationId:state.obligations[1].obligation_id,reason:'Applied to the wrong original invoice',ledgerFingerprint:d.ledgerFingerprint},'admin'));const after=await detail();expect(after.applications).to.have.length(3);const state2=await load();ok(await req('post',`/payments/receipts/${receipt.receipt_id}/applications/${after.applications[2].application_id}/correct`,{amount:100,obligationId:state2.obligations[0].obligation_id,reason:'Correct client allocation instruction',ledgerFingerprint:after.ledgerFingerprint},'sa'));});
 it('rejects editing an application after its next statement is finalized',async()=>{await s.work(c,job,10,{entityId:entity});await s.finalize([c],{entityId:entity,allowSameDayRebill:true});const d=await detail(),app=d.applications.slice(-1)[0],state=await load();await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/applications/${app.application_id}/correct`,{amount:100,obligationId:state.obligations[0].obligation_id,reason:'Try editing issued money',ledgerFingerprint:d.ledgerFingerprint}),409,/finalized/i);});
 it('rejects every partial reversal selector, including zero or null amount',async()=>{const d=await detail();for(const selector of [{amount:1},{amount:0},{amount:null},{applicationIds:[]},{paymentIds:[]}])await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/reversals`,{reason:'Partial bounce',...selector,ledgerFingerprint:d.ledgerFingerprint}),400,/full|partial/i);});
 it('rejects reversal before flagging',async()=>{const d=await detail();await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/reversals`,{reason:'Bounced',ledgerFingerprint:d.ledgerFingerprint}),409,/flag/i);});
 it('admin flags the whole receipt',async()=>{const d=await detail();const result=ok(await req('post',`/payments/receipts/${receipt.receipt_id}/exceptions`,{condition:'bounced_check',reason:'Bank returned the check',ledgerFingerprint:d.ledgerFingerprint},'admin'));expect(result.exceptions).to.have.length.above(0);});
 it('rolls back all reversals if the last event insert fails',async()=>{const d=await detail();await s.queryFault(/insert into "receipt_events"/,()=>refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/reversals`,{reason:'Bank returned the check',ledgerFingerprint:d.ledgerFingerprint}),500));});
 it('super admin reverses every application and resolves by roll forward',async()=>{let d=await detail();ok(await req('post',`/payments/receipts/${receipt.receipt_id}/reversals`,{reason:'Bank returned the check',ledgerFingerprint:d.ledgerFingerprint}));expect((await load()).billedCents).to.equal(116000);d=await detail();ok(await req('post',`/payments/receipts/${receipt.receipt_id}/resolve`,{action:'roll_forward',reason:'Include the correction in the next statement',ledgerFingerprint:d.ledgerFingerprint}));expect((await detail()).events.some(e=>e.kind==='resolved_roll_forward')).to.equal(true);});
 it('rejects a repeated reversal with another key',async()=>{const d=await detail();await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/reversals`,{reason:'Again',ledgerFingerprint:d.ledgerFingerprint}),409,/already/i);});
 it('an acknowledged similar receipt creates one flag without counting its allocation lines as duplicates',async()=>{
  const client=await s.customer('H2 acknowledged duplicate');let state=ok(await req('get',`/payments/open-obligations?customerId=${client.id}&entityId=${entity}`));const data={customerId:client.id,entityId:entity,amount:10,date:today(),method:'check',reference:'SAME-REFERENCE',allocations:[],ledgerFingerprint:state.ledgerFingerprint};ok(await req('post','/payments/receipts',data));state=ok(await req('get',`/payments/open-obligations?customerId=${client.id}&entityId=${entity}`));const r=ok(await req('post','/payments/receipts',{...data,ledgerFingerprint:state.ledgerFingerprint,duplicateReason:'Separate checks share the printed reference'}));expect(r.duplicateFlags).to.have.length(1);expect((await s.db('ar_applications').where({account_id:1,customer_id:client.id}))).to.have.length(0);expect((await s.db('receipt_events').where({receipt_id:r.receipt.receipt_id,kind:'duplicate_acknowledged'}))).to.have.length(1);
 });
 it('storage failure preserves a complete reversal; admin retries the same request to issue a revision',async()=>{
  let state=await load();const r=ok(await req('post','/payments/receipts',{...body,amount:50,reference:'REVISION-50',allocations:[{obligationId:state.obligations[0].obligation_id,amount:50}],ledgerFingerprint:state.ledgerFingerprint})).receipt;
  await s.work(c,job,10,{entityId:entity});await s.finalize([c],{entityId:entity,allowSameDayRebill:true});
  const get=async()=>ok(await req('get',`/payments/receipts/${r.receipt_id}`));let d=await get();ok(await req('post',`/payments/receipts/${r.receipt_id}/exceptions`,{condition:'bounced_check',reason:'Return check for complete revision',ledgerFingerprint:d.ledgerFingerprint},'sa'));d=await get();ok(await req('post',`/payments/receipts/${r.receipt_id}/reversals`,{reason:'Restore original debt',ledgerFingerprint:d.ledgerFingerprint},'admin'));d=await get();const input={action:'revision',reason:'Reprint current statement correction',ledgerFingerprint:d.ledgerFingerprint},key=randomUUID();await s.fail(require('@aws-sdk/client-s3').S3Client.prototype,'send',()=>refusal(()=>req('post',`/payments/receipts/${r.receipt_id}/resolve`,input,'admin',key),500));expect((await get()).reversed).to.equal(true);ok(await req('post',`/payments/receipts/${r.receipt_id}/resolve`,input,'admin',key));expect((await get()).events.some(e=>e.kind==='resolved_revision')).to.equal(true);
 });

 it('rejects existing obligations belonging to another client or business, and a payment predating its debt',async()=>{
  const left=await s.customer('H2 Scoped Receipt'),other=await s.customer('H2 Other Client'),leftJob=await s.job(left),otherJob=await s.job(other);
  await s.work(left,leftJob,100,{entityId:entity});await s.finalize([left],{entityId:entity});
  await s.work(other,otherJob,100,{entityId:entity});await s.finalize([other],{entityId:entity});
  const business=ok(await req('post','/billing-entities',{name:'H2 receipt other business',legal_name:'H2 receipt other business',invoice_prefix:'HRO',reason:'Exercise scoped invoice applications'})).entity.billing_entity_id;
  ok(await req('post','/jobs/createJob/1/1',{entityId:business,job:s.jobBody(left,2)}));const scopedJob=await s.db('customer_jobs').where({account_id:1,customer_id:left.id,job_type_id:2}).first();
  await s.work(left,scopedJob,100,{entityId:business});await s.finalize([left],{entityId:business});
  const state=ok(await req('get',`/payments/open-obligations?customerId=${left.id}&entityId=${entity}`));
  const data={customerId:left.id,entityId:entity,amount:10,date:today(),method:'cash',reason:'Selected invoice manually',ledgerFingerprint:state.ledgerFingerprint};
  for(const [customerId,entityId] of [[other.id,entity],[left.id,business]]){
   const foreign=ok(await req('get',`/payments/open-obligations?customerId=${customerId}&entityId=${entityId}`));
   await refusal(()=>req('post','/payments/receipts',{...data,allocations:[{obligationId:foreign.obligations[0].obligation_id,amount:10}]}),404,/client and business/i);
  }
  await refusal(()=>req('post','/payments/receipts',{...data,date:require('./_scenario').ago(1),allocations:[{obligationId:state.obligations[0].obligation_id,amount:10}]}),400,/before the invoice/i);
  const r=ok(await req('post','/payments/receipts',{...data,allocations:[{obligationId:state.obligations[0].obligation_id,amount:10}]})).receipt;
  const d=ok(await req('get',`/payments/receipts/${r.receipt_id}`));
  await refusal(()=>req('post',`/payments/receipts/${r.receipt_id}/applications/${d.applications[0].application_id}/correct`,{amount:9,obligationId:state.obligations[0].obligation_id,reason:'Mistaken changed total',ledgerFingerprint:d.ledgerFingerprint}),400,/preserve its amount/i);
  await refusal(()=>req('post',`/payments/receipts/${r.receipt_id}/exceptions`,{condition:'bounced_check',reason:'Cash cannot bounce',ledgerFingerprint:d.ledgerFingerprint}),409,/check receipt/i);
 });

 it('keeps another tenant out of every receipt object and collection, without writing',async()=>{
  await s.foreignFixture();const before=await s.allState();
  expect(ok(await req('get','/payments/receipts',undefined,'foreign')).receipts).to.deep.equal([]);expect(await s.allState()).to.deep.equal(before);
  await refusal(()=>req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${entity}`,undefined,'foreign'),404);
  await refusal(()=>req('get',`/payments/receipts/${receipt.receipt_id}`,undefined,'foreign'),404);
  await refusal(()=>req('post','/payments/receipts',body,'foreign'),404);
  for(const [suffix,data]of [['applications/1/correct',{amount:1,obligationId:1}],['exceptions',{condition:'bounced_check'}],['reversals',{}],['cancellations',{}],['resolve',{action:'revision'}]]){
   await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/${suffix}`,{reason:'Foreign object must be hidden',...data},'foreign'),404);
   await refusal(()=>req('post',`/payments/receipts/${receipt.receipt_id}/${suffix}`,data,null),401);
  }
 });
 it('read validation and database failures leave receipt lists and aging unchanged',async()=>{
  for(const path of ['/payments/receipts?page=0','/payments/receipts?limit=bad',`/payments/open-obligations?customerId=${c.id}&entityId=${entity}&recordedThrough=invalid`])await refusal(()=>req('get',path),400);
  await s.queryFault(/select .*payment_receipts/i,()=>refusal(()=>req('get','/payments/receipts'),500));
  await s.queryFault(/select .*ar_obligations/i,()=>refusal(()=>req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${entity}`),500));
 });

});
