'use strict';
const { Scenario, ok, expect, money } = require('./_scenario');
const { TABLE_KEYS } = require('../../src/endpoints/invoice/sentInvoiceLocks');
describe('owner decisions 3/5: immutable statements and bounced payment corrections', function () {
   this.timeout(180000);
   const s = new Scenario(); let c, job, work, original, receipt, issued, exception, originalPdf;
   const url = (tail = '') => `/invoices/${issued.customer_invoice_id}/${tail}/1/1`;
   const flag = body => s.post(url('exceptions'), body);
   const reverse = () => s.post(url(`exceptions/${exception.exception_id}/reverse`));
   const resolve = action => s.post(url(`exceptions/${exception.exception_id}/resolve`), { action });
   const history = async () => ok(await s.get(url('history')));
   before(async () => { await s.boot(); }); after(async () => { await s.close(); });
   it('issues $500, accepts a new $100 receipt without changing issued rows, then issues $400', async () => {
      c = await s.customer('Owner Sent'); job = await s.job(c); work = await s.work(c, job, 500);
      original = await s.statement(c, await s.finalize([c]), 1, [0,500,0,0,0,500]);
      const before = await s.db('customer_invoices').where({ customer_invoice_id: original.customer_invoice_id }).first();
      receipt = (await s.pay(c, 100, { selectedInvoiceID: original.customer_invoice_id })).row;
      await s.check(c, { n:400,b:400 });
      expect(await s.db('customer_invoices').where({ customer_invoice_id: original.customer_invoice_id }).first()).to.deep.equal(before);
      issued = await s.statement(c, await s.finalize([c], { allowSameDayRebill:true }), 2, [400,0,0,0,0,400], ['Total Payments Received: -100.00']);
      originalPdf = issued.pdf;
      const h = await history(); expect(h.sent_locked).to.equal(true); expect(h.revisions).to.have.length(1);
      expect(h.statementPayments.map(p=>p.payment_id)).to.include(receipt.payment_id);
   });
   it('refuses direct edits/deletes and cascade edits with HTTP 409 and no ledger writes', async () => {
      const requests = [
         () => s.put(`/billing-review/transaction/${work.transaction_id}/1/1`, { updates:{ note:'changed' } }),
         () => s.editWork(work, { unitCost:501, totalTransaction:501 }),
         () => s.del('/transactions/deleteTransaction/1/1', { transaction:{ transactionID:work.transaction_id, customerID:c.id } }),
         () => s.put('/payments/updatePayment/1/1', { payment:{ paymentID:receipt.payment_id, unitCost:110 } }),
         () => s.del('/payments/deletePayment/1/1', { payment:{ paymentID:receipt.payment_id } }),
         () => s.post('/payments/reversePayment/1/1', { payment:{ paymentID:receipt.payment_id, reason:'NSF without flag' } }),
         () => s.del(`/invoices/deleteInvoice/1/${issued.customer_invoice_id}`),
         () => s.del(`/customer/deleteCustomer/${c.id}/1/1`)
      ];
      for (const request of requests) await s.reject(request, /locked: part of sent invoice INV-/, c, { n:400,b:400 },409);
   });
   it('database defenses refuse raw import/upsert changes to every frozen row', async () => {
      const members = await s.db('invoice_statement_members').where({ invoice_id:issued.customer_invoice_id });
      for (const m of members) {
         const before = await s.state(); let err;
         try { await s.db(m.table_name).where({ [TABLE_KEYS[m.table_name]]:m.record_id }).update({ created_at:s.db.raw('created_at') }); } catch (e) { err=e; }
         expect(err?.code).to.equal('P0409'); expect(await s.state()).to.deep.equal(before);
      }
   });
   for (const [title,body] of [ ['condition',{condition:'anything',reason:'bank',paymentIds:[1]}],['reason',{condition:'bounced_check',reason:' ',paymentIds:[1]}],['ids',{condition:'bounced_check',reason:'bank',paymentIds:[]}],['duplicate ids',{condition:'bounced_check',reason:'bank',paymentIds:[1,1]}] ]) {
      it(`validates ${title} without writes`, async () => s.reject(()=>flag(body), /condition|reason|payment/i,c,{n:400,b:400},400));
   }
   it('rejects a missing/foreign payment without writes', async()=> s.reject(()=>flag({condition:'bounced_check',reason:'bank',paymentIds:[999999]}),/not on/,c,{n:400,b:400},404));
   it('flags only the chosen receipt, audits the actor and permits no ordinary mutation', async()=> {
      exception=ok(await flag({condition:'bounced_check',reason:'Check returned NSF',paymentIds:[receipt.payment_id]}));
      expect(exception.created_by).to.equal(1); expect(exception.state).to.equal('flagged');
      await s.reject(()=>flag({condition:'bounced_check',reason:'duplicate',paymentIds:[receipt.payment_id]}),/existing/,c,{n:400,b:400},409);
      await s.reject(()=>s.put('/payments/updatePayment/1/1',{payment:{paymentID:receipt.payment_id,unitCost:90}}),/locked/,c,{n:400,b:400},409);
      await s.reject(()=>resolve('revision'),/not permitted/,c,{n:400,b:400},409);
   });
   it('rolls back a failed reversal, including original evidence and exception state', async()=> {
      await s.dbFailure('customer_payments','INSERT',()=>s.reject(reverse,/failed|committed/,c,{n:400,b:400},500));
      expect((await history()).exceptions[0].state).to.equal('flagged');
   });
   it('reverses once to $500 with no original row changes', async()=> {
      const before=await s.db('customer_payments').where({payment_id:receipt.payment_id}).first();
      const result=ok(await reverse()); expect(result.before_balance).to.equal(400); expect(result.after_balance).to.equal(500);
      expect(await s.db('customer_payments').where({payment_id:receipt.payment_id}).first()).to.deep.equal(before);
      await s.check(c,{n:500,b:500});
      await s.reject(reverse,/not permitted/,c,{n:500,b:500},409);
      await s.reject(()=>resolve('cancel'),/not permitted/,c,{n:500,b:500},409);
      await s.reject(()=>resolve('oops'),/Invalid/,c,{n:500,b:500},400);
   });
   it('archives a marked $500 revision without overwriting the original PDF or reposting money', async()=> {
      const result=ok(await resolve('revision')); expect(result.state).to.equal('resolved_revision');
      const h=await history(); expect(h.revisions.map(r=>r.revision)).to.deep.equal([0,1]);
      expect(money(h.revisions[1].issued_amount)).to.equal(500);
      const files=await s.files(h.revisions[1].artifact_key); const pdf=files[Object.keys(files).find(k=>k.endsWith('.pdf'))];
      expect(Object.keys(files)).to.have.length(2);
      expect(files[Object.keys(files).find(k=>k.includes('_ORIGINAL_ARCHIVE'))].equals(originalPdf)).to.equal(true);
      const text=s.pdf(pdf); expect(text).to.include('REVISION 1'); expect(text).to.include('Revised issued amount due: $500.00');
      require('fs').writeFileSync('/tmp/ds2-owner-revision.pdf',pdf);
      const saved=await s.files(h.revisions[0].artifact_key); expect(saved[Object.keys(saved).find(k=>k.endsWith('.pdf'))].equals(originalPdf)).to.equal(true);
      await s.check(c,{n:500,b:500}); await s.reject(()=>resolve('revision'),/not permitted/,c,{n:500,b:500},409);
   });
   it('carries corrected $500 into the next statement once and re-locks its evidence',async()=> {
      await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),3,[500,0,0,0,0,500], ['Total Payments Received: 100.00']);
      expect((await history()).events.map(e=>e.event)).to.deep.equal(['issued','exception_flagged','exception_reversed','exception_resolved_revision']);
      await s.check(c,{n:500,b:500});
   });
});

describe('owner exception boundaries, authorization, faults and roll-forward',function(){
 this.timeout(180000); const s=new Scenario(); let c,j,p1,p2,i,ex;
 const url=t=>`/invoices/${i.customer_invoice_id}/${t}/1/1`;
 const body=()=>({condition:'bounced_check',reason:'Bank returned both checks',paymentIds:[p1.payment_id,p2.payment_id]});
 const flag=()=>s.post(url('exceptions'),body());
 const reverse=()=>s.post(url(`exceptions/${ex.exception_id}/reverse`));
 const resolve=a=>s.post(url(`exceptions/${ex.exception_id}/resolve`),{action:a});
 before(async()=>{
   await s.boot(); await s.foreignFixture(); c=await s.customer('Owner Boundaries'); j=await s.job(c); await s.work(c,j,100);
   const first=(await s.finalize([c])).committedInvoices[0];
   p1=(await s.pay(c,20,{selectedInvoiceID:first.customer_invoice_id})).row;
   p2=(await s.pay(c,30,{selectedInvoiceID:first.customer_invoice_id})).row;
   i=(await s.finalize([c],{allowSameDayRebill:true})).committedInvoices[0]; await s.check(c,{n:50,b:50});
 });
 after(async()=>s.close());
 for(const [method,tail] of [['get','history'],['post','exceptions'],['post','exceptions/1/reverse'],['post','exceptions/1/resolve']]) {
   for(const [role,status] of [[null,401],['staff',403],['foreign',403]]) it(`${method} ${tail} refuses ${role||'anonymous'} before writes`,async()=> {
      await s.reject(()=>s.req(method,url(tail),method==='post'?body():undefined,role),/denied|Unauthorized|Access|forbidden|permission|authentication/i,null,null,status);
   });
   it(`${tail} rejects malformed and missing invoice IDs`,async()=> {
      for(const [invoice,status] of [['oops',400],['2147483648',400],['999999',404]]) await s.reject(()=>s.req(method,`/invoices/${invoice}/${tail}/1/1`,method==='post'?{...body(),action:'cancel'}:undefined),/Invalid|not found/i,null,null,status);
   });
 }
 it('rejects tenant-local and cross-tenant exception lookup without disclosure',async()=> {
   await s.reject(()=>s.post(url('exceptions/999999/reverse')),/not found/,null,null,404);
   await s.reject(()=>s.get(`/invoices/${i.customer_invoice_id}/history/700/70001`,'foreign'),/not found/,null,null,404);
   await s.reject(()=>s.post(url('exceptions/not-an-id/reverse')),/Invalid/,null,null,400);
 });
 for(const value of [null,[],{}, {condition:'bounced_check',reason:42,paymentIds:[1]}, {condition:'bounced_check',reason:'NSF',paymentIds:[true]}, {condition:'bounced_check',reason:'NSF',paymentIds:[[1]]}, {condition:'bounced_check',reason:'NSF',paymentIds:[{toString:0}]}, {condition:'bounced_check',reason:'NSF',paymentIds:[0]}, {condition:'bounced_check',reason:'NSF',paymentIds:[2147483648]}, {condition:'bounced_check',reason:'NSF',paymentIds:Array(101).fill(1)}]) {
   it(`rejects invalid flag input ${JSON.stringify(value).slice(0,70)}`,async()=>s.reject(()=>s.post(url('exceptions'),value),/condition|reason|payment/i,null,null,400));
 }
 for(const table of ['invoice_exceptions','invoice_exception_payments','invoice_history']) it(`flag failure on ${table} rolls back everything`,async()=>{
    await s.dbFailure(table,'INSERT',()=>s.reject(flag,/failed/,null,null,500));
 });
 it('cancels a flag without changing money and prevents repeated cancellation',async()=>{
   ex=ok(await flag()); ok(await resolve('cancel')); await s.check(c,{n:50,b:50});
   await s.reject(()=>resolve('cancel'),/not permitted/,null,null,409);
 });
 it('serializes duplicate flags into exactly one active grant',async()=>{
   const results=await Promise.all([flag(),flag()]); expect(results.map(r=>r.status).sort()).to.deep.equal([200,409]);
   ex=results.find(r=>r.status===200).body; expect(await s.db('invoice_exceptions').where({state:'flagged'})).to.have.length(1);
 });
 for(const [table,event] of [['customer_invoices','INSERT'],['invoice_exception_payments','UPDATE'],['invoice_statement_members','INSERT'],['invoice_exceptions','UPDATE'],['invoice_history','INSERT']]) it(`reverse failure on ${table} rolls back the whole batch`,async()=>{
    await s.dbFailure(table,event,()=>s.reject(reverse,/failed/,null,null,500)); await s.check(c,{n:50,b:50});
 });
 it('reverses both receipts once under racing requests: $50 + $20 + $30 = $100',async()=>{
   const responses=await Promise.all([reverse(),reverse()]); expect(responses.map(r=>r.status).sort()).to.deep.equal([200,409]);
   await s.check(c,{n:100,b:100});
   const history=ok(await s.get(url('history'))); const rows=history.exceptions.find(e=>e.exception_id===ex.exception_id).payments;
   expect(rows.every(p=>p.reversal_id)).to.equal(true); expect(rows.map(p=>Number(p.amount))).to.deep.equal([20,30]);
 });
 it('storage failure leaves the reversal pending and no revision/history writes',async()=>{
   const {S3Client}=require('@aws-sdk/client-s3'); const send=S3Client.prototype.send;
   S3Client.prototype.send=async()=>{throw new Error('injected storage outage');};
   try { await s.reject(()=>resolve('revision'),/failed/,null,null,500); } finally { S3Client.prototype.send=send; }
 });
 for(const fault of ['upload','invalid archive']) it(`${fault} failure preserves the pending correction and original`,async()=>{
   const {S3Client}=require('@aws-sdk/client-s3');const send=S3Client.prototype.send;
   S3Client.prototype.send=function(command,...args){
     if(fault==='upload' && command.constructor.name==='PutObjectCommand')throw new Error('injected upload failure');
     if(fault==='invalid archive' && command.constructor.name==='GetObjectCommand')return Promise.resolve({Body:require('stream').Readable.from([Buffer.from('not a ZIP')])});
     return send.call(this,command,...args);
   };
   try{await s.reject(()=>resolve('revision'),/failed/,null,null,500);}finally{S3Client.prototype.send=send;}
 });
 it('refuses a foreign original artifact key before storage access, with no writes',async()=>{
   const {fixtureMaintenance}=require('./_sent-fixture');
   const original=await s.db('invoice_revisions').where({invoice_id:i.customer_invoice_id,revision:0}).first();
   await fixtureMaintenance(s.db,1,trx=>trx('invoice_revisions').where({invoice_id:i.customer_invoice_id,revision:0}).update({artifact_key:'Foreign_Account/invoicing/invoice_images/private.zip'}));
   try{await s.reject(()=>resolve('revision'),/unavailable for this account/,null,null,409);}
   finally{await fixtureMaintenance(s.db,1,trx=>trx('invoice_revisions').where({invoice_id:i.customer_invoice_id,revision:0}).update({artifact_key:original.artifact_key}));}
 });
 for(const table of ['invoice_revisions','invoice_exceptions','invoice_history']) it(`revision failure on ${table} leaves original evidence and state intact`,async()=>{
   await s.dbFailure(table,table==='invoice_exceptions'?'UPDATE':'INSERT',()=>s.reject(()=>resolve('revision'),/failed/,null,null,500));
 });
 it('requires roll-forward after the affected statement was absorbed',async()=>{
   await s.work(c,j,25); await s.check(c,{n:125,b:100});
   await s.finalize([c],{allowSameDayRebill:true}); await s.check(c,{n:125,b:125});
   await s.reject(()=>resolve('revision'),/rolled forward/,null,null,409);
   await s.dbFailure('invoice_history','INSERT',()=>s.reject(()=>resolve('roll_forward'),/failed/,null,null,500));
   expect(ok(await resolve('roll_forward')).state).to.equal('resolved_roll_forward');
   await s.check(c,{n:125,b:125});
   await s.reject(()=>resolve('roll_forward'),/not permitted/,null,null,409);
 });
 it('read database failure makes no writes',async()=>{
   const app=require('../../src/app'); const db=app.get('db'); const failed=table=>{ if(table==='invoice_history') throw new Error('injected read outage'); return db(table); };
   failed.raw=db.raw.bind(db); app.set('db',failed);
   try { await s.reject(()=>s.get(url('history')),/failed/,null,null,500); } finally { app.set('db',db); }
 });
});

describe('sent ledger surface coverage and overpayment correction', function () {
 this.timeout(180000); const s=new Scenario(); let c,j,hold,work,credit,issued,funded;
 const url=(invoice,tail)=>`/invoices/${invoice.customer_invoice_id}/${tail}/1/1`;
 const flag=(invoice,ids)=>s.post(url(invoice,'exceptions'),{condition:'bounced_check',reason:'Bank returned receipt',paymentIds:ids});
 before(async()=>{
   await s.boot(); c=await s.customer('Sent all surfaces'); j=await s.job(c); hold=await s.retainer(c,80);
   await s.work(c,j,30,{selectedRetainerID:hold.retainer_id}); work=await s.work(c,j,100); credit=await s.writeoff(c,20,{selectedJobID:j.customer_job_id});
   funded=await s.db('customer_payments').where({customer_id:c.id}).first();
   issued=(await s.finalize([c])).committedInvoices[0]; await s.check(c,{n:80,b:80,r:-50});
 });
 after(async()=>s.close());
 it('locks retainer root/draws, printed credits, job deletion and reassignment without writes',async()=>{
   const other=await s.customer('Destination for refused job');
   const retainers=await s.db('customer_retainers_and_prepayments').where({customer_id:c.id});
   const actions=[
    ()=>s.put('/writeOffs/updateWriteOffs/1/1',{writeOff:{writeoffID:credit.writeoff_id,unitCost:10}}),
    ()=>s.del('/writeOffs/deleteWriteOffs/1/1',{writeOff:{writeoffID:credit.writeoff_id}}),
    ()=>s.del(`/jobs/deleteJob/${j.customer_job_id}/1/1`),
    ()=>s.put('/jobs/updateJob/1/1',{job:s.jobBody(other,1,{customerJobID:j.customer_job_id})}),
    ...retainers.flatMap(r=>[()=>s.put('/retainers/updateRetainer/1/1',{retainer:{retainerID:r.retainer_id,unitCost:90}}),()=>s.del(`/retainers/deleteRetainer/${r.retainer_id}/1/1`)])
   ];
   for(const action of actions) await s.reject(action,/locked: part of sent invoice/,c,{n:80,b:80,r:-50},409);
 });
 it('marks locked rows and exposes the owning invoice on reads',async()=>{
   const detail=ok(await s.get(`/transactions/getSingleTransaction/${c.id}/${work.transaction_id}/1/1`));
   const rows=[]; const walk=x=>{if(x && typeof x==='object'){if(x.transaction_id===work.transaction_id) rows.push(x);Object.values(x).forEach(walk);}};walk(detail);
   expect(rows.length).to.be.greaterThan(0); rows.forEach(r=>{expect(r.sent_locked).to.equal(true);expect(r.locked_invoice_id).to.equal(issued.customer_invoice_id);});
 });
 it('refuses import-style raw updates, deletes and new links to an issued statement',async()=>{
   const members=await s.db('invoice_statement_members').where({invoice_id:issued.customer_invoice_id});
   for(const m of members) for(const action of [()=>s.db(m.table_name).where({[TABLE_KEYS[m.table_name]]:m.record_id}).update({created_at:s.db.raw('created_at')}),()=>s.db(m.table_name).where({[TABLE_KEYS[m.table_name]]:m.record_id}).del()]){
    const before=await s.state();let error;try{await action();}catch(e){error=e;}
    expect(error?.code,`${m.table_name} ${m.record_id}`).to.equal('P0409');expect(await s.state()).to.deep.equal(before);
   }
   const row=await s.db('customer_payments').where({payment_id:funded.payment_id}).first();delete row.payment_id;
   row.customer_invoice_id=issued.customer_invoice_id;row.created_at=s.db.fn.now();
   const before=await s.state();let error;try{await s.db('customer_payments').insert(row);}catch(e){error=e;}
   expect(error?.code).to.equal('P0409');expect(await s.state()).to.deep.equal(before);
 });
 it('refuses retainer-funded receipt exceptions',async()=>s.reject(()=>flag(issued,[funded.payment_id]),/cannot be reversed/,c,{n:80,b:80,r:-50},409));
 it('allows new funded work and credits without rewriting a sent statement',async()=>{
   const before=await s.db('invoice_statement_members').where({invoice_id:issued.customer_invoice_id}).orderBy(['table_name','record_id']);
   await s.work(c,j,10,{selectedRetainerID:hold.retainer_id}); await s.check(c,{n:80,b:80,r:-40,charges:10,payments:-10,unlinked:[1,10]});
   await s.writeoff(c,5,{customerInvoiceID:issued.customer_invoice_id});await s.check(c,{n:75,b:75,r:-40,unlinked:[1,10]});
   expect(await s.db('invoice_statement_members').where({invoice_id:issued.customer_invoice_id}).orderBy(['table_name','record_id'])).to.deep.equal(before);
 });
 it('pending approval against a sent invoice posts only a fresh snapshot, with atomic failure and retry',async()=>{
   const [pending]=await s.db('customer_payments_processed').insert({account_id:1,customer_id:c.id,matched_customer_id:c.id,customer_name:c.name,payment_amount:20,payment_reference_number:'NEW-CHECK',payment_date:new Date(),form_of_payment:'Check',source_file:'synthetic.pdf'}).returning('*');
   const parent=await s.db('customer_invoices').where({customer_invoice_id:issued.customer_invoice_id}).first();
   const request=()=>s.post('/pending-payments/approve/1/1',{pendingPaymentId:pending.payment_id,payment:s.payment(c,20,{selectedInvoiceID:issued.customer_invoice_id})});
   await s.dbFailure('customer_payments','INSERT',()=>s.reject(request,/scenario|error/i,c,{n:75,b:75,r:-40,unlinked:[1,10]},500));
   expect(await s.db('customer_payments_processed').where({payment_id:pending.payment_id}).first()).to.deep.equal(pending);
   const posted=ok(await request()); expect(posted.payment.customer_invoice_id).not.to.equal(issued.customer_invoice_id);
   expect(await s.db('customer_invoices').where({customer_invoice_id:issued.customer_invoice_id}).first()).to.deep.equal(parent);
   await s.check(c,{n:55,b:55,r:-40,unlinked:[1,10]});
 });
 it('unissued parents and child snapshots cannot open an exception',async()=>{
   const parent=await s.db('customer_invoices').where({customer_invoice_id:issued.customer_invoice_id}).first();
   const other=await s.customer('Unissued exception target'); delete parent.customer_invoice_id;
   const [unissued]=await s.db('customer_invoices').insert({...parent,customer_id:other.id,customer_info_id:other.info.customer_info_id,invoice_file_location:null,created_at:s.db.fn.now(),invoice_number:'UNISSUED'}).returning('*');
   await s.reject(()=>flag(unissued,[funded.payment_id]),/not been sent/,null,null,409);
   const child=await s.db('customer_invoices').where({parent_invoice_id:issued.customer_invoice_id}).first();
   await s.reject(()=>flag(child,[funded.payment_id]),/parent statement/,null,null,409);
   expect(ok(await s.get(url(unissued,'history'))).sent_locked).to.equal(false);
 });
 it('reverses a $150 bounced check as $100 restored debt plus $50 cancelled credit, then issues a $100 revision',async()=>{
   const over=await s.customer('Bounced excess'),oj=await s.job(over);await s.work(over,oj,100);
   const first=(await s.finalize([over])).committedInvoices[0];const paid=(await s.pay(over,150,{selectedInvoiceID:first.customer_invoice_id,captureOverpayment:true})).row;
   await s.check(over,{n:0,b:0,r:-50});
   await s.shift(1);
   const bill=(await s.finalize([over],{allowSameDayRebill:true})).committedInvoices[0];
   const pre=await s.db('customer_retainers_and_prepayments').where({customer_id:over.id}).first();
   const ex=ok(await flag(bill,[paid.payment_id]));
   await s.dbFailure('customer_retainers_and_prepayments','INSERT',()=>s.reject(()=>s.post(url(bill,`exceptions/${ex.exception_id}/reverse`)),/failed/,over,{n:0,b:0,r:-50},500));
   const correction=ok(await s.post(url(bill,`exceptions/${ex.exception_id}/reverse`)));
   expect(correction.retainer_cancellations).to.have.length(1);expect(correction.retainer_cancellations[0].amount).to.equal(50);
   expect(await s.db('customer_retainers_and_prepayments').where({retainer_id:pre.retainer_id}).first()).to.deep.equal(pre);
   await s.check(over,{n:100,b:100,r:0});
   await s.reject(()=>s.del(`/retainers/deleteRetainer/${correction.retainer_cancellations[0].correction_retainer_id}/1/1`),/locked/,null,null,409);
   const revision=ok(await s.post(url(bill,`exceptions/${ex.exception_id}/resolve`),{action:'revision'}));expect(revision.issued_amount).to.equal(100);
   const files=await s.files(revision.artifact_key);const text=s.pdf(files[Object.keys(files).find(k=>k.endsWith('.pdf'))]);
   expect(text).to.include('Overpayment credit cancelled: $50.00');expect(text).to.include('Revised issued amount due: $100.00');
   await s.reject(()=>flag(bill,[paid.payment_id]),/cannot be reversed/,null,null,409);
   await s.reject(()=>flag(bill,[correction.reversal_ids[0]]),/cannot be reversed/,null,null,409);
 });
 it('refuses reversal of a bounced overpayment whose excess has already funded work, with no partial correction',async()=>{
   const over=await s.customer('Bounced used excess'),oj=await s.job(over);await s.work(over,oj,100);
   const first=(await s.finalize([over])).committedInvoices[0];const paid=(await s.pay(over,150,{selectedInvoiceID:first.customer_invoice_id,captureOverpayment:true})).row;
   const pre=await s.db('customer_retainers_and_prepayments').where({customer_id:over.id}).first();
   await s.work(over,oj,10,{selectedRetainerID:pre.retainer_id});
   await s.shift(1);
   const bill=(await s.finalize([over],{allowSameDayRebill:true})).committedInvoices[0];const ex=ok(await flag(bill,[paid.payment_id]));
   await s.reject(()=>s.post(url(bill,`exceptions/${ex.exception_id}/reverse`)),/already been used/,over,{n:0,b:0,r:-40},409);
 });
 it('locks historical artifacts without a backfill and audits first exception hydration',async()=>{
   const legacy=await s.customer('Historical issued artifact'),lj=await s.job(legacy);await s.work(legacy,lj,100);
   const first=(await s.finalize([legacy])).committedInvoices[0];const paid=(await s.pay(legacy,20,{selectedInvoiceID:first.customer_invoice_id})).row;
   await s.shift(1);const last=(await s.finalize([legacy],{allowSameDayRebill:true})).committedInvoices[0];
   const parents=await s.db('customer_invoices').where({customer_id:legacy.id}).whereNull('parent_invoice_id');
   const {unseal,fixtureMaintenance}=require('./_sent-fixture');await unseal(s.db,1,[legacy.id]);
   await fixtureMaintenance(s.db,1,async trx=>{
      for(const table of Object.keys(TABLE_KEYS))await trx(table).where({account_id:1,customer_id:legacy.id}).update({created_at:trx.raw("created_at - interval '2 days'")});
      for(const parent of parents)await trx('customer_invoices').where({customer_invoice_id:parent.customer_invoice_id}).update({invoice_file_location:parent.invoice_file_location});
   });
   const before=await s.state();const history=ok(await s.get(url(last,'history')));
   expect(history.sent_locked).to.equal(true);expect(history.issue).to.equal(undefined);expect(history.revisions).to.have.length(1);
   expect(await s.state()).to.deep.equal(before);
   await s.reject(()=>s.put('/payments/updatePayment/1/1',{payment:{paymentID:paid.payment_id,unitCost:15}}),/locked/,null,null,409);
   const ex=ok(await flag(last,[paid.payment_id]));const archived=ok(await s.get(url(last,'history')));
   expect(archived.issue.payload.legacy).to.equal(true);expect(archived.events.map(e=>e.event)).to.deep.equal(['legacy_issue_recorded','exception_flagged']);
   const parent=await s.db('customer_invoices').where({customer_invoice_id:last.customer_invoice_id}).first();
   expect(new Date(archived.issue.issued_at).getTime()).to.equal(parent.created_at.getTime());
   ok(await s.post(url(last,`exceptions/${ex.exception_id}/reverse`)));await s.check(legacy,{n:100,b:100});
   const revision=ok(await s.post(url(last,`exceptions/${ex.exception_id}/resolve`),{action:'revision'}));
   const files=await s.files(revision.artifact_key);expect(s.pdf(files[Object.keys(files).find(k=>k.endsWith('.pdf'))])).to.include('Historical statement:');
 });

 it('creates two numbered revisions from separate exceptions without accumulating corrections twice',async()=>{
   const multiple=await s.customer('Two revisions'),mj=await s.job(multiple);await s.work(multiple,mj,100);
   const first=(await s.finalize([multiple])).committedInvoices[0];
   const ten=(await s.pay(multiple,10,{selectedInvoiceID:first.customer_invoice_id})).row;
   const twenty=(await s.pay(multiple,20,{selectedInvoiceID:first.customer_invoice_id})).row;
   await s.shift(1);const bill=(await s.finalize([multiple])).committedInvoices[0];
   for(const [payment,revision,amount] of [[ten,1,80],[twenty,2,100]]){
      const ex=ok(await flag(bill,[payment.payment_id]));ok(await s.post(url(bill,`exceptions/${ex.exception_id}/reverse`)));
      const done=ok(await s.post(url(bill,`exceptions/${ex.exception_id}/resolve`),{action:'revision'}));
      expect(done.revision).to.equal(revision);expect(done.issued_amount).to.equal(amount);await s.check(multiple,{n:amount,b:amount});
   }
   const history=ok(await s.get(url(bill,'history')));expect(history.revisions.map(r=>money(r.issued_amount))).to.deep.equal([70,80,100]);
   expect((await s.db('customer_invoices').where({customer_invoice_id:bill.customer_invoice_id}).first()).total_amount_due).to.equal('70.00');
 });

 it('protects job families linked only to sent receipts or credits, including raw imports',async()=>{
   const owner=await s.customer('Job-only protected credits'),other=await s.customer('Job-only destination');
   const workJob=await s.job(owner,1),creditJob=await s.job(owner,2),paymentJob=await s.job(owner,3);
   await s.work(owner,workJob,100);await s.writeoff(owner,20,{selectedJobID:creditJob.customer_job_id});
   const first=(await s.finalize([owner])).committedInvoices[0];await s.pay(owner,10,{selectedInvoiceID:first.customer_invoice_id,selectedJobID:paymentJob.customer_job_id});
   await s.shift(1);await s.finalize([owner]);await s.check(owner,{n:70,b:70});
   for(const job of [workJob,creditJob,paymentJob]){
      await s.reject(()=>s.put('/jobs/updateJob/1/1',{job:s.jobBody(other,job.job_type_id,{customerJobID:job.customer_job_id})}),/locked/,owner,{n:70,b:70},409);
      await s.reject(()=>s.del(`/jobs/deleteJob/${job.customer_job_id}/1/1`),/locked/,owner,{n:70,b:70},409);
      for(const action of [()=>s.db('customer_jobs').where({customer_job_id:job.customer_job_id}).update({customer_id:other.id}),()=>s.db('customer_jobs').where({customer_job_id:job.customer_job_id}).del()]){
         const before=await s.state();let error;try{await action();}catch(e){error=e;}expect(error?.code).to.equal('P0409');expect(await s.state()).to.deep.equal(before);
      }
   }
 });

});
