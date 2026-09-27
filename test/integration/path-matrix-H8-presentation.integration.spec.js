'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {today}=require('./_scenario');
const {randomUUID}=require('crypto');
describe('H8 human-readable financial history',function(){
 this.timeout(180000);let s,c,j,e,i,m,r,retainer,duplicate;
 const req=(method,path,body,role='admin')=>{const q=s.request[method](path).set('Authorization','Bearer '+s.token(role)).set('Idempotency-Key',randomUUID());return body===undefined?q:q.send(body);};
 before(async()=>{
  s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  c=await s.customer('H8 named history');j=await s.job(c);await s.work(c,j,100,{entityId:e});await s.finalize([c],{entityId:e});i=await s.db('customer_invoices').where({customer_id:c.id}).whereNull('parent_invoice_id').first();
  retainer=await s.retainer(c,25,{entityId:e});
  ok(await req('post',`/retainers/${retainer.retainer_id}/events/1/2`,{kind:'adjustment',direction:'increase',amount:5,date:today(),reason:'Opening credit review'}));
  const work=await s.db('customer_transactions').where({account_id:1,customer_id:c.id}).first();
  duplicate=ok(await req('post','/duplicates/1/2',{kind:'transaction',recordId:work.transaction_id,reason:'Review duplicate work'})).duplicate;
  const context=ok(await req('get',`/invoices/${i.customer_invoice_id}/corrections`));
  m=ok(await req('post',`/invoices/${i.customer_invoice_id}/credit-memos`,{entityId:e,amount:10,date:today(),reason:'Correct an overcharge',ledgerFingerprint:context.ledgerFingerprint})).memo;
  let state=ok(await req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${e}`));
  r=ok(await req('post','/payments/receipts',{customerId:c.id,entityId:e,amount:110,date:today(),method:'cash',allocations:[{obligationId:state.obligations[0].obligation_id,amount:90}],ledgerFingerprint:state.ledgerFingerprint}));
  state=ok(await req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${e}`));
  ok(await req('post',`/credits/${r.credit.credit_id}/refunds`,{entityId:e,amount:5,date:today(),method:'cash',reason:'Return unused money',ledgerFingerprint:state.ledgerFingerprint}));
 });
 after(async()=>{if(s)await s.close();});
 it('memo and refund lists/details and invoice memo history return the same-account actor name without changing evidence',async()=>{
  const expected=(await s.db('users').where({user_id:2,account_id:1}).first()).display_name;
  const before=await s.allState();
  for(const path of ['/credit-memos','/refunds']){
   const list=ok(await req('get',path));expect(list.records).to.have.length(1);expect(list.records[0].actor_name).to.equal(expected);
   const id=list.records[0].memo_id || list.records[0].refund_id;expect(ok(await req('get',`${path}/${id}`)).record.actor_name).to.equal(expected);
  }
  expect(ok(await req('get',`/invoices/${i.customer_invoice_id}/corrections`)).memos[0].actor_name).to.equal(expected);
  expect(await s.allState()).to.deep.equal(before);
 });
 it('invoice history resolves staff names without an active-user filter',async()=>{
  const user=await s.db('users').where({user_id:1,account_id:1}).first();await s.db('users').where({user_id:1,account_id:1}).update({is_user_active:false});
  try{const before=await s.allState(),h=ok(await req('get',`/invoices/${i.customer_invoice_id}/history/1/2`));expect(h.events.length).to.be.greaterThan(0);expect(h.events.filter(e=>e.actor_id===1).every(e=>e.actor_name===user.display_name)).to.equal(true);expect(h.events.some(e=>e.actor_id===1)).to.equal(true);expect(await s.allState()).to.deep.equal(before);}finally{await s.db('users').where({user_id:1,account_id:1}).update({is_user_active:user.is_user_active});}
 });
 it('retainer and duplicate history return names, while unknown and foreign actors stay unnamed',async()=>{
  await s.foreignFixture();const before=await s.allState();
  const h=ok(await req('get',`/retainers/${retainer.retainer_id}/events/1/2`));expect(h.events[0].actor_name).to.equal('Ada Admin');
  const d=ok(await req('get','/duplicates/1/2')).duplicates.find(x=>x.duplicate_id===duplicate.duplicate_id);expect(d.customer_name).to.equal('H8 named history');expect(d.history[0].actor_name).to.equal('Ada Admin');
  const names=await require('../../src/utils/actorNames')(s.db,1,[{actor_id:70001},{actor_id:null},{actor_id:999999}]);expect(names.map(x=>x.actor_name)).to.deep.equal(['Name not recorded','System','Name not recorded']);expect(await s.allState()).to.deep.equal(before);
 });
 it('catalog and retainer detail readers include names for deletion reviews',async()=>{
  const before=await s.allState();
  for(const [table,key,base,container,field,id] of [
   ['customer_job_categories','customer_job_category_id','/jobCategories/getSingleJobCategory','activeJobCategoriesData','activeJobCategory',null],
   ['customer_job_types','job_type_id','/jobTypes/getSingleJobType','activeJobData','activeJobs',null],
   ['customer_jobs','customer_job_id','/jobs/getSingleJob','activeJobData','activeJobs',j.customer_job_id],
   ['customer_general_work_descriptions','general_work_description_id','/workDescriptions/getSingleWorkDescription','activeWorkDescriptionData','workDescriptionData',null],
   ['customer_retainers_and_prepayments','retainer_id','/retainers/getSingleRetainer','activeRetainerData','activeRetainer',retainer.retainer_id]
  ]){
   let q=s.db(table).where({account_id:1});if(id)q=q.where(key,id);const row=await q.first();
   const name=(await s.db('users').where({account_id:1,user_id:row.created_by_user_id}).first()).display_name;
   expect(ok(await req('get',`${base}/${row[key]}/1/2`))[container][field][0].created_by_user_name).to.equal(name);
  }expect(await s.allState()).to.deep.equal(before);
 });
 it('quotes name their same-account client and job without changing records',async()=>{
  ok(await req('post','/quotes/createQuote',{entityId:e,quote:{account_id:1,customer_id:c.id,customer_job_id:j.customer_job_id,amount_quoted:125,is_quote_active:true,notes:'H8 quote'}}));
  const before=await s.allState(),q=ok(await req('get','/quotes/getActiveQuotes/1/2')).activeQuoteData.activeQuotes.find(x=>x.customer_id===c.id);
  expect(q.display_name).to.equal('H8 named history');expect(q.job_description).to.be.a('string').and.not.equal('');expect(q.created_by_user_name).to.equal('Ada Admin');expect(await s.allState()).to.deep.equal(before);
 });
 it('receipt applications name their original invoice instead of exposing debt IDs',async()=>{
  const before=await s.allState(),detail=ok(await req('get',`/payments/receipts/${r.receipt.receipt_id}`));expect(detail.applications).to.have.length(1);expect(detail.applications[0].invoice_number).to.equal(i.invoice_number);expect(await s.allState()).to.deep.equal(before);
 });
 it('every changed name reader and receipt invoice lookup fails without writing when its presentation query fails',async()=>{
  const refund=await s.db('client_refunds').where({account_id:1,customer_id:c.id}).first();
  const reads=[
   [`/invoices/${i.customer_invoice_id}/corrections`,500],['/credit-memos',500],[`/credit-memos/${m.memo_id}`,500],['/refunds',500],[`/refunds/${refund.refund_id}`,500],
   [`/invoices/${i.customer_invoice_id}/history/1/2`,500],[`/retainers/${retainer.retainer_id}/events/1/2`,500],['/duplicates/1/2',500],
   ['/jobCategories/getSingleJobCategory/1/1/2',500,null],['/jobTypes/getSingleJobType/1/1/2',500,null],[`/jobs/getSingleJob/${j.customer_job_id}/1/2`,500,null],
   [`/retainers/getSingleRetainer/${retainer.retainer_id}/1/2`,200],['/workDescriptions/getSingleWorkDescription/1/1/2',200],['/quotes/getActiveQuotes/1/2',200]
  ];
  for(const [path,http,envelope=500] of reads)await s.queryFault(/select "user_id", "display_name" from "public"\."users"/,()=>s.refused(()=>req('get',path),http,envelope===null?undefined:envelope,/.+/));
  await s.queryFault(/left join "public"\."customer_invoices" as "i"/,()=>s.refused(()=>req('get',`/payments/receipts/${r.receipt.receipt_id}`),500,500,/.+/));
 });
 it('actor-name lookup failure is a safe read failure and foreign tenants receive no names or documents',async()=>{
  await s.queryFault(/select "user_id", "display_name" from "public"\."users"/,()=>s.refused(()=>req('get','/credit-memos'),500,500,/.+/));
  const before=await s.allState();expect(ok(await req('get','/credit-memos',undefined,'foreign')).records).to.deep.equal([]);expect(ok(await req('get','/refunds',undefined,'foreign')).records).to.deep.equal([]);expect(await s.allState()).to.deep.equal(before);
 });
});
