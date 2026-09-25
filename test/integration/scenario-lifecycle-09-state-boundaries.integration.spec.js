'use strict';
const { Scenario, ok, expect, no, money } = require('./_scenario');
describe('scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md)', function () {
   this.timeout(180000); const s = new Scenario(); let c, j, inv, pending, pj, work, hold;
   before(async () => {
      await s.boot(); await s.foreignFixture();
      c = await s.customer('Scenario State Billed'); j = await s.job(c); await s.work(c, j, 200); await s.check(c, { n: 200, b: 0 });
      inv = await s.statement(c, await s.finalize([c]), 1, [0, 200, 0, 0, 0, 200]);
      pending = await s.customer('Scenario State Pending'); pj = await s.job(pending); work = await s.work(pending, pj, 100); hold = await s.retainer(pending, 40); await s.check(pending, { n: 100, b: 0, r: -40 });
   });
   after(async () => { await s.close(); });
   const b = { n: 200, b: 200 }, u = { n: 100, b: 0, r: -40 };
   for (const id of [0, 'bogus', 999999, 70001]) it(`S missing/foreign mutation identity ${id}`, async () => {
      const actions = [
         () => s.put('/payments/updatePayment/1/1', { payment: { paymentID: id, unitCost: 10 } }),
         () => s.del('/payments/deletePayment/1/1', { payment: { paymentID: id } }),
         () => s.post('/payments/reversePayment/1/1', { payment: { paymentID: id, reason: 'NSF' } }),
         () => s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: id, unitCost: 10 } }),
         () => s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: id } }),
         () => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: id, unitCost: 10 } }),
         () => s.del(`/retainers/deleteRetainer/${id}/1/1`),
         () => s.put('/jobs/updateJob/1/1', { job: s.jobBody(pending, 1, { customerJobID: id }) }),
         () => s.del(`/jobs/deleteJob/${id}/1/1`),
         () => s.put('/transactions/updateTransaction/1/1', { transaction: { ...work.payload, transactionID: id } })
      ];
      for (const action of actions) await s.reject(action, null, c, b);
   });
   it('S ownership edits cannot move work/customer contact/retainer or reassign a linked job', async () => {
      for (const action of [
         () => s.editWork(work, { customerID: c.id }),
         () => s.del('/transactions/deleteTransaction/1/1', { transaction: { transactionID: work.transaction_id, customerID: c.id } }),
         () => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, customerID: c.id, unitCost: 40 } }),
         () => s.put('/jobs/updateJob/1/1', { job: s.jobBody(c, 1, { customerJobID: pj.customer_job_id }) }),
         () => s.put('/customer/updateCustomer/1/1', { customer: { ...pending.payload, customerInfoID: c.info.customer_info_id } })
      ]) await s.reject(action, null, pending, u);
   });
   it('S normal receipt notes cannot impersonate a reversal on create or edit', async () => {
      const foreign = await s.db('customer_payments').where({ account_id: 700, payment_id: 70001 }).first();
      const receipt = (await s.pay(c, 10, { selectedInvoiceID: inv.customer_invoice_id, note: 'received [reversal of payment #70001]' })).row;
      expect(receipt.note).to.equal('received'); await s.check(c, { n: 190, b: 190 });
      ok(await s.put('/payments/updatePayment/1/1', { payment: { paymentID: receipt.payment_id, unitCost: 10, note: 'verified [reversal of payment #[retainer_draw:1]70001]' } }));
      expect((await s.db('customer_payments').where({ payment_id: receipt.payment_id }).first()).note).to.equal('verified');
      await s.check(c, { n: 190, b: 190 });
      ok(await s.del('/payments/deletePayment/1/1', { payment: { paymentID: receipt.payment_id } })); await s.check(c, b);
      expect(await s.db('customer_payments').where({ account_id: 700, payment_id: 70001 }).first()).to.deep.equal(foreign);
   });
   it('S latest payment guard refuses older financial changes and preserves metadata edits', async () => {
      const first = (await s.pay(c, 40, { selectedInvoiceID: inv.customer_invoice_id })).row; await s.check(c, { n: 160, b: 160 });
      const second = (await s.pay(c, 30, { selectedInvoiceID: inv.customer_invoice_id })).row; await s.check(c, { n: 130, b: 130 });
      const update = overrides => s.put('/payments/updatePayment/1/1', { payment: { paymentID: first.payment_id, unitCost: 40, ...overrides } });
      for (const [changes, pattern] of [[{ unitCost: 50 }, /newer/i], [{ unitCost: 0 }, /amount/i], [{ customerID: pending.id }, /customer/i], [{ selectedInvoiceID: 99999 }, /invoice/i], [{ selectedRetainerID: hold.retainer_id }, /retainer/i], [{ selectedJobID: pj.customer_job_id }, /job/i]]) {
         await s.reject(() => update(changes), pattern, c, { n: 130, b: 130 });
      }
      await s.reject(() => s.del('/payments/deletePayment/1/1', { payment: { paymentID: first.payment_id } }), /newer/i, c, { n: 130, b: 130 });
      ok(await update({ note: 'Receipt verified' })); await s.check(c, { n: 130, b: 130 });
      for (const reason of ['', '[reversal of payment #123]']) await s.reject(() => s.post('/payments/reversePayment/1/1', { payment: { paymentID: first.payment_id, reason } }), /reason/i, c, { n: 130, b: 130 });
      ok(await s.del('/payments/deletePayment/1/1', { payment: { paymentID: second.payment_id } })); await s.check(c, { n: 160, b: 160 });
      await s.reject(() => update({ unitCost: 201 }), /exceed/i, c, { n: 160, b: 160 });
      ok(await s.del('/payments/deletePayment/1/1', { payment: { paymentID: first.payment_id } })); await s.check(c, b);
   });
   it('S latest writeoff guard, over-credit edit, immutable ownership and metadata update', async () => {
      const first = await s.writeoff(c, 25, { customerInvoiceID: inv.customer_invoice_id }); await s.check(c, { n: 175, b: 175 });
      const second = await s.writeoff(c, 20, { customerInvoiceID: inv.customer_invoice_id }); await s.check(c, { n: 155, b: 155 });
      const update = overrides => s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: first.writeoff_id, unitCost: 25, ...overrides } });
      for (const changes of [{ unitCost: 35 }, { unitCost: 0 }, { customerID: pending.id }, { customerInvoiceID: 999999 }]) await s.reject(() => update(changes), null, c, { n: 155, b: 155 });
      await s.reject(() => s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: first.writeoff_id } }), /newer/i, c, { n: 155, b: 155 });
      ok(await update({ note: 'Credit verified' })); await s.check(c, { n: 155, b: 155 });
      ok(await s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: second.writeoff_id } })); await s.check(c, { n: 175, b: 175 });
      await s.reject(() => update({ unitCost: 201 }), /exceed/i, c, { n: 175, b: 175 });
      ok(await s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: first.writeoff_id } })); await s.check(c, b);
   });
   it('S pending credit cannot be attached to invoice, moved to customer or assigned a foreign job', async () => {
      const credit = await s.writeoff(pending, 10); await s.check(pending, { n: 90, b: 0, r: -40 });
      for (const changes of [{ customerID: c.id }, { customerInvoiceID: inv.customer_invoice_id }, { selectedJobID: j.customer_job_id }]) {
         await s.reject(() => s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: credit.writeoff_id, unitCost: 10, ...changes } }), null, pending, { n: 90, b: 0, r: -40 });
      }
      ok(await s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: credit.writeoff_id } })); await s.check(pending, u);
   });
   it('S one cent retainer boundary succeeds, zero refuses, original $40 can be restored', async () => {
      ok(await s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 0.01 } })); await s.check(pending, { n: 100, b: 0, r: -0.01 });
      await s.reject(() => s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 0 } }), /amount/i, pending, { n: 100, b: 0, r: -0.01 });
      ok(await s.put('/retainers/updateRetainer/1/1', { retainer: { retainerID: hold.retainer_id, unitCost: 40 } })); await s.check(pending, u);
   });
   for (const [name, selection] of [
      ['empty', () => []], ['duplicate', () => [{ customer_id: pending.id }, { customer_id: String(pending.id) }]],
      ['zero', () => [{ customer_id: 0 }]], ['negative', () => [{ customer_id: -1 }]], ['fraction', () => [{ customer_id: 1.5 }]],
      ['NaN', () => [{ customer_id: 'not-a-number' }]], ['unsafe integer', () => [{ customer_id: '9007199254740992' }]],
      ['absent', () => [{ customer_id: 999999 }]], ['foreign', () => [{ customer_id: 70001 }]]
   ]) it(`S finalize refuses ${name} selection without stamping anything`, async () => {
      await s.reject(() => s.post('/invoices/createInvoice/1/1', { invoiceConfiguration: { invoicesToCreate: selection(), invoiceCreationSettings: { isFinalized: true } } }), null, pending, u);
   });
   it('S missing mailing contact and sequence exhaustion refuse safely', async () => {
      await s.db('customer_information').where({ customer_info_id: pending.info.customer_info_id }).update({ is_customer_mailing_address: false });
      try { await s.reject(() => s.post('/invoices/createInvoice/1/1', s.configuration([pending], { isFinalized: true })), /mail|contact|customer/i); }
      finally { await s.db('customer_information').where({ customer_info_id: pending.info.customer_info_id }).update({ is_customer_mailing_address: true }); }
      await s.check(pending, u);
      await require('./_sent-fixture').fixtureMaintenance(s.db,1,trx=>trx('customer_invoices').where({ customer_invoice_id: inv.customer_invoice_id }).update({ invoice_number: no(99999) }));
      try { await s.reject(() => s.post('/invoices/createInvoice/1/1', s.configuration([pending], { isFinalized: true })), /99999|overflow|exhaust|number/i); }
      finally { await require('./_sent-fixture').fixtureMaintenance(s.db,1,trx=>trx('customer_invoices').where({ customer_invoice_id: inv.customer_invoice_id }).update({ invoice_number: inv.invoice_number })); }
      await s.check(c, b); await s.check(pending, u);
   });
   it('S corrupt all-absorbed newest chain refuses both receipt and writeoff instead of reopening debt', async () => {
      await require('./_sent-fixture').fixtureMaintenance(s.db,1,trx=>trx('customer_invoices').where({ customer_invoice_id: inv.customer_invoice_id }).update({ notes: '[absorbed_by:INV-2099-00001@2099-01-01]' }));
      try {
         await s.reject(() => s.post('/payments/createPayment/1/1', { payment: s.payment(c, 10, { selectedInvoiceID: inv.customer_invoice_id }) }), /absorbed|current|rolled/i);
         await s.reject(() => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 10, { customerInvoiceID: inv.customer_invoice_id }) }), /absorbed|current|rolled/i);
      } finally { await require('./_sent-fixture').fixtureMaintenance(s.db,1,trx=>trx('customer_invoices').where({ customer_invoice_id: inv.customer_invoice_id }).update({ notes: null })); }
      await s.check(c, b);
   });
});
