/**
 * NSF reversal lifecycle against the dev fixture account: seed an invoice,
 * pay it, reverse the payment, and assert the chain, the parent mirror, and
 * the audit engine all tell the same story. Skipped when dev DB unreachable.
 */
const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { reversePayment, getCurrentChainTargets } = require('../../src/endpoints/payments/payment-logic');
const { auditCustomerLedger } = require('../../src/endpoints/accountAudit/account-audit-logic');

const CUSTOMER_ID = 900102; // Globex — unused by the other integration specs

describe('integration: payment reversal (NSF)', function () {
   this.timeout(30_000);
   let db;
   let parentInvoiceId;
   let paymentId;

   const cleanup = async () => {
      await db('customer_payments').where({ account_id: TEST_ACCOUNT_ID, customer_id: CUSTOMER_ID }).del();
      await db('customer_invoices').where({ account_id: TEST_ACCOUNT_ID, customer_id: CUSTOMER_ID }).del();
   };

   before(async function () {
      db = await requireDb.call(this);
      await cleanup();

      const [info] = await db('customer_information')
         .where({ account_id: TEST_ACCOUNT_ID, customer_id: CUSTOMER_ID })
         .select('customer_info_id');
      let customerInfoId = info?.customer_info_id;
      if (!customerInfoId) {
         const [row] = await db('customer_information')
            .insert({
               account_id: TEST_ACCOUNT_ID,
               customer_id: CUSTOMER_ID,
               customer_street: '1 Test St',
               customer_city: 'Mesa',
               customer_state: 'AZ',
               customer_zip: '85201',
               is_customer_mailing_address: true,
               is_this_address_active: true,
               created_by_user_id: TEST_ADMIN_USER_ID
            })
            .returning('customer_info_id');
         customerInfoId = row.customer_info_id || row;
      }

      const [inv] = await db('customer_invoices')
         .insert({
            account_id: TEST_ACCOUNT_ID,
            customer_id: CUSTOMER_ID,
            customer_info_id: customerInfoId,
            invoice_number: 'INV-TEST-NSF-1',
            invoice_date: '2026-06-01',
            due_date: '2026-06-17',
            beginning_balance: 0,
            total_payments: 0,
            total_charges: 500,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: 500,
            remaining_balance_on_invoice: 500,
            is_invoice_paid_in_full: false,
            created_by_user_id: TEST_ADMIN_USER_ID
         })
         .returning('customer_invoice_id');
      parentInvoiceId = inv.customer_invoice_id || inv;

      // Pay the invoice in full the same way createPayment does: snapshot + mirror.
      const [snap] = await db('customer_invoices')
         .insert({
            account_id: TEST_ACCOUNT_ID,
            customer_id: CUSTOMER_ID,
            customer_info_id: customerInfoId,
            parent_invoice_id: parentInvoiceId,
            invoice_number: 'INV-TEST-NSF-1',
            invoice_date: '2026-06-01',
            due_date: '2026-06-17',
            beginning_balance: 0,
            total_payments: 0,
            total_charges: 500,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: 500,
            remaining_balance_on_invoice: 0,
            is_invoice_paid_in_full: true,
            fully_paid_date: '2026-06-05',
            created_by_user_id: TEST_ADMIN_USER_ID
         })
         .returning('customer_invoice_id');
      const snapshotId = snap.customer_invoice_id || snap;

      const [pay] = await db('customer_payments')
         .insert({
            account_id: TEST_ACCOUNT_ID,
            customer_id: CUSTOMER_ID,
            customer_invoice_id: snapshotId,
            payment_date: '2026-06-05',
            payment_amount: -500,
            form_of_payment: 'Check',
            payment_reference_number: '1234',
            is_transaction_billable: true,
            created_by_user_id: TEST_ADMIN_USER_ID
         })
         .returning('payment_id');
      paymentId = pay.payment_id || pay;

      await db('customer_invoices')
         .where({ customer_invoice_id: parentInvoiceId })
         .update({ remaining_balance_on_invoice: 0, is_invoice_paid_in_full: true, fully_paid_date: '2026-06-05', total_payments: 500 });
   });

   after(async () => {
      if (db) await cleanup();
      await closeDb();
   });

   it('restores the debt on the current chain and un-pays the parent', async () => {
      const { message } = await reversePayment(db, {
         accountId: TEST_ACCOUNT_ID,
         userId: TEST_ADMIN_USER_ID,
         paymentId,
         reason: 'NSF — check #1234 returned'
      });
      expect(message).to.include('Reversed payment');

      const [parent] = await db('customer_invoices').where({ customer_invoice_id: parentInvoiceId });
      expect(Number(parent.remaining_balance_on_invoice)).to.equal(500);
      expect(parent.is_invoice_paid_in_full).to.equal(false);
      expect(Number(parent.total_payments)).to.equal(0);

      const targets = await getCurrentChainTargets(db, TEST_ACCOUNT_ID, CUSTOMER_ID);
      expect(targets[0].remaining).to.equal(500);

      const reversalRows = await db('customer_payments')
         .where({ account_id: TEST_ACCOUNT_ID, customer_id: CUSTOMER_ID })
         .andWhere('payment_amount', '>', 0);
      expect(reversalRows).to.have.lengthOf(1);
      expect(reversalRows[0].form_of_payment).to.equal('Reversal');
   });

   it('audit agrees: net paid is zero and outstanding equals the restored debt', async () => {
      const [customer] = await db('customers').where({ customer_id: CUSTOMER_ID });
      const invoices = await db('customer_invoices').where({ account_id: TEST_ACCOUNT_ID, customer_id: CUSTOMER_ID });
      const payments = await db('customer_payments').where({ account_id: TEST_ACCOUNT_ID, customer_id: CUSTOMER_ID });

      const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs: [], transactions: [], retainers: [] });
      expect(audit.totals.total_paid).to.equal(0); // -500 payment + +500 reversal
      expect(audit.totals.outstanding_invoices).to.equal(500);

      const chainRow = audit.invoice_breakdown.find(r => r.invoice_number === 'INV-TEST-NSF-1');
      expect(chainRow.paid_against_invoice).to.equal(0);
   });

   it('refuses to reverse twice or reverse a reversal', async () => {
      let error = null;
      try {
         await reversePayment(db, { accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, paymentId, reason: 'again' });
      } catch (err) {
         error = err;
      }
      expect(error).to.exist;
      expect(error.message).to.include('already been reversed');

      const [reversalRow] = await db('customer_payments')
         .where({ account_id: TEST_ACCOUNT_ID, customer_id: CUSTOMER_ID })
         .andWhere('payment_amount', '>', 0);
      let error2 = null;
      try {
         await reversePayment(db, { accountId: TEST_ACCOUNT_ID, userId: TEST_ADMIN_USER_ID, paymentId: reversalRow.payment_id, reason: 'nope' });
      } catch (err) {
         error2 = err;
      }
      expect(error2).to.exist;
      expect(error2.message).to.include('already a reversal');
   });
});
