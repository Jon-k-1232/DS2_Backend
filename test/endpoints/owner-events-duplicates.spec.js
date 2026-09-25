const {matches}=require('../../src/endpoints/duplicates/duplicates-service');
const {validate}=require('../../src/endpoints/retainer/retainer-events');
const {groupAndTotalRetainers}=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations');
describe('owner duplicate matching controls',()=>{
 const base={account_id:1,customer_id:2,payment_id:1,payment_amount:-10,payment_date:'2026-09-25',payment_reference_number:'Abc  1',form_of_payment:'Check'};
 it('matches normalized reference/method and the inclusive three-day window',()=>{expect(matches('payment',base,{...base,payment_id:2,payment_date:'2026-09-28',payment_reference_number:' abc 1 ',form_of_payment:'check'})).to.equal(true);});
 for(const [name,patch] of [['amount',{payment_amount:-11}],['date',{payment_date:'2026-09-29'}],['customer',{customer_id:3}],['account',{account_id:3}],['blank reference',{payment_reference_number:''}],['different reference',{payment_reference_number:'abc2'}],['method',{form_of_payment:'Cash'}],['same row',{payment_id:1}],['retainer funded',{retainer_id:9}],['reversal',{payment_amount:10}],['import',{note:'[pending_payment:7]'}]])it(`does not match ${name}`,()=>{expect(Boolean(matches('payment',base,{...base,payment_id:2,...patch}))).to.equal(false);});
 it('requires a work description and preserves job, rate and staff distinctions',()=>{
  const a={account_id:1,customer_id:1,transaction_id:1,total_transaction:10,transaction_date:'2026-09-25',transaction_type:'Charge',quantity:1,unit_cost:10,is_transaction_billable:true,customer_job_id:1,logged_for_user_id:1,general_work_description_id:1,detailed_work_description:'Payroll review'};
  expect(matches('transaction',a,{...a,transaction_id:2})).to.equal(true);
  for(const patch of [{customer_job_id:2},{logged_for_user_id:2},{general_work_description_id:2},{quantity:2},{unit_cost:20},{is_transaction_billable:false},{detailed_work_description:''},{transaction_type:'Time'}])expect(Boolean(matches('transaction',a,{...a,transaction_id:2,...patch}))).to.equal(false);
 });
 it('matches retainer names only when neither reference is set; excludes snapshots and excess',()=>{
  const a={account_id:1,customer_id:1,retainer_id:1,starting_amount:-10,created_at:'2026-09-25',type_of_hold:'Retainer',display_name:'Tax fund'};
  expect(matches('retainer',a,{...a,retainer_id:2,display_name:' tax fund '})).to.equal(true);
  for(const patch of [{parent_retainer_id:1},{display_name:''},{payment_reference_number:'REF'},{note:'overpayment excess'}])expect(Boolean(matches('retainer',a,{...a,retainer_id:2,...patch}))).to.equal(false);
 });
 it('requires matching writeoff reason and job',()=>{
  const a={account_id:1,customer_id:1,writeoff_id:1,writeoff_amount:-10,writeoff_date:'2026-09-25',transaction_type:'WriteOff',customer_job_id:1,writeoff_reason:'Courtesy'};
  expect(matches('writeoff',a,{...a,writeoff_id:2,writeoff_reason:'courtesy'})).to.equal(true);
  for(const patch of [{writeoff_reason:''},{writeoff_reason:'Other'},{customer_job_id:2}])expect(Boolean(matches('writeoff',a,{...a,writeoff_id:2,...patch}))).to.equal(false);
 });
});
describe('retainer event statement contract',()=>{
 it('keeps pending full-refund events even when no current credit remains',()=>{
  const event={kind:'refund',amount:10,available_after:0};const query={customerRetainers:{1:[{retainer_id:1,current_amount:0,is_retainer_active:false}]},customerRetainerEvents:{1:[event]}};
  expect(groupAndTotalRetainers(1,query,false)).to.deep.equal({retainerTotal:0,retainerRecords:[],events:[event]});
  expect(groupAndTotalRetainers(1,query,true)).to.deep.equal({retainerTotal:0,retainerRecords:[],events:[]});
 });
 it('accepts exact cents and trims evidence, with increase/decrease distinct from refund',()=>{
  expect(validate({kind:'adjustment',direction:'increase',amount:'0.01',date:'2024-02-29',reason:' Correction '}).reason).to.equal('Correction');
  expect(validate({kind:'refund',amount:1,date:'2026-09-25',reason:'return',method:' Check ',reference:' REF '}).direction).to.equal('decrease');
 });
});
