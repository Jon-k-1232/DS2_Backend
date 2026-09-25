'use strict';
const { Scenario, ok, refused, expect, ago, today } = require('./_scenario');
const { assertScenarioEnvironment } = require('../../scripts/scenarios/guard');

describe('scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md)', function () {
   this.timeout(180000); const s = new Scenario();
   let c, j, billedWork, inv, hold, funded, draw, auto, pending, pj, pw, target, tj, manual, mp, md, excess, ep, eh;
   const fundedState = { n: 200, b: 200, r: -80, unlinked: [1, 20] };
   const delPay = p => s.del('/payments/deletePayment/1/1', { payment: { paymentID: p.payment_id } });
   const editPay = (p, amount) => s.put('/payments/updatePayment/1/1', { payment: { paymentID: p.payment_id, unitCost: amount } });
   const reverse = p => s.post('/payments/reversePayment/1/1', { payment: { paymentID: p.payment_id, reason: 'NSF integrity scenario' } });
   const edit = (row, updates, extra = {}) => s.put(`/billing-review/transaction/${row.transaction_id}/1/1`, { updates, ...extra });
   async function original(table, key, id) {
      return (await s.db({ scenario_row: table }).select(s.db.raw('row_to_json(scenario_row) AS original')).where(key, id).first()).original;
   }
   async function corrupt(changes, action) {
      assertScenarioEnvironment(); const restore = [];
      try {
         for (const [table, key, id, patch] of changes) {
            const row = await original(table, key, id);
            restore.push([table, key, id, Object.fromEntries(Object.keys(patch).map(field => [field, row[field]]))]);
            await require('./_sent-fixture').fixtureMaintenance(s.db,1,trx=>trx(table).where(key,id).update(patch));
         }
         return await action();
      } finally { for (const [table, key, id, patch] of restore.reverse()) await require('./_sent-fixture').fixtureMaintenance(s.db,1,trx=>trx(table).where(key,id).update(patch)); }
   }
   async function extraRow(table, key, source, action) {
      assertScenarioEnvironment(); const row = { ...source }; delete row[key];
      const [inserted] = await s.db(table).insert(row).returning('*');
      try { return await action(inserted); } finally { await s.db(table).where(key, inserted[key]).delete(); }
   }
   async function waiters(count) {
      for (let attempt = 0; attempt < 200; attempt++) {
         const rows = (await s.db.raw("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' ORDER BY query_start")).rows;
         if (rows.length >= count) return rows;
         await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Expected ${count} scenario requests to reach their ledger lock`);
   }
   async function queue(customer, actions, cancel = false) {
      const blocker = await s.db.transaction(); const requests = [];
      try {
         await blocker('customers').where({ account_id: 1, customer_id: customer.id }).forNoKeyUpdate().first();
         for (const action of actions) { requests.push(action().then(r => r)); await waiters(requests.length); }
         if (cancel) {
            const rows = await waiters(1);
            expect((await s.db.raw('SELECT pg_cancel_backend(?) AS cancelled', [rows[0].pid])).rows[0].cancelled).to.equal(true);
         }
         await blocker.commit();
      } catch (e) { await blocker.rollback(); await Promise.allSettled(requests); throw e; }
      return Promise.all(requests);
   }
   before(async () => {
      await s.boot(); await s.foreignFixture();
      c = await s.customer('Scenario Integrity Funded'); j = await s.job(c); billedWork = await s.work(c, j, 200); await s.check(c, { n: 200, b: 0 });
      inv = await s.statement(c, await s.finalize([c]), 1, [0, 200, 0, 0, 0, 200]);
      hold = await s.retainer(c, 100); await s.check(c, { n: 200, b: 200, r: -100 });
      funded = await s.work(c, j, 20, { selectedRetainerID: hold.retainer_id });
      draw = await s.db('customer_retainers_and_prepayments').where({ retainer_id: funded.retainer_id }).first();
      auto = await s.db('customer_payments').where({ customer_id: c.id }).first(); await s.check(c, fundedState);
      pending = await s.customer('Scenario Integrity Pending'); pj = await s.job(pending); pw = await s.work(pending, pj, 100); await s.check(pending, { n: 100, b: 0 });
      target = await s.customer('Scenario Integrity Target'); tj = await s.job(target);
      manual = await s.customer('Scenario Integrity Manual'); const mj = await s.job(manual); await s.work(manual, mj, 100); await s.check(manual, { n: 100, b: 0 });
      const mi = await s.statement(manual, await s.finalize([manual]), 2, [0, 100, 0, 0, 0, 100]);
      const mh = await s.retainer(manual, 40); await s.check(manual, { n: 100, b: 100, r: -40 });
      mp = (await s.pay(manual, 20, { selectedInvoiceID: mi.customer_invoice_id, selectedRetainerID: mh.retainer_id })).row;
      md = await s.db('customer_retainers_and_prepayments').where({ parent_retainer_id: mh.retainer_id }).first(); await s.check(manual, { n: 80, b: 80, r: -20 });
      excess = await s.customer('Scenario Integrity Excess'); const ej = await s.job(excess); await s.work(excess, ej, 100); await s.check(excess, { n: 100, b: 0 });
      const ei = await s.statement(excess, await s.finalize([excess]), 3, [0, 100, 0, 0, 0, 100]);
      ep = (await s.pay(excess, 150, { selectedInvoiceID: ei.customer_invoice_id, captureOverpayment: true })).row;
      eh = await s.db('customer_retainers_and_prepayments').where({ customer_id: excess.id }).first(); await s.check(excess, { n: 0, b: 0, r: -50 });
   });
   after(async () => { await s.close(); });

   it('I01 refuses multiple exact payments claiming one funded work draw', async () => {
      await extraRow('customer_payments', 'payment_id', await original('customer_payments', 'payment_id', auto.payment_id), async () => {
         await s.reject(() => s.deleteWork(funded), /Multiple payments/i);
      });
      await s.check(c, fundedState);
   });
   for (const [label, change, pattern] of [
      ['draw ordered before root', () => ['customer_retainers_and_prepayments', 'retainer_id', draw.retainer_id, { created_at: '2000-01-01 00:00:00' }], /not a draw-down/],
      ['draw movement differs', () => ['customer_retainers_and_prepayments', 'retainer_id', draw.retainer_id, { current_amount: -90 }], /drew.*not this entry/],
      ['payment missing retainer identity', () => ['customer_payments', 'payment_id', auto.payment_id, { retainer_id: null }], /not linked/],
      ['payment amount differs', () => ['customer_payments', 'payment_id', auto.payment_id, { payment_amount: -19 }], /no longer matches/]
   ]) it(`I funded work refuses ${label}`, async () => {
      await corrupt([change()], () => s.reject(() => s.deleteWork(funded), pattern)); await s.check(c, fundedState);
   });
   it('I funded work refuses a draw shared by another transaction', async () => {
      await extraRow('customer_transactions', 'transaction_id', await original('customer_transactions', 'transaction_id', funded.transaction_id), async () => {
         await s.reject(() => s.deleteWork(funded), /referenced by another entry/);
      }); await s.check(c, fundedState);
   });
   it('I funded work refuses a draw already covered by a statement while its payment remains pending', async () => {
      await corrupt([
         ['customer_retainers_and_prepayments', 'retainer_id', hold.retainer_id, { created_at: '2000-01-01 00:00:00' }],
         ['customer_retainers_and_prepayments', 'retainer_id', draw.retainer_id, { created_at: '2000-01-02 00:00:00' }]
      ], () => s.reject(() => s.deleteWork(funded), /draw.*already on a statement/)); await s.check(c, fundedState);
   });
   it('I manual draw refuses a retainer overdraw and a missing legacy snapshot', async () => {
      await s.reject(() => editPay(mp, 50), /exceeds.*retainer/i, manual, { n: 80, b: 80, r: -20 });
      await corrupt([
         ['customer_payments', 'payment_id', mp.payment_id, { note: null }],
         ['customer_retainers_and_prepayments', 'retainer_id', md.retainer_id, { created_at: '2000-01-01 00:00:00' }]
      ], () => s.reject(() => delPay(mp), /Could not find the retainer draw/)); await s.check(manual, { n: 80, b: 80, r: -20 });
   });
   it('I legacy overpayment refuses two matching excess roots', async () => {
      await corrupt([['customer_payments', 'payment_id', ep.payment_id, { note: ep.note.replace(/\s*\[prepayment_retainer:\d+\]/g, '') }]], async () => {
         await extraRow('customer_retainers_and_prepayments', 'retainer_id', await original('customer_retainers_and_prepayments', 'retainer_id', eh.retainer_id), () => s.reject(() => delPay(ep), /2 prepayment retainers/));
      }); await s.check(excess, { n: 0, b: 0, r: -50 });
   });
   it('I NSF undo refuses a changed cancelled excess, then succeeds after fixture repair', async () => {
      ok(await reverse(ep)); await s.check(excess, { n: 100, b: 100 });
      const reversal = await s.db('customer_payments').where({ customer_id: excess.id }).where('payment_amount', '>', 0).first();
      await corrupt([['customer_retainers_and_prepayments', 'retainer_id', eh.retainer_id, { current_amount: -1 }]], () => s.reject(() => delPay(reversal), /changed since/));
      await s.check(excess, { n: 100, b: 100 }); ok(await delPay(reversal)); await s.check(excess, { n: 0, b: 0, r: -50 });
   });
   it('I deletion refuses a cancelled excess whose reversal event is missing', async () => {
      await corrupt([['customer_retainers_and_prepayments', 'retainer_id', eh.retainer_id, {
         current_amount: 0, is_retainer_active: false, note: `${eh.note} [cancelled by reversal of payment #${ep.payment_id}]`
      }]], () => s.reject(() => delPay(ep), /cancelled.*Delete the reversal first/));
      await s.check(excess, { n: 0, b: 0, r: -50 });
   });
   for (const kind of ['payment', 'writeoff']) it(`I ${kind} refuses a corrupt customer link on both update and delete`, async () => {
      const payment = kind === 'payment';
      const row = payment ? (await s.pay(c, 10, { selectedInvoiceID: inv.customer_invoice_id })).row : await s.writeoff(c, 10, { customerInvoiceID: inv.customer_invoice_id });
      await s.check(c, { ...fundedState, n: 190, b: 190 });
      const table = payment ? 'customer_payments' : 'customer_writeoffs', key = payment ? 'payment_id' : 'writeoff_id';
      const update = () => payment ? editPay(row, 11) : s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: row.writeoff_id, unitCost: 11 } });
      const remove = () => payment ? delPay(row) : s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: row.writeoff_id } });
      await corrupt([[table, key, row[key], { customer_id: pending.id }]], async () => { await s.reject(update, /different customer/); await s.reject(remove, /different customer/); });
      await s.check(c, { ...fundedState, n: 190, b: 190 }); ok(await remove()); await s.check(c, fundedState); await s.check(pending, { n: 100, b: 0 });
   });
   for (const kind of ['payment', 'writeoff']) it(`I ${kind} refuses repricing a legacy parent link with inconsistent timestamp order`, async () => {
      const payment = kind === 'payment';
      const row = payment ? (await s.pay(c, 10, { selectedInvoiceID: inv.customer_invoice_id })).row : await s.writeoff(c, 10, { customerInvoiceID: inv.customer_invoice_id });
      await s.check(c, { ...fundedState, n: 190, b: 190 });
      const table = payment ? 'customer_payments' : 'customer_writeoffs', key = payment ? 'payment_id' : 'writeoff_id';
      const parent = await original('customer_invoices', 'customer_invoice_id', inv.customer_invoice_id);
      await extraRow('customer_invoices', 'customer_invoice_id', { ...parent, invoice_date: ago(1), created_at: '2099-01-01 00:00:00' }, async fake => {
         await corrupt([[table, key, row[key], { customer_invoice_id: fake.customer_invoice_id }]], () => s.reject(
            () => payment ? editPay(row, 11) : s.put('/writeOffs/updateWriteOffs/1/1', { writeOff: { writeoffID: row.writeoff_id, unitCost: 11 } }), /linked directly/));
      });
      ok(await (payment ? delPay(row) : s.del('/writeOffs/deleteWriteOffs/1/1', { writeOff: { writeoffID: row.writeoff_id } }))); await s.check(c, fundedState);
   });
   it('I no-root legacy chain refuses receipt and credit; orphan receipt cannot be reversed', async () => {
      await corrupt([['customer_invoices', 'customer_invoice_id', inv.customer_invoice_id, { parent_invoice_id: inv.customer_invoice_id }]], async () => {
         await s.reject(() => s.post('/payments/createPayment/1/1', { payment: s.payment(c, 10, { selectedInvoiceID: inv.customer_invoice_id }) }), /no invoices/);
         await s.reject(() => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 10, { customerInvoiceID: inv.customer_invoice_id }) }), /no invoices/);
      }); await s.check(c, fundedState);
      await extraRow('customer_payments', 'payment_id', { account_id: 1, customer_id: pending.id, payment_date: today(), payment_amount: -10, created_by_user_id: 1 }, orphan => s.reject(() => reverse(orphan), /no invoices/));
      await s.check(pending, { n: 100, b: 0 });
   });
   it('I two work deletions serialize: one succeeds and the waiter observes not-found', async () => {
      const row = await s.work(pending, pj, 25); await s.check(pending, { n: 125, b: 0 });
      const results = await queue(pending, [() => s.deleteWork(row), () => s.deleteWork(row)]);
      ok(results[0]); refused(results[1], /not found/i); await s.check(pending, { n: 100, b: 0 }); await s.family(pj, 100);
   });
   it('I a waiting work delete refuses when the earlier customer move changes its owner', async () => {
      const row = await s.work(pending, pj, 25); await s.check(pending, { n: 125, b: 0 });
      const results = await queue(pending, [() => edit(row, { customer_id: target.id, customer_job_id: tj.customer_job_id }, { confirmCustomerChange: true }), () => s.deleteWork(row)]);
      // Account serialization precedes the initial delete lookup, so the moved
      // row is already absent from the submitted customer scope.
      ok(results[0]); refused(results[1], /Transaction was not found/); await s.check(pending, { n: 100, b: 0 }); await s.check(target, { n: 25, b: 0 });
      ok(await s.deleteWork({ ...row, customer_id: target.id })); await s.check(target, { n: 0, b: 0 }); await s.family(pj, 100); await s.family(tj, 0);
   });
   it('I a waiting Billing Review edit refuses after the earlier delete removes its row', async () => {
      const row = await s.work(pending, pj, 25); await s.check(pending, { n: 125, b: 0 });
      const results = await queue(pending, [() => s.deleteWork(row), () => edit(row, { note: 'Too late' })]);
      ok(results[0]); refused(results[1], /not found/i, 404); await s.check(pending, { n: 100, b: 0 }); await s.family(pj, 100);
   });
   it('I two receipt deletions serialize without restoring the debt twice', async () => {
      const row = (await s.pay(c, 10, { selectedInvoiceID: inv.customer_invoice_id })).row; await s.check(c, { ...fundedState, n: 190, b: 190 });
      const results = await queue(c, [() => delPay(row), () => delPay(row)]); ok(results[0]); refused(results[1], /No matching payment/); await s.check(c, fundedState);
   });
   it('I cancellation of a real PostgreSQL lock-wait query rolls Billing Review back', async () => {
      const before = await s.state(); const [response] = await queue(pending, [() => edit(pw, { total_transaction: 120 })], true);
      refused(response, /cancel|error/i); expect(await s.state()).to.deep.equal(before); await s.check(pending, { n: 100, b: 0 });
   });
   it('I a foreign-tenant invoice link on billed work retains its original statement lock', async () => {
      const parent = await original('customer_invoices', 'customer_invoice_id', inv.customer_invoice_id);
      await extraRow('customer_invoices', 'customer_invoice_id', { ...parent, account_id: 700, customer_id: 70001, created_by_user_id: 70001 }, async foreign => {
         const response = await corrupt([['customer_transactions', 'transaction_id', billedWork.transaction_id, { customer_invoice_id: foreign.customer_invoice_id }]], () => s.reject(() => edit(billedWork, { total_transaction: 220 }), /invoice|statement/i));
         expect(response.status).to.equal(409); expect(response.body.code).to.equal('SENT_INVOICE_LOCKED');
         expect(response.body.message).to.include(`locked: part of sent invoice ${inv.invoice_number}`);
      }); await s.check(c, fundedState);
   });
});
