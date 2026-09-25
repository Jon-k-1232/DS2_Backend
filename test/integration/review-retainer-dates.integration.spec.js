const { bootHttp, expectEnvelopeOk, uniqueName } = require('./_http');
const fixture = require('./_review-fixture');

describe('F34 inclusive invoice retainer dates', function () {
   let h, f;
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => { if (h) { await f.cleanup(); await h.close(); } });
   it('includes midnight, noon and the final microsecond of end day; excludes adjacent days and other customers', async () => {
      const c = await f.customer(), other = await f.customer();
      const invoice = await f.insert('customer_invoices', { customer_id: c.customer_id, customer_info_id: c.customer_info_id,
         invoice_number: uniqueName('F34'), invoice_date: '2026-09-24', due_date: '2026-10-10', start_date: '2026-09-24', end_date: '2026-09-24',
         beginning_balance: 0, total_payments: 0, total_charges: 100, total_write_offs: 0, total_retainers: 0, total_amount_due: 100,
         remaining_balance_on_invoice: 100, is_invoice_paid_in_full: false, created_by_user_id: 90013 });
      const dates = ['2026-09-23 23:59:59.999999', '2026-09-24 00:00:00', '2026-09-24 12:00:00', '2026-09-24 23:59:59.999999', '2026-09-25 00:00:00'];
      const rows = [];
      for (const created_at of dates) rows.push(await f.insert('customer_retainers_and_prepayments', { customer_id: c.customer_id, created_at,
         starting_amount: -100, current_amount: -100, type_of_hold: 'Retainer', is_retainer_active: true, created_by_user_id: 90013 }));
      await f.insert('customer_retainers_and_prepayments', { customer_id: other.customer_id, created_at: dates[2], starting_amount: -100,
         current_amount: -100, type_of_hold: 'Retainer', is_retainer_active: true, created_by_user_id: 90013 });
      const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/getInvoiceDetails/${invoice.customer_invoice_id}/9001/90013`));
      expect(body.invoiceRetainersData.invoiceRetainers.map(r => r.retainer_id)).to.have.members(rows.slice(1, 4).map(r => r.retainer_id));
   });
});
