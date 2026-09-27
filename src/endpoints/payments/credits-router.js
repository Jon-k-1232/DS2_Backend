'use strict';
const router=require('express').Router();
const {requireAdmin}=require('../auth/jwt-auth');
const {id,reason,route}=require('../../utils/ledgerAction');
const ctx=require('../billingEntities/entity-context');
const ledger=require('./receipt-ledger'),receipts=require('./receipts-service'),v=require('./receipt-values');
const {ruleError}=require('./ledger-helpers');
router.get('/',route(async req=>{
 const scope={accountId:Number(req.user.account_id),customerId:id(req.query.customerId),entityId:id(req.query.entityId)};
 return ctx.run(scope.entityId,()=>req.app.get('db').transaction(async trx=>{
  await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await ctx.requireEntity(trx,scope.accountId,scope.entityId,{active:false});
  if(!await trx('customers').where({account_id:scope.accountId,customer_id:scope.customerId}).first())throw ruleError('Client not found.',404);
  const state=await ledger.read(trx,scope,req.query);return {credits:state.credits,ledgerFingerprint:state.ledgerFingerprint,asOf:state.asOf,recordedThrough:state.recordedThrough};
 }));
}));
router.get('/transfers',route(async req=>{
 const accountId=Number(req.user.account_id);
 const transfers=await req.app.get('db')('client_credit_events as ev').join('client_credit_lots as target',function(){this.on('target.account_id','ev.account_id').andOn('target.source_key',req.app.get('db').raw("'transfer/' || ev.transfer_key::text"));}).join('billing_entities as a','a.billing_entity_id','ev.billing_entity_id').join('billing_entities as b','b.billing_entity_id','target.billing_entity_id').join('customers as c','c.customer_id','ev.customer_id').where({'ev.account_id':accountId,'ev.kind':'transfer'}).select('ev.event_id','ev.amount','ev.reason','ev.effective_date','a.name as source_name','b.name as destination_name','c.display_name as client_name','target.origin_receipt_id').orderBy('ev.event_id','desc');
 return {transfers};
}));
router.post('/transfers',requireAdmin,route(async req=>{
 const body=req.body || {},scope={accountId:Number(req.user.account_id),customerId:id(body.customerId),entityId:id(body.sourceEntityId)},targetId=id(body.destinationEntityId),creditId=id(body.creditId),amount=v.cents(body.amount),why=reason(body.reason);
 if(targetId===scope.entityId)throw ruleError('Choose another business for the transfer.',400);
 return receipts.write(req.app.get('db'),{accountId:scope.accountId,actorId:req.user.user_id,key:req.get('Idempotency-Key'),body},'credit_transfer',scope,async trx=>{
  await ctx.requireEntity(trx,scope.accountId,targetId);const state=await ledger.read(trx,scope);receipts.fingerprint(body,state);
  const source=state.credits.find(c=>Number(c.credit_id)===creditId);if(!source)throw ruleError('Credit not found in this client and business.',404);
  if(source.kind!=='held_receipt')throw ruleError('This credit is already on an issued statement. Use an invoice correction to move an issued balance.',409);
  if(amount>source.availableCents)throw ruleError('The credit does not have enough available funds.',409);
  const transferKey=require('crypto').randomUUID(),date=v.today();
  await trx('client_credit_events').insert({...ledger.base(scope),credit_id:source.credit_id,amount:v.dollars(amount),direction:-1,kind:'transfer',transfer_key:transferKey,effective_date:date,reason:why});
  const [credit]=await trx('client_credit_lots').insert({...ledger.base({...scope,entityId:targetId}),amount:v.dollars(amount),kind:'held_receipt',origin_receipt_id:source.origin_receipt_id,source_key:`transfer/${transferKey}`,effective_date:date,derivation_label:`Transferred from credit #${source.credit_id}; original cash receipt unchanged`}).returning('*');
  return {transferKey,sourceCreditId:source.credit_id,credit,amount:v.dollars(amount),message:'Unused receipt credit transferred; no new cash recorded.'};
 });
}));
module.exports=router;
