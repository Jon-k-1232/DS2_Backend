'use strict';
const fs=require('fs'),harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
const file='migrations/047.bounded_lookup_indexes.sql',sql=fs.readFileSync(file,'utf8');
describe('H9 bounded lookup indexes',function(){
 this.timeout(180000);let db;const name=`ds2_mig_test_h9_${process.pid}`;
 before(async()=>{if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name,{through:46});db=harness.knexFor(name);});
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 it('is plain SQL, idempotent and changes no source or audit rows',async()=>{
  expect(()=>assertPlainSql(sql,file)).not.to.throw();
  const tables=['customers','customer_jobs','customer_retainers_and_prepayments','audit_events'];
  const before=await Promise.all(tables.map(t=>db(t).select('*')));
  await db.transaction(trx=>trx.raw(sql));await db.transaction(trx=>trx.raw(sql));
  const after=await Promise.all(tables.map(t=>db(t).select('*')));expect(after).to.deep.equal(before);
  const indexes=await db('pg_indexes').whereIn('indexname',['customer_jobs_account_customer_idx','customer_jobs_account_family_idx','customers_account_directory_idx','retainers_account_created_idx','retainers_account_customer_idx']);expect(indexes).to.have.length(5);
 });
});
