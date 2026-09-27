'use strict';
const fs=require('fs'),{performance}=require('perf_hooks');
require('dotenv').config({path:'.env.local'});require('../../test/setup');require('../../src/utils/auditContext');
const ctx=require('../../src/endpoints/billingEntities/entity-context');
const db=require('knex')({client:'pg',connection:{host:'127.0.0.1',port:5433,user:'ds2',password:'ds2local',database:'ds2_local',options:'-c default_transaction_read_only=on'},pool:{min:0,max:1}});
async function main(){
 const entity=(await db('public.billing_entities').where({account_id:1,is_default:true}).first()).billing_entity_id;
 const out={readOnly:true,plans:{}};
 await ctx.run(entity,async()=>{
  const explain=async(name,sql,bindings=[])=>{const result=await db.raw('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,bindings);out.plans[name]=result.rows[0]['QUERY PLAN'];};
  await explain('originalFunctionWorkView',`SELECT r.transaction_id,r.customer_id,public.ds2_effective_entity(r.account_id,'customer_transactions',r.transaction_id,r.billing_entity_id) AS billing_entity_id FROM public.customer_transactions r WHERE r.account_id=1 AND r.customer_invoice_id IS NULL AND public.ds2_effective_entity(r.account_id,'customer_transactions',r.transaction_id,r.billing_entity_id)=?`,[entity]);
  await explain('batchedWorkView','SELECT transaction_id,customer_id,billing_entity_id FROM billing_reads.customer_transactions WHERE account_id=1 AND customer_invoice_id IS NULL');
  await explain('originalFunctionJobView',`SELECT r.customer_job_id,public.ds2_effective_entity(r.account_id,'customer_jobs',r.customer_job_id,r.billing_entity_id) AS billing_entity_id FROM public.customer_jobs r WHERE r.account_id=1 AND (r.billing_entity_id IS NULL OR public.ds2_effective_entity(r.account_id,'customer_jobs',r.customer_job_id,r.billing_entity_id)=?)`,[entity]);
  await explain('batchedJobView','SELECT customer_job_id,billing_entity_id FROM billing_reads.customer_jobs WHERE account_id=1');
 });
 out.indexes=(await db.raw("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('customer_transactions','customer_jobs','legacy_billing_scopes','legacy_financial_entity_attributions','billing_entity_reviews','billing_entity_resolutions','ar_obligations','ar_applications','client_credit_lots','client_credit_events') ORDER BY tablename,indexname")).rows;
 const today=require('../../src/endpoints/invoice/billingDate').billingDateToday();
 await ctx.run(entity,async()=>{
  const selection=Object.fromEntries((await require('../../src/endpoints/invoice/invoiceEligibility/invoiceEligibility').findCustomersNeedingInvoices(db,1,today)).map(c=>[c.customer_id,{customer_id:c.customer_id,showWriteOffs:false}]));
  const snapshot=await require('../../src/endpoints/invoice/createInvoice/billingSnapshot').readBillingSnapshot(db,{accountID:1,invoicesToCreateMap:selection,billingDate:today});
  const start=performance.now(),calculated=require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices').calculateInvoices(Object.values(selection),snapshot.invoiceQueryData);
  try{
   const detail=await require('../../src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail').addInvoiceDetails(calculated,snapshot.invoiceQueryData,selection,snapshot.accountBillingInformation,'',today);
   out.preview={clients:detail.length,detailsMs:performance.now()-start};
   const csvStart=performance.now(),csv=require('../../src/endpoints/invoice/createInvoiceCsv/createInvoiceCsv').createCsvData(detail);out.preview.csvMs=performance.now()-csvStart;out.preview.csvBytes=csv.buffer.length;
   const pdfStart=performance.now(),pdfs=await require('../../src/utils/createAndSavePDFs').createPDFInvoices(detail);out.preview.pdfMs=performance.now()-pdfStart;out.preview.pdfs=pdfs.length;out.preview.pdfBytes=pdfs.reduce((n,p)=>n+(p.buffer?.length||0),0);
   out.preview.storage='In-memory rendering only; no uploads, no ledger changes. Logo read is restricted to local MinIO by test/setup.';
  }catch(e){out.preview={clients:calculated.length,elapsedMs:performance.now()-start,error:e.message};}
 });
 fs.writeFileSync('docs/decisions/evidence/run-H10/query-plans-preview.json',JSON.stringify(out,null,2));
 console.log(JSON.stringify({plans:Object.fromEntries(Object.entries(out.plans).map(([k,v])=>[k,v[0]['Execution Time']])),preview:out.preview},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.destroy());
