'use strict';
const { Scenario, ok, refused, expect, today } = require('./_scenario');
const { assertScenarioEnvironment } = require('../../scripts/scenarios/guard');
const { S3Client } = require('@aws-sdk/client-s3');

describe('scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md)', function () {
   this.timeout(180000); const s = new Scenario(); let anchor, anchorJob, anchorInvoice, target;
   const issue = (c, settings = {}) => s.post('/invoices/createInvoice/1/1', s.configuration([c], { isFinalized: true, isCsvOnly: true, ...settings }));
   const deleteInvoice = row => s.del(`/invoices/deleteInvoice/1/${row.customer_invoice_id}`);
   const deletePayment = row => s.del('/payments/deletePayment/1/1', { payment: { paymentID: row.payment_id } });
   const billed = { n: 100, b: 100 };
   async function waiters(count) {
      for (let i = 0; i < 200; i++) {
         const { rows } = await s.db.raw("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
         if (rows.length >= count) return;
         await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Scenario lock wait was not reached');
   }
   async function queue(customer, actions, beforeRelease) {
      const blocker = await s.db.transaction(); const requests = [];
      try {
         // Match the request helper's account-before-customer lock order;
         // beforeRelease can write while the queued HTTP request is waiting.
         await blocker.raw('SELECT pg_advisory_xact_lock(260026, 1)');
         await blocker('customers').where({ account_id: 1, customer_id: customer.id }).forNoKeyUpdate().first();
         for (const action of actions) { requests.push(action().then(r => r)); await waiters(requests.length); }
         if (beforeRelease) await beforeRelease(blocker);
         await blocker.commit();
      } catch (e) { await blocker.rollback(); await Promise.allSettled(requests); throw e; }
      return Promise.all(requests);
   }
   async function legacy(customer, suffix, amount) {
      assertScenarioEnvironment();
      const [row] = await s.db('customer_invoices').insert({ account_id: 1, customer_id: customer.id, customer_info_id: customer.info.customer_info_id,
         invoice_number: `LEGACY-${suffix}`, invoice_date: today(), due_date: today(), beginning_balance: 0, total_charges: amount,
         total_payments: 0, total_write_offs: 0, total_retainers: 0, total_amount_due: amount, remaining_balance_on_invoice: amount,
         is_invoice_paid_in_full: amount === 0, created_by_user_id: 1 }).returning('*');
      await s.check(customer, { n: amount, b: amount }); return row;
   }
   async function suppress(table, action) {
      assertScenarioEnvironment(); expect(['customers', 'customer_transactions', 'customer_payments']).to.include(table);
      await s.db.raw('CREATE FUNCTION scenario_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$');
      try {
         await s.db.raw('CREATE TRIGGER scenario_suppress BEFORE UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION scenario_suppress()', [table]);
         await action();
      } finally {
         await s.db.raw('DROP TRIGGER IF EXISTS scenario_suppress ON ??', [table]); await s.db.raw('DROP FUNCTION scenario_suppress()');
      }
   }
   async function duringUpload(action, invoke) {
      const send = S3Client.prototype.send; let done = false;
      try {
         S3Client.prototype.send = async function(command, ...args) {
            if (!done && command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/invoice_images/')) { done = true; await action(); }
            return send.call(this, command, ...args);
         };
         const result = await invoke(); expect(done).to.equal(true); return result;
      } finally { S3Client.prototype.send = send; }
   }
   async function collide(customers) {
      const send = S3Client.prototype.send; let count = 0, release;
      const gate = new Promise(resolve => { release = resolve; });
      const timer = setTimeout(release, 10000);
      try {
         S3Client.prototype.send = async function(command, ...args) {
            if (command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/invoice_images/')) {
               count++; if (count === 2) release(); await gate;
            }
            return send.call(this, command, ...args);
         };
         const results = await Promise.all(customers.map(c => issue(c).then(r => r)));
         expect(count).to.equal(2); return results;
      } finally { clearTimeout(timer); release(); S3Client.prototype.send = send; }
   }
   before(async () => {
      await s.boot(); anchor = await s.customer('Scenario Finalize Anchor'); anchorJob = await s.job(anchor); await s.work(anchor, anchorJob, 100); await s.check(anchor, { n: 100, b: 0 });
      anchorInvoice = await s.statement(anchor, await s.finalize([anchor]), 1, [0, 100, 0, 0, 0, 100]);
      target = await s.customer('Scenario Job Move Target');
   });
   after(async () => { await s.close(); });
   for (const kind of ['writeoff', 'payment']) it(`J job with only a ${kind} cannot be reassigned or deleted`, async () => {
      const job = await s.job(anchor, 4); await s.check(anchor, billed);
      const credit = kind === 'writeoff';
      const row = credit ? await s.writeoff(anchor, 10, { selectedJobID: job.customer_job_id }) : (await s.pay(anchor, 10, { selectedJobID: job.customer_job_id, selectedInvoiceID: anchorInvoice.customer_invoice_id })).row;
      const state = { n: 90, b: credit ? 100 : 90 };
      await s.check(anchor, state);
      await s.reject(() => s.put('/jobs/updateJob/1/1', { job: s.jobBody(target, 4, { customerJobID: job.customer_job_id }) }), credit ? /write offs/ : /payments/, anchor, state);
      await s.reject(() => s.del(`/jobs/deleteJob/${job.customer_job_id}/1/1`), credit ? /Write offs/ : /Payments/, anchor, state);
      ok(await (credit ? s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: row.writeoff_id } }) : deletePayment(row))); await s.check(anchor, billed);
      ok(await s.del(`/jobs/deleteJob/${job.customer_job_id}/1/1`)); await s.check(anchor, billed); await s.check(target, { n: 0, b: 0 });
   });
   it('J missing customer and suppressed profile update refuse without changing rows', async () => {
      await s.reject(() => s.post('/jobs/createJob/1/1', { job: s.jobBody({ id: 0 }, 4) }), /No customer selected/, anchor, billed);
      await suppress('customers', () => s.reject(() => s.put('/customer/updateCustomer/1/1', { customer: { ...anchor.payload, customerStreet: 'Never saved' } }), /Customer was not found/));
      await s.check(anchor, billed);
   });
   it('J a legacy parent with only a payment child refuses deletion until that payment is removed', async () => {
      const c = await s.customer('Scenario Legacy Child'); const inv = await legacy(c, 'CHILD', 100);
      const payment = (await s.pay(c, 10, { selectedInvoiceID: inv.customer_invoice_id })).row; await s.check(c, { n: 90, b: 90 });
      await s.reject(() => deleteInvoice(inv), /activity recorded/, c, { n: 90, b: 90 });
      ok(await deletePayment(payment)); await s.check(c, billed); ok(await deleteInvoice(inv)); await s.check(c, { n: 0, b: 0 });
   });
   it('J a queued invoice delete refuses a payment committed while it waited', async () => {
      const c = await s.customer('Scenario Legacy Delete Race'); const inv = await legacy(c, 'RACE', 100);
      const results = await queue(c, [() => s.post('/payments/createPayment/1/1', { payment: s.payment(c, 10, { selectedInvoiceID: inv.customer_invoice_id }) }), () => deleteInvoice(inv)]);
      ok(results[0]); refused(results[1], /gained linked activity/); await s.check(c, { n: 90, b: 90 });
      const payment = await s.db('customer_payments').where({ customer_id: c.id }).first(); ok(await deletePayment(payment)); await s.check(c, billed);
      ok(await deleteInvoice(inv)); await s.check(c, { n: 0, b: 0 });
   });
   it('J double invoice deletion and changed-owner races preserve the surviving ledger', async () => {
      const c = await s.customer('Scenario Legacy Empty'); let inv = await legacy(c, 'ZERO', 0);
      const results = await queue(c, [() => deleteInvoice(inv), () => deleteInvoice(inv)]); ok(results[0]); refused(results[1], /not found/i); await s.check(c, { n: 0, b: 0 });
      inv = await legacy(c, 'MOVED', 0);
      try {
         const [response] = await queue(c, [() => deleteInvoice(inv)], blocker => blocker('customer_invoices').where({ customer_invoice_id: inv.customer_invoice_id }).update({ customer_id: target.id }));
         refused(response, /changed customer/);
      } finally { await s.db('customer_invoices').where({ customer_invoice_id: inv.customer_invoice_id }).update({ customer_id: c.id }); }
      await s.check(c, { n: 0, b: 0 }); await s.check(target, { n: 0, b: 0 }); ok(await deleteInvoice(inv)); await s.check(c, { n: 0, b: 0 });
   });
   it('J same-customer concurrent finalize issues one statement and refuses its stale competitor', async () => {
      const c = await s.customer('Scenario Same Finalize'); const j = await s.job(c); await s.work(c, j, 100); await s.check(c, { n: 100, b: 0 });
      const results = await collide([c, c]); expect(results.map(r => r.body.status).sort()).to.deep.equal([200, 409]);
      refused(results.find(r => r.body.status !== 200), /finalized today by another run/);
      await s.statement(c, ok(results.find(r => r.body.status === 200)), 2, [0, 100, 0, 0, 0, 100]);
      expect(await s.db('customer_invoices').where({ customer_id: c.id }).whereNull('parent_invoice_id')).to.have.lengthOf(1);
   });
   it('J different-customer finalize number collision refuses one run and its retry uses the next number', async () => {
      const clients = [];
      for (const amount of [100, 200]) { const c = await s.customer(`Scenario Number Race ${amount}`); const j = await s.job(c); await s.work(c, j, amount); await s.check(c, { n: amount, b: 0 }); clients.push(c); }
      const results = await collide(clients); expect(results.map(r => r.body.status).sort()).to.deep.equal([200, 409]);
      const winner = results.findIndex(r => r.body.status === 200), loser = 1 - winner;
      refused(results[loser], /Invoice number.*just used/);
      await s.statement(clients[winner], ok(results[winner]), 3, [0, [100, 200][winner], 0, 0, 0, [100, 200][winner]]);
      await s.check(clients[loser], { n: [100, 200][loser], b: 0 });
      await s.statement(clients[loser], await s.finalize([clients[loser]]), 4, [0, [100, 200][loser], 0, 0, 0, [100, 200][loser]]);
   });
   for (const change of ['amount', 'billable', 'delete', 'customer']) it(`J finalize refuses a selected transaction's concurrent ${change} change`, async () => {
      const c = await s.customer(`Scenario Stale ${change}`); const j = await s.job(c); const row = await s.work(c, j, 100); await s.check(c, { n: 100, b: 0 });
      let dest, destJob;
      if (change === 'customer') { dest = await s.customer('Scenario Stale Destination'); destJob = await s.job(dest); }
      const result = await duringUpload(async () => {
         if (change === 'amount') ok(await s.editWork(row, { totalTransaction: 110, unitCost: 110 }));
         else if (change === 'billable') ok(await s.editWork(row, { isTransactionBillable: false }));
         else if (change === 'delete') ok(await s.deleteWork(row));
         else ok(await s.put(`/billing-review/transaction/${row.transaction_id}/1/1`, { updates: { customer_id: dest.id, customer_job_id: destJob.customer_job_id }, confirmCustomerChange: true }));
      }, () => issue(c));
      refused(result, /Transactions changed/); expect(await s.db('customer_invoices').where({ customer_id: c.id })).to.have.lengthOf(0);
      await s.check(c, { n: change === 'amount' ? 110 : 0, b: 0 }); if (dest) await s.check(dest, { n: 100, b: 0 });
   });
   it('J a receipt posted during rendering invalidates rebill and survives the refusal', async () => {
      let payment;
      const result = await duringUpload(async () => { payment = (await s.pay(anchor, 10, { selectedInvoiceID: anchorInvoice.customer_invoice_id })).row; }, () => issue(anchor, { allowSameDayRebill: true }));
      refused(result, /ledger changed/); await s.check(anchor, { n: 90, b: 90 });
      ok(await deletePayment(payment)); await s.check(anchor, billed);
   });
   for (const table of ['customer_transactions', 'customer_payments']) it(`J suppressed ${table} stamp refuses and rolls back every finalize write`, async () => {
      const c = await s.customer(`Scenario Suppressed ${table}`); const j = await s.job(c); let expected;
      if (table === 'customer_payments') { const hold = await s.retainer(c, 100); await s.check(c, { n: 0, b: 0, r: -100 }); await s.work(c, j, 20, { selectedRetainerID: hold.retainer_id }); expected = { n: 0, b: 0, r: -80, unlinked: [1, 20] }; }
      else { await s.work(c, j, 100); expected = { n: 100, b: 0 }; }
      await s.check(c, expected);
      await suppress(table, () => s.reject(() => issue(c), /changed|billed by another run/)); await s.check(c, expected);
   });
});
