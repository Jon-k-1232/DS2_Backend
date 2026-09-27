'use strict';
const {randomUUID}=require('crypto');
const ctx=require('../billingEntities/entity-context');
const {id,text,reason,record}=require('../../utils/ledgerAction');
const {ruleError,lockCustomerLedger}=require('./ledger-helpers');
const {lockAccount,sha}=require('../billingEntities/entities-service');
const v=require('./receipt-values'),ledger=require('./receipt-ledger'),legacy=require('./legacy-obligations');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
async function customer(trx,scope){if(!await trx('customers').where({account_id:scope.accountId,customer_id:scope.customerId}).first())throw ruleError('Client not found.',404);}
async function open(db,{accountId,query}){
 const scope={accountId,customerId:id(query.customerId),entityId:id(query.entityId)};
 return ctx.run(scope.entityId,()=>db.transaction(async trx=>{
  await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await ctx.requireEntity(trx,accountId,scope.entityId,{active:false});await customer(trx,scope);
  const result=await ledger.read(trx,scope,query);
  return {...result,customerId:scope.customerId,entityId:scope.entityId,obligations:result.obligations.filter(o=>o.openCents>0)};
 }));
}
async function write(db,{accountId,actorId,key,body,receiptId,applicationId},operation,scope,fn){
 if(!UUID.test(key || ''))throw ruleError('A UUID Idempotency-Key is required.',400);
 const inputHash=sha(JSON.stringify(canonical(body)));
 return ctx.run(scope.entityId,()=>db.transaction(async trx=>{
  await lockAccount(trx,accountId,actorId,body.reason || `Record ${operation}`);
  const prior=await trx('financial_requests').where({account_id:accountId,operation,idempotency_key:key}).first();
  if(prior){
   // Receipt commands share an operation name, so the URL target is part of
   // retry identity too. Compare the immutable saved response to retain exact
   // retries of requests recorded before this guard without rewriting history.
   const wrongTarget=receiptId!=null && (String(prior.response.receiptId)!==String(receiptId) || applicationId!=null && String(prior.response.reversed?.reversal_of)!==String(applicationId));
   if(prior.input_hash!==inputHash || wrongTarget)throw ruleError('This request key was already used for different information or a different record.',409);
   return prior.response;
  }
  await ctx.requireEntity(trx,accountId,scope.entityId,{active:operation==='receive_payment' || operation==='credit_transfer'});
  await lockCustomerLedger(trx,accountId,scope.customerId);
  const response=await fn(trx);
  await trx('financial_requests').insert({request_id:randomUUID(),account_id:accountId,customer_id:scope.customerId,operation,idempotency_key:key,input_hash:inputHash,response});
  return response;
 }));
}
const fingerprint=(body,state)=>{if(typeof body.ledgerFingerprint!=='string' || !body.ledgerFingerprint)throw ruleError('Load the open invoices before recording this payment.',400);if(body.ledgerFingerprint!==state.ledgerFingerprint)throw ruleError('The open invoices or credit changed. Refresh and review the amounts before submitting again.',409,'STALE_LEDGER');};
async function create(db,args){
 const {accountId,actorId,body}=args;
 const scope={accountId,customerId:id(body.customerId),entityId:id(body.entityId)};
 const amount=v.cents(body.amount),date=v.date(body.date);
 if(!['check','cash','other'].includes(body.method))throw ruleError('Choose check, cash or other.',400);
 const reference=text(body.reference,'Reference',100,body.method!=='cash');
 if(!Array.isArray(body.allocations) || body.allocations.length>500)throw ruleError('Supply up to 500 invoice allocations.',400);
 const lines=body.allocations.map(record).map(line=>({obligationId:typeof line.obligationId==='string'?line.obligationId:String(id(line.obligationId)),cents:v.cents(line.amount)}));
 if(lines.some(l=>!/^([1-9]\d*|legacy-\d+)$/.test(l.obligationId)))throw ruleError('Choose a valid open invoice.',400);
 if(new Set(lines.map(l=>l.obligationId)).size!==lines.length)throw ruleError('Select each invoice only once.',400);
 const applied=lines.reduce((n,l)=>n+l.cents,0);if(applied>amount)throw ruleError('Applied total exceeds the received amount.',400);
 return write(db,args,'receive_payment',scope,async trx=>{
  const before=await ledger.read(trx,scope);fingerprint(body,before);
  const ordered=before.obligations.filter(o=>o.openCents>0);
  for(const line of lines){const o=ordered.find(o=>String(o.obligation_id)===line.obligationId);if(!o)throw ruleError('Selected invoice is not open for this client and business.',404);if(line.cents>o.openCents)throw ruleError('An allocation exceeds the invoice remaining amount.',409);if(o.obligation_date && date<v.day(o.obligation_date))throw ruleError('A payment cannot be applied before the invoice date. Hold it as credit instead.',400);}
  const suggested=v.fifo(ordered,amount).map(l=>[String(l.obligationId),v.cents(l.amount)]);
  const actual=lines.map(l=>[l.obligationId,l.cents]);
  const override=JSON.stringify(suggested)!==JSON.stringify(actual);
  const why=override?reason(body.reason):(body.reason?reason(body.reason):'Apply receipt oldest first');
  const duplicates=reference?await trx('payment_receipts as r').where({'r.account_id':accountId,'r.customer_id':scope.customerId,'r.billing_entity_id':scope.entityId,'r.amount':v.dollars(amount),'r.receipt_date':date,'r.method':body.method})
   .whereRaw('lower(btrim(r.reference))=lower(btrim(?))',[reference]).whereNotExists(trx('receipt_events as e').select(trx.raw('1')).whereRaw("e.receipt_id=r.receipt_id AND e.kind='reversed'")):[];
  if(duplicates.length && !body.duplicateReason)throw ruleError(`Possible duplicate receipt #${duplicates[0].receipt_id}. Review it and give a reason to proceed.`,409,'RECEIPT_DUPLICATE');
  if(duplicates.length)reason(body.duplicateReason);
  await legacy.ensure(trx,scope);
  const state=await ledger.read(trx,scope);
  const [receipt]=await trx('payment_receipts').insert({...ledger.base(scope),amount:v.dollars(amount),receipt_date:date,method:body.method,reference,reason:why,created_by:actorId}).returning('*');
  const applications=[];
  for(const line of lines){const o=line.obligationId.startsWith('legacy-')?state.obligations.find(o=>o.source_key===`legacy/${scope.customerId}/${scope.entityId}/${line.obligationId.slice(7)}`):state.obligations.find(o=>String(o.obligation_id)===line.obligationId);
   applications.push(await ledger.application(trx,scope,{obligation:o,amountCents:line.cents,receiptId:receipt.receipt_id,date,actorId,reason:why,reference,sourceKey:`receipt/${receipt.receipt_id}/${o.obligation_id}`}));
  }
  let credit=null;
  if(amount>applied)[credit]=await trx('client_credit_lots').insert({...ledger.base(scope),receipt_id:receipt.receipt_id,origin_receipt_id:receipt.receipt_id,amount:v.dollars(amount-applied),kind:'held_receipt',source_key:`receipt/${receipt.receipt_id}/excess`,effective_date:date}).returning('*');
  const flags=await require('../duplicates/duplicates-service').detectCreated(trx,'payment_receipt',receipt,actorId);
  if(duplicates.length)await trx('receipt_events').insert({...ledger.base(scope),receipt_id:receipt.receipt_id,kind:'duplicate_acknowledged',reason:body.duplicateReason.trim(),effective_date:date,detail:{duplicateReceiptIds:duplicates.map(d=>d.receipt_id)}});
  return {receipt,applications,credit,duplicateFlags:flags,applied:v.dollars(applied),remainingCredit:v.dollars(amount-applied),message:'Payment received. Invoice applications and remaining credit saved.'};
 });
}
async function receipt(db,accountId,receiptId){const row=await db('payment_receipts').where({account_id:accountId,receipt_id:id(receiptId)}).first();if(!row)throw ruleError('Receipt not found.',404);return row;}
async function detail(db,{accountId,receiptId}){return db.transaction(async trx=>{
 await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const r=await receipt(trx,accountId,receiptId);
 const applications=await trx('ar_applications as a').leftJoin('ar_obligations as o',function(){this.on('o.account_id','a.account_id').andOn('o.obligation_id','a.obligation_id');}).leftJoin('public.customer_invoices as i',function(){this.on('i.account_id','o.account_id').andOn('i.customer_invoice_id','o.original_invoice_id');}).leftJoin('client_credit_lots as c','c.credit_id','a.credit_id').where('a.account_id',accountId).where(q=>q.where('a.receipt_id',r.receipt_id).orWhere('c.origin_receipt_id',r.receipt_id)).select('a.*','i.invoice_number','o.original_invoice_id').orderBy('a.application_id');
 for(const app of applications)app.finalized=!!(app.compatibility_payment_id && await require('../invoice/sentInvoiceLocks').lockNumber(trx,accountId,'customer_payments',app.compatibility_payment_id));
 const credits=await trx('client_credit_lots as c').join('billing_entities as e','e.billing_entity_id','c.billing_entity_id').where({'c.account_id':accountId,'c.origin_receipt_id':r.receipt_id}).select('c.*','e.name as business');
 for(const c of credits){const sum=await trx('client_credit_events').where({account_id:accountId,credit_id:c.credit_id}).sum({amount:trx.raw('amount*direction')}).first();c.availableCents=v.cents(c.amount)+Math.round(Number(sum.amount || 0)*100);}
 const events=await trx('receipt_events').where({account_id:accountId,receipt_id:r.receipt_id}).orderBy('event_id');
 const scope={accountId,customerId:r.customer_id,entityId:r.billing_entity_id};
 const state=await ctx.run(scope.entityId,()=>ledger.read(trx,scope));
 return {receipt:r,applications,credits,events,ledgerFingerprint:state.ledgerFingerprint,reversed:events.some(e=>e.kind==='reversed')};
});}
async function list(db,{accountId,query={}}){
 const page=id(query.page || 1),limit=Math.min(id(query.limit || 50),200);
 const q=db('payment_receipts as r').join('customers as c',function(){this.on('c.account_id','r.account_id').andOn('c.customer_id','r.customer_id');}).join('billing_entities as e','e.billing_entity_id','r.billing_entity_id').where('r.account_id',accountId);
 if(query.customerId)q.where('r.customer_id',id(query.customerId));if(query.entityId && query.entityId!=='all')q.where('r.billing_entity_id',id(query.entityId));
 const count=await q.clone().count({n:'*'}).first();
 return {receipts:await q.select('r.*','c.display_name','e.name as billing_entity_name').orderBy('r.receipt_id','desc').limit(limit).offset((page-1)*limit),totalCount:Number(count.n),page,limit};
}
async function receiptWrite(db,args,operation,fn){
 const r=await receipt(db,args.accountId,args.receiptId),scope={accountId:args.accountId,customerId:r.customer_id,entityId:r.billing_entity_id};
 if(r.source_kind!=='manual')throw ruleError(`This reconstructed receipt maps to ${r.source_key}. Use the existing payment or retainer correction workflow for that source; it cannot be posted a second time.`,409);
 reason(args.body.reason);
 return write(db,args,operation,scope,async trx=>{
  const events=await trx('receipt_events').where({account_id:args.accountId,receipt_id:r.receipt_id}).orderBy('event_id');
  if(events.some(e=>e.kind==='reversed') && !['receipt_resolve'].includes(operation))throw ruleError('This receipt has already been reversed.',409);
  const state=await ledger.read(trx,scope);fingerprint(args.body,state);
  return fn(trx,r,scope,state,events);
 });
}
async function correct(db,args){
 const amount=v.cents(args.body.amount),targetId=id(args.body.obligationId),applicationId=id(args.applicationId);
 return receiptWrite(db,args,'receipt_correct',async(trx,r,scope,state)=>{
  const app=await trx('ar_applications').where({...ledger.base(scope),application_id:applicationId,receipt_id:r.receipt_id,direction:1}).first();
  if(!app)throw ruleError('Application not found on this receipt.',404);
  if(await trx('ar_applications').where({reversal_of:applicationId}).first())throw ruleError('This application was already corrected.',409);
  if(await require('../invoice/sentInvoiceLocks').lockNumber(trx,args.accountId,'customer_payments',app.compatibility_payment_id))throw ruleError('A finalized application cannot be edited. Use the complete-receipt bounced-check exception when appropriate.',409);
  if(amount!==v.cents(app.amount))throw ruleError('A single-application correction must preserve its amount. Reverse the receipt to correct the received total.',400);
  const target=state.obligations.find(o=>Number(o.obligation_id)===targetId);if(!target)throw ruleError('Target invoice not found for this client and business.',404);
  if(targetId===Number(app.obligation_id))throw ruleError('Choose a different invoice for this correction.',400);
  if(amount>target.openCents)throw ruleError('The target invoice has insufficient remaining balance.',409);
  const date=v.date(args.body.date || v.today());if(target.obligation_date && date<v.day(target.obligation_date))throw ruleError('Correction predates the target invoice.',400);
  if(date<v.day(r.receipt_date) || date<v.day(app.effective_date))throw ruleError('Correction cannot precede the receipt or the original application.',400);
  const reversed=await ledger.reverseApplication(trx,scope,app,{date,actorId:args.actorId,reason:args.body.reason});
  const replacement=await ledger.application(trx,scope,{obligation:target,amountCents:amount,receiptId:r.receipt_id,date,actorId:args.actorId,reason:args.body.reason,reference:r.reference});
  await trx('receipt_events').insert({...ledger.base(scope),receipt_id:r.receipt_id,kind:'application_corrected',reason:args.body.reason,effective_date:date,detail:{reversedApplicationId:reversed.application_id,replacementApplicationId:replacement.application_id}});
  return {receiptId:r.receipt_id,reversed,replacement,message:'Application corrected with preserved history.'};
 });
}
async function flag(db,args){
 if(args.body.condition!=='bounced_check')throw ruleError('Choose the bounced-check condition.',400);
 return receiptWrite(db,args,'receipt_flag',async(trx,r,scope,state,events)=>{
  if(r.method!=='check')throw ruleError('Only a check receipt can be flagged as a bounced check.',409);
  if(events.some(e=>e.kind==='exception_flagged'))throw ruleError('This receipt already has an exception.',409);
  const apps=await trx('ar_applications as a').leftJoin('client_credit_lots as c','c.credit_id','a.credit_id').where({'a.account_id':args.accountId,'a.direction':1}).where(q=>q.where('a.receipt_id',r.receipt_id).orWhere('c.origin_receipt_id',r.receipt_id)).whereNotExists(trx('ar_applications as rev').select(trx.raw('1')).whereRaw('rev.reversal_of=a.application_id')).select('a.*');
  const ids=apps.map(a=>a.compatibility_payment_id).filter(Boolean);
  const members=ids.length?await trx('invoice_statement_members').where({account_id:args.accountId,table_name:'customer_payments'}).whereIn('record_id',ids):[];
  // Each immutable issue containing the receipt gets its own linked correction.
  const exceptions=[];
  for(const invoiceId of [...new Set(members.map(m=>m.invoice_id))].sort((a,b)=>a-b)){
   const issue=await trx('public.invoice_issues').where({account_id:args.accountId,invoice_id:invoiceId}).first();
   const ex=await ctx.run(issue.billing_entity_id,()=>require('../invoice/invoiceExceptions').flag(trx,{accountId:args.accountId,invoiceId,actor:args.actorId,body:{condition:'bounced_check',reason:args.body.reason,paymentIds:members.filter(m=>m.invoice_id===invoiceId).map(m=>m.record_id)}}));
   exceptions.push({invoiceId,entityId:issue.billing_entity_id,exceptionId:ex.exception_id});
  }
  await trx('receipt_events').insert({...ledger.base(scope),receipt_id:r.receipt_id,kind:'exception_flagged',reason:args.body.reason,effective_date:v.today(),detail:{exceptions}});
  return {receiptId:r.receipt_id,exceptions,message:'Complete receipt flagged for bounced-check reversal.'};
 });
}
async function reverse(db,args,{entryError=false}={}){
 if(['applicationIds','paymentIds','amount'].some(field=>Object.hasOwn(args.body,field)))throw ruleError('A receipt must be reversed in full; partial reversal is not permitted.',400);
 const date=v.date(args.body.date || v.today());
 return receiptWrite(db,args,entryError?'receipt_cancel':'receipt_reverse',async(trx,r,scope,state,events)=>{
  if(date<v.day(r.receipt_date))throw ruleError('Reversal cannot precede the receipt.',400);
  const flag=events.find(e=>e.kind==='exception_flagged');
  if(!flag && !entryError)throw ruleError('Flag the complete receipt as a bounced check before reversing it.',409);
  if(entryError && (flag || await trx('invoice_statement_members').where({account_id:args.accountId,table_name:'payment_receipts',record_id:r.receipt_id}).first()))throw ruleError('This receipt is finalized or has an exception. Use the appropriate issued correction workflow.',409);
  const lots=await trx('client_credit_lots').where({account_id:args.accountId,origin_receipt_id:r.receipt_id});
  const lotIds=lots.map(l=>l.credit_id);
  const creditEvents=lotIds.length?await trx('client_credit_events').where({account_id:args.accountId}).whereIn('credit_id',lotIds):[];
  if(creditEvents.some(e=>e.kind==='refund'))throw ruleError('Receipt credit has been refunded. Reconcile the refund before reversing this check.',409);
  const apps=await trx('ar_applications').where({account_id:args.accountId,direction:1}).where(q=>{q.where('receipt_id',r.receipt_id);if(lotIds.length)q.orWhereIn('credit_id',lotIds);})
   .whereNotExists(trx('ar_applications as rev').select(trx.raw('1')).whereRaw('rev.reversal_of=ar_applications.application_id')).orderBy(['billing_entity_id','application_id']);
  if(entryError)for(const app of apps)if(app.compatibility_payment_id && await require('../invoice/sentInvoiceLocks').lockNumber(trx,args.accountId,'customer_payments',app.compatibility_payment_id))throw ruleError('A finalized application cannot be cancelled as an entry mistake.',409);
  const reversals=[];
  for(const app of apps){
   if(date<v.day(app.effective_date))throw ruleError('Reversal cannot precede a later credit application.',409);
   const appScope={...scope,entityId:app.billing_entity_id};
   const lot=lots.find(l=>l.credit_id===app.credit_id);
   const rev=await ctx.run(appScope.entityId,()=>ledger.reverseApplication(trx,appScope,app,{date,actorId:args.actorId,reason:args.body.reason,compatibility:!lot || lot.kind==='held_receipt'}));reversals.push(rev);
  }
  for(const event of creditEvents.filter(e=>e.direction===-1)){
   if(creditEvents.some(e=>e.reversal_of===event.event_id))continue;
   await trx('client_credit_events').insert({...ledger.base({...scope,entityId:event.billing_entity_id}),credit_id:event.credit_id,amount:event.amount,direction:1,kind:'reversal',reversal_of:event.event_id,effective_date:date,reason:args.body.reason});
  }
  for(const lot of lots)await trx('client_credit_events').insert({...ledger.base({...scope,entityId:lot.billing_entity_id}),credit_id:lot.credit_id,amount:lot.amount,direction:-1,kind:'receipt_cancelled',effective_date:date,reason:args.body.reason});
  for(const ex of flag?.detail?.exceptions || []){
   for(const rev of reversals){const original=apps.find(a=>a.application_id===rev.reversal_of);if(original?.compatibility_payment_id)await trx('invoice_exception_payments').where({account_id:args.accountId,exception_id:ex.exceptionId,payment_id:original.compatibility_payment_id}).update({reversal_id:rev.compatibility_payment_id});}
   await trx('invoice_exceptions').where({account_id:args.accountId,exception_id:ex.exceptionId}).update({state:'reversed'});
   const issue=await trx('public.invoice_issues').where({account_id:args.accountId,invoice_id:ex.invoiceId}).first();
   await require('../invoice/sentInvoiceLocks').historyEvent(trx,issue,args.actorId,'exception_reversed',{reason:args.body.reason,receipt_id:r.receipt_id,reversal_ids:reversals.map(a=>a.compatibility_payment_id)},ex.exceptionId);
  }
  await trx('receipt_events').insert({...ledger.base(scope),receipt_id:r.receipt_id,kind:'reversed',reason:args.body.reason,effective_date:date,detail:{entryError,applicationIds:apps.map(a=>a.application_id),reversalIds:reversals.map(a=>a.application_id)}});
  return {receiptId:r.receipt_id,reversals,message:'The complete receipt was reversed. Every application and unused credit was restored or cancelled.'};
 });
}
async function resolve(db,args){
 if(!['revision','roll_forward'].includes(args.body.action))throw ruleError('Choose revision or roll forward.',400);
 return receiptWrite(db,args,'receipt_resolve',async(trx,r,scope,state,events)=>{
  if(!events.some(e=>e.kind==='reversed') || events.some(e=>e.kind.startsWith('resolved_')))throw ruleError('This receipt is not awaiting resolution.',409);
  const flag=events.find(e=>e.kind==='exception_flagged'),results=[];
  for(const ex of flag?.detail?.exceptions || [])results.push(await ctx.run(ex.entityId || scope.entityId,()=>require('../invoice/invoiceExceptions').transition(trx,{accountId:args.accountId,invoiceId:ex.invoiceId,exceptionId:ex.exceptionId,actor:args.actorId,action:args.body.action})));
  await trx('receipt_events').insert({...ledger.base(scope),receipt_id:r.receipt_id,kind:`resolved_${args.body.action}`,reason:args.body.reason,effective_date:v.today(),detail:{results}});
  return {receiptId:r.receipt_id,results,message:'Receipt correction resolved.'};
 });
}
const cancel=(db,args)=>reverse(db,args,{entryError:true});
module.exports={cancel,open,create,list,detail,correct,flag,reverse,resolve,write,fingerprint};
