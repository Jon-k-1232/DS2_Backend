'use strict';
const fs=require('fs'),harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
const files=['migrations/048.batched_work_entity_views.sql','migrations/049.separate_batched_reads_from_locking_views.sql'];
const sql=files.map(file=>fs.readFileSync(file,'utf8')).join('\n');
describe('H10 set-based entity read views',function(){
 this.timeout(180000);let db;const name=`ds2_mig_test_h10_${process.pid}`;
 before(async()=>{
  if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name,{through:47});db=harness.knexFor(name);
  const c=await db('customers').where({account_id:1}).first(),e=await db('billing_entities').where({account_id:1,is_default:true}).first();
  await db('customer_transactions').insert({account_id:1,customer_id:c.customer_id,billing_entity_id:e.billing_entity_id,logged_for_user_id:3,general_work_description_id:1,transaction_date:'2025-01-01',transaction_type:'Time',quantity:2,unit_cost:100,total_transaction:200,is_transaction_billable:true,is_excess_to_subscription:false,created_by_user_id:1});
 });
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 it('is plain SQL, rerunnable, preserves view columns and all source/audit rows',async()=>{
  for(const file of files)expect(()=>assertPlainSql(fs.readFileSync(file,'utf8'),file)).not.to.throw();
  const tables=['customer_transactions','customer_jobs','audit_events'];
  const before=await Promise.all(tables.map(t=>db(t).select('*')));
  const columns=()=>db('information_schema.columns').where({table_schema:'billing_scope'}).whereIn('table_name',tables.slice(0,2)).select('table_name','column_name','ordinal_position','data_type').orderBy(['table_name','ordinal_position']);
  const beforeColumns=await columns();
  await db.transaction(trx=>trx.raw(sql));await db.transaction(trx=>trx.raw(sql));
  expect(await columns()).deep.eq(beforeColumns);
  expect(await Promise.all(tables.map(t=>db(t).select('*')))).deep.eq(before);
 });
 it('returns exactly the original effective attribution for every seeded row and selection',async()=>{
  for(const entityId of [null,...(await db('billing_entities').select('billing_entity_id')).map(e=>e.billing_entity_id)])await db.transaction(async trx=>{
   await trx.raw("SELECT set_config('app.billing_entity_id',?,true)",[entityId==null?'':String(entityId)]);
   for(const [table,key] of [['customer_transactions','transaction_id'],['customer_jobs','customer_job_id']]){
    const expected=(await trx.raw(`SELECT to_jsonb(r)||jsonb_build_object('billing_entity_id',public.ds2_effective_entity(account_id,?,??,billing_entity_id)) AS row FROM ?? r WHERE ?::integer IS NULL OR public.ds2_effective_entity(account_id,?,??,billing_entity_id)=?::integer ${table==='customer_jobs'?'OR billing_entity_id IS NULL':''} ORDER BY ??`,[table,key,'public.'+table,entityId,table,key,entityId,key])).rows;
    const actual=(await trx.raw('SELECT to_jsonb(r) AS row FROM ?? r ORDER BY ??',['billing_reads.'+table,key])).rows;
    expect(actual).deep.eq(expected);
   }
  });
 });
 for(const mode of ['UPDATE','NO KEY UPDATE','SHARE','KEY SHARE'])it(`keeps FOR ${mode} working and locking the physical work/job row`,async()=>{
  const ctx=require('../../src/endpoints/billingEntities/entity-context');
  for(const [table,key] of [['customer_transactions','transaction_id'],['customer_jobs','customer_job_id']]){
   const row=await db('public.'+table).first();expect(row,'seeded '+table).to.exist;
   await ctx.run(null,()=>db.transaction(async trx=>{
    const locked=(await trx.raw(`SELECT * FROM ?? WHERE ??=? FOR ${mode}`,[table,key,row[key]])).rows;
    expect(locked).length(1);
    let failure;try{await db.transaction(other=>other.raw('SELECT * FROM ?? WHERE ??=? FOR UPDATE NOWAIT',['public.'+table,key,row[key]]));}catch(e){failure=e;}
    expect(failure?.code,'physical row stays locked').eq('55P03');
   }));
  }
 });

});
