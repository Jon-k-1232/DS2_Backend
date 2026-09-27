'use strict';
const { PathScenario, expect, ok } = require('./_path-matrix');
const { randomUUID } = require('crypto');
describe('H4 recurring route and mistake matrix', function () {
 this.timeout(180000); let s,e,c,p,o,b,foreign;
 const req=(m,path,body,role='sa',key=randomUUID())=>{let r=s.request[m]('/recurringCustomer'+path).set('Idempotency-Key',key);if(role)r=r.set('Authorization','Bearer '+s.token(role));return body===undefined?r:r.send(body);};
 const refusal=(action,status,match=/./)=>s.refused(action,status,status,match);
 const planPath=()=>`/plans/${p.recurring_customer_id}`;
 const edit=()=>({amount:100,description:'Reviewed service',reason:'Agreed change',expectedVersion:o.version});
 const catchup=()=>({action:'generate',billingDate:'2026-05-31',reason:'Review missed periods',expectedVersion:p.version});
 const endpoints=()=>[['get','/plans'],['post','/plans',b],['get',planPath()],['patch',planPath(),{...b,expectedVersion:p.version}],['get','/due'],['post','/prepare',{entityId:e,customerId:c.id,billingDate:'2026-01-31'}],['post',`/${p.recurring_customer_id}/catch-up`,catchup()],['patch',`/occurrences/${o.occurrence_id}`,edit()],['post',`/occurrences/${o.occurrence_id}/skip`,{reason:'Skip duplicate fee',expectedVersion:o.version}]];
 before(async()=>{s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;c=await s.customer('H4 matrix client');b={customerId:c.id,entityId:e,amount:125,description:'Recurring services',frequency:'monthly',billDay:1,startDate:'2026-01-01',endDate:'2026-05-31',active:true,reason:'Agreement'};p=ok(await req('post','/plans',b)).plan;o=ok(await req('post','/prepare',{entityId:e,customerId:c.id,billingDate:'2026-01-31'})).plans[0].occurrences[0];await s.foreignFixture();foreign=(await s.db('billing_entities').where({account_id:70001,is_default:true}).first())?.billing_entity_id;});
 after(async()=>{if(s)await s.close();});
 for(let index=0;index<9;index++){
  it(`route ${index+1} requires login without writes`,async()=>{const [m,path,body]=endpoints()[index];await refusal(()=>req(m,path,body,null),401);});
  it(`route ${index+1} refuses employee without writes`,async()=>{const [m,path,body]=endpoints()[index];await refusal(()=>req(m,path,body,'staff'),403);});
  it(`route ${index+1} rolls back database failure`,async()=>{const [m,path,body]=endpoints()[index];await s.queryFault(/(?:select .*from "public"\."recurring_customers"|insert into "public"\."recurring_customers"|select .*from "recurring_charge_occurrences")/i,()=>refusal(()=>req(m,path,body),500));});
 }
 for(const [field,value] of [['amount',0],['amount',-1],['amount','1.001'],['amount','NaN'],['amount','100000000'],['amount',true],['entityId',null],['entityId','all'],['customerId',null],['description',''],['frequency','weekly'],['billDay',0],['billDay',32],['billDay',1.5],['billDay',true],['startDate','2026-02-30'],['endDate','2025-12-31'],['active','false'],['reason','   ']])it(`plan rejects invalid ${field}=${JSON.stringify(value)} atomically`,()=>refusal(()=>req('post','/plans',{...b,[field]:value}),400));
 it('unknown customer, business and job are404, with no changes',async()=>{for(const field of ['customerId','entityId','jobId'])await refusal(()=>req('post','/plans',{...b,[field]:2147483646}),404);});
 it('foreign customer/entity/job and IDs never cross the account boundary',async()=>{await refusal(()=>req('get',planPath(),undefined,'foreign'),404);for(const [m,path,body] of endpoints().filter(x=>x[0]!=='get'))await refusal(()=>req(m,path,body,'foreign'),[ '/plans','/prepare' ].includes(path)?404:404);for(const path of ['/plans','/due'])expect(ok(await req('get',path,undefined,'foreign')).plans).to.deep.equal([]);if(foreign)await refusal(()=>req('post','/plans',{...b,entityId:foreign}),404);});
 it('missing and malformed plan/occurrence IDs are refused without changes',async()=>{for(const [path,status] of [['/plans/2147483646',404],['/plans/bad',400]])await refusal(()=>req('get',path),status);await refusal(()=>req('patch','/occurrences/2147483646',edit()),404);await refusal(()=>req('post','/occurrences/2147483646/skip',{reason:'Wrong row',expectedVersion:1}),404);await refusal(()=>req('post','/2147483646/catch-up',catchup()),404);});
 it('all monetary writes require a UUID key',async()=>{for(const [m,path,body] of endpoints().filter(x=>x[0]!=='get'))await refusal(()=>req(m,path,body,'sa','bad'),400);});
 it('plan stale version and changing business or calendar after generation are409',async()=>{await refusal(()=>req('patch',planPath(),{...b,expectedVersion:999}),409);for(const change of [{startDate:'2026-02-01'},{frequency:'quarterly'},{billDay:2}])await refusal(()=>req('patch',planPath(),{...b,...change,expectedVersion:p.version}),409);});
 it('charge rejects invalid amount, missing reason/description, stale version and wrong entity',async()=>{for(const change of [{amount:0},{amount:-1},{amount:'3.001'},{description:''},{reason:''},{expectedVersion:null}])await refusal(()=>req('patch',`/occurrences/${o.occurrence_id}`,{...edit(),...change}),400);await refusal(()=>req('patch',`/occurrences/${o.occurrence_id}`,{...edit(),expectedVersion:900}),409);await refusal(()=>req('patch',`/occurrences/${o.occurrence_id}`,{...edit(),entityId:2147483646}),404);});
 it('catch-up rejects unknown action, stale version, duplicate/excess/not-due periods and missing reason',async()=>{for(const [change,status] of [[{action:'delete'},400],[{reason:''},400],[{expectedVersion:999},409],[{periods:[]},400],[{periods:['2026-02-01','2026-02-01']},400],[{periods:['2035-01-01']},409],[{periods:['2026-01-01']},409]])await refusal(()=>req('post',`/${p.recurring_customer_id}/catch-up`,{...catchup(),...change}),status);});
 it('due reads validate date and business, and never generate work',async()=>{for(const [path,status] of [['/due?billingDate=wrong',400],['/due?entityId=2147483646',404]])await refusal(()=>req('get',path),status);const before=await s.allState();const result=ok(await req('get',`/due?customerId=${c.id}&billingDate=2026-05-31`));expect(result.plans[0].remaining).to.equal(4);expect(await s.allState()).to.deep.equal(before);});
 it('a failure after charge insertion rolls back charges, occurrences, audit and retry state',async()=>{await s.queryFault(/insert into "recurring_occurrence_events"/,()=>refusal(()=>req('post','/prepare',{entityId:e,customerId:c.id,billingDate:'2026-02-28'}),500));});
 it('a failure after a charge edit rolls back its amount and version',async()=>{await s.queryFault(/insert into "recurring_occurrence_events"/,()=>refusal(()=>req('patch',`/occurrences/${o.occurrence_id}`,edit()),500));});
 it('same key gives the same created plan and changed input gives409',async()=>{const key=randomUUID(),first=ok(await req('post','/plans',{...b,active:false},'admin',key));expect(ok(await req('post','/plans',{...b,active:false},'admin',key))).to.deep.equal(first);await refusal(()=>req('post','/plans',{...b,active:false,amount:150},'admin',key),409);});
 it('read plans and detail, update plan, edit and skip succeed for admin; skipped remains locked',async()=>{expect(ok(await req('get','/plans')).plans.length).to.be.greaterThan(0);expect(ok(await req('get',planPath())).plan.recurring_customer_id).to.equal(p.recurring_customer_id);p=ok(await req('patch',planPath(),{...b,expectedVersion:p.version,amount:200},'admin')).plan;ok(await req('patch',`/occurrences/${o.occurrence_id}`,edit(),'admin'));o=(await s.db('recurring_charge_occurrences').where({occurrence_id:o.occurrence_id}).first());const key=randomUUID(),body={expectedVersion:o.version,reason:'Already paid by agreement'};const first=ok(await req('post',`/occurrences/${o.occurrence_id}/skip`,body,'admin',key));expect(ok(await req('post',`/occurrences/${o.occurrence_id}/skip`,body,'admin',key))).to.deep.equal(first);await refusal(()=>req('post',`/occurrences/${o.occurrence_id}/skip`,body),409);await refusal(()=>req('patch',`/occurrences/${o.occurrence_id}`,edit()),409);});
 it('closed jobs block new generation and preserve all rows',async()=>{const j=await s.job(c);const jp=ok(await req('post','/plans',{...b,jobId:j.customer_job_id})).plan;await s.db('customer_jobs').where({customer_job_id:j.customer_job_id}).update({is_job_complete:true});await refusal(()=>req('post','/prepare',{entityId:e,planId:jp.recurring_customer_id,billingDate:'2026-01-31'}),409);});
 it('prepare selection validates client lists, missing plans and mismatched detail filters without writes',async()=>{
   for (const body of [{customerIds:'all'},{customerIds:[0]},{customerId:0},{customerId:false},{planId:0},{entityId:false},{billingDate:''}]) await refusal(()=>req('post','/prepare',body),400);
   await refusal(()=>req('post','/prepare',{planId:2147483646}),404);
   await refusal(()=>req('get',planPath()+'?customerId=2147483646'),404);
 });
 it('ordinary transaction edits cannot bypass recurrence, and delete records a versioned skip',async()=>{
   const q=ok(await req('post','/plans',{...b,description:'Delete boundary'})).plan;
   const occurrence=ok(await req('post','/prepare',{entityId:e,planId:q.recurring_customer_id,billingDate:'2026-01-31'})).plans[0].occurrences[0];
   const body={transaction:{transactionID:occurrence.transaction_id,expectedVersion:1,reason:'Do not bill this period'}};
   const request=(method,account=1,role='sa',payload=body)=>s.request[method](`/transactions/${method==='put'?'update':'delete'}Transaction/${account}/1`).set('Authorization','Bearer '+s.token(role)).set('Idempotency-Key',randomUUID()).send(payload);
   await refusal(()=>request('put'),409);
   await refusal(()=>request('delete',70001),403);
   await refusal(()=>request('delete',1,'staff'),403);
   await refusal(()=>request('delete',1,'sa',{transaction:{transactionID:occurrence.transaction_id}}),400);
   await s.queryFault(/insert into "recurring_occurrence_events"/,()=>refusal(()=>request('delete'),500));
   ok(await request('delete'));
   expect((await s.db('recurring_charge_occurrences').where({occurrence_id:occurrence.occurrence_id}).first()).state).to.equal('skipped');
   expect(await s.db('customer_transactions').where({transaction_id:occurrence.transaction_id}).first()).to.exist;
   await refusal(()=>request('delete'),409);
 });

 it('legacy earlier periods require explicit review and stay excluded until selected',async()=>{
   const q=ok(await req('post','/plans',{...b,startDate:'2024-01-01',endDate:'2025-01-31'})).plan;
   await s.db('public.recurring_customers').where({recurring_customer_id:q.recurring_customer_id}).update({first_automated_period:'2025-01-01',cutover_date:'2025-01-01'});
   const body={entityId:e,planId:q.recurring_customer_id,billingDate:'2025-01-31'};
   const ready=ok(await req('post','/prepare',body));expect(ready.generated).to.equal(1);expect(ready.plans[0].excludedPeriods).to.have.length(12);
   const chosen={action:'generate',periods:['2024-12-01'],reason:'Earlier fee independently verified unbilled',expectedVersion:1,billingDate:'2025-01-31'};
   await refusal(()=>req('post',`/${q.recurring_customer_id}/catch-up`,chosen),400);
   expect(ok(await req('post',`/${q.recurring_customer_id}/catch-up`,{...chosen,confirmHistorical:true})).generated).to.equal(1);
   expect(ok(await req('post','/prepare',body)).generated).to.equal(0);
 });
 it('a job-only plan resolves its description, maintains totals and does not duplicate customer profiles',async()=>{
   const jc=await s.customer('H4 job-only client'),j=await s.job(jc);const q=ok(await req('post','/plans',{...b,customerId:jc.id,jobId:j.customer_job_id,description:null})).plan;
   expect(q.description).to.be.a('string').and.not.equal('');
   const out=ok(await req('post','/prepare',{entityId:e,planId:q.recurring_customer_id,billingDate:'2026-01-31'}));expect(out.generated).to.equal(1);
   const transaction=await s.db('customer_transactions').where({transaction_id:out.plans[0].occurrences[0].transaction_id}).first();expect(transaction.customer_job_id).to.equal(j.customer_job_id);
   ok(await req('post','/plans',{...b,customerId:jc.id,description:'Second plan for this client'}));
   const profile=await require('../../src/endpoints/customer/customer-service').getCustomerByID(s.db,1,jc.id);expect(profile).to.have.length(1);
 });

});
