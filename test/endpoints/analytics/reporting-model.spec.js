'use strict';
const model=require('../../../src/endpoints/analytics/reporting-model');
const empty=()=>{const d={options:model.options({year:2025,asOf:'2025-12-31',recordedThrough:'2026-09-26T12:00:00Z'}),policy:{legacy_before:'2026-01-01'},accountId:1};for(const name of ['work','trackers','invoices','issues','payments','writeoffs','retainers','retainerEvents','transfers','obligations','applications','receipts','creditLots','creditEvents','receiptEvents','memos','memoReversals','voids','rebills','refunds','occurrences','estimates','legacyScopes','attributions','customers','users','jobs','descriptions','jobTypes','entities'])d[name]=[];return d;};
describe('H5 reporting identities and attribution',()=>{
 for(const created_at of ['2026-01-01T02:00:00.000','2026-01-01T02:00:00.000Z'])it(`includes an evening retainer on the Phoenix year-end date (${created_at})`,()=>{
  const d=empty(),base={account_id:1,customer_id:1,billing_entity_id:1,form_of_payment:'Cash'};
  d.retainers=[{...base,retainer_id:1,starting_amount:-100,created_at},{...base,retainer_id:2,starting_amount:-20,created_at:'2026-01-01T07:00:00Z'}];
  const prepared=model.prepare(d);expect(prepared.cashEvents.map(e=>e.date)).deep.eq(['2025-12-31','2026-01-01']);
  expect(model.report(prepared).totals.gross_cash_received).eq(100);
  expect(model.summarize(prepared,{year:2026,start:'2026-01-01',end:'2026-12-31',asOf:'2026-01-01'}).gross_cash_received).eq(20);
 });
 it('uses immutable historical worked-for attribution while retaining the default billed-by business',()=>{
  const d=empty();d.entities=[{billing_entity_id:1,name:'Tax'},{billing_entity_id:2,name:'Advisory'}];d.customers=[{customer_id:1,display_name:'Client'}];d.users=[{user_id:3,display_name:'Former staff',is_user_active:false,cost_rate:999}];
  d.invoices=[{customer_invoice_id:1,account_id:1,customer_id:1,billing_entity_id:1,invoice_date:'2025-05-01',invoice_file_location:'original.pdf',created_at:'2025-05-01',total_charges:180,total_write_offs:0}];
  d.work=[{transaction_id:1,account_id:1,customer_id:1,customer_invoice_id:1,logged_for_user_id:3,transaction_type:'Time',transaction_date:'2025-04-01',quantity:2,unit_cost:100,total_transaction:200,is_transaction_billable:true}];
  d.legacyScopes=[{table_name:'customer_transactions',record_id:1,billing_entity_id:1,reporting_entity_id:2,reporting_basis:'legacy attribution: tracker entity'}];
  d.estimates=[{table_name:'customer_transactions',record_id:1,actual_duration_minutes:120,duration_source:'tracker actual',cost_rate_snapshot:30,cost_rate_source:'estimated',standard_value_snapshot:200}];
  const before=JSON.stringify(d.work),p=model.prepare(d),all=model.report(p);expect(JSON.stringify(p.work[0].billing_entity_id)).to.equal('1');expect(all.totals).to.include({work_entered_value:200,net_billed:180,labor_cost:60,cost_status:'estimated',margin:120});expect(all.attribution[0]).to.include({worked_for:'Advisory',billed_by:'Tax',net_billed:180,attribution_basis:'legacy attribution: tracker entity'});
  expect(model.summarize(p,{entityId:2})).to.include({work_entered_value:200,net_billed:0});expect(model.summarize(p,{entityId:1})).to.include({work_entered_value:0,net_billed:180});expect(before).not.to.include('999');
 });
 it('does not guess a business for ambiguous legacy work',()=>{const d=empty();d.work=[{transaction_id:1,customer_id:1,transaction_type:'Time',transaction_date:'2025-04-01',quantity:1,unit_cost:100,total_transaction:100,is_transaction_billable:true}];d.legacyScopes=[{table_name:'customer_transactions',record_id:1,billing_entity_id:1,reporting_entity_id:null,reporting_basis:'unattributed legacy work'}];const r=model.report(model.prepare(d));expect(r.unattributed_legacy_work).to.deep.equal({value:100,hours:1});expect(r.work[0].worked_for).to.equal('Unattributed legacy work');});
 it('allocates cents exactly, including negative corrections and zero weights',()=>{expect(model.allocate(100,[1,1,1])).to.deep.equal([33,33,34]);expect(model.allocate(-100,[1,1,1])).to.deep.equal([-33,-33,-34]);expect(model.allocate(100,[0,0])).to.deep.equal([100,0]);});
 it('does not count balance-forward statements or draft invoice rows as another bill',()=>{const d=empty();d.invoices=[{customer_invoice_id:1,customer_id:1,billing_entity_id:1,created_at:'2025-01-01',invoice_date:'2025-01-01',invoice_file_location:'sent.pdf',total_charges:100,beginning_balance:900,total_amount_due:1000},{customer_invoice_id:2,customer_id:1,billing_entity_id:1,created_at:'2025-02-01',invoice_date:'2025-02-01',total_charges:500},{customer_invoice_id:3,parent_invoice_id:1,customer_id:1,billing_entity_id:1,created_at:'2025-03-01',invoice_date:'2025-03-01',invoice_file_location:'sent.pdf',total_charges:100}];expect(model.report(model.prepare(d)).totals).to.include({gross_billed:100,issued_statements:1});});
 it('keeps cash deposits, mixed retainer draws, reversals, transfers and refunds distinct',()=>{
  const d=empty(),base={account_id:1,customer_id:1,billing_entity_id:1};d.invoices=[{...base,customer_invoice_id:1,created_at:'2025-01-01',invoice_date:'2025-01-01',invoice_file_location:'sent.pdf',total_charges:200}];
  d.retainers=[{...base,retainer_id:1,starting_amount:-100,form_of_payment:'check',created_at:'2025-02-01'},{...base,retainer_id:2,starting_amount:-50,form_of_payment:'Transfer',created_at:'2025-04-01'}];
  d.retainerEvents=[{...base,event_id:1,root_retainer_id:1,kind:'adjustment',amount:50,balance_delta:-50,event_date:'2025-02-02',created_at:'2025-02-02'},{...base,event_id:2,root_retainer_id:1,kind:'refund',amount:25,balance_delta:25,event_date:'2025-05-01',created_at:'2025-05-01'}];
  d.payments=[{...base,payment_id:1,retainer_id:1,customer_invoice_id:1,payment_amount:-150,payment_date:'2025-03-01',created_at:'2025-03-01',form_of_payment:'Retainer'},{...base,payment_id:2,retainer_id:1,customer_invoice_id:1,payment_amount:150,payment_date:'2025-03-02',created_at:'2025-03-02',note:'[reversal of payment #1] mistaken draw',form_of_payment:'Retainer'},{...base,payment_id:3,retainer_id:2,customer_invoice_id:1,payment_amount:-50,payment_date:'2025-04-02',created_at:'2025-04-02',form_of_payment:'Retainer'}];
  d.transfers=[{...base,transfer_id:1,source_retainer_id:1,destination_retainer_id:2,amount:50,created_at:'2025-04-01'}];
  const p=model.prepare(d),r=model.report(p);expect(r.totals.gross_cash_received).to.equal(100);expect(r.totals.cash_returned).to.equal(25);expect(r.totals.collected).to.equal(33.33);expect(r.totals.noncash_applications).to.equal(16.67);expect(p.collectionEvents.slice(0,2).map(e=>e.cash)).to.deep.equal([10000,-10000]);
 });
 it('held receipt money only becomes collected when applied, while a memo credit is noncash',()=>{
  const d=empty(),base={account_id:1,customer_id:1,billing_entity_id:1};d.receipts=[{...base,receipt_id:1,source_kind:'manual',amount:100,receipt_date:'2025-01-01'}];d.creditLots=[{...base,credit_id:1,kind:'held_receipt',amount:100,effective_date:'2025-01-01'},{...base,credit_id:2,kind:'statement_credit',amount:20,effective_date:'2025-01-01'}];d.applications=[{...base,application_id:1,credit_id:1,direction:1,amount:60,effective_date:'2025-02-01'},{...base,application_id:2,credit_id:2,direction:1,amount:20,effective_date:'2025-02-01'}];d.creditEvents=[{...base,credit_id:1,direction:-1,amount:60,effective_date:'2025-02-01'},{...base,credit_id:2,direction:-1,amount:20,effective_date:'2025-02-01'}];expect(model.report(model.prepare(d)).totals).to.include({gross_cash_received:100,collected:60,noncash_applications:20,held_receipt_credit:40,statement_credit:0});
 });
 it('allocates recurring fees to covered effort once with the actual-hour cost snapshot',()=>{
  const d=empty(),base={account_id:1,customer_id:1,billing_entity_id:1};d.invoices=[{...base,customer_invoice_id:1,created_at:'2025-01-01',invoice_date:'2025-02-01',invoice_file_location:'sent.pdf',total_charges:300}];d.work=[{...base,transaction_id:1,customer_invoice_id:1,transaction_type:'Charge',transaction_date:'2025-02-01',quantity:1,unit_cost:300,total_transaction:300,is_transaction_billable:true},{...base,transaction_id:2,transaction_type:'Time',transaction_date:'2025-01-15',quantity:2,unit_cost:100,total_transaction:200,is_transaction_billable:false,is_excess_to_subscription:false,cost_rate_snapshot:30,cost_rate_source:'recorded',cost_snapshot_at:'2025-01-15',actual_duration_minutes:120,duration_source:'tracker actual'}];d.occurrences=[{transaction_id:1,period_start:'2025-01-01',period_end:'2025-01-31'}];const r=model.report(model.prepare(d));expect(r.totals).to.include({net_billed:300,cohort_standard_value:200,recurring_fees:300,covered_hours:2,labor_cost:60,margin:240,billing_realization_pct:150});expect(r.attribution.reduce((n,a)=>n+a.net_billed,0)).to.equal(300);expect(r.attribution.find(a=>a.work_id===2).net_billed).to.equal(300);
 });
 it('raw and held tracker reports keep worked-for attribution separate from legacy billing scope',async()=>{
  const d=empty();d.entities=[{billing_entity_id:1,name:'Tax'},{billing_entity_id:2,name:'Advisory'}];
  d.trackers=[{timesheet_entry_id:1,billing_entity_id:1,date:'2025-03-01',duration:120,category:'Accounting',is_processed:false,is_deleted:false},{timesheet_entry_id:2,billing_entity_id:1,date:'2025-04-01',duration:60,category:'Accounting',is_processed:false,is_deleted:false}];
  d.legacyScopes=d.trackers.map(t=>({table_name:'timesheet_entries',record_id:t.timesheet_entry_id,billing_entity_id:1,reporting_entity_id:2,reporting_basis:'legacy attribution: tracker entity'}));
  d.options=model.options({year:2025,entityId:2,asOf:'2025-03-31'});const prepared=model.prepare(d);
  expect(prepared.trackers[0]).to.include({billing_entity_id:1,worked_for_entity_id:2});
  const original=model.load;try{model.load=async()=>prepared;const result=await require('../../../src/endpoints/analytics/analytics-service').getTimeAllocation(null,1,{year:2025});expect(result.trackerByCategory).to.deep.equal([{category:'Accounting',hours:2,entries:1}]);expect(result.summary.held_hours).to.equal(2);}finally{model.load=original;}
 });
 it('capacity obeys the as-of boundary while retaining inactive employees',async()=>{
  const d=empty();d.options=model.options({year:2025,asOf:'2025-03-31'});d.work=[{transaction_id:1,logged_for_user_id:3,transaction_type:'Time',transaction_date:'2025-03-01',quantity:2},{transaction_id:2,logged_for_user_id:3,transaction_type:'Time',transaction_date:'2025-04-01',quantity:1}];d.users=[{user_id:3,display_name:'Former staff',is_user_active:false}];const prepared=model.prepare(d),original=model.load;
  try{model.load=async()=>prepared;const result=await require('../../../src/endpoints/analytics/analytics-service').getTaxSeasonCapacity(null,1,{year:2025});expect(result.current).to.have.length(1);expect(result.current[0]).to.include({hours:2,is_active:false,user_id:3});}finally{model.load=original;}
 });

 it('preserves the cash share of mixed retainer funding through two rebills and partial reapplication',()=>{
  const d=empty(),base={account_id:1,customer_id:1,billing_entity_id:1};
  d.invoices=[1,2,3].map(n=>({...base,customer_invoice_id:n,created_at:'2025-03-01',invoice_date:'2025-03-01',invoice_file_location:`sent${n}.pdf`,total_charges:150}));
  d.retainers=[{...base,retainer_id:1,starting_amount:-100,created_at:'2025-01-01',form_of_payment:'check'}];
  d.retainerEvents=[{...base,event_id:1,root_retainer_id:1,kind:'adjustment',amount:50,balance_delta:-50,event_date:'2025-01-02',created_at:'2025-01-02'}];
  d.payments=[{...base,payment_id:1,retainer_id:1,customer_invoice_id:1,payment_amount:-150,payment_date:'2025-02-01',created_at:'2025-02-01',form_of_payment:'Retainer'}];
  d.obligations=[1,2,3].map(n=>({...base,obligation_id:n,original_invoice_id:n,amount:150}));
  d.creditLots=[{...base,credit_id:1,kind:'statement_credit',amount:150,effective_date:'2025-03-02',source_key:'rebill/1/application/1'},{...base,credit_id:2,kind:'statement_credit',amount:60,effective_date:'2025-03-03',source_key:'rebill/2/application/3'}];
  d.applications=[
   {...base,application_id:1,obligation_id:1,amount:150,direction:1,compatibility_payment_id:1,source_kind:'retainer_draw',effective_date:'2025-03-01'},
   {...base,application_id:2,obligation_id:1,amount:150,direction:-1,reversal_of:1,source_kind:'reversal',effective_date:'2025-03-02'},
   {...base,application_id:3,obligation_id:2,amount:60,direction:1,credit_id:1,source_kind:'statement_credit',effective_date:'2025-03-02'},
   {...base,application_id:4,obligation_id:2,amount:60,direction:-1,reversal_of:3,source_kind:'reversal',effective_date:'2025-03-03'},
   {...base,application_id:5,obligation_id:3,amount:60,direction:1,credit_id:2,source_kind:'statement_credit',effective_date:'2025-03-03'}
  ];
  const partial=JSON.parse(JSON.stringify(d));partial.applications[2].amount=0.01;partial.applications[3].amount=0.01;partial.applications[4].amount=0.01;partial.applications[4].credit_id=1;
  const p=model.prepare(d);expect(p.collectionEvents.map(e=>e.cash)).to.deep.equal([10000,-10000,4000,-4000,4000]);
  expect(model.report(p).totals).to.include({gross_cash_received:100,collected:40,noncash_applications:20,retainer_use:60});
  expect(model.report(model.prepare(partial)).totals).to.include({collected:0.01,retainer_use:0.01});
 });
 it('counts a recurring fee and its covered effort once in the surviving replacement cohort',()=>{
  const d=empty(),base={account_id:1,customer_id:1,billing_entity_id:1};
  d.invoices=[1,2].map(n=>({...base,customer_invoice_id:n,created_at:`2025-02-0${n}`,invoice_date:`2025-02-0${n}`,invoice_file_location:`sent${n}.pdf`,total_charges:n===1?300:320}));
  d.work=[{...base,transaction_id:1,customer_invoice_id:1,transaction_type:'Charge',transaction_date:'2025-02-01',quantity:1,unit_cost:300,total_transaction:300,is_transaction_billable:true},{...base,transaction_id:2,transaction_type:'Time',transaction_date:'2025-01-15',quantity:2,unit_cost:100,total_transaction:200,is_transaction_billable:false,is_excess_to_subscription:false,cost_rate_snapshot:30,cost_rate_source:'recorded',cost_snapshot_at:'2025-01-15',actual_duration_minutes:120,duration_source:'tracker actual'}];
  d.occurrences=[{transaction_id:1,period_start:'2025-01-01',period_end:'2025-01-31'}];
  d.voids=[{...base,void_id:1,original_invoice_id:1,amount:300,effective_date:'2025-02-02'}];d.rebills=[{...base,original_invoice_id:1,replacement_invoice_id:2,lines:[{amount:320,description:'Corrected recurring fee'}]}];
  d.issues=[{...base,invoice_id:2,issued_at:'2025-02-02',payload:{transactions:{allTransactionRecords:[{is_transaction_billable:true,total_transaction:320}]}}}];
  expect(model.report(model.prepare(d)).totals).to.include({net_billed:320,recurring_fees:300,fixed_fees:300,labor_cost:60,cohort_hours:2});
 });

});
