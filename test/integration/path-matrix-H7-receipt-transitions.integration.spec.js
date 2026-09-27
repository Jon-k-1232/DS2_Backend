'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {today,ago}=require('./_scenario');
const {randomUUID}=require('crypto');

describe('H7 receipt state-machine branches and competing operator mistakes',function(){
 this.timeout(180000);let s,e,c,j,receipt,app,open;
 const req=(m,p,b,key=randomUUID())=>{const r=s.request[m](p).set('Authorization','Bearer '+s.token()).set('Idempotency-Key',key);return b===undefined?r:r.send(b);};
 const state=()=>req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${e}`).then(ok);
 const detail=()=>req('get',`/payments/receipts/${receipt.receipt_id}`).then(ok);
 const refuse=(action,code,pattern=/./)=>s.refused(action,code,code,pattern);
 const correction=async()=>({amount:10,obligationId:open.obligations[1].obligation_id,reason:'Correct operator selection',ledgerFingerprint:(await detail()).ledgerFingerprint});
 before(async()=>{
  s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;c=await s.customer('H7 receipt transitions');j=await s.job(c);
  for(const n of [100,100,5]){await s.work(c,j,n,{entityId:e});await s.finalize([c],{entityId:e,allowSameDayRebill:true});}open=await state();
  const posted=ok(await req('post','/payments/receipts',{customerId:c.id,entityId:e,amount:10,date:today(),method:'check',reference:'H7-MATRIX-CHECK',ledgerFingerprint:open.ledgerFingerprint,allocations:[{obligationId:open.obligations[0].obligation_id,amount:10}]}));receipt=posted.receipt;app=posted.applications[0];
 });
 after(async()=>{if(s)await s.close();});
 for(const [name,patch,code,pattern] of [
  ['unknown application',{},404,/not found/],
  ['same obligation',()=>({obligationId:open.obligations[0].obligation_id}),400,/different invoice/],
  ['missing target',{obligationId:2147483646},404,/not found/],
  ['insufficient target',()=>({obligationId:open.obligations[2].obligation_id}),409,/insufficient/],
  ['before target',{date:ago(1)},400,/predates/]
 ])it(`application correction refuses ${name} without any write`,async()=>{
  const body={...await correction(),...(typeof patch==='function'?patch():patch)};
  await refuse(()=>req('post',`/payments/receipts/${receipt.receipt_id}/applications/${name==='unknown application'?2147483646:app.application_id}/correct`,body),code,pattern);
 });
 it('correction database failure after the reversal rolls back both money and retry reservation',async()=>{
  const body=await correction(),key=randomUUID();await s.queryFault(/insert into "ar_applications"/,()=>refuse(()=>req('post',`/payments/receipts/${receipt.receipt_id}/applications/${app.application_id}/correct`,body,key),500),{after:1});
  const r=ok(await req('post',`/payments/receipts/${receipt.receipt_id}/applications/${app.application_id}/correct`,body,key));expect(r.reversed.reversal_of).to.equal(app.application_id);
  await refuse(async()=>req('post',`/payments/receipts/${receipt.receipt_id}/applications/${app.application_id}/correct`,await correction()),409,/already corrected/);
 });
 it('resolve before reversal, invalid condition/action and early reversal dates refuse',async()=>{
  for(const [suffix,extra,code,pattern]of [['resolve',{action:'revision'},409,/awaiting/],['resolve',{action:'cancel'},400,/Choose/],['exceptions',{condition:'refund'},400,/condition/],['reversals',{date:ago(1)},400,/precede/]]){
   const body={reason:'Review mistake',ledgerFingerprint:(await detail()).ledgerFingerprint,...extra};await refuse(()=>req('post',`/payments/receipts/${receipt.receipt_id}/${suffix}`,body),code,pattern);
  }
 });
 it('late flag database failure saves neither exceptions nor audit; retry flags exactly once',async()=>{
  const body={reason:'Bank returned this check',condition:'bounced_check',ledgerFingerprint:(await detail()).ledgerFingerprint},key=randomUUID();
  await s.queryFault(/insert into "receipt_events"/,()=>refuse(()=>req('post',`/payments/receipts/${receipt.receipt_id}/exceptions`,body,key),500));
  ok(await req('post',`/payments/receipts/${receipt.receipt_id}/exceptions`,body,key));
  await refuse(async()=>req('post',`/payments/receipts/${receipt.receipt_id}/exceptions`,{...body,ledgerFingerprint:(await detail()).ledgerFingerprint}),409,/already has/);
  await refuse(async()=>req('post',`/payments/receipts/${receipt.receipt_id}/cancellations`,{reason:'Cannot disguise bounced check as entry error',ledgerFingerprint:(await detail()).ledgerFingerprint}),409,/exception/);
 });
 it('late resolution failure leaves reversal complete, retryable and cannot resolve twice',async()=>{
  ok(await req('post',`/payments/receipts/${receipt.receipt_id}/reversals`,{reason:'Restore the returned check',ledgerFingerprint:(await detail()).ledgerFingerprint}));
  const body={action:'roll_forward',reason:'Next statement carries the debt',ledgerFingerprint:(await detail()).ledgerFingerprint},key=randomUUID();
  await s.queryFault(/insert into "receipt_events"/,()=>refuse(()=>req('post',`/payments/receipts/${receipt.receipt_id}/resolve`,body,key),500));
  expect((await detail()).reversed).to.equal(true);ok(await req('post',`/payments/receipts/${receipt.receipt_id}/resolve`,body,key));
  await refuse(async()=>req('post',`/payments/receipts/${receipt.receipt_id}/resolve`,{...body,ledgerFingerprint:(await detail()).ledgerFingerprint}),409,/awaiting/);
 });
 it('simultaneous identical retry keys save one receipt and return the same committed result',async()=>{
  const st=await state(),key=randomUUID(),body={customerId:c.id,entityId:e,amount:10,date:today(),method:'cash',ledgerFingerprint:st.ledgerFingerprint,allocations:[{obligationId:st.obligations[0].obligation_id,amount:10}]};
  const before=await s.db('payment_receipts').where({customer_id:c.id}).count({n:'*'}).first();const results=await Promise.all([req('post','/payments/receipts',body,key),req('post','/payments/receipts',body,key)]);expect(ok(results[0])).to.deep.equal(ok(results[1]));expect(Number((await s.db('payment_receipts').where({customer_id:c.id}).count({n:'*'}).first()).n)).to.equal(Number(before.n)+1);expect((await state()).billedCents).to.equal(19500);
 });
 it('two operators with different keys and one stale balance cannot both spend the same debt',async()=>{
  const st=await state(),body={customerId:c.id,entityId:e,amount:10,date:today(),method:'cash',ledgerFingerprint:st.ledgerFingerprint,allocations:[{obligationId:st.obligations[0].obligation_id,amount:10}]};
  const before=Number((await s.db('financial_requests').count({n:'*'}).first()).n);const results=await Promise.all([req('post','/payments/receipts',body),req('post','/payments/receipts',body)]);expect(results.map(r=>r.status).sort()).to.deep.equal([200,409]);expect(Number((await s.db('financial_requests').count({n:'*'}).first()).n)).to.equal(before+1);expect((await state()).billedCents).to.equal(18500);
  await refuse(()=>req('post','/payments/receipts',body),409,/Refresh/);
 });
});
