'use strict';
const context=require('./entity-context');
// Existing-record actions may omit a form selection. The record's immutable
// ownership supplies their scope; a caller can never select a different company.
async function recordScope(db,accountId,table,key,recordId,fn){
 if(!db.client || context.current() || !/^[1-9]\d*$/.test(String(recordId)) || Number(recordId)>2147483647)return fn();
 const row=await db(`public.${table}`).select(db.raw('public.ds2_effective_entity(account_id,?,??,billing_entity_id) AS entity_id',[table,key])).where({account_id:Number(accountId),[key]:recordId}).first();
 return row?.entity_id?context.run(row.entity_id,fn):fn();
}
module.exports=recordScope;
