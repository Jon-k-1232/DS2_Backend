'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {randomUUID}=require('crypto');
const {today}=require('./_scenario');
const service=require('../../src/endpoints/analytics/analytics-service');
const fs=require('fs'),path=require('path');
describe('H5 honest analytics hand-computed scenarios',function(){
 this.timeout(180000);let s,e,c,j,w,invoice,receipt,cutoff;
 const req=(m,url,b)=>{const r=s.request[m](url).set('Authorization','Bearer '+s.token()).set('Idempotency-Key',randomUUID());return b===undefined?r:r.send(b);};
 const state=client=>req('get',`/payments/open-obligations?customerId=${client.id}&entityId=${e}`).then(ok);
 const report=async(client=c,options={})=>{const all=await s.db('customers').where({account_id:1}).pluck('customer_id');return service.getBillingPerformance(s.db,1,{year:Number(today().slice(0,4)),entityId:e,excludeIds:all.filter(i=>i!==client.id),...options});};
 const tracker=async(minutes=120)=>{const user=await s.db('users').where({user_id:3}).first();return (await s.db('timesheet_entries').insert({account_id:1,user_id:1,notes:'H5 synthetic source',category:'Accounting',timesheet_name:'H5-'+randomUUID(),time_tracker_start_date:today(),time_tracker_end_date:today(),employee_name:user.display_name,matched_user_id:3,date:today(),duration:minutes,entity:'Scenario',billing_entity_id:e,is_processed:false,is_deleted:false}).returning('*'))[0];};
 before(async()=>{s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;await s.db('users').where({user_id:3}).update({cost_rate:30});c=await s.customer('H5 hand oracle');j=await s.job(c);});
 after(async()=>{if(s)await s.close();});
 it('records 120 actual minutes at30, standard200; draft bills zero and retains WIP200',async()=>{
  const t=await tracker();w=await s.work(c,j,200,{entityId:e,transactionType:'Time',quantity:2,unitCost:100,timesheetEntryID:t.timesheet_entry_id});
  expect(Number(w.cost_rate_snapshot)).to.equal(30);expect(w.cost_rate_source).to.equal('recorded');expect(Number(w.actual_duration_minutes)).to.equal(120);
  await s.preview(c);const r=await report();expect(r.totals.gross_billed).to.equal(0);expect(r.totals.wip).to.equal(200);expect(r.totals.work_entered_hours).to.equal(2);expect(r.totals.held_work_hours).to.equal(0);
 });
 it('prebill concession20 issues180; realization90%, cost60, margin120 /66.67%',async()=>{
  await s.writeoff(c,20,{entityId:e,selectedJobID:j.customer_job_id});await s.finalize([c],{entityId:e});invoice=await s.db('customer_invoices').where({customer_id:c.id}).whereNull('parent_invoice_id').first();
  const r=await report();expect(r.totals).to.include({gross_billed:200,prebill_concessions:20,net_billed:180,cohort_standard_value:200,billing_realization_pct:90,labor_cost:60,margin:120,margin_pct:66.67,cost_status:'recorded',wip:0});
  cutoff=(await s.db.raw("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') x")).rows[0].x;
 });
 it('rate50 only affects new WIP100; original cost remains60 after inactive staff change',async()=>{
  await s.db('users').where({user_id:3}).update({cost_rate:50});const unbilled=await s.work(c,j,100,{entityId:e,transactionType:'Time',quantity:1,unitCost:100});expect(Number(unbilled.cost_rate_snapshot)).to.equal(50);
  await s.db('users').where({user_id:3}).update({is_user_active:false});
  const r=await report();expect(r.totals).to.include({work_entered_value:300,wip:100,net_billed:180,labor_cost:60,margin:120});expect(r.work.every(w=>w.staff_active===false)).to.equal(true);
  expect((await report(c,{recordedThrough:cutoff})).totals).to.include({work_entered_value:200,wip:0,net_billed:180});await s.db('users').where({user_id:3}).update({is_user_active:true});
 });
 it('partial receipt120, bad debt10 and memo20 give billed160, collected120, realization80%, margin100',async()=>{
  let st=await state(c);receipt=ok(await req('post','/payments/receipts',{customerId:c.id,entityId:e,amount:120,date:today(),method:'check',reference:'H5 single receipt',ledgerFingerprint:st.ledgerFingerprint,allocations:[{obligationId:st.obligations[0].obligation_id,amount:120}]}));
  await s.writeoff(c,10,{entityId:e,customerInvoiceID:invoice.customer_invoice_id});
  const p=ok(await req('get',`/invoices/${invoice.customer_invoice_id}/corrections`));ok(await req('post',`/invoices/${invoice.customer_invoice_id}/credit-memos`,{entityId:e,amount:20,reason:'Owner-authorized price correction',date:today(),allowCreditExcess:true,ledgerFingerprint:p.ledgerFingerprint}));
  const r=await report();expect(r.totals).to.include({gross_billed:200,prebill_concessions:20,credit_memos:20,net_billed:160,collected:120,gross_cash_received:120,writeoffs:10,billing_realization_pct:80,collection_realization_pct:80,labor_cost:60,margin:100,margin_pct:62.5,wip:100});
  await s.check(c,{n:130,b:30,r:0});expect((await report(c,{recordedThrough:cutoff})).totals).to.include({net_billed:180,collected:0,writeoffs:0,credit_memos:0});
 });
 it('CSV and PDF carry the same figures, cutoffs, estimates and attribution',async()=>{
  const r=await report(),exp=require('../../src/endpoints/analytics/reporting-export');const csv=exp.performanceCsv(r).join('\n');expect(csv).to.include('Net billed by effective date,160').and.to.include('Applied receipts net of reversals,120').and.to.include('Worked for / billed by attribution');
  const pdf=await exp.performancePdf(r);expect(s.pdf(pdf)).to.include('Billing performance').and.to.include('160');
  const dir=path.resolve('docs/decisions/evidence/run-H5');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'oracle-report.json'),JSON.stringify(r,null,2));fs.writeFileSync(path.join(dir,'oracle-report.csv'),csv);fs.writeFileSync(path.join(dir,'oracle-report.pdf'),pdf);
 });
 it('held tracker captures rate before processing; later rate edit and source copying cannot change it',async()=>{
  const client=await s.customer('H5 held work'),job=await s.job(client);await s.db('users').where({user_id:3}).update({cost_rate:30});const t=await tracker(68);await s.db('timesheet_entries').where({timesheet_entry_id:t.timesheet_entry_id}).update({suggested_customer_id:client.id,hold_reason:'Review work'});await s.db('users').where({user_id:3}).update({cost_rate:70});
  const entry=await s.work(client,job,120,{entityId:e,transactionType:'Time',quantity:1.2,unitCost:100,timesheetEntryID:t.timesheet_entry_id});expect(Number(entry.cost_rate_snapshot)).to.equal(30);expect(Number(entry.actual_duration_minutes)).to.equal(68);await s.finalize([client],{entityId:e});const r=await report(client);expect(r.totals.labor_cost).to.equal(34);expect(r.totals.work_entered_hours).to.equal(1.13);expect(r.totals.held_work_hours).to.equal(0);
 });
 it('duration edit retains captured rate; reassignment requires a reason and captures the selected employee',async()=>{
  const client=await s.customer('H5 edited effort'),job=await s.job(client);await s.db('users').where({user_id:3}).update({cost_rate:30});const entry=await s.work(client,job,100,{entityId:e,transactionType:'Time',quantity:1,unitCost:100});await s.db('users').where({user_id:3}).update({cost_rate:70});
  ok(await s.editWork(entry,{quantity:2,totalTransaction:200}));let row=await s.db('customer_transactions').where({transaction_id:entry.transaction_id}).first();expect(Number(row.cost_rate_snapshot)).to.equal(30);
  await s.refused(()=>s.editWork(entry,{loggedForUserID:2}),400,400,/Explain the employee change/);
  await s.db('users').where({user_id:2}).update({cost_rate:40});ok(await s.editWork(entry,{loggedForUserID:2,costChangeReason:'Correct employee assignment'}));row=await s.db('customer_transactions').where({transaction_id:entry.transaction_id}).first();expect(Number(row.cost_rate_snapshot)).to.equal(40);
  const event=await s.db('audit_events').where({entity:'customer_transactions',entity_id:String(entry.transaction_id),action:'update'}).orderBy('event_id','desc').first();expect(event.reason).to.equal('Correct employee assignment');expect(event.actor_user_id).to.equal(1);
 });
 for(const path of ['held review','manual move']) it(`${path} audits corrected staff and actual minutes; missing reason and database failure write nothing`,async()=>{
  const client=await s.customer('H5 corrected '+path),job=await s.job(client);await s.db('users').where({user_id:3}).update({cost_rate:30});await s.db('users').where({user_id:2}).update({cost_rate:40});const t=await tracker(120);
  const send=reason=>path==='held review'?s.put(`/billing-review/${t.timesheet_entry_id}/1/1`,{customer_id:client.id,customer_job_id:job.customer_job_id,general_work_description_id:1,transaction_date:today(),logged_for_user_id:2,transaction_type:'Time',duration_minutes:90,unit_cost:100,costChangeReason:reason}):s.post('/timesheets/moveToTransactions/1/1',{entry:{...s.transaction(client,job,150),timesheetEntryID:t.timesheet_entry_id,entityId:e,loggedForUserID:2,transactionType:'Time',quantity:1.5,unitCost:100,minutes:90,costChangeReason:reason}});
  await s.refused(()=>send(''),400,undefined,/Explain the employee change/);
  await s.queryFault(/insert into .*customer_transactions/i,()=>s.refused(()=>send('Correct source employee'),500,undefined,/fail|could not|error/i));
  ok(await send('Correct source employee'));const row=await s.db('customer_transactions').where({source_timesheet_entry_id:t.timesheet_entry_id}).first();expect(Number(row.cost_rate_snapshot)).to.equal(40);expect(Number(row.actual_duration_minutes)).to.equal(90);
  const audit=await s.db('audit_events').where({entity:'timesheet_entries',entity_id:String(t.timesheet_entry_id),action:'update'}).orderBy('event_id','desc').first();expect(audit.actor_user_id).to.equal(1);expect(audit.reason).to.equal('Correct source employee');
  await s.finalize([client],{entityId:e});expect((await report(client)).totals.labor_cost).to.equal(60);
  await s.refused(()=>send('Repeated correction'),path==='held review'?404:409,undefined,/already|found/i);
 });
 it('AI rerun validates and audits staff and minute corrections before resetting held state',async()=>{
  const client=await s.customer('H5 rerun correction'),job=await s.job(client),t=await tracker();await s.db('users').where({user_id:2}).update({cost_rate:40,billing_rate:100});
  const flag=process.env.TIME_TRACKER_AI_FEATURE_FLAG;process.env.TIME_TRACKER_AI_FEATURE_FLAG='on';
  const url=`/billing-review/reprocess-with-overrides/${t.timesheet_entry_id}/1/1`,overrides={customer_id:client.id,customer_job_id:job.customer_job_id,general_work_description_id:1,logged_for_user_id:2,duration_minutes:90};
  try{
   await s.refused(()=>s.post(url,{overrides}),400,undefined,/Explain the employee change/);
   await s.refused(()=>s.post(url,{overrides:{...overrides,logged_for_user_id:2147483646,costChangeReason:'Correction'}}),400,undefined,/Employee must belong/);
   await s.refused(()=>s.post(url,{overrides:{...overrides,duration_minutes:-1,costChangeReason:'Correction'}}),400,undefined,/Duration/);
   const response=ok(await s.post(url,{overrides:{...overrides,costChangeReason:'Correct source employee'}}));expect(response.decision).to.equal('auto_insert');
   const row=await s.db('customer_transactions').where({source_timesheet_entry_id:t.timesheet_entry_id}).first();expect(Number(row.actual_duration_minutes)).to.equal(90);expect(Number(row.cost_rate_snapshot)).to.equal(40);
   await s.refused(()=>s.post(url,{overrides:{...overrides,costChangeReason:'Repeated'}}),409,undefined,/already applied/);
  }finally{if(flag===undefined)delete process.env.TIME_TRACKER_AI_FEATURE_FLAG;else process.env.TIME_TRACKER_AI_FEATURE_FLAG=flag;}
 });
 it('manual actual minutes survive rounded billing and a description-only edit',async()=>{const client=await s.customer('H5 actual manual'),job=await s.job(client);await s.db('users').where({user_id:3}).update({cost_rate:30});const row=await s.work(client,job,120,{entityId:e,transactionType:'Time',quantity:1.2,unitCost:100,minutes:68});expect(Number(row.actual_duration_minutes)).to.equal(68);expect(row.duration_source).to.equal('entered actual');ok(await s.editWork(row,{detailedJobDescription:'Description only'}));await s.finalize([client],{entityId:e});expect((await report(client)).totals.labor_cost).to.equal(34);});
 it('unknown costs stay unknown after rates are entered; margin is N/A rather than false zero cost',async()=>{
  const client=await s.customer('H5 unknown cost'),job=await s.job(client);await s.db('users').where({user_id:3}).update({cost_rate:null});await s.work(client,job,100,{entityId:e,transactionType:'Time',quantity:1,unitCost:100});await s.finalize([client],{entityId:e});await s.db('users').where({user_id:3}).update({cost_rate:30});const r=await report(client);expect(r.totals).to.include({unknown_cost_count:1,labor_cost:null,margin:null,margin_pct:null,unknown_cost_standard_value:100});
 });
 it('legacy rate estimate never follows later staff edits; tracker entity is reporting only',async()=>{
  const client=await s.customer('H5 legacy'),job=await s.job(client);const row=await s.work(client,job,100,{entityId:e,transactionType:'Time',quantity:1,unitCost:100});
  // Disposable synthetic fixture represents a pre-H5 row, without changing an issued record.
  await s.db.transaction(async trx=>{await trx.raw('SET LOCAL session_replication_role=replica');await trx('customer_transactions').where({transaction_id:row.transaction_id}).update({cost_rate_snapshot:null,cost_rate_source:null,cost_snapshot_at:null,actual_duration_minutes:null,duration_source:null,billing_rate_snapshot:null,standard_value_snapshot:null});});
  await s.db.transaction(async trx=>{await trx.raw(fs.readFileSync('migrations/045.work_cost_snapshots.sql','utf8'));await trx.raw(fs.readFileSync('migrations/046.reviewed_work_cost_snapshots.sql','utf8'));});
  await s.db('users').where({user_id:3}).update({cost_rate:80});await s.finalize([client],{entityId:e});const r=await report(client);expect(r.totals.cost_status).to.equal('estimated');expect(r.totals.labor_cost).to.equal(30);
 });
 it('empty period and existing business without activity return zeros and N/A rates',async()=>{
  const r=await report(c,{start:'1999-01-01',end:'1999-12-31',asOf:'1999-12-31'});expect(r.totals.net_billed).to.equal(0);expect(r.totals.billing_realization_pct).to.equal(null);expect(r.totals.collection_realization_pct).to.equal(null);
  const entity=ok(await req('post','/billing-entities',{name:'H5 unused business',legal_name:'H5 unused business',invoice_prefix:'HFIVE',reason:'Reporting isolation fixture'})).entity;const empty=await report(c,{entityId:entity.billing_entity_id});expect(empty.totals.net_billed).to.equal(0);expect(empty.work).to.have.length(0);
 });
 it('void/rebill reuses effort once and preserves cash applications without a second receipt',async()=>{
  const client=await s.customer('H5 rebill'),job=await s.job(client);await s.db('users').where({user_id:3}).update({cost_rate:30});const tr=await tracker();const entry=await s.work(client,job,200,{entityId:e,transactionType:'Time',quantity:2,unitCost:100,timesheetEntryID:tr.timesheet_entry_id});await s.finalize([client],{entityId:e});const i=await s.db('customer_invoices').where({customer_id:client.id}).whereNull('parent_invoice_id').first();
  const st=await state(client);ok(await req('post','/payments/receipts',{customerId:client.id,entityId:e,amount:100,date:today(),method:'cash',ledgerFingerprint:st.ledgerFingerprint,allocations:[{obligationId:st.obligations[0].obligation_id,amount:100}]}));
  const body={entityId:e,replacementEntityId:e,reason:'Reprice original effort',date:today(),lines:[{description:'Original effort repriced',amount:240,originalTransactionId:entry.transaction_id}]};const p=ok(await req('post',`/invoices/${i.customer_invoice_id}/void-rebill/preview`,body));ok(await req('post',`/invoices/${i.customer_invoice_id}/void-rebill`,{...body,previewFingerprint:p.previewFingerprint}));
  const r=await report(client);expect(r.totals).to.include({gross_billed:440,voided_charges:200,net_billed:240,collected:100,gross_cash_received:100,labor_cost:60,margin:180,work_entered_hours:2,cohort_standard_value:200});
 });
 it('all newly audited estimate and work events keep a valid append-only chain',async()=>{expect((await s.db.raw('SELECT ds2_verify_audit(1) v')).rows[0].v.valid).to.equal(true);});
 it('tracker source cannot be reused, moved to another employee or stolen from another account',async()=>{
  const client=await s.customer('H5 source mistakes'),job=await s.job(client),t=await tracker();
  const work=await s.work(client,job,100,{entityId:e,transactionType:'Time',quantity:1,unitCost:100,timesheetEntryID:t.timesheet_entry_id});
  await s.refused(()=>s.post('/transactions/createTransaction/1/1',{transaction:work.payload}),200,500,/already been posted/);
  const next=await tracker();await s.refused(()=>s.post('/transactions/createTransaction/1/1',{transaction:{...work.payload,timesheetEntryID:next.timesheet_entry_id,loggedForUserID:2}}),200,500,/employee must match/);
  const named=await tracker();await s.db('timesheet_entries').where({timesheet_entry_id:named.timesheet_entry_id}).update({matched_user_id:null});await s.refused(()=>s.post('/transactions/createTransaction/1/1',{transaction:{...work.payload,timesheetEntryID:named.timesheet_entry_id,loggedForUserID:2}}),200,500,/employee must match/);
  await s.refused(()=>s.post('/transactions/createTransaction/1/1',{transaction:{...work.payload,timesheetEntryID:2147483646}}),200,500,/source was not found/);
 });
});
