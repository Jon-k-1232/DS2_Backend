'use strict';
const { Scenario, ok, expect } = require('./_scenario');
const { S3Client } = require('@aws-sdk/client-s3');
describe('what-if D: duplicate submissions and failures before/after commit', function () {
   this.timeout(180000); const s = new Scenario(); let sequence = 0;
   before(() => s.boot()); after(() => s.close());
   async function fixture(billed = true) {
      const c = await s.customer(`Retry ${++sequence}`), j = await s.job(c);
      await s.work(c, j, 100);
      let inv;
      if (billed) { await s.finalize([c]); inv = await s.db('customer_invoices').where({ customer_id: c.id }).whereNull('parent_invoice_id').first(); }
      return { c, j, inv };
   }
   const definitions = {
      payment: { table: 'customer_payments', pk: 'payment_id', field: 'payment_amount', module: 'payments/payments-service', refresh: 'getActivePayments' },
      writeoff: { table: 'customer_writeoffs', pk: 'writeoff_id', field: 'writeoff_amount', module: 'writeOffs/writeOffs-service', refresh: 'getActiveWriteOffs' },
      retainer: { table: 'customer_retainers_and_prepayments', pk: 'retainer_id', field: 'starting_amount', module: 'retainer/retainer-service', refresh: 'getActiveRetainers' },
      transaction: { table: 'customer_transactions', pk: 'transaction_id', field: 'total_transaction', module: 'transactions/transactions-service', refresh: 'getActiveTransactionsPaginated' }
   };
   function action(kind, f, amount = 10, mode = 'create', row) {
      const { c, j, inv } = f;
      if (kind === 'transaction') return mode === 'delete' ? s.deleteWork(row) : s.req(mode === 'create' ? 'post' : 'put', `/transactions/${mode === 'create' ? 'create' : 'update'}Transaction/1/1`, { transaction: s.transaction(c, j, amount, row ? { transactionID: row.transaction_id } : {}) });
      if (kind === 'payment') return s.req(mode === 'create' ? 'post' : mode === 'delete' ? 'delete' : 'put', `/payments/${mode === 'edit' ? 'update' : mode}Payment/1/1`, { payment: s.payment(c, amount, { selectedInvoiceID: row ? row.customer_invoice_id : inv.customer_invoice_id, ...(row ? { paymentID: row.payment_id } : {}) }) });
      if (kind === 'writeoff') return s.req(mode === 'create' ? 'post' : mode === 'delete' ? 'delete' : 'put', `/writeOffs/${mode === 'edit' ? 'update' : mode}WriteOffs/1/1`, { writeOff: s.credit(c, amount, row ? { writeoffID: row.writeoff_id } : {}) });
      return mode === 'delete' ? s.del(`/retainers/deleteRetainer/${row.retainer_id}/1/1`) : s.req(mode === 'create' ? 'post' : 'put', `/retainers/${mode === 'create' ? 'create' : 'update'}Retainer/1/1`, { retainer: { customerID: c.id, unitCost: amount, typeOfHold: 'Retainer', ...(row ? { retainerID: row.retainer_id } : {}) } });
   }
   for (const kind of Object.keys(definitions)) it(`D01 OPEN policy: two identical ${kind} submissions are two events`, async () => {
      const f = await fixture(kind === 'payment');
      const definition = definitions[kind];
      const before = await s.db(definition.table).where({ customer_id: f.c.id }).max({ id: definition.pk }).first();
      const started = [];
      const submit = () => { started.push(process.hrtime.bigint()); return action(kind, f).then(r => r); };
      const results = await Promise.all([submit(), submit()]);
      expect(Number(started[1] - started[0]) / 1e6).to.be.lessThan(1000);
      results.forEach(r => ok(r));
      const rows = await s.db(definition.table).where({ customer_id: f.c.id }).where(definition.pk, '>', before.id || 0);
      expect(rows).to.have.lengthOf(2); rows.forEach(row => expect(row[definition.field]).to.equal(kind === 'transaction' ? '10.00' : '-10.00'));
      await s.check(f.c, kind === 'payment' ? { n: 80, b: 80 } : kind === 'writeoff' ? { n: 80, b: 0 } : kind === 'retainer' ? { n: 100, b: 0, r: -20 } : { n: 120, b: 0 });
   });
   for (const kind of Object.keys(definitions)) it(`D03 ${kind} database failure rolls back and retry posts exactly once`, async () => {
      const f = await fixture(kind === 'payment'); const d = definitions[kind];
      const before = await s.db(d.table).where({ customer_id: f.c.id }).max({ id: d.pk }).first();
      await s.dbFailure(d.table, 'INSERT', () => s.reject(() => action(kind, f), /scenario injected|error/i));
      ok(await action(kind, f));
      const rows = await s.db(d.table).where({ customer_id: f.c.id }).where(d.pk, '>', before.id || 0);
      expect(rows).to.have.lengthOf(1); expect(rows[0][d.field]).to.equal(kind === 'transaction' ? '10.00' : '-10.00');
      await s.check(f.c, kind === 'payment' ? { n: 90, b: 90 } : kind === 'writeoff' ? { n: 90, b: 0 } : kind === 'retainer' ? { n: 100, b: 0, r: -10 } : { n: 110, b: 0 });
   });
   for (const kind of Object.keys(definitions)) for (const mode of ['create', 'edit', 'delete']) it(`D03 ${kind} ${mode} refresh failure reports committed success`, async () => {
      const f = await fixture(kind === 'payment'), d = definitions[kind];
      let row;
      if (mode !== 'create') { ok(await action(kind, f)); row = await s.db(d.table).where({ customer_id: f.c.id }).orderBy(d.pk, 'desc').first(); }
      const before = await s.db(d.table).where({ customer_id: f.c.id }).count({ n: '*' }).first();
      const service = require(`../../src/endpoints/${d.module}`), original = service[d.refresh];
      let result;
      try {
         service[d.refresh] = async () => { throw new Error('scenario refresh failure after commit'); };
         result = await action(kind, f, 20, mode, row);
      } finally { service[d.refresh] = original; }
      // The expected API must stop a careless user retrying a successful write.
      const body = ok(result); expect(body.committed).to.equal(true); expect(body.warnings).to.have.lengthOf(1);
      expect(body.warnings[0]).to.match(/saved|committed/i); expect(body.warnings[0]).to.match(/reload|refresh/i);
      const rows = await s.db(d.table).where({ customer_id: f.c.id }).orderBy(d.pk, 'desc');
      expect(rows).to.have.lengthOf(Number(before.n) + (mode === 'create' ? 1 : mode === 'delete' ? -1 : 0));
      if (mode !== 'delete') expect(rows[0][d.field]).to.equal(kind === 'transaction' ? '20.00' : '-20.00');
      await s.check(f.c, kind === 'payment' ? { n: mode === 'delete' ? 100 : 80, b: mode === 'delete' ? 100 : 80 } : kind === 'writeoff' ? { n: mode === 'delete' ? 100 : 80, b: 0 } : kind === 'retainer' ? { n: 100, b: 0, r: mode === 'delete' ? 0 : -20 } : { n: mode === 'delete' ? 100 : 120, b: 0 });
   });
   it('D02/D03 storage failure then retry and double-click finalize issue one $100 statement', async () => {
      const f = await fixture(false), send = S3Client.prototype.send;
      try {
         S3Client.prototype.send = function (command, ...args) {
            if (command.constructor.name === 'PutObjectCommand' && command.input.Key.includes('/invoice_images/')) throw new Error('scenario storage failure');
            return send.call(this, command, ...args);
         };
         await s.reject(() => s.post('/invoices/createInvoice/1/1', s.configuration([f.c], { isFinalized: true })), /storage|scenario/);
      } finally { S3Client.prototype.send = send; }
      await s.finalize([f.c]); const before = await s.state(); const retry = await s.finalize([f.c]);
      expect(retry.invoicesWithDetail).to.have.lengthOf(0); expect(retry.skippedCustomers).to.have.lengthOf(1);
      expect(retry.skippedCustomers[0].reason).to.match(/Already finalized today/); expect(await s.state()).to.deep.equal(before);
      const rows = await s.db('customer_invoices').where({ customer_id: f.c.id }).whereNull('parent_invoice_id');
      expect(rows).to.have.lengthOf(1); expect(rows[0].remaining_balance_on_invoice).to.equal('100.00'); await s.check(f.c, { n: 100, b: 100 });
   });
   it('D03 read-only employee report refresh failure is500 and never claims committed success', async () => {
      const service = require('../../src/endpoints/transactions/transactions-service'), original = service.getActiveTransactionsPaginated;
      const url = '/transactions/fetchEmployeeTransactions/2026-01-01/2026-12-31/1/1';
      try { service.getActiveTransactionsPaginated = async () => { throw new Error('scenario report read failure'); }; const r = await s.reject(() => s.get(url), /scenario|error/i, null, null, 500); expect(r.body.committed).not.to.equal(true); }
      finally { service.getActiveTransactionsPaginated = original; }
      ok(await s.get(url));
   });
   it('D03 active-retainer read failure is500 without writes; retry returns the saved hold', async () => {
      const f = await fixture(false), hold = await s.retainer(f.c, 10);
      const service = require('../../src/endpoints/retainer/retainer-service'), original = service.getMostRecentRecordOfCustomerRetainers;
      const url = `/retainers/getActiveRetainers/${f.c.id}/1/1`;
      try {
         service.getMostRecentRecordOfCustomerRetainers = async () => { throw new Error('scenario retainer read failure'); };
         const response = await s.reject(() => s.get(url), /Failure to retrieve active retainers/, null, null, 500);
         expect(response.status).to.equal(200); expect(response.body.committed).not.to.equal(true);
      } finally { service.getMostRecentRecordOfCustomerRetainers = original; }
      const rows = ok(await s.get(url)).activeRetainerData.activeRetainers;
      expect(rows).to.have.lengthOf(1); expect(rows[0].retainer_id).to.equal(hold.retainer_id);
      await s.check(f.c, { n: 100, b: 0, r: -10 });
   });
});
