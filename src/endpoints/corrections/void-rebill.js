'use strict';
const {randomUUID}=require('crypto');
const service=require('./corrections-service'),ctx=require('../billingEntities/entity-context');
const v=require('../payments/receipt-values'),ledger=require('../payments/receipt-ledger'),receipts=require('../payments/receipts-service');
const {id,reason,text,record}=require('../../utils/ledgerAction'),{ruleError}=require('../payments/ledger-helpers');
const invoices=require('../invoice/invoice-service'),locks=require('../invoice/sentInvoiceLocks');
const {sha}=require('../billingEntities/entities-service');
const base=ledger.base;
function input(body){
 const why=reason(body.reason),targetId=id(body.replacementEntityId),date=v.date(body.date || v.today());
 if(!Array.isArray(body.lines) || !body.lines.length || body.lines.length>100)throw ruleError('Provide 1 to 100 corrected charge lines.',400);
 const lines=body.lines.map(record).map(l=>({description:text(l.description,'Charge description',2000),amount:v.dollars(v.cents(l.amount)),originalTransactionId:l.originalTransactionId==null?null:id(l.originalTransactionId)}));
 const total=lines.reduce((n,l)=>n+v.cents(l.amount),0);v.cents(v.dollars(total));
 if(body.transferReleasedCredit!==undefined && typeof body.transferReleasedCredit!=='boolean')throw ruleError('Transfer choice must be true or false.',400);
 return {why,targetId,date,lines,total,transfer:body.transferReleasedCredit===true};
}
async function plan(trx,scope,parent,body){
 const spec=input(body),p=await service.position(trx,scope,parent);await service.usable(trx,p);
 if(id(body.entityId)!==scope.entityId)throw ruleError('The original invoice belongs to a different business.',409);
 if(spec.date<v.day(parent.invoice_date))throw ruleError('Correction cannot precede the original invoice.',400);
 const target={...scope,entityId:spec.targetId};await ctx.requireEntity(trx,scope.accountId,target.entityId,{active:target.entityId!==scope.entityId});
 const targetState=target.entityId===scope.entityId?p.state:await ctx.run(target.entityId,()=>ledger.read(trx,target));
 const originalLines=p.issue?.payload?.transactions?.allTransactionRecords || [];
 for(const l of spec.lines)if(l.originalTransactionId && !originalLines.some(t=>Number(t.transaction_id)===l.originalTransactionId))throw ruleError('Replacement references work from another invoice.',404);
 const apps=p.state.applications?.filter(a=>p.obligations.some(o=>o.obligation_id===a.obligation_id) && a.direction===1 && !p.state.applications.some(r=>r.reversal_of===a.application_id) && a.source_kind!=='credit_memo') || [];
 if(apps.some(a=>spec.date<v.day(a.effective_date)))throw ruleError('Correction cannot precede a later payment application.',409);
 const memoIds=p.memos.filter(m=>!m.reversed).map(m=>m.memo_id);
 const memoLots=p.state.credits.filter(l=>memoIds.some(mid=>l.source_key===`memo/${mid}`));
 if(memoLots.some(l=>l.availableCents!==v.cents(l.amount)))throw ruleError('A source memo credit has been used or refunded. Reconcile that dependency before voiding.',409);
 const issueLots=p.state.credits.filter(l=>l.source_key===`issue-credit/${parent.customer_invoice_id}`);
 if(p.originalCents<0 && (!issueLots.length || issueLots.some(l=>l.availableCents!==v.cents(l.amount))))throw ruleError('The issued credit has been used or refunded and cannot be voided safely.',409);
 if(p.originalCents===0 || (p.originalCents>0 && !p.obligations.length))throw ruleError('The original has no resolved new charge or credit basis to void.',409);
 const remainingOpen=p.openCents+apps.reduce((n,a)=>n+v.cents(a.amount),0);
 const memoCredit=memoLots.reduce((n,l)=>n+l.availableCents,0);
 if(p.originalCents>0 && remainingOpen!==p.remainingCents+memoCredit)throw ruleError('Original obligations and prior credits cannot be reconciled safely.',409);
 let releasedHeld=0;
 for(const a of apps){const lot=p.state.credits.find(c=>c.credit_id===a.credit_id);if(a.receipt_id || lot?.kind==='held_receipt')releasedHeld+=v.cents(a.amount);
  const rid=a.receipt_id || lot?.origin_receipt_id;if(rid){const events=await trx('receipt_events').where({account_id:scope.accountId,receipt_id:rid});if(events.some(e=>e.kind==='exception_flagged') && !events.some(e=>e.kind.startsWith('resolved_')))throw ruleError('Resolve the receipt bounced-check exception before rebilling.',409);}
 }
 if(spec.transfer && target.entityId===scope.entityId)throw ruleError('Choose another business to transfer released credit.',400);
 const movedHeld=spec.transfer?releasedHeld:0;
 const same=target.entityId===scope.entityId;
 const sourceAfter=p.state.billedCents+releasedHeld-p.remainingCents;
 const targetBefore=same?sourceAfter:targetState.billedCents;
 const held=targetState.credits.filter(c=>c.kind==='held_receipt').reduce((n,c)=>n+c.availableCents,0)+(same?releasedHeld:movedHeld);
 const use=Math.min(held,Math.max(0,targetBefore+spec.total));
 const impact={originalInvoiceId:parent.customer_invoice_id,originalNumber:parent.invoice_number,sourceEntityId:scope.entityId,replacementEntityId:target.entityId,chargesReversed:v.dollars(p.remainingCents),correctedCharges:v.dollars(spec.total),chargeDelta:v.dollars(spec.total-p.remainingCents),releasedReceiptCredit:v.dollars(releasedHeld),transferredCredit:v.dollars(movedHeld),sourceBalanceAfter:v.dollars(same?targetBefore+spec.total-use:sourceAfter),replacementBalance:v.dollars(targetBefore+spec.total-use),creditApplied:v.dollars(use),reason:spec.why,date:spec.date,lines:spec.lines};
 const fingerprint=sha(JSON.stringify({source:p.state.ledgerFingerprint,target:targetState.ledgerFingerprint,spec,voided:p.voided,memos:p.memos}));
 return {p,target,targetState,spec,apps,memoLots,issueLots,impact,fingerprint};
}
async function preview(db,args){
 const {scope,parent}=await service.source(db,args.accountId,args.invoiceId);
 return ctx.run(scope.entityId,()=>db.transaction(async trx=>{await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const p=await plan(trx,scope,parent,args.body);return {impact:p.impact,previewFingerprint:p.fingerprint};}));
}
async function release(trx,scope,app,{date,why},actorId,voidId){
 const lot=app.credit_id?(await ledger.creditLots(trx,scope)).find(c=>c.credit_id===app.credit_id):null;
 await ledger.reverseApplication(trx,scope,app,{date,actorId,reason:why,compatibility:false});
 if(lot){
  const event=await trx('client_credit_events').where({credit_id:lot.credit_id,application_id:app.application_id,kind:'application'}).first();
  if(!event)throw ruleError('Credit application has no reversible funding event.',409);
  await trx('client_credit_events').insert({...base(scope),credit_id:lot.credit_id,amount:event.amount,direction:1,kind:'reversal',reversal_of:event.event_id,effective_date:date,reason:why});
  if(lot.kind==='held_receipt')await service.post(trx,scope,v.cents(app.amount),actorId,why,'rebill_payment_release',voidId,date,app.carrying_invoice_id);
  return {...lot,releasedCents:v.cents(app.amount)};
 }
 const kind=app.receipt_id?'held_receipt':'statement_credit';
 const [saved]=await trx('client_credit_lots').insert({...base(scope),kind,origin_receipt_id:app.receipt_id,amount:app.amount,source_key:`rebill/${voidId}/application/${app.application_id}`,effective_date:date,derivation_label:`Funds released from original application #${app.application_id}; no new cash`}).returning('*');
 if(kind==='held_receipt')await service.post(trx,scope,v.cents(app.amount),actorId,why,'rebill_payment_release',voidId,date,app.carrying_invoice_id);
 return {...saved,releasedCents:v.cents(app.amount)};
}
async function replacement(trx,scope,original,spec,actorId,voidId){
 await require('../payments/receipt-finalize').prepare(trx,scope,spec.date);
 const state=await ledger.read(trx,scope),targets=await require('../payments/payment-logic').getCurrentChainTargets(trx,scope.accountId,scope.customerId);
 const map={[scope.customerId]:{customer_id:scope.customerId,invoiceNote:`Replacement of ${original.invoice_number}. Original preserved and marked void. ${spec.why}`,issueReason:spec.why,includeCreditStatement:true}};
 const query=await require('../invoice/createInvoice/createInvoiceQueries').fetchInitialQueryItems(trx,map,scope.accountId,{billingDate:spec.date});
 const account=await require('../billingEntities/invoice-entity').letterhead(trx,scope.accountId,(await invoices.getAccountPayToInfo(trx,scope.accountId)));
 const held=state.credits.filter(l=>l.kind==='held_receipt').reduce((n,l)=>n+l.availableCents,0),use=Math.min(held,Math.max(0,state.billedCents+spec.total));
 const total=(state.billedCents+spec.total-use)/100;
 const calculated={customer_id:scope.customerId,lastInvoiceDate:null,invoiceTotal:total,preRetainerInvoiceTotal:total,retainerAppliedToInvoice:0,remainingRetainer:0,preCreditInvoiceTotal:(state.billedCents+spec.total)/100,heldCreditAvailable:held/100,heldCreditApplied:use/100,
  outstandingInvoices:{outstandingInvoiceTotal:state.billedCents/100,outstandingInvoiceRecords:targets.filter(t=>t.remaining!==0).map(t=>t.latestRow)},
  payments:{paymentTotal:0,retainerPaymentTotal:0,paymentRecords:[],allPaymentRecords:[]},writeOffs:{writeOffTotal:0,writeOffRecords:[],allWriteOffRecords:[]},retainers:{retainerTotal:0,retainerRecords:[],events:[]},
  transactions:{transactionsTotal:spec.total/100,transactionRecords:spec.lines.map((l,i)=>({jobID:i+1,jobDescription:l.description,jobTotal:Number(l.amount)})),allTransactionRecords:spec.lines.map(l=>({total_transaction:Number(l.amount),is_transaction_billable:true,original_transaction_id:l.originalTransactionId}))},correctionLines:spec.lines,correctionSummary:await service.statementItems(trx,scope),receiptSummary:[]};
 const [detail]=await require('../invoice/createInvoice/addDetailToInvoice/addInvoiceDetail').addInvoiceDetails([calculated],query,map,account,'',spec.date);
 await require('../billingEntities/invoice-entity').commitNumbers(trx,scope.accountId,[detail.invoiceNumber]);
 const buffer=await require('../../pdfCreator/templateOne/templateOneOrchestrator').createPDF(detail);
 const path=await require('../../pdfCreator/zipOrchestrator').createAndSaveZip([{buffer,metadata:{customerID:scope.customerId,type:'pdf',displayName:'Corrected_invoice'}}],account,'invoicing/invoice_images',`${detail.invoiceNumber}.zip`,{runID:randomUUID(),customerID:scope.customerId});
 const object=require('../invoice/invoiceDataInsertions/dataInsertionOrchestrator').newInvoiceObject(detail,{[scope.customerId]:path},actorId,spec.date);
 const parent=await invoices.createInvoice(trx,{...object,billing_entity_id:scope.entityId});
 await invoices.zeroOutAbsorbedInvoices(trx,scope.accountId,scope.customerId,parent,targets.map(t=>t.parent.customer_invoice_id));
 await require('../payments/receipt-finalize').append(trx,scope,parent,detail,actorId);
 return {parent,detail};
}
async function commit(db,args){
 const {parent,scope}=await service.source(db,args.accountId,args.invoiceId);input(args.body);
 if(typeof args.body.previewFingerprint!=='string' || !args.body.previewFingerprint)throw ruleError('Preview the correction before finalizing.',400);
 return receipts.write(db,args,`void_rebill/${parent.customer_invoice_id}`,scope,async trx=>{
  const p=await plan(trx,scope,parent,args.body);if(p.fingerprint!==args.body.previewFingerprint)throw ruleError('Correction preview is stale. Preview again before finalizing.',409);
  const {spec,target}=p,vid=await service.nextId(trx,'invoice_voids','void_id');
  const artifact=await service.document(trx,scope,{title:'Original invoice void',number:parent.invoice_number,amount:-p.p.remainingCents/100,date:spec.date,why:spec.why,details:[`Only new uncredited charges reversed: ${v.dollars(p.p.remainingCents)}. Balance forward retained.`,`Corrected charges: ${v.dollars(spec.total)}. No new received money.`]});
  const [voided]=await trx('invoice_voids').insert({...base(scope),void_id:vid,original_invoice_id:parent.customer_invoice_id,amount:v.dollars(p.p.remainingCents),reason:spec.why,actor_id:args.actorId,effective_date:spec.date,...artifact}).returning('*');
  const released=[];for(const app of p.apps)released.push(await release(trx,scope,app,spec,args.actorId,vid));
  let left=Math.max(0,p.p.remainingCents),state=await ledger.read(trx,scope);
  for(const o of state.obligations.filter(o=>Number(o.original_invoice_id)===parent.customer_invoice_id)){const n=Math.min(left,o.openCents);if(n<=0)continue;left-=n;await ledger.application(trx,scope,{obligation:o,amountCents:n,date:spec.date,actorId:args.actorId,reason:spec.why,sourceKind:'invoice_void',sourceKey:`void/${vid}/${o.obligation_id}`,compatibility:false});}
  if(left)throw ruleError('The remaining original charges cannot be reversed safely.',409);
  for(const lot of p.issueLots)await trx('client_credit_events').insert({...base(scope),credit_id:lot.credit_id,amount:lot.amount,direction:-1,kind:'invoice_void',effective_date:spec.date,reason:spec.why});
  await service.post(trx,scope,-p.p.remainingCents,args.actorId,spec.why,'invoice_void',vid,spec.date);
  state=await ledger.read(trx,scope);
  for(const lot of p.memoLots){let available=lot.availableCents;for(const o of state.obligations.filter(o=>Number(o.original_invoice_id)===parent.customer_invoice_id)){const n=Math.min(available,o.openCents);if(n<=0)continue;await ledger.consumeCredit(trx,scope,lot,o,n,{date:spec.date,actorId:args.actorId,reason:spec.why,compatibility:false});available-=n;o.openCents-=n;}}
  if(spec.transfer)for(const lot of released.filter(l=>l.kind==='held_receipt')){const transferKey=randomUUID();await trx('client_credit_events').insert({...base(scope),credit_id:lot.credit_id,amount:v.dollars(lot.releasedCents),direction:-1,kind:'transfer',transfer_key:transferKey,effective_date:spec.date,reason:spec.why});await trx('client_credit_lots').insert({...base(target),kind:'held_receipt',amount:v.dollars(lot.releasedCents),origin_receipt_id:lot.origin_receipt_id,source_key:`transfer/${transferKey}`,effective_date:spec.date,derivation_label:`Explicit rebill credit transfer from business ${scope.entityId}`});}
  await service.assertReconciled(trx,scope);
  const result=await ctx.run(target.entityId,()=>replacement(trx,target,parent,spec,args.actorId,vid));
  const [link]=await trx('rebill_links').insert({...base(scope),void_id:vid,original_invoice_id:parent.customer_invoice_id,replacement_invoice_id:result.parent.customer_invoice_id,replacement_entity_id:target.entityId,lines:JSON.stringify(spec.lines),source_evidence:JSON.stringify(p.p.issue?.payload || {original:parent}),reason:spec.why,actor_id:args.actorId,effective_date:spec.date}).returning('*');
  await ctx.run(target.entityId,()=>locks.captureIssue(trx,result.parent,result.detail,args.actorId));
  const originalIssue=p.p.issue || await locks.captureIssue(trx,parent,null,args.actorId);
  await locks.historyEvent(trx,originalIssue,args.actorId,'void_and_rebill',{reason:spec.why,void_id:vid,replacement_invoice_id:result.parent.customer_invoice_id,replacement_number:result.parent.invoice_number});
  await ctx.run(target.entityId,()=>service.assertReconciled(trx,target));
  return {void:voided,rebill:link,replacement:result.parent,impact:p.impact,message:'Original preserved and marked void. Corrected invoice finalized with a new number.'};
 });
}
module.exports={preview,commit};
