'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const auth=require('../../src/endpoints/auth/auth-service');
const {OAuth2Client}=require('google-auth-library');
const automation=require('../../src/endpoints/account/automation-settings-service');
const {AUTOMATION_DEFINITIONS}=require('../../src/automations/automationDefinitions');
const customer=require('../../src/endpoints/customer/customer-service');
const recurring=require('../../src/endpoints/recurringCustomer/recurringCustomer-service');
const jobTypes=require('../../src/endpoints/jobType/jobType-service');
const cfg=require('../../config');

describe('Path matrix: account, authentication and defensive save controls',function(){
 this.timeout(180000);let s;
 before(async()=>{s=await new PathScenario().boot();});after(async()=>{if(s)await s.close();});
 const key=AUTOMATION_DEFINITIONS[0].key;
 const invalid=[
  [{isEnabled:true},'Invalid automation key.'],
  [{automationKey:key,isEnabled:'not-a-boolean'},'Invalid value for isEnabled.'],
  [{automationKey:key,isEnabled:{}},'Invalid value for isEnabled.'],
  [{automationKey:key,recipientUserIds:'1'},'Invalid automation recipients payload.'],
  [{automationKey:key},'No automation updates provided.'],
  [{automationKey:'absent',isEnabled:true},'Invalid automation key.'],
  [{automationKey:key,recipientUserIds:[2147483646]},'One or more selected users are invalid.']
 ];
 for(const [body,message] of invalid)it(`PUT /account/automations | ${JSON.stringify(body)} refuses 400 without writes`,async()=>{
  const r=await s.refused(()=>s.put('/account/automations/1/1',body),400,400,/./);expect(r.body.message).eq(message);
 });
 for(const value of [true,false,'true','false',1,0])it(`PUT /account/automations | supported isEnabled ${JSON.stringify(value)} saves`,async()=>{
  const r=ok(await s.put('/account/automations/1/1',{automationKey:key,isEnabled:value,recipientUserIds:[1,1]}));expect(r.automation.isEnabled).eq([true,'true',1].includes(value));expect(r.automation.recipientUserIds).deep.eq([1]);
 });
 it('GET /account/automations | invalid inactive recipients are pruned successfully',async()=>{
  await s.db('users').where({user_id:3}).update({is_user_active:false});
  await s.db('account_automation_recipients').insert({account_id:1,automation_key:key,user_id:3});
  const r=ok(await s.get('/account/automations/1/1'));expect(r.automations.find(a=>a.key===key).recipientUserIds).not.include(3);
  expect(await s.db('account_automation_recipients').where({account_id:1,user_id:3})).length(0);
  await s.db('users').where({user_id:3}).update({is_user_active:true});
 });
 for(const [field,value,msg] of [['hd','wrong.test',/Access restricted/],['email_verified',false,/Email not verified/]])it(`POST /auth/google | verified identity with invalid ${field} refuses 401 without writes`,async()=>{
  await s.stub(OAuth2Client.prototype,'verifyIdToken',async()=>({getPayload:()=>({email:'sa@clean.test',hd:cfg.GOOGLE_WORKSPACE_DOMAIN,email_verified:true,[field]:value})}),()=>s.refused(()=>s.post('/auth/google',{credential:'local-stub'}),401,401,msg));
 });
 it('POST /auth/google | unprovisioned identity refuses 403 without a login row',async()=>{
  await s.stub(auth,'verifyGoogleIdToken',async()=>({email:'unprovisioned@matrix.test'}),()=>s.refused(()=>s.post('/auth/google',{credential:'local-stub'}),403,403,/not provisioned/));
 });
 it('POST /auth/google | valid provisioned identity receives cookie and exactly one login row',async()=>{
  const before=Number((await s.db('user_login_log').count('* as n').first()).n);
  const r=await s.stub(auth,'verifyGoogleIdToken',async()=>({email:'sa@clean.test'}),()=>s.post('/auth/google',{credential:'local-stub'}));ok(r);expect(r.headers['set-cookie'].join(' ')).match(/ds2_auth=.*HttpOnly/);expect(r.body).not.have.property('authToken');
  expect(Number((await s.db('user_login_log').count('* as n').first()).n)).eq(before+1);
 });
 it('POST /auth/google | login-log database failure refuses 500 without writes',async()=>{
  await s.stub(auth,'verifyGoogleIdToken',async()=>({email:'sa@clean.test'}),()=>s.fail(auth,'insertLoginLog',()=>s.refused(()=>s.post('/auth/google',{credential:'local-stub'}),500,undefined,/path-matrix/)));
 });
 it('requireAuth | database lookup failure refuses 401 without writes',async()=>{
  await s.fail(auth,'getUserByEmail',()=>s.refused(()=>s.get('/initialData/initialBlob/1/1'),401,401,/^Unauthorized request$/));
 });
 for(const token of ['malformed',null])it(`requireAuth | ${token?'malformed token':'expired token'} refuses without writes`,async()=>{
  await s.refused(()=>s.request.get('/initialData/initialBlob/1/1').set('Authorization','Bearer '+(token||s.token('sa',{expiresIn:-1}))),401,401,token?/^Unauthorized request$/:/^Expired token$/);
 });
 for(const [svc,method,message] of [[customer,'createCustomer','Error Inserting Customer Into Customer Table.'],[customer,'createCustomerInformation','Error Inserting Customer Into Customer Information Table.'],[recurring,'createRecurringCustomer','Error Inserting Customer Into Recurring Customer Table.']])it(`POST /customer/createCustomer | ${method} empty return rolls back all writes`,async()=>{
  const payload=s.customerBody('PM failed customer '+method,{isCustomerRecurring:true,recurringAmount:10,billingCycle:1,subscriptionFrequency:'Monthly'});
  await s.stub(svc,method,async()=>({}),()=>s.refused(()=>s.post('/customer/createCustomer/1/1',{customer:payload}),200,500,new RegExp(message.replaceAll('.','\\.'))));
 });
 it('PUT /customer/updateCustomer | lost update target rolls back with no contact/evidence writes',async()=>{
  const c=await s.customer('PM suppressed customer update');
  await s.stub(customer,'updateCustomer',async()=>undefined,()=>s.refused(()=>s.put('/customer/updateCustomer/1/1',{customer:c.payload}),200,500,/Customer was not found/));
 });
 it('PUT /jobTypes/updateJobType | target disappears after preflight: 404 without writes',async()=>{
  await s.stub(jobTypes,'updateJobType',async()=>0,()=>s.refused(()=>s.put('/jobTypes/updateJobType/1/1',{jobType:{jobTypeID:1,customerJobCategory:1,jobDescription:'unchanged',bookRate:10,estimatedStraightTime:6,isActive:true}}),404,404,/Job type not found/));
 });
 it('ALL /ai-integration/* | retired endpoint is 410 and preserves every row',async()=>{
  await s.refused(()=>s.post('/ai-integration/retired',{}),410,undefined,/endpoints have been removed/);
 });
 it('POST /auth/logout | auth limiter refuses excess requests with 429 and no database writes',async()=>{
  const before=await s.allState();let r;
  for(let i=0;i<31;i++){r=await s.post('/auth/logout',{},null);if(r.status===429)break;expect(r.status).eq(200);}
  expect(r.status).eq(429);expect(r.body).deep.eq({error:'Too many auth requests, please try again later.',status:429});expect(await s.allState()).deep.eq(before);
 });
});
