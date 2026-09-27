'use strict';
const {day,today}=require('./receipt-values');
const {sha}=require('../billingEntities/entities-service');
const money=n=>Math.round(Number(n || 0)*100);
const recorded=row=>row.created_at_exact?new Date(row.created_at_exact.replace(' ','T')+'Z'):new Date(row.created_at);
// The carried opening is authoritative. Incremental charge components supply
// its age distribution. Reductions with incomplete linkage use disclosed FIFO;
// an unexplained positive residual is explicitly unresolved, never fictitious cash.
function derive(invoices,billedCents,{asOf=today(),payments=[]}={}){
 const parents=invoices.filter(r=>!r.parent_invoice_id && day(r.invoice_date)<=asOf)
 .sort((a,b)=>day(a.invoice_date).localeCompare(day(b.invoice_date)) || String(a.created_at_exact || a.created_at).localeCompare(String(b.created_at_exact || b.created_at)) || a.customer_invoice_id-b.customer_invoice_id);
 const candidates=parents.map(p=>({original_invoice_id:p.customer_invoice_id,invoice_number:p.invoice_number,obligation_date:day(p.invoice_date),due_date:p.due_date?day(p.due_date):null,
  grossCents:money(p.total_charges),adjustmentCents:money(p.total_write_offs),faceCents:Math.max(0,money(p.total_charges)+money(p.total_write_offs))})).filter(p=>p.faceCents>0);
 const gross=candidates.reduce((s,p)=>s+p.faceCents,0),target=Math.max(0,billedCents);
 let reductions=Math.max(0,gross-target);
 const exactReductions=[];
 const remaining=candidates.map(p=>({...p,openCents:p.faceCents}));
 for(const payment of payments){
  if(Number(payment.payment_amount)>=0 || !payment.customer_invoice_id)continue;
  const snapshot=invoices.find(i=>i.customer_invoice_id===payment.customer_invoice_id),root=parents.find(i=>i.customer_invoice_id===(snapshot?.parent_invoice_id || snapshot?.customer_invoice_id));
  // A balance-forward carrier cannot prove which old debt was paid. Only an
  // independently issued charge with no brought-forward balance is exact.
  if(!root || money(root.beginning_balance)!==0)continue;
  const target=remaining.find(o=>o.original_invoice_id===root.customer_invoice_id);if(!target)continue;
  const applied=Math.min(target.openCents,reductions,-money(payment.payment_amount));if(applied<=0)continue;
  target.openCents-=applied;reductions-=applied;exactReductions.push({paymentId:payment.payment_id,invoiceId:root.customer_invoice_id,amountCents:applied});
 }
 const obligations=remaining.flatMap(p=>{const applied=Math.min(reductions,p.openCents);reductions-=applied;return p.openCents>applied?[{...p,openCents:p.openCents-applied,source_kind:'legacy_reconstructed',derivation_label:'Reconstructed opening; exact independent links then oldest-first estimate'}]:[];});
 const residual=Math.max(0,target-gross);
 if(residual)obligations.push({original_invoice_id:parents[0]?.customer_invoice_id || null,invoice_number:parents[0]?.invoice_number || 'Unresolved legacy opening',obligation_date:parents[0]?day(parents[0].invoice_date):null,due_date:null,faceCents:residual,openCents:residual,source_kind:'legacy_unresolved',derivation_label:parents.length?'Legacy unresolved opening; oldest verifiable statement date':'Legacy unresolved opening; unknown age'});
 return {version:2,asOf,billedCents,statementCreditCents:Math.max(0,-billedCents),incrementalChargeCents:gross,inferredReductionCents:Math.max(0,gross-target)-exactReductions.reduce((n,r)=>n+r.amountCents,0),exactReductions,unresolvedCents:residual,obligations,
  basis:'Reconstructed opening only. Original statement charges exclude balance forward. Historical reductions are a disclosed FIFO estimate, not newly recorded cash.',sources:invoices};
}
function historicalBalance(invoices,{asOf,recordedThrough}){
 const eligible=invoices.filter(r=>day(r.invoice_date)<=asOf && recorded(r)<=new Date(recordedThrough));
 const roots=eligible.filter(r=>!r.parent_invoice_id),latestDate=roots.map(r=>day(r.invoice_date)).sort().slice(-1)[0];
 return roots.filter(r=>day(r.invoice_date)===latestDate).reduce((sum,root)=>{
  const snapshots=eligible.filter(r=>r.customer_invoice_id===root.customer_invoice_id || r.parent_invoice_id===root.customer_invoice_id)
   .filter(r=>{const marker=/\[absorbed_by:([^@\]]+)/.exec(r.notes || '');if(marker){const carrier=invoices.find(i=>!i.parent_invoice_id && i.invoice_number===marker[1]);return carrier && day(carrier.invoice_date)<=asOf;}
    return !r.parent_invoice_id || require('../invoice/billingDate').billingDateToday(recorded(r))<=asOf;})
   .sort((a,b)=>String(a.created_at_exact || a.created_at).localeCompare(String(b.created_at_exact || b.created_at)) || a.customer_invoice_id-b.customer_invoice_id);
  return sum+money(snapshots.slice(-1)[0]?.remaining_balance_on_invoice);
 },0);
}
async function plan(trx,scope,options={},preloaded){
 const {accountId,customerId,entityId}=scope;
 const invoices=preloaded?.invoices ?? await trx('customer_invoices').where({account_id:accountId,customer_id:customerId}).select('*',trx.raw('created_at::text AS created_at_exact')).orderBy('customer_invoice_id');
 const paymentSources=preloaded?.paymentSources ?? await trx('customer_payments').where({account_id:accountId,customer_id:customerId}).select('*',trx.raw('created_at::text AS created_at_exact')).orderBy('payment_id');
 const retainerSources=preloaded?.retainerSources ?? await trx('customer_retainers_and_prepayments').where({account_id:accountId,customer_id:customerId}).whereNull('parent_retainer_id').orderBy('retainer_id');
 // Empty businesses need no chain lookup. For actual unconverted invoices,
 // retain the existing live-chain validation, including absorbed-only refusal.
 const targets=preloaded && !invoices.some(i=>i.parent_invoice_id==null)?[]:await require('./payment-logic').getCurrentChainTargets(trx,accountId,customerId);
 const cutoff=await require('./receipt-values').databaseCutoffs(trx,options);
 const historical=cutoff.asOf<today() || options.recordedThrough;
 const visible=historical?invoices.filter(r=>day(r.invoice_date)<=cutoff.asOf && recorded(r)<=new Date(cutoff.recordedThrough)):invoices;
 const payments=paymentSources.filter(p=>day(p.payment_date)<=cutoff.asOf && recorded(p)<=new Date(cutoff.recordedThrough));
 const report=derive(visible,historical?historicalBalance(invoices,cutoff):targets.reduce((s,t)=>s+money(t.remaining),0),{...cutoff,payments});
 return {...report,accountId,customerId,entityId,paymentSources,retainerSources,sourceHash:sha(JSON.stringify({invoices,paymentSources,retainerSources}))};
}
async function ensure(trx,scope){
 if(await trx('ar_derivations').where({account_id:scope.accountId,customer_id:scope.customerId,billing_entity_id:scope.entityId}).first())return;
 const manifest=await plan(trx,scope),base={account_id:scope.accountId,customer_id:scope.customerId,billing_entity_id:scope.entityId};
 await trx('ar_derivations').insert({...base,manifest,manifest_sha256:sha(JSON.stringify(manifest)),as_of:manifest.asOf});
 for(const [i,o] of manifest.obligations.entries())await trx('ar_obligations').insert({...base,original_invoice_id:o.original_invoice_id,source_key:`legacy/${scope.customerId}/${scope.entityId}/${i}`,amount:(o.openCents/100).toFixed(2),gross_charges:(o.faceCents/100).toFixed(2),price_adjustments:0,obligation_date:o.obligation_date,due_date:o.due_date,effective_date:o.obligation_date || manifest.asOf,source_kind:o.source_kind,derivation_label:o.derivation_label});
 if(manifest.statementCreditCents)await trx('client_credit_lots').insert({...base,amount:(manifest.statementCreditCents/100).toFixed(2),kind:'statement_credit',source_key:`legacy-credit/${scope.customerId}/${scope.entityId}`,effective_date:manifest.asOf,derivation_label:'Reconstructed signed legacy opening; already included in billed balance'});
 for(const row of manifest.paymentSources.filter(p=>Number(p.payment_amount)<0 && !p.retainer_id && !['Retainer','Prepayment','Receipt application','Receipt credit'].includes(p.form_of_payment)))await trx('payment_receipts').insert({...base,amount:(-Number(row.payment_amount)).toFixed(2),receipt_date:day(row.payment_date),method:/check/i.test(row.form_of_payment)?'check':/cash/i.test(row.form_of_payment)?'cash':'other',reference:row.payment_reference_number,source_kind:'legacy_derived',source_key:`legacy-payment/${row.payment_id}`,created_by:row.created_by_user_id,reason:'Reconstructed one receipt per existing standalone payment; opening already includes its effect'}).onConflict(['account_id','source_key']).ignore();
 // A transfer creates a new root for the destination business, but represents
 // the same money already received by the source business.
 for(const row of manifest.retainerSources.filter(r=>Number(r.starting_amount)<0 && String(r.form_of_payment || '').trim().toLowerCase()!=='transfer'))await trx('payment_receipts').insert({...base,amount:(-Number(row.starting_amount)).toFixed(2),receipt_date:day(row.created_at),method:'other',source_kind:'legacy_retainer',source_key:`legacy-retainer/${row.retainer_id}`,created_by:row.created_by_user_id,reason:'Reconstructed deposit represented by the existing retainer; no new spendable credit'}).onConflict(['account_id','source_key']).ignore();
}
module.exports={recorded,derive,plan,ensure,historicalBalance};
