'use strict';
const {Scenario,ok,expect,today}=require('./_scenario');
const storage=require('../../src/utils/s3');
const pdf=require('../../src/endpoints/auditRecord/audit-record-pdf');
const service=require('../../src/endpoints/auditRecord/audit-record-service');
const fs=require('fs');
describe('owner decision 6 hard account audit record',function(){
 this.timeout(180000);const s=new Scenario();let c,j,r,w,receipt,invoice,record,bytes,sourceArchive;
 const url=()=>`/auditRecord/customer/${c.id}/1/999`;
 const totals=async(n,b,available)=>{const h=ok(await s.get(url()+'?limit=100'));expect(h.current).to.deep.equal({running_balance:n,billed_balance:b,unbilled_balance:Math.round((n-b)*100)/100,retainer_available:available});expect(h.closing_balance).to.equal(n);expect(h.verification.valid).to.equal(true);return h;};
 const state=async()=>({business:await s.state(),audit:await s.db('audit_events').orderBy('event_id'),heads:await s.db('audit_chain_heads').orderBy('account_id'),records:await s.db('audit_records').orderBy('record_id')});
 const refusal=async(fn,status)=>{const before=await state();const response=await fn();expect(response.status,JSON.stringify(response.body).slice(0,500)).to.equal(status);expect(await state()).to.deep.equal(before);return response;};
 const download=(id=record.record_id,kind='pdf')=>s.get(url()+`/records/${id}/${kind}`).buffer(true).parse((res,cb)=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>cb(null,Buffer.concat(chunks)));});
 before(async()=>{await s.boot();c=await s.customer('Audit lifecycle');j=await s.job(c);});after(()=>s.close());
 it('attributes work, edits, customers and jobs to the session actor, never URL or logged-for staff',async()=>{
  w=await s.work(c,j,100);ok(await s.editWork(w,{unitCost:120,totalTransaction:120}));
  const h=await totals(120,0,0);const events=h.entries.flatMap(x=>x.events);
  const edited=events.find(e=>e.entity==='customer_transactions'&&e.action==='update');
  expect(edited.changes.total_transaction).to.deep.equal({before:100,after:120});
  for(const e of events){expect(e.actor_user_id).to.equal(1);expect(e.actor_name).to.equal('Sam Superadmin');expect(e.correlation_id).to.match(/^[a-f0-9-]{36}$/);expect(e.source).to.match(/^(POST|PUT) /);}
  expect(events.some(e=>e.entity==='customers')).to.equal(true);expect(events.some(e=>e.entity==='customer_jobs')).to.equal(true);
 });
 it('retainer receipt/draw/refund/increase remain separate from debt: $120+$50-$50-$20=$100; available $100-$50-$10+$5=$45',async()=>{
  r=await s.retainer(c,100);await totals(120,0,100);
  await s.work(c,j,50,{selectedRetainerID:r.retainer_id,detailedJobDescription:'Funded work'});await totals(120,0,50);
  await s.writeoff(c,20,{writeoffReason:'Courtesy'});await totals(100,0,50);
  ok(await s.post(`/retainers/${r.retainer_id}/events/1/999`,{kind:'refund',amount:10,date:today(),method:'Check',reference:'AUD-REF',reason:'Return unused funds'},'admin'));await totals(100,0,40);
  ok(await s.post(`/retainers/${r.retainer_id}/events/1/999`,{kind:'adjustment',direction:'increase',amount:5,date:today(),reason:'Correct deposit'},'admin'));
  const h=await totals(100,0,45);const e=h.entries.flatMap(x=>x.events).filter(x=>x.entity==='retainer_events');expect(e).to.have.length(2);expect(e.every(x=>x.actor_user_id===2&&x.actor_name==='Ada Admin')).to.equal(true);
  await s.check(c,{n:100,b:0,r:-45,unlinked:[1,50]});
 });
 it('draft writes no events; finalize marks sent and locks without double charging',async()=>{
  const before=await state();await s.preview(c);expect(await state()).to.deep.equal(before);
  await s.finalize([c]);invoice=await s.db('customer_invoices').where({account_id:1,customer_id:c.id}).whereNull('parent_invoice_id').first();
  const h=await totals(100,100,45);expect(h.entries.flatMap(x=>x.events).some(e=>e.kind==='Invoice finalized - sent and locked')).to.equal(true);
  await refusal(()=>s.editWork(w,{unitCost:130,totalTransaction:130}),409);
 });
 it('receipt -> finalized lock -> bounced reversal -> roll forward yields $70 -> $100 with all exception transitions',async()=>{
  receipt=(await s.pay(c,30,{selectedInvoiceID:invoice.customer_invoice_id,paymentReferenceNumber:'AUD-NSF'})).row;await totals(70,70,45);
  await s.finalize([c],{allowSameDayRebill:true});invoice=await s.db('customer_invoices').where({account_id:1,customer_id:c.id}).whereNull('parent_invoice_id').orderBy('customer_invoice_id','desc').first();
  const e=ok(await s.post(`/invoices/${invoice.customer_invoice_id}/exceptions/1/999`,{condition:'bounced_check',reason:'Bank returned check',paymentIds:[receipt.payment_id]},'admin'));
  ok(await s.post(`/invoices/${invoice.customer_invoice_id}/exceptions/${e.exception_id}/reverse/1/999`,{},'admin'));await totals(100,100,45);
  ok(await s.post(`/invoices/${invoice.customer_invoice_id}/exceptions/${e.exception_id}/resolve/1/999`,{action:'roll_forward'},'admin'));
  const h=await totals(100,100,45);expect(h.entries.flatMap(x=>x.events).filter(x=>x.entity==='invoice_exceptions').map(x=>x.after_value.state)).to.deep.equal(['flagged','reversed','resolved_roll_forward']);
  await s.check(c,{n:100,b:100,r:-45});
 });
 it('duplicate flag/dismiss/remove and ordinary delete retain changes; $100+$10+$10-$10=$110',async()=>{
  const a=await s.work(c,j,10,{detailedJobDescription:'Audited duplicate'});const b=await s.work(c,j,10,{detailedJobDescription:'Audited duplicate'});
  const flag=(await s.db('duplicate_flags').where({account_id:1,customer_id:c.id,record_id:b.transaction_id}).first());
  ok(await s.post(`/duplicates/${flag.duplicate_id}/resolve/1/999`,{action:'dismiss',reason:'Review first'},'admin'));
  const f=ok(await s.post('/duplicates/1/999',{kind:'transaction',recordId:a.transaction_id,reason:'Remove unwanted entry'},'admin'));
  // Manual flag may return the existing reversed pair; use its returned record.
  const open=await s.db('duplicate_flags').where({account_id:1,customer_id:c.id,status:'open'}).first();
  expect(f.status).to.equal(200);expect(open).to.exist;
  ok(await s.post(`/duplicates/${open.duplicate_id}/resolve/1/999`,{action:'remove',reason:'Remove once'},'admin'));
  const h=await totals(110,100,45);expect(h.entries.flatMap(x=>x.events).some(e=>e.entity==='customer_transactions'&&e.action==='delete')).to.equal(true);
  await s.check(c,{n:110,b:100,r:-45});
 });
 it('captures direct imports as system with source and never mistakes creator for actor',async()=>{
  await s.db('customer_payments_processed').insert({account_id:1,customer_id:c.id,customer_name:c.name,payment_amount:12,note:'Image extraction',source_file:'local-image.png',created_by_user_id:1});
  await s.db('timesheet_entries').insert({account_id:1,user_id:3,timesheet_name:'audit.xlsx',time_tracker_start_date:today(),time_tracker_end_date:today(),date:today(),duration:6,notes:'Tracker import',suggested_customer_id:c.id});
  const h=await totals(110,100,45);for(const entity of ['customer_payments_processed','timesheet_entries']){const e=h.entries.flatMap(x=>x.events).find(x=>x.entity===entity);expect(e.actor_name).to.equal('system');expect(e.actor_user_id).to.equal(null);expect(e.source).to.contain('database/');}
 });
 it('paginates without resetting balances, applies Phoenix dates, and accepts admins',async()=>{
  const all=ok(await s.get(url()+'?limit=100','admin'));const page=ok(await s.get(url()+'?limit=1&offset=2','admin'));
  expect(page.entries[0]).to.deep.equal(all.entries[2]);expect(page.total).to.equal(all.total);
  const empty=ok(await s.get(url()+'?startDate=2099-01-01'));expect(empty.entries).to.deep.equal([]);expect(empty.opening_balance).to.equal(110);expect(empty.closing_balance).to.equal(110);
  expect(service.phoenixDay('2026-09-25T06:59:59Z')).to.equal('2026-09-24');expect(service.phoenixDay('2026-09-25T07:00:00Z')).to.equal('2026-09-25');
 });
 it('generates a printable stored snapshot and reopens byte-identical bytes after later edits',async()=>{
  const printed=await s.post(url()+'/records',{startDate:'2020-01-01',endDate:today()},'admin');expect(printed.status,JSON.stringify(printed.body)).to.equal(201);record=printed.body.record;
  expect(record.record_type).to.equal('client');
  expect(record.generated_by).to.equal(2);expect(record.generated_by_name).to.equal('Ada Admin');
  const evidence=await download(record.record_id,'evidence');expect(evidence.status).to.equal(200);sourceArchive=JSON.parse(evidence.body.toString('utf8'));expect(pdf.sha256(evidence.body)).to.equal(record.evidence_sha256);expect(evidence.headers['x-evidence-sha256']).to.equal(record.evidence_sha256);
  expect(pdf.sha256(Buffer.from(JSON.stringify(sourceArchive)))).to.equal(record.evidence_sha256);
  const captured=await s.db('audit_events').where({account_id:1}).where(q=>q.where('customer_id',c.id).orWhere('previous_customer_id',c.id)).where('event_id','<=',record.chain_event_id).orderBy('event_id');
  const selected=captured.filter(e=>service.phoenixDay(e.occurred_at)>='2020-01-01' && service.phoenixDay(e.occurred_at)<=today());
  const entries=sourceArchive.data.entries,changes=entries.flatMap(e=>e.presentation.changes);
  expect(entries.length).to.equal(new Set(selected.map(e=>e.transaction_id)).size);
  expect(changes.map(e=>String(e.event_id))).to.deep.equal(selected.map(e=>String(e.event_id)));
  for(let i=0;i<changes.length;i++) {
   expect(changes[i].coverage.fields.slice().sort()).to.deep.equal(Object.keys(selected[i].changes).sort());
   expect([...changes[i].coverage.shown,...changes[i].coverage.omitted].sort()).to.deep.equal(changes[i].coverage.fields.slice().sort());
   expect(changes[i].fields.length+changes[i].summaries.length).to.be.above(0);
  }
  expect(sourceArchive.data.coverage.captured_changes).to.equal(selected.length);
  expect(sourceArchive.data.coverage.fields).to.equal(selected.reduce((n,e)=>n+Object.keys(e.changes).length,0));
  const clientChanges=entries.flatMap(e=>e.presentation.client_changes),summaries=clientChanges.filter(c=>c.kind==='statement_archive');
  const covered=clientChanges.flatMap(c=>c.covered_event_ids.map(String));
  expect(covered.slice().sort()).to.deep.equal(selected.map(e=>String(e.event_id)).sort());
  expect(new Set(covered).size).to.equal(selected.length);
  expect(clientChanges.flatMap(c=>c.covered_change_numbers).sort((a,b)=>a-b)).to.deep.equal(selected.map((_,i)=>i+1));
  expect(summaries.map(c=>c.change_count)).to.deep.equal([11,15,2]);
  expect(summaries.map(c=>c.item_counts)).to.deep.equal([
   {customer_invoices:1,customer_transactions:2,customer_payments:1,customer_writeoffs:1,customer_retainers_and_prepayments:4,retainer_events:2},
   {customer_invoices:4,customer_transactions:2,customer_payments:2,customer_writeoffs:1,customer_retainers_and_prepayments:4,retainer_events:2},
   {customer_payments:1,customer_invoices:1}]);
  for(const entry of entries)for(const summary of entry.presentation.client_changes.filter(c=>c.kind==='statement_archive')){
   const members=entry.events.filter(e=>e.entity==='invoice_statement_members' && String(e.after_value.invoice_id)===String(entry.events.find(e=>String(e.event_id)===String(summary.event_id)).after_value.invoice_id));
   expect(summary.covered_event_ids.map(String)).to.deep.equal(members.map(e=>String(e.event_id)));
   expect(summary.change_count).to.equal(members.length);expect(Object.values(summary.item_counts).reduce((n,v)=>n+v,0)).to.equal(members.length);
  }
  expect(sourceArchive.data.coverage).to.include({archive_summaries:3,summarized_changes:28,client_lines:selected.length-28+3});
  const response=await download();expect(response.status).to.equal(200);bytes=response.body;expect(pdf.sha256(bytes)).to.equal(record.document_sha256);expect(pdf.verifyContent(bytes,record.content_sha256)).to.equal(true);
  let overwriteError;try{await storage.putObject(`audit-records/1/${c.id}/${record.record_id}.pdf`,Buffer.from('replacement'),'application/pdf',{}, {ifNoneMatch:'*'});}catch(e){overwriteError=e;}
  expect(overwriteError?.$metadata?.httpStatusCode,'local storage refuses overwrite of the exact archived key').to.equal(412);
  let evidenceOverwrite;try{await storage.putObject(`audit-records/1/${c.id}/${record.record_id}.evidence.json`,Buffer.from('{}'),'application/json',{}, {ifNoneMatch:'*'});}catch(e){evidenceOverwrite=e;}expect(evidenceOverwrite?.$metadata?.httpStatusCode).to.equal(412);
  expect((await download()).body.equals(bytes)).to.equal(true);
  const text=s.pdf(bytes);for(const expected of ['Account history and audit record','Audit lifecycle','Ada Admin','100.00','110.00','Bank returned check','Document SHA-256','sent and locked'])expect(text).to.include(expected);
  const listed=(text.match(/Change \d+\./g) || []).length;
  const summarized=[...text.matchAll(/Covers (\d+) captured changes/g)].reduce((n,m)=>n+Number(m[1]),0);
  expect(listed).to.equal(changes.length-28);expect(summarized).to.equal(28);expect(listed+summarized).to.equal(selected.length);
  expect((text.match(/Posting \d+ \|/g) || []).length).to.equal(entries.length);
  for(const table of [...Object.keys(service.TABLES),'audit_records','audit_actions'])expect(text).not.to.include(table);
  expect(text).not.to.match(/"[^"\n]+"\s*:/);expect(text).not.to.include('retainer_draw:');expect(text).not.to.include('payment #2');
  const compact=value=>value.replace(/\s+/g,' ').trim();
  for(const entry of entries){expect(compact(text)).to.include(compact(entry.presentation.description));for(const change of entry.presentation.client_changes){if(change.kind==='statement_archive')expect(compact(text)).to.include(compact(change.text));else {expect(compact(text)).to.include(compact(change.label));for(const field of change.fields)expect(compact(text)).to.include(compact(field.text));}}}
  expect(compact(text)).to.include(`${selected.length-28} changes listed individually; 28 archived statement-copy changes covered by 3 summary lines`);
  expect(text).not.to.include('(statement copy)');expect(text).not.to.include('/auditRecord/');expect(text).not.to.include('Retrieve via GET');expect(text).not.to.include('endpoint');
  expect(compact(text)).to.include("give the firm its record ID; the firm's system recomputes the SHA-256 digest and checks it against the stored original and the audit chain.");
  for(const digest of [record.content_sha256,record.chain_hash,record.evidence_sha256])expect(compact(text)).to.include(digest);
  const info=require('child_process').execFileSync('pdfinfo',['-'],{input:bytes}).toString();expect(Number(info.match(/Pages:\s+(\d+)/)[1])).to.be.at.most(6);
  await s.db('customers').where({customer_id:c.id}).update({display_name:'Name after printing'});
  expect((await download()).body.equals(bytes)).to.equal(true);
  const list=ok(await s.get(url()+'/records'));expect(list.records[0].record_id).to.equal(record.record_id);expect(list.records[0]).not.to.have.property('storage_key');
  const check=ok(await s.get(url()+`/records/${record.record_id}/verify`));expect(check.valid).to.equal(true);
  const out='docs/decisions/evidence/run-6';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/client-record.pdf',bytes);
  fs.writeFileSync(out+'/client-record.json',JSON.stringify({record,verification:check,coverage:sourceArchive.data.coverage},null,2)+'\n');
  fs.writeFileSync(out+'/client-record.evidence.json',JSON.stringify(sourceArchive));
  expect((await download(record.record_id,'evidence')).body.equals(evidence.body)).to.equal(true);
 });
 it('prints full evidence compactly with retrievable payload descriptors and exact reopening',async()=>{
  const response=await s.post(url()+'/records',{recordType:'full_evidence'},'admin');expect(response.status).to.equal(201);
  const full=response.body.record;expect(full.record_type).to.equal('full_evidence');
  const file=await download(full.record_id);expect(file.status).to.equal(200);const body=file.body,text=s.pdf(body);
  expect(pdf.sha256(body)).to.equal(full.document_sha256);expect(pdf.verifyContent(body,full.content_sha256)).to.equal(true);
  const evidenceBytes=await download(full.record_id,'evidence');expect(evidenceBytes.status).to.equal(200);expect(pdf.sha256(evidenceBytes.body)).to.equal(full.evidence_sha256);const evidence={body:JSON.parse(evidenceBytes.body.toString('utf8'))};
  expect(pdf.sha256(Buffer.from(JSON.stringify(evidence.body)))).to.equal(full.evidence_sha256);
  const compact=text.replace(/\s+/g,' ');expect(compact).to.include('Full evidence record');expect(compact).to.include('Object,');expect(compact).to.include('bytes, SHA-256');expect(compact).to.include('actor Ada Admin (user #2)');expect(compact).to.include('Generated by: 2');expect(compact).not.to.include('Generated by: $2.00');expect(compact).to.include('Debit $30.00; Credit $0.00');expect(compact).to.include('[retainer_draw:');expect(compact).to.include('Retainer availability change $100.00');
  const allChanges=evidence.body.data.entries.flatMap(e=>e.presentation.changes);
  expect((text.match(/Change \d+\./g) || []).length).to.equal(allChanges.length);
  expect((text.match(/\(statement copy\)/g) || []).length).to.equal(28);
  for(const change of allChanges)expect(compact).to.include(change.label.replace(/\s+/g,' '));
  expect(compact).to.include(`Retrieve via GET /auditRecord/customer/${c.id}/1/2/records/${full.record_id}/evidence`);
  let descriptors=0;
  const pres=require('../../src/endpoints/auditRecord/audit-record-presentation');
  for(let i=0;i<evidence.body.data.entries.length;i++)for(let j=0;j<evidence.body.data.entries[i].events.length;j++) {
   const e=evidence.body.data.entries[i].events[j];
   for(const [field,values] of Object.entries(e.changes))for(const side of ['before','after']) {
    const v=values[side];if(v===null || typeof v!=='object')continue;
    const d=pres.descriptor(v);expect(compact).to.include(d.sha256);expect(compact).to.include(`/data/entries/${i}/events/${j}/changes/${field}/${side}`);descriptors++;
   }
  }
  expect(descriptors).to.be.above(20);
  expect((await download(full.record_id)).body.equals(body)).to.equal(true);expect((await download(full.record_id,'evidence')).body.equals(evidenceBytes.body)).to.equal(true);
  const check=ok(await s.get(url()+`/records/${full.record_id}/verify`));expect(check).to.include({valid:true,evidence_valid:true});
  const list=ok(await s.get(url()+'/records'));expect(list.records.find(r=>r.record_id===full.record_id).record_type).to.equal('full_evidence');
  expect(list.records[0]).not.to.have.property('evidence_storage_key');
  fs.writeFileSync('docs/decisions/evidence/run-6/full-evidence-record.pdf',body);
  fs.writeFileSync('docs/decisions/evidence/run-6/full-evidence-record.json',JSON.stringify({record:full,verification:check,coverage:evidence.body.data.coverage},null,2)+'\n');
  fs.writeFileSync('docs/decisions/evidence/run-6/full-evidence-record.evidence.json',JSON.stringify(evidence.body));
 });
 it('refuses updating/deleting stored metadata and preserves its PDF and evidence',async()=>{
  for(const operation of ['update','delete','type','archive']){const before=await state();let error;try{const q=s.db('audit_records').where({record_id:record.record_id});if(operation==='update')await q.update({generated_by_name:'forged'});else if(operation==='type')await q.update({record_type:'full_evidence'});else if(operation==='archive')await q.update({evidence_sha256:'d'.repeat(64)});else await q.del();}catch(e){error=e;}expect(error?.code).to.equal('P0409');expect(await state()).to.deep.equal(before);}
 });
 it('records invoice reprints, and a failed reprint audit write returns no bytes or partial evidence',async()=>{
  const key=invoice.invoice_file_location;await s.files(key);
  const action=await s.db('audit_actions').where({account_id:1,customer_id:c.id,action:'invoice_reprint'}).orderBy('action_id','desc').first();expect(action.detail.invoice_id).to.equal(invoice.customer_invoice_id);
  await s.db.raw("CREATE FUNCTION audit_reprint_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reprint failure'; END $$");
  try{await s.db.raw('CREATE TRIGGER audit_reprint_fault BEFORE INSERT ON audit_actions FOR EACH ROW EXECUTE FUNCTION audit_reprint_fault()');
   await refusal(()=>s.get('/invoices/downloadFile/1/999?fileLocation='+encodeURIComponent(key)),500);
   await refusal(()=>download(),500);
  }finally{await s.db.raw('DROP TRIGGER audit_reprint_fault ON audit_actions');await s.db.raw('DROP FUNCTION audit_reprint_fault()');}
 });
 it('denies Manager and Owner on every audit route, preserving their other billing permissions',async()=>{
  for(const role of ['Manager','Owner']){
   await s.db('users').where({user_id:2}).update({access_level:role});
   try{for(const suffix of ['','/verify','/records',`/records/${record.record_id}/pdf`,`/records/${record.record_id}/verify`,`/records/${record.record_id}/evidence`])await refusal(()=>s.get(url()+suffix,'admin'),403);await refusal(()=>s.post(url()+'/records',{},'admin'),403);}
   finally{await s.db('users').where({user_id:2}).update({access_level:'Admin'});}
  }
 });
 const routes=[['get',''],['get','/verify'],['get','/records'],['post','/records'],['get','/records/RECORD/pdf'],['get','/records/RECORD/verify'],['get','/records/RECORD/evidence']];
 for(const [method,path] of routes)it(`${method.toUpperCase()} ${path || '/'}: authentication, roles, tenant, missing and database failures write nothing`,async()=>{
  const suffix=path.replace('RECORD',record.record_id);
  const request=(base,role)=>s.req(method,base+suffix,method==='post'?{}:undefined,role);
  await refusal(()=>request(url(),null),401);await refusal(()=>request(url(),'staff'),403);
  await refusal(()=>request(url().replace('/1/999','/700/999'),'sa'),403);
  const missing=url().replace(`/customer/${c.id}/`,'/customer/2147483647/');await refusal(()=>request(missing,'sa'),404);
  await refusal(()=>request(url().replace(`/customer/${c.id}/`,'/customer/no/'),'sa'),400);
  const Pg=require('knex/lib/dialects/postgres');const saved=Pg.prototype._query;
  try{
   Pg.prototype._query=function(conn,query){if(require('../../src/utils/auditContext').storage.getStore() && /audit_|ds2_verify_audit/.test(query.sql))return Promise.reject(Error('database fault'));return saved.call(this,conn,query);};
   await refusal(()=>request(url(),'sa'),500);
  }finally{Pg.prototype._query=saved;}
  if(path.includes('RECORD')){const read=storage.getObject;try{storage.getObject=async()=>{throw Error('storage fault');};await refusal(()=>request(url(),'sa'),500);}finally{storage.getObject=read;}}
 });
 it('validates every range/pagination branch and rejects malformed/missing stored IDs without writes',async()=>{
  for(const query of ['startDate=no','endDate=2026-02-30','startDate=2027-01-01&endDate=2026-01-01','limit=0','limit=101','limit=true','offset=-1','offset=99999999999999999999','startDate[x]=1'])await refusal(()=>s.get(url()+'?'+query),400);
  for(const body of [{recordType:null},{recordType:[]},{recordType:{}},{recordType:'Client record'},{recordType:5},[],{startDate:false},{endDate:'wrong'},{limit:false},{offset:{x:1}},{startDate:'2027-01-01',endDate:'2026-01-01'}])await refusal(()=>s.post(url()+'/records',body),400);
  for(const route of ['pdf','verify','evidence']){await refusal(()=>s.get(url()+`/records/no/${route}`),400);await refusal(()=>s.get(url()+`/records/00000000-0000-4000-8000-000000000000/${route}`),404);}
  await refusal(()=>s.get(url()+'/records?offset=-1'),400);
 });
 it('foreign customer/record isolation, including super admins, leaves no evidence',async()=>{
  await s.foreignFixture();await refusal(()=>s.get(`/auditRecord/customer/70001/1/1`),404);
  for(const route of ['pdf','verify','evidence'])await refusal(()=>s.get(`/auditRecord/customer/70001/700/70001/records/${record.record_id}/${route}`,'foreign'),404);
 });
 it('storage creation failure and DB insert failure publish no record and no log; retry succeeds',async()=>{
  const put=storage.putObject;try{storage.putObject=async()=>{throw Error('storage unavailable');};await refusal(()=>s.post(url()+'/records',{}),500);}finally{storage.putObject=put;}
  await s.db.raw("CREATE FUNCTION audit_record_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit insert failure'; END $$");
  try{await s.db.raw('CREATE TRIGGER audit_record_fault BEFORE INSERT ON audit_records FOR EACH ROW EXECUTE FUNCTION audit_record_fault()');await refusal(()=>s.post(url()+'/records',{}),500);}finally{await s.db.raw('DROP TRIGGER audit_record_fault ON audit_records');await s.db.raw('DROP FUNCTION audit_record_fault()');}
 });
 it('render failure, empty storage result and suppressed metadata insert publish no record',async()=>{
  const render=pdf.render,read=storage.getObject;
  try{pdf.render=async()=>{throw Error('render fault');};await refusal(()=>s.post(url()+'/records',{}),500);}finally{pdf.render=render;}
  try{storage.getObject=async()=>({body:null});for(const route of ['pdf','verify','evidence'])await refusal(()=>s.get(url()+`/records/${record.record_id}/${route}`),500);}finally{storage.getObject=read;}
  await s.db.raw("CREATE FUNCTION audit_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$");
  try{await s.db.raw('CREATE TRIGGER audit_suppress BEFORE INSERT ON audit_records FOR EACH ROW EXECUTE FUNCTION audit_suppress()');await refusal(()=>s.post(url()+'/records',{}),500);}
  finally{await s.db.raw('DROP TRIGGER audit_suppress ON audit_records');await s.db.raw('DROP FUNCTION audit_suppress()');}
 });
 it('refuses archive tampering, wrong storage identity, missing archive, failed chain and failed anchor without writes',async()=>{
  const get=storage.getObject;
  try{storage.getObject=async key=>key.endsWith('.evidence.json')?{body:Buffer.from('tampered')}:get(key);
   await refusal(()=>s.get(url()+`/records/${record.record_id}/evidence`),409);
   expect(ok(await s.get(url()+`/records/${record.record_id}/verify`))).to.include({valid:false,evidence_valid:false});
  }finally{storage.getObject=get;}
  const original=await s.db('audit_records').where({record_id:record.record_id}).first();
  await s.db.raw('ALTER TABLE audit_records DISABLE TRIGGER ds2_audit_immutable');
  try{
   for(const [values,status] of [[{evidence_storage_key:'forged.json'},409],[{evidence_storage_key:null,evidence_sha256:null,evidence_byte_length:null},404],[{chain_hash:'d'.repeat(64)},409]]){
    await s.db('audit_records').where({record_id:record.record_id}).update({...original,...values});
    await refusal(()=>s.get(url()+`/records/${record.record_id}/evidence`),status);
    if(status===404)expect(ok(await s.get(url()+`/records/${record.record_id}/verify`))).to.include({valid:true,evidence_valid:null});
   }
  }finally{await s.db('audit_records').where({record_id:record.record_id}).update(original);await s.db.raw('ALTER TABLE audit_records ENABLE TRIGGER ds2_audit_immutable');}
 });
 it('PDF upload failure after evidence upload publishes no metadata for either print type',async()=>{
  const put=storage.putObject;
  for(const recordType of ['client','full_evidence'])try{storage.putObject=async(key,...args)=>{if(key.endsWith('.pdf'))throw Error('PDF upload failed');return put(key,...args);};await refusal(()=>s.post(url()+'/records',{recordType}),500);}finally{storage.putObject=put;}
 });
 it('fails the financial write closed if audit capture fails, with no partial business or chain changes',async()=>{
  await s.db.raw("CREATE FUNCTION audit_capture_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit storage failed'; END $$");
  try{await s.db.raw('CREATE TRIGGER audit_capture_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_capture_fault()');
   const before=await state();const response=await s.post('/transactions/createTransaction/1/999',{transaction:s.transaction(c,j,2)});
   expect(Number(response.body.status||response.status)).to.equal(500);expect(await state()).to.deep.equal(before);
  }finally{await s.db.raw('DROP TRIGGER audit_capture_fault ON audit_events');await s.db.raw('DROP FUNCTION audit_capture_fault()');}
 });
 it('isolates concurrent users and permits later postings while a consistent PDF snapshot is rendered',async()=>{
  const other=await s.customer('Concurrent audit');const job=await s.job(other);
  const responses=await Promise.all([s.post('/transactions/createTransaction/1/999',{transaction:s.transaction(other,job,7)},'admin'),s.post('/transactions/createTransaction/1/999',{transaction:s.transaction(other,job,11)},'sa')]);
  for(let index=0;index<responses.length;index++){ok(responses[index]);const events=await s.db('audit_events').where({correlation_id:responses[index].headers['x-correlation-id']});expect(events.length).to.be.above(0);expect(events.every(e=>e.actor_user_id===[2,1][index])).to.equal(true);}
  const render=pdf.render;let captured;
  try{pdf.render=async(data,meta)=>{captured=data;ok(await s.post('/transactions/createTransaction/1/999',{transaction:s.transaction(other,job,1)},'admin'));return render(data,meta);};
   const response=await s.post(url()+'/records',{});expect(response.status,JSON.stringify(response.body)).to.equal(201);
   expect(response.body.record.chain_event_id).to.equal(String(captured.verification.event_id));
   expect(ok(await s.get(url()+`/records/${response.body.record.record_id}/verify`)).valid).to.equal(true);
  }finally{pdf.render=render;}
  expect(ok(await s.get(`/auditRecord/customer/${other.id}/1/1`)).current.running_balance).to.equal(19);
 });
 it('reacquires the account lock after savepoint rollback and rolls back actor-attributed evidence atomically',async()=>{
  const context=require('../../src/utils/auditContext');const before=await state();
  await context.storage.run({user:{user_id:2,account_id:1,display_name:'Ada Admin'},source:'test/savepoint',correlationId:'savepoint-proof'},()=>s.db.transaction(async t=>{
   await t.transaction(async inner=>{
    await inner('customers').where({customer_id:c.id}).update({display_name:'Rolled-back inner edit'});
    await inner.rollback();
   });
   const lock=await t.raw("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=260026 AND objid=1 AND granted) AS held");
   expect(lock.rows[0].held,'lock reacquired before the next business query').to.equal(true);
   expect(await t('audit_events').where({correlation_id:'savepoint-proof'})).to.have.length(0);
   await t('customers').where({customer_id:c.id}).update({display_name:'Outer edit'});
   const events=await t('audit_events').where({correlation_id:'savepoint-proof'});expect(events).to.have.length(1);expect(events[0].actor_user_id).to.equal(2);
   await t.rollback();
  }));
  expect(await state()).to.deep.equal(before);
 });
 it('detects altered PDF bytes, blocks reopening and reports verification failure without writes',async()=>{
  const get=storage.getObject;try{storage.getObject=async()=>({body:Buffer.from('tampered')});expect(ok(await s.get(url()+`/records/${record.record_id}/verify`)).valid).to.equal(false);await refusal(()=>download(),409);}finally{storage.getObject=get;}
 });
 it('refuses a forged storage identity and detects a mismatched retained chain anchor',async()=>{
  expect((await s.db.raw('SELECT current_database() AS db')).rows[0].db).to.equal('ds2_scenarios');
  const original=await s.db('audit_records').where({record_id:record.record_id}).first();
  // A privileged mutation is possible only with the immutable guard disabled.
  // Capture remains enabled, retaining both the deliberate tamper and repair.
  await s.db.raw('ALTER TABLE audit_records DISABLE TRIGGER ds2_audit_immutable');
  try{
   await s.db('audit_records').where({record_id:record.record_id}).update({storage_key:'forged/identity.pdf'});
   for(const route of ['pdf','verify','evidence'])await refusal(()=>s.get(url()+`/records/${record.record_id}/${route}`),409);
   await s.db('audit_records').where({record_id:record.record_id}).update({storage_key:original.storage_key,chain_hash:'a'.repeat(64)});
   const before=await state(),check=ok(await s.get(url()+`/records/${record.record_id}/verify`));
   expect(check).to.include({valid:false,document_valid:true,chain_valid:true,anchor_valid:false});expect(await state()).to.deep.equal(before);
  }finally{
   await s.db('audit_records').where({record_id:record.record_id}).update({storage_key:original.storage_key,chain_hash:original.chain_hash});
   await s.db.raw('ALTER TABLE audit_records ENABLE TRIGGER ds2_audit_immutable');
  }
  expect(ok(await s.get(url()+`/records/${record.record_id}/verify`)).valid).to.equal(true);
 });
 it('detects altered chain evidence in the disposable scenario database and blocks new print/history',async()=>{
  const original=await s.db('audit_events').where({account_id:1}).first();
  try{await s.db.raw('ALTER TABLE audit_events DISABLE TRIGGER ds2_audit_immutable');await s.db('audit_events').where({event_id:original.event_id}).update({actor_name:'tamper'});
   expect(ok(await s.get(url()+'/verify')).verification.valid).to.equal(false);await refusal(()=>s.get(url()+`/records/${record.record_id}/evidence`),409);await refusal(()=>s.get(url()),409);await refusal(()=>s.post(url()+'/records',{}),409);
   expect(ok(await s.get(url()+`/records/${record.record_id}/verify`)).valid).to.equal(false);
  }finally{await s.db('audit_events').where({event_id:original.event_id}).update({actor_name:original.actor_name});await s.db.raw('ALTER TABLE audit_events ENABLE TRIGGER ds2_audit_immutable');}
 });
 it('reconstructs pre-logging history and unknown actors, then retains edits and deletion',async()=>{
  // An existing clean seed row is made pre-activation by rebuilding a throwaway
  // customer fixture with capture disabled; only this isolated scenario DB.
  let legacy;
  try{await s.db.raw('ALTER TABLE customers DISABLE TRIGGER ds2_audit_capture');[legacy]=await s.db('customers').insert({account_id:1,customer_name:'Older unknown actor',display_name:'Older unknown actor',is_commercial_customer:false,is_customer_active:true,is_billable:true,is_recurring:false,created_at:'2020-01-01'}).returning('*');}
  finally{await s.db.raw('ALTER TABLE customers ENABLE TRIGGER ds2_audit_capture');}
  await s.db('customers').where({customer_id:legacy.customer_id}).update({display_name:'Newer name'});await s.db('customers').where({customer_id:legacy.customer_id}).del();
  const h=ok(await s.get(`/auditRecord/customer/${legacy.customer_id}/1/1`));expect(h.customer.deleted).to.equal(true);expect(h.entries[0].reconstructed).to.equal(true);expect(h.entries[0].events[0].actor_name).to.equal('Unknown (not recorded)');expect(h.entries[0].events[0].after_value.display_name).to.equal('Older unknown actor');
 });
});
