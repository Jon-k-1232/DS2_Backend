'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {today}=require('./_scenario');
const {pendingPaymentsService:svc,PAYMENTS_PENDING_PREFIX:PENDING}=require('../../src/endpoints/pendingPayments/pendingPayments-service');
const {S3Client}=require('@aws-sdk/client-s3');
const storage=require('../../src/utils/s3');

describe('Path matrix: pending-payment queue and storage failures',function(){
 this.timeout(180000);let s,serial=0;const keys=[];
 before(async()=>{s=await new PathScenario().boot();});after(async()=>{if(s){for(const k of keys)await storage.deleteObject(k);await s.close();}});
 const pending=async(more={})=>(await s.db('customer_payments_processed').insert({account_id:1,customer_id:1,customer_name:'Alice Anderson',payment_amount:25,payment_date:today(),source_file:`PM-${++serial}.pdf`,form_of_payment:'Check',is_payment_processed:false,deleted:false,...more}).returning('*'))[0];
 const approve=p=>s.post('/pending-payments/approve/1/1',{pendingPaymentId:p.payment_id,payment:s.payment({id:p.customer_id},25,p.invoiceId?{selectedInvoiceID:p.invoiceId}:{})});
 for(const [url,m] of [['/counts/1/1','getTabCounts'],['/files/1/1','getDistinctSourceFiles'],['/single/1/1/1','getSinglePendingPayment']])it(`GET /pending-payments${url} | query failure refuses 500 without writes`,async()=>{
  await s.fail(svc,m,()=>s.refused(()=>s.get('/pending-payments'+url),500,500,/path-matrix/));
 });
 it('POST /pending-payments/approve | deleted payment refuses 409 without writes',async()=>{
  const p=await pending({deleted:true});await s.refused(()=>approve(p),409,409,/deleted and cannot be processed/);
 });
 it('POST /pending-payments/approve | posted marker refuses retry even if queue flag is false',async()=>{
  const p=await pending();await s.db('customer_payments').insert({account_id:1,customer_id:1,created_by_user_id:1,payment_date:today(),payment_amount:-25,note:`[pending_payment:${p.payment_id}]`});
  await s.refused(()=>approve(p),409,409,/already posted from this pending payment/);
 });
 it('DELETE /pending-payments/file | file disappears after ownership check: 404 without writes',async()=>{
  const p=await pending();await s.stub(svc,'lockSourceFile',async()=>[],()=>s.refused(()=>s.del('/pending-payments/file/1/1',{fileName:p.source_file}),404,404,/File not found/));
 });
 it('POST /pending-payments/upload | storage failure refuses 500 without database writes',async()=>{
  await s.fail(S3Client.prototype,'send',()=>s.refused(()=>s.request.post('/pending-payments/upload/1/1').set('Authorization','Bearer '+s.token()).set('Content-Type','application/pdf').set('x-file-name','PM-fail.pdf').send(Buffer.from('%PDF-1.4 local')),500,500,/path-matrix/));
 });
 it('GET /pending-payments/file-preview | both storage locations unavailable: 404 without writes',async()=>{
  const p=await pending();await s.fail(S3Client.prototype,'send',()=>s.refused(()=>s.get(`/pending-payments/file-preview/1/1?fileName=${p.source_file}`),404,404,/File not found/));
 });
 it('GET /pending-payments/file-preview | processed-list failure falls back to exact pending bytes',async()=>{
  const p=await pending(),key=`${PENDING}/${p.source_file}`,body=Buffer.from('%PDF-1.4 local pending fallback');keys.push(key);await storage.putObject(key,body,'application/pdf');
  const original=S3Client.prototype.send,before=await s.allState();const r=await s.stub(S3Client.prototype,'send',function(command,...args){if(command.constructor.name==='ListObjectsV2Command')throw Error('path-matrix list failed');return original.call(this,command,...args);},()=>s.get(`/pending-payments/file-preview/1/1?fileName=${p.source_file}`));
  expect(r.status).eq(200);expect(Buffer.from(r.body)).deep.eq(body);expect(await s.allState()).deep.eq(before);
 });
 for(const operation of ['approve','soft-delete','file'])it(`${operation} | postcommit count failure reports saved outcome, never a failed write`,async()=>{
  let p;
  if(operation==='approve'){const c=await s.customer('PM queue approval'),j=await s.job(c);await s.work(c,j,100);const result=await s.finalize([c]);const invoice=await s.statement(c,result,1,[0,100,0,0,0,100]);p=await pending({customer_id:c.id,customer_name:c.name});p.invoiceId=invoice.customer_invoice_id;}else p=await pending();
  const r=await s.fail(svc,'getTabCounts',()=>operation==='approve'?approve(p):operation==='soft-delete'?s.put(`/pending-payments/soft-delete/${p.payment_id}/1/1`,{}):s.del('/pending-payments/file/1/1',{fileName:p.source_file}));
  expect(r.status,JSON.stringify(r.body)).eq(200);expect(r.body.status).eq(200);expect(r.body.committed).eq(true);expect(r.body.warnings.join(' ')).match(/do not submit/);
  const saved=await svc.getSinglePendingPayment(s.db,p.payment_id,1);expect(saved.is_payment_processed).eq(operation==='approve');expect(saved.deleted).eq(operation!=='approve');
  const payments=await s.db('customer_payments').where({account_id:1,customer_id:p.customer_id}).where('note','like',`%[pending_payment:${p.payment_id}]%`);expect(payments).length(operation==='approve'?1:0);if(operation==='approve')expect(Number(payments[0].payment_amount)).eq(-25);
 });
});
