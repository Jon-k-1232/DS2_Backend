const { withTransaction, lockCustomerLedger, ruleError } = require('../payments/ledger-helpers');
const { id, reason, actionContext } = require('../../utils/ledgerAction');
const { assertUnlocked, lockNumber } = require('../invoice/sentInvoiceLocks');
const KINDS = Object.freeze({
   transaction:['customer_transactions','transaction_id','total_transaction','transaction_date'],
   payment:['customer_payments','payment_id','payment_amount','payment_date'],
   writeoff:['customer_writeoffs','writeoff_id','writeoff_amount','writeoff_date'],
   retainer:['customer_retainers_and_prepayments','retainer_id','starting_amount','created_at']
});
const norm = v => String(v ?? '').trim().replace(/\s+/g,' ').toLowerCase();
const kindInfo = kind => { if (!Object.hasOwnProperty.call(KINDS,kind)) throw ruleError('Choose transaction, payment, writeoff or retainer.',400); return KINDS[kind]; };
const date = v => v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}` : String(v).slice(0,10);
const snapshotChanged = (row, snapshot) => !snapshot || Object.keys(snapshot).some(key => JSON.stringify(row[key]) !== JSON.stringify(snapshot[key]));
function eligible(kind,row) {
   if (kind === 'retainer') return !row.parent_retainer_id && !/overpayment|cancelled by reversal/i.test(row.note || '');
   if (kind === 'payment') return Number(row.payment_amount)<0 && !row.retainer_id && !/\[(?:pending_payment:|reversal of|reversed )/i.test(row.note || '');
   return true;
}
function evidence(kind,row) {
   if (kind === 'transaction') return norm(row.detailed_work_description) ? [row.transaction_type,row.customer_job_id,row.logged_for_user_id,row.general_work_description_id,Number(row.quantity),Number(row.unit_cost),row.is_transaction_billable,norm(row.detailed_work_description)].map(norm) : null;
   if (kind === 'writeoff') return norm(row.writeoff_reason) ? [row.transaction_type,row.customer_job_id,norm(row.writeoff_reason)].map(norm) : null;
   const reference = norm(row.payment_reference_number);
   if (kind === 'payment') return reference ? [norm(row.form_of_payment),reference] : null;
   return reference ? [norm(row.type_of_hold),norm(row.form_of_payment),reference] : norm(row.display_name) ? [norm(row.type_of_hold),'name',norm(row.display_name)] : null;
}
function matches(kind,a,b) {
   const [,key,amount,day] = kindInfo(kind);
   const ea=evidence(kind,a), eb=evidence(kind,b);
   return a[key] !== b[key] && a.account_id === b.account_id && a.customer_id === b.customer_id && eligible(kind,a) && eligible(kind,b) &&
      Number(a[amount]) === Number(b[amount]) && Math.abs(Date.parse(date(a[day]))-Date.parse(date(b[day]))) <= 3*86400000 && ea && eb && JSON.stringify(ea) === JSON.stringify(eb);
}
async function candidates(trx,accountId,customerId,kind) {
   const [table] = kindInfo(kind);
   const q=trx(table).where({account_id:accountId,customer_id:customerId});
   if(kind==='transaction') q.whereNotExists(trx('ai_category_training_examples as s').select(trx.raw('1')).whereNotNull('s.timesheet_entry_id').whereRaw('s.transaction_id=customer_transactions.transaction_id AND s.account_id=customer_transactions.account_id'));
   return (await q).filter(row=>eligible(kind,row));
}
async function record(trx,accountId,kind,recordId) {
   const [table,key] = kindInfo(kind);
   const row=await trx(table).where({account_id:accountId,[key]:id(recordId)}).first();
   if(!row) throw ruleError('Record not found for this account.',404);
   return row;
}
const audit = async (trx,accountId,actorId,action,why,duplicateId,before,after) => {
   const rows=await trx('duplicate_history').insert({account_id:accountId,actor_id:actorId,action,reason:why,duplicate_id:duplicateId,before_value:before == null ? null : JSON.stringify(before),after_value:after == null ? null : JSON.stringify(after)}).returning('history_id');
   if(rows.length!==1) throw new Error('Duplicate evidence insertion did not return its saved record.');
};
async function insertFlag(trx,{accountId,actorId,kind,row,canonical,why,automatic}) {
   const [,key] = kindInfo(kind);
   const [flag]=await trx('duplicate_flags').insert({account_id:accountId,customer_id:row.customer_id,kind,record_id:row[key],canonical_id:canonical ? canonical[key] : null,reason:why,detected_by:actorId,record_snapshot:JSON.stringify(row),canonical_snapshot:canonical ? JSON.stringify(canonical) : null}).onConflict().ignore().returning('*');
   if(!flag) {
      const existing=await trx('duplicate_flags').where({account_id:accountId,kind}).whereRaw('LEAST(record_id,COALESCE(canonical_id,record_id))=? AND GREATEST(record_id,COALESCE(canonical_id,record_id))=?',[Math.min(row[key],canonical ? canonical[key] : row[key]),Math.max(row[key],canonical ? canonical[key] : row[key])]).first();
      if(!existing) throw new Error('Duplicate flag insertion did not return its saved record.');
      if(automatic) return null;
      // Scans honor prior decisions. An explicit new review of an edited source
      // may reuse its resolved flag while preserving every prior audit entry.
      const priorSnapshot = existing.record_id === row[key] ? existing.record_snapshot : existing.canonical_snapshot;
      if(existing.status !== 'open' && snapshotChanged(row,priorSnapshot)) {
         const [reopened] = await trx('duplicate_flags').where({account_id:accountId,duplicate_id:existing.duplicate_id}).update({
            record_id:row[key],canonical_id:canonical ? canonical[key] : null,reason:why,detected_by:actorId,created_at:trx.raw('clock_timestamp()'),
            status:'open',resolved_by:null,resolved_at:null,resolution_reason:null,
            record_snapshot:JSON.stringify(row),canonical_snapshot:canonical ? JSON.stringify(canonical) : null
         }).returning('*');
         if(!reopened) throw new Error('Updated duplicate review was not saved.');
         await audit(trx,accountId,actorId,'flag',why,reopened.duplicate_id,existing,reopened);
         return reopened;
      }
      throw ruleError('This pair already has a duplicate review. Open its existing history.',409);
   }
   await audit(trx,accountId,actorId,'flag',why,flag.duplicate_id,null,flag);
   return flag;
}
// Called by manual entry routes inside their existing transaction. No auto-delete.
async function detectCreated(trx,kind,row,actorId) {
   if(!row || !eligible(kind,row)) return [];
   const flags=[]; const why='Possible duplicate: matching amount, date window and supporting details.';
   await actionContext(trx,actorId,why);
   for(const other of await candidates(trx,row.account_id,row.customer_id,kind)) {
      if(matches(kind,row,other)) {
         const flag=await insertFlag(trx,{accountId:row.account_id,actorId,kind,row,canonical:other,why,automatic:true});
         if(flag) flags.push(flag);
      }
   }
   return flags;
}
async function flag(db,{accountId,actorId,body}) {
   kindInfo(body.kind); id(body.recordId); if(body.canonicalId != null) id(body.canonicalId);
   const why=reason(body.reason);
   if(Number(body.recordId)===Number(body.canonicalId)) throw ruleError('A record cannot be its own duplicate.',400);
   return withTransaction(db,async trx=>{
      const first=await record(trx,accountId,body.kind,body.recordId);
      await lockCustomerLedger(trx,accountId,first.customer_id);
      const row=await record(trx,accountId,body.kind,body.recordId);
      const canonical=body.canonicalId == null ? null : await record(trx,accountId,body.kind,body.canonicalId);
      if(canonical && canonical.customer_id!==row.customer_id) throw ruleError('Both records must belong to the same customer.',400);
      if(body.kind==='retainer' && (row.parent_retainer_id || canonical?.parent_retainer_id)) throw ruleError('Flag the original retainer receipt, not a balance snapshot.',400);
      await actionContext(trx,actorId,why);
      return {duplicate:await insertFlag(trx,{accountId,actorId,kind:body.kind,row,canonical,why})};
   });
}
async function scan(db,{accountId,actorId,body}) {
   const why=reason(body.reason); const customerId=body.customerId == null ? null : id(body.customerId);
   return withTransaction(db,async trx=>{
      const q=trx('customers').where({account_id:accountId}).orderBy('customer_id');
      if(customerId) q.where({customer_id:customerId});
      const customers=await q;
      if(customerId && !customers.length) throw ruleError('Customer not found.',404);
      await actionContext(trx,actorId,why);
      let created=0;
      for(const customer of customers) {
         await lockCustomerLedger(trx,accountId,customer.customer_id);
         for(const kind of Object.keys(KINDS)) {
            const rows=await candidates(trx,accountId,customer.customer_id,kind);
            const [,key,amount]=KINDS[kind]; const groups=new Map();
            rows.sort((a,b)=>a[key]-b[key]);
            for(const row of rows) {
               const ev=evidence(kind,row); if(!ev) continue;
               const bucket=JSON.stringify([Number(row[amount]),ev]); const previous=groups.get(bucket)||[];
               for(const canonical of previous) if(matches(kind,row,canonical)) {
                  if(await insertFlag(trx,{accountId,actorId,kind,row,canonical,why,automatic:true})) created++;
               }
               previous.push(row); groups.set(bucket,previous);
            }
         }
      }
      await audit(trx,accountId,actorId,'scan',why,null,null,{customerId,customers:customers.length,created});
      return {created,message:`Review scan completed: ${created} new possible duplicates.`};
   });
}
async function list(db,{accountId,query={}}) {
   if(query.status && !['open','all'].includes(query.status)) throw ruleError('Status must be open or all.',400);
   const customerId=query.customerId == null ? null : id(query.customerId);
   if(customerId && !await db('customers').where({account_id:accountId,customer_id:customerId}).first()) throw ruleError('Customer not found.',404);
   const q=db('duplicate_flags').where({account_id:accountId}).orderBy('duplicate_id','desc');
   if(query.status!=='all') q.where({status:'open'});
   if(customerId) q.where({customer_id:customerId});
   const duplicates=await q;
   for(const f of duplicates) {
      const [table,key]=KINDS[f.kind];
      f.record=await db(table).where({account_id:accountId,[key]:f.record_id}).first() || null;
      f.canonical=f.canonical_id ? await db(table).where({account_id:accountId,[key]:f.canonical_id}).first() || null : null;
      f.locked_invoice_number=await lockNumber(db,accountId,table,f.record_id);
      f.locked_invoice_id=f.locked_invoice_number ? (await db('customer_invoices').where({account_id:accountId,invoice_number:f.locked_invoice_number}).whereNull('parent_invoice_id').first())?.customer_invoice_id : null;
      f.history=await db('duplicate_history').where({account_id:accountId,duplicate_id:f.duplicate_id}).orderBy('history_id');
   }
   return {duplicates};
}
async function ledgerSnapshot(trx,accountId,customerId) {
   const result={};
   for(const table of [...Object.values(KINDS).map(k=>k[0]),'customer_invoices','customer_jobs']) result[table]=await trx(table).where({account_id:accountId,customer_id:customerId});
   return result;
}
async function resolve(db,{accountId,actorId,duplicateId,body}) {
   id(duplicateId); const why=reason(body.reason);
   if(!['dismiss','remove'].includes(body.action)) throw ruleError('Choose dismiss or remove.',400);
   return withTransaction(db,async trx=>{
      const where={account_id:accountId,duplicate_id:Number(duplicateId)};
      const first=await trx('duplicate_flags').where(where).first();
      if(!first) throw ruleError('Duplicate flag not found.',404);
      await lockCustomerLedger(trx,accountId,first.customer_id);
      const f=await trx('duplicate_flags').where(where).forUpdate().first();
      if(f.status!=='open') throw ruleError('This duplicate review is already resolved.',409);
      await actionContext(trx,actorId,why);
      let before=f, after=null;
      if(body.action==='remove') {
         const row=await record(trx,accountId,f.kind,f.record_id);
         const [table]=KINDS[f.kind];
         await assertUnlocked(trx,accountId,table,f.record_id);
         if(row.customer_id!==f.customer_id || snapshotChanged(row,f.record_snapshot)) {
            throw ruleError('Record changed since it was flagged. Dismiss this review and flag the current entry again if needed.',409);
         }
         before={flag:f,ledger:await ledgerSnapshot(trx,accountId,f.customer_id)};
         try {
            if(f.kind==='transaction') await require('../transactions/sharedTransactionFunctions').deleteTransactionCore(trx,{accountId,actorId,transaction:{transactionID:f.record_id,customerID:row.customer_id}});
            if(f.kind==='payment') await require('../payments/payment-logic').deletePaymentCore(trx,{accountId,paymentId:f.record_id,actorId,reason:why});
            if(f.kind==='writeoff') await require('../writeOffs/writeOffs-logic').deleteWriteOffCore(trx,{accountId,writeoffId:f.record_id,actorId,reason:why});
            if(f.kind==='retainer') await require('../retainer/retainer-logic').deleteRetainerCore(trx,{accountId,retainerId:f.record_id,actorId,reason:why});
         } catch(error) { if(error.isLedgerRule || error.code==='P0409') error.statusCode=409; throw error; }
         after={ledger:await ledgerSnapshot(trx,accountId,f.customer_id)};
      }
      const [saved]=await trx('duplicate_flags').where(where).update({status:body.action==='dismiss'?'dismissed':'removed',resolved_by:actorId,resolved_at:trx.raw('clock_timestamp()'),resolution_reason:why}).returning('*');
      if(!saved) throw new Error('Duplicate resolution was not saved.');
      await audit(trx,accountId,actorId,body.action,why,f.duplicate_id,before,{...after,flag:saved});
      // A third copy may have several pair flags. Removing its row resolves
      // those reviews atomically as well; none can remove the money twice.
      if(body.action==='remove') {
         const others=await trx('duplicate_flags').where({account_id:accountId,kind:f.kind,status:'open'}).where(q=>q.where('record_id',f.record_id).orWhere('canonical_id',f.record_id));
         for(const other of others) {
            const [closed]=await trx('duplicate_flags').where({duplicate_id:other.duplicate_id,account_id:accountId}).update({status:'removed',resolved_by:actorId,resolved_at:trx.raw('clock_timestamp()'),resolution_reason:why}).returning('*');
            if(!closed) throw new Error('Related duplicate resolution was not saved.');
            await audit(trx,accountId,actorId,'source_removed',why,other.duplicate_id,other,closed);
         }
      }
      return {duplicate:saved,message:body.action==='dismiss'?'Marked not a duplicate.':'Duplicate removed.'};
   });
}
module.exports={KINDS,matches,eligible,detectCreated,flag,scan,list,resolve};
