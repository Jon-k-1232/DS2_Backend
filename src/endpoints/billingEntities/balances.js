'use strict';
const context=require('./entity-context');
const audit=require('../accountAudit/account-audit-service');
const {auditCustomerLedger}=require('../accountAudit/account-audit-logic');
const {id}=require('../../utils/ledgerAction');
const {ruleError}=require('../payments/ledger-helpers');
async function list(db,accountId,customerId){
 customerId=id(customerId);
 return context.run(null,()=>db.transaction(async trx=>{
  await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const customer=await audit.getCustomer(trx,accountId,customerId);if(!customer)throw ruleError('Client not found.',404);
  const balances=[];
  for(const entity of await context.entities(trx,accountId))await context.run(entity.billing_entity_id,async()=>{
   const [invoices,payments,writeoffs,transactions,retainers,retainerEvents]=await Promise.all([
    audit.getInvoices(trx,accountId,customerId),audit.getPayments(trx,accountId,customerId),audit.getWriteoffs(trx,accountId,customerId),
    audit.getTransactions(trx,accountId,customerId),audit.getRetainers(trx,accountId,customerId),audit.getRetainerEvents(trx,accountId,customerId)]);
   const result=auditCustomerLedger({customer,invoices,payments,writeoffs,transactions,retainers,retainerEvents});
   const lots=await require('../payments/receipt-ledger').creditLots(trx,{accountId:Number(accountId),customerId,entityId:entity.billing_entity_id});
   const heldReceiptCredit=lots.filter(c=>c.kind==='held_receipt').reduce((n,c)=>n+c.availableCents,0)/100,proposedCreditUse=Math.min(Math.max(0,result.totals.audit_balance),heldReceiptCredit);
   balances.push({heldReceiptCredit,proposedCreditUse,proposedStatement:Math.round((result.totals.audit_balance-proposedCreditUse)*100)/100,billing_entity_id:entity.billing_entity_id,name:entity.name,billed:result.totals.outstanding_invoices,nextStatement:result.totals.audit_balance,heldFunds:result.totals.retainer_available});
  });
  const totals=Object.fromEntries(['billed','nextStatement','heldFunds','heldReceiptCredit','proposedCreditUse','proposedStatement'].map(k=>[k,Math.round(balances.reduce((n,r)=>n+r[k],0)*100)/100]));
  return {balances,totals};
 }));
}
module.exports={list};
