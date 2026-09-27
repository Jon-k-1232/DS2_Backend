'use strict';
const ledger=require('./receipt-ledger'),v=require('./receipt-values');
const {ruleError}=require('./ledger-helpers');
async function prepare(trx,scope,billingDate){
 const latest=await trx('invoice_issues as u').join('customer_invoices as i','i.customer_invoice_id','u.invoice_id')
 .where({'u.account_id':scope.accountId,'u.customer_id':scope.customerId,'u.billing_entity_id':scope.entityId}).max({date:'i.invoice_date'}).first();
 if(latest?.date && billingDate<v.day(latest.date))throw ruleError('A new statement cannot precede the latest issued statement date.',409);
 await require('./legacy-obligations').ensure(trx,scope);
}
async function append(trx,scope,parent,detail,actorId){
 const date=v.day(parent.invoice_date),base=ledger.base(scope);
 const old=await ledger.read(trx,scope);
 const grossCents=(detail.transactions.allTransactionRecords || []).filter(r=>r.is_transaction_billable).reduce((n,r)=>n+Math.round(Number(r.total_transaction)*100),0);
 const newCents=Math.round((Number(detail.transactions.transactionsTotal)+Number(detail.writeOffs.writeOffTotal))*100);
 if(newCents>0)await trx('ar_obligations').insert({...base,original_invoice_id:parent.customer_invoice_id,source_key:`issue/${parent.customer_invoice_id}`,amount:v.dollars(newCents),gross_charges:v.dollars(grossCents),price_adjustments:v.dollars(newCents-grossCents),obligation_date:date,due_date:v.day(parent.due_date),effective_date:date,source_kind:'issued_charges'});
 if(newCents<0)await trx('client_credit_lots').insert({...base,amount:v.dollars(-newCents),kind:'statement_credit',original_invoice_id:parent.customer_invoice_id,source_key:`issue-credit/${parent.customer_invoice_id}`,effective_date:date});
 let state=await ledger.read(trx,scope);
 // Pending legacy reductions become represented at issuance, never a second
 // cash receipt. These rows are retained verbatim in immutable membership.
 const pending=Math.round(Number(detail.payments.paymentTotal)*100);
 if(pending<0){
  let left=-pending;
  for(const o of state.obligations){const amount=Math.min(left,o.openCents);if(amount<=0)continue;left-=amount;
   await ledger.application(trx,scope,{obligation:o,amountCents:amount,date,actorId,reason:'Apply pending legacy payment at issuance',sourceKind:'legacy_pending_payment',sourceKey:`issue-pending/${parent.customer_invoice_id}/${o.obligation_id}`,compatibility:false});
  }
  if(left)await trx('client_credit_lots').insert({...base,amount:v.dollars(left),kind:'statement_credit',source_key:`issue-pending-credit/${parent.customer_invoice_id}`,original_invoice_id:parent.customer_invoice_id,effective_date:date});
 }else if(pending>0){
  // A legacy positive pending adjustment lacks reliable application lineage.
  await trx('ar_obligations').insert({...base,original_invoice_id:parent.customer_invoice_id,source_key:`issue-pending-reversal/${parent.customer_invoice_id}`,amount:v.dollars(pending),obligation_date:null,effective_date:date,source_kind:'legacy_unresolved',derivation_label:'Legacy pending reversal; original obligation age unresolved'});
 }
 state=await ledger.read(trx,scope);
 const creditBudget=Math.round(Number(detail.heldCreditApplied || 0)*100);
 let heldLeft=creditBudget;
 // Issued credit already lowered B. Applying it only aligns obligations with
 // that signed balance. Held receipt use lowers the new statement exactly once.
 for(const lot of state.credits){
  let available=lot.availableCents;
  if(lot.kind==='held_receipt')available=Math.min(available,heldLeft);
  for(const o of state.obligations){const amount=Math.min(available,o.openCents);if(amount<=0)continue;
   await ledger.consumeCredit(trx,scope,lot,o,amount,{date,actorId,reason:'Automatic credit use at statement finalization',compatibility:false,issuedParent:parent});
   available-=amount;o.openCents-=amount;if(lot.kind==='held_receipt')heldLeft-=amount;
  }
 }
 if(heldLeft)throw ruleError('Available credit changed. Refresh the statement before finalizing.',409);
 state=await ledger.read(trx,scope);
 // Carry paid obligations too: a later bounced check must restore debt on the
 // current statement rather than reopening an older same-day parent.
 for(const o of state.obligations)await trx('ar_obligation_carriers').insert({...base,obligation_id:o.obligation_id,invoice_id:parent.customer_invoice_id,effective_date:date});
 const expected=Math.round(Number(parent.remaining_balance_on_invoice)*100);
 if(state.billedCents!==expected)throw ruleError(`Obligation reconciliation differs by ${v.dollars(state.billedCents-expected)}. Nothing was finalized.`,409);
 return {beforeBilled:v.dollars(old.billedCents),afterBilled:v.dollars(state.billedCents),heldCreditApplied:v.dollars(creditBudget)};
}
module.exports={prepare,append};
