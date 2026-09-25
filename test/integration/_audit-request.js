'use strict';
const {expect}=require('chai');
// Keep Supertest's fluent API and await its response before verifying the real
// trigger rows. Shared route/scenario suites therefore assert actor attribution
// for every captured write, including indirect cascades and deletes.
module.exports=function auditedRequest(request,db,actorId){
 const then=request.then;
 request.then=function(resolve,reject){
  return then.call(this).then(async response=>{
   const correlation=response.headers['x-correlation-id'];
   if(correlation){
    const events=await db('audit_events').where({correlation_id:correlation});
    for(const event of events){
     expect(event.actor_user_id,`${event.source} ${event.entity} ${event.action}: session actor`).to.equal(event.source.startsWith('automation/')?null:actorId);
     expect(event.actor_name).to.be.a('string').and.not.equal('');
     expect(event.event_hash).to.match(/^[a-f0-9]{64}$/);
    }
   }
   return response;
  }).then(resolve,reject);
 };
 return request;
};
