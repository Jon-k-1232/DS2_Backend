/**
 * Finalize reads ONE consistent ledger snapshot (2026-09 review, round 3, B1/B3)
 * against the sandbox fixture account 9001.
 *
 *   B1. The ledger fingerprint hashes every column of every payment, write-off,
 *       invoice row, unbilled transaction AND retainer, so an edit-and-restore,
 *       a payment date change or a retainer top-up all change it. The
 *       fingerprint and the pricing inputs are read inside one REPEATABLE READ
 *       transaction (billingSnapshot.readBillingSnapshot): a payment edited
 *       between the two reads is invisible to both, and the recheck under the
 *       finalize lock then refuses the commit.
 *   B3. deleteInvoice repeats its history guards under the customer lock: a
 *       statement absorbed by a finalize that committed between the unlocked
 *       preflight and the lock is refused instead of deleted.
 *
 * Run:
 *   DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js \
 *     test/integration/finalize-snapshot.integration.spec.js --exit --timeout 120000
 */
const { bootHttp, uniqueName } = require('./_http');
const invoiceService = require('../../src/endpoints/invoice/invoice-service');
const { readBillingSnapshot } = require('../../src/endpoints/invoice/createInvoice/billingSnapshot');

describe('integration: finalize snapshot + fingerprint + locked delete guards (round-3 B1/B3)', function () {
   this.timeout(120_000);

   const A = 9001;
   const U = 90013;
   const num = v => Number(v);
   const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

   let h;
   let db;
   const createdCustomers = [];

   const makeCustomer = async label => {
      const name = uniqueName(`FSNAP ${label}`);
      const [c] = await db('customers')
         .insert({ account_id: A, customer_name: name, display_name: name, is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false })
         .returning('customer_id');
      const customerId = c.customer_id || c;
      createdCustomers.push(customerId);
      const [info] = await db('customer_information')
         .insert({
            account_id: A,
            customer_id: customerId,
            customer_street: '2 Snapshot Way',
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
      return { customerId, infoId: info.customer_info_id || info, name };
   };

   const addPayment = (customerId, amount, paymentDate = '2026-09-01') =>
      db('customer_payments')
         .insert({ account_id: A, customer_id: customerId, payment_date: paymentDate, payment_amount: amount, form_of_payment: 'Check', payment_reference_number: 'FSNAP', is_transaction_billable: true, created_by_user_id: U })
         .returning('payment_id')
         .then(([row]) => row.payment_id || row);

   const addRetainer = (customerId, amount) =>
      db('customer_retainers_and_prepayments')
         .insert({ account_id: A, customer_id: customerId, parent_retainer_id: null, display_name: 'FSNAP retainer', type_of_hold: 'Retainer', starting_amount: amount, current_amount: amount, form_of_payment: 'Check', is_retainer_active: true, created_by_user_id: U })
         .returning('retainer_id')
         .then(([row]) => row.retainer_id || row);

   const addParent = (cust, { invoiceNumber, total, remaining = total, beginningBalance = 0, notes = null, invoiceDate = '2026-08-01' }) =>
      db('customer_invoices')
         .insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_info_id: cust.infoId,
            parent_invoice_id: null,
            invoice_number: invoiceNumber,
            invoice_date: invoiceDate,
            due_date: invoiceDate,
            beginning_balance: beginningBalance,
            total_payments: 0,
            total_charges: total,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: total,
            remaining_balance_on_invoice: remaining,
            is_invoice_paid_in_full: remaining === 0,
            created_by_user_id: U,
            notes
         })
         .returning('*')
         .then(([row]) => row);

   const fingerprintFor = async customerId => (await invoiceService.getLedgerFingerprint(db, A, [customerId]))[customerId];

   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
   });

   after(async () => {
      if (!db) return;
      for (const table of ['customer_payments', 'customer_writeoffs', 'customer_invoices', 'customer_retainers_and_prepayments', 'customer_transactions', 'customer_jobs', 'customer_information']) {
         await db(table).where('account_id', A).whereIn('customer_id', createdCustomers).delete();
      }
      await db('customers').where('account_id', A).whereIn('customer_id', createdCustomers).delete();
      await h.close();
   });

   describe('B1. ledger fingerprint hashes every column of every balance-moving row', () => {
      let cust;
      let paymentA;
      let paymentB;
      let retainerId;
      let base;

      before(async () => {
         cust = await makeCustomer('fingerprint');
         paymentA = await addPayment(cust.customerId, -100, '2026-09-01');
         paymentB = await addPayment(cust.customerId, -40, '2026-09-02');
         retainerId = await addRetainer(cust.customerId, -500);
         base = await fingerprintFor(cust.customerId);
      });

      it('is stable across repeated reads and has one part per ledger table (payments/write-offs/invoices/unbilled/retainers/events)', async () => {
         expect(await fingerprintFor(cust.customerId)).to.equal(base);
         expect(base.split('/')).to.have.lengthOf(6);
         expect(base.split('/')[0]).to.match(/^2:[0-9a-f]{32}$/); // two payments
         expect(base.split('/')[1]).to.equal('0'); // no write-offs
         expect(base.split('/')[5]).to.equal('0'); // no retainer events
         expect(base.split('/')[4]).to.match(/^1:[0-9a-f]{32}$/); // one retainer row
      });

      it('changes when a payment DATE changes (the old count|sum|max-id digest did not)', async () => {
         await db('customer_payments').where({ payment_id: paymentA }).update({ payment_date: '2026-09-22' });
         expect(await fingerprintFor(cust.customerId)).to.not.equal(base);
         await db('customer_payments').where({ payment_id: paymentA }).update({ payment_date: '2026-09-01' });
         expect(await fingerprintFor(cust.customerId), 'restoring the row restores the fingerprint').to.equal(base);
      });

      it('changes when a retainer balance changes', async () => {
         await db('customer_retainers_and_prepayments').where({ retainer_id: retainerId }).update({ current_amount: -600, starting_amount: -600 });
         expect(await fingerprintFor(cust.customerId)).to.not.equal(base);
         await db('customer_retainers_and_prepayments').where({ retainer_id: retainerId }).update({ current_amount: -500, starting_amount: -500 });
         expect(await fingerprintFor(cust.customerId)).to.equal(base);
      });

      it('changes on OFFSETTING edits that keep count, sum and max id identical', async () => {
         await db('customer_payments').where({ payment_id: paymentA }).update({ payment_amount: -90 });
         await db('customer_payments').where({ payment_id: paymentB }).update({ payment_amount: -50 });
         expect(await fingerprintFor(cust.customerId)).to.not.equal(base);
         await db('customer_payments').where({ payment_id: paymentA }).update({ payment_amount: -100 });
         await db('customer_payments').where({ payment_id: paymentB }).update({ payment_amount: -40 });
         expect(await fingerprintFor(cust.customerId)).to.equal(base);
      });

      it('changes when an unbilled transaction is stamped onto a statement (it leaves the unbilled set)', async () => {
         const [job] = await db('customer_jobs')
            .insert({ account_id: A, customer_id: cust.customerId, job_type_id: 900201, current_job_total: 0, is_quote: false, is_job_complete: false, created_by_user_id: U })
            .returning('customer_job_id');
         const jobId = job.customer_job_id || job;
         const [txn] = await db('customer_transactions')
            .insert({
               account_id: A,
               customer_id: cust.customerId,
               customer_job_id: jobId,
               logged_for_user_id: U,
               general_work_description_id: 90031,
               transaction_date: '2026-09-03',
               transaction_type: 'Time',
               quantity: 1,
               unit_cost: 100,
               total_transaction: 100,
               is_transaction_billable: true,
               is_excess_to_subscription: false,
               created_by_user_id: U
            })
            .returning('transaction_id');
         const txnId = txn.transaction_id || txn;
         const withUnbilled = await fingerprintFor(cust.customerId);
         expect(withUnbilled).to.not.equal(base);
         const parent = await addParent(cust, { invoiceNumber: uniqueName('FSNAP-STAMP').slice(0, 30), total: 100 });
         await db('customer_transactions').where({ transaction_id: txnId }).update({ customer_invoice_id: parent.customer_invoice_id });
         const stamped = await fingerprintFor(cust.customerId);
         expect(stamped).to.not.equal(withUnbilled);
         expect(stamped.split('/')[3], 'no unbilled work left').to.equal('0');
      });
   });

   describe('B1. readBillingSnapshot prices exactly the ledger state its fingerprint describes', () => {
      let cust;
      let paymentId;

      before(async () => {
         cust = await makeCustomer('repeatable-read');
         paymentId = await addPayment(cust.customerId, -100, '2026-09-05');
      });

      it('a payment edited between the fingerprint read and the pricing reads is invisible to both; the post-snapshot recheck then differs until the edit is restored', async () => {
         const invoicesToCreateMap = { [cust.customerId]: { customer_id: cust.customerId, display_name: cust.name } };
         let editedFingerprint;
         const snapshot = await readBillingSnapshot(db, {
            accountID: A,
            invoicesToCreateMap,
            billingDate: '2026-09-23',
            hooks: {
               // Another connection edits the payment while the snapshot is open.
               afterFingerprint: async () => {
                  await db('customer_payments').where({ payment_id: paymentId }).update({ payment_amount: -50 });
                  editedFingerprint = await fingerprintFor(cust.customerId);
               }
            }
         });

         // The pricing reads still see the ORIGINAL −100 (repeatable read) …
         const priced = (snapshot.invoiceQueryData.customerPayments[cust.customerId] || []).map(p => num(p.payment_amount));
         expect(priced).to.deep.equal([-100]);
         // … and the fingerprint they were read with describes that same state.
         expect(snapshot.ledgerFingerprint[cust.customerId]).to.be.a('string');
         expect(editedFingerprint, 'the committed edit is visible to a fresh read').to.not.equal(snapshot.ledgerFingerprint[cust.customerId]);
         // Under the finalize lock the recheck compares against the CURRENT ledger:
         // while the payment is −50 the run is refused …
         expect(await fingerprintFor(cust.customerId)).to.not.equal(snapshot.ledgerFingerprint[cust.customerId]);
         // … and once the edit is restored the priced −100 IS the ledger again.
         await db('customer_payments').where({ payment_id: paymentId }).update({ payment_amount: -100 });
         expect(await fingerprintFor(cust.customerId)).to.equal(snapshot.ledgerFingerprint[cust.customerId]);
         // Microsecond-exact text, never a millisecond JS Date (a payment written
         // 800µs before the snapshot must not read as "posted after it").
         expect(snapshot.runStartedAt).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/);
         expect(snapshot.accountBillingInformation.account_id).to.equal(A);
      });

      it('an edit-and-restore that straddles the snapshot leaves an intermediate price with a fingerprint the recheck rejects', async () => {
         // Snapshot taken while the payment is at the intermediate −50.
         await db('customer_payments').where({ payment_id: paymentId }).update({ payment_amount: -50 });
         const invoicesToCreateMap = { [cust.customerId]: { customer_id: cust.customerId, display_name: cust.name } };
         const snapshot = await readBillingSnapshot(db, { accountID: A, invoicesToCreateMap, billingDate: '2026-09-23' });
         const priced = (snapshot.invoiceQueryData.customerPayments[cust.customerId] || []).map(p => num(p.payment_amount));
         expect(priced).to.deep.equal([-50]);
         // The user restores the payment before the run commits.
         await db('customer_payments').where({ payment_id: paymentId }).update({ payment_amount: -100 });
         // The recheck sees a different ledger than the one priced → refused.
         expect(await fingerprintFor(cust.customerId)).to.not.equal(snapshot.ledgerFingerprint[cust.customerId]);
      });
   });

   describe('B3. deleteInvoice repeats its history guards under the customer lock', () => {
      let cust;
      let parent;

      before(async () => {
         cust = await makeCustomer('locked-delete');
         parent = await addParent(cust, { invoiceNumber: uniqueName('FSNAP-DEL').slice(0, 30), total: 100 });
      });

      const waitForLockWaiter = async () => {
         for (let i = 0; i < 50; i += 1) {
            const { rows } = await db.raw("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()");
            if (rows[0].n > 0) return true;
            await sleep(100);
         }
         return false;
      };

      it('a statement absorbed by a finalize that commits while the delete waits for the lock is refused, not deleted', async () => {
         // 1. Match the real finalize lock order: account audit chain first,
         //    then the customer's ledger. A raw test transaction has no HTTP
         //    context to acquire the account lock through auditContext.
         const finalizeLike = await db.transaction();
         let committed = false;
         let pendingDelete;
         const marker = `[absorbed_by:${uniqueName('INV-FSNAP').slice(0, 24)}@2026-09-23]`;
         try {
            await finalizeLike.raw('SELECT pg_advisory_xact_lock(260026, ?::integer)', [A]);
            await finalizeLike('customers').where({ account_id: A, customer_id: cust.customerId }).forNoKeyUpdate();

            // 2. The delete passes its unlocked preflight (zero history) and blocks
            //    on the lock. supertest only sends once a promise is attached.
            pendingDelete = h.as('admin').delete(`/invoices/deleteInvoice/${A}/${parent.customer_invoice_id}`).then(res => res);
            expect(await waitForLockWaiter(), 'the delete must be waiting on the ledger locks').to.equal(true);

            // 3. The "finalize" rolls the statement forward and commits.
            await finalizeLike('customer_invoices').where({ customer_invoice_id: parent.customer_invoice_id }).update({ remaining_balance_on_invoice: 0, is_invoice_paid_in_full: true, notes: marker });
            await finalizeLike.commit();
            committed = true;
         } finally {
            if (!committed) await finalizeLike.rollback().catch(() => {});
         }

         // 4. The delete resumes under the lock, re-reads the row and refuses.
         const res = await pendingDelete;
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(500);
         expect(res.body.message).to.match(/statement history|rolled it forward|cannot be deleted/i);
         const stillThere = await db('customer_invoices').where({ customer_invoice_id: parent.customer_invoice_id }).first();
         expect(stillThere, 'the absorbed statement survives').to.exist;
         expect(stillThere.notes).to.equal(marker);
      });

      it('a fresh zero-history parent still deletes cleanly under the same path', async () => {
         const fresh = await addParent(cust, { invoiceNumber: uniqueName('FSNAP-OK').slice(0, 30), total: 25 });
         const res = await h.as('admin').delete(`/invoices/deleteInvoice/${A}/${fresh.customer_invoice_id}`);
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         expect(await db('customer_invoices').where({ customer_invoice_id: fresh.customer_invoice_id }).first()).to.equal(undefined);
      });
   });
});
