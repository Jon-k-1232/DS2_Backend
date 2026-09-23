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
         // total_payments uses the same negative-net sign convention as the
         // customer_payments rows: -500 = $500 received against this invoice.
         .update({ remaining_balance_on_invoice: 0, is_invoice_paid_in_full: true, fully_paid_date: '2026-06-05', total_payments: -500 });
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

// ─────────────────────────────────────────────────────────────────────────────
// Ledger CRUD integrity (2026-09 review). Every scenario runs on its own fresh
// customer on the fixture account and is removed in `after`. Invoice numbers
// start with 'A-LEDGER-' so they neither match the production format nor sort
// above 'INV-…' (a concurrent finalize picks the account's largest number).
// ─────────────────────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const config = require('../../config');
const {
   buildCreatePaymentInput,
   createPaymentCore,
   updatePaymentCore,
   deletePaymentCore,
   checkIfPaymentIsAttachedToInvoice
} = require('../../src/endpoints/payments/payment-logic');
const { restoreDataTypesPaymentsTableOnUpdate } = require('../../src/endpoints/payments/paymentsObjects');
const { createWriteOffCore, updateWriteOffCore, deleteWriteOffCore } = require('../../src/endpoints/writeOffs/writeOffs-logic');
const { restoreDataTypesWriteOffsTableOnCreate, restoreDataTypesWriteOffsTableOnUpdate } = require('../../src/endpoints/writeOffs/writeOffsObjects');
const { findMatchingRetainer, createRetainerCore, updateRetainerCore, deleteRetainerCore } = require('../../src/endpoints/retainer/retainer-logic');
const { restoreDataTypesRetainersTableOnCreate, restoreDataTypesRetainersTableOnUpdate } = require('../../src/endpoints/retainer/retainerObjects');
const retainersService = require('../../src/endpoints/retainer/retainer-service');

describe('integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval)', function () {
   this.timeout(120_000);

   const A = TEST_ACCOUNT_ID;
   const U = TEST_ADMIN_USER_ID;
   const GWD_ID = 90031; // seed: 'Tax Return Preparation'
   const JOB_TYPE_ID = 900201; // seed: '1040 Individual Return'
   const num = v => Number(v);
   const today = () => dayjs().format('YYYY-MM-DD');
   const daysAgo = n => dayjs().subtract(n, 'day').format('YYYY-MM-DD');
   const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

   let db;
   let app;
   let token;
   const createdCustomers = [];
   const createdPending = [];

   // ── fixtures ──────────────────────────────────────────────────────────────
   const makeCustomer = async label => {
      const [c] = await db('customers')
         .insert({
            account_id: A,
            customer_name: `Ledger ${label}`,
            display_name: `Ledger CRUD ${label} ${stamp()}`,
            is_commercial_customer: false,
            is_customer_active: true,
            is_billable: true,
            is_recurring: false
         })
         .returning('customer_id');
      const customerId = c.customer_id || c;
      createdCustomers.push(customerId);
      const [info] = await db('customer_information')
         .insert({
            account_id: A,
            customer_id: customerId,
            customer_street: '1 Ledger Way',
            customer_city: 'Mesa',
            customer_state: 'AZ',
            customer_zip: '85201',
            is_this_address_active: true,
            is_customer_physical_address: true,
            is_customer_billing_address: true,
            is_customer_mailing_address: true,
            created_by_user_id: U
         })
         .returning('customer_info_id');
      return { customerId, infoId: info.customer_info_id || info, label };
   };

   const makeParent = async (cust, { date, total, remaining = total, bb = 0, notes = null }) => {
      const [row] = await db('customer_invoices')
         .insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_info_id: cust.infoId,
            invoice_number: `A-LEDGER-${cust.customerId}-${stamp()}`,
            invoice_date: date,
            due_date: date,
            beginning_balance: bb,
            total_payments: 0,
            total_charges: total - bb,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: total,
            remaining_balance_on_invoice: remaining,
            is_invoice_paid_in_full: remaining === 0,
            created_by_user_id: U,
            notes
         })
         .returning('*');
      return row;
   };

   const makeRetainer = async (cust, amount, extra = {}) => {
      const [row] = await db('customer_retainers_and_prepayments')
         .insert({
            parent_retainer_id: null,
            customer_id: cust.customerId,
            account_id: A,
            display_name: `Retainer ${cust.label}`,
            type_of_hold: 'Retainer',
            starting_amount: -amount,
            current_amount: -amount,
            form_of_payment: 'Check',
            payment_reference_number: 'R-1',
            is_retainer_active: true,
            created_by_user_id: U,
            ...extra
         })
         .returning('*');
      return row;
   };

   const makeJob = async cust => {
      const [row] = await db('customer_jobs')
         .insert({ account_id: A, customer_id: cust.customerId, job_type_id: JOB_TYPE_ID, current_job_total: 0, is_quote: false, is_job_complete: false, created_by_user_id: U })
         .returning('customer_job_id');
      return row.customer_job_id || row;
   };

   const paymentForm = (cust, invoiceId, amount, extra = {}) => ({
      accountID: A,
      customerID: cust.customerId,
      selectedInvoiceID: invoiceId,
      selectedRetainerID: null,
      selectedJobID: null,
      transactionDate: today(),
      unitCost: amount,
      formOfPayment: 'Check',
      paymentReferenceNumber: 'T-1',
      isTransactionBillable: true,
      loggedByUserID: U,
      note: null,
      ...extra
   });
   const pay = (cust, invoiceId, amount, extra) => createPaymentCore(db, buildCreatePaymentInput(paymentForm(cust, invoiceId, amount, extra), A));
   const editPayment = (paymentId, form) => updatePaymentCore(db, { accountId: A, paymentFields: { ...restoreDataTypesPaymentsTableOnUpdate({ paymentID: paymentId, ...form }), account_id: A } });
   const writeOffForm = (cust, extra = {}) => ({ accountID: A, customerID: cust.customerId, selectedDate: today(), writeoffReason: 'Courtesy', loggedByUserID: U, note: null, ...extra });
   const writeOff = (cust, extra) => createWriteOffCore(db, { accountId: A, writeOffFields: restoreDataTypesWriteOffsTableOnCreate(writeOffForm(cust, extra)) });
   const editWriteOff = form => updateWriteOffCore(db, { accountId: A, writeOffFields: { ...restoreDataTypesWriteOffsTableOnUpdate(form), account_id: A } });

   const invoiceRow = id => db('customer_invoices').where({ customer_invoice_id: id }).first();
   const childrenOf = parentId => db('customer_invoices').where({ account_id: A, parent_invoice_id: parentId }).orderBy([{ column: 'created_at' }, { column: 'customer_invoice_id' }]);
   const paymentRow = id => db('customer_payments').where({ account_id: A, payment_id: id }).first();
   const retainerRow = id => db('customer_retainers_and_prepayments').where({ account_id: A, retainer_id: id }).first();
   const chainOf = rootId => db('customer_retainers_and_prepayments').where({ account_id: A }).andWhere(b => b.where('retainer_id', rootId).orWhere('parent_retainer_id', rootId)).orderBy([{ column: 'created_at' }, { column: 'retainer_id' }]);

   const rejects = async (promise, fragment) => {
      let error = null;
      try {
         await promise;
      } catch (err) {
         error = err;
      }
      expect(error, `expected a rejection containing "${fragment}"`).to.be.an('error');
      expect(error.message).to.include(fragment);
      return error;
   };

   const authed = req => req.set('Authorization', `Bearer ${token}`);
   const http = {
      post: (url, body) => authed(supertest(app).post(url).send(body)),
      put: (url, body) => authed(supertest(app).put(url).send(body)),
      del: (url, body) => authed(supertest(app).delete(url).send(body))
   };

   before(async function () {
      db = await requireDb.call(this);
      app = require('../../src/app');
      app.set('db', db);
      token = jwt.sign({ user_id: U }, config.JWT_SECRET, { subject: 'admin+test@example.com', expiresIn: '1h', algorithm: 'HS256' });
   });

   after(async () => {
      if (db) {
         if (createdPending.length) await db('customer_payments_processed').where({ account_id: A }).whereIn('payment_id', createdPending).del();
         for (const id of createdCustomers) {
            const where = { account_id: A, customer_id: id };
            await db('customer_payments').where(where).del();
            await db('customer_writeoffs').where(where).del();
            await db('customer_transactions').where(where).del();
            await db('customer_retainers_and_prepayments').where(where).del();
            await db('customer_invoices').where(where).whereNotNull('parent_invoice_id').del();
            await db('customer_invoices').where(where).del();
            await db('customer_jobs').where(where).del();
            await db('customer_information').where(where).del();
            await db('customers').where(where).del();
         }
      }
      await closeDb();
   });

   // ── B1 ────────────────────────────────────────────────────────────────────
   describe('payment delete never touches unrelated retainers (B1)', () => {
      it('HTTP delete of a plain payment leaves every retainer row untouched and restores the chain exactly', async () => {
         const other = await makeCustomer('retainer-owner');
         const cust = await makeCustomer('plain-delete');
         const otherRoot = await makeRetainer(other, 250);
         const ownRoot = await makeRetainer(cust, 300);
         const parent = await makeParent(cust, { date: daysAgo(3), total: 500 });

         const { payment, snapshot } = await pay(cust, parent.customer_invoice_id, 120);
         expect(payment.retainer_id).to.equal(null);

         // The rows the old `parent_retainer_id IS NULL AND created_at <= payment` query matched.
         const retainersBefore = await db('customer_retainers_and_prepayments').where({ account_id: A }).andWhere('created_at', '<=', payment.created_at).orderBy('retainer_id');
         expect(retainersBefore.map(r => r.retainer_id)).to.include.members([otherRoot.retainer_id, ownRoot.retainer_id]);

         // Mirrors DeletePayment.js — the form object is sent back as the payload.
         const res = await http.del(`/payments/deletePayment/${A}/${U}`, {
            payment: { paymentID: payment.payment_id, accountID: A, customerID: cust.customerId, selectedRetainerID: null, selectedInvoiceID: snapshot.customer_invoice_id, unitCost: -120 }
         });
         expect(res.status).to.equal(200);
         expect(res.body.status, res.body.message).to.equal(200);
         expect(res.body.message).to.equal('Successfully deleted payment.');

         const retainersAfter = await db('customer_retainers_and_prepayments')
            .whereIn(
               'retainer_id',
               retainersBefore.map(r => r.retainer_id)
            )
            .orderBy('retainer_id');
         expect(retainersAfter, 'no retainer row deleted or changed').to.deep.equal(retainersBefore);

         expect(await paymentRow(payment.payment_id)).to.equal(undefined);
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(500);
         expect(num(parentNow.total_payments)).to.equal(0);
         expect(parentNow.is_invoice_paid_in_full).to.equal(false);
      });

      it('retainer-funded payments draw from the chain LATEST balance and delete/edit only their own draw snapshot', async () => {
         const bystander = await makeCustomer('bystander');
         const bystanderRoot = await makeRetainer(bystander, 90);
         const cust = await makeCustomer('retainer-funded');
         const root = await makeRetainer(cust, 300);
         const parent = await makeParent(cust, { date: daysAgo(3), total: 500 });

         const first = await pay(cust, parent.customer_invoice_id, 120, { selectedRetainerID: root.retainer_id });
         let chain = await chainOf(root.retainer_id);
         expect(chain).to.have.lengthOf(2);
         const draw1 = chain[1];
         expect(draw1.parent_retainer_id).to.equal(root.retainer_id);
         expect(num(draw1.current_amount)).to.equal(-180);
         expect(draw1.is_retainer_active).to.equal(true);
         expect(first.payment.retainer_id).to.equal(root.retainer_id);

         // A stale picker still offering the ROOT id must draw from the latest
         // balance (-180), not rebuild from the root's -300.
         const second = await pay(cust, parent.customer_invoice_id, 50, { selectedRetainerID: root.retainer_id });
         chain = await chainOf(root.retainer_id);
         expect(chain).to.have.lengthOf(3);
         const draw2 = chain[2];
         expect(num(draw2.current_amount)).to.equal(-130);

         await rejects(pay(cust, parent.customer_invoice_id, 200, { selectedRetainerID: draw2.retainer_id }), 'Max amount that can be applied to this invoice is $130.');
         expect(await chainOf(root.retainer_id)).to.have.lengthOf(3);

         await rejects(deletePaymentCore(db, { accountId: A, paymentId: first.payment.payment_id }), 'A newer payment or write-off has been applied to this invoice');

         // Re-price the latest retainer-funded payment: invoice snapshot, parent
         // mirror and the retainer draw move together.
         await editPayment(second.payment.payment_id, { customerID: cust.customerId, selectedInvoiceID: second.snapshot.customer_invoice_id, selectedRetainerID: root.retainer_id, unitCost: 70 });
         expect(num((await invoiceRow(second.snapshot.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(310);
         let parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(310);
         expect(num(parentNow.total_payments)).to.equal(-190);
         expect(num((await retainerRow(draw2.retainer_id)).current_amount)).to.equal(-110);
         expect(num((await paymentRow(second.payment.payment_id)).payment_amount)).to.equal(-70);

         await deletePaymentCore(db, { accountId: A, paymentId: second.payment.payment_id });
         chain = await chainOf(root.retainer_id);
         expect(chain.map(r => r.retainer_id)).to.deep.equal([root.retainer_id, draw1.retainer_id]);
         parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(380);
         expect(num(parentNow.total_payments)).to.equal(-120);

         await deletePaymentCore(db, { accountId: A, paymentId: first.payment.payment_id });
         chain = await chainOf(root.retainer_id);
         expect(chain.map(r => r.retainer_id), 'only the root is left').to.deep.equal([root.retainer_id]);
         expect(num(chain[0].current_amount)).to.equal(-300);
         parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(500);
         expect(num(parentNow.total_payments)).to.equal(0);

         expect(await retainerRow(bystanderRoot.retainer_id), 'another customer’s retainer untouched').to.deep.equal(bystanderRoot);
      });

      it('refuses to delete a payment whose retainer draw belongs to a time/charge entry', async () => {
         const cust = await makeCustomer('txn-draw');
         const root = await makeRetainer(cust, 200);
         const jobId = await makeJob(cust);
         // What transactions addNewTransaction writes: draw snapshot, 'Retainer'
         // payment (no invoice), transaction pointing at the draw snapshot.
         const [draw] = await db('customer_retainers_and_prepayments')
            .insert({ ...root, retainer_id: undefined, created_at: undefined, parent_retainer_id: root.retainer_id, current_amount: -150 })
            .returning('*');
         const [autoPayment] = await db('customer_payments')
            .insert({ account_id: A, customer_id: cust.customerId, retainer_id: root.retainer_id, payment_date: today(), payment_amount: -50, form_of_payment: 'Retainer', payment_reference_number: 'Retainer', is_transaction_billable: true, created_by_user_id: U })
            .returning('*');
         const [txn] = await db('customer_transactions')
            .insert({
               account_id: A,
               customer_id: cust.customerId,
               customer_job_id: jobId,
               retainer_id: draw.retainer_id,
               logged_for_user_id: U,
               general_work_description_id: GWD_ID,
               transaction_date: today(),
               transaction_type: 'Time',
               quantity: 1,
               unit_cost: 50,
               total_transaction: 50,
               is_transaction_billable: true,
               is_excess_to_subscription: false,
               created_by_user_id: U
            })
            .returning('transaction_id');

         await rejects(deletePaymentCore(db, { accountId: A, paymentId: autoPayment.payment_id }), `retainer-funded time/charge entry #${txn.transaction_id || txn}`);
         expect(await paymentRow(autoPayment.payment_id)).to.exist;
         expect(await retainerRow(draw.retainer_id)).to.exist;
      });
   });

   // ── B2 ────────────────────────────────────────────────────────────────────
   describe('billed immutability from stored rows and the statement TIMESTAMP (B2)', () => {
      it('a payment / write-off entered on bill day BEFORE the run is billed; one entered after the run is not', async () => {
         const cust = await makeCustomer('billed-gate');
         const noBills = await makeCustomer('never-billed');
         const p1 = await makeParent(cust, { date: daysAgo(5), total: 400 });

         const early = await pay(cust, p1.customer_invoice_id, 100); // today, before the run
         const earlyWriteOff = await writeOff(cust, { customerInvoiceID: p1.customer_invoice_id, unitCost: 25 });

         // Today's bill run: a new parent dated TODAY, created after both entries.
         const p2 = await makeParent(cust, { date: today(), total: 275, bb: 275 });

         await rejects(deletePaymentCore(db, { accountId: A, paymentId: early.payment.payment_id }), 'Payment is attached to an invoice and cannot be deleted or Modified.');
         await rejects(editPayment(early.payment.payment_id, { unitCost: 90 }), 'Payment is attached to an invoice and cannot be deleted or Modified.');
         // The client-sent customer no longer picks whose bill date gates the check.
         await rejects(
            checkIfPaymentIsAttachedToInvoice(db, { payment_id: early.payment.payment_id, account_id: A, customer_id: noBills.customerId }),
            'Payment is attached to an invoice and cannot be deleted or Modified.'
         );

         const billedWriteOffMessage = 'Write-off is attached to an invoice that has already been billed and cannot be deleted or modified.';
         await rejects(deleteWriteOffCore(db, { accountId: A, writeoffId: earlyWriteOff.writeOff.writeoff_id }), billedWriteOffMessage);
         await rejects(editWriteOff({ writeoffID: earlyWriteOff.writeOff.writeoff_id, customerID: noBills.customerId, unitCost: 30 }), billedWriteOffMessage);

         // Entered after the run, same day → still editable.
         const late = await pay(cust, p2.customer_invoice_id, 50);
         await editPayment(late.payment.payment_id, { unitCost: 60 });
         expect(num((await paymentRow(late.payment.payment_id)).payment_amount)).to.equal(-60);
         await deletePaymentCore(db, { accountId: A, paymentId: late.payment.payment_id });
         const p2Now = await invoiceRow(p2.customer_invoice_id);
         expect(num(p2Now.remaining_balance_on_invoice)).to.equal(275);
         expect(num(p2Now.total_payments)).to.equal(0);
      });
   });

   // ── B3 ────────────────────────────────────────────────────────────────────
   describe('multi-row ledger mutations are atomic and serialized per customer (B3)', () => {
      it('a failure after the snapshot insert leaves no orphan snapshot and no mirror change', async () => {
         const cust = await makeCustomer('atomic');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 500 });

         // created_by_user_id violates the users FK on the payment insert — the
         // statement AFTER the snapshot insert and before the parent mirror.
         await rejects(pay(cust, parent.customer_invoice_id, 100, { loggedByUserID: 987654321 }), 'foreign key');
         await rejects(writeOff(cust, { customerInvoiceID: parent.customer_invoice_id, unitCost: 40, loggedByUserID: 987654321 }), 'foreign key');

         expect(await childrenOf(parent.customer_invoice_id), 'no orphan snapshot').to.have.lengthOf(0);
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(500);
         expect(num(parentNow.total_payments)).to.equal(0);
         expect(num(parentNow.total_write_offs)).to.equal(0);
      });

      it('a second payment on the same chain waits for the first and builds on its snapshot (no lost update)', async () => {
         const cust = await makeCustomer('race');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 500 });

         // Hold the first payment's transaction open, then start a second one.
         const trx = await db.transaction();
         let second;
         let settled = false;
         try {
            await createPaymentCore(trx, buildCreatePaymentInput(paymentForm(cust, parent.customer_invoice_id, 300), A));
            second = pay(cust, parent.customer_invoice_id, 300).finally(() => {
               settled = true;
            });
            second.catch(() => {}); // asserted below
            await new Promise(resolve => setTimeout(resolve, 300));
            expect(settled, 'the second payment waits on the customer ledger lock').to.equal(false);
            await trx.commit();
         } catch (err) {
            await trx.rollback().catch(() => {});
            throw err;
         }

         // After the lock is released it sees the first snapshot ($200 left) and refuses,
         // instead of writing a second snapshot built on the stale $500.
         await rejects(second, 'Payment amount exceeds remaining balance');
         const children = await childrenOf(parent.customer_invoice_id);
         expect(children).to.have.lengthOf(1);
         expect(num(children[0].remaining_balance_on_invoice)).to.equal(200);
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(200);
         expect(num(parentNow.total_payments)).to.equal(-300);
      });
   });

   // ── item 4: retainers ─────────────────────────────────────────────────────
   describe('retainers: picker, draw validation, update and delete (item 4)', () => {
      it('the picker skips an exhausted chain instead of resurrecting its root', async () => {
         const cust = await makeCustomer('picker');
         const exhausted = await makeRetainer(cust, 100);
         await db('customer_retainers_and_prepayments').insert({
            ...exhausted,
            retainer_id: undefined,
            created_at: undefined,
            parent_retainer_id: exhausted.retainer_id,
            current_amount: 0,
            is_retainer_active: false
         });
         const live = await makeRetainer(cust, 50);

         const offered = await retainersService.getMostRecentRecordOfCustomerRetainers(db, A, cust.customerId);
         expect(offered.map(r => r.retainer_id)).to.deep.equal([live.retainer_id]);

         await rejects(findMatchingRetainer(db, exhausted.retainer_id, A, -10, cust.customerId), 'no remaining balance');
         const other = await makeCustomer('picker-other');
         await rejects(findMatchingRetainer(db, live.retainer_id, A, -10, other.customerId), 'belongs to a different customer');
      });

      it('updating the starting amount shifts the whole chain and keeps the draw history', async () => {
         const cust = await makeCustomer('retainer-update');
         const root = await makeRetainer(cust, 300);
         const [draw] = await db('customer_retainers_and_prepayments')
            .insert({ ...root, retainer_id: undefined, created_at: undefined, parent_retainer_id: root.retainer_id, current_amount: -180 })
            .returning('*');
         const edit = form =>
            updateRetainerCore(db, {
               accountId: A,
               retainerFields: {
                  ...restoreDataTypesRetainersTableOnUpdate({ retainerID: root.retainer_id, customerID: cust.customerId, typeOfHold: 'Retainer', ...form }),
                  account_id: A
               }
            });

         await edit({ unitCost: -400, displayName: 'Renamed retainer' });
         let chain = await chainOf(root.retainer_id);
         expect(chain.map(r => num(r.starting_amount))).to.deep.equal([-400, -400]);
         expect(chain.map(r => num(r.current_amount)), 'the $120 already drawn stays drawn').to.deep.equal([-400, -280]);
         expect(chain.map(r => r.display_name)).to.deep.equal(['Renamed retainer', 'Renamed retainer']);
         expect(chain.every(r => r.is_retainer_active)).to.equal(true);

         await rejects(edit({ unitCost: -100 }), 'Starting amount cannot be less than the $120.00 already drawn from this retainer.');

         await edit({ unitCost: -120 });
         chain = await chainOf(root.retainer_id);
         expect(num(chain[1].current_amount)).to.equal(0);
         expect(chain[1].is_retainer_active, 'a $0 balance is inactive').to.equal(false);
         expect(await retainersService.getMostRecentRecordOfCustomerRetainers(db, A, cust.customerId)).to.have.lengthOf(0);

         // Editing via the snapshot row moves the chain too (the grid shows every row).
         await updateRetainerCore(db, {
            accountId: A,
            retainerFields: { ...restoreDataTypesRetainersTableOnUpdate({ retainerID: draw.retainer_id, customerID: cust.customerId, unitCost: -150 }), account_id: A }
         });
         chain = await chainOf(root.retainer_id);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-150, -30]);
         expect(chain[1].is_retainer_active).to.equal(true);

         const other = await makeCustomer('retainer-move');
         await rejects(edit({ customerID: other.customerId, unitCost: -150 }), 'Moving a retainer to a different customer is not supported.');
      });

      it('delete refuses while any chain row is drawn on or referenced, and removes an unused root', async () => {
         const cust = await makeCustomer('retainer-delete');
         const drawn = await makeRetainer(cust, 200);
         const [drawRow] = await db('customer_retainers_and_prepayments')
            .insert({ ...drawn, retainer_id: undefined, created_at: undefined, parent_retainer_id: drawn.retainer_id, current_amount: -150 })
            .returning('*');
         await rejects(deleteRetainerCore(db, { accountId: A, retainerId: drawn.retainer_id }), 'has already been drawn on');
         await rejects(deleteRetainerCore(db, { accountId: A, retainerId: drawRow.retainer_id }), 'draw-down entry');

         const paidFrom = await makeRetainer(cust, 80);
         await db('customer_payments').insert({ account_id: A, customer_id: cust.customerId, retainer_id: paidFrom.retainer_id, payment_date: today(), payment_amount: -10, form_of_payment: 'Retainer', is_transaction_billable: true, created_by_user_id: U });
         await rejects(deleteRetainerCore(db, { accountId: A, retainerId: paidFrom.retainer_id }), 'Payments are linked to this retainer');

         const workedFrom = await makeRetainer(cust, 70);
         const jobId = await makeJob(cust);
         await db('customer_transactions').insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_job_id: jobId,
            retainer_id: workedFrom.retainer_id,
            logged_for_user_id: U,
            general_work_description_id: GWD_ID,
            transaction_date: today(),
            transaction_type: 'Time',
            quantity: 1,
            unit_cost: 10,
            total_transaction: 10,
            is_transaction_billable: true,
            is_excess_to_subscription: false,
            created_by_user_id: U
         });
         await rejects(deleteRetainerCore(db, { accountId: A, retainerId: workedFrom.retainer_id }), 'Transactions are linked to this retainer');

         const unused = await makeRetainer(cust, 60);
         await deleteRetainerCore(db, { accountId: A, retainerId: unused.retainer_id });
         expect(await retainerRow(unused.retainer_id)).to.equal(undefined);
         expect(await retainerRow(drawn.retainer_id)).to.exist;
      });
   });

   // ── A5-1 (2026-09 review round 5): a client-supplied cancellation marker
   // must never reach storage on retainer CREATE — otherwise a brand-new
   // retainer looks like it was already cancelled by a reversal that never
   // happened, and every later amount edit / delete refuses accordingly. ──
   describe('A5-1 — retainer creation strips a client-supplied cancellation marker', () => {
      const editRetainer = (id, cust, form) =>
         updateRetainerCore(db, { accountId: A, retainerFields: { ...restoreDataTypesRetainersTableOnUpdate({ retainerID: id, customerID: cust.customerId, ...form }), account_id: A } });

      it('create → note edit → amount edit → delete all succeed; the fabricated marker never survives', async () => {
         const cust = await makeCustomer('a51-fake-cancel');

         const created = await createRetainerCore(db, {
            accountId: A,
            retainerFields: restoreDataTypesRetainersTableOnCreate({
               customerID: cust.customerId,
               accountID: A,
               displayName: 'Fake-cancelled prepayment',
               typeOfHold: 'Prepayment',
               unitCost: 50,
               formOfPayment: 'Check',
               paymentReferenceNumber: 'FAKE-1',
               loggedByUserID: U,
               note: 'client note [cancelled by reversal of payment #999999]'
            })
         });
         expect(num(created.current_amount)).to.equal(-50);
         expect(created.note, 'the fabricated marker never reaches storage on create').to.equal('client note');

         // A note edit that types the same fake marker back in must not
         // resurrect it either — preserveSystemMarkers only restores markers
         // the STORED note actually carries, and this one never did.
         await editRetainer(created.retainer_id, cust, { unitCost: 50, note: 'edited [cancelled by reversal of payment #999999]' });
         expect((await retainerRow(created.retainer_id)).note).to.equal('edited');

         // Nothing thinks this retainer was ever cancelled, so a genuine
         // amount edit succeeds...
         await editRetainer(created.retainer_id, cust, { unitCost: 80 });
         expect(num((await retainerRow(created.retainer_id)).current_amount)).to.equal(-80);

         // ...and so does a genuine delete (it is unused, no draws).
         await deleteRetainerCore(db, { accountId: A, retainerId: created.retainer_id });
         expect(await retainerRow(created.retainer_id)).to.equal(undefined);
      });

      it('a GENUINE cancellation marker (written by an actual NSF-of-overpayment reversal) still blocks edits and deletes', async () => {
         // Regression guard: A5-1 must only stop a CLIENT-supplied marker from
         // reaching storage on create — it must not weaken the existing
         // protection for a marker the server itself wrote (see the seam-6
         // "NSF reversal of an overpayment split" tests for the full lifecycle).
         const cust = await makeCustomer('a51-genuine-cancel-still-blocks');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 100 });
         const { reversePayment: reverse } = require('../../src/endpoints/payments/payment-logic');
         const { payment, prepaymentRetainer } = await pay(cust, parent.customer_invoice_id, 150, { captureOverpayment: true, note: 'genuine split' });

         await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF' });

         await rejects(editRetainer(prepaymentRetainer.retainer_id, cust, { unitCost: 80 }), `was cancelled by the reversal of payment #${payment.payment_id}`);
         await rejects(deleteRetainerCore(db, { accountId: A, retainerId: prepaymentRetainer.retainer_id }), `cancelled by the reversal of payment #${payment.payment_id}`);
      });
   });

   // ── item 5: write-offs ────────────────────────────────────────────────────
   describe('write-offs follow the payment chain rules (item 5)', () => {
      it('remaps an absorbed-chain reference, refuses cross-customer/over-remaining, re-prices and deletes symmetrically', async () => {
         const cust = await makeCustomer('writeoffs');
         const stranger = await makeCustomer('writeoffs-stranger');
         const absorbed = await makeParent(cust, { date: daysAgo(40), total: 300, remaining: 0, notes: '[absorbed_by:A-LEDGER-X@2026-01-01]' });
         const current = await makeParent(cust, { date: daysAgo(5), total: 300, bb: 300 });
         const strangerInvoice = await makeParent(stranger, { date: daysAgo(5), total: 100 });

         const created = await writeOff(cust, { customerInvoiceID: absorbed.customer_invoice_id, unitCost: 50, note: 'goodwill' });
         expect(created.message).to.include(`Applied to current invoice ${current.invoice_number}`);
         const [snap] = await childrenOf(current.customer_invoice_id);
         expect(created.writeOff.customer_invoice_id, 'linked to a snapshot of the CURRENT chain').to.equal(snap.customer_invoice_id);
         expect(num(created.writeOff.writeoff_amount)).to.equal(-50);
         expect(created.writeOff.note).to.equal(`goodwill [applied to ${current.invoice_number}; referenced ${absorbed.invoice_number}]`);
         let currentNow = await invoiceRow(current.customer_invoice_id);
         expect(num(currentNow.remaining_balance_on_invoice)).to.equal(250);
         expect(num(currentNow.total_write_offs)).to.equal(-50);
         const absorbedNow = await invoiceRow(absorbed.customer_invoice_id);
         expect(num(absorbedNow.remaining_balance_on_invoice)).to.equal(0);
         expect(num(absorbedNow.total_write_offs)).to.equal(0);
         expect(await childrenOf(absorbed.customer_invoice_id)).to.have.lengthOf(0);

         await rejects(writeOff(cust, { customerInvoiceID: strangerInvoice.customer_invoice_id, unitCost: 10 }), 'belongs to a different customer');
         await rejects(writeOff(cust, { customerInvoiceID: current.customer_invoice_id, unitCost: 1000 }), 'Write-off amount exceeds remaining balance');

         const id = created.writeOff.writeoff_id;
         await rejects(editWriteOff({ writeoffID: id, customerID: cust.customerId, customerInvoiceID: current.customer_invoice_id, unitCost: 80 }), 'Moving a write-off to a different invoice is not supported.');
         await rejects(editWriteOff({ writeoffID: id, customerID: stranger.customerId, unitCost: 80 }), 'Moving a write-off to a different customer is not supported.');

         await editWriteOff({ writeoffID: id, customerID: cust.customerId, customerInvoiceID: snap.customer_invoice_id, unitCost: 80, note: 'bigger courtesy' });
         expect(num((await invoiceRow(snap.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(220);
         currentNow = await invoiceRow(current.customer_invoice_id);
         expect(num(currentNow.remaining_balance_on_invoice)).to.equal(220);
         expect(num(currentNow.total_write_offs)).to.equal(-80);
         const storedWriteOff = await db('customer_writeoffs').where({ writeoff_id: id }).first();
         expect(num(storedWriteOff.writeoff_amount)).to.equal(-80);
         expect(storedWriteOff.customer_invoice_id).to.equal(snap.customer_invoice_id);
         expect(storedWriteOff.note, 'the remap marker survives a note edit').to.equal(`bigger courtesy [applied to ${current.invoice_number}; referenced ${absorbed.invoice_number}]`);

         const later = await pay(cust, current.customer_invoice_id, 20);
         await rejects(deleteWriteOffCore(db, { accountId: A, writeoffId: id }), 'A newer payment or write-off has been applied to this invoice since this write-off.');
         await deletePaymentCore(db, { accountId: A, paymentId: later.payment.payment_id });
         await deleteWriteOffCore(db, { accountId: A, writeoffId: id });

         currentNow = await invoiceRow(current.customer_invoice_id);
         expect(num(currentNow.remaining_balance_on_invoice)).to.equal(300);
         expect(num(currentNow.total_write_offs)).to.equal(0);
         expect(num(currentNow.total_payments)).to.equal(0);
         expect(await childrenOf(current.customer_invoice_id)).to.have.lengthOf(0);
      });

      it('job-level write-offs create no snapshot and must credit one of the customer’s own jobs', async () => {
         const cust = await makeCustomer('job-writeoff');
         const other = await makeCustomer('job-writeoff-other');
         const ownJob = await makeJob(cust);
         const otherJob = await makeJob(other);

         await rejects(writeOff(cust, { selectedJobID: otherJob, unitCost: 15 }), 'does not belong to this customer');
         const { writeOff: row } = await writeOff(cust, { selectedJobID: ownJob, unitCost: 15 });
         expect(row.customer_invoice_id).to.equal(null);
         expect(num(row.writeoff_amount)).to.equal(-15);

         await editWriteOff({ writeoffID: row.writeoff_id, customerID: cust.customerId, unitCost: 18 });
         expect(num((await db('customer_writeoffs').where({ writeoff_id: row.writeoff_id }).first()).writeoff_amount)).to.equal(-18);
         await deleteWriteOffCore(db, { accountId: A, writeoffId: row.writeoff_id });
         expect(await db('customer_writeoffs').where({ writeoff_id: row.writeoff_id }).first()).to.equal(undefined);
      });
   });

   // ── item 6: overpayment split ─────────────────────────────────────────────
   describe('overpayment split links its prepayment retainer (item 6)', () => {
      const split = async label => {
         const cust = await makeCustomer(label);
         const parent = await makeParent(cust, { date: daysAgo(3), total: 400 });
         const result = await pay(cust, parent.customer_invoice_id, 500, { captureOverpayment: true, note: 'paid in full plus extra' });
         return { cust, parent, ...result };
      };

      it('records the prepayment id on the payment and removes the untouched prepayment on delete', async () => {
         const { parent, payment, prepaymentRetainer } = await split('split-delete');
         expect(num(payment.payment_amount)).to.equal(-400);
         expect(num(prepaymentRetainer.starting_amount)).to.equal(-100);
         expect(payment.note).to.equal(
            `paid in full plus extra [overpayment split: $400.00 to ${parent.invoice_number}, $100.00 to prepayment] [prepayment_retainer:${prepaymentRetainer.retainer_id}]`
         );

         // The prepayment can't be deleted on its own — it belongs to the payment.
         await rejects(deleteRetainerCore(db, { accountId: A, retainerId: prepaymentRetainer.retainer_id }), `banked from the overpayment on payment #${payment.payment_id}`);

         const { message } = await deletePaymentCore(db, { accountId: A, paymentId: payment.payment_id });
         expect(message).to.equal('Successfully deleted payment. Also removed the $100.00 prepayment retainer banked from its overpayment.');
         expect(await retainerRow(prepaymentRetainer.retainer_id)).to.equal(undefined);
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(400);
         expect(num(parentNow.total_payments)).to.equal(0);
      });

      it('refuses the delete once the prepayment has been drawn on', async () => {
         const { payment, prepaymentRetainer } = await split('split-used');
         await db('customer_retainers_and_prepayments').insert({
            ...prepaymentRetainer,
            retainer_id: undefined,
            created_at: undefined,
            parent_retainer_id: prepaymentRetainer.retainer_id,
            current_amount: -60
         });
         await rejects(deletePaymentCore(db, { accountId: A, paymentId: payment.payment_id }), 'has already been used');
         expect(await paymentRow(payment.payment_id), 'rolled back').to.exist;
         expect(await retainerRow(prepaymentRetainer.retainer_id)).to.exist;
      });

      it('finds the prepayment of a legacy split that has no id marker', async () => {
         const { payment, prepaymentRetainer } = await split('split-legacy');
         await db('customer_payments')
            .where({ payment_id: payment.payment_id })
            .update({ note: payment.note.replace(` [prepayment_retainer:${prepaymentRetainer.retainer_id}]`, '') });
         await deletePaymentCore(db, { accountId: A, paymentId: payment.payment_id });
         expect(await retainerRow(prepaymentRetainer.retainer_id)).to.equal(undefined);
      });

      // ── A1 (2026-09 review): legacy split text is a forgeable link ──────────
      it('A1: a forged legacy-shaped split note on an unrelated payment never claims another receipt\'s already-linked prepayment', async () => {
         // The genuine receipt: $500 paid on a $400 invoice banks a real $100
         // prepayment, linked by [prepayment_retainer:N] on the genuine payment.
         const { cust, payment: genuinePayment, prepaymentRetainer } = await split('split-forgery-genuine');
         const genuineNoteBefore = genuinePayment.note;

         // An ordinary, unrelated $10 payment against a SECOND invoice for the
         // same customer, created moments later (inside the legacy 5-second
         // matching window) — [overpayment split: … $100.00 to prepayment]
         // happens to name the SAME excess amount the genuine receipt banked,
         // with no [prepayment_retainer:N] marker of its own (a genuine
         // marker is handled by the exact-link path and is not this bug).
         // buildCreatePaymentInput already strips a marker typed straight into
         // the create form (A1's mapper-level fix) — writing it directly to
         // the stored row simulates a pre-fix / hand-entered legacy note that
         // merely happens to look like a split, which the mapper fix alone
         // cannot protect against.
         const otherParent = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const forged = await pay(cust, otherParent.customer_invoice_id, 10);
         const forgedNote = `[overpayment split: $10.00 to ${otherParent.invoice_number}, $100.00 to prepayment]`;
         await db('customer_payments').where({ payment_id: forged.payment.payment_id }).update({ note: forgedNote });

         const { message } = await deletePaymentCore(db, { accountId: A, paymentId: forged.payment.payment_id });

         // The forged payment itself deletes cleanly (it is an ordinary
         // payment) but claims no prepayment — it never banked one.
         expect(message).to.equal('Successfully deleted payment.');
         expect(await paymentRow(forged.payment.payment_id)).to.equal(undefined);

         // The genuine receipt's prepayment (and the receipt itself) are
         // untouched — including its note, which the forged payment's own
         // delete must never have edited to release a prepayment that isn't its own.
         expect(await retainerRow(prepaymentRetainer.retainer_id), 'genuine prepayment survives the forged delete').to.exist;
         expect(num((await retainerRow(prepaymentRetainer.retainer_id)).current_amount)).to.equal(-100);
         const genuineNow = await paymentRow(genuinePayment.payment_id);
         expect(genuineNow, 'genuine receipt still exists').to.exist;
         expect(genuineNow.note).to.equal(genuineNoteBefore);
      });

      it('A1: the same forged note on a NOTE UPDATE cannot attach a claim to another receipt\'s prepayment either', async () => {
         const { cust, prepaymentRetainer } = await split('split-forgery-update');
         const otherParent = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const forged = await pay(cust, otherParent.customer_invoice_id, 10);

         // A note EDIT (not create) that types in the same legacy-shaped split
         // text. preserveSystemMarkers must drop it — the stored note never
         // carried it, so it is not this payment's to add.
         await editPayment(forged.payment.payment_id, {
            customerID: cust.customerId,
            selectedInvoiceID: forged.snapshot.customer_invoice_id,
            unitCost: 10,
            note: `edited [overpayment split: $10.00 to ${otherParent.invoice_number}, $100.00 to prepayment]`
         });

         expect((await paymentRow(forged.payment.payment_id)).note).to.equal('edited');

         // With the marker never actually stored, deleting the edited payment
         // still cannot resolve (and remove) the genuine receipt's prepayment.
         await deletePaymentCore(db, { accountId: A, paymentId: forged.payment.payment_id });
         expect(await retainerRow(prepaymentRetainer.retainer_id), 'genuine prepayment untouched by the edited-then-deleted forgery').to.exist;
      });
   });

   // ── A4-1 (2026-09 review round 4): nested markers must strip to a FIXED
   // POINT, not one pass — a single pass can unmask an inner marker into a
   // new, well-formed outer one instead of removing it. ────────────────────
   describe('A4-1 — nested/multilevel link markers never survive sanitisation', () => {
      it('create: a nested marker is stripped to a fixed point, never manufacturing an executable link', async () => {
         const cust = await makeCustomer('a41-nested-create');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 100 });

         // Deleting the inner [retainer_draw:1] in one pass unmasks
         // "[prepayment_retainer:999999]" — itself a real link marker. A
         // single-pass strip stops after removing the inner marker and
         // leaves the newly-exposed outer one behind; stripLinkMarkers must
         // keep stripping until a pass removes nothing further.
         const created = await pay(cust, parent.customer_invoice_id, 10, { note: 'x [prepayment_[retainer_draw:1]retainer:999999]' });

         expect(created.payment.note, 'every nested layer is stripped — nothing executable survives').to.equal('x');
      });

      it("update: a nested marker cannot manufacture a claim on another receipt's prepayment; deleting the forged payment leaves the genuine prepayment and its receipt intact", async () => {
         // The genuine receipt: $150 paid against a $100 debt banks a real $50 prepayment.
         const cust = await makeCustomer('a41-nested-update');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 100 });
         const genuine = await pay(cust, parent.customer_invoice_id, 150, { captureOverpayment: true, note: 'genuine receipt' });
         expect(num(genuine.prepaymentRetainer.starting_amount)).to.equal(-50);
         const genuineNoteBefore = genuine.payment.note;

         // A separate, unrelated $10 payment.
         const otherParent = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const forged = await pay(cust, otherParent.customer_invoice_id, 10);

         // Edit its note to a marker that only becomes
         // "[prepayment_retainer:<genuine id>]" once its inner
         // [retainer_draw:1] is stripped away — the reviewer's exact probe.
         await editPayment(forged.payment.payment_id, {
            customerID: cust.customerId,
            selectedInvoiceID: forged.snapshot.customer_invoice_id,
            unitCost: 10,
            note: `[prepayment_[retainer_draw:1]retainer:${genuine.prepaymentRetainer.retainer_id}]`
         });

         // Nothing executable was stored — the whole nested expression collapsed to nothing.
         expect((await paymentRow(forged.payment.payment_id)).note, 'the nested marker never resolves to a stored link').to.equal(null);

         const { message } = await deletePaymentCore(db, { accountId: A, paymentId: forged.payment.payment_id });
         expect(message).to.equal('Successfully deleted payment.');

         // The genuine $50 prepayment and its receipt are untouched.
         const prepaymentNow = await retainerRow(genuine.prepaymentRetainer.retainer_id);
         expect(prepaymentNow, 'genuine prepayment survives the forged delete').to.exist;
         expect(num(prepaymentNow.current_amount)).to.equal(-50);
         const genuineNow = await paymentRow(genuine.payment.payment_id);
         expect(genuineNow, 'genuine receipt still exists').to.exist;
         expect(genuineNow.note).to.equal(genuineNoteBefore);
      });

      it("belt-and-suspenders: the exact resolver refuses a [prepayment_retainer:N] link already claimed by a different payment's marker", async () => {
         // This bypasses app-level sanitisation entirely (a hand-corrupted row,
         // or data written before this fix existed) to isolate the SECOND
         // defence in resolveOverpaymentPrepayment's exact-link path: even a
         // well-formed, non-nested marker must be refused once another
         // payment's own marker already claims that prepayment — the same
         // defence the legacy (amount/date window) path already had.
         const cust = await makeCustomer('a41-claimed');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 100 });
         const genuine = await pay(cust, parent.customer_invoice_id, 150, { captureOverpayment: true, note: 'genuine receipt 2' });
         const genuineNoteBefore = genuine.payment.note;

         const otherParent = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const forged = await pay(cust, otherParent.customer_invoice_id, 20);
         await db('customer_payments')
            .where({ payment_id: forged.payment.payment_id })
            .update({ note: `[prepayment_retainer:${genuine.prepaymentRetainer.retainer_id}]` });

         const { message } = await deletePaymentCore(db, { accountId: A, paymentId: forged.payment.payment_id });
         expect(message).to.equal('Successfully deleted payment.');

         const prepaymentNow = await retainerRow(genuine.prepaymentRetainer.retainer_id);
         expect(prepaymentNow, 'genuine prepayment survives — the forged claim is refused, not honored').to.exist;
         expect(num(prepaymentNow.current_amount)).to.equal(-50);
         const genuineNow = await paymentRow(genuine.payment.payment_id);
         expect(genuineNow.note).to.equal(genuineNoteBefore);
      });
   });

   // ── A5-2 (2026-09 review round 5): client-written reversed-STATUS text ───
   // (`[reversed …]`) must never reach storage either — reversePayment /
   // checkIfPaymentIsAttachedToInvoice trust ANY note that merely CONTAINS
   // `[reversed ` as proof a payment was already reversed, so a fabricated
   // one (complete OR missing its closing bracket) would block a real NSF
   // reversal of a payment that was never actually reversed.
   describe('A5-2 — client-written "[reversed …]" status text never survives sanitisation', () => {
      const { reversePayment: reverse } = require('../../src/endpoints/payments/payment-logic');

      it('create: a complete fabricated "[reversed …]" marker is stripped; the payment can still be NSF-reversed', async () => {
         const cust = await makeCustomer('a52-reversed-create');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const created = await pay(cust, parent.customer_invoice_id, 10, { note: 'Quoted [reversed 2026-09-23: example]' });
         expect(created.payment.note, 'the fabricated status text never reaches storage on create').to.equal('Quoted');

         const result = await reverse(db, { accountId: A, userId: U, paymentId: created.payment.payment_id, reason: 'NSF — never actually reversed before' });
         expect(result.message).to.include('Reversed payment');
      });

      it('update: the same fabricated marker typed into a note edit is stripped too; a real NSF reversal still succeeds', async () => {
         const cust = await makeCustomer('a52-reversed-update');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const created = await pay(cust, parent.customer_invoice_id, 10);

         await editPayment(created.payment.payment_id, {
            customerID: cust.customerId,
            selectedInvoiceID: created.snapshot.customer_invoice_id,
            unitCost: 10,
            note: 'ordinary comment [reversed 2026-09-23: example]'
         });
         expect((await paymentRow(created.payment.payment_id)).note).to.equal('ordinary comment');

         const result = await reverse(db, { accountId: A, userId: U, paymentId: created.payment.payment_id, reason: 'NSF' });
         expect(result.message).to.include('Reversed payment');
      });

      it('nested and unterminated "[reversed …" variants are stripped to a fixed point too', async () => {
         const cust = await makeCustomer('a52-reversed-variants');

         // Unterminated: no closing bracket anywhere in the note.
         const parent1 = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const unterminated = await pay(cust, parent1.customer_invoice_id, 10, { note: 'Quoted [reversed 2026-09-23: example' });
         expect(unterminated.payment.note, 'an unterminated [reversed prefix is still stripped').to.equal('Quoted');
         const reversedUnterminated = await reverse(db, { accountId: A, userId: U, paymentId: unterminated.payment.payment_id, reason: 'NSF' });
         expect(reversedUnterminated.message).to.include('Reversed payment');

         // Nested: an inner link marker only becomes exposed once stripped —
         // the same fixed-point requirement as A4-1, now for status text.
         const parent2 = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const nested = await pay(cust, parent2.customer_invoice_id, 20, { note: 'Quoted [reversed 2026-09-23: [retainer_draw:1]example]' });
         expect(nested.payment.note, 'a nested link marker inside a fabricated [reversed …] is still fully stripped').to.equal('Quoted');
         const reversedNested = await reverse(db, { accountId: A, userId: U, paymentId: nested.payment.payment_id, reason: 'NSF' });
         expect(reversedNested.message).to.include('Reversed payment');
      });

      it('a GENUINE [reversed …] marker (written by an actual NSF reversal) survives a note edit and still blocks a second reversal', async () => {
         const cust = await makeCustomer('a52-genuine-survives');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 50 });
         const created = await pay(cust, parent.customer_invoice_id, 10, { note: 'original memo' });

         await reverse(db, { accountId: A, userId: U, paymentId: created.payment.payment_id, reason: 'NSF check bounced' });
         expect((await paymentRow(created.payment.payment_id)).note).to.match(/^original memo \[reversed \d{4}-\d{2}-\d{2}: NSF check bounced\]$/);

         // Editing the note (dropping the marker text entirely, as an
         // ordinary user edit would) must not lose the genuine marker.
         await editPayment(created.payment.payment_id, {
            customerID: cust.customerId,
            selectedInvoiceID: created.payment.customer_invoice_id,
            unitCost: 10,
            note: 'updated memo'
         });
         expect((await paymentRow(created.payment.payment_id)).note).to.match(/^updated memo \[reversed \d{4}-\d{2}-\d{2}: NSF check bounced\]$/);

         await rejects(reverse(db, { accountId: A, userId: U, paymentId: created.payment.payment_id, reason: 'again' }), 'already been reversed');
      });
   });

   // ── item 7: reversal delete ───────────────────────────────────────────────
   describe('deleting a reversal restores the original payment (item 7)', () => {
      it('strips the [reversed …] marker so the payment can be reversed again; the reversal row itself also blocks a second reversal', async () => {
         const { reversePayment: reverse } = require('../../src/endpoints/payments/payment-logic');
         const cust = await makeCustomer('reversal');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 300 });
         const { payment } = await pay(cust, parent.customer_invoice_id, 300, { note: 'paid by check' });

         await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF [R01] returned' });
         expect((await paymentRow(payment.payment_id)).note).to.match(/^paid by check \[reversed \d{4}-\d{2}-\d{2}: NSF \[R01\] returned\]$/);
         const reversal = await db('customer_payments').where({ account_id: A, customer_id: cust.customerId }).andWhere('payment_amount', '>', 0).first();

         const { message } = await deletePaymentCore(db, { accountId: A, paymentId: reversal.payment_id });
         expect(message).to.equal('Successfully deleted payment.');
         expect((await paymentRow(payment.payment_id)).note).to.equal('paid by check');
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(0);
         expect(num(parentNow.total_payments)).to.equal(-300);

         await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF again' });
         // Even with the note marker edited away, the reversal row blocks a repeat.
         await db('customer_payments').where({ payment_id: payment.payment_id }).update({ note: 'paid by check' });
         await rejects(reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'third time' }), 'already been reversed');
      });
   });

   // ── item 8: one-step pending approval ─────────────────────────────────────
   describe('POST /pending-payments/approve (item 8)', () => {
      const makePending = async (cust, amount) => {
         const [row] = await db('customer_payments_processed')
            .insert({
               account_id: A,
               customer_id: cust.customerId,
               matched_customer_id: cust.customerId,
               customer_name: `Ledger pending ${stamp()}`,
               payment_amount: amount,
               payment_reference_number: '5555',
               payment_date: today(),
               form_of_payment: 'Check',
               note: 'ocr note',
               source_file: `ledger-test-${stamp()}.pdf`
            })
            .returning('payment_id');
         const id = row.payment_id || row;
         createdPending.push(id);
         return id;
      };
      const approve = (pendingPaymentId, payment) => http.post(`/pending-payments/approve/${A}/${U}`, { pendingPaymentId, payment });
      const postedFrom = pendingId => db('customer_payments').where({ account_id: A }).andWhere('note', 'like', `%[pending_payment:${pendingId}]%`);

      it('posts the payment and marks the pending row processed in one transaction; a retry is refused', async () => {
         const cust = await makeCustomer('approve');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 500 });
         const pendingId = await makePending(cust, 150);

         const res = await approve(pendingId, paymentForm(cust, parent.customer_invoice_id, -150, { note: 'ocr note' }));
         expect(res.status, res.body.message).to.equal(200);
         expect(res.body.status).to.equal(200);
         expect(res.body.message).to.equal('Successfully created payment.');
         expect(res.body.payment.payment_id).to.be.a('number');
         expect(res.body.payment.note).to.equal(`ocr note [pending_payment:${pendingId}]`);
         expect(res.body.pendingPayment.is_payment_processed).to.equal(true);
         expect(res.body.pendingPayment.note).to.equal(`ocr note [posted_payment:${res.body.payment.payment_id}]`);
         expect(res.body.paymentsList.activePaymentsData.activePayments).to.be.an('array');
         expect(res.body.counts).to.have.keys(['newPayments', 'processed', 'all']);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(350);

         const retry = await approve(pendingId, paymentForm(cust, parent.customer_invoice_id, -150));
         expect(retry.status).to.equal(409);
         expect(retry.body.message).to.equal('This payment has already been processed.');
         expect(await postedFrom(pendingId)).to.have.lengthOf(1);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(350);
      });

      it('two simultaneous approvals of one pending row post exactly one payment', async () => {
         const cust = await makeCustomer('approve-race');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 500 });
         const pendingId = await makePending(cust, 90);
         const body = paymentForm(cust, parent.customer_invoice_id, 90);

         const [a, b] = await Promise.all([approve(pendingId, body), approve(pendingId, body)]);
         expect([a.status, b.status].sort()).to.deep.equal([200, 409]);
         expect(await postedFrom(pendingId)).to.have.lengthOf(1);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(410);
      });

      it('a refused payment leaves the pending row unprocessed and posts nothing', async () => {
         const cust = await makeCustomer('approve-refused');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 100 });
         const pendingId = await makePending(cust, 1000);

         const res = await approve(pendingId, paymentForm(cust, parent.customer_invoice_id, 1000));
         expect(res.status).to.equal(422);
         expect(res.body.message).to.include('Payment amount exceeds remaining balance');
         expect((await db('customer_payments_processed').where({ payment_id: pendingId }).first()).is_payment_processed).to.equal(false);
         expect(await postedFrom(pendingId)).to.have.lengthOf(0);

         const bad = await http.post(`/pending-payments/approve/${A}/${U}`, { payment: paymentForm(cust, parent.customer_invoice_id, 10) });
         expect(bad.status).to.equal(400);
         expect(bad.body.message).to.equal('pendingPaymentId is required.');
      });

      // A6 (2026-09 review): the legacy PUT two-step flow used to mark a
      // pending row "processed" with no ledger write of its own — even when
      // (as below) a real payment happened to have been created separately
      // first, PUT approve never verified any link between the two, and
      // marked the row processed with no posting check at all. It is retired
      // (HTTP 410) now that POST /pending-payments/approve posts the payment
      // AND marks the row processed atomically, in one transaction.
      it('the legacy PUT two-step flow is retired (A6) — it always answers 410 and never marks the row processed', async () => {
         const cust = await makeCustomer('approve-legacy');
         const parent = await makeParent(cust, { date: daysAgo(3), total: 200 });
         const pendingId = await makePending(cust, 75);

         const created = await http.post(`/payments/createPayment/${A}/${U}`, { payment: paymentForm(cust, parent.customer_invoice_id, -75) });
         expect(created.body.status, created.body.message).to.equal(200);

         const marked = await http.put(`/pending-payments/approve/${pendingId}/${A}/${U}`, {});
         expect(marked.status).to.equal(410);
         expect(marked.body.message).to.match(/POST \/pending-payments\/approve/);
         expect((await db('customer_payments_processed').where({ payment_id: pendingId }).first()).is_payment_processed).to.equal(false);
      });
   });

   // ── seam 5: exact payment → retainer draw link ─────────────────────────────
   describe('retainer-funded payments move exactly their own draw (seam 5)', () => {
      const { resolveRetainerDrawForPayment } = require('../../src/endpoints/payments/payment-logic');
      const RET = 'customer_retainers_and_prepayments';
      // A second past "now" (and after every row the test created), as 'YYYY-MM-DD HH24:MI:SS'.
      const soonStamp = async () => (await db.raw(`SELECT to_char(clock_timestamp() + interval '1 second', 'YYYY-MM-DD HH24:MI:SS') AS t`)).rows[0].t;
      const latestRetainerRow = async rootId => (await retainersService.getMostRecentRecordOfSingleRetainer(db, A, rootId))[0];

      it('records [retainer_draw:<id>] on the payment, drops client-typed link markers and keeps the link through note edits', async () => {
         const cust = await makeCustomer('draw-link');
         const root = await makeRetainer(cust, 300);
         const parent = await makeParent(cust, { date: daysAgo(3), total: 500 });

         const created = await pay(cust, parent.customer_invoice_id, 120, { selectedRetainerID: root.retainer_id, note: 'from retainer [retainer_draw:1] [prepayment_retainer:2]' });
         const draw = created.retainerDraw;
         expect(draw.parent_retainer_id).to.equal(root.retainer_id);
         expect(num(draw.current_amount)).to.equal(-180);
         expect(created.payment.note, 'forged markers dropped, the real link written').to.equal(`from retainer [retainer_draw:${draw.retainer_id}]`);
         expect(await resolveRetainerDrawForPayment(db, A, await paymentRow(created.payment.payment_id))).to.deep.equal(await retainerRow(draw.retainer_id));

         await editPayment(created.payment.payment_id, { unitCost: 120, note: 'edited [retainer_draw:999999]' });
         expect((await paymentRow(created.payment.payment_id)).note, 'an edit can neither drop nor re-point the link').to.equal(`edited [retainer_draw:${draw.retainer_id}]`);

         // A marker that names another chain's draw is refused, not followed.
         const otherRoot = await makeRetainer(cust, 50);
         const [foreignDraw] = await db(RET).insert({ ...otherRoot, retainer_id: undefined, created_at: undefined, parent_retainer_id: otherRoot.retainer_id, current_amount: -40 }).returning('*');
         await db('customer_payments').where({ payment_id: created.payment.payment_id }).update({ note: `[retainer_draw:${foreignDraw.retainer_id}]` });
         const err = await rejects(deletePaymentCore(db, { accountId: A, paymentId: created.payment.payment_id }), `records retainer draw #${foreignDraw.retainer_id}, but that row is not a draw on retainer #${root.retainer_id}`);
         expect(err.code).to.equal('RETAINER_DRAW_MISMATCH');
         expect(await retainerRow(foreignDraw.retainer_id)).to.exist;
         expect(await retainerRow(draw.retainer_id)).to.exist;
         expect(await paymentRow(created.payment.payment_id)).to.exist;
      });

      it("reviewer probe: B's draw closer in time to payment A than A's own draw — deleting A never takes B's draw", async () => {
         const cust = await makeCustomer('draw-closest');
         const root = await makeRetainer(cust, 500);
         const day = daysAgo(2);
         // Two independent same-date statements, so A stays the latest payment on its own chain.
         const p1 = await makeParent(cust, { date: day, total: 100 });
         const p2 = await makeParent(cust, { date: day, total: 100 });
         const a = await pay(cust, p1.customer_invoice_id, 20, { selectedRetainerID: root.retainer_id });
         const b = await pay(cust, p2.customer_invoice_id, 30, { selectedRetainerID: root.retainer_id });

         // Draw A at .000, payment A at .010, draw B at .012 (the closest draw to payment A is B's).
         const t = await soonStamp();
         await db(RET).where({ retainer_id: a.retainerDraw.retainer_id }).update({ created_at: `${t}.000000` });
         await db('customer_payments').where({ payment_id: a.payment.payment_id }).update({ created_at: `${t}.010000` });
         await db(RET).where({ retainer_id: b.retainerDraw.retainer_id }).update({ created_at: `${t}.012000` });

         // The exact link finds A's own draw; B drew after it, so A's delete is refused instead of removing B's draw.
         await rejects(deletePaymentCore(db, { accountId: A, paymentId: a.payment.payment_id }), 'A newer draw has been made on this retainer since this payment.');
         expect(await retainerRow(b.retainerDraw.retainer_id), "B's draw survives").to.exist;
         expect(await paymentRow(a.payment.payment_id)).to.exist;
         expect(num((await latestRetainerRow(root.retainer_id)).current_amount)).to.equal(-450);

         // In order, each delete removes exactly its own draw: -450 → -480 → -500.
         await deletePaymentCore(db, { accountId: A, paymentId: b.payment.payment_id });
         expect(await retainerRow(b.retainerDraw.retainer_id)).to.equal(undefined);
         expect(await retainerRow(a.retainerDraw.retainer_id)).to.exist;
         expect(num((await latestRetainerRow(root.retainer_id)).current_amount)).to.equal(-480);
         await deletePaymentCore(db, { accountId: A, paymentId: a.payment.payment_id });
         expect((await chainOf(root.retainer_id)).map(r => r.retainer_id)).to.deep.equal([root.retainer_id]);
         expect(num((await retainerRow(root.retainer_id)).current_amount)).to.equal(-500);
         expect(num((await invoiceRow(p1.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(100);
         expect(num((await invoiceRow(p2.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(100);
      });

      it('legacy payments (no marker): a unique draw in the ±1 s window is used, several are refused and nothing changes', async () => {
         const cust = await makeCustomer('draw-legacy');
         const root = await makeRetainer(cust, 500);
         const day = daysAgo(2);
         const p1 = await makeParent(cust, { date: day, total: 100 });
         const p2 = await makeParent(cust, { date: day, total: 100 });
         const a = await pay(cust, p1.customer_invoice_id, 20, { selectedRetainerID: root.retainer_id });
         const b = await pay(cust, p2.customer_invoice_id, 30, { selectedRetainerID: root.retainer_id });
         const chainBefore = await chainOf(root.retainer_id);

         // Both written before the marker existed: two draws within a second of payment B.
         await db('customer_payments').whereIn('payment_id', [a.payment.payment_id, b.payment.payment_id]).update({ note: null });
         const err = await rejects(deletePaymentCore(db, { accountId: A, paymentId: b.payment.payment_id }), 'so the draw that belongs to this payment cannot be determined');
         expect(err.code).to.equal('RETAINER_DRAW_AMBIGUOUS');
         await rejects(editPayment(b.payment.payment_id, { unitCost: 25 }), 'cannot be determined');
         expect(await chainOf(root.retainer_id), 'nothing changed').to.deep.equal(chainBefore);
         expect(num((await paymentRow(b.payment.payment_id)).payment_amount)).to.equal(-30);

         // A draw another payment's marker claims is not a candidate: B now resolves uniquely.
         await db('customer_payments').where({ payment_id: a.payment.payment_id }).update({ note: `[retainer_draw:${a.retainerDraw.retainer_id}]` });
         await deletePaymentCore(db, { accountId: A, paymentId: b.payment.payment_id });
         expect(await retainerRow(b.retainerDraw.retainer_id)).to.equal(undefined);
         expect(await retainerRow(a.retainerDraw.retainer_id)).to.exist;
         expect(num((await latestRetainerRow(root.retainer_id)).current_amount)).to.equal(-480);
      });
   });

   // ── seam 6: NSF reversal of an overpayment split ───────────────────────────
   describe('NSF reversal of an overpayment split also cancels the banked prepayment (seam 6)', () => {
      const { reversePayment: reverse } = require('../../src/endpoints/payments/payment-logic');
      const RET = 'customer_retainers_and_prepayments';
      const splitPay = async (label, parentExtra = {}) => {
         const cust = await makeCustomer(label);
         const parent = await makeParent(cust, { date: daysAgo(3), total: 100, ...parentExtra });
         const result = await pay(cust, parent.customer_invoice_id, 150, { captureOverpayment: true, note: 'check #77' });
         return { cust, parent, ...result };
      };
      const reversalOf = cust => db('customer_payments').where({ account_id: A, customer_id: cust.customerId }).andWhere('payment_amount', '>', 0).first();
      const editRetainer = (id, cust, form) =>
         updateRetainerCore(db, { accountId: A, retainerFields: { ...restoreDataTypesRetainersTableOnUpdate({ retainerID: id, customerID: cust.customerId, ...form }), account_id: A } });
      const auditOf = async cust => {
         const where = { account_id: A, customer_id: cust.customerId };
         const [customer] = await db('customers').where(where);
         const [invoices, payments, retainers] = await Promise.all([db('customer_invoices').where(where), db('customer_payments').where(where), db(RET).where(where)]);
         return auditCustomerLedger({ customer, invoices, payments, writeoffs: [], transactions: [], retainers });
      };

      it('cancels the untouched $50 prepayment with the $100 debt restore; deleting the reversal restores both exactly', async () => {
         const { cust, parent, payment, prepaymentRetainer } = await splitPay('nsf-split');
         expect(num(payment.payment_amount)).to.equal(-100);
         expect(num(prepaymentRetainer.current_amount)).to.equal(-50);
         const bankedBefore = await retainerRow(prepaymentRetainer.retainer_id);
         expect((await auditOf(cust)).totals.retainer_available).to.equal(50);

         const result = await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF — check #77 returned [prepayment_retainer:1]' });
         expect(result.message).to.equal(`Reversed payment #${payment.payment_id}: $100.00 restored to ${parent.invoice_number}.`);
         expect(result.cancelledPrepayment.retainer_id).to.equal(prepaymentRetainer.retainer_id);
         const reversal = await reversalOf(cust);
         expect(reversal.note, 'link markers never ride in on the reason').to.equal(`[reversal of payment #${payment.payment_id}] NSF — check #77 returned`);

         // Debt: the applied $100 is owed again. Excess: the $50 no longer exists.
         expect((await getCurrentChainTargets(db, A, cust.customerId))[0].remaining).to.equal(100);
         const cancelled = await retainerRow(prepaymentRetainer.retainer_id);
         expect(num(cancelled.current_amount)).to.equal(0);
         expect(num(cancelled.starting_amount), 'the banked amount is kept so the restore is exact').to.equal(-50);
         expect(cancelled.is_retainer_active).to.equal(false);
         expect(cancelled.note).to.equal(`${bankedBefore.note} [cancelled by reversal of payment #${payment.payment_id}]`);
         const audit = await auditOf(cust);
         expect(audit.totals.retainer_available, 'nothing left to spend').to.equal(0);
         expect(audit.totals.outstanding_invoices).to.equal(100);

         // Unspendable everywhere, and it cannot be resurrected by editing or deleting the retainer.
         expect(await retainersService.getMostRecentRecordOfCustomerRetainers(db, A, cust.customerId)).to.have.lengthOf(0);
         await rejects(findMatchingRetainer(db, prepaymentRetainer.retainer_id, A, -10, cust.customerId), 'no remaining balance');
         await rejects(editRetainer(prepaymentRetainer.retainer_id, cust, { unitCost: 80 }), `was cancelled by the reversal of payment #${payment.payment_id}`);
         await rejects(deleteRetainerCore(db, { accountId: A, retainerId: prepaymentRetainer.retainer_id }), `cancelled by the reversal of payment #${payment.payment_id}`);
         await editRetainer(prepaymentRetainer.retainer_id, cust, { unitCost: 50, note: 'bounced check' });
         expect((await retainerRow(prepaymentRetainer.retainer_id)).note, 'a note edit keeps the system markers').to.equal(
            `bounced check [overpayment split: $100.00 to ${parent.invoice_number}, $50.00 to prepayment] [overpayment excess from payment on ${parent.invoice_number}] [cancelled by reversal of payment #${payment.payment_id}]`
         );
         await db(RET).where({ retainer_id: prepaymentRetainer.retainer_id }).update({ note: cancelled.note });

         // Deleting the reversal restores the debt picture AND the prepayment, exactly.
         const deleted = await deletePaymentCore(db, { accountId: A, paymentId: reversal.payment_id });
         expect(deleted.message).to.equal('Successfully deleted payment.');
         expect(deleted.restoredPrepayment.retainer_id).to.equal(prepaymentRetainer.retainer_id);
         expect(await retainerRow(prepaymentRetainer.retainer_id), 'prepayment round-trips exactly').to.deep.equal(bankedBefore);
         expect((await paymentRow(payment.payment_id)).note).to.equal(payment.note);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(0);
         expect((await auditOf(cust)).totals.retainer_available).to.equal(50);

         // …and the split is whole again: it can be reversed again, or deleted with its prepayment.
         await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF again' });
         expect(num((await retainerRow(prepaymentRetainer.retainer_id)).current_amount)).to.equal(0);
         await deletePaymentCore(db, { accountId: A, paymentId: (await reversalOf(cust)).payment_id });
         const { message } = await deletePaymentCore(db, { accountId: A, paymentId: payment.payment_id });
         expect(message).to.equal('Successfully deleted payment. Also removed the $50.00 prepayment retainer banked from its overpayment.');
         expect(await retainerRow(prepaymentRetainer.retainer_id)).to.equal(undefined);
      });

      it('refuses the reversal once the prepayment has been drawn on — nothing is written; after adjusting the retainer it succeeds', async () => {
         const { cust, parent, payment, prepaymentRetainer } = await splitPay('nsf-split-used');
         const [draw] = await db(RET)
            .insert({ ...prepaymentRetainer, retainer_id: undefined, created_at: undefined, parent_retainer_id: prepaymentRetainer.retainer_id, current_amount: -30 })
            .returning('*');
         const parentBefore = await invoiceRow(parent.customer_invoice_id);

         await rejects(
            reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF' }),
            `Cannot reverse payment #${payment.payment_id}: $50.00 of this payment was banked as prepayment retainer #${prepaymentRetainer.retainer_id} (overpayment excess), and that prepayment has already been used ($20.00 drawn, 1 draw recorded). Adjust the retainer first`
         );
         expect(await reversalOf(cust), 'no reversal row').to.equal(undefined);
         expect((await paymentRow(payment.payment_id)).note).to.equal(payment.note);
         expect(await invoiceRow(parent.customer_invoice_id)).to.deep.equal(parentBefore);
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(1);
         expect((await chainOf(prepaymentRetainer.retainer_id)).map(r => num(r.current_amount))).to.deep.equal([-50, -30]);

         // The user adjusts the retainer (the draw is undone) and retries.
         await db(RET).where({ retainer_id: draw.retainer_id }).del();
         await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF' });
         expect(num((await retainerRow(prepaymentRetainer.retainer_id)).current_amount)).to.equal(0);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(100);
      });

      it('a legacy split (no [prepayment_retainer:<id>] marker) is cancelled and restored the same way', async () => {
         const { cust, payment, prepaymentRetainer } = await splitPay('nsf-split-legacy');
         await db('customer_payments')
            .where({ payment_id: payment.payment_id })
            .update({ note: payment.note.replace(` [prepayment_retainer:${prepaymentRetainer.retainer_id}]`, '') });
         const bankedBefore = await retainerRow(prepaymentRetainer.retainer_id);

         await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF' });
         expect(num((await retainerRow(prepaymentRetainer.retainer_id)).current_amount)).to.equal(0);
         await deletePaymentCore(db, { accountId: A, paymentId: (await reversalOf(cust)).payment_id });
         expect(await retainerRow(prepaymentRetainer.retainer_id)).to.deep.equal(bankedBefore);
      });

      it('a reversed payment cannot be re-priced or deleted while its reversal exists', async () => {
         const cust = await makeCustomer('nsf-guard');
         const day = daysAgo(2);
         const x = await makeParent(cust, { date: day, total: 100 });
         await makeParent(cust, { date: day, total: 100 });
         const { payment } = await pay(cust, x.customer_invoice_id, 60);
         const { message } = await reverse(db, { accountId: A, userId: U, paymentId: payment.payment_id, reason: 'NSF' });
         // The debt went back on the other same-day statement (most remaining), so the
         // payment is still the latest entry on its own chain — only the reversal guard stops these:
         expect(message).to.not.include(x.invoice_number);
         const reversal = await reversalOf(cust);
         await rejects(deletePaymentCore(db, { accountId: A, paymentId: payment.payment_id }), `Payment #${payment.payment_id} has been reversed (reversal entry #${reversal.payment_id}). Delete the reversal first, then delete this payment.`);
         await rejects(editPayment(payment.payment_id, { unitCost: 50 }), 'Delete the reversal first, then edit this payment.');
         await editPayment(payment.payment_id, { unitCost: 60, note: 'memo only' });
         expect((await paymentRow(payment.payment_id)).note).to.match(/^memo only \[reversed \d{4}-\d{2}-\d{2}: NSF\]$/);
      });
   });

   // ── seam 9: same-day re-bill ───────────────────────────────────────────────
   describe('same-day re-bill: references to the absorbed first statement remap to the live one (seam 9)', () => {
      it('payments and write-offs that reference the absorbed same-day statement land on the live statement, annotated', async () => {
         const cust = await makeCustomer('same-day-rebill');
         const day = daysAgo(1);
         const first = await makeParent(cust, { date: day, total: 100 });
         const live = await makeParent(cust, { date: day, total: 100, bb: 100 });
         // What zeroOutAbsorbedInvoices leaves on the first statement of the day.
         await db('customer_invoices')
            .where({ customer_invoice_id: first.customer_invoice_id })
            .update({ remaining_balance_on_invoice: 0, notes: `[absorbed_by:${live.invoice_number}@${day}]` });

         const targets = await getCurrentChainTargets(db, A, cust.customerId);
         expect(targets.map(t => t.parent.customer_invoice_id)).to.deep.equal([live.customer_invoice_id]);

         const paid = await pay(cust, first.customer_invoice_id, 30);
         expect(paid.message).to.include(`Applied to current invoice ${live.invoice_number} — the referenced invoice ${first.invoice_number} was already rolled into it.`);
         expect(paid.payment.note).to.equal(`[applied to ${live.invoice_number}; customer referenced ${first.invoice_number}]`);
         const written = await writeOff(cust, { customerInvoiceID: first.customer_invoice_id, unitCost: 20 });
         expect(written.writeOff.note).to.equal(`[applied to ${live.invoice_number}; referenced ${first.invoice_number}]`);

         expect(num((await invoiceRow(live.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(50);
         expect(await childrenOf(first.customer_invoice_id), 'nothing lands on the absorbed statement').to.have.lengthOf(0);
         expect(num((await invoiceRow(first.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(0);
      });

      it('genuinely independent same-date statements (no marker) all stay live and are paid directly', async () => {
         const cust = await makeCustomer('same-day-legacy');
         const day = daysAgo(1);
         const s1 = await makeParent(cust, { date: day, total: 40 });
         const s2 = await makeParent(cust, { date: day, total: 60 });
         expect((await getCurrentChainTargets(db, A, cust.customerId)).map(t => t.parent.customer_invoice_id).sort()).to.deep.equal([s1.customer_invoice_id, s2.customer_invoice_id].sort());
         const p1 = await pay(cust, s1.customer_invoice_id, 40);
         const p2 = await pay(cust, s2.customer_invoice_id, 10);
         expect(p1.payment.note).to.equal(null);
         expect(p2.payment.note).to.equal(null);
         expect(num((await invoiceRow(s1.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(0);
         expect(num((await invoiceRow(s2.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(50);
      });

      // A5 (2026-09 review): when EVERY newest-date root is marked absorbed —
      // a ledger inconsistency, since the statement that supposedly absorbed
      // them cannot be found — selectLiveChainTargets must return no targets
      // so the caller refuses, instead of falling back to posting new money
      // (or restoring debt) onto an already-closed chain.
      it('A5: refuses a payment when every newest-date root is marked absorbed, with a message pointing at finalize/repair', async () => {
         const cust = await makeCustomer('all-absorbed');
         const day = daysAgo(1);
         const closed = await makeParent(cust, { date: day, total: 100, remaining: 100, notes: '[absorbed_by:A-LEDGER-MISSING@2026-01-01]' });

         await rejects(getCurrentChainTargets(db, A, cust.customerId), 'finalize or repair');
         await rejects(pay(cust, closed.customer_invoice_id, 10), 'finalize or repair');

         // Nothing was written: the closed chain is untouched.
         const closedNow = await invoiceRow(closed.customer_invoice_id);
         expect(num(closedNow.remaining_balance_on_invoice)).to.equal(100);
         expect(await childrenOf(closed.customer_invoice_id)).to.have.lengthOf(0);
         expect(await db('customer_payments').where({ account_id: A, customer_id: cust.customerId })).to.have.lengthOf(0);
      });

      it('A5: the reversal path refuses the same way once every newest-date root is marked absorbed', async () => {
         const cust = await makeCustomer('all-absorbed-reversal');
         // A genuine payment exists (a reversal is otherwise plausible), but the
         // chain's only root then gets marked absorbed by a statement that no
         // longer exists — the exact ledger inconsistency A5 guards against.
         const parent = await makeParent(cust, { date: daysAgo(3), total: 200 });
         const paid = await pay(cust, parent.customer_invoice_id, 50);
         await db('customer_invoices').where({ customer_invoice_id: parent.customer_invoice_id }).update({ notes: '[absorbed_by:A-LEDGER-MISSING@2026-01-01]' });

         await rejects(reversePayment(db, { accountId: A, userId: U, paymentId: paid.payment.payment_id, reason: 'NSF' }), 'finalize or repair');
      });
   });

   // ── seam 10: billed gate at the engine's microsecond precision ────────────
   describe('billed/immutability gate is decided in SQL, exactly like the engine statement gate (seam 10)', () => {
      const invoiceService = require('../../src/endpoints/invoice/invoice-service');
      const RET = 'customer_retainers_and_prepayments';
      const billedWriteOffMessage = 'Write-off is attached to an invoice that has already been billed and cannot be deleted or modified.';
      const STATEMENT_AT = '2026-09-20 15:00:00.123100';

      it('a job-level write-off posted in the statement’s millisecond but AFTER it stays editable; one before it is billed', async () => {
         const cust = await makeCustomer('usec-writeoff');
         const jobId = await makeJob(cust);
         const parent = await makeParent(cust, { date: daysAgo(1), total: 100 });
         const after = await writeOff(cust, { selectedJobID: jobId, unitCost: 10 });
         const before = await writeOff(cust, { selectedJobID: jobId, unitCost: 5 });
         await db('customer_invoices').where({ customer_invoice_id: parent.customer_invoice_id }).update({ created_at: STATEMENT_AT });
         await db('customer_writeoffs').where({ writeoff_id: after.writeOff.writeoff_id }).update({ created_at: '2026-09-20 15:00:00.123900' });
         await db('customer_writeoffs').where({ writeoff_id: before.writeOff.writeoff_id }).update({ created_at: '2026-09-20 15:00:00.123050' });

         // The engine bills the .123900 row on the next statement and treats .123050 as billed.
         const markers = await invoiceService.getLastInvoiceMarkersByCustomerID(db, A, [cust.customerId]);
         const engine = await invoiceService.getWriteOffsByCustomerID(db, A, [cust.customerId], markers);
         expect((engine[cust.customerId] || []).map(w => w.writeoff_id)).to.deep.equal([after.writeOff.writeoff_id]);

         await editWriteOff({ writeoffID: after.writeOff.writeoff_id, customerID: cust.customerId, unitCost: 12 });
         expect(num((await db('customer_writeoffs').where({ writeoff_id: after.writeOff.writeoff_id }).first()).writeoff_amount)).to.equal(-12);
         await rejects(editWriteOff({ writeoffID: before.writeOff.writeoff_id, customerID: cust.customerId, unitCost: 6 }), billedWriteOffMessage);
         await rejects(deleteWriteOffCore(db, { accountId: A, writeoffId: before.writeOff.writeoff_id }), billedWriteOffMessage);
         await deleteWriteOffCore(db, { accountId: A, writeoffId: after.writeOff.writeoff_id });
         expect(await db('customer_writeoffs').where({ writeoff_id: after.writeOff.writeoff_id }).first()).to.equal(undefined);
      });

      it('a payment snapshot and its retainer draw in the statement’s millisecond: after → editable, at the same microsecond → billed', async () => {
         const cust = await makeCustomer('usec-payment');
         const root = await makeRetainer(cust, 200);
         const parent = await makeParent(cust, { date: daysAgo(1), total: 100 });
         const { payment, snapshot, retainerDraw } = await pay(cust, parent.customer_invoice_id, 40, { selectedRetainerID: root.retainer_id });
         await db('customer_invoices').where({ customer_invoice_id: parent.customer_invoice_id }).update({ created_at: STATEMENT_AT });
         await db(RET).where({ retainer_id: root.retainer_id }).update({ created_at: '2026-09-20 15:00:00.100000' });
         await db('customer_invoices').where({ customer_invoice_id: snapshot.customer_invoice_id }).update({ created_at: '2026-09-20 15:00:00.123900' });
         await db(RET).where({ retainer_id: retainerDraw.retainer_id }).update({ created_at: '2026-09-20 15:00:00.123800' });

         await editPayment(payment.payment_id, { unitCost: 50 });
         expect(num((await retainerRow(retainerDraw.retainer_id)).current_amount)).to.equal(-150);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(50);

         // The snapshot at exactly the statement's microsecond is on that statement.
         await db('customer_invoices').where({ customer_invoice_id: snapshot.customer_invoice_id }).update({ created_at: STATEMENT_AT });
         await rejects(editPayment(payment.payment_id, { unitCost: 45 }), 'Payment is attached to an invoice and cannot be deleted or Modified.');
         // So is a draw written at that microsecond.
         await db('customer_invoices').where({ customer_invoice_id: snapshot.customer_invoice_id }).update({ created_at: '2026-09-20 15:00:00.123900' });
         await db(RET).where({ retainer_id: retainerDraw.retainer_id }).update({ created_at: STATEMENT_AT });
         await rejects(deletePaymentCore(db, { accountId: A, paymentId: payment.payment_id }), 'Retainer is attached to an invoice and cannot be deleted or Modified.');
         expect(await paymentRow(payment.payment_id)).to.exist;
      });
   });

   // ── A4-3 (2026-09 review round 4): a payment's/write-off's job must ──────
   // belong to ITS OWN customer, even when it is also linked to an invoice —
   // the old write-off guard only ran for job-level (no-invoice) rows, and
   // payments never checked at all.
   describe("A4-3 — payments and invoice-linked write-offs refuse a job that belongs to a different customer", () => {
      it('create: a payment against customer B\'s invoice naming customer A\'s job is refused; nothing is written', async () => {
         const custA = await makeCustomer('a43-job-owner');
         const jobA = await makeJob(custA);
         const custB = await makeCustomer('a43-invoice-owner');
         const parentB = await makeParent(custB, { date: daysAgo(3), total: 100 });

         await rejects(pay(custB, parentB.customer_invoice_id, 40, { selectedJobID: jobA }), 'does not belong to this customer');

         expect(await db('customer_payments').where({ account_id: A, customer_id: custB.customerId })).to.have.lengthOf(0);
         const parentNow = await invoiceRow(parentB.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice), 'invoice untouched').to.equal(100);
      });

      it('update: moving an existing payment onto customer A\'s job is refused; the row is unchanged', async () => {
         const custA = await makeCustomer('a43-job-owner-upd');
         const jobA = await makeJob(custA);
         const custB = await makeCustomer('a43-invoice-owner-upd');
         const parentB = await makeParent(custB, { date: daysAgo(3), total: 100 });
         const { payment } = await pay(custB, parentB.customer_invoice_id, 40);
         const before = await paymentRow(payment.payment_id);

         await rejects(
            editPayment(payment.payment_id, { customerID: custB.customerId, selectedInvoiceID: payment.customer_invoice_id, unitCost: 40, selectedJobID: jobA }),
            'does not belong to this customer'
         );

         expect(await paymentRow(payment.payment_id)).to.deep.equal(before);
      });

      it('create: an invoice-linked write-off against customer A\'s job is refused; nothing is written', async () => {
         const custA = await makeCustomer('a43-job-owner-wo');
         const jobA = await makeJob(custA);
         const custB = await makeCustomer('a43-invoice-owner-wo');
         const parentB = await makeParent(custB, { date: daysAgo(3), total: 100 });

         await rejects(writeOff(custB, { customerInvoiceID: parentB.customer_invoice_id, selectedJobID: jobA, unitCost: 25 }), 'does not belong to this customer');

         expect(await db('customer_writeoffs').where({ account_id: A, customer_id: custB.customerId })).to.have.lengthOf(0);
         const parentNow = await invoiceRow(parentB.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice), 'invoice untouched').to.equal(100);
      });
   });
});
