'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {randomUUID}=require('crypto');
const {today}=require('./_scenario');
describe('H3 correction financial lifecycle',function(){
 this.timeout(180000);let s,e;
 const req=(method,path,body,key=randomUUID(),role='sa')=>{let r=s.request[method](path).set('Authorization','Bearer '+s.token(role)).set('Idempotency-Key',key);return body===undefined?r:r.send(body);};
 const state=c=>req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${e}`).then(ok);
 const invoice=async(c,amount)=>{const j=c.job || (c.job=await s.job(c));await s.work(c,j,amount,{entityId:e});await s.finalize([c],{entityId:e,allowSameDayRebill:true});return s.db('customer_invoices').where({customer_id:c.id}).whereNull('parent_invoice_id').orderBy('customer_invoice_id','desc').first();};
 const pay=async(c,amount)=>{const st=await state(c);let left=amount;return ok(await req('post','/payments/receipts',{customerId:c.id,entityId:e,amount,date:today(),method:'check',reference:randomUUID(),ledgerFingerprint:st.ledgerFingerprint,allocations:st.obligations.flatMap(o=>{const n=Math.min(left,o.openCents/100);left-=n;return n?[{obligationId:o.obligation_id,amount:n}]:[];})}));};
 const memo=async(i,amount)=>{const p=ok(await req('get',`/invoices/${i.customer_invoice_id}/corrections`));return ok(await req('post',`/invoices/${i.customer_invoice_id}/credit-memos`,{entityId:e,amount,reason:'Correct original charge',date:today(),allowCreditExcess:true,ledgerFingerprint:p.ledgerFingerprint}));};
 const rebill=async(i,amount,extra={})=>{const body={entityId:e,replacementEntityId:e,reason:'Correct invoice charges',date:today(),lines:[{description:'Corrected professional services',amount}],...extra};const preview=ok(await req('post',`/invoices/${i.customer_invoice_id}/void-rebill/preview`,body));return ok(await req('post',`/invoices/${i.customer_invoice_id}/void-rebill`,{...body,previewFingerprint:preview.previewFingerprint}));};
 before(async()=>{s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;});after(async()=>{if(s)await s.close();});
 it('reduces original debt by memo and prints it once on the next statement',async()=>{
  const c=await s.customer('H3 memo aging'),i=await invoice(c,100),original=await s.db('customer_invoices').where({customer_invoice_id:i.customer_invoice_id}).first();
  const m=await memo(i,30);expect((await state(c)).billedCents).to.equal(7000);await s.check(c,{n:70,b:70,r:0});
  expect(await s.db('customer_invoices').where({customer_invoice_id:i.customer_invoice_id}).first()).to.deep.equal(original);
  const next=await s.finalize([c],{entityId:e,allowSameDayRebill:true});expect(next.invoicesWithDetail[0].invoiceTotal).to.equal(70);expect(next.invoicesWithDetail[0].correctionSummary).to.have.length(1);
  const files=await s.files(next.fileLocation);expect(s.pdf(Object.values(files).find(b=>b.subarray(0,4).toString()==='%PDF'))).to.include(m.memo.number);
  expect((await s.preview(c)).correctionSummary).to.have.length(0);await s.check(c,{n:70,b:70,r:0});
 });
 it('paid100, memo30, refund10 and future50 yield debt30 with cash returned10',async()=>{
  const c=await s.customer('H3 paid memo'),i=await invoice(c,100);await pay(c,100);await memo(i,30);let st=await state(c);expect(st.billedCents).to.equal(-3000);const lot=st.credits.find(l=>l.availableCents===3000);
  const r=ok(await req('post',`/credits/${lot.credit_id}/refunds`,{entityId:e,amount:10,date:today(),method:'check',reference:'Return10',reason:'Return part of the overpaid charge',ledgerFingerprint:st.ledgerFingerprint}));expect(r.remainingCredit).to.equal('20.00');await s.check(c,{n:-20,b:-20,r:0});
  await invoice(c,50);expect((await state(c)).billedCents).to.equal(3000);await s.check(c,{n:30,b:30,r:0});
  expect(Number((await s.db('client_refunds').where({customer_id:c.id}).sum({n:'amount'}).first()).n)).to.equal(10);
 });
 it('refund350 of held overpayment leaves zero credit and zero AR effect',async()=>{
  const c=await s.customer('H3 refund350');await invoice(c,1150);const p=await pay(c,1500),st=await state(c),before=await s.db('customer_payments').where({customer_id:c.id});
  ok(await req('post',`/credits/${p.credit.credit_id}/refunds`,{entityId:e,amount:350,date:today(),method:'cash',reason:'Return unused client money',ledgerFingerprint:st.ledgerFingerprint}));
  const after=await state(c);expect(after.billedCents).to.equal(0);expect(after.credits.reduce((n,l)=>n+l.availableCents,0)).to.equal(0);expect(await s.db('customer_payments').where({customer_id:c.id})).to.deep.equal(before);await s.check(c,{n:0,b:0,r:0});
 });
 for(const paid of [0,40,100])it(`void100 rebill120 with payment${paid} preserves cash and gives debt${120-paid}`,async()=>{
  const c=await s.customer(`H3 void paid${paid}`),i=await invoice(c,100);if(paid)await pay(c,paid);
  const originals=await s.files(i.invoice_file_location),result=await rebill(i,120);expect(result.replacement.invoice_number).not.to.equal(i.invoice_number);expect(await s.files(i.invoice_file_location)).to.deep.equal(originals);expect((await state(c)).billedCents).to.equal((120-paid)*100);await s.check(c,{n:120-paid,b:120-paid,r:0});
  const pdf=Object.values(await s.files(result.replacement.invoice_file_location)).find(b=>b.subarray(0,4).toString()==='%PDF');expect(s.pdf(pdf)).to.include('Corrected professional services').and.to.include((120-paid).toFixed(2));
  expect((await s.db('customer_transactions').where({customer_id:c.id}))).to.have.length(1);
 });
 it('voids an absorbed original and retains both the later bill and its obligations',async()=>{
  const c=await s.customer('H3 absorbed'),i=await invoice(c,100);await invoice(c,50);await pay(c,100);await rebill(i,120);expect((await state(c)).billedCents).to.equal(7000);await s.check(c,{n:70,b:70,r:0});
 });
 it('retains prior memo once through paid-original void/rebill',async()=>{
  const c=await s.customer('H3 memo then void'),i=await invoice(c,100);await pay(c,100);await memo(i,30);await rebill(i,120);expect((await state(c)).billedCents).to.equal(2000);await s.check(c,{n:20,b:20,r:0});
 });
 it('bounces the complete receipt after rebill and restores corrected original debt',async()=>{
  const c=await s.customer('H3 bounce replacement'),i=await invoice(c,100),p=await pay(c,100);await rebill(i,120);
  let d=ok(await req('get',`/payments/receipts/${p.receipt.receipt_id}`));ok(await req('post',`/payments/receipts/${p.receipt.receipt_id}/exceptions`,{condition:'bounced_check',reason:'Returned check',ledgerFingerprint:d.ledgerFingerprint}));
  d=ok(await req('get',`/payments/receipts/${p.receipt.receipt_id}`));ok(await req('post',`/payments/receipts/${p.receipt.receipt_id}/reversals`,{reason:'Returned check',ledgerFingerprint:d.ledgerFingerprint}));expect((await state(c)).billedCents).to.equal(12000);await s.check(c,{n:120,b:120,r:0});
 });
 it('reverses a mistaken memo with linked immutable evidence',async()=>{const c=await s.customer('H3 undo memo'),i=await invoice(c,100),m=await memo(i,30);const st=await state(c);ok(await req('post',`/credit-memos/${m.memo.memo_id}/reversals`,{entityId:e,reason:'Memo was a duplicate decision',ledgerFingerprint:st.ledgerFingerprint}));expect((await state(c)).billedCents).to.equal(10000);await s.check(c,{n:100,b:100,r:0});});
 it('reclassifies corrected charges to another business and explicitly transfers released cash',async()=>{
  const c=await s.customer('H3 cross business'),i=await invoice(c,100);await pay(c,100);
  const target=ok(await req('post','/billing-entities',{name:'H3 Advisory',legal_name:'H3 Advisory',invoice_prefix:'HCROSS',reason:'Correct company attribution'})).entity.billing_entity_id;
  const r=await rebill(i,120,{replacementEntityId:target,transferReleasedCredit:true});expect(r.replacement.billing_entity_id).to.equal(target);expect((await state(c)).billedCents).to.equal(0);
  const dest=ok(await req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${target}`));expect(dest.billedCents).to.equal(2000);expect(dest.credits.reduce((n,l)=>n+l.availableCents,0)).to.equal(0);const preview=ok(await s.post('/invoices/createInvoice/1/1',s.configuration([c],{entityId:target})));expect(preview.invoicesWithDetail[0].invoiceTotal).to.equal(20);const audit=await s.audit(c);expect(Number(audit.audit_balance)).to.equal(20);expect(Number(audit.balance_difference)).to.equal(0);
 });
 it('keeps source funds when correcting another business without explicit transfer',async()=>{
  const c=await s.customer('H3 retain source credit'),i=await invoice(c,100);await pay(c,100);const target=(await s.db('billing_entities').where({name:'H3 Advisory'}).first()).billing_entity_id;
  await rebill(i,120,{replacementEntityId:target});const source=await state(c),dest=ok(await req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${target}`));expect(source.billedCents).to.equal(0);expect(source.credits.reduce((n,l)=>n+l.availableCents,0)).to.equal(10000);expect(dest.billedCents).to.equal(12000);
 });
 it('reissues an unused credit statement while preserving its original negative PDF',async()=>{
  const c=await s.customer('H3 credit original');await s.writeoff(c,30,{entityId:e});await s.finalize([c],{entityId:e},{includeCreditStatement:true});const i=await s.db('customer_invoices').where({customer_id:c.id}).whereNull('parent_invoice_id').first();expect(Number(i.total_amount_due)).to.equal(-30);await rebill(i,50);await s.check(c,{n:50,b:50,r:0});
 });
 it('refunds memo credit after an optional credit statement without reopening unrelated debt',async()=>{
  const c=await s.customer('H3 memo credit statement'),i=await invoice(c,100);await pay(c,100);await memo(i,30);await s.finalize([c],{entityId:e,allowSameDayRebill:true},{includeCreditStatement:true});const st=await state(c),lot=st.credits.find(l=>l.availableCents===3000);
  ok(await req('post',`/credits/${lot.credit_id}/refunds`,{entityId:e,amount:30,date:today(),method:'cash',reason:'Return entire credit statement balance',ledgerFingerprint:st.ledgerFingerprint}));await s.check(c,{n:0,b:0,r:0});
  const h=ok(await req('get',`/auditRecord/customer/${c.id}/1/1`));expect(h.current.running_balance).to.equal(0);expect(h.verification.valid).to.equal(true);
 });
 it('rebills legacy received payments without minting a second cash receipt or work row',async()=>{
  const c=await s.customer('H3 legacy single payment'),i=await invoice(c,100);await s.pay(c,100,{entityId:e,selectedInvoiceID:i.customer_invoice_id});await rebill(i,120);await s.check(c,{n:20,b:20,r:0});expect(await s.db('payment_receipts').where({customer_id:c.id,source_kind:'manual'})).to.have.length(0);
 });
 it('corrects an already corrected invoice without losing its next replacement link',async()=>{
  const c=await s.customer('H3 correction chain'),first=await invoice(c,100);await pay(c,40);const second=(await rebill(first,120)).replacement,third=(await rebill(second,90)).replacement;
  const context=ok(await req('get',`/invoices/${second.customer_invoice_id}/corrections`));expect(context.void).not.to.equal(null);expect(context.rebill.replacement_invoice_id).to.equal(third.customer_invoice_id);expect((await state(c)).billedCents).to.equal(5000);await s.check(c,{n:50,b:50,r:0});
  const audit=ok(await req('get',`/auditRecord/customer/${c.id}/1/1`));expect(audit.current.running_balance).to.equal(50);expect(audit.verification.valid).to.equal(true);
 });
 it('retains the original age after a credit memo and after reversing that memo',async()=>{
  const c=await s.customer('H3 memo original age'),i=await invoice(c,100);await s.shift(45);const m=await memo(i,30),aging=ok(await req('get',`/accountsReceivable/aging/1/1?entityId=${e}&limit=500`)).arAging.customers.find(r=>r.customer_id===c.id);expect(aging.bucket_31_60).to.equal(70);expect(aging.bucket_0_30).to.equal(0);
  ok(await req('post',`/credit-memos/${m.memo.memo_id}/reversals`,{entityId:e,reason:'Restore original obligation',ledgerFingerprint:(await state(c)).ledgerFingerprint}));const after=ok(await req('get',`/accountsReceivable/aging/1/1?entityId=${e}&limit=500`)).arAging.customers.find(r=>r.customer_id===c.id);expect(after.bucket_31_60).to.equal(100);
 });

});
