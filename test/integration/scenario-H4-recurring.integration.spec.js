'use strict';
const { PathScenario, expect, ok } = require('./_path-matrix');
const { randomUUID } = require('crypto');
const { today } = require('./_scenario');
describe('H4 recurring financial scenarios', function () {
 this.timeout(180000); let s,e;
 const req=(m,path,b,key=randomUUID())=>{let r=s.request[m]('/recurringCustomer'+path).set('Authorization','Bearer '+s.token()).set('Idempotency-Key',key);return b===undefined?r:r.send(b);};
 const create=async(name,more={})=>{const c=await s.customer(name);const b={customerId:c.id,entityId:e,description:'Monthly services',frequency:'monthly',billDay:1,amount:125,startDate:'2026-01-01',endDate:'2026-03-31',active:true,reason:'Client agreement',...more};return {c,b,p:ok(await req('post','/plans',b)).plan};};
 const prepare=async(c,billingDate='2026-03-31')=>ok(await req('post','/prepare',{customerId:c.id,entityId:e,billingDate}));
 before(async()=>{s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;});
 after(async()=>{if(s)await s.close();});
 it('monthly Jan-Mar generates 375 once, editing Feb and skipping Mar leaves225, with covered60 and excess40 totals265',async()=>{
  const {c,p}=await create('H4 monthly oracle');const out=await prepare(c);expect(out.generated).to.equal(3);expect(out.remaining).to.equal(0);await s.check(c,{n:375,b:0,r:0});
  const occurrences=out.plans[0].occurrences;expect(occurrences.map(o=>o.snapshot_amount)).to.deep.equal(['125.00','125.00','125.00']);
  ok(await req('patch',`/occurrences/${occurrences[1].occurrence_id}`,{amount:100,description:'February concession',reason:'Agreed shorter service',expectedVersion:1}));
  ok(await req('post',`/occurrences/${occurrences[2].occurrence_id}/skip`,{reason:'No March services',expectedVersion:1}));
  expect((await prepare(c)).generated).to.equal(0);await s.check(c,{n:225,b:0,r:0});
  const job=await s.job(c);await s.work(c,job,60,{entityId:e,isTransactionBillable:false,isInAdditionToMonthlyCharge:false});await s.work(c,job,40,{entityId:e,isInAdditionToMonthlyCharge:true});await s.check(c,{n:265,b:0,r:0});
  const issued=await s.finalize([c],{entityId:e});expect(issued.invoicesWithDetail[0].invoiceTotal).to.equal(265);await s.check(c,{n:265,b:265,r:0});
  const rows=await s.db('recurring_charge_occurrences').where({plan_id:p.recurring_customer_id}).orderBy('period_start');expect(rows.map(o=>o.state)).to.deep.equal(['issued','issued','skipped']);
  await s.refused(()=>req('patch',`/occurrences/${rows[0].occurrence_id}`,{amount:5,description:'Wrong',expectedVersion:rows[0].version,reason:'Attempt locked edit'}),409,409,/locked/);
  const files=await s.files(issued.fileLocation),pdf=s.pdf(Object.values(files).find(b=>b.subarray(0,4).toString()==='%PDF'));expect(pdf).to.include('2026-01-01');expect(pdf).not.to.match(/\b(?:null|undefined)\b/);
  const audit=ok(await s.get(`/auditRecord/customer/${c.id}/1/1`));expect(audit.verification.valid).to.equal(true);
 });
 for(const [frequency,start,through,expected] of [
  ['monthly','2024-01-01','2024-03-31',['2024-01-31','2024-02-29','2024-03-31']],
  ['monthly','2025-01-01','2025-04-30',['2025-01-31','2025-02-28','2025-03-31','2025-04-30']],
  ['quarterly','2025-11-01','2026-08-31',['2025-11-30','2026-02-28','2026-05-31','2026-08-31']],
  ['semiannual','2025-08-01','2026-08-31',['2025-08-31','2026-02-28','2026-08-31']],
  ['annual','2024-02-01','2026-02-28',['2024-02-29','2025-02-28','2026-02-28']]
 ])it(`${frequency} ${start} to ${through} clamps month ends and crosses years`,async()=>{const {c}=await create(`H4 ${frequency} ${start}`,{frequency,startDate:start,endDate:through,billDay:31,amount:10});const out=await prepare(c,through);expect(out.plans[0].occurrences.map(o=>String(o.due_date).slice(0,10))).to.deep.equal(expected);expect(out.generated).to.equal(expected.length);await s.check(c,{n:10*expected.length,b:0,r:0});});
 for(const day of [29,30,31])it(`bill day ${day} clamps February to28 and respects an inclusive end date`,async()=>{const {c}=await create('H4 Feb '+day,{startDate:'2025-02-01',endDate:'2025-02-28',billDay:day});const out=await prepare(c);expect(out.plans[0].occurrences.map(o=>o.due_date.slice(0,10))).to.deep.equal(['2025-02-28']);});
 it('end mid-period charges the full fee only when the due date is on/before end',async()=>{for(const day of [1,20]){const {c}=await create('H4 midperiod '+day,{startDate:'2026-01-01',endDate:'2026-02-15',billDay:day});expect((await prepare(c)).generated).to.equal(day===1?2:1);}});
 it('a start after the bill day waits for the next anchored month',async()=>{const {c}=await create('H4 start boundary',{startDate:'2026-01-15',endDate:'2026-03-01',billDay:1});expect((await prepare(c)).generated).to.equal(2);});
 it('plan edits affect only ungenerated periods, and deactivation leaves generated charges editable',async()=>{const {c,p,b}=await create('H4 edit future');await prepare(c,'2026-01-31');const updated=ok(await req('patch',`/plans/${p.recurring_customer_id}`,{...b,amount:200,reason:'New rate February onward',expectedVersion:1})).plan;let out=await prepare(c,'2026-02-28');expect(out.plans[0].occurrences.map(o=>o.snapshot_amount)).to.deep.equal(['125.00','200.00']);ok(await req('patch',`/plans/${p.recurring_customer_id}`,{...b,amount:200,active:false,reason:'Pause before March',expectedVersion:updated.version}));out=await prepare(c);expect(out.generated).to.equal(0);expect(out.plans[0].occurrences).to.have.length(2);});
 it('concurrent opens and same-key retries create one occurrence per period',async()=>{const {c}=await create('H4 race');const key=randomUUID(),body={customerId:c.id,entityId:e,billingDate:'2026-03-31'};const responses=await Promise.all([req('post','/prepare',body,key),req('post','/prepare',body,key),req('post','/prepare',body)]);responses.forEach(ok);expect(await s.db('customer_transactions').where({customer_id:c.id})).to.have.length(3);expect(responses[0].body.generated).to.equal(responses[1].body.generated);});
 it('catch-up exposes exact remaining periods, caps at12 and records explicit skipped history',async()=>{const {c,p}=await create('H4 capped catchup',{startDate:'2024-01-01',endDate:'2025-02-28'});const out=await prepare(c,'2025-02-28');expect(out.generated).to.equal(12);expect(out.remaining).to.equal(2);expect(out.catchUpRequired).to.equal(true);const next=ok(await req('post',`/${p.recurring_customer_id}/catch-up`,{action:'skip',billingDate:'2025-02-28',reason:'Already manually billed',expectedVersion:1}));expect(next.skipped).to.equal(2);expect((await prepare(c,'2025-02-28')).generated).to.equal(0);});
 it('finalize prepares omitted due fees then returns refresh instructions; the refreshed request issues once',async()=>{const {c}=await create('H4 finalize fallback',{startDate:today(),endDate:today(),billDay:Number(today().slice(8))});const first=await s.post('/invoices/createInvoice/1/1',s.configuration([c],{entityId:e,isFinalized:true,isCsvOnly:false,isRoughDraft:false}));expect(first.status,JSON.stringify(first.body)).to.equal(409);expect(first.body.recurring.generated).to.equal(1);expect(await s.db('customer_invoices').where({customer_id:c.id})).to.have.length(0);await s.finalize([c],{entityId:e});await s.check(c,{n:125,b:125,r:0});});
 it('generated fees are charges with no fictional employee time and automation audit attribution',async()=>{const {c}=await create('H4 attribution');await prepare(c);const rows=await s.db('customer_transactions').where({customer_id:c.id});expect(rows.every(t=>t.transaction_type==='Charge' && t.logged_for_user_id===null && !t.is_excess_to_subscription && Number(t.quantity)===1)).to.equal(true);const events=await s.db('audit_events').where({customer_id:c.id,entity:'recurring_charge_occurrences'});expect(events).to.have.length(3);expect(events.every(ev=>ev.actor_user_id===null && ev.actor_name==='system' && ev.source==='automation/recurring/prepare')).to.equal(true);});
 it('the optional backstop stays off locally and races safely with interactive preparation when enabled',async()=>{
   const scheduler=require('../../src/automations/automationScripts/recurringBilling');
   const {c}=await create('H4 scheduler',{startDate:today(),endDate:today(),billDay:Number(today().slice(8))});
   const saved=process.env.RUN_SCHEDULED_AUTOMATIONS;
   try {
     process.env.RUN_SCHEDULED_AUTOMATIONS='false';expect(await scheduler.prepareRecurring(s.db)).to.deep.equal([]);expect(await s.db('customer_transactions').where({customer_id:c.id})).to.have.length(0);
     process.env.RUN_SCHEDULED_AUTOMATIONS='true';
     const [backstop]=await Promise.all([scheduler.prepareRecurring(s.db),prepare(c,today())]);expect(backstop.some(x=>x.error)).to.equal(false);
     expect(await s.db('customer_transactions').where({customer_id:c.id})).to.have.length(1);
     expect((await scheduler.prepareRecurring(s.db)).some(x=>x.generated>0)).to.equal(false);
   } finally {if(saved===undefined)delete process.env.RUN_SCHEDULED_AUTOMATIONS;else process.env.RUN_SCHEDULED_AUTOMATIONS=saved;}
 });

});
