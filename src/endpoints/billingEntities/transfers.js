'use strict';
const { randomUUID }=require('crypto');
const { id,reason }=require('../../utils/ledgerAction');
const { ruleError,lockCustomerLedger,ledgerNow }=require('../payments/ledger-helpers');
const { lockAccount,sha }=require('./entities-service');
const ctx=require('./entity-context');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function create(db,{accountId,actorId,body,key}) {
   if(!UUID.test(key || ''))throw ruleError('A UUID Idempotency-Key is required.',400);
   const input={customerId:id(body.customerId),sourceEntityId:id(body.sourceEntityId),destinationEntityId:id(body.destinationEntityId),retainerId:id(body.retainerId),expectedSnapshotId:id(body.expectedSnapshotId),amount:String(body.amount),reason:reason(body.reason)};
   if(!/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount)<=0 || Number(input.amount)>99999999.99)throw ruleError('Enter a positive amount with at most two decimal places.',400);
   const cents=Math.round(Number(input.amount)*100);input.amount=(cents/100).toFixed(2);
   if(input.sourceEntityId===input.destinationEntityId)throw ruleError('Choose two different businesses.',400);
   const hash=sha(JSON.stringify(input));
   return ctx.unscoped(()=>db.transaction(async trx=>{
      await lockAccount(trx,accountId,actorId,input.reason);await lockCustomerLedger(trx,accountId,input.customerId);
      const previous=await trx('financial_requests').where({account_id:accountId,operation:'entity_credit_transfer',idempotency_key:key}).first();
      if(previous){if(previous.input_hash!==hash)throw ruleError('This request key was already used for a different transfer.',409);return previous.response;}
      await ctx.requireEntity(trx,accountId,input.sourceEntityId,{active:false});await ctx.requireEntity(trx,accountId,input.destinationEntityId);
      const source=await trx('public.customer_retainers_and_prepayments as r').select('r.*',trx.raw("public.ds2_effective_entity(account_id,'customer_retainers_and_prepayments',retainer_id,billing_entity_id) AS effective_entity_id")).where({account_id:accountId,customer_id:input.customerId,retainer_id:input.retainerId}).first();
      if(!source)throw ruleError('Credit not found for this client.',404);if(source.effective_entity_id!==input.sourceEntityId)throw ruleError('The credit belongs to another business.',409);
      const root=source.parent_retainer_id || source.retainer_id;
      const latest=await trx('public.customer_retainers_and_prepayments').where({account_id:accountId,customer_id:input.customerId}).where(q=>q.where('retainer_id',root).orWhere('parent_retainer_id',root)).orderBy([{column:'created_at',order:'desc'},{column:'retainer_id',order:'desc'}]).first();
      if(latest.retainer_id!==input.expectedSnapshotId)throw ruleError('This credit changed. Reload its available amount.',409);
      const available=-Math.round(Number(latest.current_amount)*100);if(cents>available || !latest.is_retainer_active)throw ruleError('The transfer exceeds the available credit.',409);
      const {retainer_id,created_at,...copy}=latest;
      const [from]=await trx('public.customer_retainers_and_prepayments').insert({...copy,parent_retainer_id:root,billing_entity_id:input.sourceEntityId,current_amount:-(available-cents)/100,is_retainer_active:available>cents,created_at:ledgerNow(trx),created_by_user_id:actorId,note:`Credit transfer: ${input.reason}`}).returning('*');
      const [to]=await trx('public.customer_retainers_and_prepayments').insert({account_id:accountId,customer_id:input.customerId,billing_entity_id:input.destinationEntityId,parent_retainer_id:null,display_name:'Credit transferred from another business',type_of_hold:'Prepayment',starting_amount:-cents/100,current_amount:-cents/100,form_of_payment:'Transfer',payment_reference_number:null,is_retainer_active:true,created_at:ledgerNow(trx),created_by_user_id:actorId,note:`Noncash transfer from business #${input.sourceEntityId}: ${input.reason}`}).returning('*');
      const [transfer]=await trx('billing_credit_transfers').insert({transfer_id:randomUUID(),account_id:accountId,customer_id:input.customerId,billing_entity_id:input.sourceEntityId,destination_entity_id:input.destinationEntityId,source_retainer_id:root,source_snapshot_id:from.retainer_id,destination_retainer_id:to.retainer_id,amount:input.amount,reason:input.reason}).returning('*');
      const response={transfer,sourceAvailable:(available-cents)/100,destinationCredit:cents/100,message:'Credit transferred between businesses. No cash receipt was recorded.'};
      await trx('financial_requests').insert({request_id:randomUUID(),account_id:accountId,customer_id:input.customerId,operation:'entity_credit_transfer',idempotency_key:key,input_hash:hash,response});return response;
   }));
}
module.exports={create};
