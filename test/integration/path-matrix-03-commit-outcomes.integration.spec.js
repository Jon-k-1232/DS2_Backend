'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const service=area=>require(`../../src/endpoints/${area}/${area}-service`);

describe('Path matrix: committed CRUD is not reported as a failed write',function(){
 this.timeout(180000);let s,serial=0;
 before(async()=>{s=await new PathScenario().boot();});
 after(async()=>{if(s)await s.close();});
 const specs=[
  {area:'jobCategories',kind:'jobCategory',table:'customer_job_categories',id:'customer_job_category_id',create:'createJobCategory',update:'updateJobCategory',del:'deleteJobCategory',refresh:'getActiveJobCategories',name:'customer_job_category',fields:n=>({category:n,isActive:true}),edit:(p,id)=>({...p,customerJobCategoryID:id,selectedNewJobCategory:p.category+' edited',isJobCategoryActive:true})},
  {area:'jobType',prefix:'jobTypes',kind:'jobType',table:'customer_job_types',id:'job_type_id',create:'createJobType',update:'updateJobType',del:'deleteJobType',refresh:'getActiveJobTypes',name:'job_description',fields:n=>({customerJobCategory:1,jobDescription:n,bookRate:10,estimatedStraightTime:6,isActive:true}),edit:(p,id)=>({...p,jobTypeID:id,jobDescription:p.jobDescription+' edited'})},
  {area:'workDescriptions',kind:'workDescription',table:'customer_general_work_descriptions',id:'general_work_description_id',create:'createWorkDescription',update:'updateWorkDescription',del:'deleteWorkDescription',refresh:'getActiveWorkDescriptions',name:'general_work_description',fields:n=>({generalWorkDescription:n,estimatedTime:6,isGeneralWorkDescriptionActive:true}),edit:(p,id)=>({...p,generalWorkDescriptionID:id,generalWorkDescription:p.generalWorkDescription+' edited'})},
  {area:'quotes',kind:'quote',table:'customer_quotes',id:'customer_quote_id',create:'createQuote',update:'updateQuote',del:'deleteQuote',refresh:'getActiveQuotes',name:'notes',fields:n=>({customer_id:1,customer_job_id:1,amount_quoted:100,is_quote_active:true,notes:n}),edit:(p,id)=>({...p,customer_quote_id:id,amount_quoted:75,notes:p.notes+' edited'})},
  {area:'user',kind:'user',table:'users',id:'user_id',create:'createUser',update:'updateUser',del:'deleteUser',refresh:'getActiveAccountUsers',name:'display_name',fields:n=>({userDisplayName:n,userEmail:n+'@matrix.test',costRate:25,billingRate:100,role:'Tester',accessLevel:'User',isActive:true}),edit:(p,id)=>({...p,userID:id,userDisplayName:p.userDisplayName+' edited'})}
 ];
 for(const item of specs)for(const operation of ['create','update','delete'])it(`${item.prefix||item.area} ${operation} | refresh failure reports committed success and exactly one mutation`,async()=>{
  const name=`PM_${item.area}_${operation}_${++serial}`,p={accountID:1,userID:1,...item.fields(name)},prefix=item.prefix||item.area;
  const route=(op,id)=>item.area==='quotes'?`/quotes/${op==='create'?item.create:op==='update'?item.update:item.del+(id?'/1/'+id:'')}`:item.area==='user'?`/user/${op==='create'?item.create:op==='update'?item.update:item.del}/1/${op==='delete'?id:1}`:`/${prefix}/${op==='create'?item.create:op==='update'?item.update:item.del+(id?'/'+id:'')}/1/1`;
  let row;if(operation!=='create'){ok(await s.post(route('create'),{[item.kind]:p}));row=await s.db(item.table).where({[item.name]:name,account_id:1}).first();expect(row).to.exist;}
  const countBefore=Number((await s.db(item.table).count('* as n').first()).n);
  const response=await s.fail(service(item.area),item.refresh,()=>operation==='create'?s.post(route('create'),{[item.kind]:p}):operation==='update'?s.put(route('update'),{[item.kind]:item.edit(p,row[item.id])}):s.del(route('delete',row[item.id])));
  expect(response.status,JSON.stringify(response.body)).eq(200);expect(response.body.status).eq(200);expect(response.body.committed).eq(true);expect(response.body.warnings.join(' ')).match(/saved.*[Rr]eload.*do not submit/);
  expect(response.body.message,'existing forms render the message field').match(/saved.*[Rr]eload.*do not submit/);
  if(item.area==='jobCategories')expect(response.body.message).match(/^Successfully saved job category changes\./);
  if(item.area==='jobType')expect(response.body.message).match(/^Successfully saved job type changes\./);
  const countAfter=Number((await s.db(item.table).count('* as n').first()).n);expect(countAfter).eq(countBefore+(operation==='create'?1:operation==='delete'?-1:0));
  const saved=await s.db(item.table).where({[item.name]:name+(operation==='update'?' edited':''),account_id:1}).first();
  if(operation==='delete')expect(saved).eq(undefined);else {expect(saved).to.exist;if(item.area==='quotes')expect(Number(saved.amount_quoted)).eq(operation==='create'?100:75);}
 });
 for(const operation of ['create','update','delete'])it(`customer ${operation} | postcommit list failure reports saved outcome`,async()=>{
  const name=`PM_customer_${operation}_${++serial}`;let c;
  if(operation!=='create')c=await s.customer(name);
  const svc=service('customer'),original=svc.getActiveCustomers;let calls=0;
  const r=await s.stub(svc,'getActiveCustomers',function(...args){if(operation==='create'&&calls++===0)return original.apply(this,args);throw Error('path-matrix postcommit read failure');},()=>operation==='create'?s.post('/customer/createCustomer/1/1',{customer:s.customerBody(name)}):operation==='update'?s.put('/customer/updateCustomer/1/1',{customer:{...c.payload,customerCity:'Tucson'}}):s.del(`/customer/deleteCustomer/${c.id}/1/1`));
  expect(r.status,JSON.stringify(r.body)).eq(200);expect(r.body.status).eq(200);expect(r.body.committed).eq(true);expect(r.body.warnings.join(' ')).match(/do not submit/);expect(r.body.message,'existing forms render the message field').match(/saved.*[Rr]eload.*do not submit/);
  const rows=await s.db('customers').where({account_id:1,display_name:name});expect(rows).length(operation==='delete'?0:1);
  if(operation==='update')expect((await s.db('customer_information').where({customer_id:c.id,account_id:1}).first()).customer_city).eq('Tucson');
 });
 for(const operation of ['create','update','delete'])it(`job ${operation} | postcommit list failure reports saved outcome`,async()=>{
  const c=await s.customer(`PM_job_${operation}_${++serial}`);let j;if(operation!=='create')j=await s.job(c);
  const body={job:{...s.jobBody(c),customerJobID:j?.customer_job_id,notes:'saved once'}};
  const r=await s.fail(service('job'),'getActiveJobs',()=>operation==='create'?s.post('/jobs/createJob/1/1',body):operation==='update'?s.put('/jobs/updateJob/1/1',body):s.del(`/jobs/deleteJob/${j.customer_job_id}/1/1`));
  expect(r.status,JSON.stringify(r.body)).eq(200);expect(r.body.status).eq(200);expect(r.body.committed).eq(true);expect(r.body.warnings.join(' ')).match(/do not submit/);expect(r.body.message,'existing forms render the message field').match(/saved.*[Rr]eload.*do not submit/);
  expect(r.body.message).match(/^Successfully saved job changes\./);
  const rows=await s.db('customer_jobs').where({account_id:1,customer_id:c.id});expect(rows).length(operation==='delete'?0:1);if(operation!=='delete')expect(rows[0].notes).eq('saved once');
 });
 for(const operation of ['create','update','delete'])it(`recurringCustomer ${operation} | postcommit list failure reports saved outcome`,async()=>{
  const c=await s.customer(`PM_recurring_${operation}_${++serial}`);
  const p={accountID:1,userID:1,customerID:c.id,subscriptionFrequency:'Monthly',billingCycle:1,recurringAmount:100,startDate:'2026-01-01',isActive:true};let row;
  if(operation!=='create'){ok(await s.post('/recurringCustomer/createRecurringCustomer/1/1',{recurringCustomer:p}));row=await s.db('recurring_customers').where({customer_id:c.id}).first();}
  const r=await s.fail(service('recurringCustomer'),'getActiveRecurringCustomers',()=>operation==='create'?s.post('/recurringCustomer/createRecurringCustomer/1/1',{recurringCustomer:p}):operation==='update'?s.put('/recurringCustomer/updateRecurringCustomer',{recurringCustomer:{...p,recurringCustomerID:row.recurring_customer_id,recurringAmount:75}}):s.del(`/recurringCustomer/deleteRecurringCustomer/1/${row.recurring_customer_id}`));
  expect(r.status,JSON.stringify(r.body)).eq(200);expect(r.body.status).eq(200);expect(r.body.committed).eq(true);expect(r.body.warnings.join(' ')).match(/do not submit/);expect(r.body.message,'existing forms render the message field').match(/saved.*[Rr]eload.*do not submit/);
  const rows=await s.db('recurring_customers').where({customer_id:c.id});expect(rows).length(1);expect(rows[0].is_recurring_customer_active).eq(operation!=='delete');expect(Number(rows[0].recurring_bill_amount)).eq(operation==='update'?75:100);
 });
});
