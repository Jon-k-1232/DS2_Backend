'use strict';
const { auditCustomerLedger } = require('../accountAudit/account-audit-logic');
const { billingDateToday } = require('../invoice/billingDate');
const presentation = require('./audit-record-presentation');
const { ruleError } = require('../payments/ledger-helpers');
const entityContext=require('../billingEntities/entity-context');
const TABLES = {legacy_work_cost_estimates:'estimate_id',recurring_plan_cutovers:'cutover_id',recurring_charge_occurrences:'occurrence_id',recurring_occurrence_events:'event_id',credit_memos:'memo_id',credit_memo_lines:'line_id',credit_memo_reversals:'reversal_id',invoice_voids:'void_id',rebill_links:'link_id',client_refunds:'refund_id',correction_postings:'posting_id',
   legacy_billing_scopes:'scope_id',ar_derivations:'derivation_id',ar_obligations:'obligation_id',
   payment_receipts:'receipt_id',ar_applications:'application_id',client_credit_lots:'credit_id',client_credit_events:'event_id',
   receipt_events:'event_id',ar_obligation_carriers:'carrier_id',
   legacy_financial_entity_attributions:'attribution_id',billing_entity_reviews:'review_id',billing_entity_resolutions:'resolution_id',
   billing_cutover_allocations:'allocation_id',billing_cutover_allocation_links:'link_id',billing_cutover_positions:'position_id',billing_cutover_links:'link_id',billing_credit_transfers:'transfer_id',financial_requests:'request_id',
   customers: 'customer_id', customer_information: 'customer_info_id', customer_jobs: 'customer_job_id',
   customer_transactions: 'transaction_id', customer_payments: 'payment_id', customer_writeoffs: 'writeoff_id',
   customer_retainers_and_prepayments: 'retainer_id', customer_invoices: 'customer_invoice_id',
   recurring_customers: 'recurring_customer_id', customer_rate_agreements: 'rate_agreement_id', customer_quotes: 'customer_quote_id',
   retainer_events: 'event_id', duplicate_flags: 'duplicate_id', invoice_issues: 'invoice_id',
   ledger_normalization_log: 'log_id', invoice_history:'history_id', invoice_revisions:'invoice_id:revision',
   invoice_statement_members:'invoice_id:table_name:record_id',invoice_exceptions:'exception_id',
   invoice_exception_payments:'exception_id:payment_id',duplicate_history:'history_id',
   customer_payments_processed:'payment_id',timesheet_entries:'timesheet_entry_id',
   ai_time_tracker_transaction_suggestions:'suggestion_id',ai_category_training_examples:'training_id'
};
const INDIRECT=new Set(['invoice_history','invoice_revisions','invoice_statement_members','invoice_exceptions','invoice_exception_payments','duplicate_history',
   'timesheet_entries','ai_time_tracker_transaction_suggestions','ai_category_training_examples']);
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const utcTimestamp = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value) ? value.replace(' ','T')+'Z' : value;
const phoenixDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
function exact(row) {
   if (!row) return row;
   return { ...row, created_at_exact: row.created_at_exact || row.created_at?.replace('T',' ').replace(/Z$/, '') };
}
function balance(state, customerId, billingDate, entityId=null, legacy=new Map()) {
   const openingScopes=new Map([...(state.legacy_billing_scopes?.values() || [])].map(r=>[`${r.table_name}:${r.record_id}`,r.billing_entity_id]));
   const rows = table => [...(state[table]?.values() || [])].map(row=>{
      const key=TABLES[table];
      return exact({...row,billing_entity_id:row.billing_entity_id ?? openingScopes.get(`${table}:${row[key]}`) ?? legacy.get(`${table}:${row[key]}`) ?? null});
   }).filter(row=>!entityId || ['customers','customer_invoices'].includes(table) || Number(row.billing_entity_id)===Number(entityId));
   const invoices=require('../billingEntities/cutover-projection').project(rows('customer_invoices'),[...(state.billing_cutover_allocations?.values() || [])],entityId);
   const result = auditCustomerLedger({ customer: rows('customers')[0] || { customer_id: customerId },
      invoices, payments: rows('customer_payments'), writeoffs: rows('customer_writeoffs'),
      transactions: rows('customer_transactions').map(t=>({...t,recurring_occurrence_id:rows('recurring_charge_occurrences').find(o=>o.transaction_id===t.transaction_id)?.occurrence_id})), retainers: rows('customer_retainers_and_prepayments'),
      retainerEvents: rows('retainer_events'), corrections:rows('correction_postings'), billingDate });
   const lots=rows('client_credit_lots'),creditEvents=rows('client_credit_events');
   const heldCredit=money(lots.filter(l=>l.kind==='held_receipt').reduce((n,l)=>n+Number(l.amount)+creditEvents.filter(e=>e.credit_id===l.credit_id).reduce((m,e)=>m+Number(e.amount)*e.direction,0),0));
   return { running_balance: result.totals.audit_balance, billed_balance: result.totals.outstanding_invoices,
      held_credit_available:heldCredit,proposed_statement_balance:money(result.totals.audit_balance-Math.min(Math.max(0,result.totals.audit_balance),heldCredit)),
      unbilled_balance: money(result.totals.audit_balance - result.totals.outstanding_invoices), retainer_available: result.totals.retainer_available };
}
function apply(state, event, before, customerId) {
   if (!state[event.entity]) return;
   const row = before ? event.before_value : event.after_value;
   const key = String(event.entity_id);
   state[event.entity].delete(key);
   if (row && Number(row.customer_id ?? (before ? event.previous_customer_id : event.customer_id)) === customerId) state[event.entity].set(key, exact(row));
}
function activity(e) {
   const b=e.before_value || {}, a=e.after_value || {};
   const labels={credit_memos:'Credit memo',credit_memo_lines:'Credited charge',credit_memo_reversals:'Credit memo reversal',invoice_voids:'Original invoice void',rebill_links:'Corrected invoice',client_refunds:'Money returned to client',correction_postings:'Invoice correction',legacy_billing_scopes:'Legacy opening scope and reporting attribution',ar_derivations:'Legacy aging derivation',ar_obligations:'Original invoice obligation',
      payment_receipts:'Cash receipt (applications shown separately)',ar_applications:'Obligation application',client_credit_lots:'Client credit held',client_credit_events:'Client credit use or transfer',receipt_events:'Receipt action',ar_obligation_carriers:'Statement carries original debt',
      customers:'Customer profile',customer_information:'Customer address/contact',customer_jobs:'Job',customer_invoices:'Invoice balance',
      invoice_statement_members:'Frozen statement item',invoice_history:'Invoice action',invoice_exceptions:'Invoice exception',
      invoice_exception_payments:'Exception payment',duplicate_flags:'Duplicate review',duplicate_history:'Duplicate action',
      customer_payments_processed:'Payment image review',timesheet_entries:'Tracker entry',ai_category_training_examples:'Ingestion provenance',
      ai_time_tracker_transaction_suggestions:'Tracker suggestion',recurring_customers:'Recurring billing',customer_rate_agreements:'Rate agreement',
      customer_quotes:'Quote',ledger_normalization_log:'Historical normalization',audit_records:'Printed audit record',audit_actions:'Archive action'};
   let amount=0, kind=labels[e.entity] || e.entity, retainerDelta=0;
   const delta = field => money(Number(a[field] || 0)-Number(b[field] || 0));
   if(e.entity==='customer_transactions') { kind='Work'; amount=money((a.is_transaction_billable ? Number(a.total_transaction):0)-(b.is_transaction_billable ? Number(b.total_transaction):0)); }
   if(e.entity==='customer_payments') { kind=Number(a.payment_amount)>0?'Payment reversal':a.retainer_id?'Retainer draw':'Payment'; amount=delta('payment_amount'); }
   if(e.entity==='customer_writeoffs') { kind='Write-off'; amount=delta('writeoff_amount'); }
   if(e.entity==='retainer_events') { kind=`Retainer ${a.kind || b.kind}`; retainerDelta=-delta('balance_delta'); }
   if(e.entity==='customer_retainers_and_prepayments') {
      kind='Retainer balance snapshot';
      if(!(a.parent_retainer_id || b.parent_retainer_id)){kind='Retainer receipt';retainerDelta=-delta('current_amount');}
   }
   if(e.entity==='correction_postings') amount=delta('amount');
   if(e.entity==='rebill_links') amount=(a.lines || []).reduce((n,l)=>n+Number(l.amount),0);
   if(e.entity==='invoice_issues') kind='Invoice finalized - sent and locked';
   if(e.entity==='invoice_revisions') kind=Number(a.revision)===0?'Original invoice archive':'Invoice revision';
   return { kind, amount, debit:amount>0?amount:0, credit:amount<0?-amount:0, retainer_delta:retainerDelta,
      invoice_total: e.entity==='invoice_issues' ? Number(a.payload?.invoiceTotal ?? a.payload?.original?.total_amount_due ?? 0) :
         e.entity==='customer_invoices' && !a.parent_invoice_id ? Number(a.total_amount_due || 0) : undefined };
}
async function verify(db, accountId) {
   return (await db.raw('SELECT ds2_verify_audit(?::integer) AS verification',[accountId])).rows[0].verification;
}
async function customer(db, accountId, customerId) {
   const found=await db('customers').where({account_id:accountId,customer_id:customerId}).first();
   if(found) return found;
   // Deletion must not make retained evidence unreachable to administrators.
   const deleted=await db('audit_events').where({account_id:accountId,entity:'customers',entity_id:String(customerId),action:'delete'}).orderBy('event_id','desc').first();
   if(deleted) return {...deleted.before_value, deleted:true};
   throw ruleError('Customer not found.',404);
}
async function history(db,accountId,customerId,options={}) {
   const entityId=entityContext.current();
   return entityContext.run(null,()=>fullHistory(db,accountId,customerId,{...options,entityId}));
}
async function fullHistory(db, accountId, customerId, options={}) {
   const c=await customer(db,accountId,customerId);
   const policy=await db('audit_policy').first();
   const integrity=await verify(db,accountId);
   if(!integrity.valid) throw ruleError('Audit chain verification failed. Record generation is blocked.',409,'AUDIT_INTEGRITY_FAILED');
   const companyTables=['billing_entities','billing_entity_aliases','billing_entity_invoice_sequences','billing_cutovers','billing_cutover_amendments'];
   // Company-wide configuration remains in the verified account chain. A
   // client's history includes it only when it supports that client's atomic
   // posting (for example, allocating an invoice number during finalization).
   // Otherwise another client's numbering changes can bury this client's work.
   const clientPostings=db('audit_events').select('transaction_id').where({account_id:accountId})
      .where(q=>q.where('customer_id',customerId).orWhere('previous_customer_id',customerId));
   const events=await db('audit_events').where({account_id:accountId}).where(q=>q.where('customer_id',customerId)
      .orWhere('previous_customer_id',customerId)
      .orWhere(q=>q.whereIn('entity',companyTables).whereIn('transaction_id',clientPostings))).orderBy('event_id');
   const legacy=new Map((await db('legacy_financial_entity_attributions').where({account_id:accountId,customer_id:customerId})).map(r=>[`${r.table_name}:${r.record_id}`,r.billing_entity_id]));
   const openingScopes=new Map((await db('legacy_billing_scopes').where({account_id:accountId,customer_id:customerId})).map(r=>[`${r.table_name}:${r.record_id}`,r.billing_entity_id]));
   const inScope=e=>{
      if(!options.entityId)return true;
      const rows=[e.before_value,e.after_value].filter(Boolean);
      return rows.some(r=>Number(r.billing_entity_id ?? openingScopes.get(`${e.entity}:${e.entity_id}`) ?? legacy.get(`${e.entity}:${e.entity_id}`))===Number(options.entityId) || Number(r.destination_entity_id)===Number(options.entityId)) || ['customers','customer_information','billing_cutovers','billing_cutover_amendments','audit_actions'].includes(e.entity);
   };
   const calculate=state=>balance(state,customerId,options.billingDate || billingDateToday(),options.entityId,legacy);
   const state={};
   for(const [table,key] of Object.entries(TABLES)) {
      // to_jsonb preserves timestamp microseconds and decimal amounts, unlike
      // JS Date conversion; essential for the statement creation-time gate.
      const query=db({[table]:`public.${table}`}).select(db.raw('to_jsonb(??) AS row',[table])).where({account_id:accountId});
      if(INDIRECT.has(table))query.whereRaw('ds2_audit_customer(?,to_jsonb(??))=?',[table,table,customerId]);
      else query.where({customer_id:customerId});
      const rows=await query;
      state[table]=new Map(rows.map(({row})=>[key.split(':').map(k=>String(row[k])).join(':'),exact(row)]));
   }
   const current=calculate(state);
   // Invert every captured mutation, including deletes/moves, to recover the
   // rows that existed at activation without modifying or backfilling them.
   for(const e of events.slice().reverse()) apply(state,e,true,customerId);
   const baseline=[];
   for(const [table,rows] of Object.entries(state)) for(const [key,row] of rows) {
      const when=row.created_at || row.issued_at || row.applied_at || policy.started_at;
      const actor=row.created_by_user_id || row.actor_id || row.issued_by || row.created_by || null;
      baseline.push({event_id:`legacy:${table}:${key}`,entity:table,entity_id:key,action:'reconstructed',occurred_at:utcTimestamp(when),
         customer_id:customerId,actor_user_id:actor, actor_name:actor ? `Historical user #${actor} (name at the time unavailable)`:'Unknown (not recorded)',
         source:'Existing database records',reason:'Reconstructed from existing records, before audit logging began',
         before_value:null,after_value:row,changes:{},reconstructed:true});
   }
   baseline.sort((a,b)=>String(a.occurred_at).localeCompare(String(b.occurred_at)) || a.event_id.localeCompare(b.event_id));
   const replay=Object.fromEntries(Object.keys(TABLES).map(t=>[t,new Map()]));
   const entries=[];
   let previous=calculate(replay);
   for(const e of baseline) {
      apply(replay,e,false,customerId);
      const next=calculate(replay);
      entries.push({id:e.event_id,occurred_at:e.occurred_at,reconstructed:true,events:[{...e,...activity(e)}],...next,
         balance_change:money(next.running_balance-previous.running_balance)});
      previous=next;
   }
   // Adjacent events from one DB transaction are one atomic posting. Account
   // advisory lock keeps committed chains serialized, including concurrent imports.
   const groups=[];
   for(const e of events) {
      let group=groups[groups.length-1];
      if(!group || group.transaction_id!==e.transaction_id) { group={transaction_id:e.transaction_id,events:[]}; groups.push(group); }
      group.events.push(e);
   }
   for(const g of groups) {
      for(const e of g.events) apply(replay,e,false,customerId);
      const last=g.events[g.events.length-1];
      const next=calculate(replay);
      entries.push({id:last.event_id,occurred_at:last.occurred_at,transaction_id:g.transaction_id,
         correlation_id:last.correlation_id,events:g.events.map(e=>({...e,...activity(e)})),...next,
         balance_change:money(next.running_balance-previous.running_balance)});
      previous=next;
   }
   // Resolve business labels at the posting time, without borrowing today's
   // staff/type name after a captured rename. Raw evidence stays unchanged.
   const referenceData={current:{},changes:[]};
   for(const [table,key,name,prefix] of [['users','user_id','display_name','user'],['customer_job_types','job_type_id','job_description','job'],['billing_entities','billing_entity_id','name','business']]) {
      for(const row of await db(table).where({account_id:accountId}).select(key,name))referenceData.current[prefix+':'+row[key]]=row[name];
      for(const event of await db('audit_events').where({account_id:accountId,entity:table}).orderBy('event_id')) {
         referenceData.changes.push({event_id:event.event_id,key:prefix+':'+event.entity_id,
            before:event.before_value?.[name] || null,after:event.after_value?.[name] || null});
      }
   }
   referenceData.changes.sort((a,b)=>Number(a.event_id)-Number(b.event_id));
   const displayed=entries.map(entry=>({...entry,events:entry.events.filter(inScope)})).filter(entry=>entry.events.length);
   const presented=presentation.present(displayed,referenceData);
   let opening=0;
   const filtered=presented.filter(e=>{
      const day=phoenixDay(e.occurred_at);
      if(options.startDate && day<options.startDate) {opening=e.running_balance;return false;}
      return !options.endDate || day<=options.endDate;
   });
   return {customer:c,billing_entity_id:options.entityId,timezone:'America/Phoenix',logging_started_at:policy.started_at,verification:integrity,
      startDate:options.startDate || null,endDate:options.endDate || null,opening_balance:opening,
      closing_balance:filtered.length?filtered[filtered.length-1].running_balance:opening,current,
      coverage:presentation.coverage(filtered),reference_data:referenceData,
      total:filtered.length,entries:filtered.slice(options.offset || 0,options.limit ? (options.offset || 0)+options.limit:undefined),
      methodology:'Balances after complete database transactions. Billed balance uses current rolling statement chains; unbilled work/credits are separate. Retainer availability is not deducted twice. Reconstructed history cannot establish past edits or names.'};
}
module.exports={TABLES,history,verify,customer,balance,activity,phoenixDay};
