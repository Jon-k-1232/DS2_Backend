'use strict';
const {PathScenario,expect}=require('./_path-matrix');
const routes=require('./_round2-routes');
describe('H7 complete round-two route guard inventory',function(){
 this.timeout(180000);let s;
 before(async()=>{s=await new PathScenario().boot();});after(async()=>{if(s)await s.close();});
 const request=(r,role)=>{const url=r.path.replace(/:accountID/g,'1').replace(/:userID/g,'1').replace(/:[a-zA-Z]+/g,'2147483646');const q=s.request[r.method](url);return role?q.set('Authorization','Bearer '+s.token(role)):q;};
 it('enumerates all58 added routes with no duplicates',()=>{expect(routes).to.have.length(58);expect(new Set(routes.map(r=>r.method+' '+r.path)).size).to.equal(58);});
 for(const r of routes){
  it(`${r.method.toUpperCase()} ${r.path}: anonymous401 preserves every table`,()=>s.refused(()=>request(r),401,401,/unauthorized|missing|authorization/i));
  if(r.role!=='employee')it(`${r.method.toUpperCase()} ${r.path}: employee403 preserves every table`,()=>s.refused(()=>request(r,'staff'),403,403,/unauthorized/i));
  if(['admin','super admin'].includes(r.role))it(`${r.method.toUpperCase()} ${r.path}: manager403 before parsing malformed money`,async()=>{
   await s.db('users').where({user_id:3}).update({access_level:'MaNaGeR'});
   try{await s.refused(()=>request(r,'staff').send(r.method==='get'?undefined:{entityId:[],amount:null}),403,403,/unauthorized/i);}
   finally{await s.db('users').where({user_id:3}).update({access_level:'Employee'});}
  });
 }
});
