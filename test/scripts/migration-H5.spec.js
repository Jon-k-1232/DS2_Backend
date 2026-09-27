'use strict';
const fs=require('fs'),harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
const file='migrations/045.work_cost_snapshots.sql',sql=fs.readFileSync(file,'utf8');
describe('H5 cost snapshot migration',function(){
 this.timeout(180000);let db;const name=`ds2_mig_test_h5_${process.pid}`;
 before(async()=>{if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name,{through:44});db=harness.knexFor(name);});
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 it('is plain SQL with no top-level transaction wrapper',()=>expect(()=>assertPlainSql(sql,file)).not.to.throw());
 it('preserves every old field and records immutable estimated provenance exactly once',async()=>{
  const c=await db('customers').where({account_id:1}).first(),e=await db('billing_entities').where({account_id:1,is_default:true}).first();
  const [work]=await db('customer_transactions').insert({account_id:1,customer_id:c.customer_id,billing_entity_id:e.billing_entity_id,logged_for_user_id:3,general_work_description_id:1,transaction_date:'2025-01-01',transaction_type:'Time',quantity:2,unit_cost:100,total_transaction:200,is_transaction_billable:true,is_excess_to_subscription:false,created_by_user_id:1}).returning('*');
  await db.transaction(trx=>trx.raw(sql));const saved=await db('customer_transactions').where({transaction_id:work.transaction_id}).first();for(const key of Object.keys(work))expect(saved[key],key).to.deep.equal(work[key]);
  const estimate=await db('legacy_work_cost_estimates').where({table_name:'customer_transactions',record_id:work.transaction_id}).first();expect(estimate.cost_rate_source).to.equal('estimated');expect(Number(estimate.actual_duration_minutes)).to.equal(120);
  const before=await db('legacy_work_cost_estimates');const audit=await db('audit_events');await db.transaction(trx=>trx.raw(sql));expect(await db('legacy_work_cost_estimates')).to.deep.equal(before);expect(await db('audit_events')).to.deep.equal(audit);
  await db('users').where({user_id:3}).update({cost_rate:999});expect((await db('legacy_work_cost_estimates').where({estimate_id:estimate.estimate_id}).first()).cost_rate_snapshot).to.equal(estimate.cost_rate_snapshot);
 });
 it('installs capture and no-update/delete/truncate guards on the estimate sidecar',async()=>{const triggers=(await db.raw("SELECT tgname FROM pg_trigger WHERE tgrelid='legacy_work_cost_estimates'::regclass AND NOT tgisinternal")).rows.map(r=>r.tgname);expect(triggers).to.include.members(['ds2_audit_capture','ds2_audit_immutable','ds2_audit_no_truncate']);for(const action of [()=>db('legacy_work_cost_estimates').update({basis:'rewrite'}),()=>db('legacy_work_cost_estimates').del(),()=>db.raw('TRUNCATE legacy_work_cost_estimates')]){let err;try{await action();}catch(e){err=e;}expect(err).to.exist;}});
 it('captures the logged-for staff, preserves rate through duration edits and rejects silent reassignment',async()=>{
  const c=await db('customers').where({account_id:1}).first(),e=await db('billing_entities').where({account_id:1,is_default:true}).first();await db('users').where({user_id:3}).update({cost_rate:30});const [w]=await db('customer_transactions').insert({account_id:1,customer_id:c.customer_id,billing_entity_id:e.billing_entity_id,logged_for_user_id:3,general_work_description_id:1,transaction_date:'2020-01-01',transaction_type:'Time',quantity:2,unit_cost:100,total_transaction:200,is_transaction_billable:false,is_excess_to_subscription:false,created_by_user_id:1}).returning('*');expect(Number(w.cost_rate_snapshot)).to.equal(30);expect(w.cost_rate_source).to.equal('recorded');await db('users').where({user_id:3}).update({cost_rate:50});await db('customer_transactions').where({transaction_id:w.transaction_id}).update({quantity:3});expect(Number((await db('customer_transactions').where({transaction_id:w.transaction_id}).first()).cost_rate_snapshot)).to.equal(30);let err;try{await db('customer_transactions').where({transaction_id:w.transaction_id}).update({logged_for_user_id:2});}catch(e){err=e;}expect(err.code).to.equal('P0400');
 });
 it('audit chain verifies with system migration source',async()=>{expect((await db.raw('SELECT ds2_verify_audit(1) v')).rows[0].v.valid).to.equal(true);const events=await db('audit_events').where({entity:'legacy_work_cost_estimates'});expect(events.every(e=>e.actor_name==='system' && e.source==='migration/045.work_cost_snapshots')).to.equal(true);});
});
