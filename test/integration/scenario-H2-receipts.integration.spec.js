'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {randomUUID}=require('crypto');
const {today,ago}=require('./_scenario');
describe('H2 receipt and original-obligation lifecycle',function(){
 this.timeout(180000);let s,entity,c,job,open;
 const request=(method,path,body,key=randomUUID(),role='sa')=>{let r=s.request[method](path).set('Authorization','Bearer '+s.token(role)).set('Idempotency-Key',key);return body===undefined?r:r.send(body);};
 const load=async client=>ok(await request('get',`/payments/open-obligations?customerId=${(client || c).id}&entityId=${entity}`));
 before(async()=>{s=await new PathScenario().boot();entity=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;c=await s.customer('H2 Multi Invoice');job=await s.job(c);
  for(const amount of [300,450,400]){await s.work(c,job,amount,{entityId:entity});await s.finalize([c],{entityId:entity,allowSameDayRebill:true});}
 });
 after(async()=>{if(s)await s.close();});
 it('retains three original debts through two statement rollovers',async()=>{open=await load();expect(open.obligations.map(o=>o.openCents)).to.deep.equal([30000,45000,40000]);expect(open.billedCents).to.equal(115000);});
 it('applies one $1000 receipt as $300, $450, $250 and leaves $150 on the newest',async()=>{
  const body={customerId:c.id,entityId:entity,amount:'1000',date:today(),method:'check',reference:'H2-1000',ledgerFingerprint:open.ledgerFingerprint,allocations:open.obligations.map((o,i)=>({obligationId:o.obligation_id,amount:[300,450,250][i]}))},key=randomUUID();
  const result=ok(await request('post','/payments/receipts',body,key));expect(result.applied).to.equal('1000.00');expect(result.remainingCredit).to.equal('0.00');
  const before=await s.allState();expect(ok(await request('post','/payments/receipts',body,key))).to.deep.equal(result);expect(await s.allState()).to.deep.equal(before);
  const current=await load();expect(current.obligations.map(o=>o.openCents)).to.deep.equal([15000]);expect(current.billedCents).to.equal(15000);await s.check(c,{n:150,b:150,r:0});
 });
 it('applies $1500 to $1150 debt and automatically uses its $350 credit on the next $500 bill',async()=>{
  const second=await s.customer('H2 Excess Credit'),j=await s.job(second);
  for(const amount of [300,450,400]){await s.work(second,j,amount,{entityId:entity});await s.finalize([second],{entityId:entity,allowSameDayRebill:true});}
  const state=await load(second);
  const result=ok(await request('post','/payments/receipts',{customerId:second.id,entityId:entity,amount:1500,date:today(),method:'check',reference:'H2-1500',ledgerFingerprint:state.ledgerFingerprint,allocations:state.obligations.map(o=>({obligationId:o.obligation_id,amount:o.openCents/100}))}));
  expect(result.remainingCredit).to.equal('350.00');expect((await load(second)).billedCents).to.equal(0);
  await s.work(second,j,500,{entityId:entity});
  const preview=await s.preview(second);expect(preview.invoiceTotal).to.equal(150);expect(preview.heldCreditApplied).to.equal(350);
  const audit=await s.audit(second);expect(Number(audit.audit_balance)).to.equal(500);expect(Number(audit.app_invoice_total)).to.equal(500);expect(Number(audit.balance_difference)).to.equal(0);
  expect(audit.summary.totals).to.include({held_receipt_credit:350,proposed_credit_use:350,proposed_statement_total:150});
  const businesses=ok(await request('get',`/billing-entities/balances?customerId=${second.id}`));expect(businesses.balances[0]).to.include({nextStatement:500,heldReceiptCredit:350,proposedCreditUse:350,proposedStatement:150});
  const history=ok(await request('get',`/auditRecord/customer/${second.id}/1/1`));expect(history.current).to.include({running_balance:500,held_credit_available:350,proposed_statement_balance:150});expect(history.verification.valid).to.equal(true);
  const printed=await request('post',`/auditRecord/customer/${second.id}/1/1/records`,{});expect(printed.status).to.equal(201);
  const archived=await request('get',`/auditRecord/customer/${second.id}/1/1/records/${printed.body.record.record_id}/pdf`).buffer(true).parse((res,cb)=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>cb(null,Buffer.concat(chunks)));});
  expect(archived.status).to.equal(200);expect(s.pdf(archived.body)).to.include('Held receipt credit: $350.00. Proposed next statement after credit: $150.00.');
  require('fs').mkdirSync('/tmp/ds2-h2-pdf',{recursive:true});require('fs').writeFileSync('/tmp/ds2-h2-pdf/held-credit-audit-record.pdf',archived.body);
  const invoice=await s.finalize([second],{entityId:entity,allowSameDayRebill:true});expect(invoice.invoicesWithDetail[0].heldCreditApplied).to.equal(350);expect(invoice.invoicesWithDetail[0].invoiceTotal).to.equal(150);
  const files=await s.files(invoice.fileLocation),pdf=Object.values(files).find(buffer=>buffer.subarray(0,4).toString()==='%PDF');expect(s.pdf(pdf)).to.include('Payments received (each receipt once)').and.to.include('350.00').and.to.include('150.00');require('fs').mkdirSync('/tmp/ds2-h2-pdf',{recursive:true});require('fs').writeFileSync('/tmp/ds2-h2-pdf/receipt-credit-statement.pdf',pdf);
  expect((await load(second)).billedCents).to.equal(15000);await s.check(second,{n:150,b:150,r:0});
  let detail=ok(await request('get',`/payments/receipts/${result.receipt.receipt_id}`));
  ok(await request('post',`/payments/receipts/${result.receipt.receipt_id}/exceptions`,{condition:'bounced_check',reason:'Returned check including used excess',ledgerFingerprint:detail.ledgerFingerprint}));
  detail=ok(await request('get',`/payments/receipts/${result.receipt.receipt_id}`));
  ok(await request('post',`/payments/receipts/${result.receipt.receipt_id}/reversals`,{reason:'Restore every invoice and used credit',ledgerFingerprint:detail.ledgerFingerprint}));
  expect((await load(second)).billedCents).to.equal(165000);expect((await load(second)).credits.reduce((n,l)=>n+l.availableCents,0)).to.equal(0);await s.check(second,{n:1650,b:1650,r:0});
 });
 it('keeps original ages across two rollovers and reproduces both cutoffs',async()=>{
  const client=await s.customer('H2 Dated Aging'),j=await s.job(client);
  await s.work(client,j,100,{entityId:entity});await s.finalize([client],{entityId:entity,allowSameDayRebill:true});await s.shift(31);
  await s.work(client,j,80,{entityId:entity});await s.finalize([client],{entityId:entity});await s.shift(28);
  await s.work(client,j,50,{entityId:entity});await s.finalize([client],{entityId:entity});await s.shift(19);
  let state=await load(client);expect(state.obligations.map(o=>o.openCents)).to.deep.equal([10000,8000,5000]);
  const cutoff=new Date().toISOString();
  const receipt=ok(await request('post','/payments/receipts',{customerId:client.id,entityId:entity,amount:150,date:ago(5),method:'check',reference:'AGE150',ledgerFingerprint:state.ledgerFingerprint,allocations:[{obligationId:state.obligations[0].obligation_id,amount:100},{obligationId:state.obligations[1].obligation_id,amount:50}]}));
  const aging=ok(await request('get',`/accountsReceivable/aging/1/1?entityId=${entity}&limit=500`)).arAging.customers.find(r=>r.customer_id===client.id);
  expect([aging.bucket_0_30,aging.bucket_31_60,aging.bucket_61_90,aging.total_outstanding]).to.deep.equal([50,30,0,80]);
  const known=ok(await request('get',`/payments/open-obligations?customerId=${client.id}&entityId=${entity}&recordedThrough=${encodeURIComponent(cutoff)}`));expect(known.billedCents).to.equal(23000);
  const prior=ok(await request('get',`/payments/open-obligations?customerId=${client.id}&entityId=${entity}&asOf=${ago(6)}`));expect(prior.billedCents).to.equal(23000);
  let detail=ok(await request('get',`/payments/receipts/${receipt.receipt.receipt_id}`));ok(await request('post',`/payments/receipts/${receipt.receipt.receipt_id}/exceptions`,{condition:'bounced_check',reason:'Returned dated receipt',ledgerFingerprint:detail.ledgerFingerprint}));detail=ok(await request('get',`/payments/receipts/${receipt.receipt.receipt_id}`));ok(await request('post',`/payments/receipts/${receipt.receipt.receipt_id}/reversals`,{reason:'Returned dated receipt',ledgerFingerprint:detail.ledgerFingerprint}));
  const restored=ok(await request('get',`/accountsReceivable/aging/1/1?entityId=${entity}&limit=500`)).arAging.customers.find(r=>r.customer_id===client.id);expect([restored.bucket_0_30,restored.bucket_31_60,restored.bucket_61_90,restored.total_outstanding]).to.deep.equal([50,80,100,230]);
 });
 it('derives a transferred legacy retainer as noncash and counts its original deposit once',async()=>{
  const client=await s.customer('H2 Legacy Transfer Cash');
  const destination=ok(await request('post','/billing-entities',{name:'H2 legacy transfer destination',legal_name:'H2 legacy transfer destination',invoice_prefix:'HLT',reason:'Separate legacy deposit destination'})).entity.billing_entity_id;
  const root=await s.retainer(client,80,{entityId:entity});
  ok(await request('post','/billing-entities/transfers',{customerId:client.id,sourceEntityId:entity,destinationEntityId:destination,retainerId:root.retainer_id,expectedSnapshotId:root.retainer_id,amount:30,reason:'Move the existing deposit, without new cash'}));
  for(const business of [entity,destination]){
   const state=ok(await request('get',`/payments/open-obligations?customerId=${client.id}&entityId=${business}`));
   ok(await request('post','/payments/receipts',{customerId:client.id,entityId:business,amount:1,date:today(),method:'cash',allocations:[],ledgerFingerprint:state.ledgerFingerprint}));
  }
  const deposits=await s.db('payment_receipts').where({account_id:1,customer_id:client.id,source_kind:'legacy_retainer'});
  expect(deposits).to.have.length(1);expect(Number(deposits[0].amount)).to.equal(80);expect(deposits[0].billing_entity_id).to.equal(entity);
  expect(await s.db('client_credit_lots').where({account_id:1,customer_id:client.id})).to.have.length(2);
 });

});
