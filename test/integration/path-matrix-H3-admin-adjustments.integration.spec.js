'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix'),{today}=require('./_scenario');
describe('H3 owner addendum: every admin acts alone',function(){
 this.timeout(180000);let s,e;
 const req=(method,path,body,role='admin')=>{let r=s.request[method](path).set('Authorization','Bearer '+s.token(role));return body===undefined?r:r.send(body);};
 before(async()=>{s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;});after(async()=>{if(s)await s.close();});
 for(const role of ['admin','SUPER ADMIN']){
  it(`${role} creates, edits and deletes a write-off`,async()=>{
   await s.db('users').where({user_id:2}).update({access_level:role});const c=await s.customer('H3 writeoff '+role),j=await s.job(c);await s.work(c,j,100,{entityId:e});const data=s.credit(c,10,{entityId:e,selectedJobID:j.customer_job_id});
   ok(await req('post','/writeOffs/createWriteOffs/1/2',{writeOff:data}));const w=await s.db('customer_writeoffs').where({customer_id:c.id}).first();
   ok(await req('put','/writeOffs/updateWriteOffs/1/2',{writeOff:{...data,writeOffID:w.writeoff_id,writeoffID:w.writeoff_id,unitCost:9}}));
   ok(await req('delete','/writeOffs/deleteWriteOffs/1/2',{writeOff:{writeoffID:w.writeoff_id,customerID:c.id,reason:'Remove incorrect write-off'}}));expect(await s.db('customer_writeoffs').where({writeoff_id:w.writeoff_id})).to.have.length(0);
  });
  for(const kind of ['refund','adjustment'])it(`${role} posts a retainer ${kind}`,async()=>{
   await s.db('users').where({user_id:2}).update({access_level:role});const c=await s.customer(`H3 ${role} ${kind}`),r=await s.retainer(c,50,{entityId:e});const result=ok(await req('post',`/retainers/${r.retainer_id}/events/1/2`,{kind,amount:10,direction:'decrease',date:today(),method:'check',reference:'REF',reason:'Authorized '+kind}));expect(result.event.actor_id).to.equal(2);expect(result.available).to.equal(40);
  });
  it(`${role} removes a duplicate monetary record while preserving evidence`,async()=>{
   await s.db('users').where({user_id:2}).update({access_level:role});const c=await s.customer('H3 duplicate '+role),j=await s.job(c);const a=await s.work(c,j,20,{entityId:e,detailedJobDescription:'First charge'}),b=await s.work(c,j,20,{entityId:e,detailedJobDescription:'Accidental copied charge'});
   const f=ok(await req('post','/duplicates/1/2',{kind:'transaction',recordId:b.transaction_id,canonicalId:a.transaction_id,reason:'Same charge entered twice'})).duplicate;
   ok(await req('post',`/duplicates/${f.duplicate_id}/resolve/1/2`,{action:'remove',reason:'Remove reviewed duplicate charge'}));expect(await s.db('customer_transactions').where({transaction_id:b.transaction_id})).to.have.length(0);expect(await s.db('duplicate_history').where({duplicate_id:f.duplicate_id,action:'remove'})).to.have.length(1);
  });
  for(const action of ['revision','roll_forward'])it(`${role} flags, reverses and resolves a bounced check via ${action}`,async()=>{
   await s.db('users').where({user_id:2}).update({access_level:role});const c=await s.customer(`H3 bounce ${role} ${action}`),j=await s.job(c);await s.work(c,j,100,{entityId:e});let issued=await s.finalize([c],{entityId:e});const first=issued.committedInvoices[0];const payment=(await s.pay(c,20,{entityId:e,selectedInvoiceID:first.customer_invoice_id})).row;issued=await s.finalize([c],{entityId:e,allowSameDayRebill:true});const i=issued.committedInvoices[0],root=`/invoices/${i.customer_invoice_id}`;
   const ex=ok(await req('post',root+'/exceptions/1/2',{condition:'bounced_check',reason:'Returned check',paymentIds:[payment.payment_id]}));
   const eid=ex.exception?.exception_id || ex.exception_id;
   ok(await req('post',`${root}/exceptions/${eid}/reverse/1/2`,{}));const result=ok(await req('post',`${root}/exceptions/${eid}/resolve/1/2`,{action}));expect(result.state || result.exception?.state).to.equal(`resolved_${action}`);await s.check(c,{n:100,b:100,r:0});
  });
 }
 it('manager may flag and dismiss a duplicate without removing its money',async()=>{
  await s.db('users').where({user_id:2}).update({access_level:'manager'});const c=await s.customer('H3 manager duplicate read'),j=await s.job(c),row=await s.work(c,j,10,{entityId:e});const f=ok(await req('post','/duplicates/1/2',{kind:'transaction',recordId:row.transaction_id,reason:'Ask for duplicate review'})).duplicate;
  await s.refused(()=>req('post',`/duplicates/${f.duplicate_id}/resolve/1/2`,{action:'remove',reason:'Unauthorized removal'}),403,403,/Unauthorized/);ok(await req('post',`/duplicates/${f.duplicate_id}/resolve/1/2`,{action:'dismiss',reason:'Reviewed, valid work'}));expect(await s.db('customer_transactions').where({transaction_id:row.transaction_id})).to.have.length(1);
 });
});
