'use strict';
const {randomUUID}=require('crypto');
const context=require('./entity-context');
const {id,reason}=require('../../utils/ledgerAction');
const {ruleError}=require('../payments/ledger-helpers');
const {sha,lockAccount}=require('./entities-service');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Read the original cutover's enumerated work, including unresolved work. Never
// include a newly recorded entry merely because its service date was backdated.
async function inventory(trx,accountId){
 const original=await trx('public.billing_cutovers').where({account_id:accountId,source:'migration/028/default'}).first();
 if(!original)throw ruleError('This account has no legacy cutover to amend.',404);
 const entityId=Number(original.manifest.default_entity_id);
 await context.requireEntity(trx,accountId,entityId);
 const applied=await trx('billing_cutover_amendments').where({account_id:accountId,supersedes_cutover_id:original.cutover_id}).first();
 const rows=(await trx.raw(`
 SELECT 'customer_transactions' AS table_name,t.transaction_id AS record_id,t.customer_id,
 encode(sha256(convert_to((to_jsonb(t)-'billing_entity_id')::text,'UTF8')),'hex') AS source_sha256,
 CASE WHEN l.sources=1 AND cardinality(ds2_entity_match(t.account_id,l.raw_entity))=1
 THEN (ds2_entity_match(t.account_id,l.raw_entity))[1] END AS reporting_entity_id
 FROM public.customer_transactions t
 LEFT JOIN LATERAL(SELECT count(DISTINCT a.timesheet_entry_id) AS sources,min(te.entity) AS raw_entity
 FROM ai_category_training_examples a JOIN public.timesheet_entries te ON te.account_id=a.account_id AND te.timesheet_entry_id=a.timesheet_entry_id
 WHERE a.account_id=t.account_id AND a.transaction_id=t.transaction_id)l ON true
 WHERE t.account_id=? AND (EXISTS(SELECT 1 FROM legacy_financial_entity_attributions a WHERE a.account_id=t.account_id AND a.table_name='customer_transactions' AND a.record_id=t.transaction_id AND a.cutover_id=?)
 OR EXISTS(SELECT 1 FROM billing_entity_reviews r WHERE r.account_id=t.account_id AND r.table_name='customer_transactions' AND r.record_id=t.transaction_id AND r.reason_code='legacy_source_unresolved'))
 UNION ALL
 SELECT 'timesheet_entries',t.timesheet_entry_id,t.suggested_customer_id,
 encode(sha256(convert_to((to_jsonb(t)-'billing_entity_id')::text,'UTF8')),'hex'),
 CASE WHEN cardinality(ds2_entity_match(t.account_id,t.entity))=1 THEN (ds2_entity_match(t.account_id,t.entity))[1] END
 FROM public.timesheet_entries t WHERE t.account_id=? AND t.created_at<=?
 ORDER BY table_name,record_id`,[accountId,original.cutover_id,accountId,original.created_at])).rows;
 const guards={};
 for(const table of ['billing_cutover_links','billing_cutover_allocations','billing_entity_resolutions','billing_credit_transfers','invoice_issues']){
  guards[table]=Number((await trx(table).where({account_id:accountId}).count({n:'*'}).first()).n);
 }
 // Post-cutover statements, receipts, work edits and import changes invalidate
 // the amendment: this path is specifically for re-planning before resumption.
 const changed=(await trx.raw(`SELECT count(*)::integer AS n FROM audit_events
 WHERE account_id=? AND occurred_at>? AND entity IN ('customer_invoices','customer_transactions','customer_payments','customer_writeoffs','customer_retainers_and_prepayments','timesheet_entries','ar_derivations','ar_obligations','payment_receipts','ar_applications','client_credit_lots','client_credit_events','receipt_events','ar_obligation_carriers')`,[accountId,original.created_at])).rows[0];
 guards.financialWrites=changed.n;
 const manifest={version:2,policy:'legacy-opening-default',accountId,originalCutoverId:original.cutover_id,defaultEntityId:entityId,guards,rows};
 return {manifest,manifestHash:sha(JSON.stringify(manifest)),applied};
}
async function plan(db,accountId){return context.unscoped(()=>db.transaction(async trx=>{
 await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 return inventory(trx,id(accountId));
}));}
async function apply(db,{accountId,actorId,body,key}){
 if(!UUID.test(key || ''))throw ruleError('A UUID Idempotency-Key is required.',400);
 const why=reason(body.reason);
 if(!/^[a-f0-9]{64}$/.test(body.manifestHash || ''))throw ruleError('Supply the reviewed amendment manifest hash.',400);
 const inputHash=sha(JSON.stringify({manifestHash:body.manifestHash,reason:why}));
 return context.unscoped(()=>db.transaction(async trx=>{
  await lockAccount(trx,accountId,actorId || '',why);
  const previous=await trx('financial_requests').where({account_id:accountId,operation:'cutover_amendment',idempotency_key:key}).first();
  if(previous){if(previous.input_hash!==inputHash)throw ruleError('This key identifies another amendment.',409);return previous.response;}
  const current=await inventory(trx,accountId);
  if(current.applied)throw ruleError('This legacy cutover already has a superseding amendment.',409);
  if(current.manifestHash!==body.manifestHash)throw ruleError('The cutover changed. Regenerate and review the amendment.',409);
  if(Object.values(current.manifest.guards).some(n=>n))throw ruleError('Billing or financial decisions have resumed. This cutover can no longer be re-planned.',409);
  const {manifest}=current;
  const [cutover]=await trx('billing_cutovers').insert({account_id:accountId,source:`amendment/${key}`,manifest:{...manifest,reason:why},manifest_sha256:sha(JSON.stringify({...manifest,reason:why}))}).returning('*');
  const [amendment]=await trx('billing_cutover_amendments').insert({account_id:accountId,cutover_id:cutover.cutover_id,supersedes_cutover_id:manifest.originalCutoverId,billing_entity_id:manifest.defaultEntityId,reason:why}).returning('*');
  for(let start=0;start<manifest.rows.length;start+=250){
   await trx('legacy_billing_scopes').insert(manifest.rows.slice(start,start+250).map(row=>({...row,account_id:accountId,amendment_id:amendment.amendment_id,billing_entity_id:manifest.defaultEntityId,
    reporting_basis:row.reporting_entity_id?'legacy attribution: tracker entity':'unattributed legacy work'})));
  }
  const response={amendmentId:amendment.amendment_id,cutoverId:cutover.cutover_id,manifestHash:cutover.manifest_sha256,rows:manifest.rows.length,message:'Legacy opening scope restored to the default business. Original evidence and reporting attribution preserved.'};
  await trx('financial_requests').insert({request_id:randomUUID(),account_id:accountId,customer_id:manifest.rows.find(r=>r.customer_id)?.customer_id || 0,operation:'cutover_amendment',idempotency_key:key,input_hash:inputHash,response});
  return response;
 }));
}
async function candidates(db,accountId){return context.unscoped(()=>db.transaction(async trx=>{
 await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const rows=(await trx.raw(`SELECT t.transaction_id,t.customer_id,c.display_name,t.transaction_date,t.total_transaction,
 s.billing_entity_id AS opening_entity_id,s.reporting_entity_id,s.reporting_basis,e.name AS tracker_business,last_issue.invoice_date AS last_issued_date,
 encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS source_hash
 FROM legacy_billing_scopes s JOIN public.customer_transactions t ON t.account_id=s.account_id AND t.transaction_id=s.record_id
 JOIN customers c ON c.account_id=t.account_id AND c.customer_id=t.customer_id
 JOIN billing_entities e ON e.billing_entity_id=s.reporting_entity_id
 LEFT JOIN LATERAL(SELECT max(i.invoice_date) AS invoice_date FROM public.customer_invoices i WHERE i.account_id=t.account_id AND i.customer_id=t.customer_id AND i.parent_invoice_id IS NULL
 AND (NULLIF(i.invoice_file_location,'') IS NOT NULL OR EXISTS(SELECT 1 FROM invoice_issues u WHERE u.account_id=i.account_id AND u.invoice_id=i.customer_invoice_id)))last_issue ON true
 WHERE s.account_id=? AND s.table_name='customer_transactions' AND t.customer_invoice_id IS NULL
 AND s.reporting_entity_id<>s.billing_entity_id AND ds2_effective_entity(t.account_id,'customer_transactions',t.transaction_id,t.billing_entity_id)=s.billing_entity_id
 AND last_issue.invoice_date IS NOT NULL AND t.transaction_date>last_issue.invoice_date ORDER BY t.customer_id,t.transaction_date,t.transaction_id`,[accountId])).rows;
 const unmatched=await trx('legacy_billing_scopes as s').join('public.timesheet_entries as t',function(){this.on('t.account_id','s.account_id').andOn('t.timesheet_entry_id','s.record_id');})
 .where({'s.account_id':accountId,'s.table_name':'timesheet_entries'}).whereNull('s.reporting_entity_id').select('t.timesheet_entry_id','t.entity','s.reporting_basis');
 return {candidates:rows,unmatchedLegacyTrackers:unmatched,explanation:'Candidates only. An admin may explicitly move unbilled work with a reason; no money is moved by this report.'};
}));}
module.exports={plan,apply,candidates};
