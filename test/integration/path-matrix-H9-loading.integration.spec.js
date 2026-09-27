'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const customers=require('../../src/endpoints/customer/customer-service'),jobs=require('../../src/endpoints/job/job-service'),retainers=require('../../src/endpoints/retainer/retainer-service');
const {firstPages}=require('../../src/utils/listPayload');
describe('H9 bounded loading contracts',function(){
 this.timeout(180000);let s,c,j;
 before(async()=>{s=await new PathScenario().boot();c=await s.customer('H9 client');j=await s.job(c);});
 after(async()=>{if(s)await s.close();});
 const routes=[['/jobs/getJobs/1/1',jobs,'getJobsPage'],['/jobs/getActiveCustomerJobs/1/1/1',jobs,'getJobsPage'],['/jobs/getActiveCustomerJobs/1/1/1?currentCycle=true',jobs,'getJobsPage'],['/customer/lookup/1/1',customers,'searchCustomers'],['/retainers/getRetainers/1/1',retainers,'getRetainersPage']];
 for(const [url,service,method] of routes){
  it(`${url}: anonymous and employee refused with no writes`,async()=>{await s.refused(()=>s.get(url,null),401,401,/unauthorized|missing/i);await s.refused(()=>s.get(url,'staff'),403,403,/unauthorized|missing/i);});
  it(`${url}: other account refused with no writes`,()=>s.refused(()=>s.get(url.replace('/1/1','/7000/1')),403,403,/account/i));
  for(const query of ['limit=101','limit=-1','limit[]=20','page=0','page=1.1','page=1000001','search[x]=bad','sort[]=customer_job_id','direction=sideways'])it(`${url}: ${query} is 400 without writes`,()=>s.refused(()=>s.get(url+(url.includes('?')?'&':'?')+query),400,400,/Invalid|Search/));
  it(`${url}: database failure gives safe 500, no writes`,()=>s.fail(service,method,()=>s.refused(()=>s.get(url),500,500,/Unable/)));
  for(const role of ['admin','sa'])it(`${url}: ${role} gets bounded rows with no duplicate grids`,async()=>{const before=await s.allState(),body=ok(await s.get(url,role));expect(JSON.stringify(body)).not.match(/"(?:grid|treeGrid)":/);expect(await s.allState()).deep.equal(before);});
 }
 it('missing, foreign and malformed clients fail closed',async()=>{
  for(const id of ['2147483646','70001'])await s.refused(()=>s.get(`/jobs/getActiveCustomerJobs/1/1/${id}`),404,404,/not found/);
  for(const id of ['nope','999999999999999999999'])await s.refused(()=>s.get(`/jobs/getActiveCustomerJobs/1/1/${id}`),400,400,/Invalid/);
  await s.refused(()=>s.get('/customer/lookup/1/1?customerId=2147483646'),404,404,/not found/);
  await s.refused(()=>s.get('/customer/lookup/1/1?customerId[x]=1'),400,400,/Invalid/);
  await s.refused(()=>s.get('/jobs/getJobs/1/1?sort=toString'),400,400,/Invalid/);
 });
 it('manager reads remain allowed and invalid business selections preserve every row',async()=>{
  await s.db('users').where({user_id:3,account_id:1}).update({access_level:'manager'});
  try{for(const [url] of routes){const before=await s.allState();ok(await s.get(url,'staff'));expect(await s.allState()).deep.equal(before);await s.refused(()=>s.get(url+(url.includes('?')?'&':'?')+'entityId=2147483646','staff'),404,404,/not found/i);}}
  finally{await s.db('users').where({user_id:3,account_id:1}).update({access_level:'employee'});}
 });
 it('job choices respect business scope and keep shared legacy jobs',async()=>{
  const a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  const b=ok(await s.post('/billing-entities',{name:'H9 second business',legal_name:'H9 second',invoice_prefix:'HNINEB',reason:'Synthetic lookup scope'})).entity.billing_entity_id;
  const template={...j};delete template.customer_job_id;
  const [jobA]=await s.db('customer_jobs').insert({...template,billing_entity_id:a}).returning('*');
  const [jobB]=await s.db('customer_jobs').insert({...template,billing_entity_id:b}).returning('*');
  const before=await s.allState();
  for(const [entity,included,excluded] of [[a,jobA,jobB],[b,jobB,jobA]]){const body=ok(await s.get(`/jobs/getActiveCustomerJobs/1/1/${c.id}?entityId=${entity}`));const ids=body.activeCustomerJobData.activeCustomerJobs.map(r=>r.customer_job_id);expect(ids).include(included.customer_job_id);expect(ids).not.include(excluded.customer_job_id);expect(ids).include(j.customer_job_id);}
  expect(await s.allState()).deep.equal(before);
 });
 it('a current job version exposes links on an older version without account-wide rows',async()=>{
  const client=await s.customer('H9 family links'),job=await s.job(client);await s.work(client,job,10);
  const latest=ok(await s.get(`/jobs/getActiveCustomerJobs/1/1/${client.id}`)).activeCustomerJobData.activeCustomerJobs[0];expect(latest.customer_job_id).not.eq(job.customer_job_id);
  const before=await s.allState(),detail=ok(await s.get(`/jobs/getSingleJob/${latest.customer_job_id}/1/1`)).activeJobData.activeJobs[0];
  expect(detail.job_description).eq(latest.job_description);expect(detail.book_rate).eq(latest.book_rate);
  expect(detail.dependencies.transactionsCount).eq(1);expect(detail.dependencies.transactions[0].customer_job_id).eq(job.customer_job_id);expect(detail.dependencies.paymentsCount).eq(0);expect(await s.allState()).deep.equal(before);
 });
 it('selected job label hydration failure preserves every row',async()=>{
  await s.queryFault(/select .*customer_job_types.*book_rate.*customer_jobs/i,()=>s.refused(()=>s.get(`/jobs/getSingleJob/${j.customer_job_id}/1/1`),500,undefined,/path-matrix/));
 });
 it('every core create response carries changed records and only bounded affected pages',async()=>{
  const check=body=>{expect(body.committed).eq(true);expect(body).have.property('changed');expect(JSON.stringify(body)).not.match(/"(?:grid|treeGrid)":/);for(const [key,list] of Object.entries(body)){if(key.endsWith('List'))for(const block of Object.values(list)){expect(block.partial,key).eq(true);expect(block.pagination.limit,key).eq(20);for(const rows of Object.values(block))if(Array.isArray(rows))expect(rows.length,key).at.most(20);}}return body;};
  const customer=check(ok(await s.post('/customer/createCustomer/1/1',{customer:s.customerBody('H9 compact saves')}))).changed.customers[0],client={id:customer.customer_id,name:customer.display_name};
  const job=check(ok(await s.post('/jobs/createJob/1/1',{job:s.jobBody(client)}))).changed.jobs[0];
  const work=check(ok(await s.post('/transactions/createTransaction/1/1',{transaction:s.transaction(client,job,40)})));expect(work.changed.transactions).length(1);expect(work).not.have.property('accountJobsList');
  await s.finalize([client]);const invoice=await s.db('customer_invoices').where({account_id:1,customer_id:client.id}).whereNull('parent_invoice_id').first();
  const hold=check(ok(await s.post('/retainers/createRetainer/1/1',{retainer:{customerID:client.id,unitCost:10,typeOfHold:'Retainer',displayName:'H9 funds'}})));expect(hold.changed.retainers).length(1);
  const cash=check(ok(await s.post('/payments/createPayment/1/1',{payment:s.payment(client,5,{selectedInvoiceID:invoice.customer_invoice_id})})));expect(cash.changed.payments).length(1);
  const credit=check(ok(await s.post('/writeOffs/createWriteOffs/1/1',{writeOff:s.credit(client,2)})));expect(credit.changed.writeoffs).length(1);
  await s.check(client,{n:33,b:35,r:-10});
 });
 it('register search finds job notes and retainer labels, references and notes without client-name matches',async()=>{
  const client=await s.customer('H9 search owner');
  const saved=ok(await s.post('/jobs/createJob/1/1',{job:{...s.jobBody(client),notes:'H9 special job note'}})).changed.jobs[0];
  const hold=ok(await s.post('/retainers/createRetainer/1/1',{retainer:{customerID:client.id,unitCost:10,typeOfHold:'Retainer',displayName:'H9 special label',paymentReferenceNumber:'H9 special reference',note:'H9 special hold note'}})).changed.retainers[0];
  const before=await s.allState();
  expect(ok(await s.get('/jobs/getJobs/1/1?search=H9%20special%20job%20note')).accountJobsList.activeJobData.activeJobs.map(r=>r.customer_job_id)).deep.eq([saved.customer_job_id]);
  for(const term of ['H9 special label','H9 special reference','H9 special hold note'])expect(ok(await s.get('/retainers/getRetainers/1/1?search='+encodeURIComponent(term))).accountRetainersList.activeRetainerData.activeRetainers.map(r=>r.retainer_id)).deep.eq([hold.retainer_id]);
  expect(await s.allState()).deep.eq(before);
 });
 it('current-cycle lookup preserves exact job versions, excludes billed, nonbillable and retainer work, and scopes amounts by business',async()=>{
  const client=await s.customer('H9 cycle oracle'),job=await s.job(client);
  const a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  const b=(await s.db('billing_entities').where({account_id:1,name:'H9 second business'}).first()).billing_entity_id;
  await s.work(client,job,10,{entityId:a});await s.finalize([client]);
  const historical=ok(await s.get(`/jobs/getActiveCustomerJobs/1/1/${client.id}`)).activeCustomerJobData.activeCustomerJobs[0];
  await s.work(client,historical,40,{entityId:a});
  await s.work(client,historical,12,{entityId:a,isTransactionBillable:false});
  const hold=await s.retainer(client,20,{entityId:a});await s.work(client,historical,8,{entityId:a,selectedRetainerID:hold.retainer_id});
  await s.work(client,job,33,{entityId:b});
  const before=await s.allState();
  for(const [entity,amount,id] of [[a,40,historical.customer_job_id],[b,33,job.customer_job_id]]){
   const body=ok(await s.get(`/jobs/getActiveCustomerJobs/1/1/${client.id}?currentCycle=true&entityId=${entity}`));
   const rows=body.activeCustomerJobData.activeCustomerJobs;
   expect(Number(rows.find(r=>r.customer_job_id===id).total_transaction)).eq(amount);
   if(entity===a)expect(Number(rows.find(r=>r.customer_job_id===job.customer_job_id).total_transaction)).eq(0);
   const page=ok(await s.get(`/jobs/getActiveCustomerJobs/1/1/${client.id}?currentCycle=true&entityId=${entity}&limit=1&search=${id}`));
   expect(page.activeCustomerJobData.activeCustomerJobs).length(1);
  }
  expect(await s.allState()).deep.eq(before);
 });
 it('current-cycle query refuses malformed or account-wide projections without writes',async()=>{
  for(const suffix of ['currentCycle=1','currentCycle[]=true','currentCycle[x]=true'])await s.refused(()=>s.get(`/jobs/getActiveCustomerJobs/1/1/${c.id}?${suffix}`),400,400,/Invalid/);
  await s.refused(()=>s.get('/jobs/getJobs/1/1?currentCycle=true'),400,400,/Invalid/);
  const before=await s.allState();ok(await s.get(`/jobs/getActiveCustomerJobs/1/1/${c.id}?currentCycle=false`));expect(await s.allState()).deep.eq(before);
 });
 it('invoice-only profile returns snapshots without the jobs, work or other client history',async()=>{
  const client=await s.customer('H9 invoice projection'),job=await s.job(client);await s.work(client,job,21);await s.finalize([client]);
  const a=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  const b=(await s.db('billing_entities').where({account_id:1,name:'H9 second business'}).first()).billing_entity_id;
  const url=`/customer/activeCustomers/customerByID/1/1/${client.id}?section=invoices`;
  const before=await s.allState();
  for(const role of ['admin','sa']){const body=ok(await s.get(url+`&entityId=${a}`,role));expect(Object.keys(body).sort()).deep.eq(['customerInvoiceData','status']);expect(body.customerInvoiceData.customerInvoices).length(1);}
  expect(ok(await s.get(url+`&entityId=${b}`)).customerInvoiceData.customerInvoices).deep.eq([]);
  expect(await s.allState()).deep.eq(before);
 });
 it('invoice-only profile retains role, tenant and customer guards without writes',async()=>{
  const url=`/customer/activeCustomers/customerByID/1/1/${c.id}?section=invoices`;
  await s.refused(()=>s.get(url,null),401,401,/unauthorized|missing/i);
  await s.refused(()=>s.get(url,'staff'),403,403,/unauthorized|missing/i);
  await s.refused(()=>s.get(url.replace('/1/1/','/7000/1/')),403,403,/account/i);
  for(const id of [2147483646,70001])await s.refused(()=>s.get(`/customer/activeCustomers/customerByID/1/1/${id}?section=invoices`),404,404,/not found/i);
 });
 it('invoice-only profile rejects malformed options and survives query failures with no writes',async()=>{
  for(const suffix of ['section=other','section[]=invoices','section[x]=invoices'])await s.refused(()=>s.get(`/customer/activeCustomers/customerByID/1/1/${c.id}?${suffix}`),400,400,/Invalid/);
  await s.refused(()=>s.get('/customer/activeCustomers/customerByID/1/1/nope?section=invoices'),400,400,/Invalid/);
  await s.fail(require('../../src/endpoints/invoice/invoice-service'),'getCustomerInvoiceByID',()=>s.refused(()=>s.get(`/customer/activeCustomers/customerByID/1/1/${c.id}?section=invoices`),200,500,/path-matrix/));
 });
 it('all save list helpers are bounded first pages with one representation',async()=>{
  const data=await firstPages(s.db,1,['customers','jobs','transactions','payments','writeoffs','retainers','invoices']);
  for(const list of Object.values(data))for(const block of Object.values(list)){expect(block.partial).eq(true);expect(block.pagination.page).eq(1);expect(block.pagination.limit).eq(20);expect(block).not.have.property('grid');for(const value of Object.values(block))if(Array.isArray(value))expect(value.length).at.most(20);}
 });
 it('job save identifies the changed job even if it is outside the first page',async()=>{
  const other=await s.customer('H9 saved job');const body=ok(await s.post('/jobs/createJob/1/1',{job:s.jobBody(other)}));
  expect(body.changed.jobs).length(1);expect(body.changed.jobs[0].customer_id).eq(other.id);expect(body.committed).eq(true);expect(body.accountJobsList.activeJobData.pagination.limit).eq(20);expect(JSON.stringify(body)).not.match(/"(?:grid|treeGrid)":/);
 });
 it('empty search pages preserve total count and stable ordering',async()=>{
  const asc=ok(await s.get('/jobs/getJobs/1/1?limit=1&sort=customer_job_id&direction=asc'));
  const desc=ok(await s.get('/jobs/getJobs/1/1?limit=1&sort=customer_job_id&direction=desc'));
  expect(asc.accountJobsList.activeJobData.activeJobs[0].customer_job_id).below(desc.accountJobsList.activeJobData.activeJobs[0].customer_job_id);
  const empty=ok(await s.get('/jobs/getJobs/1/1?page=999'));expect(empty.accountJobsList.activeJobData.activeJobs).deep.eq([]);expect(empty.accountJobsList.activeJobData.pagination.totalItems).above(0);
 });
 for(const [section,service,method,key,rowsKey,table] of [
  ['payments',require('../../src/endpoints/payments/payments-service'),'getActivePaymentsForCustomer','customerPaymentData','customerPayments','customer_payments'],
  ['retainers',retainers,'getCustomerRetainersByID','customerRetainerData','customerRetainers','customer_retainers_and_prepayments']
 ]){
  it(`${section}-only profile returns the selected client's complete history without unrelated sections`,async()=>{
   const sample=await s.db(table).where({account_id:1}).whereNotNull('customer_id').first();expect(sample).not.eq(undefined);
   const url=`/customer/activeCustomers/customerByID/1/1/${sample.customer_id}?section=${section}`;
   const before=await s.allState();
   for(const role of ['admin','sa']){const body=ok(await s.get(url,role));expect(Object.keys(body).sort()).deep.eq([key,'status'].sort());expect(body[key][rowsKey].length).above(0);expect(body[key][rowsKey].every(r=>r.customer_id===sample.customer_id)).eq(true);expect(JSON.stringify(body)).not.match(/"(?:grid|treeGrid)":/);}
   expect(await s.allState()).deep.eq(before);
  });
  it(`${section}-only profile preserves every row on role, tenant, client and database failures`,async()=>{
   const url=`/customer/activeCustomers/customerByID/1/1/${c.id}?section=${section}`;
   await s.refused(()=>s.get(url,null),401,401,/unauthorized|missing/i);await s.refused(()=>s.get(url,'staff'),403,403,/unauthorized|missing/i);
   await s.refused(()=>s.get(url.replace('/1/1/','/7000/1/')),403,403,/account/i);
   await s.refused(()=>s.get(`/customer/activeCustomers/customerByID/1/1/70001?section=${section}`),404,404,/not found/i);
   await s.fail(service,method,()=>s.refused(()=>s.get(url),200,500,/path-matrix/));
  });
 }
 it('directory is compact up to 1000 clients, search replaces it above threshold',async()=>{
  let data=await customers.getCustomerDirectory(s.db,1);expect(data.remote).eq(false);expect(data.activeCustomers.length).eq(data.totalCount);
  const rows=Array.from({length:1001-data.totalCount},(_,i)=>({account_id:1,display_name:`H9 synthetic ${String(i).padStart(4,'0')}`,customer_name:`H9 synthetic ${i}`,is_commercial_customer:false,is_customer_active:true,is_billable:true,is_recurring:false}));
  await s.db.batchInsert('customers',rows,200);
  data=await customers.getCustomerDirectory(s.db,1);expect(data).include({remote:true,totalCount:1001,threshold:1000});expect(data.activeCustomers).deep.eq([]);
  const response=ok(await s.get('/customer/lookup/1/1?search=H9%20synthetic%200003'));expect(response.customers).length(1);expect(response.customers[0].display_name).eq('H9 synthetic 0003');
  expect(Object.keys(response.customers[0])).not.include('customer_email');
 });

});
