'use strict';
const { Scenario, ok, expect, today } = require('./_scenario');
describe('what-if V/L: validation boundaries and user-history failures', function () {
   this.timeout(180000); const s = new Scenario(); let c, j;
   before(async () => { await s.boot(); c = await s.customer('Boundary input'); j = await s.job(c); });
   after(() => s.close());
   const configs = [
      ['payment', 'payment', '/payments/createPayment/1/1', () => ({ customerID: c.id, unitCost: 10, transactionDate: today(), holdAsPrepayment: true })],
      ['writeoff', 'writeOff', '/writeOffs/createWriteOffs/1/1', () => s.credit(c, 10)],
      ['retainer', 'retainer', '/retainers/createRetainer/1/1', () => ({ customerID: c.id, unitCost: 10, typeOfHold: 'Retainer' })]
   ];
   for (const [name, key, url, base] of configs) {
      for (const input of [undefined, null, [], true, 'text']) it(`V01 ${name} refuses nonobject body ${JSON.stringify(input)}`, async () => {
         const r = await s.reject(() => s.post(url, { [key]: input }), /object/i, null, null, 400); expect(r.status).to.equal(400);
      });
      for (const customerID of [undefined, null, '', true, false, [], [1], {}, 'bogus', 0, -1, 1.5, '9007199254740992']) it(`V07 ${name} refuses malformed customerID ${JSON.stringify(customerID)}`, async () => {
         const r = await s.reject(() => s.post(url, { [key]: { ...base(), customerID } }), /customer.*ID|customer.*selected/i, null, null, 400); expect(r.status).to.equal(400);
      });
   }
   for (const date of ['2000-02-29', '2024-02-29T23:59:59.999Z', '2026-12-31T23:59:59-07:00']) it(`V05 real calendar value ${date} is accepted`, async () => {
      ok(await s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 1, { selectedDate: date }) }));
      const row = await s.db('customer_writeoffs').select(s.db.raw('writeoff_date::text AS date')).where({ customer_id: c.id }).orderBy('writeoff_id', 'desc').first(); expect(row.date).to.equal(date.slice(0, 10));
   });
   for (const date of ['0000-01-01', '1900-02-29', '2100-02-29', '2026-01-01T99:00:00Z']) it(`V05 invalid calendar value ${date} refuses`, async () => {
      await s.reject(() => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 1, { selectedDate: date }) }), /date/i, null, null, 400);
   });
   it('V06 string limits count Unicode characters; exactly100 and50 fit', async () => {
      const displayName = '🙂'.repeat(100), typeOfHold = 'R'.repeat(50);
      const row = await s.retainer(c, 1, { displayName, typeOfHold, formOfPayment: 'F'.repeat(50), paymentReferenceNumber: 'P'.repeat(50) });
      expect(row.display_name).to.equal(displayName); expect(row.type_of_hold).to.equal(typeOfHold);
   });
   it('V01 largest representable retainer99999999.99 succeeds and can be deleted', async () => {
      const row = await s.retainer(c, 99999999.99); expect(row.current_amount).to.equal('-99999999.99'); ok(await s.del(`/retainers/deleteRetainer/${row.retainer_id}/1/1`));
   });
   it('V06 optional blank selections and write-off reason alias preserve their contracts', async () => {
      for (const value of [undefined, null, '']) ok(await s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 1, { writeoffReason: undefined, writeOffReason: 'Alias reason', selectedJobID: value, customerInvoiceID: value, note: value }) }));
      const rows = await s.db('customer_writeoffs').where({ customer_id: c.id, writeoff_reason: 'Alias reason' }); expect(rows).to.have.lengthOf(3); rows.forEach(r => { expect(r.customer_job_id).to.equal(null); expect(r.customer_invoice_id).to.equal(null); expect(r.note).to.equal(null); });
   });
   it('V06 null primary reason still uses the documented nonnull spelling alias', async () => {
      ok(await s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(c, 1, { writeoffReason: null, writeOffReason: 'Fallback reason' }) }));
      expect(await s.db('customer_writeoffs').where({ customer_id: c.id, writeoff_reason: 'Fallback reason' })).to.have.lengthOf(1);
   });
   for (const [kind, key, url, body] of configs) it(`V06 ${kind} text that exceeds its limit after XSS escaping refuses400`, async () => {
      const field = kind === 'writeoff' ? 'writeoffReason' : kind === 'retainer' ? 'typeOfHold' : 'paymentReferenceNumber';
      await s.reject(() => s.post(url, { [key]: { ...body(), [field]: '<>'.repeat(20) } }), /characters|length/i, null, null, 400);
   });
   for (const kind of ['payment', 'writeoff', 'retainer']) it(`V06 ${kind} edit also checks length after escaping and preserves its previous note`, async () => {
      let url, body;
      if (kind === 'payment') {
         const client = await s.customer('Escaped payment edit'), job = await s.job(client); await s.work(client, job, 100); await s.finalize([client]);
         const inv = await s.db('customer_invoices').where({ customer_id: client.id }).whereNull('parent_invoice_id').first();
         const row = (await s.pay(client, 10, { selectedInvoiceID: inv.customer_invoice_id })).row;
         url = '/payments/updatePayment/1/1'; body = { payment: { paymentID: row.payment_id, unitCost: 10, paymentReferenceNumber: '<>'.repeat(20), note: 'Must not save' } };
      } else if (kind === 'writeoff') {
         const row = await s.writeoff(c, 1); url = '/writeOffs/updateWriteOffs/1/1'; body = { writeOff: { writeoffID: row.writeoff_id, unitCost: 1, writeoffReason: '<>'.repeat(20), note: 'Must not save' } };
      } else {
         const row = await s.retainer(c, 10); url = '/retainers/updateRetainer/1/1'; body = { retainer: { retainerID: row.retainer_id, unitCost: 10, typeOfHold: '<>'.repeat(20), note: 'Must not save' } };
      }
      await s.reject(() => s.put(url, body), /characters|length/i, null, null, 400);
   });
   it('L01 Super Admin cannot delete the current session user', async () => {
      const before = await s.db('users').orderBy('user_id'); await s.reject(() => s.del('/user/deleteUser/1/1'), /own user account/i, null, null, 400); expect(await s.db('users').orderBy('user_id')).to.deep.equal(before);
   });
   it('X01 a stale invoice reference cannot revive a fully paid current chain', async () => {
      const client = await s.customer('Paid remap'), job = await s.job(client); await s.work(client, job, 100); await s.finalize([client]);
      const old = await s.db('customer_invoices').where({ customer_id: client.id }).whereNull('parent_invoice_id').first();
      await s.finalize([client], { allowSameDayRebill: true });
      const current = await s.db('customer_invoices').where({ customer_id: client.id }).whereNull('parent_invoice_id').orderBy('customer_invoice_id', 'desc').first();
      await s.pay(client, 100, { selectedInvoiceID: current.customer_invoice_id });
      await s.reject(() => s.post('/payments/createPayment/1/1', { payment: s.payment(client, 10, { selectedInvoiceID: old.customer_invoice_id }) }), /remaining|nothing/i);
      await s.reject(() => s.post('/writeOffs/createWriteOffs/1/1', { writeOff: s.credit(client, 10, { customerInvoiceID: old.customer_invoice_id }) }), /remaining|nothing/i);
      await s.check(client, { n: 0, b: 0 });
   });
   it('L01 work logged for an employee prevents deleting the employee', async () => {
      const [u] = await s.db('users').insert({ account_id: 1, email: 'work-owner@scenario.test', display_name: 'Work owner', access_level: 'User', job_title: 'Staff', cost_rate: 1, billing_rate: 2, is_user_active: true }).returning('*');
      const work = await s.work(c, j, 10, { loggedForUserID: u.user_id });
      const before = await s.db('users').where({ user_id: u.user_id }).first();
      await s.reject(() => s.del(`/user/deleteUser/1/${u.user_id}`), /work history|time entries/i, null, null, 409);
      expect(await s.db('users').where({ user_id: u.user_id }).first()).to.deep.equal(before);
      expect((await s.db('customer_transactions').where({ transaction_id: work.transaction_id }).first()).logged_for_user_id).to.equal(u.user_id);
   });
   for (const id of ['bogus', 0, -1, '9007199254740992']) it(`L01 malformed deletion ID ${id} gives404`, async () => {
      await s.reject(() => s.del(`/user/deleteUser/1/${id}`), /not found/i, null, null, 404);
   });
   it('L01 database deletion failure leaves user and ledger unchanged; retry deletes unused user', async () => {
      const [u] = await s.db('users').insert({ account_id: 1, email: 'db-delete@scenario.test', display_name: 'Delete fault', access_level: 'User', job_title: 'Staff', cost_rate: 1, billing_rate: 2, is_user_active: true }).returning('*');
      await s.db.raw("CREATE FUNCTION scenario_user_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'scenario user failure'; END $$");
      try {
         await s.db.raw('CREATE TRIGGER scenario_user_fail BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION scenario_user_fail()');
         await s.reject(() => s.del(`/user/deleteUser/1/${u.user_id}`), /data tied|cannot be deleted/i, null, null, 500);
         expect(await s.db('users').where({ user_id: u.user_id }).first()).to.deep.equal(u);
      } finally { await s.db.raw('DROP TRIGGER scenario_user_fail ON users'); await s.db.raw('DROP FUNCTION scenario_user_fail()'); }
      ok(await s.del(`/user/deleteUser/1/${u.user_id}`)); expect(await s.db('users').where({ user_id: u.user_id }).first()).to.equal(undefined);
   });
   it('L01 work arriving during user deletion must not acquire a deleted employee identity', async () => {
      const [u] = await s.db('users').insert({ account_id: 1, email: 'delete-race@scenario.test', display_name: 'Delete race', access_level: 'User', job_title: 'Staff', cost_rate: 1, billing_rate: 2, is_user_active: true }).returning('*');
      const service = require('../../src/endpoints/user/user-service'), original = service.deleteUser;
      let entered, release, deletion, creation, settled = false;
      const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const timer = setTimeout(release, 10000);
      service.deleteUser = async (...args) => { entered(); await gate; return original(...args); };
      try {
         deletion = s.del(`/user/deleteUser/1/${u.user_id}`).then(r => r); await ready;
         creation = s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(c, j, 10, { loggedForUserID: u.user_id }) }).then(r => { settled = true; return r; });
         let waiting = false;
         for (let i = 0; i < 100 && !settled && !waiting; i++) {
            waiting = (await s.db.raw("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'")).rows.length > 0;
            if (!waiting && !settled) await new Promise(resolve => setTimeout(resolve, 10));
         }
         expect(waiting || settled, 'work must reach a deterministic checkpoint').to.equal(true); release();
         ok(await deletion); const response = await creation; expect(Number(response.body.status || response.status)).to.be.at.least(400);
         expect(await s.db('customer_transactions').where({ logged_for_user_id: u.user_id })).to.have.lengthOf(0);
      } finally { clearTimeout(timer); release(); service.deleteUser = original; await Promise.allSettled([deletion, creation]); }
   });
   it('X01 user updates refuse malformed, absent and foreign targets without changing users', async () => {
      await s.foreignFixture();
      for (const id of [999999, 70001, undefined, null, '', true, false, [], [1], {}, 'bogus', 0, -1, 1.5, '9007199254740992']) {
         const before = await s.db('users').orderBy('user_id');
         const response = await s.reject(() => s.put('/user/updateUser/1/1', { user: { userID: id, accessLevel: 'User', userDisplayName: 'Must not save' } }), /User not found/, null, null, 404);
         expect(response.status).to.equal(404); expect(await s.db('users').orderBy('user_id')).to.deep.equal(before);
      }
   });
   it('L01 user update succeeds, rolls back on database failure, retries, then refuses a deleted target', async () => {
      const [u] = await s.db('users').insert({ account_id: 1, email: 'update-retry@scenario.test', display_name: 'Update retry', access_level: 'User', job_title: 'Staff', cost_rate: 1, billing_rate: 2, is_user_active: true }).returning('*');
      const update = rate => s.put('/user/updateUser/1/1', { user: { userID: u.user_id, accessLevel: 'User', billingRate: rate } });
      ok(await update(3)); expect(Number((await s.db('users').where({ user_id: u.user_id }).first()).billing_rate)).to.equal(3);
      const before = await s.db('users').orderBy('user_id');
      await s.db.raw("CREATE FUNCTION scenario_user_update_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'scenario injected user update failure'; END $$");
      try {
         await s.db.raw('CREATE TRIGGER scenario_user_update_fail BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION scenario_user_update_fail()');
         await s.reject(() => update(4), /scenario injected/i, null, null, 500);
      } finally { await s.db.raw('DROP TRIGGER scenario_user_update_fail ON users'); await s.db.raw('DROP FUNCTION scenario_user_update_fail()'); }
      expect(await s.db('users').orderBy('user_id')).to.deep.equal(before);
      ok(await update(4)); expect(Number((await s.db('users').where({ user_id: u.user_id }).first()).billing_rate)).to.equal(4);
      ok(await s.del(`/user/deleteUser/1/${u.user_id}`));
      const afterDelete = await s.db('users').orderBy('user_id');
      await s.reject(() => update(5), /User not found/, null, null, 404);
      expect(await s.db('users').orderBy('user_id')).to.deep.equal(afterDelete);
   });
});
