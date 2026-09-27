'use strict';
const crypto=require('crypto');
const { id, text, reason, actionContext }=require('../../utils/ledgerAction');
const { ruleError, lockCustomerLedger }=require('../payments/ledger-helpers');
const context=require('./entity-context');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const fields=['name','legal_name','contact_name','email','phone','address_line1','address_line2','city','state','postal_code','country','invoice_prefix'];
function validate(body,create=false) {
   const out={};
   for(const key of fields) if(create && ['name','legal_name','invoice_prefix'].includes(key) || Object.hasOwn(body,key)) out[key]=text(body[key],key.replace(/_/g,' '),key==='name'?150:200,['name','legal_name','invoice_prefix'].includes(key));
   if(out.invoice_prefix && !/^[A-Z]{1,12}$/.test(out.invoice_prefix))throw ruleError('Invoice prefix must contain 1–12 uppercase letters.',400);
   if(out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))throw ruleError('Enter a valid email address.',400);
   for(const key of ['active','is_default']) if(Object.hasOwn(body,key)){if(typeof body[key]!=='boolean')throw ruleError(`${key} must be true or false.`,400);out[key]=body[key];}
   return out;
}
async function lockAccount(trx,accountId,actorId,why) {
   await actionContext(trx,actorId,why);
   await trx.raw('SELECT pg_advisory_xact_lock(260026, ?)',[accountId]);
   await trx('public.accounts').where({account_id:accountId}).forNoKeyUpdate().first();
}
async function create(db,{accountId,actorId,body}) {
   const input=validate(body,true),why=reason(body.reason);
   return db.transaction(async trx=>{
      await lockAccount(trx,accountId,actorId,why);
      if(input.is_default){if(input.active===false)throw ruleError('The default business must be active.',409);await trx('public.billing_entities').where({account_id:accountId,is_default:true}).update({is_default:false,version:trx.raw('version+1'),updated_at:trx.fn.now()});}
      const [entity]=await trx('public.billing_entities').insert({...input,account_id:accountId}).returning('*');
      return {entity};
   });
}
async function hasOpenBalance(trx,accountId,entityId) {
   return context.run(entityId,async()=>{
      const result=await trx.raw(`WITH roots AS(SELECT *,max(invoice_date) OVER(PARTITION BY customer_id) AS last_date FROM customer_invoices WHERE account_id=? AND parent_invoice_id IS NULL)
      SELECT 1 FROM roots r CROSS JOIN LATERAL(SELECT remaining_balance_on_invoice FROM customer_invoices c WHERE c.account_id=r.account_id AND(c.customer_invoice_id=r.customer_invoice_id OR c.parent_invoice_id=r.customer_invoice_id) ORDER BY c.created_at DESC,c.customer_invoice_id DESC LIMIT 1)s WHERE r.invoice_date=r.last_date AND s.remaining_balance_on_invoice<>0 LIMIT 1`,[accountId]);
      if(result.rows.length)return true;
      const held=await trx.raw(`SELECT 1 FROM customer_retainers_and_prepayments r WHERE r.account_id=? AND r.parent_retainer_id IS NULL AND COALESCE((SELECT c.current_amount FROM customer_retainers_and_prepayments c WHERE c.account_id=r.account_id AND c.parent_retainer_id=r.retainer_id ORDER BY c.created_at DESC,c.retainer_id DESC LIMIT 1),r.current_amount)<>0 LIMIT 1`,[accountId]);
      return held.rows.length>0;
   });
}
async function update(db,{accountId,actorId,entityId,body}) {
   const input=validate(body),why=reason(body.reason),expected=id(body.expectedVersion);
   return db.transaction(async trx=>{
      await lockAccount(trx,accountId,actorId,why);
      const row=await context.requireEntity(trx,accountId,entityId,{active:false});
      if(row.version!==expected)throw ruleError('This business changed. Reload before saving.',409);
      if(input.active===false && await hasOpenBalance(trx,accountId,row.billing_entity_id))throw ruleError('This business has open balances or held funds. Settle or transfer them before deactivating.',409);
      if(input.active===false && row.is_default || input.is_default===false && row.is_default)throw ruleError('Choose another active default business first.',409);
      if(input.invoice_prefix && input.invoice_prefix!==row.invoice_prefix && await trx('public.billing_entity_invoice_sequences').where({account_id:accountId,billing_entity_id:row.billing_entity_id}).first())throw ruleError('An invoice prefix cannot change after numbering has started.',409);
      if(input.is_default){if(input.active===false || !row.active && input.active!==true)throw ruleError('The default business must be active.',409);await trx('public.billing_entities').where({account_id:accountId,is_default:true}).whereNot({billing_entity_id:row.billing_entity_id}).update({is_default:false,version:trx.raw('version+1'),updated_at:trx.fn.now()});}
      const [entity]=await trx('public.billing_entities').where({account_id:accountId,billing_entity_id:row.billing_entity_id,version:expected}).update({...input,version:expected+1,updated_at:trx.fn.now()}).returning('*');
      return {entity};
   });
}
async function addAlias(db,{accountId,actorId,entityId,body}) {
   const alias=text(body.alias,'Tracker spelling',200),why=reason(body.reason);
   return db.transaction(async trx=>{await lockAccount(trx,accountId,actorId,why);const e=await context.requireEntity(trx,accountId,entityId);const normalized=(await trx.raw('SELECT public.ds2_normalize_entity(?) AS value',[alias])).rows[0].value;
      if(!normalized)throw ruleError('The alias needs letters or numbers.',400);
      const matches=(await trx.raw('SELECT public.ds2_entity_match(?,?) AS ids',[accountId,alias])).rows[0].ids;
      if(matches.some(n=>n!==e.billing_entity_id))throw ruleError('This spelling already identifies another business.',409);
      const [row]=await trx('public.billing_entity_aliases').insert({account_id:accountId,billing_entity_id:e.billing_entity_id,alias,source:'admin',reason:why}).returning('*');return {alias:row};});
}
async function removeAlias(db,{accountId,actorId,entityId,aliasId,body}) {
   const why=reason(body.reason);
   return db.transaction(async trx=>{await lockAccount(trx,accountId,actorId,why);await context.requireEntity(trx,accountId,entityId,{active:false});const row=await trx('public.billing_entity_aliases').where({account_id:accountId,billing_entity_id:id(entityId),alias_id:id(aliasId)}).first();if(!row)throw ruleError('Alias not found.',404);
      if(await trx('public.timesheet_entries').where({account_id:accountId}).whereRaw('public.ds2_normalize_entity(entity)=?',[row.normalized_alias]).first())throw ruleError('This spelling is already used by tracker evidence and cannot be removed.',409);
      await trx('public.billing_entity_aliases').where({alias_id:row.alias_id}).delete();return {message:'Unused alias removed.'};});
}
async function sourceRow(db,review) {
   const key=review.table_name==='timesheet_entries'?'timesheet_entry_id':'transaction_id';
   return db(`public.${review.table_name}`).select('*',db.raw("encode(sha256(convert_to((to_jsonb(r)-'billing_entity_id')::text,'UTF8')),'hex') AS source_hash")).from(`public.${review.table_name} as r`).where({'r.account_id':review.account_id,[`r.${key}`]:review.record_id}).first();
}
async function reviews(db,accountId,{limit=100,offset=0}={}) {
   const base=db('public.billing_entity_reviews as r').where('r.account_id',accountId).whereNotExists(db('public.billing_entity_resolutions as s').select(db.raw('1')).whereRaw('s.review_id=r.review_id'))
      .whereNotExists(db('public.legacy_billing_scopes as s').select(db.raw('1')).whereRaw('s.account_id=r.account_id AND s.table_name=r.table_name AND s.record_id=r.record_id'))
      // Review evidence outlives a deleted source. Exclude those rows before
      // counting/paging, rather than creating empty pages in the active queue.
      .where(function(){this.where(function(){this.where('r.table_name','timesheet_entries').whereExists(db('public.timesheet_entries as t').select(db.raw('1')).whereRaw('t.account_id=r.account_id AND t.timesheet_entry_id=r.record_id'));})
         .orWhere(function(){this.where('r.table_name','customer_transactions').whereExists(db('public.customer_transactions as t').select(db.raw('1')).whereRaw('t.account_id=r.account_id AND t.transaction_id=r.record_id'));});});
   const count=await base.clone().count({n:'*'}).first();const rows=await base.select('r.*').orderBy('r.review_id').limit(limit).offset(offset);
   const data=[];for(const r of rows){const source=await sourceRow(db,r);if(source)data.push({...r,sourceHash:source.source_hash,source});}
   return {reviews:data,totalCount:Number(count.n)};
}
async function resolve(db,{accountId,actorId,reviewId,body}) {
   const why=reason(body.reason),expected=text(body.expectedSourceHash,'Source version',64);
   return db.transaction(async trx=>{await lockAccount(trx,accountId,actorId,why);const review=await trx('public.billing_entity_reviews').where({account_id:accountId,review_id:id(reviewId)}).first();if(!review)throw ruleError('Review entry not found.',404);
      const e=await context.requireEntity(trx,accountId,body.entityId);if(review.customer_id)await lockCustomerLedger(trx,accountId,review.customer_id);
      if(await trx('public.billing_entity_resolutions').where({review_id:review.review_id}).first())throw ruleError('This entry was already resolved. Refresh the review queue.',409);
      if(await trx('public.legacy_billing_scopes').where({account_id:accountId,table_name:review.table_name,record_id:review.record_id}).first())throw ruleError('Legacy work was released to its opening business. Use reasoned work reassignment to move it.',409);
      const row=await sourceRow(trx,review);if(!row)throw ruleError('Source entry no longer exists.',404);if(row.source_hash!==expected)throw ruleError('This entry changed. Reload before choosing its business.',409);
      if(review.table_name==='customer_transactions' && row.customer_invoice_id || review.table_name==='timesheet_entries' && (row.is_processed || row.is_deleted))throw ruleError('This entry has already been processed or issued.',409);
      await trx(`public.${review.table_name}`).where({account_id:accountId,[review.table_name==='timesheet_entries'?'timesheet_entry_id':'transaction_id']:review.record_id}).update({billing_entity_id:e.billing_entity_id,...(review.table_name==='timesheet_entries'?{hold_reason:null}:{})});
      const [resolution]=await trx('public.billing_entity_resolutions').insert({account_id:accountId,customer_id:review.customer_id,review_id:review.review_id,billing_entity_id:e.billing_entity_id,reason:why,source_sha256:expected}).returning('*');
      return {resolution,message:'Business chosen. This work is ready for the existing billing review.'};});
}
async function classifyTracker(db,rows) {
   for(const row of rows){const ids=(await db.raw('SELECT public.ds2_entity_match(?,?) AS ids',[row.account_id,row.entity])).rows[0].ids;
      if(ids.length===1)row.billing_entity_id=ids[0];else {row.billing_entity_id=null;row.hold_reason=ids.length?'entity_ambiguous':'entity_unknown';}}
   return rows;
}
async function captureTrackerReviews(db,rows) {
   for(const row of rows)if(!row.billing_entity_id){const ids=(await db.raw('SELECT public.ds2_entity_match(?,?) AS ids',[row.account_id,row.entity])).rows[0].ids;await db('public.billing_entity_reviews').insert({account_id:row.account_id,customer_id:row.suggested_customer_id,table_name:'timesheet_entries',record_id:row.timesheet_entry_id,raw_entity:row.entity,candidate_ids:ids,source_sha256:sha(JSON.stringify(row)),reason_code:ids.length?'entity_ambiguous':'entity_unknown'}).onConflict(['account_id','table_name','record_id']).ignore();}
}
module.exports={validate,create,update,addAlias,removeAlias,reviews,resolve,classifyTracker,captureTrackerReviews,lockAccount,hasOpenBalance,sha};
