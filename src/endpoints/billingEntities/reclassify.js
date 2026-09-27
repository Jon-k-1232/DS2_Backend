'use strict';
const {id,reason}=require('../../utils/ledgerAction');
const {ruleError,lockCustomerLedger}=require('../payments/ledger-helpers');
const context=require('./entity-context');
const {lockAccount}=require('./entities-service');
async function read(db,accountId,transactionId){
 const row=await db('public.customer_transactions as t').select('t.*',db.raw("encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS source_hash"),db.raw("public.ds2_effective_entity(t.account_id,'customer_transactions',t.transaction_id,t.billing_entity_id) AS effective_entity_id")).where({'t.account_id':accountId,'t.transaction_id':id(transactionId)}).first();
 if(!row)throw ruleError('Work entry not found.',404);
 return row;
}
async function change(db,{accountId,actorId,transactionId,body}){
 const why=reason(body.reason);
 return context.unscoped(()=>db.transaction(async trx=>{
  await lockAccount(trx,accountId,actorId,why);const row=await read(trx,accountId,transactionId);await lockCustomerLedger(trx,accountId,row.customer_id);
  if(row.source_hash!==body.expectedSourceHash)throw ruleError('This work changed. Reload before assigning a business.',409);
  if(row.customer_invoice_id || await require('../invoice/sentInvoiceLocks').lockNumber(trx,accountId,'customer_transactions',row.transaction_id))throw ruleError('Finalized work cannot switch businesses. Use an invoice correction.',409);
  if(row.retainer_id)throw ruleError('This work has a retainer draw. Reverse its funding before reclassification.',409);
  const entity=await context.requireEntity(trx,accountId,body.entityId);
  if(entity.billing_entity_id===row.effective_entity_id)throw ruleError('Choose a different business.',409);
  const jobId=row.customer_job_id;
  if(body.customerJobId && id(body.customerJobId)!==jobId)throw ruleError('Move this entry to a shared job through Edit work before reassigning its business.',409);
  if(jobId){const job=await trx('public.customer_jobs').where({account_id:accountId,customer_id:row.customer_id,customer_job_id:jobId}).select('*',trx.raw("public.ds2_effective_entity(account_id,'customer_jobs',customer_job_id,billing_entity_id) AS effective_entity_id")).first();
   if(!job || (job.effective_entity_id && job.effective_entity_id!==entity.billing_entity_id))throw ruleError('The current job belongs to another business. Move this entry to a shared job in Edit work before reassigning it.',409);
  }
  await trx('public.customer_transactions').where({account_id:accountId,transaction_id:row.transaction_id}).update({billing_entity_id:entity.billing_entity_id,customer_job_id:jobId});
  return {transaction:await read(trx,accountId,transactionId),message:'Unissued work assigned to the selected business.'};
 }));
}
module.exports={read,change};
