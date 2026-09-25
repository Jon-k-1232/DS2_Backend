'use strict';
const {Scenario,ok,expect,money,today}=require('./_scenario');
describe('duration boundaries through manual, held review, invoice, audit, AR and analytics',function(){
 this.timeout(180000);const s=new Scenario();let c,j,total=0;
 const cases=[[1,.1,13.75],[6,.1,13.75],[7,.2,27.5],[14,.3,41.25],[15,.3,41.25],[16,.3,41.25],[59,1,137.5],[60,1,137.5],[61,1.1,151.25]];
 before(async()=>{await s.boot();c=await s.customer('Six minute boundaries');j=await s.job(c);});after(()=>s.close());
 for(const [minutes,quantity,amount] of cases) it(`${minutes} min manually and through held tracker review cost $${amount} each`,async()=>{
  const row=await s.work(c,j,amount,{transactionType:'Time',quantity,unitCost:137.5,minutes,detailedJobDescription:`Manual ${minutes} minutes`});
  ok(await s.editWork(row,{detailedJobDescription:`Reviewed ${minutes} minutes`}));
  const [entry]=await s.db('timesheet_entries').insert({account_id:1,user_id:3,timesheet_name:`boundary-${minutes}.xlsx`,time_tracker_start_date:today(),time_tracker_end_date:today(),date:today(),duration:minutes,notes:`Tracker ${minutes}`,category:'Tax work',is_processed:false,is_deleted:false}).returning('*');
  const body=ok(await s.put(`/billing-review/${entry.timesheet_entry_id}/1/1`,{customer_id:c.id,customer_job_id:j.customer_job_id,general_work_description_id:1,transaction_date:today(),logged_for_user_id:3,transaction_type:'Time',unit_cost:137.5,duration_minutes:minutes,detailed_work_description:`Held ${minutes} minutes`,reason:'Review recorded duration'}));
  const saved=await s.db('customer_transactions').where({account_id:1,customer_id:c.id}).orderBy('transaction_id','desc').first();
  expect(money(saved.quantity)).to.equal(quantity);expect(money(saved.total_transaction)).to.equal(amount);
  expect((await s.db('timesheet_entries').where({timesheet_entry_id:entry.timesheet_entry_id}).first()).duration).to.equal(minutes);
  total=money(total+amount*2);await s.check(c,{n:total,b:0});
 });
 it('keeps actual tracker hours separate from rounded billed hours and freezes $1210 in the PDF',async()=>{
  // .1+.1+.2+.3+.3+.3+1+1+1.1 = 4.4; $605.
  expect(total).to.equal(1210);
  const analytics=await require('../../src/endpoints/analytics/analytics-service').getTimeAllocation(s.db,1,{year:Number(today().slice(0,4))});
  expect(analytics.summary.total_hours).to.equal(8.8);
  expect(analytics.trackerByCategory.find(r=>r.category==='Tax work').hours).to.equal(3.98);
  await s.statement(c,await s.finalize([c]),1,[0,1210,0,0,0,1210]);
 });
});
