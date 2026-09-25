'use strict';
const {Scenario,ok,expect,money,today}=require('./_scenario');
describe('owner decision 1: retainer refunds and adjustments',function(){
 this.timeout(180000); const s=new Scenario(); let c,job,r,issued,original;
 const url=()=>`/retainers/${r.retainer_id}/events/1/777`;
 const body=(kind,amount,more={})=>({kind,amount,date:today(),reason:'Owner correction',method:'Check',reference:'RETURN-01',...more});
 const event=async b=>ok(await s.post(url(),b));
 before(async()=>{await s.boot();}); after(()=>s.close());
 it('starts with $500, draws $120 and issues a frozen $0 statement with $380 available',async()=>{
  c=await s.customer('Retainer event lifecycle');job=await s.job(c);r=await s.retainer(c,500);
  await s.work(c,job,120,{selectedRetainerID:r.retainer_id});
  await s.check(c,{n:0,b:0,r:-380,unlinked:[1,120]});
  issued=await s.statement(c,await s.finalize([c]),1,[0,120,-120,0,-380,0]);
  original=await s.db('customer_retainers_and_prepayments').where({account_id:1,customer_id:c.id}).orderBy('retainer_id');
 });
 it('refunds $80 then increases $50 and decreases $30: availability 380-80+50-30=$320, debt $0',async()=>{
  const refund=await event(body('refund',80));expect(refund.available).to.equal(300);expect(refund.event.actor_id).to.equal(1);
  expect((await event(body('adjustment',50,{direction:'increase'}))).available).to.equal(350);
  expect((await event(body('adjustment',30,{direction:'decrease'}))).available).to.equal(320);
  await s.check(c,{n:0,b:0,r:-320});
  const h=ok(await s.get(url()));expect(h.events).to.have.length(3);expect(h.lockedInvoice).to.equal(issued.invoice_number);
  const audit=await s.audit(c);expect(audit.summary.retainers.retainer_drawn).to.equal(120);expect(audit.summary.retainers.breakdown[0].refunded_to_date).to.equal(80);expect(audit.summary.retainers.breakdown[0].adjustments_to_date).to.equal(20);
  for(const row of original) expect(await s.db('customer_retainers_and_prepayments').where({retainer_id:row.retainer_id}).first()).to.deep.equal(row);
  const next=await s.preview(c);expect(next.retainers.events).to.have.length(3);
  const eligibility=ok(await s.get('/invoices/createInvoice/AccountsWithBalance/1/1'));
  expect(eligibility.outstandingBalanceList.activeOutstandingBalancesData.grid.rows.find(row=>row.customer_id===c.id).retainer_event_count).to.equal(3);
 });
 it('prints all events exactly once and preserves the original artifact',async()=>{
  await s.shift(1);
  const second=await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),2,[0,0,0,0,-320,0],['Retainer Refunds and Adjustments','RETURN-01','80.00 / 300.00','50.00 / 350.00','30.00 / 320.00']);
  expect(second.pdf.equals(issued.pdf)).to.equal(false);
  const members=await s.db('invoice_statement_members').where({invoice_id:second.customer_invoice_id,table_name:'retainer_events'});expect(members).to.have.length(3);
  expect((await s.preview(c)).retainers.events).to.have.length(0);
  const archive=await s.files(issued.invoice_file_location);expect(Object.values(archive).some(b=>b.equals(issued.pdf))).to.equal(true);
  const {buildStatementData,renderStatementPdf}=require('../../src/endpoints/customer/customer-statement');
  const data=await buildStatementData(s.db,1,c.id,{});expect(data.events.filter(e=>e.type.startsWith('retainer_') && e.type!=='retainer_established')).to.have.length(3);
  expect(s.pdf(await renderStatementPdf(data,data.accountInfo))).to.include('Retainer refund decrease: $80.00');
 });
 for(const [name,patch] of [['kind',{kind:'delete'}],['zero',{amount:0}],['negative',{amount:-1}],['nonfinite',{amount:'Infinity'}],['precision',{amount:'1.001'}],['maximum',{amount:100000000}],['date',{date:'2026-02-30'}],['reason',{reason:' '}],['method',{method:''}],['reference',{reference:''}],['direction',{direction:'increase'}]]) {
  it(`rejects invalid ${name} without writes`,async()=>s.reject(()=>s.post(url(),body('refund',1,patch)),null,null,null,400));
 }
 it('rejects insufficient availability, missing/cross-tenant IDs and permissions without writes',async()=>{
  await s.reject(()=>s.post(url(),body('refund',321)),/available/,null,null,409);
  await s.reject(()=>s.post('/retainers/999999/events/1/1',body('refund',1)),/not found/,null,null,404);
  await s.foreignFixture();
  for(const method of ['get','post']) {
   const run=(u,role)=>method==='get'?s.get(u,role):s.post(u,body('refund',1),role);
   for(const [u,role,status] of [[url(),'staff',403],[url(),null,401],[`/retainers/${r.retainer_id}/events/700/1`,'sa',403],['/retainers/70001/events/1/1','sa',404],['/retainers/bad/events/1/1','sa',400]]) await s.reject(()=>run(u,role),null,null,null,status);
  }
 });
 it('refuses cancellation revival, overflow, malformed adjustment fields and direct journal-chain edits',async()=>{
  for(const patch of [{direction:'bad'},{direction:undefined},{amount:true},{amount:''},{amount:null},{date:'nonsense'},{date:'1899-12-31'},{reason:'x'.repeat(2001)},{method:'x'.repeat(51)},{reference:'x'.repeat(101)}]) await s.reject(()=>s.post(url(),body('adjustment',1,{direction:'increase',...patch})),null,null,null,400);
  await s.reject(()=>s.post(url(),body('adjustment',99999999.99,{direction:'increase'})),/exceeds/,null,null,409);
  const hold=await s.retainer(c,5,{displayName:'Cancelled fixture'});
  await s.db('customer_retainers_and_prepayments').where({retainer_id:hold.retainer_id}).update({current_amount:0,is_retainer_active:false,note:'[cancelled by reversal of payment #12345]'});
  await s.reject(()=>s.post(`/retainers/${hold.retainer_id}/events/1/1`,body('adjustment',1,{direction:'increase'})),/cancelled/,null,null,409);
  const free=await s.retainer(c,5,{displayName:'Pending events fixture'});
  ok(await s.post(`/retainers/${free.retainer_id}/events/1/1`,body('refund',5)));
  await s.reject(()=>s.put('/retainers/updateRetainer/1/1',{retainer:{retainerID:free.retainer_id,unitCost:6}}),/immutable/,null,null,409);
  await s.reject(()=>s.del(`/retainers/deleteRetainer/${free.retainer_id}/1/1`),/immutable/,null,null,409);
 });
 it('reports retainer history database failure without writes',async()=>{
  const service=require('../../src/endpoints/retainer/retainer-events');const real=service.history;service.history=async()=>{throw Error('database unavailable');};
  try{await s.reject(()=>s.get(url()),/failed/,null,null,500);}finally{service.history=real;}
 });
 it('refuses inconsistent retainer balances and cross-customer chains on both event routes',async()=>{
  const hold=await s.retainer(c,5,{displayName:'Inconsistent fixture'});
  const path=`/retainers/${hold.retainer_id}/events/1/1`;
  for(const patch of [{current_amount:1},{current_amount:-5,is_retainer_active:false}]) {
   await s.db('customer_retainers_and_prepayments').where({retainer_id:hold.retainer_id}).update(patch);
   await s.reject(()=>s.post(path,body('refund',1)),/inconsistent/,null,null,409);
  }
  await s.db('customer_retainers_and_prepayments').where({retainer_id:hold.retainer_id}).update({current_amount:-5,is_retainer_active:true});
  const other=await s.customer('Malformed chain fixture');
  const {retainer_id,created_at,...fields}=hold;
  const [child]=await s.db('customer_retainers_and_prepayments').insert({...fields,customer_id:other.id,parent_retainer_id:hold.retainer_id}).returning('*');
  for(const call of [()=>s.get(path),()=>s.post(path,body('refund',1))])await s.reject(call,/inconsistent/,null,null,409);
  await s.db('customer_retainers_and_prepayments').where({retainer_id:child.retainer_id}).del();
  await s.db('customer_retainers_and_prepayments').where({retainer_id:hold.retainer_id}).del();
 });
 it('preserves pending events when statement storage fails before commit',async()=>{
  const {S3Client}=require('@aws-sdk/client-s3');const real=S3Client.prototype.send;
  S3Client.prototype.send=function(cmd,...args){if(cmd.constructor.name==='PutObjectCommand' && cmd.input.Key.includes('/invoice_images/'))throw Error('scenario local storage failure');return real.call(this,cmd,...args);};
  try{await s.reject(()=>s.post('/invoices/createInvoice/1/1',s.configuration([c],{isFinalized:true,allowSameDayRebill:true})),/storage|upload|scenario/i);}finally{S3Client.prototype.send=real;}
 });
 it('rolls back snapshot and journal on each database write failure',async()=>{
  for(const table of ['customer_retainers_and_prepayments','retainer_events']) for(const fault of ['dbFailure','suppressWrite']) await s[fault](table,'INSERT',()=>s.reject(()=>s.post(url(),body('refund',1)),/failed/,null,null,500));
 });
 it('refunds all $320, prints the event even with zero retainers, then increases an exhausted chain',async()=>{
  expect((await event(body('refund',320))).available).to.equal(0);await s.check(c,{n:0,b:0});
  await s.shift(1);
  await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),3,[0,0,0,0,0,0],['320.00 / 0.00']);
  expect((await event(body('adjustment',50,{direction:'increase'}))).available).to.equal(50);
  await s.reject(()=>s.post(url(),body('adjustment',51,{direction:'decrease'})),/available/,null,null,409);
 });
 it('serializes racing refunds; only one $40 refund can consume $50',async()=>{
  const results=await Promise.all([s.post(url(),body('refund',40)),s.post(url(),body('refund',40))]);
  expect(results.map(r=>r.status).sort()).to.deep.equal([200,409]);await s.check(c,{n:0,b:0,r:-10});
 });
 it('serializes a $10 draw against a $10 refund and leaves event evidence immutable',async()=>{
  const results=await Promise.all([s.post(url(),body('refund',10)),s.post('/transactions/createTransaction/1/1',{transaction:s.transaction(c,job,10,{selectedRetainerID:r.retainer_id})})]);
  expect(results.filter(r=>r.body.status===200)).to.have.length(1);await s.check(c,{n:0,b:0,r:0,...(results[1].body.status===200 ? {unlinked:[1,10]} : {})});
  const ev=await s.db('retainer_events').first();
  for(const [table,key,value] of [['retainer_events','event_id',ev.event_id],['customer_retainers_and_prepayments','retainer_id',ev.snapshot_id]]) {
   const before=await s.state();let error;try{await s.db(table).where({[key]:value}).update({created_at:s.db.raw('created_at')});}catch(e){error=e;}
   expect(error?.code).to.equal('P0409');expect(await s.state()).to.deep.equal(before);
  }
 });
 it('rejects a finalize priced before a refund and prints long reasons across statement pages',async()=>{
  const client=await s.customer('Long reason and finalize race');const j=await s.job(client);const hold=await s.retainer(client,100);await s.work(client,j,50);
  const longReason='W'.repeat(1986)+' END OF REASON';expect(longReason).to.have.length(2000);
  const {S3Client}=require('@aws-sdk/client-s3');const real=S3Client.prototype.send;let changed=false;
  const before=await s.db('customer_invoices').where({customer_id:client.id});
  S3Client.prototype.send=async function(cmd,...args){
   if(!changed && cmd.constructor.name==='PutObjectCommand' && cmd.input.Key.includes('/invoice_images/')) {
    changed=true;ok(await s.post(`/retainers/${hold.retainer_id}/events/1/1`,body('refund',10,{reason:longReason})));
   }
   return real.call(this,cmd,...args);
  };
  try{const response=await s.post('/invoices/createInvoice/1/1',s.configuration([client],{isFinalized:true}));expect(response.body.status).to.be.at.least(400);}finally{S3Client.prototype.send=real;}
  expect(changed).to.equal(true);expect(await s.db('customer_invoices').where({customer_id:client.id})).to.deep.equal(before);await s.check(client,{n:50,b:0,r:-90});
  const {buildStatementData,renderStatementPdf}=require('../../src/endpoints/customer/customer-statement');const data=await buildStatementData(s.db,1,client.id,{});
  const statement=await renderStatementPdf(data,data.accountInfo);expect(s.pdf(statement)).to.include('continued');expect(s.pdf(statement)).to.include('END OF REASON');expect(s.pdf(statement)).to.include('Closing balance (transaction basis)');
  require('fs').writeFileSync(require('path').join(__dirname,'../../docs/decisions/evidence/run-2/customer-statement-long.pdf'),statement);
  const finalized=await s.finalize([client]);await s.check(client,{n:50,b:50,r:-90});
  const issued=await s.db('invoice_issues').where({customer_id:client.id}).first();const files=await s.files(issued.artifact_key);const pdf=Object.entries(files).find(([name])=>name.endsWith('.pdf'))[1];expect(s.pdf(pdf)).to.include('END OF REASON');
  require('fs').writeFileSync(require('path').join(__dirname,'../../docs/decisions/evidence/run-2/invoice-retainer-long.pdf'),pdf);
 });

});
