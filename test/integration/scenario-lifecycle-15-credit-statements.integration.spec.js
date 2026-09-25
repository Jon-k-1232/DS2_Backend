'use strict';
const { Scenario, ok, expect, money } = require('./_scenario');
describe('owner decision 2: optional signed credit statements', function () {
   this.timeout(180000); const s = new Scenario(); let c, j, first, pending;
   const submit = (flags = {}, settings = {}) => s.post('/invoices/createInvoice/1/777', s.configuration([c], { isFinalized:true, isCsvOnly:true, ...settings }, flags));
   before(async () => { await s.boot(); c = await s.customer('Optional credit'); j = await s.job(c); await s.work(c,j,100); pending = await s.writeoff(c,150); });
   after(() => s.close());
   it('shows -$50 clearly; preview and default skip preserve every pending record', async () => {
      await s.check(c,{n:-50,b:0});
      const grid = ok(await s.get('/invoices/createInvoice/AccountsWithBalance/1/1')).outstandingBalanceList.activeOutstandingBalancesData.grid;
      expect(grid.rows.find(r=>r.customer_id===c.id)).to.include({invoice_total:-50,is_credit_statement:true});
      const before = await s.state();
      const preview = await s.preview(c); expect(money(preview.invoiceTotal)).to.equal(-50);
      for (const flags of [{},{includeCreditStatement:false}]) {
         const response=ok(await submit(flags)); expect(response.invoicesWithDetail).to.have.length(0);
         expect(response.skippedCustomers[0].code).to.equal('CREDIT_NOT_SELECTED'); expect(await s.state()).to.deep.equal(before);
      }
   });
   it('explicitly issues -$50 with no payment due, session actor/reason and frozen evidence', async () => {
      const result=ok(await submit({includeCreditStatement:true,showWriteOffs:true,issueReason:'Send the client their credit balance'}));
      first=await s.statement(c,result,1,[0,100,0,-150,0,-50],['CREDIT STATEMENT','No payment due']);
      const issue=await s.db('invoice_issues').where({invoice_id:first.customer_invoice_id}).first();
      expect(issue.issued_by).to.equal(1); expect(issue.credit_selection_reason).to.equal('Send the client their credit balance');
      expect(issue.payload.includeCreditStatement).to.equal(true);
      const history=await s.db('invoice_history').where({invoice_id:first.customer_invoice_id,event:'issued'}).first();
      expect(history.actor_id).to.equal(1); expect(history.detail.reason).to.equal(issue.credit_selection_reason);
      const before=await s.db('customer_payments').where({customer_id:c.id}); expect(before).to.have.length(0);
      await s.reject(()=>s.put('/writeOffs/updateWriteOffs/1/1',{writeOff:{writeoffID:pending.writeoff_id,unitCost:140}}),/locked/,c,{n:-50,b:-50},409);
      require('fs').writeFileSync('/tmp/ds2-owner-credit-statement.pdf',first.pdf);
   });
   it('same-day guard remains; selected carry-forward absorbs -$50 once and adds $20 = -$30', async () => {
      const before=await s.state();expect(ok(await submit({includeCreditStatement:true})).skippedCustomers[0].reason).to.match(/today/);expect(await s.state()).to.deep.equal(before);
      await s.work(c,j,20,{detailedJobDescription:'New work consumes credit'});await s.check(c,{n:-30,b:-50});
      await s.statement(c,await s.finalize([c],{allowSameDayRebill:true},{includeCreditStatement:true}),2,[-50,20,0,0,0,-30]);
      const original=await s.db('customer_invoices').where({customer_invoice_id:first.customer_invoice_id}).first();expect(money(original.remaining_balance_on_invoice)).to.equal(-50);
      const close=await s.db('customer_invoices').where({parent_invoice_id:first.customer_invoice_id}).orderBy('customer_invoice_id','desc').first();expect(money(close.remaining_balance_on_invoice)).to.equal(0);expect(close.notes).to.include('absorbed_by:');
      expect(Object.values(await s.files(first.invoice_file_location)).some(b=>b.equals(first.pdf))).to.equal(true);
   });
   it('crosses credit to zero then debt without another credit payment or dropped activity', async () => {
      await s.work(c,j,30,{detailedJobDescription:'Exhaust credit'});await s.check(c,{n:0,b:-30});
      await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),3,[-30,30,0,0,0,0]);
      await s.work(c,j,61,{detailedJobDescription:'Next positive work'});
      await s.statement(c,await s.finalize([c],{allowSameDayRebill:true}),4,[0,61,0,0,0,61]);
   });
   it('mixed batch issues debit only and leaves an unselected credit customer unchanged', async () => {
      const credit=await s.customer('Mixed skipped credit');const job=await s.job(credit);await s.work(credit,job,10);await s.writeoff(credit,35);
      const before=await s.db('customer_transactions').where({customer_id:credit.id});
      const result=await s.finalize([c,credit],{allowSameDayRebill:true});expect(result.committedInvoices).to.have.length(1);expect(result.skippedCustomers[0].customer_id).to.equal(credit.id);
      expect(await s.db('customer_transactions').where({customer_id:credit.id})).to.deep.equal(before);await s.check(credit,{n:-25,b:0});
      await s.statement(credit,await s.finalize([credit],{},{includeCreditStatement:true,showWriteOffs:true}),6,[0,10,0,-35,0,-25]);
   });
   for (const [adjustment,issued,revised] of [[90,-10,10],[130,-50,-30]]) it(`a bounced receipt revises chosen credit ${issued} to ${revised} once with the correct PDF label`,async()=>{
      const client=await s.customer(`Credit with bounced receipt ${adjustment}`);const job=await s.job(client);await s.work(client,job,100);
      const first=(await s.finalize([client])).committedInvoices[0];
      const receipt=(await s.pay(client,20,{selectedInvoiceID:first.customer_invoice_id})).row;
      await s.writeoff(client,adjustment);await s.check(client,{n:issued,b:80});
      const credit=(await s.finalize([client],{allowSameDayRebill:true},{includeCreditStatement:true})).committedInvoices[0];
      await s.check(client,{n:issued,b:issued});
      const ex=ok(await s.post(`/invoices/${credit.customer_invoice_id}/exceptions/1/1`,{condition:'bounced_check',reason:'Returned check corrects the issued credit balance',paymentIds:[receipt.payment_id]}));
      ok(await s.post(`/invoices/${credit.customer_invoice_id}/exceptions/${ex.exception_id}/reverse/1/1`));
      await s.check(client,{n:revised,b:revised});
      const revision=ok(await s.post(`/invoices/${credit.customer_invoice_id}/exceptions/${ex.exception_id}/resolve/1/1`,{action:'revision'}));
      expect(money(revision.issued_amount)).to.equal(revised);
      const files=await s.files(revision.artifact_key);
      const pdf=files[Object.keys(files).find(k=>k.endsWith('.pdf')&&!k.includes('_ORIGINAL_ARCHIVE'))];
      const text=s.pdf(pdf);
      expect(text).to.include(`Original issued credit balance: -$${Math.abs(issued).toFixed(2)}`);
      expect(text).to.include(revised<0?'Revised issued credit balance: -$30.00':'Revised issued amount due: $10.00');
      if(revised<0){expect(text).to.include('No payment due');require('fs').writeFileSync('/tmp/ds2-owner-credit-revision.pdf',pdf);}
      else expect(text).not.to.include('No payment due');
      expect(money((await s.db('customer_invoices').where({customer_invoice_id:credit.customer_invoice_id}).first()).total_amount_due)).to.equal(issued);
      await s.check(client,{n:revised,b:revised});
   });
   it('validates every new raw option and customer shape before writing', async () => {
      for(const includeCreditStatement of [null,'true','false',0,1,[],{}]) await s.reject(()=>submit({includeCreditStatement}),/boolean/,null,null,400);
      for(const issueReason of [null,' ',17,[],{},'x'.repeat(2001),'bad\0reason']) await s.reject(()=>submit({issueReason}),/Reason/,null,null,400);
      for(const invoicesToCreate of [null,{},[],[null],[[]],[{customer_id:true}],[{customer_id:2147483648}],[{customer_id:c.id},{customer_id:c.id}]]) await s.reject(()=>s.post('/invoices/createInvoice/1/1',{invoiceConfiguration:{invoicesToCreate}}),/select|customer/i,null,null,400);
      for(const configuration of [null,[],true]) await s.reject(()=>s.post('/invoices/createInvoice/1/1',{invoiceConfiguration:configuration}),/configuration/i,null,null,400);
      for(const invoiceCreationSettings of [null,[],true,{isFinalized:'false'},{allowSameDayRebill:'true'}]) await s.reject(()=>s.post('/invoices/createInvoice/1/1',{invoiceConfiguration:{invoicesToCreate:[{customer_id:c.id}],invoiceCreationSettings}}),/settings|boolean/i,null,null,400);
   });
   it('rejects missing/cross-account customers, anonymous/staff and foreign tenants without writes',async()=>{
      await s.foreignFixture();
      for(const id of [999999,70001]) await s.reject(()=>s.post('/invoices/createInvoice/1/1',s.configuration([{id}],{isFinalized:true})),/not found/,null,null,404);
      for(const [role,status] of [[null,401],['staff',403],['foreign',403]]) await s.reject(()=>s.post('/invoices/createInvoice/1/1',s.configuration([c],{isFinalized:true}),role),null,null,null,status);
   });
   it('selected credit database and storage failures leave all money, membership and selection evidence unchanged',async()=>{
      await s.writeoff(c,100);await s.check(c,{n:-39,b:61});
      const action=()=>submit({includeCreditStatement:true},{allowSameDayRebill:true});
      for(const table of ['customer_invoices','invoice_issues','invoice_statement_members','invoice_revisions','invoice_history']) await s.dbFailure(table,'INSERT',()=>s.reject(action,null,null,null,500));
      const {S3Client}=require('@aws-sdk/client-s3');const real=S3Client.prototype.send;
      S3Client.prototype.send=function(cmd,...args){if(cmd.constructor.name==='PutObjectCommand'&&cmd.input.Key.includes('/invoice_images/'))throw Error('local storage unavailable');return real.call(this,cmd,...args);};
      try{await s.reject(action,/storage|upload/i,null,null,500);}finally{S3Client.prototype.send=real;}
   });
   it('eligibility fails closed when pricing is unavailable rather than labelling credits zero',async()=>{
      const service=require('../../src/endpoints/invoice/invoice-service');const real=service.getOutstandingInvoices;
      service.getOutstandingInvoices=async()=>{throw Error('pricing database unavailable');};
      try{await s.reject(()=>s.get('/invoices/createInvoice/AccountsWithBalance/1/1'),/calculate/,null,null,500);}finally{service.getOutstandingInvoices=real;}
   });
});
