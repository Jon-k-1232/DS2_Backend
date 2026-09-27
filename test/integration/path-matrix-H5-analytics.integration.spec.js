'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const analytics=require('../../src/endpoints/analytics/analytics-service');
const routes=[['billingPerformance','getBillingPerformance'],['billingPerformance','getBillingPerformance','/export'],['clientRates','getClientRates'],['clientRates','getClientRates','/export'],['timeAllocation','getTimeAllocation'],['timeAllocation','getTimeAllocation','/export'],['wipAging','getWipAging'],['jobBudgets','getJobBudgets'],['taxSeasonCapacity','getTaxSeasonCapacity'],['yearEndPacket','getClientRates']];
describe('H5 analytics route and mistake matrix',function(){
 this.timeout(180000);let s,e,foreign;
 before(async()=>{s=await new PathScenario().boot();e=(await s.db('billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;await s.foreignFixture();foreign=(await s.db('billing_entities').where({account_id:700,is_default:true}))[0].billing_entity_id;});
 after(async()=>{if(s)await s.close();});
 const request=(route,{role='sa',account=1,query=''}={})=>{let r=s.request.get(`/analytics/${route[0]}/${account}/1${route[2]||''}${query?'?'+query:''}`);return role?r.set('Authorization','Bearer '+s.token(role)):r;};
 for(const r of routes){
  it(`${r[0]}${r[2]||''}: success is read-only`,async()=>{const before=await s.allState();const response=await request(r,{query:'year=2025'});expect(response.status,JSON.stringify(response.body)).to.equal(200);expect(await s.allState()).to.deep.equal(before);});
  for(const role of [null,'staff','admin'])it(`${r[0]}${r[2]||''}: ${role||'anonymous'} refused without writes`,()=>s.refused(()=>request(r,{role}),role?403:401,role?403:401,/./));
  it(`${r[0]}${r[2]||''}: manager refused without writes`,async()=>{await s.db('users').where({user_id:2}).update({access_level:'Manager'});try{await s.refused(()=>request(r,{role:'admin'}),403,403,/./);}finally{await s.db('users').where({user_id:2}).update({access_level:'Admin'});}});
  it(`${r[0]}${r[2]||''}: tenant mismatch403 and foreign/missing business404`,async()=>{await s.refused(()=>request(r,{account:700}),403,403,/./);for(const entity of [foreign,2147483646])await s.refused(()=>request(r,{query:`entityId=${entity}`}),404,404,/./);});
  it(`${r[0]}${r[2]||''}: invalid effective/knowledge cutoffs and business IDs are400 without writes`,async()=>{for(const query of ['asOf=2026-02-30','recordedThrough=bad','entityId=0'])await s.refused(()=>request(r,{query}),400,400,/./);});
  it(`${r[0]}${r[2]||''}: database failure returns500 and leaves all rows untouched`,()=>s.fail(analytics,r[1],()=>s.refused(()=>request(r),500,500,/./)));
 }
 for(const query of ['start=2026-05-01&end=2026-04-01','start=2026-02-30','end=bad','asOf=bad','recordedThrough=not-a-time','entityId=NaN','year=NaN','year=2101'])it(`invalid report ${query} is400 without writes`,()=>s.refused(()=>request(routes[0],{query}),400,400,/./));
 it('invalid export format is400 without writes',()=>s.refused(()=>request(routes[1],{query:'format=xlsx'}),400,400,/./));
 it('invalid yearsBack and invalid calendar year fail on their existing routes',async()=>{for(const r of routes.filter(r=>r[0]==='clientRates'))await s.refused(()=>request(r,{query:'yearsBack=NaN'}),400,400,/./);for(const r of routes.filter(r=>['timeAllocation','taxSeasonCapacity','yearEndPacket'].includes(r[0])))await s.refused(()=>request(r,{query:'year=bad'}),400,400,/./);});
 it('PDF is read-only and no storage mutation is needed',async()=>{const before=await s.allState(),r=await request(routes[1],{query:'format=pdf'});expect(r.status).to.equal(200);expect(r.headers['content-type']).to.match(/application\/pdf/);expect(await s.allState()).to.deep.equal(before);});
 it('export database failure and malformed UTC cutoff do not emit a successful download',async()=>{await s.queryFault(/FROM "public"\."customer_transactions"/i,()=>s.refused(()=>request(routes[1]),500,500,/./));await s.refused(()=>request(routes[1],{query:'recordedThrough=2026-99-99T10:00:00Z'}),400,400,/./);});
});
