'use strict';
// Pure historical projection of immutable cutover evidence. Mirrors the scoped
// SQL reader, without inventing events or changing original statement evidence.
function project(invoices, allocations, entityId=null){
 const grouped=new Map();
 for(const a of allocations){const key=Number(a.source_root_id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(a);}
 const rows=invoices.filter(r=>{
  const slices=grouped.get(Number(r.parent_invoice_id || r.customer_invoice_id));
  return !slices || (r.parent_invoice_id && new Date(r.created_at)>new Date(slices[0].created_at));
 });
 for(const [root,slices] of grouped){const original=invoices.find(r=>Number(r.customer_invoice_id)===root);if(!original)continue;
  for(const a of slices)rows.push({...original,billing_entity_id:a.billing_entity_id,remaining_balance_on_invoice:a.opening_amount,total_amount_due:a.opening_amount,
   beginning_balance:a.opening_amount,total_charges:0,total_payments:0,total_write_offs:0,total_retainers:0,is_invoice_paid_in_full:false});
 }
 return rows.filter(r=>!entityId || Number(r.billing_entity_id)===Number(entityId));
}
module.exports={project};
