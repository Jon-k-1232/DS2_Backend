'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const ctx=require('../../src/endpoints/billingEntities/entity-context');
const {randomUUID}=require('crypto');
const service=require('../../src/endpoints/billingEntities/entities-service');
const {fetchInitialQueryItems}=require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const {calculateInvoices}=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const auditSvc=require('../../src/endpoints/accountAudit/account-audit-service');
const {auditCustomerLedger}=require('../../src/endpoints/accountAudit/account-audit-logic');
const ar=require('../../src/endpoints/accountsReceivable/accounts-receivable-service');
describe('H1 — isolated businesses, cutover, mistakes and transfers',function(){
 this.timeout(180000);let s,a,b,client,job,jobB;
 const req=(method,url,body,role='sa',key)=>{let r=s.request[method](url);if(role)r=r.set('Authorization',`Bearer ${s.token(role)}`);if(key)r=r.set('Idempotency-Key',key);return body===undefined?r:r.send(body);};
 before(async()=>{s=await new PathScenario().boot();a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  b=ok(await req('post','/billing-entities',{name:'Scenario Advisory',legal_name:'Scenario Advisory LLC',invoice_prefix:'ADV',address_line1:'20 Advisory Lane',city:'Phoenix',state:'AZ',postal_code:'85001',phone:'602-555-0100',email:'advisory@example.test',reason:'Separate advisory business'})).entity.billing_entity_id;
  client=await s.customer('H1 Two Businesses');job=await s.job(client);
  ok(await s.post('/jobs/createJob/1/1',{entityId:b,job:s.jobBody(client,2)}));jobB=await s.db('customer_jobs').where({account_id:1,customer_id:client.id,job_type_id:2}).first();
 });
 after(async()=>{if(s)await s.close();});
 async function totals(entityId,B,N,c=client){await ctx.run(entityId,async()=>{
  const data=await fetchInitialQueryItems(s.db,{[c.id]:{customer_id:c.id}},1);const inv=calculateInvoices([{customer_id:c.id}],data)[0];
  const [customer,invoices,payments,writeoffs,transactions,retainers,retainerEvents]=await Promise.all([auditSvc.getCustomer(s.db,1,c.id),auditSvc.getInvoices(s.db,1,c.id),auditSvc.getPayments(s.db,1,c.id),auditSvc.getWriteoffs(s.db,1,c.id),auditSvc.getTransactions(s.db,1,c.id),auditSvc.getRetainers(s.db,1,c.id),auditSvc.getRetainerEvents(s.db,1,c.id)]);
  const audit=auditCustomerLedger({customer,invoices,payments,writeoffs,transactions,retainers,retainerEvents});const rows=(await ar.getAging(s.db,1,{limit:1000})).rows.filter(r=>r.customer_id===c.id);
  expect(inv.invoiceTotal).to.equal(N);expect(audit.totals.audit_balance).to.equal(N);expect(inv.outstandingInvoices.outstandingInvoiceTotal).to.equal(B);expect(audit.totals.outstanding_invoices).to.equal(B);expect(rows.reduce((n,r)=>n+r.total_outstanding,0)).to.equal(B);
 });}
 it('keeps $100 and $250 of work and statements separate, with zero drift',async()=>{
  await s.work(client,job,100,{entityId:a});await s.work(client,jobB,250,{entityId:b});await totals(a,0,100);await totals(b,0,250);
  for(const [entity,amount] of [[a,100],[b,250]]){
   const list=ok(await req('get',`/invoices/createInvoice/AccountsWithBalance/1/1?entityId=${entity}`)).outstandingBalanceList.activeOutstandingBalancesData.activeOutstandingBalances;
   const row=list.find(r=>r.customer_id===client.id);expect(row.billing_entity_id).to.equal(entity);expect(row.invoice_total).to.equal(amount);expect(row.billable_transactions_total).to.equal(amount);
  }
  const one=await s.finalize([client],{entityId:a});const two=await s.finalize([client],{entityId:b});
  expect(one.invoicesWithDetail[0].invoiceNumber).to.match(/^INV-/);expect(two.invoicesWithDetail[0].invoiceNumber).to.match(/^ADV-/);
  expect(two.invoicesWithDetail[0].accountBillingInformation.account_name).to.equal('Scenario Advisory LLC');
  const files=await s.files(two.fileLocation),pdfFile=Object.entries(files).find(([name])=>name.endsWith('.pdf'));
  expect(pdfFile).to.exist;const printed=s.pdf(pdfFile[1]);expect(printed).to.include('Scenario Advisory LLC');expect(printed).to.include(two.invoicesWithDetail[0].invoiceNumber);
  require('fs').writeFileSync('/tmp/ds2-h1/h1-advisory.pdf',pdfFile[1]);

  await totals(a,100,100);await totals(b,250,250);
  const statements=require('../../src/endpoints/customer/customer-statement');
  const grouped=await ctx.run(null,()=>statements.buildStatementData(s.db,1,client.id,{}));expect(grouped.entityStatements).to.have.length(2);
  const report=await statements.renderStatementPdf(grouped,grouped.accountInfo);expect(s.pdf(report)).to.include('Scenario Advisory LLC').and.to.include('$250.00').and.to.include('$100.00');require('fs').writeFileSync('/tmp/ds2-h1/h1-all-businesses.pdf',report);

 });
 it('carries $100 only within its business while the other remains $250',async()=>{
  await s.work(client,job,40,{entityId:a});const r=await s.finalize([client],{entityId:a,allowSameDayRebill:true});expect(r.invoicesWithDetail[0].invoiceTotal).to.equal(140);await totals(a,140,140);await totals(b,250,250);
 });
 it('keeps unrelated company changes out of client history while verifying the complete account chain',async()=>{
  const historyService=require('../../src/endpoints/auditRecord/audit-record-service');
  const before=await historyService.history(s.db,1,client.id,{limit:25});
  const ownNumbers=before.entries.flatMap(e=>e.events).filter(e=>e.entity==='billing_entity_invoice_sequences');
  expect(ownNumbers).to.have.length(3);
  // More than one history page of unrelated numbering events must remain in
  // the account ledger without displacing this client's statement evidence.
  for(let i=0;i<30;i++)await s.db('billing_entity_invoice_sequences').where({account_id:1,billing_entity_id:a}).increment('last_number',1);
  const after=await historyService.history(s.db,1,client.id,{limit:25});
  expect(after.entries).to.deep.equal(before.entries);expect(after.total).to.equal(before.total);
  expect(after.current.running_balance).to.equal(390);expect(after.verification.valid).to.equal(true);
  expect(after.entries.flatMap(e=>e.events).some(e=>e.entity==='invoice_issues')).to.equal(true);
  const allNumbers=await s.db('audit_events').where({account_id:1,entity:'billing_entity_invoice_sequences'});
  expect(allNumbers.length).to.equal(ownNumbers.length+30);
 });
 it('requires an entity on manual money entry with no writes',async()=>{await s.refused(()=>req('post','/transactions/createTransaction/1/1',{transaction:s.transaction(client,job,10)}),400,400,/business|entity/i);});
 it('refuses a foreign/missing entity without a write',async()=>{await s.refused(()=>req('post','/transactions/createTransaction/1/1',{entityId:2147483646,transaction:s.transaction(client,job,10)}),404,404,/not found/i);});
 it('refuses deactivation with open balances and preserves all rows',async()=>{await s.refused(()=>req('patch',`/billing-entities/${b}`,{active:false,expectedVersion:1,reason:'Try deactivation'}),409,409,/open balances/i);});
 it('holds an unknown tracker spelling without assigning the default',async()=>{
  const rows=await s.db.transaction(trx=>require('../../src/endpoints/timesheets/timesheets-service').insertTimesheetEntriesWithTransaction(trx,[{account_id:1,user_id:3,employee_name:'Uma User',timesheet_name:'H1 typo.xlsx',time_tracker_start_date:'2026-09-20',time_tracker_end_date:'2026-09-26',date:'2026-09-25',entity:'Scenairo Advisory',duration:6,notes:'Synthetic company typo',is_processed:false,is_deleted:false}]));expect(rows[0].billing_entity_id).to.equal(null);expect(rows[0].hold_reason).to.equal('entity_unknown');
  const list=ok(await req('get','/billing-entities/review'));const review=list.reviews.find(r=>r.record_id===rows[0].timesheet_entry_id && r.table_name==='timesheet_entries');expect(review).to.exist;
  await s.refused(()=>req('post',`/billing-entities/review/${review.review_id}/resolve`,{entityId:b,expectedSourceHash:review.sourceHash,reason:''}),400,400,/reason/i);
  ok(await req('post',`/billing-entities/review/${review.review_id}/resolve`,{entityId:b,expectedSourceHash:review.sourceHash,reason:'Confirmed advisory work'}));
  await s.refused(()=>req('post',`/billing-entities/review/${review.review_id}/resolve`,{entityId:b,expectedSourceHash:review.sourceHash,reason:'Double click'}),409,409,/already resolved/i);
 });
 it('requires reasoned admin transfers and returns the same response for a retry',async()=>{
  const retainer=await s.retainer(client,80,{entityId:a});const body={customerId:client.id,sourceEntityId:a,destinationEntityId:b,retainerId:retainer.retainer_id,expectedSnapshotId:retainer.retainer_id,amount:'30.00',reason:'Owner requested advisory credit'};const key=randomUUID();
  await s.refused(()=>req('post','/transactions/createTransaction/1/1',{entityId:b,transaction:s.transaction(client,jobB,10,{selectedRetainerID:retainer.retainer_id})}),200,500,/retainer|matching/i);
  await s.refused(()=>req('post','/billing-entities/transfers',body,'staff',key),403,403,/unauthorized/i);
  const first=ok(await req('post','/billing-entities/transfers',body,'admin',key));expect(first.sourceAvailable).to.equal(50);expect(first.destinationCredit).to.equal(30);
  const before=await s.allState();const again=ok(await req('post','/billing-entities/transfers',body,'admin',key));expect(again).to.deep.equal(first);expect(await s.allState()).to.deep.equal(before);
  const customer=await auditSvc.getCustomer(s.db,1,client.id);
  for(const [entity,available,prepaid,transferredIn,transferredOut] of [[a,50,80,0,30],[b,30,0,30,0],[null,80,80,30,30]]){
   const audit=await ctx.run(entity,async()=>auditCustomerLedger({customer,invoices:[],payments:[],writeoffs:[],transactions:[],retainers:await auditSvc.getRetainers(s.db,1,client.id)}));
   expect(audit.totals.retainer_available).to.equal(available);expect(audit.totals.retainer_total_prepaid_lifetime).to.equal(prepaid);expect(audit.totals.retainer_drawn).to.equal(0);
   expect(audit.retainers.total_prepaid_lifetime).to.equal(prepaid);expect(audit.retainers.retainer_drawn).to.equal(0);
   expect(audit.totals.retainer_transferred_in).to.equal(transferredIn);expect(audit.totals.retainer_transferred_out).to.equal(transferredOut);
   const moves=audit.ledger.filter(row=>row.type.startsWith('retainer_credit_transfer_'));expect(moves).to.have.length(entity===null?2:1);expect(moves.every(row=>row.charge===0 && row.credit===0)).to.equal(true);
  }
  await s.refused(()=>req('post','/billing-entities/transfers',{...body,amount:'31'},'admin',key),409,409,/different transfer/i);
  await s.refused(()=>req('post','/billing-entities/transfers',body,'admin',randomUUID()),409,409,/changed/i);
 });
 it('protects entity administration from employees and stale edits',async()=>{
  await s.refused(()=>req('post','/billing-entities',{name:'Wrong',legal_name:'Wrong',invoice_prefix:'WRONG',reason:'Forbidden'},'staff'),403,403,/unauthorized/i);
  ok(await req('patch',`/billing-entities/${b}`,{phone:'602-555-0101',expectedVersion:1,reason:'Synthetic contact update'}));
  await s.refused(()=>req('patch',`/billing-entities/${b}`,{phone:'602-555-0102',expectedVersion:1,reason:'Stale contact update'}),409,409,/changed/i);
 });
 it('routes a reviewed $90 legacy balance into $60/$30 without changing its source, then consumes each once',async()=>{
  const c=await s.customer('H1 Legacy Split'),j=await s.job(c);
  const [source]=await s.db('customer_invoices').insert({account_id:1,customer_id:c.id,customer_info_id:c.info.customer_info_id,billing_entity_id:a,invoice_number:'LEGACY-H1',invoice_date:'2026-08-01',due_date:'2026-08-17',beginning_balance:0,total_charges:90,total_payments:0,total_write_offs:0,total_retainers:0,total_amount_due:90,remaining_balance_on_invoice:90,is_invoice_paid_in_full:false,created_by_user_id:1}).returning('*');
  const [co]=await s.db('billing_cutovers').insert({account_id:1,source:'fixture/H1/split',manifest:{synthetic:true},manifest_sha256:'0'.repeat(64)}).returning('*');
  await require('./_sent-fixture').fixtureMaintenance(s.db,1,t=>t('customer_invoices').where({customer_invoice_id:source.customer_invoice_id}).update({billing_entity_id:null}));
  await s.db('legacy_financial_entity_attributions').insert({account_id:1,customer_id:c.id,table_name:'customer_invoices',record_id:source.customer_invoice_id,billing_entity_id:a,cutover_id:co.cutover_id,source_sha256:'0'.repeat(64),basis:'Synthetic preserved legacy source'});
  const raw=await s.db('customer_invoices as i').select(s.db.raw("encode(sha256(convert_to((to_jsonb(i)-'billing_entity_id')::text,'UTF8')),'hex') AS hash")).where({customer_invoice_id:source.customer_invoice_id}).first();
  const [p]=await s.db('billing_cutover_positions').insert({account_id:1,customer_id:c.id,billing_entity_id:a,cutover_id:co.cutover_id,source_root_id:source.customer_invoice_id,source_snapshot_id:source.customer_invoice_id,opening_amount:90,source_sha256:raw.hash,basis:'Synthetic opening routing'}).returning('*');
  const original=await s.db('customer_invoices').where({customer_invoice_id:source.customer_invoice_id}).first();
  await totals(a,90,90,c);await totals(b,0,0,c);
  const body={reason:'Reviewed original work allocation',positions:[{positionId:p.position_id,sourceHash:p.source_sha256,slices:[{entityId:a,amount:60},{entityId:b,amount:30}]}]},key=randomUUID();
  await s.refused(()=>req('post','/billing-entities/cutover',{...body,positions:[{...body.positions[0],slices:[{entityId:a,amount:89}]}]},'admin',randomUUID()),409,409,/equal/);
  await s.queryFault(/insert into \"billing_cutover_allocations\"/i,()=>s.refused(()=>req('post','/billing-entities/cutover',body,'admin',randomUUID()),500,500,/no changes/i));
  await s.refused(()=>req('post','/billing-entities/cutover',{...body,positions:[{...body.positions[0],sourceHash:'f'.repeat(64)}]},'admin',randomUUID()),409,409,/hash changed/i);
  const result=ok(await req('post','/billing-entities/cutover',body,'admin',key));expect(result.allocations).to.have.length(2);
  const state=await s.allState();expect(ok(await req('post','/billing-entities/cutover',body,'admin',key))).to.deep.equal(result);expect(await s.allState()).to.deep.equal(state);
  await totals(a,60,60,c);await totals(b,30,30,c);
  for(const [entity,amount] of [[a,60],[b,30]]){const hist=await ctx.run(entity,()=>require('../../src/endpoints/auditRecord/audit-record-service').history(s.db,1,c.id));expect(hist.current.billed_balance).to.equal(amount);}
  await s.pay(c,10,{entityId:a,selectedInvoiceID:source.customer_invoice_id});
  await s.pay(c,5,{entityId:b,selectedInvoiceID:source.customer_invoice_id});
  await s.writeoff(c,3,{entityId:b,customerInvoiceID:source.customer_invoice_id});
  await totals(a,50,50,c);await totals(b,22,22,c);
  expect(await s.db('customer_invoices').where({customer_invoice_id:source.customer_invoice_id}).first()).to.deep.equal(original);
  await s.work(c,j,10,{entityId:a});await s.finalize([c],{entityId:a});await totals(a,60,60,c);await totals(b,22,22,c);
  expect(await s.db('billing_cutover_links').where({position_id:p.position_id})).to.have.length(0);
  await s.finalize([c],{entityId:b});await totals(a,60,60,c);await totals(b,22,22,c);
  expect(await s.db('billing_cutover_links').where({position_id:p.position_id})).to.have.length(1);
  expect(await s.db('billing_cutover_allocation_links').where({customer_id:c.id})).to.have.length(2);
  expect(await s.db('customer_invoices').where({customer_invoice_id:source.customer_invoice_id}).first()).to.deep.equal(original);
 });

 it('keeps an unsplit legacy opening immutable through payment and carry-forward',async()=>{
  const c=await s.customer('H1 Default Opening');
  const [source]=await s.db('customer_invoices').insert({account_id:1,customer_id:c.id,customer_info_id:c.info.customer_info_id,billing_entity_id:a,invoice_number:'LEGACY-DEFAULT-H1',invoice_date:'2026-08-01',due_date:'2026-08-17',beginning_balance:0,total_charges:90,total_payments:0,total_write_offs:0,total_retainers:0,total_amount_due:90,remaining_balance_on_invoice:90,is_invoice_paid_in_full:false,created_by_user_id:1}).returning('*');
  const [co]=await s.db('billing_cutovers').insert({account_id:1,source:'fixture/H1/default',manifest:{synthetic:true},manifest_sha256:'0'.repeat(64)}).returning('*');
  const hash=(await s.db('customer_invoices as i').select(s.db.raw("encode(sha256(convert_to((to_jsonb(i)-'billing_entity_id')::text,'UTF8')),'hex') AS h")).where({customer_invoice_id:source.customer_invoice_id}).first()).h;
  const [position]=await s.db('billing_cutover_positions').insert({account_id:1,customer_id:c.id,billing_entity_id:a,cutover_id:co.cutover_id,source_root_id:source.customer_invoice_id,source_snapshot_id:source.customer_invoice_id,opening_amount:90,source_sha256:hash,basis:'Synthetic default opening'}).returning('*');
  await s.pay(c,5,{entityId:a,selectedInvoiceID:source.customer_invoice_id});await totals(a,85,85,c);await totals(b,0,0,c);
  await s.finalize([c],{entityId:a});await totals(a,85,85,c);
  expect(await s.db('customer_invoices').where({customer_invoice_id:source.customer_invoice_id}).first()).to.deep.equal(source);
  expect(await s.db('billing_cutover_links').where({position_id:position.position_id})).to.have.length(1);
 });
 it('reclassifies only unissued, unfunded work with a reason and source version',async()=>{
  const c=await s.customer('H1 Reclassification'),j=await s.job(c),t=await s.work(c,j,12,{entityId:a});
  const row=ok(await req('get',`/billing-entities/work/${t.transaction_id}`)).transaction;
  const body={entityId:b,expectedSourceHash:row.source_hash,reason:'Confirmed advisory work'};
  await s.refused(()=>req('post',`/billing-entities/work/${t.transaction_id}`,body,'staff'),403,403,/unauthorized/i);
  await s.queryFault(/update \"public\".\"customer_transactions\"/i,()=>s.refused(()=>req('post',`/billing-entities/work/${t.transaction_id}`,body,'admin'),500,500,/no changes/i));
  ok(await req('post',`/billing-entities/work/${t.transaction_id}`,body,'admin')); 
  await s.refused(()=>req('post',`/billing-entities/work/${t.transaction_id}`,body,'admin'),409,409,/changed/i);
  await totals(a,0,0,c);await totals(b,0,12,c);await s.finalize([c],{entityId:b});
  const issued=ok(await req('get',`/billing-entities/work/${t.transaction_id}`)).transaction;
  await s.refused(()=>req('post',`/billing-entities/work/${t.transaction_id}`,{...body,entityId:a,expectedSourceHash:issued.source_hash},'sa'),409,409,/finalized/i);
 });

});
