'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix'),{today}=require('./_scenario'),{randomUUID}=require('crypto'),{performance}=require('perf_hooks');
const ctx=require('../../src/endpoints/billingEntities/entity-context'),original=require('../helpers/h10-original'),{bytes}=require('../helpers/h10-equivalence');
describe('H10 unchanged balances through synthetic ledger writes',function(){
 this.timeout(180000);let s,a,b,c,j,invoiceB;const timings=[];
 const req=(method,url,body,role='sa')=>{const r=s.request[method](url).set('Authorization','Bearer '+s.token(role)).set('Idempotency-Key',randomUUID());return body===undefined?r:r.send(body);};
 const open=entity=>req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${entity}`).then(ok);
 before(async()=>{s=await new PathScenario().boot();a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;b=ok(await req('post','/billing-entities',{name:'H10 Advisory',legal_name:'H10 Advisory',invoice_prefix:'HTEN',reason:'Synthetic isolation oracle'})).entity.billing_entity_id;c=await s.customer('H10 batch equivalence');j=await s.job(c);});
 after(async()=>{require('fs').writeFileSync('docs/decisions/evidence/run-H10/recurring-prepare.json',JSON.stringify(timings,null,2));if(s)await s.close();});
 async function compare(expected){
  const cutoff={asOf:today(),recordedThrough:new Date().toISOString()},customers=await s.db('customers').where({account_id:1}),ids=customers.map(c=>c.customer_id);
  const selection=Object.fromEntries(ids.map(customer_id=>[customer_id,{customer_id,showWriteOffs:false}]));
  const before=await s.allState();
  for(const [entity,B,N,H] of expected)await ctx.run(entity,async()=>{
   const p='src/endpoints/invoice/createInvoice/createInvoiceQueries.js';
   const actual=await require('../../'+p).fetchInitialQueryItems(s.db,selection,1,{billingDate:today()}),prior=await original(p).fetchInitialQueryItems(s.db,selection,1,{billingDate:today()});
   expect(bytes(actual)).eq(bytes(prior));
   const invoices=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices').calculateInvoices(Object.values(selection),actual),inv=invoices.find(r=>r.customer_id===c.id);
   expect(inv.invoiceTotal).eq(N);expect(inv.outstandingInvoices.outstandingInvoiceTotal).eq(B);expect(inv.heldCreditAvailable).eq(H);
   const states=await require('../../src/endpoints/payments/receipt-balances').readMany(s.db,{accountId:1,entityId:entity,customerIds:ids},cutoff);
   for(const customerId of ids){const {ledgerFingerprint,...oldState}=await original('src/endpoints/payments/receipt-ledger.js').read(s.db,{accountId:1,entityId:entity,customerId},cutoff);expect(bytes(states[customerId])).eq(bytes(oldState));}
   const aging=await require('../../src/endpoints/accountsReceivable/accounts-receivable-service').getAging(s.db,1,{...cutoff,limit:10000});
   expect(aging.rows.find(r=>r.customer_id===c.id)?.total_outstanding || 0).eq(B);
  });
  expect(await s.allState()).deep.eq(before);
 }
 it('prices and issues independent 100 and 40 charges without cross-business leakage',async()=>{
  await s.work(c,j,100,{entityId:a});await s.work(c,j,40,{entityId:b});await compare([[a,0,100,0],[b,0,40,0]]);
  await s.finalize([c],{entityId:a});const out=await s.finalize([c],{entityId:b});invoiceB=out.committedInvoices[0].customer_invoice_id;await compare([[a,100,100,0],[b,40,40,0]]);
 });
 it('a 130 receipt pays 100 and holds 30; subsequent 50 work previews at 20',async()=>{
  const st=await open(a);ok(await req('post','/payments/receipts',{customerId:c.id,entityId:a,amount:130,date:today(),method:'cash',ledgerFingerprint:st.ledgerFingerprint,allocations:[{obligationId:st.obligations.find(o=>o.openCents>0).obligation_id,amount:100}]}));
  await compare([[a,0,0,30],[b,40,40,0]]);await s.work(c,j,50,{entityId:a});await compare([[a,0,20,30],[b,40,40,0]]);
 });
 it('an admin memo of 10 changes only business B; a new finalize consumes credit once',async()=>{
  ok(await req('post',`/invoices/${invoiceB}/credit-memos`,{entityId:b,amount:10,date:today(),reason:'Synthetic fee correction',ledgerFingerprint:(await open(b)).ledgerFingerprint},'admin'));
  await compare([[a,0,20,30],[b,30,30,0]]);await s.finalize([c],{entityId:a,allowSameDayRebill:true});await compare([[a,20,20,0],[b,30,30,0]]);
 });
 it('all analytics and a single prepared packet match their original readers after these events',async()=>{
  const p='src/endpoints/analytics/analytics-service.js',service=require('../../'+p),model=require('../../src/endpoints/analytics/reporting-model');
  const options={year:Number(today().slice(0,4)),asOf:today(),recordedThrough:new Date().toISOString(),entityId:'all'},prepared=await model.load(s.db,1,options);
  for(const name of ['getBillingPerformance','getClientRates','getTimeAllocation','getWipAging','getJobBudgets','getTaxSeasonCapacity']){
   const expected=await original(p)[name](s.db,1,options);
   expect(JSON.stringify(await service[name](s.db,1,options))).eq(JSON.stringify(expected));
   expect(JSON.stringify(await service[name](s.db,1,options,prepared))).eq(JSON.stringify(expected));
  }
 });
 it('eight recurring plans prepare once and unchanged plans require no new ledger writes',async()=>{
  for(let i=0;i<8;i++){const client=await s.customer('H10 recurring '+i);ok(await req('post','/recurringCustomer/plans',{customerId:client.id,entityId:a,description:'Monthly synthetic fee',frequency:'monthly',billDay:Number(today().slice(8)),amount:10,startDate:today(),endDate:today(),active:true,reason:'Synthetic performance fixture'}));}
  for(const label of ['generate eight fees','already prepared']){const start=performance.now(),out=ok(await req('post','/recurringCustomer/prepare',{entityId:a,billingDate:today()}));timings.push({label,elapsedMs:performance.now()-start,generated:out.generated});expect(out.generated).eq(label==='already prepared'?0:8);}
  await compare([[a,20,20,0],[b,30,30,0]]);
 });
 for(const [name,url,service,method,message] of [
  ['statement evidence','/invoices/createInvoice/AccountsWithBalance/1/1',require('../../src/endpoints/invoice/createInvoice/statementExtras'),'read',/Unable to calculate/],
  ['AR batch','/accountsReceivable/aging/1/1',require('../../src/endpoints/payments/receipt-balances'),'readMany',/path-matrix|error|Unable/i],
  ['analytics','/analytics/billingPerformance/1/1',require('../../src/endpoints/analytics/reporting-model'),'load',/path-matrix|error|Unable/i],
  ['packet','/analytics/yearEndPacket/1/1',require('../../src/endpoints/analytics/reporting-model'),'load',/path-matrix|error|Unable/i]
 ])it(`${name} database failure returns 500 and preserves all tables and audit evidence`,()=>s.fail(service,method,()=>s.refused(()=>req('get',url+'?entityId='+a),500,500,message)));
 it('wrong account, wrong business and forbidden roles preserve all rows on optimized reads',async()=>{
  for(const url of ['/invoices/createInvoice/AccountsWithBalance/1/1','/accountsReceivable/aging/1/1','/analytics/billingPerformance/1/1']){
   await s.refused(()=>req('get',url.replace('/1/1','/7000/1')),403,403,/account/i);
   await s.refused(()=>req('get',url+'?entityId=2147483646'),404,404,/not found/i);
   await s.refused(()=>req('get',url,undefined,'staff'),403,403,/Unauthorized|access|permission/i);
  }
 });
});
