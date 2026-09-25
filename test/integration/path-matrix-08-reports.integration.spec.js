'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const service=require('../../src/endpoints/accountAudit/account-audit-service');
const invoices=require('../../src/endpoints/invoice/invoice-service');
const {S3Client}=require('@aws-sdk/client-s3');
const Archiver=require('archiver/lib/core');
const PDFDocument=require('../../src/pdfCreator/pdfkit-tables');

describe('Path matrix: audit reports and interrupted exports',function(){
 this.timeout(180000);let s;
 before(async()=>{s=await new PathScenario().boot();});after(()=>s?.close());
 async function batch(){const start=ok(await s.post('/accountAudit/run/1/1',{customer_ids:[1],notes:'Path matrix fault oracle'}));for(let n=0;n<400;n++){const job=ok(await s.get(`/accountAudit/job/${start.job_id}/1/1`));if(job.processing_status!=='processing'){expect(job.processing_status).eq('complete');expect(job.done).eq(1);expect(job.results).length(1);return job.results[0];}await new Promise(r=>setTimeout(r,5));}throw Error('audit did not finish');}
 const monetary=()=>s.db.raw("SELECT (SELECT jsonb_agg(t) FROM customer_transactions t) AS work, (SELECT jsonb_agg(t) FROM customer_invoices t) AS invoices, (SELECT jsonb_agg(t) FROM customer_payments t) AS payments, (SELECT jsonb_agg(t) FROM customer_writeoffs t) AS credits").then(r=>r.rows);
 it('POST accountAudit/run | customer read failure finishes with one failed report and unchanged money',async()=>{const before=await monetary();const result=await s.fail(service,'getInvoices',batch);expect(result.status).eq('failed');expect(result.error).match(/path-matrix/);const row=await service.getAuditById(s.db,1,result.audit_id);expect(row.status).eq('failed');expect(row.error_message).match(/path-matrix/);expect(await monetary()).deep.eq(before);});
 it('POST accountAudit/run | report and failed-result persistence failures finish with no writes',async()=>{const before=await s.allState();const result=await s.fail(service,'insertAudit',batch);expect(result.status).eq('failed');expect(result.error).match(/path-matrix/);expect(result.audit_id).eq(undefined);expect(await s.allState()).deep.eq(before);});
 it('POST accountAudit/run | missing customer returns failed job entry and writes no report',async()=>{const before=await s.allState();const result=await s.stub(service,'getCustomer',async()=>null,batch);expect(result).deep.eq({customer_id:1,status:'failed',error:'Customer not found.'});expect(await s.allState()).deep.eq(before);});
 it('POST accountAudit/run | app comparison query failure uses savepoint and preserves numerical audit',async()=>{const before=await monetary();const result=await s.fail(invoices,'getLastInvoiceDatesByCustomerID',batch);expect(result.status).eq('completed');expect(result.app_invoice_total).eq(null);const row=await service.getAuditById(s.db,1,result.audit_id);expect(Number(row.audit_balance)).eq(0);expect(row.app_balance_error).match(/path-matrix/);expect(await monetary()).deep.eq(before);});
 it('POST accountAudit/run | PDF store failure keeps completed report with no published PDF',async()=>{const before=await monetary();const result=await s.fail(S3Client.prototype,'send',batch);expect(result.status).eq('completed');expect(result.pdf_available).eq(false);const row=await service.getAuditById(s.db,1,result.audit_id);expect(row.pdf_s3_key).eq(null);expect(Number(row.audit_balance)).eq(0);expect(await monetary()).deep.eq(before);});
 it('GET audit PDF | stored-object failure rebuilds a valid PDF without writes',async()=>{const result=await batch(),before=await s.allState();const r=await s.fail(S3Client.prototype,'send',()=>s.get(`/accountAudit/audit/${result.audit_id}/pdf/1/1`));expect(r.status).eq(200);expect(r.headers['content-type']).match(/application\/pdf/);expect(r.body.subarray(0,4).toString()).eq('%PDF');expect(await s.allState()).deep.eq(before);});
 it('GET audit PDF | malformed report returns JSON 500 without writes or PDF headers',async()=>{const r=await s.stub(service,'getAuditById',async()=>({audit_id:42,summary:'{bad JSON'}),()=>s.refused(()=>s.get('/accountAudit/audit/42/pdf/1/1'),500,500,/JSON|property|Unexpected/));expect(r.headers['content-type']).match(/application\/json/);expect(r.headers['content-disposition']).eq(undefined);});
 it('GET audit PDF | renderer failure returns JSON 500 without writes',async()=>{const result=await batch();await s.db('account_audits').where({audit_id:result.audit_id}).update({pdf_s3_key:null});await s.stub(PDFDocument.prototype,'text',()=>{throw Error('path-matrix render failure');},()=>s.refused(()=>s.get(`/accountAudit/audit/${result.audit_id}/pdf/1/1`),500,500,/path-matrix/));});
 for(const mode of ['event','throw'])it(`GET yearEndPacket | archive ${mode} before bytes returns JSON 500 without writes`,async()=>{
  await s.stub(Archiver.prototype,'append',function(){return this;},()=>s.stub(Archiver.prototype,'finalize',function(){this.abort();const e=Error('path-matrix archive failed');if(mode==='throw')throw e;this.emit('error',e);return Promise.resolve();},()=>s.refused(()=>s.get('/analytics/yearEndPacket/1/1'),500,500,/path-matrix/)));
 });
 it('GET yearEndPacket | failure after initial bytes terminates the stream without waiting for timeout',async()=>{
  const before=await s.allState();let error;
  await s.stub(Archiver.prototype,'append',function(){return this;},()=>s.stub(Archiver.prototype,'finalize',function(){this.push(Buffer.from('PK-partial'));return new Promise(resolve=>setTimeout(()=>{this.emit('error',Error('path-matrix late stream failure'));this.abort();resolve();},20));},async()=>{try{await s.get('/analytics/yearEndPacket/1/1').timeout({response:1000,deadline:1500});}catch(e){error=e;}}));
  expect(error,'partial archive must not succeed').to.exist;expect(error.code,'server must abort rather than let the client time out').to.not.eq('ECONNABORTED');expect(await s.allState()).deep.eq(before);
 });
});
