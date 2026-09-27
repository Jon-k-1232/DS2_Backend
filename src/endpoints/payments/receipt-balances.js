'use strict';
// Read projection for reporting. The command reader and its full fingerprint
// remain unchanged. AR needs balances/ages, never a mutation authorization token.
const v=require('./receipt-values'),legacy=require('./legacy-obligations');
const {creditLotsMany}=require('./receipt-ledger');
const group=rows=>{const out=new Map();for(const row of rows){if(!out.has(row.customer_id))out.set(row.customer_id,[]);out.get(row.customer_id).push(row);}return out;};
async function readMany(trx,{accountId,entityId,customerIds},options={}){
 const cutoff=await v.databaseCutoffs(trx,options);
 const scope={account_id:accountId,billing_entity_id:entityId};
 const query=table=>trx(table).where(scope).whereIn('customer_id',customerIds);
 const visible=table=>query(table).where('effective_date','<=',cutoff.asOf).where('created_at','<=',cutoff.recordedThrough);
 const derivations=new Map((await query('ar_derivations')).map(d=>[d.customer_id,d]));
 const current=id=>{const d=derivations.get(id);return d && cutoff.asOf>=v.day(d.as_of) && new Date(cutoff.recordedThrough)>=new Date(d.created_at);};
 const obligations=group(await trx('ar_obligations as o').leftJoin('public.customer_invoices as i','i.customer_invoice_id','o.original_invoice_id')
  .where({'o.account_id':accountId,'o.billing_entity_id':entityId}).whereIn('o.customer_id',customerIds)
  .where('o.effective_date','<=',cutoff.asOf).where('o.created_at','<=',cutoff.recordedThrough)
  .select('o.*','i.invoice_number').orderBy([{column:'o.obligation_date',nulls:'last'},{column:'o.original_invoice_id'},{column:'o.obligation_id'}]));
 const applications=group(await visible('ar_applications').orderBy('application_id'));
 const carriers=await visible('ar_obligation_carriers').orderBy('carrier_id'),carrierMap=new Map(carriers.map(c=>[c.obligation_id,c.invoice_id]));
 const credits=await creditLotsMany(trx,{accountId,entityId,customerIds},cutoff);
 const missing=customerIds.filter(id=>!derivations.has(id));
 const sourceQuery=table=>trx(table).where({account_id:accountId}).whereIn('customer_id',missing);
 const invoices=group(missing.length?await sourceQuery('customer_invoices').select('*',trx.raw('created_at::text AS created_at_exact')).orderBy('customer_invoice_id'):[]);
 const payments=group(missing.length?await sourceQuery('customer_payments').select('*',trx.raw('created_at::text AS created_at_exact')).orderBy('payment_id'):[]);
 const retainers=group(missing.length?await sourceQuery('customer_retainers_and_prepayments').whereNull('parent_retainer_id').orderBy('retainer_id'):[]);
 const out={};
 for(const customerId of customerIds){
  const lots=credits[customerId];
  if(!current(customerId)){
   const d=derivations.get(customerId);
   const opening=d?{...legacy.derive(d.manifest.sources.filter(r=>legacy.recorded(r)<=new Date(cutoff.recordedThrough)),legacy.historicalBalance(d.manifest.sources,cutoff),{...cutoff,payments:(d.manifest.paymentSources || []).filter(p=>v.day(p.payment_date)<=cutoff.asOf && legacy.recorded(p)<=new Date(cutoff.recordedThrough))}),accountId,customerId,entityId}
    :await legacy.plan(trx,{accountId,customerId,entityId},cutoff,{invoices:invoices.get(customerId)||[],paymentSources:payments.get(customerId)||[],retainerSources:retainers.get(customerId)||[]});
   out[customerId]={...cutoff,derived:false,obligations:opening.obligations.map((o,i)=>({...o,obligation_id:`legacy-${i}`,amount:v.dollars(o.openCents),carrying_invoice_id:null})),credits:lots,legacy:opening,billedCents:opening.billedCents,reconstructed:true};
  }else{
   const apps=applications.get(customerId)||[],deltas=new Map();
   for(const a of apps)deltas.set(a.obligation_id,(deltas.get(a.obligation_id)||0)+v.cents(a.amount)*a.direction);
   const open=(obligations.get(customerId)||[]).map(o=>({...o,openCents:v.cents(o.amount)-(deltas.get(o.obligation_id)||0),carrying_invoice_id:carrierMap.get(o.obligation_id)||o.original_invoice_id}));
   out[customerId]={...cutoff,derived:true,obligations:open,applications:apps,credits:lots,billedCents:open.reduce((n,o)=>n+o.openCents,0)-lots.filter(c=>c.kind==='statement_credit').reduce((n,c)=>n+c.availableCents,0),reconstructed:open.some(o=>o.source_kind.startsWith('legacy'))};
  }
 }
 return out;
}
module.exports={readMany};
