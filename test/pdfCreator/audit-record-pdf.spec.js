'use strict';
const {execFileSync}=require('child_process');
const {randomUUID,createHash}=require('crypto');
const pdf=require('../../src/endpoints/auditRecord/audit-record-pdf');

describe('hard audit PDF before the first captured account event',()=>{
   it('distinguishes its digest from the all-zero genesis anchor and reconstructed zero values',async()=>{
      const zero='0'.repeat(64),record_id=randomUUID(),at='2026-09-25T07:00:00Z';
      const data={customer:{customer_id:1,display_name:'Pre-logging customer'},startDate:null,endDate:null,
         logging_started_at:at,methodology:'Reconstructed from existing records, before audit logging began',
         opening_balance:0,closing_balance:0,current:{running_balance:0,billed_balance:0,unbilled_balance:0},
         verification:{event_id:null,hash:zero},entries:[{id:'legacy',occurred_at:at,reconstructed:true,
            running_balance:0,billed_balance:0,unbilled_balance:0,retainer_available:0,
            events:[{actor_name:'Unknown (not recorded)',kind:'Customer profile',action:'reconstructed',
               entity:'customers',entity_id:1,source:'Existing database records',debit:0,credit:0,
               reconstructed:true,after_value:{historical_zero_hash:zero}}]}]};
      const result=await pdf.render(data,{record_id,firm:'Local Test Firm',generated_by:2,generated_by_name:'Test Admin',generated_at:at});
      expect(createHash('sha256').update(result.body).digest('hex')).to.equal(result.document_sha256);
      expect(pdf.verifyContent(result.body,result.content_sha256)).to.equal(true);
      const text=execFileSync('pdftotext',['-','-'],{input:result.body}).toString('utf8');
      expect(text).to.include('Hash-chain anchor event: genesis');expect(text).to.include(`AUDIT-SHA256/${record_id}:`);
      expect(text).to.include('Unknown (not recorded)');expect(text).to.include(zero);
   });
});

describe('audit PDF long business content',()=>{
 it('flows long ledger descriptions and client changes without losing tail evidence',async()=>{
  const at='2026-03-03T07:00:00Z',reason=('Long business reason '.repeat(500))+'END OF REASON';
  const data={customer:{display_name:'Long customer'},logging_started_at:at,methodology:'Reconstructed history notice',verification:{hash:'0'.repeat(64)},opening_balance:0,closing_balance:10,current:{running_balance:10,billed_balance:0,unbilled_balance:10,retainer_available:0},entries:[{id:1,occurred_at:at,running_balance:10,retainer_available:0,events:[{event_id:'1',entity:'duplicate_flags',entity_id:'1',action:'update',actor_name:'Ada Admin',before_value:{status:'open'},after_value:{status:'removed',resolution_reason:reason},changes:{status:{before:'open',after:'removed'}},reason}]}]};
  for(const record_type of ['client','full_evidence']){
   const result=await pdf.render(data,{record_id:randomUUID(),record_type,firm:'Local firm',generated_by_name:'Ada Admin',generated_at:at});
   const text=execFileSync('pdftotext',['-','-'],{input:result.body}).toString();
   expect(text).to.include('END OF REASON');expect(text).to.include('Closing position');expect(text).to.include('Verification');expect(pdf.verifyContent(result.body,result.content_sha256)).to.equal(true);
  }
 });
});

describe('client PDF archive summaries and verification wording',()=>{
 it('summarizes issuance and revision copies while full evidence retains every item and API path',async()=>{
  const at='2026-03-03T07:00:00Z',anchor='a'.repeat(64),source='b'.repeat(64);let id=0;
  const event=(entity,row)=>({event_id:String(++id),entity,entity_id:String(id),action:'insert',actor_name:'Ada Admin',after_value:row,changes:Object.fromEntries(Object.entries(row).map(([k,v])=>[k,{before:null,after:v}]))});
  const entries=[0,1].map(revision=>({id:revision,occurred_at:at,running_balance:100,retainer_available:0,events:[
   event(revision?'invoice_revisions':'invoice_issues',{invoice_id:1,invoice_number:'INV-1',revision}),
   event('invoice_statement_members',{invoice_id:1,table_name:'customer_invoices',snapshot:{remaining_balance_on_invoice:100}}),
   event('invoice_statement_members',{invoice_id:1,table_name:'customer_payments',snapshot:{payment_amount:-30}})]}));
  const data={customer:{display_name:'Archive customer'},logging_started_at:at,methodology:'Saved history',verification:{event_id:'6',hash:anchor},opening_balance:100,closing_balance:100,current:{running_balance:100,billed_balance:100,unbilled_balance:0,retainer_available:0},entries};
  for(const record_type of ['client','full_evidence']){
   const record_id=randomUUID(),evidence_path=`/auditRecord/customer/1/1/2/records/${record_id}/evidence`;
   const result=await pdf.render(data,{record_id,record_type,firm:'Local firm',generated_by_name:'Ada Admin',generated_at:at,evidence_sha256:source,evidence_path});
   const text=execFileSync('pdftotext',['-','-'],{input:result.body}).toString().replace(/\s+/g,' ');
   expect(pdf.verifyContent(result.body,result.content_sha256)).to.equal(true);expect(pdf.sha256(result.body)).to.equal(result.document_sha256);
   for(const value of [record_id,anchor,source,result.content_sha256,'6 record changes (6 captured, 0 reconstructed)'])expect(text).to.include(value);
   if(record_type==='client'){
    expect(text).to.include('2 changes listed individually; 4 archived statement-copy changes covered by 2 summary lines');
    expect(text).to.include('Invoice INV-1 finalized (sent and locked): 2 statement items archived - 1 invoice balance, 1 payment');
    expect(text).to.include('Invoice INV-1 revision 1 archived (sent and locked): 2 statement items archived');
    expect((text.match(/Covers 2 captured changes/g) || []).length).to.equal(2);expect((text.match(/Change \d+\./g) || []).length).to.equal(2);
    expect(text).not.to.include('(statement copy)');expect(text).not.to.include('/auditRecord/');expect(text).not.to.include('GET ');expect(text).not.to.include('endpoint');
    expect(text).to.include("To confirm this document is authentic and unchanged, give the firm its record ID; the firm's system recomputes the SHA-256 digest and checks it against the stored original and the audit chain.");
   } else {
    expect((text.match(/Change \d+\./g) || []).length).to.equal(6);expect((text.match(/\(statement copy\)/g) || []).length).to.equal(4);
    expect(text).to.include('Retrieve via GET '+evidence_path);expect(text).to.include('Verified evidence API: GET '+evidence_path);expect(text).not.to.include('summary lines');
   }
  }
 });
});
