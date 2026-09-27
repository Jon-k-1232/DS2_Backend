'use strict';
const {expect}=require('chai');
// Keep Supertest's fluent API and await its response before verifying the real
// trigger rows. Shared route/scenario suites therefore assert actor attribution
// for every captured write, including indirect cascades and deletes.
module.exports=function auditedRequest(request,db,actorId){
 const then=request.then;
 request.then=function(resolve,reject){
  return (async()=>{
   // Fixture callers remain explicit single-business requests. Dedicated entity
   // validation specs use raw Supertest and do not pass this convenience builder.
   if((this._data?.customer?.isCustomerRecurring || /\/(createTransaction|createPayment|createRetainer|createWriteOffs?|createRecurringCustomer|createQuote|createInvoice|approve)(?:\/|$)/i.test(this.url)) && this._data && typeof this._data==='object' && !Buffer.isBuffer(this._data) && !Array.isArray(this._data) && require('../../src/endpoints/billingEntities/entity-context').selected({body:this._data,query:{}})===undefined && actorId){
    const user=await db('users').where({user_id:actorId}).first();
    if(user){const entity=await db('billing_entities').where({account_id:user.account_id,is_default:true}).first();if(entity)this._data={entityId:entity.billing_entity_id,...this._data};}
   }
   return then.call(this);
  })().then(async response=>{
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
