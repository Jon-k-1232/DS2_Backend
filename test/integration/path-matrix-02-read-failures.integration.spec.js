'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const endpoint=(name,file=name+'-service')=>require(`../../src/endpoints/${name}/${file}`);
const cases=[
 ['/account/AccountInformation/1/1','account','getAccount',500,500,/Error retrieving account information/],
 ['/account/automations/1/1','account','listAccountAutomations',500,500,/path-matrix/, 'automation-settings-service'],
 ['/customer/activeCustomers/customerByID/1/1/1','customer','getCustomerByID',200,500],
 ['/customer/activeCustomers/1/1','customer','getActiveCustomersPaginated',500,500],
 ['/initialData/initialBlob/1/1','customer','getActiveCustomers',200,500],
 ['/jobs/getSingleJob/1/1/1','job','getSingleJob',500],
 ['/jobs/getActiveCustomerJobs/1/1/1','job','getActiveCustomerJobs',500],
 ['/jobCategories/getSingleJobCategory/1/1/1','jobCategories','getSingleJobCategory',500],
 ['/jobTypes/getSingleJobType/1/1/1','jobType','getSingleJobType',500],
 ['/workDescriptions/getSingleWorkDescription/1/1/1','workDescriptions','getSingleWorkDescription',200,500],
 ['/quotes/getActiveQuotes/1/1','quotes','getActiveQuotes',200,500],
 ['/recurringCustomer/getActiveRecurringCustomers/1/1','recurringCustomer','getActiveRecurringCustomers',500],
 ['/user/fetchSingleUser/1/1','user','fetchUser',500],
 ['/notifications/1/1','notifications','listForUser',500],
 ['/notifications/1/1/unread-count','notifications','unreadCount',500],
 ['/time-tracker-staff/1/1','timeTrackerStaff','listByAccount',500],
 ['/accountsReceivable/aging/1/1','accountsReceivable','getAging',500,500,undefined,'accounts-receivable-service'],
 ['/accountsReceivable/aging/1/1/export','accountsReceivable','getAging',500,500,undefined,'accounts-receivable-service'],
 ['/accountAudit/customers/1/1','accountAudit','getAuditableCustomers',500,500,undefined,'account-audit-service'],
 ['/accountAudit/audit/1/1/1','accountAudit','getAuditById',500,500,undefined,'account-audit-service'],
 ['/accountAudit/audit/1/pdf/1/1','accountAudit','getAuditById',500,500,undefined,'account-audit-service'],
 ['/accountAudit/customer/1/1/1','accountAudit','getAuditsForCustomer',500,500,undefined,'account-audit-service'],
 ...[['clientRates','getClientRates'],['timeAllocation','getTimeAllocation'],['wipAging','getWipAging'],['jobBudgets','getJobBudgets'],['taxSeasonCapacity','getTaxSeasonCapacity'],['exclusions','getExcludableCustomers']].map(([p,m])=>[`/analytics/${p}/1/1`,'analytics',m,200,500]),
 ...[['clientRates','getClientRates'],['timeAllocation','getTimeAllocation']].map(([p,m])=>[`/analytics/${p}/1/1/export`,'analytics',m,500,500]),
 ['/analytics/yearEndPacket/1/1','analytics','getClientRates',500,500],
 ['/billing-review/distinct-entities/1/1','billingReview','listDistinctEntities',500],
 ['/billing-review/earliest-unbilled-month/1/1','billingReview','earliestUnbilledMonth',500],
 ['/billing-review/pending/1/1','billingReview','listPendingHeldEntries',500]
];
describe('Path matrix: database read failures preserve all rows',function(){
 this.timeout(180000);let s;
 before(async()=>{s=await new PathScenario().boot();});
 after(async()=>{if(s)await s.close();});
 for(const [url,area,method,http,status,pattern,file] of cases)it(`GET ${url} | ${method} failure: HTTP ${http}, envelope ${status??'global error'}, no writes`,async()=>{
  await s.fail(endpoint(area,file),method,()=>s.refused(()=>s.get(url),http,status,pattern||/path-matrix injected failure/));
 });
 it('GET /account/AccountInformation | missing account response is 404 without writes',async()=>{
  await s.stub(endpoint('account'),'getAccount',async()=>[],()=>s.refused(()=>s.get('/account/AccountInformation/1/1'),404,404,/^Account not found\.$/));
 });
 for(const url of ['/healthz/check','/api/health/check'])it(`GET ${url} | failed database probe is 503 without writes`,async()=>{
  await s.fail(endpoint('health'),'dbStatus',()=>s.refused(()=>s.get(url),503,'error',/path-matrix/));
 });
 for(const url of ['/healthz/','/api/health/'])it(`GET ${url} | public liveness succeeds without database writes`,async()=>{
  const before=await s.allState(),r=await s.get(url);expect(r.status).eq(200);expect(r.body).deep.eq({status:'ok'});expect(await s.allState()).deep.eq(before);
 });
 it('DELETE /quotes/deleteQuote | database delete failure is refused with no rows changed',async()=>{
  await s.fail(endpoint('quotes'),'deleteQuote',()=>s.refused(()=>s.del('/quotes/deleteQuote/1/1'),200,500,/path-matrix/));
 });
 it('PUT /recurringCustomer/updateRecurringCustomer | missing row is 404 without writes',async()=>{
  await s.refused(()=>s.put('/recurringCustomer/updateRecurringCustomer',{recurringCustomer:{recurringCustomerID:2147483646}}),404,404,/^Recurring customer not found\.$/);
 });
 it('DELETE /customer/deleteCustomer | malformed ID is envelope 404 without writes',async()=>{
  await s.refused(()=>s.del('/customer/deleteCustomer/not-an-id/1/1'),200,404,/No matching customer/);
 });
 it('POST /accountAudit/run | more than 200 customers refuses before registering a job',async()=>{
  await s.refused(()=>s.post('/accountAudit/run/1/1',{customer_ids:Array(201).fill(1)}),400,400,/Limit 200 customers per batch/);
 });
});
