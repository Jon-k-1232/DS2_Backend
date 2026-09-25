'use strict';
const {Scenario,ok,expect,today}=require('./_scenario');
describe('all five owner decisions in one complete billing lifecycle',function(){
 this.timeout(180000);const s=new Scenario();let c,j,r,w,i1,i2,i3,receipt,ex;
 before(async()=>s.boot());after(()=>s.close());
 it('work -> retainer draw -> finalize means sent and locked: $400 - $100 = $300',async()=>{
  c=await s.customer('All owner decisions');j=await s.job(c);w=await s.work(c,j,300);
  r=await s.retainer(c,200);await s.work(c,j,100,{selectedRetainerID:r.retainer_id,detailedJobDescription:'Retainer funded work'});
  i1=await s.statement(c,await s.finalize([c]),1,[0,400,-100,0,-100,300]);
  await s.reject(()=>s.editWork(w,{unitCost:310,totalTransaction:310}),/locked/,c,{n:300,b:300,r:-100},409);
 });
 it('new duplicate work is visibly flagged and removed; issued evidence remains frozen',async()=>{
  await s.work(c,j,40,{detailedJobDescription:'New duplicate candidate'});const copy=await s.work(c,j,40,{detailedJobDescription:'New duplicate candidate'});
  await s.check(c,{n:380,b:300,r:-100});
  const flags=ok(await s.get(`/duplicates/1/1?customerId=${c.id}`)).duplicates;const f=flags.find(x=>x.record_id===copy.transaction_id);expect(f).to.exist;
  ok(await s.post(`/duplicates/${f.duplicate_id}/resolve/1/1`,{action:'remove',reason:'Second manual entry repeats the same work'}));
  await s.check(c,{n:340,b:300,r:-100});
 });
 it('check receipt -> statement $240 -> bounced flag -> narrow reversal $340 -> roll forward',async()=>{
  receipt=(await s.pay(c,100,{selectedInvoiceID:i1.customer_invoice_id,paymentReferenceNumber:'OWNER-NSF'})).row;
  await s.check(c,{n:240,b:200,r:-100});
  i2=await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),2,[200,40,0,0,-100,240],['Total Payments Received: -100.00']);
  ex=ok(await s.post(`/invoices/${i2.customer_invoice_id}/exceptions/1/1`,{condition:'bounced_check',reason:'Bank returned OWNER-NSF',paymentIds:[receipt.payment_id]}));
  ok(await s.post(`/invoices/${i2.customer_invoice_id}/exceptions/${ex.exception_id}/reverse/1/1`));
  await s.check(c,{n:340,b:340,r:-100});
  ok(await s.post(`/invoices/${i2.customer_invoice_id}/exceptions/${ex.exception_id}/resolve/1/1`,{action:'roll_forward'}));
  i3=await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),3,[340,0,0,0,-100,340],['Total Payments Received: 100.00']);
  expect(Object.values(await s.files(i2.invoice_file_location)).some(b=>b.equals(i2.pdf))).to.equal(true);
 });
 it('retainer refund -> credit skipped -> credit chosen -> later work consumes credit exactly once',async()=>{
  ok(await s.post(`/retainers/${r.retainer_id}/events/1/1`,{kind:'refund',amount:40,date:today(),method:'Check',reference:'OWNER-REFUND',reason:'Return unused retainer funds'}));
  await s.check(c,{n:340,b:340,r:-60});
  await s.writeoff(c,400,{writeoffReason:'Owner goodwill credit'});await s.check(c,{n:-60,b:340,r:-60});
  const before=await s.state();const skip=await s.finalize([c],{allowSameDayRebill:true});expect(skip.skippedCustomers[0].code).to.equal('CREDIT_NOT_SELECTED');expect(await s.state()).to.deep.equal(before);
  await s.statement(c,await s.finalize([c],{allowSameDayRebill:true},{includeCreditStatement:true,showWriteOffs:true}),4,[340,0,0,-400,-60,-60],['CREDIT STATEMENT','No payment due','OWNER-REFUND']);
  await s.work(c,j,80,{detailedJobDescription:'Work after credit statement'});await s.check(c,{n:20,b:-60,r:-60});
  await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),5,[-60,80,0,0,-60,20]);
  for(const original of [i1,i2,i3])expect(Object.values(await s.files(original.invoice_file_location)).some(b=>b.equals(original.pdf))).to.equal(true);
 });
});
