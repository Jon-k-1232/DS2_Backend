'use strict';
// One batch per evidence table, within the caller's pricing snapshot. No cache,
// changed statement gates, or mutation/finalize fingerprint shortcuts.
const {day}=require('../../payments/receipt-values');
async function read(db,scope,markers,billingDate){
 const {accountId,entityId,customerIds}=scope;
 const customerCorrections=Object.fromEntries(customerIds.map(id=>[id,[]]));
 const customerReceipts=Object.fromEntries(customerIds.map(id=>[id,[]]));
 const customerCreditLots=await require('../../payments/receipt-ledger').creditLotsMany(db,scope,{asOf:billingDate});
 for(const [table,key,label,sign] of [['credit_memos','memo_id','Credit memo',-1],['credit_memo_reversals','reversal_id','Credit memo reversal',1],['invoice_voids','void_id','Invoice void',-1],['client_refunds','refund_id','Money returned',1]]){
  const rows=await db(`${table} as c`).where({'c.account_id':accountId,'c.billing_entity_id':entityId}).whereIn('c.customer_id',customerIds)
   .whereNotExists(db('invoice_statement_members as m').select(db.raw('1')).where({'m.account_id':accountId,'m.table_name':table}).whereRaw(`m.record_id=c.${key}`));
  for(const r of rows)customerCorrections[r.customer_id].push({table,id:r[key],label,number:r.number || `#${r[key]}`,originalInvoiceId:r.original_invoice_id,amount:sign*Number(r.amount),reason:r.reason,date:day(r.effective_date)});
 }
 // Compare the exact database timestamps, including microseconds. Receipt
 // timestamps are timestamptz; legacy invoice timestamps are UTC without zone.
 const markerPairs=customerIds.map(id=>[id,markers[id]?.customer_invoice_id || null]);
 const q=db('payment_receipts as r').select('r.*').where({'r.account_id':accountId,'r.billing_entity_id':entityId,'r.source_kind':'manual'})
  .whereIn('r.customer_id',customerIds).joinRaw(`JOIN jsonb_to_recordset(?::jsonb) AS gate(customer_id integer, invoice_id integer) ON gate.customer_id=r.customer_id`,[JSON.stringify(markerPairs.map(([customer_id,invoice_id])=>({customer_id,invoice_id})))])
  .whereRaw("(gate.invoice_id IS NULL OR r.created_at > (SELECT created_at AT TIME ZONE 'UTC' FROM public.customer_invoices WHERE customer_invoice_id=gate.invoice_id))").orderBy('r.receipt_id');
 if(billingDate)q.where('r.receipt_date','<=',billingDate);
 for(const r of await q)customerReceipts[r.customer_id].push(r);
 return {customerCreditLots,customerCorrections,customerReceipts};
}
module.exports={read};
