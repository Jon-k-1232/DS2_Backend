'use strict';
const {randomUUID}=require('crypto');
const ledger=require('./receipt-ledger'),v=require('./receipt-values');
const ctx=require('../billingEntities/entity-context');
const {ruleError}=require('./ledger-helpers');
async function protect(trx,accountId,paymentId){
 if(!trx.client)return;
 const linked=await trx('ar_applications as a').leftJoin('client_credit_lots as c','c.credit_id','a.credit_id').join('payment_receipts as r',function(){this.on('r.receipt_id',trx.raw('coalesce(a.receipt_id,c.origin_receipt_id)'));}).where({'a.account_id':Number(accountId),'a.compatibility_payment_id':Number(paymentId),'r.source_kind':'manual'}).select('r.receipt_id').first();
 if(linked)throw ruleError(`Receipt #${linked.receipt_id} owns this application. Use its application correction or reverse the complete receipt.`,409,'RECEIPT_APPLICATION_LOCKED');
}
async function sync(trx,kind,row,{removed=false,reverseOf=null}={}){
 if(!trx.client || !row || !row.customer_invoice_id)return;
 const entityId=ctx.current() || row.billing_entity_id;if(!entityId)return;
 const scope={accountId:Number(row.account_id),customerId:Number(row.customer_id),entityId:Number(entityId)},base=ledger.base(scope);
 if(!await trx('ar_derivations').where(base).first())return;
 const key=kind==='payment'?'compatibility_payment_id':'compatibility_writeoff_id',recordId=kind==='payment'?row.payment_id:row.writeoff_id;
 const signed=Math.round(Number(kind==='payment'?row.payment_amount:row.writeoff_amount)*100),date=v.day(kind==='payment'?row.payment_date:row.writeoff_date),why=`Legacy ${kind} ${removed?'removal':reverseOf?'reversal':'application'} #${recordId}`;
 const existing=await trx('ar_applications').where({...base,[key]:reverseOf || recordId,direction:1}).whereNotExists(trx('ar_applications as r').select(trx.raw('1')).whereRaw('r.reversal_of=ar_applications.application_id'));
 if(!removed && !reverseOf && existing.reduce((n,a)=>n+v.cents(a.amount),0)===-signed && existing.every(a=>v.day(a.effective_date)===date))return;
 for(const app of existing)await ledger.reverseApplication(trx,scope,app,{date:date<v.day(app.effective_date)?v.day(app.effective_date):date,actorId:row.created_by_user_id,reason:why,compatibility:false});
 if(removed || reverseOf)return;
 if(signed>=0)return;
 let left=-signed;
 const state=await ledger.read(trx,scope);
 for(const o of state.obligations){const amount=Math.min(left,o.openCents);if(amount<=0)continue;left-=amount;
  await trx('ar_applications').insert({...base,obligation_id:o.obligation_id,amount:v.dollars(amount),source_kind:row.retainer_id?'retainer_draw':`legacy_${kind}`,source_key:`compatibility/${kind}/${recordId}/${randomUUID()}`,[key]:recordId,
   carrying_invoice_id:o.carrying_invoice_id || o.original_invoice_id,effective_date:date<v.day(o.effective_date)?v.day(o.effective_date):date,reason:why});
 }
 if(left)throw ruleError('The payment or write-off does not reconcile to the remaining obligations. Refresh Account Audit.',409);
}
module.exports={protect,sync};
