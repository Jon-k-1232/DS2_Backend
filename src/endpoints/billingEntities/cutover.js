'use strict';
const {randomUUID}=require('crypto');
const context=require('./entity-context');
const {id,reason}=require('../../utils/ledgerAction');
const {ruleError,lockCustomerLedger}=require('../payments/ledger-helpers');
const {sha,lockAccount}=require('./entities-service');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cents=value=>{
 if(!/^-?\d+(\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value)) || Math.abs(Number(value))>99999999.99)throw ruleError('Opening slices must be signed amounts with at most two decimal places.',400);
 return Math.round(Number(value)*100);
};
async function plan(db,accountId){return context.unscoped(()=>db.transaction(async trx=>{
 await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const positions=await trx('billing_cutover_positions as p').select('p.*','c.display_name')
  .join('customers as c','c.customer_id','p.customer_id').where('p.account_id',accountId)
  .whereNotExists(trx('billing_cutover_links as l').select(trx.raw('1')).whereRaw('l.position_id=p.position_id'))
  .whereNotExists(trx('billing_cutover_allocations as a').select(trx.raw('1')).whereRaw('a.position_id=p.position_id')).orderBy('p.position_id');
 return {version:1,accountId,positions,entities:await context.entities(trx,accountId),total:positions.reduce((n,p)=>n+cents(p.opening_amount),0)/100,
  explanation:'Opening balances remain in the default business unless a reviewed split is applied. Each source must reconcile exactly. Held funds move through a separate reasoned credit transfer.'};
}));}
async function apply(db,{accountId,actorId,body,key}){
 if(!UUID.test(key || ''))throw ruleError('A UUID Idempotency-Key is required.',400);
 const why=reason(body.reason);
 if(!Array.isArray(body.positions) || !body.positions.length || body.positions.length>500)throw ruleError('Choose 1–500 reviewed opening positions.',400);
 const positions=body.positions.map(p=>{
  if(!Array.isArray(p.slices) || !p.slices.length || p.slices.length>50)throw ruleError('Each opening position needs its reviewed business slices.',400);
  if(!/^[a-f0-9]{64}$/.test(p.sourceHash || ''))throw ruleError('The source hash from the cutover report is required.',400);
  const slices=p.slices.map(s=>({entityId:id(s.entityId),cents:cents(s.amount)})).sort((a,b)=>a.entityId-b.entityId);
  if(slices.some(s=>!s.cents) || new Set(slices.map(s=>s.entityId)).size!==slices.length)throw ruleError('Use one nonzero slice per business.',400);
  return {positionId:id(p.positionId),sourceHash:p.sourceHash,slices};
 }).sort((a,b)=>a.positionId-b.positionId);
 if(new Set(positions.map(p=>p.positionId)).size!==positions.length)throw ruleError('An opening position may appear only once.',400);
 const manifest={version:1,accountId,reason:why,positions},hash=sha(JSON.stringify(manifest));
 return context.unscoped(()=>db.transaction(async trx=>{
  await lockAccount(trx,accountId,actorId,why);
  const previous=await trx('financial_requests').where({account_id:accountId,operation:'entity_cutover',idempotency_key:key}).first();
  if(previous){if(previous.input_hash!==hash)throw ruleError('This request key already identifies another cutover.',409);return previous.response;}
  const sources=await trx('billing_cutover_positions').where({account_id:accountId}).whereIn('position_id',positions.map(p=>p.positionId)).orderBy('customer_id');
  if(sources.length!==positions.length)throw ruleError('Opening position not found in this account.',404);
  for(const customerId of [...new Set(sources.map(s=>s.customer_id))])await lockCustomerLedger(trx,accountId,customerId);
  for(const p of positions){
   const source=sources.find(s=>Number(s.position_id)===p.positionId);
   if(source.source_sha256!==p.sourceHash)throw ruleError('The reviewed source hash changed. Regenerate the cutover report.',409);
   if(await trx('billing_cutover_links').where({position_id:p.positionId}).first() || await trx('billing_cutover_allocations').where({position_id:p.positionId}).first())throw ruleError('This opening position was already carried forward or split.',409);
   const latest=await trx('public.customer_invoices as r').select('r.*',trx.raw("encode(sha256(convert_to((to_jsonb(r)-'billing_entity_id')::text,'UTF8')),'hex') AS source_hash"))
    .where({account_id:accountId,customer_id:source.customer_id}).where(q=>q.where('customer_invoice_id',source.source_root_id).orWhere('parent_invoice_id',source.source_root_id))
    .orderBy([{column:'created_at',order:'desc'},{column:'customer_invoice_id',order:'desc'}]).first();
   if(!latest || latest.customer_invoice_id!==source.source_snapshot_id || latest.source_hash!==source.source_sha256)throw ruleError('A source balance changed. Regenerate the cutover report before applying.',409);
   const opening=cents(source.opening_amount);
   if(p.slices.reduce((n,s)=>n+s.cents,0)!==opening || p.slices.some(s=>Math.sign(s.cents)!==Math.sign(opening)))throw ruleError('The slices must equal the original balance and keep its sign.',409);
   for(const slice of p.slices){
    await context.requireEntity(trx,accountId,slice.entityId);
    const newer=await trx('public.customer_invoices').where({account_id:accountId,customer_id:source.customer_id,billing_entity_id:slice.entityId}).whereNull('parent_invoice_id').first();
    if(newer)throw ruleError('This client already has new invoices in a target business. Use a correction instead of changing the opening cutover.',409);
   }
  }
  const [cutover]=await trx('billing_cutovers').insert({account_id:accountId,source:`reviewed/${key}`,manifest,manifest_sha256:hash}).returning('*');
  const allocations=[];
  for(const p of positions){const source=sources.find(s=>Number(s.position_id)===p.positionId);for(const slice of p.slices){
   const [row]=await trx('billing_cutover_allocations').insert({account_id:accountId,customer_id:source.customer_id,billing_entity_id:slice.entityId,cutover_id:cutover.cutover_id,position_id:p.positionId,source_root_id:source.source_root_id,source_snapshot_id:source.source_snapshot_id,source_sha256:source.source_sha256,opening_amount:(slice.cents/100).toFixed(2)}).returning('*');allocations.push(row);
  }}
  const response={cutoverId:cutover.cutover_id,manifestHash:hash,allocations,message:'Reviewed opening balances assigned. Original statements remain unchanged.'};
  await trx('financial_requests').insert({request_id:randomUUID(),account_id:accountId,customer_id:sources[0].customer_id,operation:'entity_cutover',idempotency_key:key,input_hash:hash,response});
  return response;
 }));
}
async function consume(trx,accountId,customerId,entityId,rootIds,invoiceId){
 if(!rootIds?.length || !entityId)return;
 const allocations=await trx('billing_cutover_allocations').where({account_id:accountId,customer_id:customerId,billing_entity_id:entityId}).whereIn('source_root_id',rootIds);
 for(const a of allocations)await trx('billing_cutover_allocation_links').insert({account_id:accountId,customer_id:customerId,billing_entity_id:entityId,allocation_id:a.allocation_id,invoice_id:invoiceId}).onConflict('allocation_id').ignore();
 const positions=await trx('billing_cutover_positions').where({account_id:accountId,customer_id:customerId}).whereIn('source_root_id',rootIds);
 for(const p of positions){
  const all=await trx('billing_cutover_allocations as a').leftJoin('billing_cutover_allocation_links as l','l.allocation_id','a.allocation_id').where('a.position_id',p.position_id).select('a.billing_entity_id','l.invoice_id');
  if(all.length && all.some(a=>!a.invoice_id))continue;
  const carrier=all.find(a=>a.billing_entity_id===p.billing_entity_id)?.invoice_id || invoiceId;
  await trx('billing_cutover_links').insert({account_id:accountId,customer_id:customerId,billing_entity_id:p.billing_entity_id,position_id:p.position_id,invoice_id:carrier}).onConflict('position_id').ignore();
 }
}
module.exports={plan,apply,consume,cents};
