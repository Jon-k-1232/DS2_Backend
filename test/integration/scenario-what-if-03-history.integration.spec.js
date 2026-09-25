'use strict';
const { Scenario, ok, expect, today } = require('./_scenario');
describe('what-if X/L/A: wrong targets, retained history and sessions', function () {
   this.timeout(180000); const s = new Scenario(); let a, b, aj, bj, work, invoice, receipt, credit, hold;
   before(async () => {
      await s.boot(); await s.foreignFixture();
      a = await s.customer('History A'); aj = await s.job(a); work = await s.work(a, aj, 100); await s.finalize([a]);
      invoice = await s.db('customer_invoices').where({ customer_id: a.id }).whereNull('parent_invoice_id').first();
      b = await s.customer('History B'); bj = await s.job(b); await s.work(b, bj, 100);
      hold = await s.retainer(b, 100); receipt = (await s.pay(a, 10, { selectedInvoiceID: invoice.customer_invoice_id })).row;
      credit = await s.writeoff(a, 10, { customerInvoiceID: invoice.customer_invoice_id });
   });
   after(() => s.close());
   for (const [name, changes] of [
      ['different customer invoice', () => ({ customerID: b.id, selectedInvoiceID: invoice.customer_invoice_id })],
      ['different customer job', () => ({ selectedJobID: bj.customer_job_id })],
      ['different customer retainer', () => ({ selectedRetainerID: hold.retainer_id })],
      ['foreign customer', () => ({ customerID: 70001 })], ['foreign job', () => ({ selectedJobID: 70001 })],
      ['missing invoice', () => ({ selectedInvoiceID: 999999 })], ['missing retainer', () => ({ selectedRetainerID: 999999 })]
   ]) it(`X01 receipt refuses ${name} and preserves both customers`, async () => {
      await s.reject(() => s.post('/payments/createPayment/1/1', { payment: s.payment(a, 10, { selectedInvoiceID: invoice.customer_invoice_id, ...changes() }) }), /customer|invoice|retainer|job/i, a, { n: 80, b: 80 });
      await s.check(b, { n: 100, b: 0, r: -100 });
   });
   for (const id of [70001, 999999]) it(`X01 absent/foreign ${id} cannot mutate any ledger`, async () => {
      for (const action of [
         () => s.put('/payments/updatePayment/1/1', { payment: { paymentID: id, unitCost: 10 } }),
         () => s.del('/payments/deletePayment/1/1', { payment: { paymentID: id } }),
         () => s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: id, unitCost: 10 } }),
         () => s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: id } }),
         () => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: id, unitCost: 10 } }),
         () => s.del(`/retainers/deleteRetainer/${id}/1/1`),
         () => s.del('/transactions/deleteTransaction/1/1', { transaction: { transactionID: id, customerID: a.id } })
      ]) await s.reject(action, /found|find/i);
   });
   it('L01 customer with debt, job with work and invoice with payment cannot be deleted', async () => {
      for (const action of [() => s.del(`/customer/deleteCustomer/${a.id}/1/1`), () => s.del(`/jobs/deleteJob/${aj.customer_job_id}/1/1`), () => s.del(`/invoices/deleteInvoice/1/${invoice.customer_invoice_id}`)]) await s.reject(action, /linked|exist|record|activit|transaction|invoice|job/i);
      await s.check(a, { n: 80, b: 80 });
   });
   for (const [label, change] of [['amount', () => ({ unitCost: 110, totalTransaction: 110 })], ['job', () => ({ customerJobID: bj.customer_job_id })], ['customer', () => ({ customerID: b.id })]]) it(`L02 billed transaction ${label} edit refuses`, async () => {
      await s.reject(() => s.editWork(work, change()), /billed|invoice|customer|job/i, a, { n: 80, b: 80 });
   });
   it('L02 next statement locks its payment and writeoff against editing and deletion', async () => {
      await s.finalize([a], { allowSameDayRebill: true });
      for (const action of [
         () => s.put('/payments/updatePayment/1/1', { payment: { paymentID: receipt.payment_id, unitCost: 20 } }),
         () => s.del('/payments/deletePayment/1/1', { payment: { paymentID: receipt.payment_id } }),
         () => s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: credit.writeoff_id, unitCost: 20 } }),
         () => s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: credit.writeoff_id } })
      ]) await s.reject(action, /locked: part of sent invoice/i, a, { n: 80, b: 80 });
   });
   it('X01 stale absorbed invoice is remapped to the live chain, once', async () => {
      const old = await s.db('customer_invoices').where({ customer_invoice_id: invoice.customer_invoice_id }).first();
      expect(old.remaining_balance_on_invoice).to.equal('100.00');
      const closed = await s.db('customer_invoices').where({ account_id: 1, parent_invoice_id: old.customer_invoice_id }).orderBy('customer_invoice_id', 'desc').first();
      expect(closed.remaining_balance_on_invoice).to.equal('0.00');
      expect(closed.notes).to.include('[absorbed_by:'); expect(old.notes).to.equal(null);
      const result = await s.pay(a, 10, { selectedInvoiceID: invoice.customer_invoice_id });
      expect(result.row.note).to.match(/applied to.*customer referenced/);
      expect((await s.db('customer_invoices').where({ customer_invoice_id: invoice.customer_invoice_id }).first()).remaining_balance_on_invoice).to.equal('100.00');
      await s.check(a, { n: 70, b: 70 });
   });
   it('L03 drawn retainer preserves $30 draw when increased; lower-than-drawn and deletion refuse', async () => {
      await s.work(b, bj, 30, { selectedRetainerID: hold.retainer_id });
      await s.check(b, { n: 100, b: 0, r: -70, unlinked: [1, 30] });
      ok(await s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 120 } }));
      const chain = await s.db('customer_retainers_and_prepayments').where({ customer_id: b.id }).orderBy('retainer_id');
      expect(chain.map(r => [r.starting_amount, r.current_amount])).to.deep.equal([['-120.00', '-120.00'], ['-120.00', '-90.00']]);
      await s.reject(() => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 20 } }), /already drawn/i);
      await s.reject(() => s.del(`/retainers/deleteRetainer/${hold.retainer_id}/1/1`), /drawn/i);
      await s.check(b, { n: 100, b: 0, r: -90, unlinked: [1, 30] });
   });
   it('L01 unused records delete successfully and stale IDs refuse', async () => {
      const c = await s.customer('Unused deletion'), job = await s.job(c), r = await s.retainer(c, 10);
      ok(await s.del(`/retainers/deleteRetainer/${r.retainer_id}/1/1`));
      await s.reject(() => s.del(`/retainers/deleteRetainer/${r.retainer_id}/1/1`), /found/i);
      ok(await s.del(`/jobs/deleteJob/${job.customer_job_id}/1/1`));
      await s.reject(() => s.del(`/jobs/deleteJob/${job.customer_job_id}/1/1`), /found/i);
      ok(await s.del(`/customer/deleteCustomer/${c.id}/1/1`));
      await s.reject(() => s.post('/payments/createPayment/1/1', { payment: s.payment(c, 10, { holdAsPrepayment: true }) }), /found/i);
   });
   async function usersState() { return { users: await s.db('users').orderBy('user_id'), entries: await s.db('timesheet_entries').orderBy('timesheet_entry_id') }; }
   async function user(label) {
      return (await s.db('users').insert({ account_id: 1, email: `${label}@scenario.test`, display_name: label, access_level: 'User', job_title: 'Scenario', cost_rate: 10, billing_rate: 20, is_user_active: true }).returning('*'))[0];
   }
   it('L01 user who owns a time entry cannot be deleted or lose attribution', async () => {
      const u = await user('owns-time');
      await s.db('timesheet_entries').insert({ account_id: 1, user_id: u.user_id, timesheet_name: 'Scenario ownership', time_tracker_start_date: today(), time_tracker_end_date: today(), date: today(), duration: 6, notes: 'Scenario time' });
      const before = await usersState();
      await s.reject(() => s.del(`/user/deleteUser/1/${u.user_id}`), /tied|time|entries|data/i);
      expect(await usersState()).to.deep.equal(before);
   });
   it('L01 user matched to another uploader time entry cannot lose employee attribution', async () => {
      const u = await user('matched-time');
      await s.db('timesheet_entries').insert({ account_id: 1, user_id: 1, matched_user_id: u.user_id, timesheet_name: 'Scenario matched ownership', time_tracker_start_date: today(), time_tracker_end_date: today(), date: today(), duration: 6, notes: 'Scenario time' });
      const before = await usersState();
      await s.reject(() => s.del(`/user/deleteUser/1/${u.user_id}`), /tied|time|entries|data/i);
      expect(await usersState()).to.deep.equal(before);
   });
   it('L01 unused user deletion succeeds; missing, deleted and foreign targets are404', async () => {
      const u = await user('unused-user'); ok(await s.del(`/user/deleteUser/1/${u.user_id}`));
      for (const id of [u.user_id, 999999, 70001]) {
         const before = await usersState(); await s.reject(() => s.del(`/user/deleteUser/1/${id}`), /not found/i, null, null, 404); expect(await usersState()).to.deep.equal(before);
      }
   });
   const routes = [
      ['payment', () => s.post('/payments/createPayment/1/1', { payment: s.payment(a, 1, { selectedInvoiceID: invoice.customer_invoice_id }) }, 'staff')],
      ['account settings', () => s.get('/account/AccountInformation/1/3', 'staff')],
      ['user deletion', () => s.del('/user/deleteUser/1/2', undefined, 'staff')],
      ['employee foreign self read', () => s.get('/user/fetchSingleUser/1/2', 'staff')]
   ];
   for (const [name, action] of routes) it(`A01 employee denied ${name}`, async () => { const before = await usersState(); await s.reject(action, /Unauthorized|Forbidden|permission|another user|Access denied/i, null, null, 403); expect(await usersState()).to.deep.equal(before); });
   it('A01 missing, expired, malformed, foreign and revoked sessions cannot write', async () => {
      const url = '/payments/createPayment/1/1', body = { payment: s.payment(a, 10, { selectedInvoiceID: invoice.customer_invoice_id }) };
      for (const role of [null, 'stranger', 'foreign']) await s.reject(() => s.post(url, body, role), null, null, null, role === 'foreign' ? 403 : 401);
      for (const token of ['not-a-token', s.token('sa', { expiresIn: '-1s' })]) await s.reject(() => s.request.post(url).set('Authorization', `Bearer ${token}`).send(body), null, null, null, 401);
      await s.db('users').where({ user_id: 2 }).update({ is_user_active: false });
      try { await s.reject(() => s.post(url, body, 'admin'), null, null, null, 401); }
      finally { await s.db('users').where({ user_id: 2 }).update({ is_user_active: true }); }
      ok(await s.get('/user/fetchSingleUser/1/3', 'staff')); ok(await s.get('/account/AccountInformation/1/2', 'admin'));
      ok(await s.post(url, body, 'admin')); await s.check(a, { n: 60, b: 60 });
   });
});
