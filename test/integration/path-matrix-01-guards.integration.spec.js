'use strict';
const { PathScenario,expect,routes,url }=require('./_path-matrix');

describe('Path matrix: mounted-route no-write authorization contracts',function(){
 this.timeout(180000);let s;
 before(async()=>{s=await new PathScenario().boot();});
 after(async()=>{if(s)await s.close();});
 for(const route of routes){
  const method=route.method==='ALL'?'get':route.method.toLowerCase();
  if(!route.role.startsWith('Public')){
   it(`${route.key} | absent session: 401 envelope and no writes`,async()=>{
    await s.refused(()=>s.req(method,url(route),undefined,null),401,401,/^Missing authentication token$/);
   });
   if(route.path.includes(':accountID'))it(`${route.key} | foreign URL account: 403 envelope and no writes`,async()=>{
    await s.refused(()=>s.req(method,url(route,{accountID:700})),403,403,/^Account access denied$/);
   });
  }
  // This adds the database-wide no-write invariant to the existing role tests.
  if(/^(M|A|S)(?:$|[ ;+])/.test(route.role))it(`${route.key} | staff role: 403 envelope and no writes`,async()=>{
   const timesheet=route.path.startsWith('/timesheets/');
   const templateList=route.path.startsWith('/time-tracking/template/list');
   const res=await s.refused(()=>s.req(method,url(route,{userID:3,queryUserID:3}),{},'staff'),403,templateList?undefined:403,timesheet?/manager|admin/i:templateList?/admin/i:/^Unauthorized$/);
   if(timesheet)expect(res.body).to.have.property('message');
  });
 }
});
