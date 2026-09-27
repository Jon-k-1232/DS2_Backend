'use strict';
const {csvRow}=require('./csv-util');
const labels={work_entered_value:'Work entered standard value',work_entered_hours:'Actual work hours',wip:'Unbilled WIP at cutoff',held_work_value:'Held work standard value',gross_billed:'Gross issued charges',prebill_concessions:'Prebill concessions already deducted',credit_memos:'Credit memos net of reversals',voided_charges:'Voided charge components',net_billed:'Net billed by effective date',collected:'Applied receipts net of reversals',gross_cash_received:'Gross cash received',cash_reversed:'Cash receipt reversals',cash_returned:'Cash returned',held_receipt_credit:'Held receipt credit at cutoff',statement_credit:'Statement credit at cutoff',writeoffs:'Bad debt write-offs',noncash_applications:'Noncash applications',retainer_use:'Retainer applications',cohort_net_billed:'Issued cohort net billed at cutoff',cohort_standard_value:'Same cohort standard value',cohort_collected:'Same cohort applied receipts',cohort_writeoffs:'Same cohort write-offs',billing_realization_pct:'Billing realization %',collection_realization_pct:'Collection realization %',labor_cost:'Cohort labor cost',margin:'Cohort margin',margin_pct:'Cohort margin %',cost_status:'Cost basis',estimated_cost_count:'Estimated cost records',unknown_cost_count:'Unknown cost records',estimated_labor_cost:'Estimated labor amount',unknown_cost_standard_value:'Standard value with unknown cost',recurring_fees:'Recurring fees',fixed_fees:'Fixed charges'};
function performanceCsv(data){
 const lines=[csvRow(['Billing performance','Definition version',data.version]),csvRow(['Start',data.period.start,'End',data.period.end,'As of',data.period.asOf,'Recorded through',data.period.recordedThrough,'Business',data.period.entity]),csvRow(['Measure','Value'])];
 for(const [key,label] of Object.entries(labels))lines.push(csvRow([label,data.totals[key]??'N/A']));
 lines.push('',csvRow(['Business',...Object.values(labels)]));
 for(const r of data.byEntity)lines.push(csvRow([r.name,...Object.keys(labels).map(k=>r[k]??'N/A')]));
 lines.push('',csvRow(['Unattributed legacy work',data.unattributed_legacy_work.value,'Hours',data.unattributed_legacy_work.hours]));
 const section=(title,rows)=>{lines.push('',csvRow([title]));if(!rows.length){lines.push('No records');return;}const keys=Object.keys(rows[0]);lines.push(csvRow(keys));for(const row of rows)lines.push(csvRow(keys.map(k=>row[k])));};
 section('Issued cohorts',data.cohorts);section('Worked for / billed by attribution',data.attribution);section('Work and cost provenance',data.work);section('Effective events',data.events);
 for(const [key,value] of Object.entries(data.definitions))lines.push(csvRow([key,value]));
 return lines;
}
async function performancePdf(data){
 const PDFDocument=require('pdfkit');
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'LETTER',margin:44,bufferPages:true}),chunks=[];
  doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  const line=(left,right)=>{if(doc.y>704)doc.addPage();const y=doc.y;doc.fontSize(9).text(left,44,y,{width:345});const bottom=doc.y;doc.text(String(right ?? 'N/A'),395,y,{width:173,align:'right'});doc.y=Math.max(bottom,doc.y)+5;};
  doc.fontSize(20).text('Billing performance');doc.moveDown(.4);doc.fontSize(10).text(`${data.period.entity} | ${data.period.start} to ${data.period.end}`);doc.text(`Amounts in USD | As of ${data.period.asOf} | Recorded through ${data.period.recordedThrough}`);doc.moveDown();
  for(const [key,label] of Object.entries(labels))line(label,data.totals[key]);
  doc.addPage();doc.fontSize(15).text('By business');doc.moveDown();
  for(const r of data.byEntity){doc.fontSize(11).text(r.name);for(const k of ['work_entered_value','net_billed','collected','margin','cost_status'])line(labels[k],r[k]);doc.moveDown(.5);}
  line('Unattributed legacy work standard value',data.unattributed_legacy_work.value);
  doc.addPage();doc.fontSize(15).text('Definitions and limits');doc.moveDown();
  for(const [key,value] of Object.entries(data.definitions)){if(doc.y>630)doc.addPage();doc.fontSize(10).text(key.toUpperCase());doc.fontSize(9).text(value);doc.moveDown();}
  doc.fontSize(9).text('The matching CSV includes every issued cohort, worked-for / billed-by allocation and work cost provenance. Unknown costs are not treated as reliable zero.');
  const range=doc.bufferedPageRange();for(let n=0;n<range.count;n++){doc.switchToPage(n);doc.fontSize(8).text(`DS2 reporting v2 | ${n+1} / ${range.count}`,44,738,{width:524,align:'center',lineBreak:false});}
  doc.end();
 });
}
module.exports={labels,performanceCsv,performancePdf};
