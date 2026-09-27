'use strict';
const fs=require('fs'),knex=require('knex'),jwt=require('jsonwebtoken'),supertest=require('supertest'),{performance}=require('perf_hooks');
const app=require('../../src/app');
describe('H9 account-scale read-only performance budgets',function(){
 this.timeout(180000);let db,old,token,customers;const evidence={};
 before(async()=>{
  if(process.env.DB_DEV_HOST!=='127.0.0.1'||Number(process.env.DB_DEV_PORT)!==5433||process.env.DATABASE_NAME!=='ds2_local')throw Error('Only ds2_local on 127.0.0.1:5433 is allowed');
  db=knex({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'},pool:{min:0,max:4}});
  require('../../src/utils/auditContext');old=app.get('db');app.set('db',db);
  token=jwt.sign({user_id:21},process.env.JWT_SECRET,{subject:'admin@jimkimmel.com',expiresIn:'1h'});
  customers=await db('customer_jobs').where({account_id:1}).select('customer_id').count('* as n').groupBy('customer_id').orderBy('n','desc').limit(3);
 });
 after(async()=>{app.set('db',old);if(db)await db.destroy();fs.writeFileSync('docs/decisions/evidence/run-H9/budgets.json',JSON.stringify(evidence,null,2));});
 const get=url=>supertest(app).get(url).set('Authorization','Bearer '+token);
 it('account 1 login JSON is below 1 MB and carries no jobs or duplicate grids',async()=>{
  const start=performance.now(),res=await get('/initialData/initialBlob/1/21');expect(res.status).eq(200);expect(res.body.status).eq(200);
  evidence.login={bytes:Buffer.byteLength(res.text),elapsedMs:performance.now()-start};expect(evidence.login.bytes).below(1000000);
  expect(res.body.accountJobsList.activeJobData.activeJobs).deep.eq([]);expect(res.text).not.match(/"(?:grid|treeGrid)":/);
 });
 it('account-scale save refresh builders stay below 100 KB and contain only bounded pages',async()=>{
  evidence.saveRefreshes={};
  for(const [operation,kinds] of Object.entries({transaction:['transactions','payments','retainers'],job:['jobs'],payment:['payments','retainers','invoices'],writeoff:['writeoffs','invoices'],retainer:['retainers'],customer:['customers']})){
   const data=await require('../../src/utils/listPayload').firstPages(db,1,kinds);
   const bytes=Buffer.byteLength(JSON.stringify(data));expect(bytes,operation).below(100000);
   const counts={};for(const [name,list] of Object.entries(data))for(const block of Object.values(list)){expect(block.partial).eq(true);expect(block.pagination.limit).eq(20);for(const [key,rows] of Object.entries(block))if(Array.isArray(rows)){expect(rows.length,name).at.most(20);counts[key]=rows.length;}}
   expect(JSON.stringify(data)).not.match(/"(?:grid|treeGrid)":/);evidence.saveRefreshes[operation]={bytes,counts,method:'Read-only first-page builder; no save or changed record written'};
  }
 });
 it('the three largest client job histories have warm medians under 50 ms, including business scope',async()=>{
  evidence.jobs=[];
  const entity=(await db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
  for(const currentCycle of [false,true])for(const entityId of [null,entity])for(const c of customers){const samples=[];for(let i=0;i<8;i++){const start=performance.now(),res=await get(`/jobs/getActiveCustomerJobs/1/21/${c.customer_id}?limit=100${entityId?'&entityId='+entityId:''}${currentCycle?'&currentCycle=true':''}`);expect(res.status).eq(200);expect(res.body.activeCustomerJobData.activeCustomerJobs.length).at.most(100);if(i)samples.push(performance.now()-start);}
   const median=[...samples].sort((a,b)=>a-b)[3];evidence.jobs.push({customerId:c.customer_id,entityId,currentCycle,historyRows:Number(c.n),samples,median});expect(median,`client ${c.customer_id}, business ${entityId ?? 'all'}, cycle ${currentCycle}`).below(50);
  }
 });
 it('current-cycle amounts match the existing business-scoped view on protected legacy data',async()=>{
  const ctx=require('../../src/endpoints/billingEntities/entity-context');
  for(const entity of await db('billing_entities').where({account_id:1}))for(const c of customers){
   const expected=await ctx.run(entity.billing_entity_id,()=>db('customer_transactions').where({account_id:1,customer_id:c.customer_id}).select('customer_job_id').sum({amount:db.raw('CASE WHEN is_transaction_billable AND retainer_id IS NULL AND customer_invoice_id IS NULL THEN total_transaction ELSE 0 END')}).groupBy('customer_job_id'));
   const res=await get(`/jobs/getActiveCustomerJobs/1/21/${c.customer_id}?limit=100&entityId=${entity.billing_entity_id}&currentCycle=true`);expect(res.status).eq(200);
   const eligible=await db('public.customer_jobs as j').join('public.customer_job_types as t',function(){this.on('t.job_type_id','j.job_type_id').andOn('t.account_id','j.account_id');}).join('public.customer_job_categories as cat',function(){this.on('cat.customer_job_category_id','t.customer_job_category_id').andOn('cat.account_id','t.account_id');})
      .where({'j.account_id':1,'j.customer_id':c.customer_id}).whereIn('j.customer_job_id',expected.map(r=>r.customer_job_id).filter(Boolean)).where(b=>b.whereNull('j.billing_entity_id').orWhere('j.billing_entity_id',entity.billing_entity_id)).select('j.customer_job_id');
   expect(res.body.activeCustomerJobData.pagination.totalItems).eq(eligible.length);
   expect(res.body.activeCustomerJobData.activeCustomerJobs.length).eq(Math.min(100,eligible.length));
   for(const row of res.body.activeCustomerJobData.activeCustomerJobs)expect(Number(row.total_transaction)).eq(Number(expected.find(r=>r.customer_job_id===row.customer_job_id).amount));
  }
 });
});
