'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {today}=require('./_scenario');
const times=require('../../src/endpoints/timesheets/timesheets-service');
const users=require('../../src/endpoints/user/user-service');
const review=require('../../src/endpoints/billingReview/billingReview-service');
const suggestions=require('../../src/endpoints/timesheets/timesheet-suggestions-service');

describe('Path matrix: timesheet and billing review failures',function(){
 this.timeout(180000);let s;
 before(async()=>{s=await new PathScenario().boot();});after(async()=>{if(s)await s.close();});
 const entry=async()=> (await s.db('timesheet_entries').insert({account_id:1,user_id:3,timesheet_name:'PM-timesheet.xlsx',time_tracker_start_date:today(),time_tracker_end_date:today(),date:today(),duration:6,notes:'Matrix work',category:'Tax work',is_processed:false,is_deleted:false}).returning('*'))[0];
 const reads=[['getTimesheetEntries/1/1',times,'getOutstandingTimesheetEntries'],['getTimesheetEntriesByUserID/3/1/1',times,'getPendingTimesheetEntriesByUserID'],['getAllTimesheetsForEmployeeByUserID/3/1/1',times,'getTimesheetSummariesByUser'],['fetchTimesheetsByMonth/3/1/1',times,'getTimesheetSummariesByUserAndMonth'],['countsByEmployee/1/1',users,'getActiveAccountUsers']];
 for(const [url,svc,method] of reads)it(`GET /timesheets/${url} | ${method} database failure: 500 and no writes`,async()=>{
  await s.fail(svc,method,()=>s.refused(()=>s.get('/timesheets/'+url),500,undefined,/path-matrix/));
 });
 it('GET /timesheets/countsByEmployee | per-employee count failure degrades to zero without writes',async()=>{
  const before=await s.allState();const r=await s.fail(times,'getTimesheetEntryCountsByEmployee',()=>s.get('/timesheets/countsByEmployee/1/1'));ok(r);
  expect(r.body.timesheetsByEmployees).length(3);for(const e of r.body.timesheetsByEmployees)for(const k of ['transaction_count','trackers_to_date','trackers_by_month','ai_processing_count','ai_completed_count','ai_failed_count'])expect(e[k]).eq(0);
  expect(await s.allState()).deep.eq(before);
 });
 it('DELETE /timesheets/deleteTimesheetEntry | malformed ID is 400 without writes',async()=>{
  await s.refused(()=>s.del('/timesheets/deleteTimesheetEntry/bad/1/1'),400,400,/valid timesheetEntryID/);
 });
 it('DELETE /timesheets/deleteTimesheetEntry | lost conditional claim is 409 without writes',async()=>{
  const e=await entry();await s.stub(times,'deleteTimesheetEntryIfPending',async()=>[],()=>s.refused(()=>s.del(`/timesheets/deleteTimesheetEntry/${e.timesheet_entry_id}/1/1`),409,409,/processed or deleted by someone else/));
 });
 it('DELETE /timesheets/deleteTimesheetEntry | database update failure is 500 without writes',async()=>{
  const e=await entry();await s.fail(times,'deleteTimesheetEntryIfPending',()=>s.refused(()=>s.del(`/timesheets/deleteTimesheetEntry/${e.timesheet_entry_id}/1/1`),500,undefined,/path-matrix/));
 });
 it('POST /timesheets/moveToTransactions | final suggestion-write failure rolls back work, claim and audit',async()=>{
  const e=await entry(),c=await s.customer('PM manual apply rollback'),j=await s.job(c);
  await s.fail(suggestions,'updateSuggestion',()=>s.refused(()=>s.post('/timesheets/moveToTransactions/1/1',{entry:{...s.transaction(c,j,10),timesheetEntryID:e.timesheet_entry_id}}),500,undefined,/path-matrix/));
 });
 for(const [path,body] of [['/billing-review/reprocess/1/1',{}],['/billing-review/reprocess-with-overrides/1/1/1',{}],['/timesheets/ai/kickoff/1/1',{entry_ids:[1]}]])it(`POST ${path} | disabled feature refuses 503 without writes`,async()=>{
  const old=process.env.TIME_TRACKER_AI_FEATURE_FLAG;process.env.TIME_TRACKER_AI_FEATURE_FLAG='off';try{await s.refused(()=>s.post(path,body),503,path.startsWith('/timesheets')?503:undefined,/not enabled/);}finally{process.env.TIME_TRACKER_AI_FEATURE_FLAG=old;}
 });
 const enabled=async fn=>{const old=process.env.TIME_TRACKER_AI_FEATURE_FLAG;process.env.TIME_TRACKER_AI_FEATURE_FLAG='on';try{return await fn();}finally{process.env.TIME_TRACKER_AI_FEATURE_FLAG=old;}};
 it('POST /billing-review/reprocess | invalid mode refuses 400 without writes',async()=>{
  await enabled(()=>s.refused(()=>s.post('/billing-review/reprocess/1/1',{mode:'wrong'}),400,undefined,/mode/i));
 });
 it('POST /billing-review/reprocess | query failure refuses 500 without writes',async()=>{
  await enabled(()=>s.fail(review,'listEntriesForReprocess',()=>s.refused(()=>s.post('/billing-review/reprocess/1/1',{}),500,undefined,/path-matrix/)));
 });
 it('POST /billing-review/reprocess | no matching entries succeeds without writes',async()=>{
  const before=await s.allState();const r=await enabled(()=>s.stub(review,'listEntriesForReprocess',async()=>[],()=>s.post('/billing-review/reprocess/1/1',{})));expect(r.status).eq(200);expect(r.body.queued).eq(0);expect(await s.allState()).deep.eq(before);
 });
 for(const path of ['/notifications/1/1','/notifications/1/1/unread-count','/user/fetchSingleUser/1/1','/timesheets/getTimesheetEntriesByUserID/1/1/3','/timesheets/getAllTimesheetsForEmployeeByUserID/1/1/3','/timesheets/fetchTimesheetsByMonth/1/1/3','/time-tracking/history/1/1','/time-tracking/history/download/1/1','/time-tracking/download/by-name/1/1'])it(`GET ${path} | staff cannot access another employee: 403 and no writes`,async()=>{
  await s.refused(()=>s.get(path,'staff'),403,403,/Access denied for this user/);
 });
 for(const path of ['/notifications/1/1/read-all','/notifications/9999/1/1/read'])it(`PUT ${path} | staff cannot mutate another employee: 403 and no writes`,async()=>{
  await s.refused(()=>s.put(path,{},'staff'),403,403,/Access denied for this user/);
 });
});
