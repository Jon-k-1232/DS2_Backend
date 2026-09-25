'use strict';
const express=require('express');
const {randomUUID}=require('crypto');
const {requireAdmin}=require('../auth/jwt-auth');
const {enforceAccountId}=require('../auth/account-scope');
const {id}=require('../../utils/ledgerAction');
const {ruleError}=require('../payments/ledger-helpers');
const service=require('./audit-record-service');
const pdf=require('./audit-record-pdf');
const {TYPES}=require('./audit-record-presentation');
const publicRecord=({storage_key,evidence_storage_key,...record})=>record;
const storage=require('../../utils/s3');
const router=express.Router();
router.use(requireAdmin);
router.param('accountID',enforceAccountId);
const base='/customer/:customerID/:accountID/:userID';
function date(v) {
   if(v===undefined || v===null || v==='')return null;
   if(typeof v!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000') || Number.isNaN(Date.parse(v+'T00:00:00Z')) || new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw ruleError('Use valid YYYY-MM-DD dates.',400);
   return v;
}
function options(input={}) {
   const startDate=date(input.startDate),endDate=date(input.endDate);
   if(startDate && endDate && startDate>endDate)throw ruleError('Start date must not be after end date.',400);
   const number=(v,fallback,max)=>{if(v===undefined)return fallback;if(!/^\d+$/.test(String(v)) || typeof v==='boolean' || typeof v==='object' || !Number.isSafeInteger(Number(v)) || Number(v)>max)throw ruleError('Invalid pagination.',400);return Number(v);};
   const limit=number(input.limit,25,100),offset=number(input.offset,0,2147483647);
   if(limit===0)throw ruleError('Limit must be positive.',400);
   return {startDate,endDate,limit,offset};
}
const handler=fn=>async(req,res)=>{
   try {id(req.params.userID);const accountId=id(req.params.accountID),customerId=id(req.params.customerID);await fn(req,res,accountId,customerId);}
   catch(e) {const status=e.statusCode || (e.code==='P0409'?409:500);res.status(status).send({status,code:e.code,message:status===500?'Unable to complete the audit record request. Please retry.':e.message});}
};
router.get(base,handler(async(req,res,a,c)=>{
   const filter=options(req.query);
   const data=await req.app.get('db').transaction(async trx=>{await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return service.history(trx,a,c,filter);});
   res.send({status:200,...data});
}));
router.get(base+'/verify',handler(async(req,res,a,c)=>{
   const result=await req.app.get('db').transaction(async trx=>{await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await service.customer(trx,a,c);return service.verify(trx,a);});
   res.send({status:200,verification:result});
}));
router.get(base+'/records',handler(async(req,res,a,c)=>{
   const db=req.app.get('db'),filter=options(req.query);await service.customer(db,a,c);
   const q=db('audit_records').where({account_id:a,customer_id:c});
   const count=await q.clone().count({n:'*'}).first();
   const records=await q.orderBy([{column:'generated_at',order:'desc'},{column:'record_id',order:'desc'}]).limit(filter.limit).offset(filter.offset);
   res.send({status:200,total:Number(count.n),records:records.map(publicRecord)});
}));
router.post(base+'/records',handler(async(req,res,a,c)=>{
   if(!req.body || Array.isArray(req.body) || typeof req.body!=='object')throw ruleError('A date-range object is required.',400);
   const filter=options(req.body);
   const recordType=req.body.recordType===undefined?'client':req.body.recordType;
   if(typeof recordType!=='string' || !Object.prototype.hasOwnProperty.call(TYPES,recordType))throw ruleError('Record type must be client or full_evidence.',400);
   const db=req.app.get('db');
   const snapshot=await db.transaction(async trx=>{
      await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const data=await service.history(trx,a,c,{...filter,limit:null,offset:0});
      const firm=await trx('accounts').where({account_id:a}).first();
      return {data,firm};
   });
   const {data,firm}=snapshot;
   const record_id=randomUUID();
   const meta={record_id,record_type:recordType,firm:firm.account_name,generated_by:req.user.user_id,generated_by_name:req.user.display_name,generated_at:new Date().toISOString()};
   const evidencePath=`/auditRecord/customer/${c}/${a}/${req.user.user_id}/records/${record_id}/evidence`;
   const evidence=Buffer.from(JSON.stringify({version:1,meta,data}),'utf8');
   const evidenceKey=`audit-records/${a}/${c}/${record_id}.evidence.json`;
   const evidenceHash=pdf.sha256(evidence);
   const rendered=await pdf.render(data,{...meta,evidence_sha256:evidenceHash,evidence_path:evidencePath});
   await storage.putObject(evidenceKey,evidence,'application/json',{'sha256':evidenceHash},{ifNoneMatch:'*'});
   const key=`audit-records/${a}/${c}/${record_id}.pdf`;
   await storage.putObject(key,rendered.body,'application/pdf',{'sha256':rendered.document_sha256},{ifNoneMatch:'*'});
   // Archive the consistent read snapshot after upload. Normal READ COMMITTED
   // insertion permits newer unrelated postings without a stale chain-head write.
   const result=await db.transaction(async trx=>{
      const [saved]=await trx('audit_records').insert({record_id,record_type:recordType,evidence_storage_key:evidenceKey,evidence_sha256:evidenceHash,evidence_byte_length:evidence.length,account_id:a,customer_id:c,start_date:filter.startDate,end_date:filter.endDate,
         generated_at:meta.generated_at,generated_by:meta.generated_by,generated_by_name:meta.generated_by_name,storage_key:key,
         document_sha256:rendered.document_sha256,content_sha256:rendered.content_sha256,chain_event_id:data.verification.event_id,
         chain_hash:data.verification.hash,byte_length:rendered.body.length}).returning('*');
      if(!saved)throw new Error('Audit record insert failed');
      return publicRecord(saved);
   });
   res.status(201).send({status:201,record:result});
}));
async function recordRow(req,a,c) {
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.recordID))throw ruleError('Invalid record ID.',400);
   const row=await req.app.get('db')('audit_records').where({account_id:a,customer_id:c,record_id:req.params.recordID}).first();
   if(!row)throw ruleError('Audit record not found.',404);
   if(row.storage_key!==`audit-records/${a}/${c}/${row.record_id}.pdf`)throw ruleError('Audit record storage identity is invalid.',409);
   return row;
}
async function stored(req,a,c) {
   const row=await recordRow(req,a,c);
   const {body}=await storage.getObject(row.storage_key);
   if(!Buffer.isBuffer(body))throw new Error('Missing stored PDF');
   return {row,body,valid:body.length===row.byte_length && pdf.sha256(body)===row.document_sha256 && pdf.verifyContent(body,row.content_sha256)};
}
async function chainStatus(db,a,row) {
   return db.transaction(async trx=>{
      await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const chain=await service.verify(trx,a);
      const anchor=row.chain_event_id?await trx('audit_events').where({account_id:a,event_id:row.chain_event_id}).first():null;
      const anchorValid=row.chain_event_id?anchor?.event_hash===row.chain_hash:row.chain_hash==='0'.repeat(64);
      return {chain_valid:chain.valid,anchor_valid:anchorValid};
   });
}
async function storedEvidence(row,a,c) {
   if(!row.evidence_storage_key)throw ruleError('This legacy record has no separate evidence archive.',404);
   if(row.evidence_storage_key!==`audit-records/${a}/${c}/${row.record_id}.evidence.json`)throw ruleError('Audit evidence storage identity is invalid.',409);
   const {body}=await storage.getObject(row.evidence_storage_key);
   if(!Buffer.isBuffer(body))throw new Error('Missing stored evidence');
   return {body,valid:body.length===row.evidence_byte_length && pdf.sha256(body)===row.evidence_sha256};
}
router.get(base+'/records/:recordID/verify',handler(async(req,res,a,c)=>{
   const {row,body,valid}=await stored(req,a,c);
   const chain=await chainStatus(req.app.get('db'),a,row);
   const evidenceValid=row.evidence_storage_key?(await storedEvidence(row,a,c)).valid:null;
   res.send({status:200,record_id:row.record_id,record_type:row.record_type,valid:valid && chain.chain_valid && chain.anchor_valid && evidenceValid!==false,
      document_valid:valid,...chain,evidence_valid:evidenceValid,evidence_sha256:row.evidence_sha256,
      expected_sha256:row.document_sha256,actual_sha256:pdf.sha256(body),content_sha256:row.content_sha256});
}));
router.get(base+'/records/:recordID/evidence',handler(async(req,res,a,c)=>{
   const row=await recordRow(req,a,c);
   const {body,valid}=await storedEvidence(row,a,c);
   const chain=await chainStatus(req.app.get('db'),a,row);
   if(!valid || !chain.chain_valid || !chain.anchor_valid)throw ruleError('Stored evidence failed verification. Download blocked.',409,'AUDIT_EVIDENCE_TAMPERED');
   res.set('Content-Type','application/json').set('Cache-Control','private, no-store').set('X-Evidence-SHA256',row.evidence_sha256)
      .attachment(`audit-record-${row.record_id}.evidence.json`).send(body);
}));
router.get(base+'/records/:recordID/pdf',handler(async(req,res,a,c)=>{
   const {row,body,valid}=await stored(req,a,c);
   if(!valid)throw ruleError('Stored PDF failed verification. Download blocked.',409,'AUDIT_DOCUMENT_TAMPERED');
   await req.app.get('db')('audit_actions').insert({account_id:a,customer_id:c,action:'audit_record_reprint',detail:{record_id:row.record_id,document_sha256:row.document_sha256}});
   res.set('Content-Type','application/pdf').set('Cache-Control','private, no-store').set('X-Document-SHA256',row.document_sha256).attachment(`audit-record-${row.record_id}.pdf`).send(body);
}));
module.exports=router;
module.exports.options=options;
