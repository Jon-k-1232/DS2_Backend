/**
 * HTTP-level route coverage for payments (src/endpoints/payments/**) and
 * pending payments (src/endpoints/pendingPayments/**), driven end-to-end
 * through the real Express app via the shared harness (test/integration/_http.js).
 *
 * ROLE GATE (referenced from every "role gate" test below): both routers are
 * now mounted with `requireAuth, requireManagerOrAdmin` —
 *   src/app.js  app.use('/payments', requireAuth, requireManagerOrAdmin, paymentsRouter);
 *   src/app.js  app.use('/pending-payments', requireAuth, requireManagerOrAdmin, pendingPaymentsRouter);
 * — matching /invoices and /accountsReceivable. Previously both were mounted
 * with `requireAuth` ONLY (no role check at all — neither router read
 * req.user.access_level), so a plain employee-level JWT succeeded identically
 * to admin on every mutating route (create/reverse/update/delete payment,
 * approve, soft-delete, upload, file delete). That mismatch with the
 * frontend (PaymentSubRoutes.js / PrivateRoute.js, which only checks for an
 * auth token, never a role) is now closed: an employee token gets a 403 from
 * the API on every route below.
 *
 * Fixtures are plain db inserts (customers / customer_information / parent
 * "statement" invoices) — the same lightweight pattern
 * payment-reversal.integration.spec.js's "ledger CRUD integrity" section uses
 * — rather than a full POST /invoices/createInvoice finalize (see
 * month-end-lifecycle.integration.spec.js for that heavier flow). The
 * current-chain guard these routes enforce (payment-logic.getCurrentChainTargets)
 * only cares about parent_invoice_id / invoice_date / remaining_balance_on_invoice,
 * not how the parent row was produced, so a hand-inserted "statement" is
 * behaviourally identical to a real finalize for this coverage. Every fixture
 * name goes through uniqueName() and every row this file creates is removed in
 * `after`; nothing here ever touches account 1.
 *
 * Run: DS2_ENV_FILE=.env.local npx mocha --require test/setup.js \
 *   test/integration/coverage-payments-pending.integration.spec.js --exit --timeout 120000
 */
const dayjs = require('dayjs');

// Same trick month-end-lifecycle.integration.spec.js uses: dotenv loads
// DS2_ENV_FILE's S3_* vars BEFORE src/app (and therefore src/utils/s3.js,
// required by the pending-payments router) is required, so the
// pending-payment upload/preview/delete routes below hit the real MinIO
// sandbox instead of the http://localhost/test-bucket placeholder
// test/setup.js seeds first.
{
   const dotenv = require('dotenv');
   const parsed = dotenv.config({ path: process.env.DS2_ENV_FILE || '.env.dev', override: false }).parsed || {};
   ['S3_BUCKET_NAME', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].forEach(key => {
      if (parsed[key]) process.env[key] = parsed[key];
   });
}

const { bootHttp, uniqueName, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const { getObject, deleteObject } = require('../../src/utils/s3');

describe('integration: coverage — payments & pending payments (HTTP)', function () {
   this.timeout(120_000);

   let h;
   let db;
   let A; // account id (9001)
   let U; // admin user id (90013)
   let E; // employee user id (90011)

   const num = v => Number(v);
   const today = () => dayjs().format('YYYY-MM-DD');
   const daysAgo = n => dayjs().subtract(n, 'day').format('YYYY-MM-DD');
   const NOT_FOUND_ID = 999999999;

   const createdCustomerIds = [];
   const createdPendingIds = [];
   const s3Keys = [];

   // ── fixtures ────────────────────────────────────────────────────────────
   const makeCustomer = async label => {
      const [c] = await db('customers')
         .insert({
            account_id: A,
            customer_name: `Coverage ${label}`,
            display_name: uniqueName(`COVCUST-${label}`),
            is_commercial_customer: false,
            is_customer_active: true,
            is_billable: true,
            is_recurring: false
         })
         .returning('customer_id');
      const customerId = c.customer_id || c;
      createdCustomerIds.push(customerId);
      const [info] = await db('customer_information')
         .insert({
            account_id: A,
            customer_id: customerId,
            customer_street: '1 Coverage Way',
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

   const makeParent = async (cust, { date = daysAgo(3), total, remaining = total, bb = 0, notes = null } = {}) => {
      const [row] = await db('customer_invoices')
         .insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_info_id: cust.infoId,
            invoice_number: uniqueName('COVTEST'),
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

   const makePending = async (cust, amount, extra = {}) => {
      const [row] = await db('customer_payments_processed')
         .insert({
            account_id: A,
            customer_id: cust ? cust.customerId : null,
            matched_customer_id: cust ? cust.customerId : null,
            customer_name: uniqueName('COVPEND'),
            payment_amount: amount,
            payment_reference_number: '5555',
            payment_date: today(),
            form_of_payment: 'Check',
            note: 'ocr note',
            source_file: `${uniqueName('coverage')}.pdf`,
            ...extra
         })
         .returning('*');
      createdPendingIds.push(row.payment_id);
      return row;
   };

   const invoiceRow = id => db('customer_invoices').where({ customer_invoice_id: id }).first();
   const childrenOf = parentId =>
      db('customer_invoices')
         .where({ account_id: A, parent_invoice_id: parentId })
         .orderBy([{ column: 'created_at' }, { column: 'customer_invoice_id' }]);
   const paymentRow = id => db('customer_payments').where({ account_id: A, payment_id: id }).first();
   const pendingRow = id => db('customer_payments_processed').where({ account_id: A, payment_id: id }).first();
   const retainersOf = custId => db('customer_retainers_and_prepayments').where({ account_id: A, customer_id: custId }).orderBy('retainer_id');
   const paymentsOf = custId => db('customer_payments').where({ account_id: A, customer_id: custId }).orderBy('payment_id');

   const paymentForm = (cust, invoiceId, amount, extra = {}) => ({
      accountID: A,
      customerID: cust.customerId,
      selectedInvoiceID: invoiceId,
      selectedRetainerID: null,
      selectedJobID: null,
      transactionDate: today(),
      unitCost: amount,
      formOfPayment: 'Check',
      paymentReferenceNumber: 'COV-1',
      isTransactionBillable: true,
      loggedByUserID: U,
      note: null,
      holdAsPrepayment: false,
      captureOverpayment: false,
      ...extra
   });

   // ── boot / teardown ────────────────────────────────────────────────────
   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
      A = h.accountID;
      U = h.adminUserID;
      E = h.employeeUserID;
   });

   after(async () => {
      if (db) {
         if (createdPendingIds.length) {
            await db('customer_payments_processed').where({ account_id: A }).whereIn('payment_id', createdPendingIds).del();
         }
         for (const id of createdCustomerIds) {
            const where = { account_id: A, customer_id: id };
            await db('customer_payments').where(where).del();
            await db('customer_writeoffs').where(where).del();
            await db('customer_retainers_and_prepayments').where(where).del();
            await db('customer_transactions').where(where).del();
            await db('customer_invoices').where(where).whereNotNull('parent_invoice_id').del();
            await db('customer_invoices').where(where).del();
            await db('customer_jobs').where(where).del();
            await db('customer_information').where(where).del();
            await db('customers').where(where).del();
         }
      }
      for (const key of s3Keys) {
         await deleteObject(key).catch(() => {});
      }
      if (h) await h.close();
   });

   // ═══════════════════════════════════════════════════════════════════════
   // payments
   // ═══════════════════════════════════════════════════════════════════════

   describe('POST /payments/createPayment/:accountID/:userID', () => {
      it('happy path: inserts a snapshot and mirrors remaining/total_payments onto the parent', async () => {
         const cust = await makeCustomer('create-happy');
         const parent = await makeParent(cust, { total: 500 });

         const res = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 200) });
         const body = expectEnvelopeOk(res, 'createPayment');
         expect(body.message).to.equal('Successfully created payment.');

         const children = await childrenOf(parent.customer_invoice_id);
         expect(children).to.have.lengthOf(1);
         expect(num(children[0].remaining_balance_on_invoice)).to.equal(300);
         expect(children[0].is_invoice_paid_in_full).to.equal(false);

         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(300);
         expect(num(parentNow.total_payments), 'negative net').to.equal(-200);
         expect(parentNow.is_invoice_paid_in_full).to.equal(false);

         const payments = await paymentsOf(cust.customerId);
         expect(payments).to.have.lengthOf(1);
         expect(num(payments[0].payment_amount)).to.equal(-200);
         expect(payments[0].customer_invoice_id).to.equal(children[0].customer_invoice_id);

         const listed = body.paymentsList.activePaymentsData.activePayments.find(p => p.payment_id === payments[0].payment_id);
         expect(listed, 'payment present in the returned payments list').to.exist;
      });

      it('validation failure: $0 payment is refused and writes nothing', async () => {
         const cust = await makeCustomer('create-zero');
         const parent = await makeParent(cust, { total: 500 });
         const res = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 0) });
         expectEnvelopeRefused(res, null, 'createPayment $0');
         expect(res.body.message).to.include('Payment amount must be greater than $0.00.');
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);
      });

      it('401: an unauthenticated request is rejected before touching the ledger', async () => {
         const cust = await makeCustomer('create-401');
         const parent = await makeParent(cust, { total: 500 });
         const res = await h.anonymous.post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         expect(res.status).to.equal(401);
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);
      });

      it('403: a token from a different tenant is refused by enforceAccountId', async () => {
         const cust = await makeCustomer('create-403');
         const parent = await makeParent(cust, { total: 500 });
         const res = await h.as('superAdmin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         expect(res.status).to.equal(403);
         expect(res.body.message).to.equal('Account access denied');
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('create-employee');
         const parent = await makeParent(cust, { total: 500 });
         const res = await h.as('employee').post(`/payments/createPayment/${A}/${E}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         expect(res.status).to.equal(403);
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);
      });

      it('not-found: an invoice id that does not exist is refused', async () => {
         const cust = await makeCustomer('create-notfound');
         const res = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, NOT_FOUND_ID, 100) });
         expectEnvelopeRefused(res, null, 'createPayment bad invoice id');
         expect(res.body.message).to.include('No matching invoice record found for this payment.');
      });

      it('domain edge: no invoice and no holdAsPrepayment is refused; holdAsPrepayment banks a Prepayment retainer instead', async () => {
         const cust = await makeCustomer('create-noinv');
         const refused = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, null, 150) });
         expectEnvelopeRefused(refused, null, 'createPayment no invoice');
         expect(refused.body.message).to.include('No invoice ID provided for this payment.');

         const held = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, null, 150, { holdAsPrepayment: true }) });
         const body = expectEnvelopeOk(held, 'createPayment holdAsPrepayment');
         expect(body.message).to.include('Recorded $150.00 as a prepayment retainer');
         expect(body.message).to.include('no open invoice');

         const retainers = await retainersOf(cust.customerId);
         expect(retainers).to.have.lengthOf(1);
         expect(retainers[0].type_of_hold).to.equal('Prepayment');
         expect(num(retainers[0].starting_amount)).to.equal(-150);
         expect(num(retainers[0].current_amount)).to.equal(-150);
         expect(retainers[0].is_retainer_active).to.equal(true);
         expect(await paymentsOf(cust.customerId), 'no payment row — the funds became a retainer, not a payment').to.have.lengthOf(0);
      });

      it('domain edge: a payment on the current chain inserts a snapshot and mirrors the parent exactly', async () => {
         const cust = await makeCustomer('create-chain');
         const parent = await makeParent(cust, { total: 500 });
         const res = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 500) });
         expectEnvelopeOk(res, 'createPayment full pay');
         const snap = (await childrenOf(parent.customer_invoice_id))[0];
         expect(num(snap.remaining_balance_on_invoice)).to.equal(0);
         expect(snap.is_invoice_paid_in_full).to.equal(true);
         expect(snap.fully_paid_date).to.not.equal(null);
         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(parentNow.is_invoice_paid_in_full).to.equal(true);
         expect(num(parentNow.total_payments)).to.equal(-500);
      });

      it('domain edge: a payment referencing an ABSORBED older statement is remapped to the current chain and annotated', async () => {
         const cust = await makeCustomer('create-absorbed');
         const absorbed = await makeParent(cust, { date: daysAgo(40), total: 300, remaining: 0, notes: `[absorbed_by:${uniqueName('COVTEST')}]` });
         const current = await makeParent(cust, { date: daysAgo(5), total: 300, bb: 300 });

         const res = await h
            .as('admin')
            .post(`/payments/createPayment/${A}/${U}`)
            .send({ payment: paymentForm(cust, absorbed.customer_invoice_id, 120, { note: 'paid against old statement' }) });
         const body = expectEnvelopeOk(res, 'createPayment absorbed remap');
         expect(body.message).to.include(`Applied to current invoice ${current.invoice_number}`);
         expect(body.message).to.include(`the referenced invoice ${absorbed.invoice_number} was already rolled into it`);

         expect(await childrenOf(absorbed.customer_invoice_id)).to.have.lengthOf(0);
         const snap = (await childrenOf(current.customer_invoice_id))[0];
         expect(num(snap.remaining_balance_on_invoice)).to.equal(180);
         const [payment] = await paymentsOf(cust.customerId);
         expect(payment.customer_invoice_id).to.equal(snap.customer_invoice_id);
         expect(payment.note).to.include(`[applied to ${current.invoice_number}; customer referenced ${absorbed.invoice_number}]`);
      });

      it('domain edge: an invoice belonging to a different customer is refused', async () => {
         const cust = await makeCustomer('create-crosscust-a');
         const other = await makeCustomer('create-crosscust-b');
         const otherParent = await makeParent(other, { total: 200 });
         const res = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, otherParent.customer_invoice_id, 50) });
         expectEnvelopeRefused(res, null, 'createPayment cross customer');
         expect(res.body.message).to.include('belongs to a different customer');
         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(0);
      });

      it('domain edge: overpayment is refused unless captureOverpayment, then splits and banks a prepayment retainer', async () => {
         const cust = await makeCustomer('create-overpay');
         const parent = await makeParent(cust, { total: 400 });

         const refused = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 500) });
         expectEnvelopeRefused(refused, null, 'createPayment overpay refused');
         expect(refused.body.message).to.include('Payment amount exceeds remaining balance');
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);

         const split = await h
            .as('admin')
            .post(`/payments/createPayment/${A}/${U}`)
            .send({ payment: paymentForm(cust, parent.customer_invoice_id, 500, { captureOverpayment: true, note: 'paid in full plus extra' }) });
         const body = expectEnvelopeOk(split, 'createPayment overpay captured');
         expect(body.message).to.include('Applied $400.00 to');
         expect(body.message).to.include('$100.00 held as a prepayment retainer.');

         const [payment] = await paymentsOf(cust.customerId);
         expect(num(payment.payment_amount)).to.equal(-400);
         expect(payment.note).to.include(`[overpayment split: $400.00 to ${parent.invoice_number}, $100.00 to prepayment]`);
         const prepaymentId = /\[prepayment_retainer:(\d+)\]/.exec(payment.note)[1];
         expect(payment.note).to.include(`[prepayment_retainer:${prepaymentId}]`);

         const retainers = await retainersOf(cust.customerId);
         expect(retainers).to.have.lengthOf(1);
         expect(String(retainers[0].retainer_id)).to.equal(prepaymentId);
         expect(retainers[0].type_of_hold).to.equal('Prepayment');
         expect(num(retainers[0].starting_amount)).to.equal(-100);

         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(parentNow.is_invoice_paid_in_full).to.equal(true);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(0);
      });
   });

   describe('POST /payments/reversePayment/:accountID/:userID', () => {
      const payAndReturn = async (cust, amount) => {
         const parent = await makeParent(cust, { total: amount });
         const res = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, amount) });
         expectEnvelopeOk(res, 'seed payment');
         const [payment] = await paymentsOf(cust.customerId);
         return { parent, payment };
      };

      it('happy path: creates a positive payment row and un-pays the parent', async () => {
         const cust = await makeCustomer('reverse-happy');
         const { parent, payment } = await payAndReturn(cust, 300);

         const res = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: payment.payment_id, reason: 'NSF — check #9001 returned' } });
         const body = expectEnvelopeOk(res, 'reversePayment');
         expect(body.message).to.equal(`Reversed payment #${payment.payment_id}: $300.00 restored to ${parent.invoice_number}.`);

         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(300);
         expect(parentNow.is_invoice_paid_in_full).to.equal(false);
         expect(num(parentNow.total_payments)).to.equal(0);

         const rows = await paymentsOf(cust.customerId);
         expect(rows).to.have.lengthOf(2);
         const reversal = rows.find(r => num(r.payment_amount) > 0);
         expect(reversal, 'a positive reversal row exists').to.exist;
         expect(num(reversal.payment_amount)).to.equal(300);
         expect(reversal.form_of_payment).to.equal('Reversal');
         expect(reversal.note).to.include(`[reversal of payment #${payment.payment_id}]`);
         expect(reversal.note).to.include('NSF — check #9001 returned');

         const original = await paymentRow(payment.payment_id);
         expect(original.note).to.include('[reversed ');
      });

      it('validation failure: a missing reason is refused', async () => {
         const cust = await makeCustomer('reverse-noreason');
         const { payment } = await payAndReturn(cust, 100);
         const res = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: payment.payment_id, reason: '' } });
         expectEnvelopeRefused(res, null, 'reversePayment no reason');
         expect(res.body.message).to.include('A reversal reason is required');
         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(1);
      });

      it('validation failure: a missing payment id is refused', async () => {
         const res = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { reason: 'NSF' } });
         expectEnvelopeRefused(res, null, 'reversePayment no id');
         expect(res.body.message).to.include('No payment ID provided for the reversal.');
      });

      it('401 / 403', async () => {
         const cust = await makeCustomer('reverse-auth');
         const { payment } = await payAndReturn(cust, 100);
         const body = { payment: { paymentID: payment.payment_id, reason: 'NSF' } };

         const anon = await h.anonymous.post(`/payments/reversePayment/${A}/${U}`).send(body);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').post(`/payments/reversePayment/${A}/${U}`).send(body);
         expect(cross.status).to.equal(403);

         const stillOriginal = await paymentRow(payment.payment_id);
         expect(stillOriginal, 'untouched by the two refusals above').to.exist;
         expect(stillOriginal.note == null || !stillOriginal.note.includes('[reversed ')).to.equal(true);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('reverse-employee');
         const { parent, payment } = await payAndReturn(cust, 100);
         const res = await h.as('employee').post(`/payments/reversePayment/${A}/${E}`).send({ payment: { paymentID: payment.payment_id, reason: 'NSF' } });
         expect(res.status).to.equal(403);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(0);
      });

      it('audit trail: the reversal is attributed to the authenticated user, never the URL :userID', async () => {
         const cust = await makeCustomer('reverse-audit');
         const { payment } = await payAndReturn(cust, 100);
         // The admin is authenticated; the URL claims the employee (E). (Employee
         // can no longer authenticate through this manager+-gated route at all —
         // see 'role gate: 403 for an employee' above — so the mismatch is now
         // proven the other way around: the caller's OWN id wins over a spoofed
         // URL :userID, not just "not the employee's id".)
         const res = await h.as('admin').post(`/payments/reversePayment/${A}/${E}`).send({ payment: { paymentID: payment.payment_id, reason: 'NSF' } });
         expectEnvelopeOk(res, 'reversePayment with a spoofed URL userID');
         const reversal = (await paymentsOf(cust.customerId)).find(r => num(r.payment_amount) > 0);
         expect(reversal.created_by_user_id).to.equal(U);
      });

      it('not-found: a nonexistent payment id is refused', async () => {
         const res = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: NOT_FOUND_ID, reason: 'NSF' } });
         expectEnvelopeRefused(res, null, 'reversePayment not found');
         expect(res.body.message).to.include('No matching payment record found.');
      });

      it('domain edge: reversing twice, or reversing a reversal, is refused', async () => {
         const cust = await makeCustomer('reverse-twice');
         const { payment } = await payAndReturn(cust, 150);
         const first = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: payment.payment_id, reason: 'NSF first' } });
         expectEnvelopeOk(first, 'first reversal');

         const again = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: payment.payment_id, reason: 'NSF again' } });
         expectEnvelopeRefused(again, null, 'reverse already-reversed');
         expect(again.body.message).to.include('already been reversed');

         const rows = await paymentsOf(cust.customerId);
         const reversal = rows.find(r => num(r.payment_amount) > 0);
         const reverseTheReversal = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: reversal.payment_id, reason: 'oops' } });
         expectEnvelopeRefused(reverseTheReversal, null, 'reverse a reversal');
         expect(reverseTheReversal.body.message).to.include('already a reversal');

         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(2);
      });
   });

   describe('GET /payments/getSinglePayment/:paymentID/:accountID/:userID', () => {
      it('happy path: returns the payment row', async () => {
         const cust = await makeCustomer('single-happy');
         const parent = await makeParent(cust, { total: 200 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 75, { note: 'find me' }) });
         const [payment] = await paymentsOf(cust.customerId);

         const res = await h.as('admin').get(`/payments/getSinglePayment/${payment.payment_id}/${A}/${U}`);
         const body = expectEnvelopeOk(res, 'getSinglePayment');
         expect(body.message).to.equal('Successfully retrieved single payment.');
         expect(body.activePaymentData.activePayments).to.have.lengthOf(1);
         expect(body.activePaymentData.activePayments[0].payment_id).to.equal(payment.payment_id);
         expect(body.activePaymentData.activePayments[0].note).to.equal('find me');
         expect(body.activePaymentData.grid).to.exist;
      });

      it('validation failure: a non-numeric payment id is refused as not-found, without leaking SQL', async () => {
         const res = await h.as('admin').get(`/payments/getSinglePayment/not-a-number/${A}/${U}`);
         expectEnvelopeRefused(res, /No matching payment record found\./, 'getSinglePayment malformed id');
         // The id is validated before any query: the raw driver error (which used
         // to come back verbatim, SQL text included — "invalid input syntax for
         // type integer") can no longer reach the client.
         expect(res.body.status).to.equal(404);
         expect(res.body.message).to.not.include('invalid input syntax');
         expect(res.body.message).to.not.match(/select|customer_payments/i);
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.get(`/payments/getSinglePayment/${NOT_FOUND_ID}/${A}/${U}`);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(`/payments/getSinglePayment/${NOT_FOUND_ID}/${A}/${U}`);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('single-employee');
         const parent = await makeParent(cust, { total: 100 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 40) });
         const [payment] = await paymentsOf(cust.customerId);
         const res = await h.as('employee').get(`/payments/getSinglePayment/${payment.payment_id}/${A}/${E}`);
         expect(res.status).to.equal(403);
      });

      it('not-found: a well-formed but nonexistent payment id is refused', async () => {
         const res = await h.as('admin').get(`/payments/getSinglePayment/${NOT_FOUND_ID}/${A}/${U}`);
         expectEnvelopeRefused(res, null, 'getSinglePayment not found');
         expect(res.body.status).to.equal(404);
         expect(res.body.message).to.include('No matching payment record found.');
      });

      it('tenancy: a payment id belonging to a different account is treated as not found (row-level scoping)', async () => {
         // account 1 almost certainly owns payment_id 1; requesting it through
         // account 9001's URL must not leak it even though enforceAccountId lets
         // the request itself through (the URL account matches the caller).
         const res = await h.as('admin').get(`/payments/getSinglePayment/1/${A}/${U}`);
         expectEnvelopeRefused(res, null, 'getSinglePayment cross-account row');
         expect(res.body.message).to.include('No matching payment record found.');
      });
   });

   describe('PUT /payments/updatePayment/:accountID/:userID', () => {
      const updateForm = (paymentId, cust, invoiceId, amount, extra = {}) => ({ paymentID: paymentId, ...paymentForm(cust, invoiceId, amount, extra) });

      it('happy path: re-prices the latest snapshot and the parent mirror', async () => {
         const cust = await makeCustomer('update-happy');
         const parent = await makeParent(cust, { total: 500 });
         const created = await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         expectEnvelopeOk(created, 'seed payment');
         const [payment] = await paymentsOf(cust.customerId);

         const res = await h
            .as('admin')
            .put(`/payments/updatePayment/${A}/${U}`)
            .send({ payment: updateForm(payment.payment_id, cust, payment.customer_invoice_id, 150, { formOfPayment: 'Cash', note: 'corrected amount' }) });
         const body = expectEnvelopeOk(res, 'updatePayment');
         expect(body.message).to.equal('Successfully updated payment.');

         const paymentNow = await paymentRow(payment.payment_id);
         expect(num(paymentNow.payment_amount)).to.equal(-150);
         expect(paymentNow.form_of_payment).to.equal('Cash');
         expect(paymentNow.note).to.equal('corrected amount');

         const snap = await invoiceRow(payment.customer_invoice_id);
         expect(num(snap.remaining_balance_on_invoice)).to.equal(350);

         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(350);
         expect(num(parentNow.total_payments)).to.equal(-150);
      });

      it('validation failure: $0 is refused and leaves the stored amount untouched', async () => {
         const cust = await makeCustomer('update-zero');
         const parent = await makeParent(cust, { total: 300 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         const [payment] = await paymentsOf(cust.customerId);

         const res = await h.as('admin').put(`/payments/updatePayment/${A}/${U}`).send({ payment: updateForm(payment.payment_id, cust, payment.customer_invoice_id, 0) });
         expectEnvelopeRefused(res, null, 'updatePayment $0');
         expect(res.body.message).to.include('Payment amount must be greater than $0.00.');
         expect(num((await paymentRow(payment.payment_id)).payment_amount)).to.equal(-100);
      });

      it('401 / 403', async () => {
         const cust = await makeCustomer('update-auth');
         const parent = await makeParent(cust, { total: 300 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         const [payment] = await paymentsOf(cust.customerId);
         const form = updateForm(payment.payment_id, cust, payment.customer_invoice_id, 120);

         const anon = await h.anonymous.put(`/payments/updatePayment/${A}/${U}`).send({ payment: form });
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').put(`/payments/updatePayment/${A}/${U}`).send({ payment: form });
         expect(cross.status).to.equal(403);
         expect(num((await paymentRow(payment.payment_id)).payment_amount)).to.equal(-100);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('update-employee');
         const parent = await makeParent(cust, { total: 300 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         const [payment] = await paymentsOf(cust.customerId);
         const res = await h.as('employee').put(`/payments/updatePayment/${A}/${E}`).send({ payment: updateForm(payment.payment_id, cust, payment.customer_invoice_id, 130) });
         expect(res.status).to.equal(403);
         expect(num((await paymentRow(payment.payment_id)).payment_amount)).to.equal(-100);
      });

      it('not-found: a nonexistent payment id is refused', async () => {
         const cust = await makeCustomer('update-notfound');
         const res = await h.as('admin').put(`/payments/updatePayment/${A}/${U}`).send({ payment: updateForm(NOT_FOUND_ID, cust, null, 100) });
         expectEnvelopeRefused(res, null, 'updatePayment not found');
         expect(res.body.message).to.include('No matching payment record found.');
      });

      it('domain edge: refused once a newer payment exists on the chain', async () => {
         const cust = await makeCustomer('update-stale');
         const parent = await makeParent(cust, { total: 500 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         const firstPaymentId = (await paymentsOf(cust.customerId))[0].payment_id;
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 50) });

         const firstInvoiceId = (await paymentRow(firstPaymentId)).customer_invoice_id;
         const res = await h.as('admin').put(`/payments/updatePayment/${A}/${U}`).send({ payment: updateForm(firstPaymentId, cust, firstInvoiceId, 120) });
         expectEnvelopeRefused(res, null, 'updatePayment stale snapshot');
         expect(res.body.message).to.include('A newer payment or write-off has been applied to this invoice since this payment.');
      });

      it('domain edge: refused once the payment is billed (a newer statement exists)', async () => {
         const cust = await makeCustomer('update-billed');
         const p1 = await makeParent(cust, { date: daysAgo(5), total: 400 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, p1.customer_invoice_id, 100) });
         const [payment] = await paymentsOf(cust.customerId);
         // A "statement" issued after the payment (mirrors what finalize would
         // produce — see month-end-lifecycle.integration.spec.js "8a") makes the
         // payment's snapshot immutable, regardless of amount.
         await makeParent(cust, { date: today(), total: 300, bb: 300 });

         const res = await h.as('admin').put(`/payments/updatePayment/${A}/${U}`).send({ payment: updateForm(payment.payment_id, cust, payment.customer_invoice_id, 150) });
         expectEnvelopeRefused(res, null, 'updatePayment billed');
         expect(res.body.message).to.include('Payment is attached to an invoice and cannot be deleted or Modified.');
      });

      it('domain edge: moving a payment to a different invoice is not supported', async () => {
         const cust = await makeCustomer('update-move');
         const otherParent = await makeParent(cust, { date: daysAgo(10), total: 300 });
         const parent = await makeParent(cust, { date: daysAgo(3), total: 300 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 50) });
         const [payment] = await paymentsOf(cust.customerId);

         const res = await h.as('admin').put(`/payments/updatePayment/${A}/${U}`).send({ payment: updateForm(payment.payment_id, cust, otherParent.customer_invoice_id, 60) });
         expectEnvelopeRefused(res, null, 'updatePayment move invoice');
         expect(res.body.message).to.include('Moving a payment to a different invoice is not supported.');
      });
   });

   describe('DELETE /payments/deletePayment/:accountID/:userID', () => {
      const deleteForm = (paymentId, cust, invoiceId, amount) => ({ paymentID: paymentId, ...paymentForm(cust, invoiceId, amount) });

      it('happy path: round trip — deleting a payment restores the parent exactly', async () => {
         const cust = await makeCustomer('delete-happy');
         const parent = await makeParent(cust, { total: 500 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 120) });
         const [payment] = await paymentsOf(cust.customerId);

         const res = await h.as('admin').delete(`/payments/deletePayment/${A}/${U}`).send({ payment: deleteForm(payment.payment_id, cust, payment.customer_invoice_id, 120) });
         const body = expectEnvelopeOk(res, 'deletePayment');
         expect(body.message).to.equal('Successfully deleted payment.');

         expect(await paymentRow(payment.payment_id)).to.equal(undefined);
         expect(await invoiceRow(payment.customer_invoice_id), 'snapshot removed').to.equal(undefined);
         expect(await childrenOf(parent.customer_invoice_id)).to.have.lengthOf(0);

         const parentNow = await invoiceRow(parent.customer_invoice_id);
         expect(num(parentNow.remaining_balance_on_invoice)).to.equal(500);
         expect(num(parentNow.total_payments)).to.equal(0);
         expect(parentNow.is_invoice_paid_in_full).to.equal(false);
      });

      it('validation failure / not-found: a nonexistent payment id is refused', async () => {
         const res = await h.as('admin').delete(`/payments/deletePayment/${A}/${U}`).send({ payment: { paymentID: NOT_FOUND_ID } });
         expectEnvelopeRefused(res, null, 'deletePayment not found');
         expect(res.body.message).to.include('No matching payment record found.');
      });

      it('401 / 403', async () => {
         const cust = await makeCustomer('delete-auth');
         const parent = await makeParent(cust, { total: 300 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 80) });
         const [payment] = await paymentsOf(cust.customerId);
         const body = deleteForm(payment.payment_id, cust, payment.customer_invoice_id, 80);

         const anon = await h.anonymous.delete(`/payments/deletePayment/${A}/${U}`).send({ payment: body });
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').delete(`/payments/deletePayment/${A}/${U}`).send({ payment: body });
         expect(cross.status).to.equal(403);
         expect(await paymentRow(payment.payment_id)).to.exist;
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('delete-employee');
         const parent = await makeParent(cust, { total: 300 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 80) });
         const [payment] = await paymentsOf(cust.customerId);
         const res = await h.as('employee').delete(`/payments/deletePayment/${A}/${E}`).send({ payment: deleteForm(payment.payment_id, cust, payment.customer_invoice_id, 80) });
         expect(res.status).to.equal(403);
         expect(await paymentRow(payment.payment_id)).to.exist;
      });

      it('domain edge: refuses out-of-order deletion (a newer payment exists on the chain)', async () => {
         const cust = await makeCustomer('delete-order');
         const parent = await makeParent(cust, { total: 500 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 100) });
         const [first] = await paymentsOf(cust.customerId);
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 50) });

         const res = await h.as('admin').delete(`/payments/deletePayment/${A}/${U}`).send({ payment: deleteForm(first.payment_id, cust, first.customer_invoice_id, 100) });
         expectEnvelopeRefused(res, null, 'deletePayment out of order');
         expect(res.body.message).to.include('A newer payment or write-off has been applied to this invoice since this payment. Delete the newer entries first, then retry.');
         expect(await paymentRow(first.payment_id)).to.exist;
      });

      it('domain edge: a plain (non-retainer) payment delete leaves every retainer row on the account untouched', async () => {
         const bystander = await makeCustomer('delete-ret-bystander');
         await db('customer_retainers_and_prepayments').insert({
            parent_retainer_id: null,
            customer_id: bystander.customerId,
            account_id: A,
            display_name: 'Bystander retainer',
            type_of_hold: 'Retainer',
            starting_amount: -90,
            current_amount: -90,
            form_of_payment: 'Check',
            is_retainer_active: true,
            created_by_user_id: U
         });
         const cust = await makeCustomer('delete-ret-own');
         await db('customer_retainers_and_prepayments').insert({
            parent_retainer_id: null,
            customer_id: cust.customerId,
            account_id: A,
            display_name: 'Own retainer',
            type_of_hold: 'Retainer',
            starting_amount: -300,
            current_amount: -300,
            form_of_payment: 'Check',
            is_retainer_active: true,
            created_by_user_id: U
         });
         const parent = await makeParent(cust, { total: 500 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 120) });
         const [payment] = await paymentsOf(cust.customerId);
         expect(payment.retainer_id).to.equal(null);

         const allIds = [bystander.customerId, cust.customerId];
         const before = await db('customer_retainers_and_prepayments').where({ account_id: A }).whereIn('customer_id', allIds).orderBy('retainer_id');
         expect(before).to.have.lengthOf(2);

         const res = await h.as('admin').delete(`/payments/deletePayment/${A}/${U}`).send({ payment: deleteForm(payment.payment_id, cust, payment.customer_invoice_id, 120) });
         expectEnvelopeOk(res, 'deletePayment plain, retainers untouched');

         const after = await db('customer_retainers_and_prepayments').where({ account_id: A }).whereIn('customer_id', allIds).orderBy('retainer_id');
         expect(after, 'no retainer row deleted or changed by an unrelated payment delete').to.deep.equal(before);
      });

      it("domain edge: deleting the reversal restores the original payment's note (reversible again)", async () => {
         const cust = await makeCustomer('delete-reversal');
         const parent = await makeParent(cust, { total: 300 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 300, { note: 'paid by check' }) });
         const [payment] = await paymentsOf(cust.customerId);

         await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: payment.payment_id, reason: 'NSF returned' } });
         expect((await paymentRow(payment.payment_id)).note).to.include('[reversed ');
         const reversal = (await paymentsOf(cust.customerId)).find(r => num(r.payment_amount) > 0);

         const res = await h.as('admin').delete(`/payments/deletePayment/${A}/${U}`).send({ payment: deleteForm(reversal.payment_id, cust, reversal.customer_invoice_id, 300) });
         const body = expectEnvelopeOk(res, 'delete reversal');
         expect(body.message).to.equal('Successfully deleted payment.');

         const originalNow = await paymentRow(payment.payment_id);
         expect(originalNow.note).to.equal('paid by check');
         expect(originalNow.note).to.not.include('[reversed ');

         const again = await h.as('admin').post(`/payments/reversePayment/${A}/${U}`).send({ payment: { paymentID: payment.payment_id, reason: 'NSF second time' } });
         expectEnvelopeOk(again, 'reverse again after delete restored the note');
      });
   });

   describe('GET /payments/getPayments/:accountID/:userID', () => {
      it('happy path: returns a paginated, filtered page with the grid and search term echoed', async () => {
         const cust = await makeCustomer('getpayments-happy');
         const parent = await makeParent(cust, { total: 500 });
         await h.as('admin').post(`/payments/createPayment/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 50, { paymentReferenceNumber: uniqueName('REF') }) });
         const [payment] = await paymentsOf(cust.customerId);

         const res = await h.as('admin').get(`/payments/getPayments/${A}/${U}?page=1&limit=5`);
         const body = expectEnvelopeOk(res, 'getPayments');
         expect(body.message).to.equal('Successfully retrieved payments.');
         const data = body.paymentsList.activePaymentsData;
         expect(data.pagination).to.include({ page: 1, limit: 5 });
         expect(data.activePayments.length).to.be.at.most(5);
         expect(data.grid).to.exist;
         expect(data.searchTerm).to.equal('');

         const bySearch = await h.as('admin').get(`/payments/getPayments/${A}/${U}?search=${encodeURIComponent(payment.payment_reference_number)}`);
         expect(bySearch.body.paymentsList.activePaymentsData.activePayments.some(p => p.payment_id === payment.payment_id)).to.equal(true);
      });

      it('validation failure: a non-positive limit is refused with HTTP 400', async () => {
         const res = await h.as('admin').get(`/payments/getPayments/${A}/${U}?limit=0`);
         expect(res.status).to.equal(400);
         expect(res.body.status).to.equal(400);
         expect(res.body.message).to.include('Invalid pagination parameters');
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.get(`/payments/getPayments/${A}/${U}`);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(`/payments/getPayments/${A}/${U}`);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/payments/getPayments/${A}/${E}?limit=1`);
         expect(res.status).to.equal(403);
      });

      it('domain edge: the page-size cap holds even for a very large requested limit', async () => {
         const res = await h.as('admin').get(`/payments/getPayments/${A}/${U}?limit=999999`);
         const body = expectEnvelopeOk(res, 'getPayments huge limit');
         expect(body.paymentsList.activePaymentsData.pagination.limit).to.equal(500);
      });

      it('domain edge: a hostile search string is treated as a literal filter, not SQL — 200 with no match', async () => {
         const hostile = `foo' OR '1'='1'; DROP TABLE customer_payments; --%_`;
         const res = await h.as('admin').get(`/payments/getPayments/${A}/${U}?search=${encodeURIComponent(hostile)}`);
         const body = expectEnvelopeOk(res, 'getPayments hostile search');
         expect(body.paymentsList.activePaymentsData.searchTerm).to.equal(hostile);
         expect(body.paymentsList.activePaymentsData.activePayments).to.deep.equal([]);

         // The table must still exist and be queryable — a real injection would
         // have broken this follow-up call.
         const stillWorks = await h.as('admin').get(`/payments/getPayments/${A}/${U}?limit=1`);
         expectEnvelopeOk(stillWorks, 'getPayments after hostile search');
      });
   });

   // ═══════════════════════════════════════════════════════════════════════
   // pending payments
   // ═══════════════════════════════════════════════════════════════════════

   describe('GET /pending-payments/list/:accountID/:userID', () => {
      it('happy path: lists a pending row; status/month/year/search all narrow correctly', async () => {
         const cust = await makeCustomer('pplist-happy');
         const pending = await makePending(cust, 200);

         const res = await h.as('admin').get(`/pending-payments/list/${A}/${U}?status=new`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         expect(res.body.payments.some(p => p.payment_id === pending.payment_id)).to.equal(true);

         const d = dayjs(pending.payment_date);
         const byMonthYear = await h.as('admin').get(`/pending-payments/list/${A}/${U}?status=new&month=${d.month() + 1}&year=${d.year()}`);
         expect(byMonthYear.body.payments.some(p => p.payment_id === pending.payment_id)).to.equal(true);

         const bySearch = await h.as('admin').get(`/pending-payments/list/${A}/${U}?status=all&search=${encodeURIComponent(pending.customer_name)}`);
         expect(bySearch.body.payments.map(p => p.payment_id)).to.include(pending.payment_id);

         const processedOnly = await h.as('admin').get(`/pending-payments/list/${A}/${U}?status=processed`);
         expect(processedOnly.body.payments.map(p => p.payment_id)).to.not.include(pending.payment_id);
      });

      it('validation failure: invalid pagination is refused with HTTP 400 (same contract as GET /payments/getPayments)', async () => {
         const res = await h.as('admin').get(`/pending-payments/list/${A}/${U}?limit=-1`);
         expect(res.status).to.equal(400);
         expect(res.body.status).to.equal(400);
         expect(res.body.message).to.include('Invalid pagination parameters');
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.get(`/pending-payments/list/${A}/${U}`);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(`/pending-payments/list/${A}/${U}`);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/pending-payments/list/${A}/${E}`);
         expect(res.status).to.equal(403);
      });

      it('domain edge: a hostile search string is a literal filter, not SQL', async () => {
         const hostile = `x' OR '1'='1'; --%_`;
         const res = await h.as('admin').get(`/pending-payments/list/${A}/${U}?status=all&search=${encodeURIComponent(hostile)}`);
         expect(res.status).to.equal(200);
         expect(res.body.payments).to.deep.equal([]);
      });
   });

   describe('GET /pending-payments/counts/:accountID/:userID', () => {
      // No id/body input to validate on this route beyond tenancy, so there is
      // no distinct "validation failure" / "not-found" case here.
      it('happy path: counts reflect new/processed/all as rows change', async () => {
         const before = await h.as('admin').get(`/pending-payments/counts/${A}/${U}`);
         expect(before.status).to.equal(200);
         const baseline = before.body.counts;

         const cust = await makeCustomer('ppcounts-happy');
         const pending = await makePending(cust, 100);

         const afterCreate = await h.as('admin').get(`/pending-payments/counts/${A}/${U}`);
         expect(afterCreate.body.counts.newPayments).to.equal(baseline.newPayments + 1);
         expect(afterCreate.body.counts.all).to.equal(baseline.all + 1);

         await db('customer_payments_processed').where({ payment_id: pending.payment_id }).update({ is_payment_processed: true });
         const afterProcess = await h.as('admin').get(`/pending-payments/counts/${A}/${U}`);
         expect(afterProcess.body.counts.newPayments).to.equal(baseline.newPayments);
         expect(afterProcess.body.counts.processed).to.equal(baseline.processed + 1);
         expect(afterProcess.body.counts.all).to.equal(baseline.all + 1);
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.get(`/pending-payments/counts/${A}/${U}`);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(`/pending-payments/counts/${A}/${U}`);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/pending-payments/counts/${A}/${E}`);
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /pending-payments/single/:paymentID/:accountID/:userID', () => {
      it('happy path: returns the pending payment row', async () => {
         const cust = await makeCustomer('ppsingle-happy');
         const pending = await makePending(cust, 250);
         const res = await h.as('admin').get(`/pending-payments/single/${pending.payment_id}/${A}/${U}`);
         expect(res.status).to.equal(200);
         expect(res.body.payment.payment_id).to.equal(pending.payment_id);
         expect(num(res.body.payment.payment_amount)).to.equal(250);
      });

      it('validation failure: a non-numeric payment id is refused as not-found (HTTP 404), without leaking SQL', async () => {
         const res = await h.as('admin').get(`/pending-payments/single/not-a-number/${A}/${U}`);
         // validatePendingPaymentExists checks the id before any query, so the raw
         // driver error ("invalid input syntax for type integer", SQL text
         // included) can no longer reach the client.
         expect(res.status).to.equal(404);
         expect(res.body.message).to.equal('Pending payment record not found.');
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.get(`/pending-payments/single/${NOT_FOUND_ID}/${A}/${U}`);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(`/pending-payments/single/${NOT_FOUND_ID}/${A}/${U}`);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('ppsingle-employee');
         const pending = await makePending(cust, 60);
         const res = await h.as('employee').get(`/pending-payments/single/${pending.payment_id}/${A}/${E}`);
         expect(res.status).to.equal(403);
      });

      it('not-found: a nonexistent payment id is refused with HTTP 404 (same as the atomic approve route below)', async () => {
         const res = await h.as('admin').get(`/pending-payments/single/${NOT_FOUND_ID}/${A}/${U}`);
         expect(res.status).to.equal(404);
         expect(res.body.message).to.equal('Pending payment record not found.');
      });
   });

   describe('PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID', () => {
      it('happy path: soft-deletes the row and the counts drop', async () => {
         const cust = await makeCustomer('ppdelete-happy');
         const pending = await makePending(cust, 80);
         const before = (await h.as('admin').get(`/pending-payments/counts/${A}/${U}`)).body.counts;

         const res = await h.as('admin').put(`/pending-payments/soft-delete/${pending.payment_id}/${A}/${U}`).send({});
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('Payment deleted successfully.');
         expect(res.body.payment.deleted).to.equal(true);
         expect(res.body.counts.newPayments).to.equal(before.newPayments - 1);

         expect((await pendingRow(pending.payment_id)).deleted).to.equal(true);
      });

      it('validation failure: soft-deleting an already-processed row is refused', async () => {
         const cust = await makeCustomer('ppdelete-processed');
         const pending = await makePending(cust, 80, { is_payment_processed: true });
         const res = await h.as('admin').put(`/pending-payments/soft-delete/${pending.payment_id}/${A}/${U}`).send({});
         expect(res.status).to.equal(500);
         expect(res.body.message).to.include('already been processed and cannot be deleted');
         expect((await pendingRow(pending.payment_id)).deleted).to.equal(false);
      });

      it('domain edge: soft-deleting an already-deleted row is refused', async () => {
         const cust = await makeCustomer('ppdelete-twice');
         const pending = await makePending(cust, 80);
         const first = await h.as('admin').put(`/pending-payments/soft-delete/${pending.payment_id}/${A}/${U}`).send({});
         expect(first.status).to.equal(200);
         const second = await h.as('admin').put(`/pending-payments/soft-delete/${pending.payment_id}/${A}/${U}`).send({});
         expect(second.status).to.equal(500);
         expect(second.body.message).to.include('already deleted');
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.put(`/pending-payments/soft-delete/${NOT_FOUND_ID}/${A}/${U}`).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').put(`/pending-payments/soft-delete/${NOT_FOUND_ID}/${A}/${U}`).send({});
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('ppdelete-employee');
         const pending = await makePending(cust, 80);
         const res = await h.as('employee').put(`/pending-payments/soft-delete/${pending.payment_id}/${A}/${E}`).send({});
         expect(res.status).to.equal(403);
         expect((await pendingRow(pending.payment_id)).deleted).to.equal(false);
      });

      it('not-found: a nonexistent (or malformed) payment id is refused with HTTP 404', async () => {
         const res = await h.as('admin').put(`/pending-payments/soft-delete/${NOT_FOUND_ID}/${A}/${U}`).send({});
         expect(res.status).to.equal(404);
         expect(res.body.message).to.include('Pending payment record not found.');
         const malformed = await h.as('admin').put(`/pending-payments/soft-delete/not-a-number/${A}/${U}`).send({});
         expect(malformed.status).to.equal(404);
         expect(malformed.body.message).to.equal('Pending payment record not found.');
      });
   });

   describe('POST /pending-payments/approve/:accountID/:userID', () => {
      const approve = (identity, uid, pendingPaymentId, payment) => h.as(identity).post(`/pending-payments/approve/${A}/${uid}`).send({ pendingPaymentId, payment });

      it('happy path: posts exactly one payment and marks the pending row processed, in one transaction', async () => {
         const cust = await makeCustomer('ppapprove-happy');
         const parent = await makeParent(cust, { total: 500 });
         const pending = await makePending(cust, 150);

         const res = await approve('admin', U, pending.payment_id, paymentForm(cust, parent.customer_invoice_id, 150, { note: 'ocr note' }));
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         expect(res.body.message).to.equal('Successfully created payment.');
         expect(res.body.payment.payment_id).to.be.a('number');
         expect(res.body.payment.note).to.equal(`ocr note [pending_payment:${pending.payment_id}]`);
         expect(res.body.pendingPayment.is_payment_processed).to.equal(true);
         expect(res.body.pendingPayment.note).to.equal(`ocr note [posted_payment:${res.body.payment.payment_id}]`);
         expect(res.body.counts).to.have.keys(['newPayments', 'processed', 'all']);
         expect(res.body.paymentsList.activePaymentsData.activePayments.some(p => p.payment_id === res.body.payment.payment_id)).to.equal(true);

         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(350);
         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(1);
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(true);
      });

      it('validation failure: a missing pendingPaymentId is refused with HTTP 400', async () => {
         const cust = await makeCustomer('ppapprove-nopid');
         const parent = await makeParent(cust, { total: 200 });
         const res = await h.as('admin').post(`/pending-payments/approve/${A}/${U}`).send({ payment: paymentForm(cust, parent.customer_invoice_id, 50) });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('pendingPaymentId is required.');
      });

      it('validation failure: a missing payment object is refused with HTTP 400', async () => {
         const cust = await makeCustomer('ppapprove-nopayment');
         const pending = await makePending(cust, 50);
         const res = await h.as('admin').post(`/pending-payments/approve/${A}/${U}`).send({ pendingPaymentId: pending.payment_id });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('payment is required.');
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(false);
      });

      it('401 / 403', async () => {
         const cust = await makeCustomer('ppapprove-auth');
         const parent = await makeParent(cust, { total: 200 });
         const pending = await makePending(cust, 50);
         const body = { pendingPaymentId: pending.payment_id, payment: paymentForm(cust, parent.customer_invoice_id, 50) };

         const anon = await h.anonymous.post(`/pending-payments/approve/${A}/${U}`).send(body);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').post(`/pending-payments/approve/${A}/${U}`).send(body);
         expect(cross.status).to.equal(403);
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(false);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const cust = await makeCustomer('ppapprove-employee');
         const parent = await makeParent(cust, { total: 200 });
         const pending = await makePending(cust, 50);
         const res = await approve('employee', E, pending.payment_id, paymentForm(cust, parent.customer_invoice_id, 50, { loggedByUserID: undefined }));
         expect(res.status).to.equal(403);
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(false);
      });

      it('not-found: a nonexistent pendingPaymentId is refused with HTTP 404', async () => {
         const cust = await makeCustomer('ppapprove-notfound');
         const parent = await makeParent(cust, { total: 200 });
         const res = await approve('admin', U, NOT_FOUND_ID, paymentForm(cust, parent.customer_invoice_id, 50));
         expect(res.status).to.equal(404);
         expect(res.body.message).to.equal('Pending payment record not found.');
      });

      it('domain edge: a second approve of the same pending row is refused with HTTP 409', async () => {
         const cust = await makeCustomer('ppapprove-retry');
         const parent = await makeParent(cust, { total: 500 });
         const pending = await makePending(cust, 100);

         const first = await approve('admin', U, pending.payment_id, paymentForm(cust, parent.customer_invoice_id, 100));
         expect(first.status).to.equal(200);

         const retry = await approve('admin', U, pending.payment_id, paymentForm(cust, parent.customer_invoice_id, 100));
         expect(retry.status).to.equal(409);
         expect(retry.body.message).to.equal('This payment has already been processed.');
         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(1);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(400);
      });

      it('domain edge: two simultaneous approvals of one pending row post exactly one payment', async () => {
         const cust = await makeCustomer('ppapprove-race');
         const parent = await makeParent(cust, { total: 500 });
         const pending = await makePending(cust, 90);
         const body = paymentForm(cust, parent.customer_invoice_id, 90);

         const [a, b] = await Promise.all([approve('admin', U, pending.payment_id, body), approve('admin', U, pending.payment_id, body)]);
         expect([a.status, b.status].sort()).to.deep.equal([200, 409]);
         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(1);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(410);
      });

      it('domain edge: an invalid payment payload (overpayment) is refused with HTTP 422 and the pending row stays unprocessed', async () => {
         const cust = await makeCustomer('ppapprove-invalid');
         const parent = await makeParent(cust, { total: 100 });
         const pending = await makePending(cust, 1000);

         const res = await approve('admin', U, pending.payment_id, paymentForm(cust, parent.customer_invoice_id, 1000));
         expect(res.status).to.equal(422);
         expect(res.body.message).to.include('Payment amount exceeds remaining balance');
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(false);
         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(0);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(100);
      });

      // Missing coverage the report calls out: "no POST ledger event → no
      // processed transition" must hold even when the failure happens AFTER
      // the payment is posted but BEFORE the pending row is marked processed
      // — proving the whole route is one atomic transaction, not just that
      // validation catches bad input early. createPaymentCore itself cannot
      // be made to fail here (buildCreatePaymentInput already forces the
      // authenticated actor as creator, closing the usual "bad user id" FK
      // injection), so this fails the LATER write instead.
      it('atomicity: a failure after the payment posts but before the pending row is marked processed rolls back BOTH', async () => {
         const cust = await makeCustomer('ppapprove-atomicity');
         const parent = await makeParent(cust, { total: 200 });
         const pending = await makePending(cust, 50);

         const pendingPaymentsService = require('../../src/endpoints/pendingPayments/pendingPayments-service').pendingPaymentsService;
         const original = pendingPaymentsService.markAsProcessed;
         pendingPaymentsService.markAsProcessed = async () => {
            throw new Error('simulated failure after the payment posted');
         };
         let res;
         try {
            res = await approve('admin', U, pending.payment_id, paymentForm(cust, parent.customer_invoice_id, 50));
         } finally {
            pendingPaymentsService.markAsProcessed = original;
         }

         expect(res.status).to.equal(500);
         // The payment createPaymentCore posted (invoice snapshot + parent
         // mirror) must not have stuck once the later write in the SAME
         // transaction failed.
         expect(await paymentsOf(cust.customerId)).to.have.lengthOf(0);
         expect(num((await invoiceRow(parent.customer_invoice_id)).remaining_balance_on_invoice)).to.equal(200);
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(false);
      });
   });

   // A6 (2026-09 review): this legacy two-step route used to mark a pending row
   // "processed" with no ledger write at all — no lock, no createPaymentCore
   // call, nothing to say a payment was ever actually posted. A receipt could
   // be reported as approved and vanish from the queue while no payment,
   // retainer or invoice movement backed it. It is retired (HTTP 410) now
   // that POST /pending-payments/approve above posts the payment AND marks
   // the row processed atomically, in one transaction. "Approving an
   // already-processed row is refused" is exercised by the atomic POST route
   // instead (see 'domain edge: a second approve of the same pending row is
   // refused with HTTP 409' above) — the retired route no longer performs an
   // approval at all, successful or otherwise, so it has nothing left to refuse.
   describe('PUT /pending-payments/approve/:paymentID/:accountID/:userID (A6: retired)', () => {
      it('always answers 410 and never marks a real, unprocessed row processed', async () => {
         const cust = await makeCustomer('pplegacy-retired');
         const pending = await makePending(cust, 75);

         const res = await h.as('admin').put(`/pending-payments/approve/${pending.payment_id}/${A}/${U}`).send({});

         expect(res.status).to.equal(410);
         expect(res.body.status).to.equal(410);
         expect(res.body.message).to.match(/POST \/pending-payments\/approve/);
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(false);
      });

      it('answers 410 even for an already-processed row — it no longer performs (or refuses) an approval, just refuses to run', async () => {
         const cust = await makeCustomer('pplegacy-alreadyprocessed');
         const pending = await makePending(cust, 40, { is_payment_processed: true });

         const res = await h.as('admin').put(`/pending-payments/approve/${pending.payment_id}/${A}/${U}`).send({});
         expect(res.status).to.equal(410);
         expect((await pendingRow(pending.payment_id)).is_payment_processed).to.equal(true);
      });

      it('answers 410 even for a nonexistent payment id — it no longer looks the row up at all', async () => {
         const res = await h.as('admin').put(`/pending-payments/approve/${NOT_FOUND_ID}/${A}/${U}`).send({});
         expect(res.status).to.equal(410);
         expect(res.body.message).to.match(/POST \/pending-payments\/approve/);
      });

      it('401 / 403 (account + auth guards still run ahead of the retired handler)', async () => {
         const anon = await h.anonymous.put(`/pending-payments/approve/${NOT_FOUND_ID}/${A}/${U}`).send({});
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').put(`/pending-payments/approve/${NOT_FOUND_ID}/${A}/${U}`).send({});
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required) — enforced before the retired handler runs', async () => {
         const cust = await makeCustomer('pplegacy-employee');
         const pending = await makePending(cust, 40);
         const res = await h.as('employee').put(`/pending-payments/approve/${pending.payment_id}/${A}/${E}`).send({});
         expect(res.status).to.equal(403);
      });
   });

   describe('POST /pending-payments/upload/:accountID/:userID', () => {
      const upload = (identity, uid, fileName, buf) =>
         h
            .as(identity)
            .post(`/pending-payments/upload/${A}/${uid}`)
            .set('Content-Type', 'application/octet-stream')
            .set('x-file-name', encodeURIComponent(fileName))
            .set('x-file-type', 'application/pdf')
            .send(buf);

      it('happy path: uploads bytes to S3 under a .pdf name (content is never inspected)', async () => {
         const fileName = `${uniqueName('coverage-upload')}.pdf`;
         const buf = Buffer.from('coverage-fixture-not-a-real-pdf-but-that-is-fine');
         const res = await upload('admin', U, fileName, buf);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         expect(res.body.message).to.equal('File uploaded successfully. Processing will begin shortly.');
         expect(res.body.fileName).to.equal(fileName);
         expect(res.body.s3Key).to.equal(`James_F__Kimmel___Associates/payments/processing_pending/${fileName}`);
         s3Keys.push(res.body.s3Key);

         const obj = await getObject(res.body.s3Key);
         expect(obj.body.equals(buf), 'the exact bytes sent landed in MinIO').to.equal(true);
      });

      it('validation failure: a missing x-file-name header is refused with HTTP 400', async () => {
         const res = await h.as('admin').post(`/pending-payments/upload/${A}/${U}`).set('Content-Type', 'application/octet-stream').set('x-file-type', 'application/pdf').send(Buffer.from('x'));
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('Missing file name header.');
      });

      it('validation failure: an empty body is refused with HTTP 400', async () => {
         const res = await upload('admin', U, `${uniqueName('empty')}.pdf`, Buffer.alloc(0));
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('Uploaded file is empty or missing.');
      });

      it('validation failure: a non-.pdf extension is refused with HTTP 400', async () => {
         const res = await upload('admin', U, `${uniqueName('picture')}.png`, Buffer.from('not checked anyway'));
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('Only PDF files are accepted.');
      });

      it('validation failure: a file over the 10MB cap is refused with HTTP 400', async function () {
         this.timeout(30_000);
         const res = await upload('admin', U, `${uniqueName('big')}.pdf`, Buffer.alloc(10 * 1024 * 1024 + 1024, 1));
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('File exceeds the 10MB size limit.');
      });

      it('401 / 403', async () => {
         const fileName = `${uniqueName('auth')}.pdf`;
         const buf = Buffer.from('x');
         const anon = await h.anonymous.post(`/pending-payments/upload/${A}/${U}`).set('x-file-name', fileName).set('x-file-type', 'application/pdf').send(buf);
         expect(anon.status).to.equal(401);

         const cross = await h.as('superAdmin').post(`/pending-payments/upload/${A}/${U}`).set('x-file-name', fileName).set('x-file-type', 'application/pdf').send(buf);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const fileName = `${uniqueName('employee-upload')}.pdf`;
         const res = await upload('employee', E, fileName, Buffer.from('employee upload'));
         expect(res.status).to.equal(403);
      });
   });

   describe('GET /pending-payments/files/:accountID/:userID', () => {
      it('happy path: groups pending rows by source_file with correct counts', async () => {
         const cust = await makeCustomer('ppfiles-happy');
         const sourceFile = `${uniqueName('coverage-group')}.pdf`;
         await makePending(cust, 11, { source_file: sourceFile });
         await makePending(cust, 22, { source_file: sourceFile, is_payment_processed: true });

         const res = await h.as('admin').get(`/pending-payments/files/${A}/${U}`);
         expect(res.status).to.equal(200);
         const group = res.body.files.find(f => f.source_file === sourceFile);
         expect(group, 'the source_file group is present').to.exist;
         expect(Number(group.payment_count)).to.equal(2);
         expect(Number(group.processed_count)).to.equal(1);
         expect(group.has_processed).to.equal(true);
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.get(`/pending-payments/files/${A}/${U}`);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(`/pending-payments/files/${A}/${U}`);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/pending-payments/files/${A}/${E}`);
         expect(res.status).to.equal(403);
      });

      it('domain edge: a soft-deleted row is excluded from every file group', async () => {
         const cust = await makeCustomer('ppfiles-deleted');
         const sourceFile = `${uniqueName('coverage-deleted')}.pdf`;
         const pending = await makePending(cust, 33, { source_file: sourceFile });
         await h.as('admin').put(`/pending-payments/soft-delete/${pending.payment_id}/${A}/${U}`).send({});

         const res = await h.as('admin').get(`/pending-payments/files/${A}/${U}`);
         expect(res.body.files.find(f => f.source_file === sourceFile)).to.equal(undefined);
      });
   });

   describe('DELETE /pending-payments/file/:accountID/:userID', () => {
      it('happy path: removes unprocessed pending rows for the file and the S3 object', async () => {
         const cust = await makeCustomer('ppfiledel-happy');
         const fileName = `${uniqueName('coverage-delete')}.pdf`;
         const buf = Buffer.from('coverage delete happy path');
         const uploaded = await h.as('admin').post(`/pending-payments/upload/${A}/${U}`).set('x-file-name', encodeURIComponent(fileName)).set('x-file-type', 'application/pdf').send(buf);
         expect(uploaded.status).to.equal(200);
         const pending = await makePending(cust, 44, { source_file: fileName });

         const res = await h.as('admin').delete(`/pending-payments/file/${A}/${U}`).send({ fileName });
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('File and associated pending payments deleted.');
         expect(res.body.counts).to.exist;

         expect((await pendingRow(pending.payment_id)).deleted).to.equal(true);

         let stillThere = true;
         try {
            await getObject(uploaded.body.s3Key);
         } catch (e) {
            stillThere = false;
         }
         expect(stillThere, 'the S3 object was removed').to.equal(false);
      });

      it('validation failure: a missing fileName is refused with HTTP 400', async () => {
         const res = await h.as('admin').delete(`/pending-payments/file/${A}/${U}`).send({});
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('File name is required.');
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.delete(`/pending-payments/file/${A}/${U}`).send({ fileName: 'x.pdf' });
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').delete(`/pending-payments/file/${A}/${U}`).send({ fileName: 'x.pdf' });
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').delete(`/pending-payments/file/${A}/${E}`).send({ fileName: `${uniqueName('coverage-employee-delete')}.pdf` });
         expect(res.status).to.equal(403);
      });

      it('domain edge: refused once any payment from the file has been processed', async () => {
         const cust = await makeCustomer('ppfiledel-processed');
         const fileName = `${uniqueName('coverage-processed')}.pdf`;
         const pending = await makePending(cust, 55, { source_file: fileName, is_payment_processed: true });

         const res = await h.as('admin').delete(`/pending-payments/file/${A}/${U}`).send({ fileName });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('Cannot delete this file because some payments have already been processed.');
         expect((await pendingRow(pending.payment_id)).deleted).to.equal(false);
      });

      it('not-found: a fileName with no rows still answers 200 (no existence check) — GAP', async () => {
         const res = await h.as('admin').delete(`/pending-payments/file/${A}/${U}`).send({ fileName: `${uniqueName('never-uploaded')}.pdf` });
         expect(res.status).to.equal(200);
         expect(res.body.message).to.equal('File and associated pending payments deleted.');
      });
   });

   describe('GET /pending-payments/file-preview/:accountID/:userID', () => {
      const asBuffer = res => {
         if (Buffer.isBuffer(res.body) && res.body.length) return res.body;
         if (typeof res.text === 'string' && res.text.length) return Buffer.from(res.text, 'binary');
         return Buffer.isBuffer(res.body) ? res.body : Buffer.from([]);
      };

      it('happy path: streams back the exact bytes that were uploaded', async () => {
         const fileName = `${uniqueName('coverage-preview')}.pdf`;
         const buf = Buffer.from('coverage preview bytes 12345');
         const uploaded = await h.as('admin').post(`/pending-payments/upload/${A}/${U}`).set('x-file-name', encodeURIComponent(fileName)).set('x-file-type', 'application/pdf').send(buf);
         expect(uploaded.status).to.equal(200);
         s3Keys.push(uploaded.body.s3Key);

         const res = await h.as('admin').get(`/pending-payments/file-preview/${A}/${U}?fileName=${encodeURIComponent(fileName)}`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('pdf');
         expect(asBuffer(res).equals(buf)).to.equal(true);
      });

      it('validation failure: a missing fileName is refused with HTTP 400', async () => {
         const res = await h.as('admin').get(`/pending-payments/file-preview/${A}/${U}`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.equal('File name is required.');
      });

      it('401 / 403', async () => {
         const anon = await h.anonymous.get(`/pending-payments/file-preview/${A}/${U}?fileName=x.pdf`);
         expect(anon.status).to.equal(401);
         const cross = await h.as('superAdmin').get(`/pending-payments/file-preview/${A}/${U}?fileName=x.pdf`);
         expect(cross.status).to.equal(403);
      });

      it('role gate: 403 for an employee (manager+ required)', async () => {
         const fileName = `${uniqueName('coverage-preview-employee')}.pdf`;
         const res = await h.as('employee').get(`/pending-payments/file-preview/${A}/${E}?fileName=${encodeURIComponent(fileName)}`);
         expect(res.status).to.equal(403);
      });

      it('not-found: a nonexistent file name is refused with HTTP 404', async () => {
         const res = await h.as('admin').get(`/pending-payments/file-preview/${A}/${U}?fileName=${encodeURIComponent(`${uniqueName('never')}.pdf`)}`);
         expect(res.status).to.equal(404);
         expect(res.body.message).to.equal('File not found.');
      });
   });
});
