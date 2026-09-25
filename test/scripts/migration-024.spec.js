'use strict';
const fs=require('fs'); const path=require('path'); const harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
describe('024 retainer events and duplicate history migration',function(){
 this.timeout(30000); const name=`ds2_mig_test_024_${process.pid}`; let db;
 const sql=fs.readFileSync(path.join(__dirname,'../../migrations/024.retainer_events_duplicates.sql'),'utf8');
 before(async()=>{if(!harness.isAvailable()) throw Error('Local database required'); harness.createThrowawayDb(name); db=harness.knexFor(name); await db.raw(fs.readFileSync(path.join(__dirname,'../../migrations/023.sent_invoice_locks.sql'),'utf8'));});
 after(async()=>{if(db) await db.destroy();harness.dropDb(name);});
 it('is plain SQL and reruns atomically without backfilling business rows',async()=>{
  expect(()=>assertPlainSql(sql,'024')).not.to.throw();
  await db.transaction(t=>t.raw(sql));
  const schema=()=>db.raw("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('retainer_events','duplicate_flags','duplicate_history') ORDER BY 1,2");
  const before=(await schema()).rows; await db.transaction(t=>t.raw(sql)); expect((await schema()).rows).to.deep.equal(before);
  for(const table of ['retainer_events','duplicate_flags','duplicate_history','customers']) expect((await db(table).count({n:'*'}).first()).n).to.equal('0');
 });
 it('installs immutable event/history/snapshot guards and event membership',async()=>{
  const {rows}=await db.raw("SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND ((c.relname IN ('retainer_events','duplicate_history') AND t.tgname='ds2_immutable') OR t.tgname='ds2_retainer_event_snapshot')");
  expect(rows).to.have.length(3);
  const c=(await db.raw("SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='invoice_statement_members_table_name_check'")).rows[0]; expect(c.d).to.include('retainer_events');
 });
});
