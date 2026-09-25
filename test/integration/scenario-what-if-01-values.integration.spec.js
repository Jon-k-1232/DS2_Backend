'use strict';
// Oracles V01–V07 were written first in docs/scenarios/what-if-and-mistakes.md.
const { Scenario, ok, expect, today } = require('./_scenario');
describe('what-if V: explicit inputs, cent rounding and unchanged-state refusals', function () {
   this.timeout(180000);
   const s = new Scenario(); let c, j, inv, other, oj, receipt, credit, hold;
   const kinds = ['payment', 'writeoff', 'retainer'];
   const table = { payment: 'customer_payments', writeoff: 'customer_writeoffs', retainer: 'customer_retainers_and_prepayments' };
   const key = { payment: 'payment_id', writeoff: 'writeoff_id', retainer: 'retainer_id' };
   const amountColumn = { payment: 'payment_amount', writeoff: 'writeoff_amount', retainer: 'starting_amount' };
   function payload(kind, extra = {}, edit = false) {
      const data = kind === 'payment' ? s.payment(c, 10, { selectedInvoiceID: inv.customer_invoice_id }) :
         kind === 'writeoff' ? s.credit(other, 10) : { customerID: other.id, unitCost: 100, typeOfHold: 'Retainer' };
      if (edit) {
         if (kind === 'payment') Object.assign(data, { paymentID: receipt.payment_id, selectedInvoiceID: receipt.customer_invoice_id });
         if (kind === 'writeoff') data.writeoffID = credit.writeoff_id;
         if (kind === 'retainer') data.retainerID = hold.retainer_id;
      }
      return { [kind === 'writeoff' ? 'writeOff' : kind]: { ...data, ...extra } };
   }
   function send(kind, extra, edit = false) {
      const part = { payment: ['payments', 'Payment'], writeoff: ['writeOffs', 'WriteOffs'], retainer: ['retainers', 'Retainer'] }[kind];
      return s.req(edit ? 'put' : 'post', `/${part[0]}/${edit ? 'update' : 'create'}${part[1]}/1/1`, payload(kind, extra, edit));
   }
   async function invalid(action, pattern) {
      const response = await s.reject(action, pattern, null, null, 400);
      expect(response.status, 'validation must use HTTP400').to.equal(400);
   }
   before(async () => {
      await s.boot(); await s.foreignFixture();
      c = await s.customer('Mistakes billed'); j = await s.job(c); await s.work(c, j, 1000);
      await s.finalize([c]); inv = await s.db('customer_invoices').where({ customer_id: c.id }).whereNull('parent_invoice_id').first();
      other = await s.customer('Mistakes pending'); oj = await s.job(other); await s.work(other, oj, 100);
      receipt = (await s.pay(c, 10, { selectedInvoiceID: inv.customer_invoice_id })).row;
      credit = await s.writeoff(other, 10); hold = await s.retainer(other, 100);
   });
   after(() => s.close());

   for (const kind of kinds) for (const edit of [false, true]) {
      for (const value of [0, 0.001, null, '', '  ', 'not-money', 'Infinity', '-Infinity', 'NaN', true, false, [], [10], {}, 100000000, -100000000, 99999999.995]) {
         it(`V01 ${kind} ${edit ? 'edit' : 'create'} refuses amount ${JSON.stringify(value)}`, async () => {
            await invalid(() => send(kind, { unitCost: value, note: 'Must not be partially saved' }, edit), /amount|unitCost/i);
         });
      }
      for (const value of [true, [], {}, 'text', -1, 1.5, '9007199254740992']) {
         for (const field of (kind === 'payment' ? ['selectedInvoiceID', 'selectedJobID', 'selectedRetainerID'] : kind === 'writeoff' ? ['customerInvoiceID', 'selectedJobID'] : [])) {
            it(`V07 ${kind} ${edit ? 'edit' : 'create'} refuses ${field}=${JSON.stringify(value)}`, async () => {
               await invalid(() => send(kind, { [field]: value, note: 'Do not save' }, edit), /ID|selection/i);
            });
         }
      }
      const fields = kind === 'writeoff' ? [['writeoffReason', 50]] : [['formOfPayment', 50], ['paymentReferenceNumber', 50], ...(kind === 'retainer' ? [['displayName', 100], ['typeOfHold', 50]] : [])];
      for (const [field, limit] of fields) it(`V06 ${kind} ${edit ? 'edit' : 'create'} refuses ${field} longer than ${limit}`, async () => {
         await invalid(() => send(kind, { [field]: 'x'.repeat(limit + 1) }, edit), /characters|length/i);
      });
      for (const value of [true, [], {}, '\u0000']) it(`V06 ${kind} ${edit ? 'edit' : 'create'} refuses invalid note ${JSON.stringify(value)}`, async () => {
         await invalid(() => send(kind, { note: value }, edit), /note|text/i);
      });
   }
   for (const kind of ['payment', 'writeoff']) for (const edit of [false, true]) {
      const field = kind === 'payment' ? 'transactionDate' : 'selectedDate';
      for (const value of [null, '', 'no-date', '2025-02-29', '2026-02-30', '2026-13-01', '2026-01-32', true, [], {}]) {
         it(`V05 ${kind} ${edit ? 'edit' : 'create'} refuses date ${JSON.stringify(value)}`, async () => {
            await invalid(() => send(kind, { [field]: value, note: 'Do not partially update' }, edit), /date/i);
         });
      }
   }
   for (const [kind, field] of [['writeoff', 'writeoffReason'], ['retainer', 'typeOfHold']]) for (const edit of [false, true]) {
      for (const value of ['', '   ', null, true, [], {}]) it(`V06 ${kind} ${edit ? 'edit' : 'create'} refuses required ${field}=${JSON.stringify(value)}`, async () => {
         await invalid(() => send(kind, { [field]: value }, edit), /reason|hold|text/i);
      });
   }
   for (const kind of kinds) for (const [input, expected] of [[10, '-10.00'], [-10, '-10.00'], [0.005, '-0.01'], [-0.005, '-0.01'], [1.005, '-1.01'], [-1.005, '-1.01'], [1.015, '-1.02'], [2.675, '-2.68'], [12.345, '-12.35']]) {
      it(`V02/V03 ${kind} create and edit ${input} stores ${expected}`, async () => {
         // Each pair gets a fresh record; amount edits are always on the latest child.
         ok(await send(kind, { unitCost: input }));
         const created = await s.db(table[kind]).where({ customer_id: kind === 'payment' ? c.id : other.id }).orderBy(key[kind], 'desc').first();
         expect(created[amountColumn[kind]]).to.equal(expected);
         const old = kind === 'payment' ? receipt : kind === 'writeoff' ? credit : hold;
         if (kind === 'payment') receipt = created; else if (kind === 'writeoff') credit = created; else hold = created;
         try {
            ok(await send(kind, { unitCost: 20 }, true));
            ok(await send(kind, { unitCost: input }, true));
            const updated = await s.db(table[kind]).where({ [key[kind]]: created[key[kind]] }).first();
            expect(updated[amountColumn[kind]]).to.equal(expected);
         } finally { if (kind === 'payment') receipt = old; else if (kind === 'writeoff') credit = old; else hold = old; }
      });
   }
   for (const kind of kinds) it(`V06 ${kind} long unicode note round-trips with no financial edit`, async () => {
      const note = 'Résumé 日本語 🙂\n'.repeat(5000);
      ok(await send(kind, { note }));
      const row = await s.db(table[kind]).where({ customer_id: kind === 'payment' ? c.id : other.id }).orderBy(key[kind], 'desc').first();
      expect(row.note).to.equal(note);
      expect(row[amountColumn[kind]]).to.equal(kind === 'retainer' ? '-100.00' : '-10.00');
   });
   it('V01 omitted retainer amount allows metadata update but explicit NaN cannot do so', async () => {
      const before = await s.db(table.retainer).where({ retainer_id: hold.retainer_id }).first();
      ok(await send('retainer', { unitCost: undefined, note: 'metadata only' }, true));
      const after = await s.db(table.retainer).where({ retainer_id: hold.retainer_id }).first();
      expect(after.starting_amount).to.equal(before.starting_amount); expect(after.current_amount).to.equal(before.current_amount);
      expect(after.note).to.equal('metadata only');
      await invalid(() => send('retainer', { unitCost: 'NaN', note: 'must not save' }, true), /amount/i);
   });
   for (const kind of ['payment', 'writeoff']) it(`V05 ${kind} leap-day create and omitted date edit preserve February29`, async () => {
      const field = kind === 'payment' ? 'transactionDate' : 'selectedDate';
      ok(await send(kind, { [field]: '2024-02-29' }));
      const row = await s.db(table[kind]).where({ customer_id: kind === 'payment' ? c.id : other.id }).orderBy(key[kind], 'desc').first();
      const old = kind === 'payment' ? receipt : credit;
      if (kind === 'payment') receipt = row; else credit = row;
      try {
         ok(await send(kind, { [field]: undefined, note: 'Date unchanged' }, true));
         const date = (await s.db(table[kind]).select(s.db.raw('??::text AS date', [kind === 'payment' ? 'payment_date' : 'writeoff_date'])).where({ [key[kind]]: row[key[kind]] }).first()).date;
         expect(date).to.equal('2024-02-29');
      } finally { if (kind === 'payment') receipt = old; else credit = old; }
   });
   it('V04 zero work and half-cent multiplication use literal expected cents', async () => {
      await s.work(other, oj, 0, { unitCost: 0 });
      await s.work(other, oj, 0.01, { quantity: 0.01, unitCost: 0.50 });
      await s.reject(() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(other, oj, 0, { quantity: 0.01, unitCost: 0.50 }) }), /times rate/i);
      for (const field of ['quantity', 'unitCost', 'totalTransaction']) for (const value of [-1, 0.005, null, '', 'NaN', 100000000]) {
         await s.reject(() => s.post('/transactions/createTransaction/1/1', { transaction: s.transaction(other, oj, 10, { [field]: value }) }), /number|decimal/i);
      }
   });
});
