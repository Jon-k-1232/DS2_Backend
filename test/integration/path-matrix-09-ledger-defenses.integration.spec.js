'use strict';
const {PathScenario,expect,ok}=require('./_path-matrix');
const {today}=require('./_scenario');
const svc=require('../../src/endpoints/invoice/invoice-service');
const {S3Client}=require('@aws-sdk/client-s3');
const {Readable}=require('stream');
const JSZip=require('jszip');

describe('Path matrix: invoice and duplicate transactional defenses',function(){
 this.timeout(180000);let s,c,j,n=0;
 before(async()=>{s=await new PathScenario().boot();c=await s.customer('PM legacy invoice defenses');j=await s.job(c);});after(()=>s?.close());
 const invoice=async(more={})=>(await s.db('customer_invoices').insert({account_id:1,customer_id:c.id,customer_info_id:c.info.customer_info_id,due_date:today(),invoice_number:'LEGACY-'+ ++n,invoice_date:today(),beginning_balance:0,total_charges:0,total_payments:0,total_write_offs:0,total_retainers:0,total_amount_due:0,remaining_balance_on_invoice:0,is_invoice_paid_in_full:true,created_by_user_id:1,...more}).returning('*'))[0];
 const del=i=>s.del(`/invoices/deleteInvoice/1/${i.customer_invoice_id}`);
 for(const type of ['snapshot','linked work','absorbed','beginning balance','absorbed predecessor'])it(`DELETE invoice | unissued ${type} refuses 200/500 and preserves every row`,async()=>{
  let i=await invoice();let message;
  if(type==='snapshot'){i=await invoice({parent_invoice_id:i.customer_invoice_id});message=/payment\/write-off snapshot/;}
  if(type==='linked work'){const w=await s.work(c,j,10);await s.db('customer_transactions').where({transaction_id:w.transaction_id}).update({customer_invoice_id:i.customer_invoice_id});message=/Cannot delete invoice with/;}
  if(type==='absorbed'){await s.db('customer_invoices').where({customer_invoice_id:i.customer_invoice_id}).update({notes:'[absorbed_by:LEGACY-SUCCESSOR]'});message=/rolled into a later/;}
  if(type==='beginning balance'){await s.db('customer_invoices').where({customer_invoice_id:i.customer_invoice_id}).update({beginning_balance:100});message=/erase that debt/;}
  if(type==='absorbed predecessor'){await invoice({notes:`[absorbed_by:${i.invoice_number}@${today()}]`});message=/erase that debt/;}
  await s.refused(()=>del(i),200,500,message);
 });
 it('DELETE invoice | postcommit refresh failure reports exactly one saved deletion',async()=>{const i=await invoice();const r=await s.fail(svc,'getInvoices',()=>del(i));expect(r.status).eq(200);expect(r.body.status).eq(200);expect(r.body.committed).eq(true);expect(r.body.warnings.join(' ')).match(/do not submit/);expect(await s.db('customer_invoices').where({customer_invoice_id:i.customer_invoice_id}).first()).eq(undefined);});
 it('GET eligibility | failed optional audit lookup preserves calculated balances and writes nothing',async()=>{await s.work(c,j,10,{detailedJobDescription:'Unbilled eligibility work'});const before=await s.allState();const r=await s.queryFault(/select DISTINCT ON .*from "account_audits"/i,()=>s.get('/invoices/createInvoice/AccountsWithBalance/1/1'));ok(r);expect(JSON.stringify(r.body)).include('last_audit_at');expect(await s.allState()).deep.eq(before);});
 for(const [method,row,pattern] of [
  ['getPaymentsByCustomerID',{payment_amount:'NaN'},/Payment Total.*NaN/],
  ['getRetainersByCustomerID',{retainer_id:900,current_amount:'NaN',is_retainer_active:true},/Retainer Total.*NaN/],
  ['getWriteOffsByCustomerID',{writeoff_amount:'NaN'},/Write Off Total.*NaN/],
  ['getTransactionsByCustomerID',{customer_id:1,customer_job_id:1,is_transaction_billable:true,total_transaction:'NaN'},/Transaction Total.*NaN/]
 ])it(`POST createInvoice | corrupt ${method} refuses 500 without saving`,()=>s.stub(svc,method,async()=>({1:[row]}),()=>s.refused(()=>s.post('/invoices/createInvoice/1/1',s.configuration([{id:1}],{}, {showWriteOffs:true})),500,500,pattern)));
 it('POST createInvoice | corrupt outstanding snapshot refuses 500 without saving',async()=>{await s.stub(svc,'getLastInvoiceDatesByCustomerID',async()=>({1:today()}),()=>s.stub(svc,'getOutstandingInvoices',async()=>({1:[{invoice_number:'BAD',invoice_date:today(),remaining_balance_on_invoice:'NaN'}]}),()=>s.refused(()=>s.post('/invoices/createInvoice/1/1',s.configuration([{id:1}])),500,500,/Outstanding Invoice Total.*NaN/)));});
 it('POST createInvoice | malformed retainer-funded nonbillable row refuses NaN draw total',()=>s.stub(svc,'getTransactionsByCustomerID',async()=>({1:[{customer_id:1,customer_job_id:1,retainer_id:1,is_transaction_billable:false,total_transaction:'NaN'}]}),()=>s.refused(()=>s.post('/invoices/createInvoice/1/1',s.configuration([{id:1}])),500,500,/Transaction Retainer Payment Total.*NaN/)));
 it('POST exception flag | disappeared invoice under the ledger lock refuses 404 without writes',async()=>{const i=await invoice();await s.queryFault(/select \* from "customer_invoices" where "account_id" = .*"customer_invoice_id" = .*limit/i,()=>s.refused(()=>s.post(`/invoices/${i.customer_invoice_id}/exceptions/1/1`,{condition:'bounced_check',reason:'Local disappeared statement',paymentIds:[1]}),404,404,/Invoice not found/),{empty:true,after:1});});
 it('POST duplicate resolve | failed related-review update rolls back source removal and every audit row',async()=>{
  const d=await s.customer('PM related duplicate rollback'),job=await s.job(d);await s.work(d,job,10);await s.work(d,job,10);const third=await s.work(d,job,10);
  const flags=await s.db('duplicate_flags').where({account_id:1,record_id:third.transaction_id,status:'open'});expect(flags.length).at.least(2);
  await s.queryFault(/update "duplicate_flags" set/i,()=>s.refused(()=>s.post(`/duplicates/${flags[0].duplicate_id}/resolve/1/1`,{action:'remove',reason:'Local related-review fault'}),500,500,/No changes were saved/),{after:1,empty:true});
  expect(Number((await s.db('customer_transactions').where({customer_id:d.id}).sum('total_transaction as n').first()).n)).eq(30);
 });
 for(const count of [0,2])it(`POST exception revision | original archive with ${count} PDFs refuses atomically`,async()=>{
  const d=await s.customer('PM archive '+count),job=await s.job(d);await s.work(d,job,100);const first=(await s.finalize([d])).committedInvoices[0];const p=(await s.pay(d,25,{selectedInvoiceID:first.customer_invoice_id})).row;const i=(await s.finalize([d],{allowSameDayRebill:true})).committedInvoices[0];
  const ex=ok(await s.post(`/invoices/${i.customer_invoice_id}/exceptions/1/1`,{condition:'bounced_check',reason:'Returned check',paymentIds:[p.payment_id]}));ok(await s.post(`/invoices/${i.customer_invoice_id}/exceptions/${ex.exception_id}/reverse/1/1`));
  const zip=new JSZip();zip.file('readme.txt','local');for(let k=0;k<count;k++)zip.file(`customer${k}.pdf`,'%PDF-local');const body=await zip.generateAsync({type:'nodebuffer'});
  await s.stub(S3Client.prototype,'send',async command=>{expect(command.constructor.name).eq('GetObjectCommand');return {Body:Readable.from([body])};},()=>s.refused(()=>s.post(`/invoices/${i.customer_invoice_id}/exceptions/${ex.exception_id}/resolve/1/1`,{action:'revision'}),500,500,/No changes were committed/));
 });
});
