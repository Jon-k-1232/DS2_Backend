'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {today}=require('./_scenario');
const {randomUUID}=require('crypto');
const fs=require('fs'),path=require('path');

describe('H7 both owner rounds: one client across two businesses',function(){
 this.timeout(180000);let s,a,b,c,ja,jb,work,retainer,firstA,firstB,receipt,occurrence,memo,cutoff,record;
 const frozen=[];
 const req=(method,url,body,role='sa',key=randomUUID())=>{const r=s.request[method](url).set('Authorization','Bearer '+s.token(role)).set('Idempotency-Key',key);return body===undefined?r:r.send(body);};
 const open=(entity,extra='')=>req('get',`/payments/open-obligations?customerId=${c.id}&entityId=${entity}${extra}`).then(ok);
 const issue=async(entity,flags={})=>{
  const out=await s.finalize([c],{entityId:entity,allowSameDayRebill:true},flags);
  const row=await s.db('customer_invoices').where({customer_invoice_id:out.committedInvoices[0].customer_invoice_id}).first();
  frozen.push({row,files:await s.files(row.invoice_file_location)});return row;
 };
 const pay=async(entity,amount,method='cash')=>{
  const st=await open(entity);let left=amount;
  return ok(await req('post','/payments/receipts',{customerId:c.id,entityId:entity,amount,date:today(),method,reference:method==='check'?'H7-250':undefined,ledgerFingerprint:st.ledgerFingerprint,allocations:st.obligations.flatMap(o=>{const n=Math.min(left,o.openCents/100);left-=n;return n?[{obligationId:o.obligation_id,amount:n}]:[];})}));
 };
 const creditMemo=async(invoice,entity,amount)=>ok(await req('post',`/invoices/${invoice.customer_invoice_id}/credit-memos`,{entityId:entity,amount,date:today(),allowCreditExcess:true,reason:'Reviewed original service correction',ledgerFingerprint:(await open(entity)).ledgerFingerprint},'admin'));
 async function check(expected){
  let totalB=0,totalN=0;
  for(const [entity,B,N,held,R] of expected){
   totalB+=B;totalN+=N;
   const st=await open(entity);expect(st.billedCents,`business ${entity} obligations`).to.equal(B*100);expect(st.credits.filter(l=>l.kind==='held_receipt').reduce((n,l)=>n+l.availableCents,0)).to.equal(held*100);
   const p=ok(await s.post('/invoices/createInvoice/1/1',s.configuration([c],{entityId:entity}))).invoicesWithDetail[0];
   expect(p.preCreditInvoiceTotal ?? p.invoiceTotal,`business ${entity} raw N`).to.equal(N);expect(p.invoiceTotal).to.equal(N-Math.min(held,Math.max(0,N)));expect(p.outstandingInvoices.outstandingInvoiceTotal).to.equal(B);expect(p.retainers.retainerTotal).to.equal(-R);
   const start=ok(await req('post','/accountAudit/run/1/1',{customer_ids:[c.id],entityId:entity,notes:'H7 independent hand oracle'}));let result;
   for(let i=0;i<1000;i++){result=ok(await req('get',`/accountAudit/job/${start.job_id}/1/1`));if(result.processing_status!=='processing')break;await new Promise(r=>setTimeout(r,10));}
   expect(result.processing_status).to.equal('complete');const audit=ok(await req('get',`/accountAudit/audit/${result.results[0].audit_id}/1/1`)).audit;
   expect(Number(audit.audit_balance)).to.equal(N);expect(Number(audit.app_invoice_total)).to.equal(N);expect(Number(audit.outstanding_invoices)).to.equal(B);expect(Number(audit.balance_difference)).to.equal(0);
   const ar=ok(await req('get',`/accountsReceivable/aging/1/1?entityId=${entity}&limit=500`)).arAging.customers.find(r=>r.customer_id===c.id);expect(ar?.total_outstanding || 0).to.equal(B);
  }
  const balances=ok(await req('get',`/billing-entities/balances?customerId=${c.id}`)).balances;
  expect(balances.reduce((n,r)=>n+r.billed,0)).to.equal(totalB);
  expect(balances.reduce((n,r)=>n+r.nextStatement,0)).to.equal(totalN);
 }
 before(async()=>{
  s=await new PathScenario().boot();a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  b=ok(await req('post','/billing-entities',{name:'H7 Advisory',legal_name:'H7 Advisory LLC',invoice_prefix:'HADV',reason:'Separate company for this client'})).entity.billing_entity_id;
  c=await s.customer('H7 complete two-business lifecycle');ja=await s.job(c);ok(await s.post('/jobs/createJob/1/1',{entityId:b,job:s.jobBody(c,2)}));jb=await s.db('customer_jobs').where({customer_id:c.id,job_type_id:2}).first();await s.db('users').where({user_id:3}).update({cost_rate:30});
 });
 after(async()=>{if(s)await s.close();});
 it('six-minute billing, editable draft, duplicate review and concession give A180 and B0',async()=>{
  work=await s.work(c,ja,120,{entityId:a,transactionType:'Time',quantity:1.2,unitCost:100,minutes:68});
  const charge=await s.work(c,ja,80,{entityId:a,detailedJobDescription:'A charge'});
  const duplicate=await s.work(c,ja,80,{entityId:a,detailedJobDescription:'A charge'});
  const flags=ok(await req('get',`/duplicates/1/1?customerId=${c.id}`)).duplicates;const flag=flags.find(f=>f.record_id===duplicate.transaction_id);
  expect(flag).to.exist;ok(await req('post',`/duplicates/${flag.duplicate_id}/resolve/1/1`,{action:'remove',reason:'Same work entered twice'},'admin'));
  const review=ok(await req('post','/duplicates/1/1',{kind:'transaction',recordId:charge.transaction_id,reason:'Review the surviving charge'})).duplicate;
  ok(await req('post',`/duplicates/${review.duplicate_id}/resolve/1/1`,{action:'dismiss',reason:'Valid charge retained'}));
  const before=await s.allState();ok(await s.post('/invoices/createInvoice/1/1',s.configuration([c],{entityId:a})));expect(await s.allState()).to.deep.equal(before);
  ok(await s.editWork(charge,{unitCost:100,totalTransaction:100}));ok(await s.editWork(charge,{unitCost:80,totalTransaction:80}));
  await s.writeoff(c,20,{entityId:a,selectedJobID:ja.customer_job_id});await check([[a,0,180,0,0],[b,0,0,0,0]]);
  firstA=await issue(a);await s.refused(()=>s.editWork(work,{unitCost:101,totalTransaction:121.2}),409,409,/locked/);
  await s.shift(45);frozen[0].row=await s.db('customer_invoices').where({customer_invoice_id:firstA.customer_invoice_id}).first();firstA=frozen[0].row;
  await check([[a,180,180,0,0],[b,0,0,0,0]]);
 });
 it('receives one250 check, holds70, transfers40 with source cash counted once',async()=>{
  retainer=await s.retainer(c,100,{entityId:b});receipt=await pay(a,250,'check');expect(receipt.applied).to.equal('180.00');expect(receipt.remainingCredit).to.equal('70.00');
  const input={customerId:c.id,sourceEntityId:a,destinationEntityId:b,creditId:receipt.credit.credit_id,amount:40,reason:'Client assigned part of the check to Advisory',ledgerFingerprint:(await open(a)).ledgerFingerprint};
  await s.db('users').where({user_id:3}).update({access_level:'manager'});await s.refused(()=>req('post','/credits/transfers',input,'staff'),403,403,/Unauthorized/);await s.db('users').where({user_id:3}).update({access_level:'Employee'});
  ok(await req('post','/credits/transfers',input,'admin'));expect(await s.db('payment_receipts').where({customer_id:c.id,source_kind:'manual'})).to.have.length(1);
  await check([[a,0,0,30,0],[b,0,0,40,100]]);
 });
 it('prepares recurring125 once with covered60 and retainer-funded excess40; B issues85',async()=>{
  ok(await req('post','/recurringCustomer/plans',{customerId:c.id,entityId:b,description:'Monthly Advisory services',amount:125,frequency:'monthly',billDay:Number(today().slice(8)),startDate:today(),endDate:today(),active:true,reason:'Client monthly agreement'}));
  const body={customerId:c.id,entityId:b,billingDate:today()},key=randomUUID();const prepared=ok(await req('post','/recurringCustomer/prepare',body,'sa',key));occurrence=prepared.plans[0].occurrences[0];
  const before=await s.allState();expect(ok(await req('post','/recurringCustomer/prepare',body,'sa',key))).to.deep.equal(prepared);expect(await s.allState()).to.deep.equal(before);
  await s.work(c,jb,60,{entityId:b,transactionType:'Time',quantity:0.6,unitCost:100,minutes:36,isTransactionBillable:false,isInAdditionToMonthlyCharge:false});
  await s.work(c,jb,40,{entityId:b,selectedRetainerID:retainer.retainer_id,isInAdditionToMonthlyCharge:true,detailedJobDescription:'Excess Advisory services'});
  await check([[a,0,0,30,0],[b,0,125,40,60]]);firstB=await issue(b);expect(Number(firstB.total_amount_due)).to.equal(85);await check([[a,0,0,30,0],[b,85,85,0,60]]);
  await s.refused(()=>req('patch',`/recurringCustomer/occurrences/${occurrence.occurrence_id}`,{amount:1,description:'Locked fee',reason:'Mistaken issued edit',expectedVersion:1}),409,409,/locked/);
 });
 it('retainer refund20 and noncash increase10 leave50 without reducing debt',async()=>{
  for(const [kind,amount,direction] of [['refund',20,'decrease'],['adjustment',10,'increase']])ok(await req('post',`/retainers/${retainer.retainer_id}/events/1/1`,{kind,amount,direction,date:today(),method:'cash',reference:'H7-retainer-refund',reason:'Reviewed unused funds '+kind},'admin'));
  await check([[a,0,0,30,0],[b,85,85,0,50]]);
 });
 it('paid-invoice memo20 and refund10 produce an optional10 credit statement',async()=>{
  memo=await creditMemo(firstA,a,20);await check([[a,-20,-20,30,0],[b,85,85,0,50]]);
  const st=await open(a),lot=st.credits.find(l=>l.kind==='statement_credit');ok(await req('post',`/credits/${lot.credit_id}/refunds`,{entityId:a,amount:10,date:today(),method:'cash',reason:'Return part of the overcharged service',ledgerFingerprint:st.ledgerFingerprint},'admin'));
  await check([[a,-10,-10,30,0],[b,85,85,0,50]]);
  const before=await s.allState(),skip=await s.finalize([c],{entityId:a,allowSameDayRebill:true});expect(skip.skippedCustomers[0].code).to.equal('CREDIT_NOT_SELECTED');expect(await s.allState()).to.deep.equal(before);
  const credit=await issue(a,{includeCreditStatement:true,issueReason:'Client requested credit evidence'});expect(Number(credit.total_amount_due)).to.equal(-10);
  expect(s.pdf(Object.values(frozen[frozen.length-1].files).find(f=>f.subarray(0,4).toString()==='%PDF'))).to.include('No payment due');
 });
 it('later A50 consumes10 statement credit and30 held credit once, leaving10',async()=>{
  await s.work(c,ja,50,{entityId:a,detailedJobDescription:'Later A work'});await check([[a,-10,40,30,0],[b,85,85,0,50]]);await issue(a);await check([[a,10,10,0,0],[b,85,85,0,50]]);
 });
 it('B memo15 then void/rebill170 preserves its80 funding and leaves90',async()=>{
  await creditMemo(firstB,b,15);await check([[a,10,10,0,0],[b,70,70,0,50]]);
  const body={entityId:b,replacementEntityId:b,reason:'Correct original Advisory price',date:today(),lines:[{description:'Corrected Advisory services',amount:170}]};
  const p=ok(await req('post',`/invoices/${firstB.customer_invoice_id}/void-rebill/preview`,body));expect(p.impact.replacementBalance).to.equal('90.00');
  const result=ok(await req('post',`/invoices/${firstB.customer_invoice_id}/void-rebill`,{...body,previewFingerprint:p.previewFingerprint},'admin'));expect(result.replacement.invoice_number).not.to.equal(firstB.invoice_number);await check([[a,10,10,0,0],[b,90,90,0,50]]);
 });
 it('analytics independently reconciles585 gross,380 net,290 collected,52 labor and328 margin',async()=>{
  await s.db('users').where({user_id:3}).update({cost_rate:90});
  const excluded=(await s.db('customers').where({account_id:1}).pluck('customer_id')).filter(id=>id!==c.id);
  const report=await require('../../src/endpoints/analytics/analytics-service').getBillingPerformance(s.db,1,{year:Number(today().slice(0,4)),excludeIds:excluded});
  expect(report.totals).to.include({gross_billed:585,prebill_concessions:20,credit_memos:35,voided_charges:150,net_billed:380,collected:290,gross_cash_received:350,cash_returned:30,labor_cost:52,margin:328,wip:0,recurring_fees:125,fixed_fees:295,retainer_use:40});
  const dir=path.resolve('docs/scenarios/evidence/pass5');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'combined-report.json'),JSON.stringify(report,null,2)+'\n');
  cutoff=(await s.db.raw(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') x`)).rows[0].x;
 });
 it('bounces the entire250 receipt across both businesses, keeping original age',async()=>{
  const id=receipt.receipt.receipt_id,load=()=>req('get',`/payments/receipts/${id}`).then(ok);
  let st=await load();ok(await req('post',`/payments/receipts/${id}/exceptions`,{condition:'bounced_check',reason:'Bank returned original check',ledgerFingerprint:st.ledgerFingerprint},'admin'));
  st=await load();ok(await req('post',`/payments/receipts/${id}/reversals`,{reason:'Restore the complete check and all transferred uses',ledgerFingerprint:st.ledgerFingerprint},'admin'));
  await check([[a,220,220,0,0],[b,130,130,0,50]]);
  const aging=ok(await req('get',`/accountsReceivable/aging/1/1?entityId=${a}&limit=500`)).arAging.customers.find(r=>r.customer_id===c.id);expect(aging.bucket_31_60).to.equal(180);expect(aging.bucket_0_30).to.equal(40);
  for(const [entity,balance] of [[a,10],[b,90]])expect((await open(entity,'&recordedThrough='+encodeURIComponent(cutoff))).billedCents).to.equal(balance*100);
  st=await load();ok(await req('post',`/payments/receipts/${id}/resolve`,{action:'roll_forward',reason:'Carry corrected balance into the next statement',ledgerFingerprint:st.ledgerFingerprint},'admin'));
 });
 it('wrong business refuses, new cash settles350, old evidence and Audit Record remain immutable',async()=>{
  const st=await open(a),other=await open(b);await s.refused(()=>req('post','/payments/receipts',{customerId:c.id,entityId:a,amount:1,date:today(),method:'cash',reason:'Wrong selected company invoice',ledgerFingerprint:st.ledgerFingerprint,allocations:[{obligationId:other.obligations[0].obligation_id,amount:1}]}),404,404,/client and business/);
  await pay(a,220);await pay(b,130);await check([[a,0,0,0,0],[b,0,0,0,50]]);
  for(const saved of frozen){expect(await s.db('customer_invoices').where({customer_invoice_id:saved.row.customer_invoice_id}).first()).to.deep.equal(saved.row);expect(await s.files(saved.row.invoice_file_location)).to.deep.equal(saved.files);}
  const history=ok(await req('get',`/auditRecord/customer/${c.id}/1/1`));expect(history.verification.valid).to.equal(true);expect(history.current.running_balance).to.equal(0);
  record=await req('post',`/auditRecord/customer/${c.id}/1/1/records`,{reason:'Complete two-business local lifecycle evidence'});expect(record.status).to.equal(201);
  const verified=ok(await req('get',`/auditRecord/customer/${c.id}/1/1/records/${record.body.record.record_id}/verify`));expect(verified.valid).to.equal(true);
  const generated=await s.db('audit_events').where({customer_id:c.id,entity:'recurring_charge_occurrences',action:'insert'});expect(generated.length).to.be.above(0);expect(generated.every(e=>e.actor_user_id===null && e.actor_name==='system')).to.equal(true);
  expect((await s.db.raw('SELECT ds2_verify_audit(1) v')).rows[0].v.valid).to.equal(true);
 });
});
