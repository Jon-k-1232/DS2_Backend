'use strict';
const {Scenario,ok,expect,money,today}=require('./_scenario');
const service=require('../../src/endpoints/duplicates/duplicates-service');
describe('owner decision 4: visible duplicate review and guarded removal',function(){
 this.timeout(180000); const s=new Scenario();let c,job,original,copy,flag,invoice,pay,writeoff,retainer;
 const list=async(all=false)=>ok(await s.get(`/duplicates/1/999?${all?'status=all&':''}customerId=${c.id}`)).duplicates;
 const flagBody=more=>({kind:'transaction',recordId:copy.transaction_id,canonicalId:original.transaction_id,reason:'Review duplicate entry',...more});
 const resolve=(f,action,more={})=>s.post(`/duplicates/${f.duplicate_id}/resolve/1/999`,{action,reason:'Confirmed by operator',...more});
 const find=async(kind,id)=>{const rows=await list();const row=rows.find(f=>f.kind===kind&&f.record_id===id);expect(row,`${kind} ${id}`).to.exist;return row;};
 before(async()=>{await s.boot();});after(()=>s.close());
 it('flags matching manual work on creation; badge data and actor are visible without changing balances',async()=>{
  c=await s.customer('Duplicate review');job=await s.job(c);original=await s.work(c,job,100);copy=await s.work(c,job,100);
  flag=await find('transaction',copy.transaction_id);expect(flag.detected_by).to.equal(1);expect(flag.history[0].actor_id).to.equal(1);expect(flag.history[0].reason).to.not.equal('');
  const read=ok(await s.get(`/transactions/getSingleTransaction/${c.id}/${copy.transaction_id}/1/1`));expect(read.activeTransactionsData.transactionData[0].possible_duplicate).to.equal(true);
  await s.check(c,{n:200,b:0});await s.family(job,200);
 });
 it('dismisses without ledger changes and a review scan does not reopen the pair',async()=>{
  const before=await s.db('customer_transactions').where({customer_id:c.id});ok(await resolve(flag,'dismiss'));
  expect(await s.db('customer_transactions').where({customer_id:c.id})).to.deep.equal(before);
  expect(ok(await s.post('/duplicates/scan/1/1',{customerId:c.id,reason:'Rescan after dismissal'})).created).to.equal(0);
  expect(await list()).to.have.length(0);expect((await list(true))[0].status).to.equal('dismissed');await s.check(c,{n:200,b:0});
  await s.reject(()=>resolve(flag,'dismiss'),/resolved/,null,null,409);
  await s.reject(()=>s.post('/duplicates/1/1',flagBody({recordId:original.transaction_id,canonicalId:copy.transaction_id})),/already/,null,null,409);
 });
 it('manually flags an unpaired entry and removes it through the work deletion core: $200 -> $100',async()=>{
  flag=ok(await s.post('/duplicates/1/999',flagBody({canonicalId:undefined}))).duplicate;
  ok(await resolve(flag,'remove'));await s.check(c,{n:100,b:0});await s.family(job,100);
  expect(await s.db('customer_transactions').where({transaction_id:copy.transaction_id}).first()).to.equal(undefined);
  const h=await s.db('duplicate_history').where({duplicate_id:flag.duplicate_id,action:'remove'}).first();expect(h.actor_id).to.equal(1);expect(h.before_value.ledger.customer_transactions).to.have.length(2);expect(h.after_value.ledger.customer_transactions).to.have.length(1);
  await s.reject(()=>resolve(flag,'remove'),/resolved/,null,null,409);
 });
 it('detects and removes duplicate payments atomically: $1000 - $100 - $100 -> $900',async()=>{
  await s.work(c,job,900,{detailedJobDescription:'Other work'});
  invoice=await s.statement(c,await s.finalize([c]),1,[0,1000,0,0,0,1000]);
  await s.pay(c,100,{selectedInvoiceID:invoice.customer_invoice_id,paymentReferenceNumber:'DUP-CHECK'});
  pay=(await s.pay(c,100,{selectedInvoiceID:invoice.customer_invoice_id,paymentReferenceNumber:' dup-check '})).row;
  const f=await find('payment',pay.payment_id);await s.check(c,{n:800,b:800});ok(await resolve(f,'remove'));await s.check(c,{n:900,b:900});
  expect(money((await s.db('customer_invoices').where({customer_invoice_id:invoice.customer_invoice_id}).first()).total_amount_due)).to.equal(1000);
 });
 it('detects/removes duplicate writeoffs and retainers without double counting available credit',async()=>{
  await s.writeoff(c,20);writeoff=await s.writeoff(c,20);await s.check(c,{n:860,b:900});
  ok(await resolve(await find('writeoff',writeoff.writeoff_id),'remove'));await s.check(c,{n:880,b:900});
  await s.retainer(c,200,{paymentReferenceNumber:'RETAIN-01'});retainer=await s.retainer(c,200,{paymentReferenceNumber:'retain-01'});
  await s.check(c,{n:880,b:900,r:-400});ok(await resolve(await find('retainer',retainer.retainer_id),'remove'));await s.check(c,{n:880,b:900,r:-200});
 });
 it('scans existing matching entries, supports idempotent concurrent scans and resolves all pairs for a removed source',async()=>{
  const {addNewTransaction}=require('../../src/endpoints/transactions/sharedTransactionFunctions');
  const rows=[await addNewTransaction(s.db,s.transaction(c,job,100)),await addNewTransaction(s.db,s.transaction(c,job,100))];
  const scans=await Promise.all([s.post('/duplicates/scan/1/1',{customerId:c.id,reason:'Review historical entries'}),s.post('/duplicates/scan/1/1',{customerId:c.id,reason:'Concurrent review'})]);
  expect(scans.every(r=>r.status===200)).to.equal(true);expect(scans.reduce((n,r)=>n+r.body.created,0)).to.equal(3);
  const flags=await list();const f=flags.find(r=>r.record_id===rows[1].transaction_id);ok(await resolve(f,'remove'));
  const related=(await list()).filter(f=>f.record_id===rows[1].transaction_id || f.canonical_id===rows[1].transaction_id);expect(related).to.have.length(0);
  ok(await resolve((await list()).find(f=>f.record_id===rows[0].transaction_id),'remove'));
  await s.family(job,1000);await s.check(c,{n:880,b:900,r:-200});
 });
 it('locks sent duplicates, preserves original rows, and still permits not-a-duplicate dismissal',async()=>{
  const f=ok(await s.post('/duplicates/1/1',{kind:'transaction',recordId:original.transaction_id,reason:'Review a sent entry'})).duplicate;
  const open=(await list()).find(r=>r.duplicate_id===f.duplicate_id);expect(open.locked_invoice_id).to.equal(invoice.customer_invoice_id);
  await s.reject(()=>resolve(f,'remove'),/locked/,null,null,409);ok(await resolve(f,'dismiss'));
 });
 it('refuses a retainer with draws and a payment with a later balance event without partial writes',async()=>{
  const root=await s.retainer(c,40,{displayName:'Dependency fixture'});await s.work(c,job,10,{selectedRetainerID:root.retainer_id});
  const f=ok(await s.post('/duplicates/1/1',{kind:'retainer',recordId:root.retainer_id,reason:'Cannot remove drawn funds'})).duplicate;
  await s.reject(()=>resolve(f,'remove'),/drawn/,null,null,409);
  const p=(await s.pay(c,10,{selectedInvoiceID:invoice.customer_invoice_id,paymentReferenceNumber:'ORDER-A'})).row;
  await s.pay(c,10,{selectedInvoiceID:invoice.customer_invoice_id,paymentReferenceNumber:'ORDER-B'});
  const fp=ok(await s.post('/duplicates/1/1',{kind:'payment',recordId:p.payment_id,reason:'Earlier payment'})).duplicate;
  await s.reject(()=>resolve(fp,'remove'),/newer/,null,null,409);
 });
 for(const [title,patch,status] of [['kind',{kind:'invoice'},400],['ID',{recordId:'bad'},400],['canonical ID',{canonicalId:0},400],['self',{recordId:1,canonicalId:1},400],['reason',{reason:''},400],['missing',{recordId:999999},404],['missing canonical',{recordId:original?.transaction_id,canonicalId:999999},404]]) {
  it(`validates manual flag ${title} with no writes`,async()=>s.reject(()=>s.post('/duplicates/1/1',flagBody({...patch,...(title==='missing canonical'?{recordId:original.transaction_id}:{})})),null,null,null,status));
 }
 it('validates scan/list/filter/action and checks missing records',async()=>{
  const calls=[()=>s.post('/duplicates/scan/1/1',{}),()=>s.post('/duplicates/scan/1/1',{reason:'scan',customerId:'bad'}),()=>s.get('/duplicates/1/1?status=bad'),()=>s.get('/duplicates/1/1?customerId=bad'),()=>resolve(flag,'delete'),()=>resolve(flag,'dismiss',{reason:''})];
  for(const call of calls)await s.reject(call,null,null,null,400);
  for(const call of [()=>s.post('/duplicates/scan/1/1',{reason:'scan',customerId:999999}),()=>s.get('/duplicates/1/1?customerId=999999'),()=>resolve({duplicate_id:999999},'remove')])await s.reject(call,null,null,null,404);
 });
 it('enforces authentication, roles and tenancy on every new route',async()=>{
  await s.foreignFixture();
  for(const [method,path,b] of [['get','/duplicates/1/1'],['post','/duplicates/1/1',flagBody()],['post','/duplicates/scan/1/1',{reason:'scan'}],['post',`/duplicates/${flag.duplicate_id}/resolve/1/1`,{action:'dismiss',reason:'no'}]]) {
   for(const [role,status] of [[null,401],['staff',403],['foreign',403]])await s.reject(()=>s.req(method,path,b,role),null,null,null,status);
  }
  await s.reject(()=>s.post('/duplicates/1/1',flagBody({recordId:70001})),null,null,null,404);
  const other=await s.customer('Other customer');const j=await s.job(other);const work=await s.work(other,j,100);
  await s.reject(()=>s.post('/duplicates/1/1',flagBody({recordId:original.transaction_id,canonicalId:work.transaction_id})),/same customer/,null,null,400);
 });
 it('refuses stale source reviews and missing sources without deleting changed money',async()=>{
  const work=await s.work(c,job,12,{detailedJobDescription:'Stale review fixture'});
  const f=ok(await s.post('/duplicates/1/1',{kind:'transaction',recordId:work.transaction_id,reason:'Check source'})).duplicate;
  ok(await s.editWork(work,{unitCost:13,totalTransaction:13}));
  await s.reject(()=>resolve(f,'remove'),/changed since/,null,null,409);
  ok(await s.deleteWork(work));await s.reject(()=>resolve(f,'remove'),/not found/,null,null,404);ok(await resolve(f,'dismiss'));
 });
 it('allows an explicit fresh review of a changed dismissed source, preserving prior evidence',async()=>{
  const work=await s.work(c,job,12,{detailedJobDescription:'Changed and reviewed fixture'});
  const b={kind:'transaction',recordId:work.transaction_id,reason:'First review'};
  const f=ok(await s.post('/duplicates/1/1',b)).duplicate;
  ok(await s.editWork(work,{unitCost:13,totalTransaction:13}));
  await s.reject(()=>resolve(f,'remove'),/changed since/,null,null,409);ok(await resolve(f,'dismiss'));
  const history=await s.db('duplicate_history').where({duplicate_id:f.duplicate_id}).orderBy('history_id');
  for(const fault of ['dbFailure','suppressWrite'])for(const [table,op] of [['duplicate_flags','UPDATE'],['duplicate_history','INSERT']])await s[fault](table,op,()=>s.reject(()=>s.post('/duplicates/1/1',{...b,reason:'Fresh review after edit'}),/failed/,null,null,500));
  const reopened=ok(await s.post('/duplicates/1/1',{...b,reason:'Fresh review after edit'})).duplicate;
  expect(reopened.duplicate_id).to.equal(f.duplicate_id);expect(reopened.status).to.equal('open');expect(reopened.record_snapshot.total_transaction).to.equal('13.00');
  expect((await s.db('duplicate_history').where({duplicate_id:f.duplicate_id}).orderBy('history_id')).slice(0,history.length)).to.deep.equal(history);
  ok(await resolve(reopened,'remove'));expect(await s.db('customer_transactions').where({transaction_id:work.transaction_id}).first()).to.equal(undefined);
 });
 it('rejects retainer snapshot flags, malformed resolution IDs and suppressed resolution writes',async()=>{
  const child=await s.db('customer_retainers_and_prepayments').where({customer_id:c.id}).whereNotNull('parent_retainer_id').first();
  for(const b of [{recordId:child.retainer_id},{recordId:child.parent_retainer_id,canonicalId:child.retainer_id}])await s.reject(()=>s.post('/duplicates/1/1',{kind:'retainer',reason:'Review source receipt',...b}),/original retainer/,null,null,400);
  await s.reject(()=>resolve({duplicate_id:'bad'},'dismiss'),null,null,null,400);
  const work=await s.work(c,job,2,{detailedJobDescription:'Suppressed resolution'});
  const f=ok(await s.post('/duplicates/1/1',{kind:'transaction',recordId:work.transaction_id,reason:'Review'})).duplicate;
  for(const action of ['dismiss','remove']) await s.suppressWrite('duplicate_flags','UPDATE',()=>s.reject(()=>resolve(f,action),/failed/,null,null,500));
  ok(await resolve(f,'remove'));
 });
 it('rolls back flag, scan, dismissal and removal when evidence cannot be saved',async()=>{
  copy=await s.work(c,job,17,{detailedJobDescription:'Fault fixture'});
  await s.dbFailure('duplicate_flags','INSERT',()=>s.reject(()=>s.post('/duplicates/1/1',flagBody({canonicalId:undefined})),/failed/,null,null,500));
  await s.dbFailure('duplicate_history','INSERT',()=>s.reject(()=>s.post('/duplicates/1/1',flagBody({canonicalId:undefined})),/failed/,null,null,500));
  await s.dbFailure('duplicate_history','INSERT',()=>s.reject(()=>s.post('/duplicates/scan/1/1',{reason:'fault scan',customerId:c.id}),/failed/,null,null,500));
  for(const table of ['duplicate_flags','duplicate_history']) await s.suppressWrite(table,'INSERT',()=>s.reject(()=>s.post('/duplicates/1/1',flagBody({canonicalId:undefined})),/failed/,null,null,500));
  flag=ok(await s.post('/duplicates/1/1',flagBody({canonicalId:undefined}))).duplicate;
  for(const action of ['dismiss','remove']) for(const [table,operation] of [['duplicate_history','INSERT'],['duplicate_flags','UPDATE']])await s.dbFailure(table,operation,()=>s.reject(()=>resolve(flag,action),/failed/,null,null,500));
  await s.dbFailure('customer_transactions','DELETE',()=>s.reject(()=>resolve(flag,'remove'),/failed/,null,null,500));
  ok(await resolve(flag,'remove'));
 });
 it('rolls back each manual create route when automatic duplicate evidence fails',async()=>{
  const retain=await s.retainer(c,19,{displayName:'Atomic receipt'});
  const wo=await s.writeoff(c,3,{writeoffReason:'Atomic credit'});
  const work=await s.work(c,job,23,{detailedJobDescription:'Atomic work'});
  await s.pay(c,7,{selectedInvoiceID:invoice.customer_invoice_id,paymentReferenceNumber:'ATOMIC-RECEIPT'});
  const calls=[()=>s.post('/transactions/createTransaction/1/1',{transaction:work.payload}),()=>s.post('/payments/createPayment/1/1',{payment:s.payment(c,7,{selectedInvoiceID:invoice.customer_invoice_id,paymentReferenceNumber:'ATOMIC-RECEIPT'})}),()=>s.post('/writeOffs/createWriteOffs/1/1',{writeOff:s.credit(c,3,{writeoffReason:'Atomic credit'})}),()=>s.post('/retainers/createRetainer/1/1',{retainer:{customerID:c.id,unitCost:19,typeOfHold:'Retainer',displayName:'Atomic receipt'}})];
  for(const call of calls)await s.dbFailure('duplicate_history','INSERT',()=>s.reject(call,/failure|failed/,null,null,500));
 });
 it('reports read failures with no writes and rejects changed duplicate history',async()=>{
  const real=service.list;service.list=async()=>{throw Error('database unavailable');};
  try{await s.reject(()=>s.get('/duplicates/1/1'),/failed/,null,null,500);}finally{service.list=real;}
  const h=await s.db('duplicate_history').first();const before=await s.state();let err;
  try{await s.db('duplicate_history').where({history_id:h.history_id}).update({reason:'rewrite'});}catch(e){err=e;}
  expect(err?.code).to.equal('P0409');expect(await s.state()).to.deep.equal(before);
 });
});
