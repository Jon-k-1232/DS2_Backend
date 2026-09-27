'use strict';
const fs=require('fs'),harness=require('./helpers/pgHarness');
const {assertPlainSql}=require('../../scripts/migrate');
const file='migrations/046.reviewed_work_cost_snapshots.sql',sql=fs.readFileSync(file,'utf8');
describe('H5 reviewed work provenance migration',function(){
 this.timeout(180000);let db;const name=`ds2_mig_test_h5review_${process.pid}`;
 before(async()=>{if(!harness.isAvailable())throw Error('Local sandbox required');harness.dropDb(name,{through:45});db=harness.knexFor(name);});
 after(async()=>{if(db)await db.destroy();harness.dropDb(name);});
 it('is plain SQL and idempotent with no data changes',async()=>{expect(()=>assertPlainSql(sql,file)).not.to.throw();const before=await db('audit_events');await db.transaction(trx=>trx.raw(sql));await db.transaction(trx=>trx.raw(sql));expect(await db('audit_events')).to.deep.equal(before);});
 it('retains first-recorded cost through normal matching and captures a reasoned correction',async()=>{
  await db('users').where({user_id:3}).update({cost_rate:30});await db('users').where({user_id:2}).update({cost_rate:40});const staff=await db('users').where({user_id:3}).first();
  const [source]=await db('timesheet_entries').insert({account_id:1,user_id:1,notes:'Synthetic migration work',category:'General Consulting',employee_name:staff.display_name,matched_user_id:3,timesheet_name:'H5 migration',time_tracker_start_date:'2026-01-01',time_tracker_end_date:'2026-01-01',date:'2026-01-01',duration:120}).returning('*');
  await db('users').where({user_id:3}).update({cost_rate:70});await db('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).update({matched_user_id:3,duration:68});let row=await db('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).first();expect(Number(row.cost_rate_snapshot)).to.equal(30);expect(Number(row.actual_duration_minutes)).to.equal(68);
  let err;try{await db('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).update({matched_user_id:2});}catch(e){err=e;}expect(err.code).to.equal('P0400');expect(await db('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).first()).to.deep.equal(row);
  await db.transaction(async trx=>{await trx.raw("SELECT set_config('app.cost_change_reason','Correct tracker owner',true)");await trx('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).update({matched_user_id:2});});row=await db('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).first();expect(Number(row.cost_rate_snapshot)).to.equal(40);
 });
 it('does not invent a historical rate when first matching an unknown employee',async()=>{const [source]=await db('timesheet_entries').insert({account_id:1,user_id:1,notes:'Synthetic migration work',category:'General Consulting',employee_name:'Unknown synthetic',timesheet_name:'H5 unknown',time_tracker_start_date:'2026-01-01',time_tracker_end_date:'2026-01-01',date:'2026-01-01',duration:60}).returning('*');await db('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).update({matched_user_id:3});const row=await db('timesheet_entries').where({timesheet_entry_id:source.timesheet_entry_id}).first();expect(row.cost_rate_snapshot).to.equal(null);expect(row.cost_rate_source).to.equal('unknown');});
});
