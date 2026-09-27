'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {fixtureMaintenance}=require('./_sent-fixture'),{today,ago}=require('./_scenario');
const ctx=require('../../src/endpoints/billingEntities/entity-context'),{randomUUID}=require('crypto');
const {fetchInitialQueryItems}=require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries'),{calculateInvoices}=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
describe('H2 correction of the H1 legacy opening default',function(){
 this.timeout(180000);let s,a,b,c,recent,t,plan,original;
 const req=(method,url,body,role='sa',key=randomUUID())=>{let r=s.request[method](url).set('Authorization','Bearer '+s.token(role)).set('Idempotency-Key',key);return body===undefined?r:r.send(body);};
 const money=async(client,entityId)=>ctx.run(entityId,async()=>calculateInvoices([{customer_id:client.id}],await fetchInitialQueryItems(s.db,{[client.id]:{customer_id:client.id}},1))[0]);
 before(async()=>{
  s=await new PathScenario().boot();a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  b=ok(await req('post','/billing-entities',{name:'H2 Advisory',legal_name:'H2 Advisory',invoice_prefix:'HAD',reason:'Synthetic cutover attribution'})).entity.billing_entity_id;
  c=await s.customer('Legacy settled work');recent=await s.customer('Recent genuinely unbilled');const j=await s.job(c),rj=await s.job(recent);const old=await s.work(c,j,100000,{entityId:a,transactionDate:ago(50)});t=await s.work(recent,rj,200,{entityId:a,transactionDate:ago(5)});
  await fixtureMaintenance(s.db,1,async trx=>{
   for(const client of [c,recent]){const info=await trx('customer_information').where({account_id:1,customer_id:client.id}).first();await trx('customer_invoices').insert({account_id:1,customer_id:client.id,customer_info_id:info.customer_info_id,billing_entity_id:a,invoice_number:'H2-LEGACY-'+client.id,invoice_date:ago(30),due_date:ago(15),beginning_balance:0,total_payments:0,total_charges:client===c?100:0,total_write_offs:0,total_retainers:0,is_invoice_paid_in_full:client!==c,total_amount_due:client===c?100:0,remaining_balance_on_invoice:client===c?100:0,invoice_file_location:'local-fixture/legacy.pdf',created_by_user_id:1,created_at:trx.raw("(clock_timestamp() AT TIME ZONE 'UTC')-interval '30 days'")});}
   await trx('customer_payments').insert({account_id:1,customer_id:c.id,billing_entity_id:a,payment_amount:-100000,payment_date:today(),form_of_payment:'Legacy adjustment',created_by_user_id:1});
   const [co]=await trx('billing_cutovers').insert({account_id:1,source:'migration/028/default',manifest:{default_entity_id:a},manifest_sha256:'0'.repeat(64)}).returning('*');
   for(const tx of [old,t]){await trx('customer_transactions').where({transaction_id:tx.transaction_id}).update({billing_entity_id:null,transaction_date:tx===old?ago(50):ago(5)});const [te]=await trx('timesheet_entries').insert({account_id:1,user_id:3,timesheet_name:'H2legacy.xlsx',time_tracker_start_date:ago(60),time_tracker_end_date:today(),notes:'Legacy advisory work',date:tx===old?ago(50):ago(5),duration:6,entity:'H2 Advisory',created_at:trx.raw("clock_timestamp()-interval '1 day'")}).returning('*');await trx('ai_category_training_examples').insert({account_id:1,timesheet_entry_id:te.timesheet_entry_id,transaction_id:tx.transaction_id,final_category:'Tax'});await trx('legacy_financial_entity_attributions').insert({account_id:1,customer_id:tx.customer_id,table_name:'customer_transactions',record_id:tx.transaction_id,billing_entity_id:b,cutover_id:co.cutover_id,source_sha256:'0'.repeat(64),basis:'Original H1 tracker assignment'});}
   await trx('timesheet_entries').insert({account_id:1,user_id:3,timesheet_name:'H2legacy-unmatched.xlsx',time_tracker_start_date:ago(60),time_tracker_end_date:today(),notes:'Unmatched legacy work',date:ago(5),duration:6,entity:'Client name entered by mistake',created_at:trx.raw("clock_timestamp()-interval '1 day'")});
  });
  original=await s.db('customer_transactions').orderBy('transaction_id');plan=ok(await req('get','/billing-entities/cutover/amendment'));
 });
 after(async()=>{if(s)await s.close();});
 for(const role of ['Manager','Employee'])it(`${role} cannot amend or move legacy work`,async()=>{await s.db('users').where({user_id:3}).update({access_level:role});try{await s.refused(()=>req('post','/billing-entities/cutover/amendment',{reason:'Unauthorized',manifestHash:plan.manifestHash},'staff'),403,403,/unauthorized/i);await s.refused(()=>req('post',`/billing-entities/work/${t.transaction_id}`,{reason:'Unauthorized',entityId:b},'staff'),403,403,/unauthorized/i);}finally{await s.db('users').where({user_id:3}).update({access_level:'Employee'});}});
 it('rejects missing reason, invalid/stale manifest and database failure without writes',async()=>{for(const body of [{manifestHash:plan.manifestHash},{reason:'Review',manifestHash:'bad'}])await s.refused(()=>req('post','/billing-entities/cutover/amendment',body),400,400,/.+/);await s.refused(()=>req('post','/billing-entities/cutover/amendment',{reason:'Review',manifestHash:'f'.repeat(64)}),409,409,/changed/i);await s.queryFault(/insert into "legacy_billing_scopes"/,()=>s.refused(()=>req('post','/billing-entities/cutover/amendment',{reason:'Restore opening default',manifestHash:plan.manifestHash}),500,500,/.+/));});
 it('supersedes the manifest once and restores cancelled U/P to the default without editing sources',async()=>{const body={manifestHash:plan.manifestHash,reason:'Pre-cutover items settled together; restore default opening scope'},key=randomUUID();const saved=ok(await req('post','/billing-entities/cutover/amendment',body,'admin',key));const before=await s.allState();expect(ok(await req('post','/billing-entities/cutover/amendment',body,'admin',key))).to.deep.equal(saved);expect(await s.allState()).to.deep.equal(before);expect(await s.db('customer_transactions').orderBy('transaction_id')).to.deep.equal(original);const def=await money(c,a);expect(def.transactions.transactionsTotal).to.equal(100000);expect(def.payments.paymentTotal).to.equal(-100000);expect(def.invoiceTotal).to.equal(100);expect((await money(c,b)).invoiceTotal).to.equal(0);expect((await money(recent,a)).invoiceTotal).to.equal(200);expect((await money(recent,b)).invoiceTotal).to.equal(0);});
 it('reports only newer tracker-attributed legacy work and unmatched rows, without moving it',async()=>{const before=await s.allState(),report=ok(await req('get','/billing-entities/cutover/candidates'));expect(report.candidates.map(r=>r.transaction_id)).to.deep.equal([t.transaction_id]);expect(report.unmatchedLegacyTrackers).to.have.length(1);expect(await s.allState()).to.deep.equal(before);const reviews=ok(await req('get','/billing-entities/review'));expect(reviews.reviews).to.have.length(0);});
 it('an admin explicitly moves the recent $200; both scopes reconcile and reporting attribution remains',async()=>{const row=ok(await req('get',`/billing-entities/work/${t.transaction_id}`)).transaction;ok(await req('post',`/billing-entities/work/${t.transaction_id}`,{entityId:b,expectedSourceHash:row.source_hash,reason:'Confirmed recent advisory work remains unbilled'},'admin'));expect((await money(recent,a)).invoiceTotal).to.equal(0);expect((await money(recent,b)).invoiceTotal).to.equal(200);expect((await s.db.raw("SELECT ds2_legacy_reporting_entity(1,'customer_transactions',?) AS entity",[t.transaction_id])).rows[0].entity).to.equal(b);});
 it('post-cutover work still requires an explicit business and unknown tracker text is held',async()=>{const j=await s.db('customer_jobs').where({account_id:1,customer_id:recent.id}).first();await s.refused(()=>req('post','/transactions/createTransaction/1/1',{transaction:s.transaction(recent,j,10)}),400,400,/business|entity/i);const newRows=await s.db.transaction(trx=>require('../../src/endpoints/timesheets/timesheets-service').insertTimesheetEntriesWithTransaction(trx,[{account_id:1,user_id:3,timesheet_name:'H2-new.xlsx',time_tracker_start_date:today(),time_tracker_end_date:today(),date:today(),entity:'Unknown new company',duration:6,notes:'New work',is_processed:false,is_deleted:false}]));expect(newRows[0].hold_reason).to.equal('entity_unknown');expect(newRows[0].billing_entity_id).to.equal(null);});
 it('cannot amend the already superseded cutover again',()=>s.refused(()=>req('post','/billing-entities/cutover/amendment',{manifestHash:plan.manifestHash,reason:'Try again'}),409,409,/already/i));
 it('amendment and candidate reads enforce roles and fail atomically on database errors',async()=>{
  for(const path of ['/billing-entities/cutover/amendment','/billing-entities/cutover/candidates']){
   await s.refused(()=>s.request.get(path),401,401,/.+/);
   await s.refused(()=>req('get',path,undefined,'staff'),403,403,/.+/);
  }
  await s.queryFault(/select .*billing_cutovers/i,()=>s.refused(()=>req('get','/billing-entities/cutover/amendment'),500,500,/.+/));
  await s.queryFault(/FROM legacy_billing_scopes s/i,()=>s.refused(()=>req('get','/billing-entities/cutover/candidates'),500,500,/.+/));
 });
 it('refuses a newly reviewed amendment after financial activity resumes',async()=>{
  await s.foreignFixture();
  const business=(await s.db('billing_entities').where({account_id:700,is_default:true}).first()).billing_entity_id;
  await s.db('billing_cutovers').insert({account_id:700,source:'migration/028/default',manifest:{default_entity_id:business},manifest_sha256:'0'.repeat(64)});
  await s.db('customer_payments').insert({account_id:700,customer_id:70001,billing_entity_id:business,payment_amount:-1,payment_date:today(),form_of_payment:'Cash',created_by_user_id:70001});
  const beforeReceipt=ok(await req('get','/billing-entities/cutover/amendment',undefined,'foreign'));expect(beforeReceipt.manifest.guards.financialWrites).to.be.above(0);
  await s.db.transaction(async trx=>{
   const [cash]=await trx('payment_receipts').insert({account_id:700,customer_id:70001,billing_entity_id:business,amount:1,receipt_date:today(),method:'cash',created_by:70001,reason:'Synthetic resumed receipt'}).returning('*');
   await trx('client_credit_lots').insert({account_id:700,customer_id:70001,billing_entity_id:business,receipt_id:cash.receipt_id,origin_receipt_id:cash.receipt_id,amount:1,kind:'held_receipt',source_key:`receipt/${cash.receipt_id}/guard-fixture`,effective_date:today()});
  });
  const proposed=ok(await req('get','/billing-entities/cutover/amendment',undefined,'foreign'));expect(proposed.manifest.guards.financialWrites).to.equal(beforeReceipt.manifest.guards.financialWrites+2);
  await s.refused(()=>req('post','/billing-entities/cutover/amendment',{manifestHash:proposed.manifestHash,reason:'Cannot re-plan resumed billing'},'foreign'),409,409,/resumed/i);
 });

 it('retains deleted-source review evidence without emptying active review pages',async()=>{
  const before=ok(await req('get','/billing-entities/review'));
  const [orphan]=await s.db('billing_entity_reviews').insert({account_id:1,table_name:'customer_transactions',record_id:2147483646,raw_entity:'Deleted historical source',candidate_ids:[],source_sha256:'0'.repeat(64),reason_code:'entity_unknown'}).returning('*');
  const newRows=await s.db.transaction(trx=>require('../../src/endpoints/timesheets/timesheets-service').insertTimesheetEntriesWithTransaction(trx,[{account_id:1,user_id:3,timesheet_name:'H2-visible-page.xlsx',time_tracker_start_date:today(),time_tracker_end_date:today(),date:today(),entity:'Unmatched last-page business',duration:6,notes:'Last actionable source',is_processed:false,is_deleted:false}]));
  const page=ok(await req('get',`/billing-entities/review?limit=1&offset=${before.totalCount}`));expect(page.totalCount).to.equal(before.totalCount+1);expect(page.reviews).to.have.length(1);expect(page.reviews[0].record_id).to.equal(newRows[0].timesheet_entry_id);
  expect(await s.db('billing_entity_reviews').where({review_id:orphan.review_id}).first()).to.exist;
 });

});
