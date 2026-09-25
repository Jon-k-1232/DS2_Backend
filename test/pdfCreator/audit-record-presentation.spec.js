'use strict';
const p=require('../../src/endpoints/auditRecord/audit-record-presentation');
const event=(entity,action,before,after,extra={})=>({event_id:'1',entity,entity_id:'1',action,actor_name:'Ada at posting',occurred_at:'2026-03-03T07:00:00Z',
 before_value:before,after_value:after,changes:Object.fromEntries([...new Set([...Object.keys(before || {}),...Object.keys(after || {})])].filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k])).map(k=>[k,{before:before?.[k]??null,after:after?.[k]??null}])),...extra});
const view=events=>p.present([{id:1,events,occurred_at:'2026-03-03T07:00:00Z',running_balance:-1234.56,retainer_available:45}])[0].presentation;
describe('audit record business presentation',()=>{
 it('uses one USD convention with signed credit balances and positive credit columns',()=>{
  expect(p.formatted('generated_by',2)).to.equal('2');expect(p.formatted('total_minutes',120)).to.equal('120');expect(p.formatted('unit_cost',100)).to.equal('$100.00');
  expect(p.money(-1234.56)).to.equal('-$1,234.56');expect(p.money(1234.56)).to.equal('$1,234.56');
  const result=view([event('customer_payments','insert',null,{payment_amount:-30,form_of_payment:'Check',payment_reference_number:'1234'},{credit:30})]);
  expect(result.description).to.equal('Payment received - Check #1234');expect(result.credit).to.equal('$30.00');expect(result.balance).to.equal('-$1,234.56');expect(result.actors).to.deep.equal(['Ada at posting']);
 });
 it('groups funded work and its retainer draw without leaking internal table names',()=>{
  const result=view([event('customer_transactions','insert',null,{quantity:1.2,unit_cost:100,transaction_type:'Time',transaction_date:'2026-03-03',detailed_work_description:'Tax preparation'}),event('customer_payments','insert',null,{payment_amount:-120,retainer_id:8})]);
  expect(result.description).to.equal('Work - Client work: 1.2 h x $100.00; Retainer applied - $120.00');
  expect(result.changes[0].label).to.include('Tax preparation work on Mar 3, 2026');
 });
 it('uses historical reference names rather than later staff renames',()=>{
  const entries=[1,3].map(id=>({id,events:[event('customer_transactions','insert',null,{logged_for_user_id:7,quantity:1,unit_cost:50},{event_id:String(id)})]}));
  const results=p.present(entries,{current:{'user:7':'Later name'},changes:[{event_id:'2',key:'user:7',before:'Original name',after:'Later name'}]});
  expect(results[0].presentation.description).to.include('Original name');expect(results[1].presentation.description).to.include('Later name');
 });
 it('renders creation, deletion, no-op and update fields once and accounts for every omitted field',()=>{
  for(const e of [event('customer_transactions','insert',null,{total_transaction:100,note:'Courtesy',transaction_id:9,created_at:'2026-03-03',payload:{secret:1}}),
   event('customer_transactions','delete',{total_transaction:100},null,{reason:'Duplicate removed'}),event('customer_transactions','update',{total_transaction:100},{total_transaction:120}),event('customers','update',{display_name:'Same'},{display_name:'Same'})]){
   const result=view([e]).changes[0];
   expect([...result.coverage.shown,...result.coverage.omitted].sort()).to.deep.equal(Object.keys(e.changes).sort());
   expect(result.fields.map(f=>f.text).join(' ')).not.to.include('transaction_id');
   if(e.action==='delete'){expect(result.operation).to.equal('Removed');expect(result.reason).to.equal('Duplicate removed');expect(result.fields[0].text).to.equal('Charge: $100.00');}
   if(e.before_value?.total_transaction===100 && e.after_value?.total_transaction===120)expect(result.fields[0].text).to.equal('Charge: $100.00 -> $120.00');
  }
 });
 it('describes finalize, refund, bounced reversal and duplicate removal as business events',()=>{
  const cases=[['invoice_issues',{invoice_number:'INV-5'},'Invoice INV-5 finalized (sent and locked) - amount due $100.00',{invoice_total:100}],
   ['retainer_events',{kind:'refund',amount:10,method:'Check',reference:'88',reason:'Returned funds'},'Retainer refund - $10.00, Check #88, Returned funds',{}],
   ['customer_payments',{payment_amount:30,invoice_number:'INV-5'},'Bounced check reversal - payment of $30.00 on INV-5',{}],
   ['duplicate_flags',{status:'removed',resolution_reason:'Entered twice'},'Duplicate removed - Entered twice',{}]];
  for(const [table,row,expected,extra] of cases)expect(view([event(table,'insert',null,row,extra)]).description).to.equal(expected);
 });
 it('summarizes structured snapshots without JSON and gives reproducible UTF-8 descriptors',()=>{
  const e=event('invoice_statement_members','insert',null,{table_name:'customer_transactions',record_id:12,snapshot:{total_transaction:120,transaction_date:'2026-03-03'}});
  const result=view([e]).changes[0];expect(result.label).to.equal('Work on Mar 3, 2026 $120.00 (statement copy)');expect(result.summaries).to.include('Archived and locked.');
  const value={message:'é',nested:[1,2]};const d=p.descriptor(value);expect(d.byte_length).to.equal(Buffer.byteLength(JSON.stringify(value)));expect(d.sha256).to.equal(require('crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex'));
 });
 it('never drops unknown scalar business fields and keeps unknown technical fields in coverage',()=>{
  const result=view([event('customers','update',{preferred_delivery:'Mail',storage_key:'before'},{preferred_delivery:'Email',storage_key:'after'})]).changes[0];
  expect(result.fields[0].text).to.equal('Preferred delivery: Mail -> Email');expect(result.coverage.omitted).to.include('storage_key');
 });
 it('collapses all six archive kinds with exact change coverage and preserves itemized evidence',()=>{
  const kinds={customer_invoices:1,customer_transactions:2,customer_payments:1,customer_writeoffs:1,customer_retainers_and_prepayments:4,retainer_events:2};
  const events=[event('invoice_issues','insert',null,{invoice_id:7,invoice_number:'INV-2026-00001'})];
  for(const [table,count] of Object.entries(kinds))for(let i=0;i<count;i++)events.push(event('invoice_statement_members','insert',null,{account_id:1,invoice_id:7,table_name:table,snapshot:{amount:100}}, {event_id:String(events.length+1)}));
  const before=JSON.stringify(events),result=view(events),summary=result.client_changes[1];
  expect(JSON.stringify(events)).to.equal(before);expect(result.changes).to.have.lengthOf(12);expect(result.client_changes).to.have.lengthOf(2);
  expect(summary.item_counts).to.deep.equal(kinds);expect(summary.change_count).to.equal(11);
  expect(summary.text).to.equal('Invoice INV-2026-00001 finalized (sent and locked): 11 statement items archived - 1 invoice balance, 2 work items, 1 payment, 1 write-off, 4 retainer records, 2 retainer adjustments. Covers 11 captured changes (change numbers 2-12). Itemized in the full evidence record.');
  expect(summary.covered_event_ids).to.deep.equal(events.slice(1).map(e=>e.event_id));
  expect(result.changes.slice(1).every(c=>c.label.includes('(statement copy)'))).to.equal(true);
 });
 it('keeps invoices, revisions and postings separate, including noncontiguous change numbers',()=>{
  const member=(id,revision,eventId)=>event('invoice_statement_members','insert',null,{account_id:1,invoice_id:id,revision,table_name:'customer_payments',snapshot:{payment_amount:-10}},{event_id:eventId});
  const events=[event('invoice_issues','insert',null,{invoice_id:1,invoice_number:'INV-A'}),member(1,0,'2'),
   event('invoice_revisions','insert',null,{invoice_id:2,revision:1,invoice_number:'INV-B'},{event_id:'3'}),member(2,1,'4'),member(1,0,'5'),member(2,2,'6')];
  const entries=p.present([{events},{events:[member(1,3,'7')]}]);
  const groups=entries[0].presentation.client_changes.filter(c=>c.kind==='statement_archive');
  expect(groups).to.have.lengthOf(3);expect(groups.map(g=>g.covered_event_ids)).to.deep.equal([['2','5'],['4'],['6']]);
  expect(groups[0].text).to.include('change numbers 2, 5');expect(groups[1].text).to.include('revision 1 archived');expect(groups[2].text).to.include('revision 2 archived');
  expect(entries[1].presentation.client_changes[0].text).to.include('revision 3 archived');
  expect(p.coverage(entries)).to.include({changes:7,captured_changes:7,client_lines:6,archive_summaries:4,summarized_changes:5});
 });
 it('names reversal additions accurately and preserves every contributing actor and reason',()=>{
  const result=view([event('invoice_history','insert',null,{invoice_id:1,event:'exception_reversed',invoice_number:'INV-1'}),
   event('invoice_statement_members','insert',null,{invoice_id:1,table_name:'customer_payments',snapshot:{}},{event_id:'2',reason:'Bank returned check'}),
   event('invoice_statement_members','insert',null,{invoice_id:1,table_name:'customer_invoices',snapshot:{}},{event_id:'3',actor_name:'Bea Admin',reason:'Corrected balance'})]);
  const summary=result.client_changes[1];expect(summary.text).to.include('bounced check reversal archived (locked)');expect(summary.text).not.to.include('finalized');
  expect(summary.actor).to.equal('Ada at posting, Bea Admin');expect(summary.reason).to.equal('Bank returned check; Corrected balance');
  expect(result.client_changes.flatMap(c=>c.covered_event_ids)).to.deep.equal(['1','2','3']);
 });
 it('labels reconstructed, unknown and single-item archives without inventing an issuance',()=>{
  const e=event('invoice_statement_members','reconstructed',null,{invoice_id:8,table_name:'future_private_table',snapshot:{},future_business_value:'retained'},{reconstructed:true});
  const entries=p.present([{reconstructed:true,events:[e]}]),summary=entries[0].presentation.client_changes[0];
  expect(summary.text).to.include('Invoice (number not recorded) statement archive (reconstructed): 1 statement item archived - 1 other statement item. Covers 1 reconstructed change (change number 1).');
  expect(summary.text).not.to.include('future_private_table');expect(p.coverage(entries)).to.include({changes:1,captured_changes:0,reconstructed_changes:1,client_human_fields:0,client_supporting_fields:4});
 });
 it('retains unexpected archive updates, deletes and missing invoice identity as individual evidence',()=>{
  const before={invoice_id:1,table_name:'customer_payments',snapshot:{amount:1}},after={...before,snapshot:{amount:2}};
  const events=[event('invoice_statement_members','update',before,after),event('invoice_statement_members','delete',before,null,{event_id:'2'}),event('invoice_statement_members','insert',null,{table_name:'customer_invoices',snapshot:{}},{event_id:'3'})];
  const result=view(events);expect(result.client_changes).to.have.lengthOf(3);expect(result.client_changes.some(c=>c.kind==='statement_archive')).to.equal(false);
  expect(result.client_changes.flatMap(c=>c.covered_event_ids)).to.deep.equal(['1','2','3']);
 });
});
