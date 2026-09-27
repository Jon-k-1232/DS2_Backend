'use strict';
// Fixture-only maintenance, deliberately unreachable from application code.
// No production URL, reference database or nonfixture ds2_local account accepted.
async function fixtureMaintenance(db, accountId, fn) {
 const cfg=db.client.config.connection;
 if (!['127.0.0.1','localhost'].includes(cfg.host) || Number(cfg.port)!==5433 ||
    !['ds2_local','ds2_clean','ds2_scenarios'].includes(cfg.database) || (cfg.database==='ds2_local' && Number(accountId)!==9001)) throw new Error('Unsafe sent-fixture maintenance target');
 return db.transaction(async trx=>{await trx.raw('SET LOCAL session_replication_role = replica');return fn(trx);});
}
async function unseal(db, accountId, customerIds) {
 return fixtureMaintenance(db,accountId,async trx=>{
   for(const table of ['ar_obligation_carriers','receipt_events','client_credit_events','ar_applications','client_credit_lots','payment_receipts','ar_obligations','ar_derivations']){
      const query=trx(table).where({account_id:Number(accountId)});if(customerIds)query.whereIn('customer_id',customerIds);await query.del();
   }
   const flags=trx('duplicate_flags').where({account_id:Number(accountId)});
   if(customerIds) flags.whereIn('customer_id',customerIds);
   const flagIds=await flags.pluck('duplicate_id');
   await trx('duplicate_history').where({account_id:Number(accountId)}).whereIn('duplicate_id',flagIds).del();
   await trx('duplicate_flags').where({account_id:Number(accountId)}).whereIn('duplicate_id',flagIds).del();
   const events=trx('retainer_events').where({account_id:Number(accountId)});
   if(customerIds) events.whereIn('customer_id',customerIds);
   await events.del();
   const q=trx('invoice_issues').where({account_id:Number(accountId)});
   if(customerIds) q.whereIn('customer_id',customerIds);
   const ids=await q.pluck('invoice_id');
   // Time-travel fixtures may also meet the historical artifact fallback.
   const parents=trx('customer_invoices').where({account_id:Number(accountId)}).whereNull('parent_invoice_id');
   if(customerIds) parents.whereIn('customer_id',customerIds);
   await parents.update({invoice_file_location:null});
   for(const table of ['invoice_history','invoice_revisions','invoice_exception_payments','invoice_exceptions','invoice_statement_members','invoice_issues'])
     await trx(table).where({account_id:Number(accountId)}).whereIn('invoice_id',ids).del();
 });
}
async function shiftObligations(trx,accountId,days,customerIds){
 for(const [table,columns] of Object.entries({ar_derivations:['as_of'],ar_obligations:['obligation_date','due_date','effective_date'],payment_receipts:['receipt_date'],ar_applications:['effective_date'],client_credit_lots:['effective_date'],client_credit_events:['effective_date'],receipt_events:['effective_date'],ar_obligation_carriers:['effective_date']})){
  const query=trx(table).where({account_id:accountId});if(customerIds)query.whereIn('customer_id',customerIds);
  await query.update(Object.fromEntries([...columns.map(column=>[column,trx.raw('?? - ?::int',[column,days])]),['created_at',trx.raw('created_at - ?::interval',[`${days} days`])]]));
 }
}
module.exports={fixtureMaintenance,unseal,shiftObligations};
