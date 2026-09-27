'use strict';
const ctx=require('../billingEntities/entity-context'),ledger=require('./receipt-ledger'),v=require('./receipt-values');
const {buckets}=require('../accountsReceivable/obligation-aging');
// Read-only report data. Receipt cash and allocated reductions remain separate.
async function read(db,accountId,customerId,options={}){
 const cutoff=await v.databaseCutoffs(db,options),selected=ctx.current();
 const entities=(await ctx.entities(db,accountId)).filter(e=>!selected || e.billing_entity_id===selected),sections=[];
 for(const e of entities)await ctx.run(e.billing_entity_id,async()=>{
  const state=await ledger.read(db,{accountId:Number(accountId),customerId:Number(customerId),entityId:e.billing_entity_id},cutoff);
  const receiptQuery=db('payment_receipts').where({account_id:accountId,customer_id:customerId,billing_entity_id:e.billing_entity_id}).where('receipt_date','<=',cutoff.asOf).where('created_at','<=',cutoff.recordedThrough).orderBy(['receipt_date','receipt_id']);
  if(options.start)receiptQuery.where('receipt_date','>=',options.start);
  const receipts=await receiptQuery;
  const held=state.credits.filter(c=>c.kind==='held_receipt').reduce((n,c)=>n+c.availableCents,0)/100;
  const issued=state.legacy?state.legacy.statementCreditCents/100:state.credits.filter(c=>c.kind==='statement_credit').reduce((n,c)=>n+c.availableCents,0)/100;
  sections.push({billing_entity_id:e.billing_entity_id,business:e.name,...cutoff,billed_balance:state.billedCents/100,held_receipt_credit:held,issued_statement_credit:issued,aging:buckets(state.obligations,cutoff.asOf),obligations:state.obligations.filter(o=>o.openCents>0),receipts});
 });
 return {sections,...cutoff,held_receipt_credit:sections.reduce((n,s)=>n+s.held_receipt_credit,0),billed_balance:sections.reduce((n,s)=>n+s.billed_balance,0)};
}
module.exports={read};
