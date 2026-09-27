'use strict';
const actorNames=require('../../utils/actorNames');
const {randomUUID}=require('crypto');
const {id,reason,text,record}=require('../../utils/ledgerAction');
const {ruleError,ledgerNow}=require('../payments/ledger-helpers');
const ctx=require('../billingEntities/entity-context');
const ledger=require('../payments/receipt-ledger'),v=require('../payments/receipt-values'),receipts=require('../payments/receipts-service');
const invoices=require('../invoice/invoice-service'),locks=require('../invoice/sentInvoiceLocks');
const {sha}=require('../billingEntities/entities-service');
const base=ledger.base;
const TABLES={memos:['credit_memos','memo_id'],refunds:['client_refunds','refund_id'],reversals:['credit_memo_reversals','reversal_id']};
async function source(db,accountId,invoiceId){
 const parent=await db('public.customer_invoices').where({account_id:accountId,customer_invoice_id:id(invoiceId)}).first();
 if(!parent)throw ruleError('Invoice not found.',404);
 const entityId=parent.billing_entity_id || (await db.raw("SELECT ds2_effective_entity(?,'customer_invoices',?,?) AS id",[accountId,parent.customer_invoice_id,parent.billing_entity_id])).rows[0].id;
 return {parent,scope:{accountId,customerId:parent.customer_id,entityId}};
}
async function position(trx,scope,parent){
 const issue=await trx('invoice_issues').where({account_id:scope.accountId,invoice_id:parent.customer_invoice_id}).first();
 const voided=await trx('invoice_voids').where({account_id:scope.accountId,original_invoice_id:parent.customer_invoice_id}).first();
 const link=await trx('rebill_links').where({account_id:scope.accountId}).where(q=>q.where('original_invoice_id',parent.customer_invoice_id).orWhere('replacement_invoice_id',parent.customer_invoice_id)).orderByRaw('CASE WHEN original_invoice_id = ? THEN 0 ELSE 1 END',[parent.customer_invoice_id]).first();
 const memos=await trx('credit_memos as m').where({'m.account_id':scope.accountId,'m.original_invoice_id':parent.customer_invoice_id}).select('m.*',trx.raw('EXISTS(SELECT 1 FROM credit_memo_reversals r WHERE r.memo_id=m.memo_id) AS reversed'),trx.raw('(SELECT reversal_id FROM credit_memo_reversals r WHERE r.memo_id=m.memo_id) AS reversal_id'));
 const state=await ledger.read(trx,scope);
 const originalCents=Math.round((Number(parent.total_charges)+Number(parent.total_write_offs))*100);
 const remainingCents=originalCents-memos.filter(m=>!m.reversed).reduce((n,m)=>n+v.cents(m.amount),0);
 const obligations=state.obligations.filter(o=>Number(o.original_invoice_id)===parent.customer_invoice_id && !['legacy_unresolved'].includes(o.source_kind));
 return {parent,scope,issue,voided,link,memos,state,originalCents,remainingCents,obligations,openCents:obligations.reduce((n,o)=>n+o.openCents,0)};
}
async function usable(trx,p){
 if(p.parent.parent_invoice_id || !await locks.lockNumber(trx,p.scope.accountId,'customer_invoices',p.parent.customer_invoice_id))throw ruleError('Only a finalized original invoice can be corrected.',409);
 if(p.voided)throw ruleError('This invoice is already void. Open its replacement.',409);
 if(await trx('invoice_exceptions').where({account_id:p.scope.accountId,invoice_id:p.parent.customer_invoice_id}).whereIn('state',['flagged','reversed']).first())throw ruleError('Resolve the existing bounced-check exception first.',409);
 const receiptIds=new Set((p.state.applications || []).filter(a=>p.obligations.some(o=>o.obligation_id===a.obligation_id)).map(a=>a.receipt_id || p.state.credits.find(c=>c.credit_id===a.credit_id)?.origin_receipt_id).filter(Boolean));
 for(const receiptId of receiptIds){const events=await trx('receipt_events').where({account_id:p.scope.accountId,receipt_id:receiptId});if(events.some(e=>e.kind==='exception_flagged') && !events.some(e=>e.kind.startsWith('resolved_')))throw ruleError('Resolve the receipt bounced-check exception before correcting this invoice.',409);}
 if(!p.state.derived)throw ruleError('Derive and reconcile the original obligations before correcting this legacy invoice.',409);
}
async function context(db,args){
 const {parent,scope}=await source(db,args.accountId,args.invoiceId);
 return ctx.run(scope.entityId,()=>db.transaction(async trx=>{await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const p=await position(trx,scope,parent);
  return {invoice:parent,entityId:scope.entityId,customerId:scope.customerId,originalNetCharges:v.dollars(p.originalCents),remainingCreditMemoAmount:v.dollars(Math.max(0,p.remainingCents)),openAmount:v.dollars(p.openCents),void:p.voided,rebill:p.link,memos:await actorNames(trx,args.accountId,p.memos),ledgerFingerprint:p.state.ledgerFingerprint,finalized:!parent.parent_invoice_id && !!await locks.lockNumber(trx,args.accountId,'customer_invoices',parent.customer_invoice_id),lines:p.issue?.payload?.correctionLines || p.issue?.payload?.transactions?.allTransactionRecords || []};
 }));
}
async function document(trx,scope,{title,number,amount,date,why,details=[]}){
 const customer=await trx('customers').where({account_id:scope.accountId,customer_id:scope.customerId}).first();
 const entity=await ctx.requireEntity(trx,scope.accountId,scope.entityId,{active:false});
 const buffer=await require('./correction-pdf').create({title,number,amount,date,reason:why,customer:customer.display_name,entity:entity.legal_name,details});
 const key=`corrections/${scope.accountId}/${scope.customerId}/${randomUUID()}.pdf`;
 await require('../../utils/s3').putObject(key,buffer,'application/pdf',{}, {ifNoneMatch:'*'});
 return {artifact_key:key,artifact_sha256:sha(buffer)};
}
async function nextId(trx,table,column){return Number((await trx.raw('SELECT nextval(pg_get_serial_sequence(?,?)) AS id',[table,column])).rows[0].id);}
// Change the current carrier without pretending a correction is cash or a write-off.
async function post(trx,scope,amount,actorId,why,kind,sourceId,date,targetId){
 if(!amount)return null;
 const core=require('../payments/payment-logic'),targets=await core.getCurrentChainTargets(trx,scope.accountId,scope.customerId);
 const target=targets.find(t=>t.parent.customer_invoice_id===targetId) || targets[0];
 if(!target)throw ruleError('No current statement carries this correction.',409);
 const {invoiceInsertionObject}=core.updateObjectsWithRemainingAmounts({...target.latestRow},{payment_amount:amount/100});
 const snapshot=await invoices.createInvoice(trx,{...invoiceInsertionObject,billing_entity_id:scope.entityId,created_by_user_id:actorId,created_at:ledgerNow(trx),notes:`${kind} #${sourceId}: ${why}`});
 await trx('correction_postings').insert({...base(scope),invoice_id:target.parent.customer_invoice_id,snapshot_id:snapshot.customer_invoice_id,kind,source_id:sourceId,amount:v.dollars(amount),reason:why,actor_id:actorId,effective_date:date});
 return snapshot;
}
async function assertReconciled(trx,scope){
 const state=await ledger.read(trx,scope),targets=await require('../payments/payment-logic').getCurrentChainTargets(trx,scope.accountId,scope.customerId);
 const actual=targets.reduce((n,t)=>n+Math.round(t.remaining*100),0);
 if(state.billedCents!==actual)throw ruleError(`Correction reconciliation differs by ${v.dollars(state.billedCents-actual)}. No changes saved.`,409);
}
async function memo(db,args){
 const {body,actorId,accountId}=args,amount=v.cents(body.amount),why=reason(body.reason),date=v.date(body.date || v.today());
 const {parent,scope}=await source(db,accountId,args.invoiceId);
 if(id(body.entityId)!==scope.entityId)throw ruleError('The invoice belongs to a different business.',409);
 return receipts.write(db,args,`credit_memo/${parent.customer_invoice_id}`,scope,async trx=>{
  const p=await position(trx,scope,parent);await usable(trx,p);receipts.fingerprint(body,p.state);
  if(date<v.day(parent.invoice_date))throw ruleError('Credit memo cannot precede its invoice.',400);
  if(p.state.applications.some(a=>p.obligations.some(o=>o.obligation_id===a.obligation_id) && v.day(a.effective_date)>date))throw ruleError('Credit memo cannot precede later activity on its original obligation.',409);
  if(amount>p.remainingCents)throw ruleError('Credit memo exceeds the remaining uncredited original charges.',409);
  if(amount>p.openCents && body.allowCreditExcess!==true)throw ruleError('Amount exceeds the open invoice amount. Explicitly confirm that the paid portion becomes client credit.',409);
  if(!p.obligations.length)throw ruleError('Original charge obligations are unresolved. Reconcile the legacy source first.',409);
  let lines=[{description:why,amount:v.dollars(amount),original_transaction_id:null}];
  if(body.lines!==undefined){
   if(!Array.isArray(body.lines) || !body.lines.length || body.lines.length>100)throw ruleError('Provide 1 to 100 credit lines.',400);
   const sourceLines=p.issue?.payload?.transactions?.allTransactionRecords || [];
   lines=body.lines.map(record).map(l=>{const tid=id(l.transactionId),original=sourceLines.find(t=>Number(t.transaction_id)===tid);if(!original)throw ruleError('Credit line is not on this invoice.',404);const n=v.cents(l.amount);if(n>Math.round(Number(original.total_transaction)*100))throw ruleError('Credit exceeds the original charge line.',409);return {original_transaction_id:tid,description:text(l.description || original.detailed_work_description || why,'Description',2000),amount:v.dollars(n)};});
   if(new Set(lines.map(l=>l.original_transaction_id)).size!==lines.length || lines.reduce((n,l)=>n+v.cents(l.amount),0)!==amount)throw ruleError('Credit lines must be unique and total the memo amount.',400);
   for(const line of lines){const prior=await trx('credit_memo_lines as l').join('credit_memos as m','m.memo_id','l.memo_id').where({'l.account_id':accountId,'l.original_transaction_id':line.original_transaction_id}).whereNotExists(trx('credit_memo_reversals as r').select(trx.raw('1')).whereRaw('r.memo_id=m.memo_id')).sum({amount:'l.amount'}).first();const original=sourceLines.find(t=>Number(t.transaction_id)===line.original_transaction_id);if(Math.round(Number(prior.amount || 0)*100)+v.cents(line.amount)>Math.round(Number(original.total_transaction)*100))throw ruleError('Cumulative credits exceed the original charge line.',409);}
  }
  const memoId=await nextId(trx,'credit_memos','memo_id'),number=`CM-${date.slice(0,4)}-${memoId}`;
  const artifact=await document(trx,scope,{title:'Credit memo',number,amount:-amount/100,date,why,details:[`Original invoice: ${parent.invoice_number}`,`Debt reduction: ${v.dollars(Math.min(amount,p.openCents))}; client credit: ${v.dollars(Math.max(0,amount-p.openCents))}`,...lines.map(l=>`${l.description}: ${l.amount}`)]});
  const [saved]=await trx('credit_memos').insert({...base(scope),memo_id:memoId,number,original_invoice_id:parent.customer_invoice_id,amount:v.dollars(amount),debt_reduction:v.dollars(Math.min(amount,p.openCents)),reason:why,actor_id:actorId,effective_date:date,...artifact}).returning('*');
  await trx('credit_memo_lines').insert(lines.map(l=>({...base(scope),memo_id:memoId,...l})));
  let left=amount;
  for(const o of p.obligations){const n=Math.min(left,o.openCents);if(n<=0)continue;left-=n;await ledger.application(trx,scope,{obligation:o,amountCents:n,date,actorId,reason:why,sourceKind:'credit_memo',sourceKey:`memo/${memoId}/${o.obligation_id}`,compatibility:false});}
  if(left)await trx('client_credit_lots').insert({...base(scope),kind:'statement_credit',amount:v.dollars(left),source_key:`memo/${memoId}`,original_invoice_id:parent.customer_invoice_id,effective_date:date,derivation_label:`Noncash credit memo ${number}`});
  await post(trx,scope,-amount,actorId,why,'credit_memo',memoId,date,p.obligations[0]?.carrying_invoice_id);
  await assertReconciled(trx,scope);
  const issue=p.issue || await locks.captureIssue(trx,parent,null,actorId);
  await locks.historyEvent(trx,issue,actorId,'credit_memo',{reason:why,memo_id:memoId,number,amount:saved.amount});
  return {memo:saved,message:'Credit memo finalized and locked. Original invoice preserved.'};
 });
}
async function reverseMemo(db,args){
 const {accountId,actorId,body}=args,why=reason(body.reason),date=v.date(body.date || v.today());
 const m=await db('credit_memos').where({account_id:accountId,memo_id:id(args.memoId)}).first();if(!m)throw ruleError('Credit memo not found.',404);
 const scope={accountId,customerId:m.customer_id,entityId:m.billing_entity_id};if(id(body.entityId)!==scope.entityId)throw ruleError('Credit belongs to a different business.',409);
 return receipts.write(db,args,`memo_reverse/${m.memo_id}`,scope,async trx=>{
  receipts.fingerprint(body,await ledger.read(trx,scope));
  const parent=(await source(trx,accountId,m.original_invoice_id)).parent;await usable(trx,await position(trx,scope,parent));
  if(date<v.day(m.effective_date))throw ruleError('Reversal cannot precede the memo.',400);
  if(await trx('credit_memo_reversals').where({memo_id:m.memo_id}).first() || await trx('invoice_voids').where({original_invoice_id:m.original_invoice_id}).first())throw ruleError('This memo was reversed or its invoice was voided.',409);
  const lots=(await ledger.creditLots(trx,scope)).filter(l=>l.source_key===`memo/${m.memo_id}`);
  if(lots.some(l=>l.availableCents!==v.cents(l.amount)))throw ruleError('Credit from this memo has been used or refunded; reconcile its dependent activity first.',409);
  const artifact=await document(trx,scope,{title:'Credit memo reversal',number:m.number,amount:Number(m.amount),date,why});
  const [r]=await trx('credit_memo_reversals').insert({...base(scope),memo_id:m.memo_id,amount:m.amount,reason:why,actor_id:actorId,effective_date:date,...artifact}).returning('*');
  const apps=await trx('ar_applications').where({...base(scope),source_kind:'credit_memo',direction:1}).where('source_key','like',`memo/${m.memo_id}/%`);
  for(const app of apps)await ledger.reverseApplication(trx,scope,app,{date,actorId,reason:why,compatibility:false});
  for(const lot of lots)await trx('client_credit_events').insert({...base(scope),credit_id:lot.credit_id,amount:lot.amount,direction:-1,kind:'memo_reversed',effective_date:date,reason:why});
  await post(trx,scope,v.cents(m.amount),actorId,why,'credit_memo_reversal',r.reversal_id,date);await assertReconciled(trx,scope);
  return {reversal:r,message:'Memo reversed with a linked compensating document.'};
 });
}
async function refundable(db,args){
 const credit=await db('client_credit_lots').where({account_id:args.accountId,credit_id:id(args.creditId)}).first();if(!credit)throw ruleError('Credit not found.',404);
 const scope={accountId:args.accountId,customerId:credit.customer_id,entityId:credit.billing_entity_id};
 return ctx.run(scope.entityId,()=>db.transaction(async trx=>{await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await ledger.read(trx,scope);return {credit:state.credits.find(c=>c.credit_id===credit.credit_id),ledgerFingerprint:state.ledgerFingerprint};}));
}
async function refund(db,args){
 const {body,accountId,actorId}=args,amount=v.cents(body.amount),why=reason(body.reason),date=v.date(body.date),method=text(body.method,'Method',50),reference=text(body.reference,'Reference',100,method!=='cash');
 if(!['check','cash','other'].includes(method))throw ruleError('Choose check, cash or other.',400);
 const credit=await db('client_credit_lots').where({account_id:accountId,credit_id:id(args.creditId)}).first();if(!credit)throw ruleError('Credit not found.',404);
 const scope={accountId,customerId:credit.customer_id,entityId:credit.billing_entity_id};if(id(body.entityId)!==scope.entityId)throw ruleError('Credit belongs to a different business.',409);
 return receipts.write(db,args,`credit_refund/${credit.credit_id}`,scope,async trx=>{
  const state=await ledger.read(trx,scope);receipts.fingerprint(body,state);const lot=state.credits.find(c=>c.credit_id===credit.credit_id);
  if(!lot || amount>lot.availableCents)throw ruleError('Refund exceeds available client credit.',409);
  if(lot.origin_receipt_id){const events=await trx('receipt_events').where({account_id:accountId,receipt_id:lot.origin_receipt_id});if(events.some(e=>e.kind==='exception_flagged') && !events.some(e=>e.kind.startsWith('resolved_')))throw ruleError('Resolve the bounced-check exception before returning its credit.',409);}
  if(date<v.day(lot.effective_date))throw ruleError('Refund cannot precede the source credit.',400);
  const rid=await nextId(trx,'client_refunds','refund_id');
  const artifact=await document(trx,scope,{title:'Money returned to client',number:`RF-${rid}`,amount:amount/100,date,why,details:[`Credit #${lot.credit_id}; ${method}; ${reference || ''}`,`Available credit after refund: ${v.dollars(lot.availableCents-amount)}`]});
  const [saved]=await trx('client_refunds').insert({...base(scope),refund_id:rid,credit_id:lot.credit_id,amount:v.dollars(amount),method,reference,reason:why,actor_id:actorId,effective_date:date,...artifact}).returning('*');
  await trx('client_credit_events').insert({...base(scope),credit_id:lot.credit_id,amount:v.dollars(amount),direction:-1,kind:'refund',effective_date:date,reason:why});
  if(lot.kind==='statement_credit')await post(trx,scope,amount,actorId,why,'credit_refund',rid,date);
  await assertReconciled(trx,scope);return {refund:saved,remainingCredit:v.dollars(lot.availableCents-amount),message:'Refund recorded as money returned. Source credit reduced.'};
 });
}
async function list(db,args,kind){
 const [table]=TABLES[kind],q=args.query || {},page=id(q.page || 1),limit=Math.min(id(q.limit || 50),200);
 return db.transaction(async trx=>{await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const query=trx(`${table} as r`).join('customers as c','c.customer_id','r.customer_id').join('billing_entities as b','b.billing_entity_id','r.billing_entity_id').where('r.account_id',args.accountId);if(q.customerId)query.where('r.customer_id',id(q.customerId));if(q.entityId && q.entityId!=='all')query.where('r.billing_entity_id',id(q.entityId));const n=await query.clone().count({n:'*'}).first();if(kind==='memos')query.select(trx.raw('(SELECT reversal_id FROM credit_memo_reversals x WHERE x.memo_id=r.memo_id) AS reversal_id'));return {records:await actorNames(trx,args.accountId,await query.select('r.*','c.display_name','b.name as billing_entity_name').orderBy('r.created_at','desc').limit(limit).offset((page-1)*limit)),totalCount:Number(n.n),page,limit};});
}
async function detail(db,args,kind){
 const [table,key]=TABLES[kind],record=await db(table).where({account_id:args.accountId,[key]:id(args.recordId)}).first();if(!record)throw ruleError('Correction record not found.',404);
 return {record:(await actorNames(db,args.accountId,[record]))[0],...(kind==='memos'?{lines:await db('credit_memo_lines').where({account_id:args.accountId,memo_id:record.memo_id}),reversals:await actorNames(db,args.accountId,await db('credit_memo_reversals').where({account_id:args.accountId,memo_id:record.memo_id}))}:{})};
}
async function artifact(db,args,kind){
 let record;
 if(kind==='void')record=await db('invoice_voids').where({account_id:args.accountId,void_id:id(args.recordId)}).first();else record=(await detail(db,args,kind)).record;
 if(!record)throw ruleError('Correction record not found.',404);
 const object=await require('../../utils/s3').getObject(record.artifact_key);if(sha(object.body)!==record.artifact_sha256)throw ruleError('Archived correction failed verification.',409);
 return object.body;
}
async function statementItems(db,scope){
 const items=[];
 for(const [table,key,label,sign] of [['credit_memos','memo_id','Credit memo',-1],['credit_memo_reversals','reversal_id','Credit memo reversal',1],['invoice_voids','void_id','Invoice void',-1],['client_refunds','refund_id','Money returned',1]]){
  const rows=await db(`${table} as c`).where({'c.account_id':scope.accountId,'c.customer_id':scope.customerId,'c.billing_entity_id':scope.entityId}).whereNotExists(db('invoice_statement_members as m').select(db.raw('1')).where({'m.account_id':scope.accountId,'m.table_name':table}).whereRaw(`m.record_id=c.${key}`));
  for(const r of rows)items.push({table,id:r[key],label,number:r.number || `#${r[key]}`,originalInvoiceId:r.original_invoice_id,amount:sign*Number(r.amount),reason:r.reason,date:v.day(r.effective_date)});
 }
 return items;
}
module.exports={statementItems,context,memo,reverseMemo,refundable,refund,list,detail,artifact,source,position,usable,document,post,assertReconciled,nextId};
