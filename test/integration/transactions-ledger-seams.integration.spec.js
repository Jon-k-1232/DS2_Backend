/**
 * Time/charge entries on the customer ledger (2026-09 review, findings 2 / 7 / 8)
 * against the sandbox fixture account 9001:
 *
 *   2. create / update / delete run in ONE transaction under the customer's
 *      ledger lock and re-read the stored row after locking — a failure rolls
 *      every write back, an edit queued behind finalize sees the stamped row,
 *      and two retainer-funded entries cannot both spend the same balance.
 *   7. retainer funding follows the billable contribution: non-billable
 *      reverses exactly the entry's draw and removes its 'Retainer' payment,
 *      billable funds it, date / amount / job edits keep the payment in step.
 *   8. an entry can only ever draw on its OWN customer's retainer.
 *
 * Every scenario runs on fresh customers (unique names) and everything is
 * removed in `after`. Run:
 *   DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js \
 *     test/integration/transactions-ledger-seams.integration.spec.js --exit --timeout 120000
 */
const dayjs = require('dayjs');
const { bootHttp, uniqueName, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const { addNewTransaction, updateTransactionCore, retainerDrawMarker } = require('../../src/endpoints/transactions/sharedTransactionFunctions');
const transactionsService = require('../../src/endpoints/transactions/transactions-service');
const paymentsService = require('../../src/endpoints/payments/payments-service');

describe('integration: transaction ledger seams (atomic + locked CRUD, retainer funding, retainer ownership)', function () {
   this.timeout(120_000);

   const A = 9001;
   const U = 90013;
   const GWD_ID = 90031; // seed: 'Tax Return Preparation'
   const JOB_TYPE_ID = 900201; // seed: '1040 Individual Return'
   const RUN_TAG = uniqueName('TXSEAM').slice(0, 60);
   const today = dayjs().format('YYYY-MM-DD');
   const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
   const num = value => Number(value);
   const base = `${A}/${U}`;

   let h;
   let db;
   const createdCustomers = [];

   // ── fixtures ──────────────────────────────────────────────────────────────
   const makeCustomer = async label => {
      const name = uniqueName(`TXSEAM ${label}`);
      const [c] = await db('customers')
         .insert({ account_id: A, customer_name: name, display_name: name, is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false })
         .returning('customer_id');
      const customerId = c.customer_id || c;
      createdCustomers.push(customerId);
      const [info] = await db('customer_information')
         .insert({
            account_id: A,
            customer_id: customerId,
            customer_street: '1 Seam Way',
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

   const makeJob = async cust => {
      const [row] = await db('customer_jobs')
         .insert({ account_id: A, customer_id: cust.customerId, job_type_id: JOB_TYPE_ID, current_job_total: 0, is_quote: false, is_job_complete: false, created_by_user_id: U })
         .returning('customer_job_id');
      return row.customer_job_id || row;
   };

   // `createdBy` defaults to U (admin) so every existing call site is
   // unaffected; A4-2 tests pass a distinct id to prove a compensating
   // snapshot's created_by_user_id is the AUTHENTICATED EDITOR, not copied
   // from the retainer chain's own creator.
   const makeRetainer = async (cust, amount, createdBy = U) => {
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
            created_by_user_id: createdBy
         })
         .returning('*');
      return row;
   };

   const makeParent = async (cust, total) => {
      const [row] = await db('customer_invoices')
         .insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_info_id: cust.infoId,
            invoice_number: `A-SEAM-${cust.customerId}-${Date.now().toString(36)}`,
            invoice_date: today,
            due_date: today,
            beginning_balance: 0,
            total_payments: 0,
            total_charges: total,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: total,
            remaining_balance_on_invoice: total,
            is_invoice_paid_in_full: false,
            created_by_user_id: U
         })
         .returning('*');
      return row;
   };

   // The Transactions form body (see SharedPostObjects.formObjectForTransactionPost).
   const newForm = (cust, jobId, extra = {}) => ({
      customerID: cust.customerId,
      customerJobID: jobId,
      selectedRetainerID: null,
      loggedForUserID: U,
      selectedGeneralWorkDescriptionID: GWD_ID,
      detailedJobDescription: RUN_TAG,
      transactionDate: today,
      transactionType: 'Time',
      quantity: 1,
      unitCost: 50,
      totalTransaction: 50,
      isTransactionBillable: true,
      isInAdditionToMonthlyCharge: false,
      loggedByUserID: U,
      note: '',
      category: RUN_TAG, // lands on the AI training row → cleanup key
      ...extra
   });
   // What EditTransaction / DeleteTimeOrCharge send back: the stored row as a form.
   const formFor = (row, extra = {}) => ({
      transactionID: row.transaction_id,
      customerID: row.customer_id,
      customerJobID: row.customer_job_id,
      selectedRetainerID: row.retainer_id,
      loggedForUserID: row.logged_for_user_id,
      selectedGeneralWorkDescriptionID: row.general_work_description_id,
      detailedJobDescription: row.detailed_work_description,
      transactionDate: dayjs(row.transaction_date).format('YYYY-MM-DD'),
      transactionType: row.transaction_type,
      quantity: num(row.quantity),
      unitCost: num(row.unit_cost),
      totalTransaction: num(row.total_transaction),
      isTransactionBillable: row.is_transaction_billable,
      isInAdditionToMonthlyCharge: row.is_excess_to_subscription,
      loggedByUserID: U,
      note: row.note,
      ...extra
   });

   const http = {
      create: form => h.as('admin').post(`/transactions/createTransaction/${base}`).send({ transaction: form }),
      update: form => h.as('admin').put(`/transactions/updateTransaction/${base}`).send({ transaction: form }),
      remove: form => h.as('admin').delete(`/transactions/deleteTransaction/${base}`).send({ transaction: form })
   };

   const createEntry = async (cust, jobId, extra) => {
      expectEnvelopeOk(await http.create(newForm(cust, jobId, extra)), 'createTransaction');
      return db('customer_transactions').where({ account_id: A, customer_id: cust.customerId }).orderBy('transaction_id', 'desc').first();
   };

   const txnRow = id => db('customer_transactions').where({ account_id: A, transaction_id: id }).first();
   const retainerRow = id => db('customer_retainers_and_prepayments').where({ account_id: A, retainer_id: id }).first();
   const chainOf = rootId =>
      db('customer_retainers_and_prepayments')
         .where({ account_id: A })
         .andWhere(b => b.where('retainer_id', rootId).orWhere('parent_retainer_id', rootId))
         .orderBy([{ column: 'created_at' }, { column: 'retainer_id' }]);
   const paymentsOf = cust => db('customer_payments').where({ account_id: A, customer_id: cust.customerId }).orderBy('payment_id');
   const paymentForDraw = drawId => db('customer_payments').where({ account_id: A }).andWhere('note', 'like', `%${retainerDrawMarker(drawId)}%`).first();
   const latestJobTotal = async jobId => num((await db('customer_jobs').where({ account_id: A, parent_job_id: jobId }).orderBy('customer_job_id', 'desc').first()).current_job_total);

   /** Every ledger row of the given customers — for "nothing changed" assertions. */
   const ledgerState = async (customers, connection = db) => {
      const ids = customers.map(c => c.customerId);
      const [transactions, payments, retainers, jobs] = await Promise.all([
         connection('customer_transactions').where({ account_id: A }).whereIn('customer_id', ids).orderBy('transaction_id'),
         connection('customer_payments').where({ account_id: A }).whereIn('customer_id', ids).orderBy('payment_id'),
         connection('customer_retainers_and_prepayments').where({ account_id: A }).whereIn('customer_id', ids).orderBy('retainer_id'),
         connection('customer_jobs').where({ account_id: A }).whereIn('customer_id', ids).orderBy('customer_job_id')
      ]);
      return { transactions, payments, retainers, jobs };
   };

   const rejection = async promise => {
      try {
         await promise;
      } catch (err) {
         return err;
      }
      return null;
   };

   const waitFor = async (predicate, label, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
         if (await predicate()) return;
         await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`timed out waiting for ${label}`);
   };

   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
   });

   after(async () => {
      if (db) {
         await db('ai_category_training_examples').where({ account_id: A, original_category: RUN_TAG }).del();
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
      if (h) await h.close();
   });

   // ── finding 2: atomic + serialized ────────────────────────────────────────
   describe('finding 2 — one transaction under the customer ledger lock', () => {
      it('a funded create links transaction → draw ← payment exactly', async () => {
         const cust = await makeCustomer('funded-create');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);

         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });

         const chain = await chainOf(root.retainer_id);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-500, -450]);
         expect(entry.retainer_id).to.equal(chain[1].retainer_id);
         const [payment] = await paymentsOf(cust);
         expect(payment.note).to.equal(retainerDrawMarker(chain[1].retainer_id));
         expect(num(payment.payment_amount)).to.equal(-50);
         expect(payment.retainer_id).to.equal(root.retainer_id);
         expect(payment.customer_invoice_id).to.equal(null);
         expect(dayjs(payment.payment_date).format('YYYY-MM-DD')).to.equal(today);
         expect(await latestJobTotal(job)).to.equal(50);
      });

      it('a failed transaction insert rolls back the draw and the job total (create)', async () => {
         const cust = await makeCustomer('atomic-create');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const before = await ledgerState([cust]);

         // Submit valid references; inject the bad FK only at persistence,
         // after validation and actual job/draw writes inside the transaction.
         const create = transactionsService.createTransaction;
         let res, during;
         try {
            transactionsService.createTransaction = async (trx, fields) => {
               during = await ledgerState([cust], trx);
               return create(trx, { ...fields, general_work_description_id: 987654321 });
            };
            res = await http.create(newForm(cust, job, { selectedRetainerID: root.retainer_id }));
         } finally { transactionsService.createTransaction = create; }
         expectEnvelopeRefused(res, /foreign key/, 'createTransaction with an injected insert failure');
         expect(during, 'the insert must be reached after validation').to.exist;
         expect(during.retainers.map(r => num(r.current_amount))).to.deep.equal([-500, -450]);
         expect(during.jobs.map(r => num(r.current_job_total))).to.deep.equal([0, 50]);
         expect(during.transactions).to.have.lengthOf(0);
         expect(during.payments).to.have.lengthOf(0);

         expect(await ledgerState([cust])).to.deep.equal(before);
      });

      it('a failed transaction write rolls back the draw re-price, the payment sync and the job totals (update)', async () => {
         const cust = await makeCustomer('atomic-update');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         const before = await ledgerState([cust]);

         // The date passes field/reference/price validation and fails in the
         // actual transaction UPDATE. Observe successful SQL responses so a
         // rejection before job/draw writes cannot make this test pass.
         const writes = [];
         const observeWrite = (_response, query) => {
            if (/^(insert into "customer_jobs"|update "customer_retainers_and_prepayments")/.test(query.sql)) writes.push(query.sql);
         };
         let res;
         db.on('query-response', observeWrite);
         try {
            res = await http.update(formFor(entry, { unitCost: 80, totalTransaction: 80, transactionDate: 'not-a-date' }));
         } finally { db.removeListener('query-response', observeWrite); }
         expectEnvelopeRefused(res, /invalid input syntax for type date/, 'updateTransaction with a database date failure');
         expect(writes.filter(sql => sql.startsWith('insert into "customer_jobs"')), 'job total was written before failure').to.have.lengthOf(1);
         expect(writes.filter(sql => sql.startsWith('update "customer_retainers_and_prepayments"')), 'draw was repriced before failure').to.have.lengthOf(1);

         expect(await ledgerState([cust])).to.deep.equal(before);
      });

      it('a database failure after payment sync rolls back the transaction, draw, payment and job together', async () => {
         const cust = await makeCustomer('atomic-payment-sync');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         const before = await ledgerState([cust]);
         const update = paymentsService.updatePayment;
         let res, during;
         try {
            paymentsService.updatePayment = async (trx, fields, accountId) => {
               await update(trx, fields, accountId);
               during = await ledgerState([cust], trx);
               return trx.raw('SELECT 1/0'); // genuine PostgreSQL error, after every ledger write
            };
            res = await http.update(formFor(entry, { unitCost: 80, totalTransaction: 80 }));
         } finally { paymentsService.updatePayment = update; }
         expectEnvelopeRefused(res, /division by zero/, 'updateTransaction after payment sync');
         expect(during, 'payment sync must actually complete before failure').to.exist;
         expect(num(during.transactions[0].total_transaction)).to.equal(80);
         expect(during.retainers.map(r => num(r.current_amount))).to.deep.equal([-500, -420]);
         expect(during.payments.map(r => num(r.payment_amount))).to.deep.equal([-80]);
         expect(during.jobs.map(r => num(r.current_job_total))).to.deep.equal([0, 50, 80]);
         expect(await ledgerState([cust])).to.deep.equal(before);
      });

      it("an ingestion caller's transaction is joined: its later failure rolls the entry back", async () => {
         const cust = await makeCustomer('joined');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const before = await ledgerState([cust]);

         const err = await rejection(
            db.transaction(async trx => {
               await addNewTransaction(trx, { ...newForm(cust, job, { selectedRetainerID: root.retainer_id }), account_id: A });
               throw new Error('caller failed after the insert');
            })
         );
         expect(err && err.message).to.equal('caller failed after the insert');
         expect(await ledgerState([cust])).to.deep.equal(before);
      });

      it('ingestion callers that already hold a foreign-key share lock on the customer do not deadlock', async () => {
         // The time-tracker claim UPDATE sets timesheet_entries.suggested_customer_id
         // (an FK to customers), so each per-entry transaction holds FOR KEY SHARE on
         // the customer row before it calls addNewTransaction. Two FOR UPDATE requests
         // on top of those key-share locks deadlock; the ledger lock must not.
         const cust = await makeCustomer('fk-share');
         const job = await makeJob(cust);
         let arrived = 0;
         let release;
         const bothHoldKeyShare = new Promise(resolve => {
            release = resolve;
         });
         const ingest = label =>
            db.transaction(async trx => {
               // Exactly the lock the claim's foreign-key check (timesheet_entries.suggested_customer_id) takes.
               await trx.raw('SELECT 1 FROM customers WHERE account_id = ? AND customer_id = ? FOR KEY SHARE', [A, cust.customerId]);
               arrived += 1;
               if (arrived === 2) release();
               await bothHoldKeyShare;
               return addNewTransaction(trx, { ...newForm(cust, job, { detailedJobDescription: label }), account_id: A });
            });

         const results = await Promise.allSettled([ingest('first'), ingest('second')]);
         expect(results.map(r => (r.status === 'rejected' ? r.reason.message : 'ok'))).to.deep.equal(['ok', 'ok']);
         expect(await db('customer_transactions').where({ account_id: A, customer_id: cust.customerId })).to.have.lengthOf(2);
         expect(await latestJobTotal(job)).to.equal(100);
      });

      it('an edit queued behind finalize re-reads the stored row after locking and refuses the now-billed entry', async () => {
         const cust = await makeCustomer('lock-wait');
         const job = await makeJob(cust);
         const entry = await createEntry(cust, job, { unitCost: 100, totalTransaction: 100 });
         const statement = await makeParent(cust, 100);

         // Finalize holds the same customer-row lock while it stamps the entry.
         const finalize = await db.transaction();
         let pending;
         try {
            await finalize('customers').where({ account_id: A, customer_id: cust.customerId }).forUpdate();
            const {
               rows: [{ pid }]
            } = await finalize.raw('SELECT pg_backend_pid() AS pid');

            let settled = false;
            pending = updateTransactionCore(db, { accountId: A, transaction: formFor(entry, { unitCost: 150, totalTransaction: 150 }) }).finally(() => {
               settled = true;
            });
            pending.catch(() => {});

            await waitFor(
               async () => (await db.raw('SELECT count(*)::int AS n FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))', [pid])).rows[0].n > 0,
               'the edit to block on the customer ledger lock'
            );
            expect(settled, 'the edit must wait for the lock').to.equal(false);

            await finalize('customer_transactions').where({ account_id: A, transaction_id: entry.transaction_id }).update({ customer_invoice_id: statement.customer_invoice_id });
            await finalize.commit();
         } catch (err) {
            await finalize.rollback().catch(() => {});
            throw err;
         }

         const err = await rejection(pending);
         expect(err && err.message).to.equal('Transaction is attached to an invoice and cannot be updated.');
         const stored = await txnRow(entry.transaction_id);
         expect(num(stored.total_transaction)).to.equal(100);
         expect(stored.customer_invoice_id).to.equal(statement.customer_invoice_id);
      });

      it('two concurrent retainer-funded entries cannot both spend the same balance', async () => {
         const cust = await makeCustomer('race');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 100);

         const form = newForm(cust, job, { selectedRetainerID: root.retainer_id, unitCost: 60, totalTransaction: 60 });
         const responses = await Promise.all([http.create(form), http.create(form)]);
         const ok = responses.filter(res => res.status === 200 && Number(res.body.status) === 200);
         const refused = responses.filter(res => Number(res.body.status) !== 200);
         expect(ok, 'exactly one entry is funded').to.have.lengthOf(1);
         expect(refused).to.have.lengthOf(1);
         expect(refused[0].body.message).to.match(/not have enough balance to cover the transaction\. Available: \$40\.00/);

         const chain = await chainOf(root.retainer_id);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-100, -40]);
         expect(await paymentsOf(cust)).to.have.lengthOf(1);
         expect(await db('customer_transactions').where({ account_id: A, customer_id: cust.customerId })).to.have.lengthOf(1);
      });
   });

   // ── finding 7: funding follows the billable contribution ─────────────────
   describe('finding 7 — retainer-funded edits', () => {
      it('billable → non-billable returns exactly its draw to the retainer and removes its payment (later draws keep their size)', async () => {
         const cust = await makeCustomer('unfund');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const first = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         const second = await createEntry(cust, job, { selectedRetainerID: root.retainer_id, unitCost: 30, totalTransaction: 30 });
         expect((await chainOf(root.retainer_id)).map(r => num(r.current_amount))).to.deep.equal([-500, -450, -420]);

         expectEnvelopeOk(await http.update(formFor(first, { isTransactionBillable: false })), 'make non-billable');

         const stored = await txnRow(first.transaction_id);
         expect(stored.is_transaction_billable).to.equal(false);
         expect(stored.retainer_id).to.equal(null);
         expect(await retainerRow(first.retainer_id), 'its own draw row is removed').to.equal(undefined);
         const chain = await chainOf(root.retainer_id);
         expect(chain.map(r => r.retainer_id)).to.deep.equal([root.retainer_id, second.retainer_id]);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-500, -470]);
         expect(await paymentForDraw(first.retainer_id)).to.equal(undefined);
         const secondPayment = await paymentForDraw(second.retainer_id);
         expect(num(secondPayment.payment_amount)).to.equal(-30);
         expect(await paymentsOf(cust)).to.have.lengthOf(1);
      });

      it('refuses the non-billable toggle once the linked payment is billed — nothing changes', async () => {
         const cust = await makeCustomer('unfund-billed');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         const statement = await makeParent(cust, 0);
         const payment = await paymentForDraw(entry.retainer_id);
         await db('customer_payments').where({ payment_id: payment.payment_id }).update({ customer_invoice_id: statement.customer_invoice_id });
         const before = await ledgerState([cust]);

         expectEnvelopeRefused(await http.update(formFor(entry, { isTransactionBillable: false })), /already been billed/, 'non-billable with a billed payment');
         expect(await ledgerState([cust])).to.deep.equal(before);
      });

      it('a payment written before the newest statement counts as billed even if finalize never stamped it', async () => {
         const cust = await makeCustomer('unfund-covered');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         await makeParent(cust, 0); // a statement issued after the payment row; the payment stays unstamped
         const before = await ledgerState([cust]);

         expectEnvelopeRefused(await http.update(formFor(entry, { isTransactionBillable: false })), /already been billed/, 'non-billable after a statement');
         expectEnvelopeRefused(await http.update(formFor(entry, { unitCost: 60, totalTransaction: 60 })), /already been billed/, 'amount edit after a statement');
         expectEnvelopeRefused(await http.remove(formFor(entry)), /already been billed and cannot be removed/, 'delete after a statement');
         expect(await ledgerState([cust])).to.deep.equal(before);

         // Edits that leave the payment alone still go through.
         expectEnvelopeOk(await http.update(formFor(entry, { detailedJobDescription: `${RUN_TAG} reworded` })), 'description-only edit');
      });

      it('non-billable → billable with a retainer creates the draw and its linked payment', async () => {
         const cust = await makeCustomer('fund');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id, isTransactionBillable: false });
         expect(entry.retainer_id).to.equal(null);
         expect(await paymentsOf(cust)).to.have.lengthOf(0);

         expectEnvelopeOk(await http.update(formFor(entry, { isTransactionBillable: true, selectedRetainerID: root.retainer_id })), 'make billable');

         const stored = await txnRow(entry.transaction_id);
         const chain = await chainOf(root.retainer_id);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-500, -450]);
         expect(stored.retainer_id).to.equal(chain[1].retainer_id);
         const payment = await paymentForDraw(stored.retainer_id);
         expect(num(payment.payment_amount)).to.equal(-50);
         expect(payment.customer_id).to.equal(cust.customerId);
      });

      it('a date-only edit moves the linked payment date so the link stays resolvable', async () => {
         const cust = await makeCustomer('date');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         const chainBefore = await chainOf(root.retainer_id);

         expectEnvelopeOk(await http.update(formFor(entry, { transactionDate: yesterday })), 'date-only edit');

         const payment = await paymentForDraw(entry.retainer_id);
         expect(dayjs(payment.payment_date).format('YYYY-MM-DD')).to.equal(yesterday);
         expect(num(payment.payment_amount)).to.equal(-50);
         expect(await chainOf(root.retainer_id)).to.deep.equal(chainBefore);

         // And the entry can still be deleted cleanly afterwards.
         expectEnvelopeOk(await http.remove(formFor(await txnRow(entry.transaction_id))), 'delete after the date edit');
         expect(await paymentsOf(cust)).to.have.lengthOf(0);
         expect((await chainOf(root.retainer_id)).map(r => num(r.current_amount))).to.deep.equal([-500]);
      });

      it('an amount edit re-prices its draw in place, the payment and the job total; an over-draw is refused', async () => {
         const cust = await makeCustomer('amount');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 200);
         const first = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         const second = await createEntry(cust, job, { selectedRetainerID: root.retainer_id, unitCost: 30, totalTransaction: 30 });

         expectEnvelopeOk(await http.update(formFor(first, { unitCost: 80, totalTransaction: 80 })), 'amount edit');

         const chain = await chainOf(root.retainer_id);
         expect(chain.map(r => r.retainer_id)).to.deep.equal([root.retainer_id, first.retainer_id, second.retainer_id]);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-200, -120, -90]);
         expect(num((await paymentForDraw(first.retainer_id)).payment_amount)).to.equal(-80);
         expect(num((await paymentForDraw(second.retainer_id)).payment_amount)).to.equal(-30);
         expect((await txnRow(first.transaction_id)).retainer_id).to.equal(first.retainer_id);
         expect(await latestJobTotal(job)).to.equal(110);

         const before = await ledgerState([cust]);
         const res = await http.update(formFor(await txnRow(first.transaction_id), { unitCost: 180, totalTransaction: 180 }));
         expectEnvelopeRefused(res, /greater than the current retainer balance\. This entry can increase by at most \$90\.00/, 'over-draw');
         expect(await ledgerState([cust])).to.deep.equal(before);
      });

      it('deleting one of two identical funded entries removes exactly its own draw and payment', async () => {
         const cust = await makeCustomer('twins');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         const first = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });
         const second = await createEntry(cust, job, { selectedRetainerID: root.retainer_id });

         // Same customer / chain / amount / date: amount-and-date matching alone refused this delete.
         expectEnvelopeOk(await http.remove(formFor(first)), 'delete the first twin');

         expect(await txnRow(first.transaction_id)).to.equal(undefined);
         expect(await paymentForDraw(first.retainer_id)).to.equal(undefined);
         const chain = await chainOf(root.retainer_id);
         expect(chain.map(r => r.retainer_id)).to.deep.equal([root.retainer_id, second.retainer_id]);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-500, -450]);
         expect(num((await paymentForDraw(second.retainer_id)).payment_amount)).to.equal(-50);
         expect(await latestJobTotal(job)).to.equal(50);
      });

      it('a legacy funded entry (no draw marker) is deleted with its single matching payment and a compensating snapshot', async () => {
         const cust = await makeCustomer('legacy');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);
         // What the pre-marker code wrote: draw snapshot, unmarked 'Retainer' payment, entry → draw.
         const [draw] = await db('customer_retainers_and_prepayments')
            .insert({ ...root, retainer_id: undefined, created_at: undefined, parent_retainer_id: root.retainer_id, current_amount: -450 })
            .returning('*');
         await db('customer_payments').insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_job_id: job,
            retainer_id: root.retainer_id,
            payment_date: today,
            payment_amount: -50,
            form_of_payment: 'Retainer',
            payment_reference_number: 'Retainer',
            is_transaction_billable: true,
            created_by_user_id: U
         });
         const [legacy] = await db('customer_transactions')
            .insert({
               account_id: A,
               customer_id: cust.customerId,
               customer_job_id: job,
               retainer_id: draw.retainer_id,
               logged_for_user_id: U,
               general_work_description_id: GWD_ID,
               transaction_date: today,
               transaction_type: 'Time',
               quantity: 1,
               unit_cost: 50,
               total_transaction: 50,
               is_transaction_billable: true,
               is_excess_to_subscription: false,
               created_by_user_id: U
            })
            .returning('*');

         expectEnvelopeOk(await http.remove(formFor(legacy)), 'delete the legacy entry');

         expect(await paymentsOf(cust)).to.have.lengthOf(0);
         const chain = await chainOf(root.retainer_id);
         expect(chain.map(r => num(r.current_amount))).to.deep.equal([-500, -450, -500]);
         expect(chain[2].parent_retainer_id).to.equal(root.retainer_id);
      });
   });

   // ── finding 8: own customer's retainer only ──────────────────────────────
   describe("finding 8 — an entry only draws on its own customer's retainer", () => {
      it("refuses a create against another customer's retainer before any write", async () => {
         const cust = await makeCustomer('cross-a');
         const other = await makeCustomer('cross-b');
         const job = await makeJob(cust);
         const otherRoot = await makeRetainer(other, 100);
         const before = await ledgerState([cust, other]);

         const res = await http.create(newForm(cust, job, { selectedRetainerID: otherRoot.retainer_id }));
         expectEnvelopeRefused(res, /belongs to a different customer than this transaction/, 'cross-customer create');

         expect(await ledgerState([cust, other])).to.deep.equal(before);
      });

      it("refuses funding an update from another customer's retainer", async () => {
         const cust = await makeCustomer('cross-upd-a');
         const other = await makeCustomer('cross-upd-b');
         const job = await makeJob(cust);
         const otherRoot = await makeRetainer(other, 100);
         const entry = await createEntry(cust, job, { isTransactionBillable: false });
         const before = await ledgerState([cust, other]);

         const res = await http.update(formFor(entry, { isTransactionBillable: true, selectedRetainerID: otherRoot.retainer_id }));
         expectEnvelopeRefused(res, /belongs to a different customer than this transaction/, 'cross-customer fund on update');
         expect(await ledgerState([cust, other])).to.deep.equal(before);
      });

      it("refuses updating or deleting an entry whose stored draw sits on another customer's retainer", async () => {
         const cust = await makeCustomer('cross-stored-a');
         const other = await makeCustomer('cross-stored-b');
         const job = await makeJob(cust);
         const otherRoot = await makeRetainer(other, 100);
         // What the pre-fix create path wrote: customer A's entry drawing on customer B's chain.
         const [foreignDraw] = await db('customer_retainers_and_prepayments')
            .insert({ ...otherRoot, retainer_id: undefined, created_at: undefined, parent_retainer_id: otherRoot.retainer_id, current_amount: -50 })
            .returning('*');
         await db('customer_payments').insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_job_id: job,
            retainer_id: otherRoot.retainer_id,
            payment_date: today,
            payment_amount: -50,
            form_of_payment: 'Retainer',
            payment_reference_number: 'Retainer',
            is_transaction_billable: true,
            created_by_user_id: U
         });
         const [entry] = await db('customer_transactions')
            .insert({
               account_id: A,
               customer_id: cust.customerId,
               customer_job_id: job,
               retainer_id: foreignDraw.retainer_id,
               logged_for_user_id: U,
               general_work_description_id: GWD_ID,
               transaction_date: today,
               transaction_type: 'Time',
               quantity: 1,
               unit_cost: 50,
               total_transaction: 50,
               is_transaction_billable: true,
               is_excess_to_subscription: false,
               created_by_user_id: U
            })
            .returning('*');
         const before = await ledgerState([cust, other]);

         expectEnvelopeRefused(await http.update(formFor(entry, { unitCost: 40, totalTransaction: 40 })), /belongs to a different customer/, 'amount edit');
         expectEnvelopeRefused(await http.update(formFor(entry, { isTransactionBillable: false })), /belongs to a different customer/, 'non-billable');
         expectEnvelopeRefused(await http.remove(formFor(entry)), /belongs to a different customer/, 'delete');
         expect(await ledgerState([cust, other])).to.deep.equal(before);
      });
   });

   // ── A3 (2026-09 review): authenticated actor is the recorded creator ─────
   describe('A3 — the authenticated actor is the recorded creator, not a body-supplied loggedByUserID', () => {
      it('create: a spoofed loggedByUserID in the body is ignored — the authenticated actor is the creator', async () => {
         const cust = await makeCustomer('spoof-create');
         const job = await makeJob(cust);

         const entry = await createEntry(cust, job, { loggedByUserID: 90011, loggedForUserID: 90011 });

         expect(entry.created_by_user_id, 'the AUTHENTICATED actor is the creator, not the spoofed body value').to.equal(U);
         expect(entry.logged_for_user_id, 'logged_for_user_id is unaffected — it still records whose work this is').to.equal(90011);
      });

      it('update: a spoofed loggedByUserID in the body can never overwrite the original creator', async () => {
         const cust = await makeCustomer('spoof-update');
         const job = await makeJob(cust);
         const entry = await createEntry(cust, job);
         expect(entry.created_by_user_id).to.equal(U);

         expectEnvelopeOk(await http.update(formFor(entry, { loggedByUserID: 999999, detailedJobDescription: `${RUN_TAG} edited` })), 'edit with spoofed loggedByUserID');

         const stored = await txnRow(entry.transaction_id);
         expect(stored.created_by_user_id, 'the original creator survives the edit; the spoofed value never lands').to.equal(U);
         expect(stored.detailed_work_description).to.equal(`${RUN_TAG} edited`);
      });

      it('a "fund" retainer draw and its auto payment are attributed to the authenticated actor, ignoring a spoofed loggedByUserID', async () => {
         // Four DISTINCT fixture users (seed.sql: 90011 Eliza, 90012 Bob,
         // 90013 Admin, 90014 Sam-inactive) so a value that merely SURVIVED
         // from somewhere else — the retainer's own creator, the entry's own
         // creator, or whose work this is — can never be mistaken for the
         // authenticated actor actually being stamped on the new draw.
         const RETAINER_CREATOR = 90012;
         const WORKER = 90014;
         const TRANSACTION_CREATOR = 90011;
         const EDITOR = 90013;
         expect(new Set([RETAINER_CREATOR, WORKER, TRANSACTION_CREATOR, EDITOR]).size, 'sanity: all four roles are different users').to.equal(4);

         const cust = await makeCustomer('spoof-fund');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500, RETAINER_CREATOR);

         // The /transactions/* routes require manager/admin (role gate —
         // see coverage-transactions-retainers-writeoffs.integration.spec.js);
         // Eliza (employee) cannot call them at all. Seed the UNFUNDED entry
         // directly instead, stamped with a creator and a worker distinct
         // from the retainer's creator and from the admin who edits it below
         // — the same direct-insert fixture pattern the legacy-entry tests
         // already use elsewhere in this file.
         const [entry] = await db('customer_transactions')
            .insert({
               account_id: A,
               customer_id: cust.customerId,
               customer_job_id: job,
               retainer_id: null,
               logged_for_user_id: WORKER,
               general_work_description_id: GWD_ID,
               transaction_date: today,
               transaction_type: 'Time',
               quantity: 1,
               unit_cost: 50,
               total_transaction: 50,
               is_transaction_billable: false,
               is_excess_to_subscription: false,
               created_by_user_id: TRANSACTION_CREATOR,
               detailed_work_description: RUN_TAG
            })
            .returning('*');

         expectEnvelopeOk(
            await h
               .as('admin')
               .put(`/transactions/updateTransaction/${base}`)
               .send({ transaction: formFor(entry, { isTransactionBillable: true, selectedRetainerID: root.retainer_id, loggedByUserID: 999999 }) }),
            'fund via edit with spoofed loggedByUserID'
         );

         const stored = await txnRow(entry.transaction_id);
         expect(stored.created_by_user_id, 'editing never overwrites the original creator').to.equal(TRANSACTION_CREATOR);
         const draw = await retainerRow(stored.retainer_id);
         expect(draw.created_by_user_id, 'the new draw is attributed to the AUTHENTICATED EDITOR — not the retainer creator, the transaction creator, the worker, or the spoofed body value').to.equal(EDITOR);
         const payment = await paymentForDraw(stored.retainer_id);
         expect(payment.created_by_user_id, 'same for the auto Retainer payment').to.equal(EDITOR);
      });
   });

   // ── A4-2 (2026-09 review round 4): compensating retainer snapshots ───────
   // record the AUTHENTICATED ACTOR performing the reprice/unfund/delete, not
   // whoever created the legacy-funded entry (appendCompensatingSnapshot used
   // to copy created_by_user_id forward from the chain's latest row via
   // copyableRetainerFields, which — before this fix — meant the RETAINER's
   // own creator, not even the entry's creator).
   describe('A4-2 — compensating retainer snapshots record the authenticated actor, not the previous creator', () => {
      const RETAINER_CREATOR = 90012; // Bob — opens the retainer
      const ENTRY_CREATOR = 90011; // Eliza — the legacy entry's own creator
      const EDITOR = 90013; // Admin — performs the reprice / unfund / delete

      // What the pre-marker code wrote: draw snapshot (no [retainer_draw:id]
      // on the payment note), unmarked 'Retainer' payment, entry -> draw. This
      // takes the LEGACY / compensating-snapshot path on every mutation.
      const makeLegacyFundedEntry = async (cust, job, root, amount) => {
         const [draw] = await db('customer_retainers_and_prepayments')
            .insert({ ...root, retainer_id: undefined, created_at: undefined, parent_retainer_id: root.retainer_id, current_amount: num(root.current_amount) + amount })
            .returning('*');
         await db('customer_payments').insert({
            account_id: A,
            customer_id: cust.customerId,
            customer_job_id: job,
            retainer_id: root.retainer_id,
            payment_date: today,
            payment_amount: -amount,
            form_of_payment: 'Retainer',
            payment_reference_number: 'Retainer',
            is_transaction_billable: true,
            created_by_user_id: ENTRY_CREATOR
         });
         const [legacy] = await db('customer_transactions')
            .insert({
               account_id: A,
               customer_id: cust.customerId,
               customer_job_id: job,
               retainer_id: draw.retainer_id,
               logged_for_user_id: ENTRY_CREATOR,
               general_work_description_id: GWD_ID,
               transaction_date: today,
               transaction_type: 'Time',
               quantity: 1,
               unit_cost: amount,
               total_transaction: amount,
               is_transaction_billable: true,
               is_excess_to_subscription: false,
               created_by_user_id: ENTRY_CREATOR,
               detailed_work_description: RUN_TAG
            })
            .returning('*');
         return legacy;
      };

      const newestOnChain = async rootId => {
         const chain = await chainOf(rootId);
         return chain[chain.length - 1];
      };

      it('reprice (amount edit) on a legacy-funded entry stamps the compensating snapshot with the authenticated editor', async () => {
         const cust = await makeCustomer('a42-reprice');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500, RETAINER_CREATOR);
         const legacy = await makeLegacyFundedEntry(cust, job, root, 50);

         expectEnvelopeOk(
            await h.as('admin').put(`/transactions/updateTransaction/${base}`).send({ transaction: formFor(legacy, { unitCost: 80, totalTransaction: 80, loggedByUserID: 999999 }) }),
            'reprice legacy-funded entry'
         );

         const newest = await newestOnChain(root.retainer_id);
         expect(newest.created_by_user_id, "the new compensating snapshot is attributed to the AUTHENTICATED EDITOR, not the entry's original creator").to.equal(EDITOR);
         expect(num(newest.current_amount)).to.equal(-420); // -450 (fixture draw) + 30 (amount delta)
      });

      it('unfund (billable → non-billable) on a legacy-funded entry stamps the compensating snapshot with the authenticated editor', async () => {
         const cust = await makeCustomer('a42-unfund');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500, RETAINER_CREATOR);
         const legacy = await makeLegacyFundedEntry(cust, job, root, 50);

         expectEnvelopeOk(
            await h.as('admin').put(`/transactions/updateTransaction/${base}`).send({ transaction: formFor(legacy, { isTransactionBillable: false, loggedByUserID: 999999 }) }),
            'unfund legacy-funded entry'
         );

         const newest = await newestOnChain(root.retainer_id);
         expect(newest.created_by_user_id, "the compensating snapshot is attributed to the AUTHENTICATED EDITOR, not the entry's original creator").to.equal(EDITOR);
         expect(num(newest.current_amount)).to.equal(-500); // fully given back
         expect((await txnRow(legacy.transaction_id)).retainer_id).to.equal(null);
      });

      it('delete of a legacy-funded entry stamps the compensating snapshot with the authenticated actor performing the delete', async () => {
         const cust = await makeCustomer('a42-delete');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500, RETAINER_CREATOR);
         const legacy = await makeLegacyFundedEntry(cust, job, root, 50);

         expectEnvelopeOk(await h.as('admin').delete(`/transactions/deleteTransaction/${base}`).send({ transaction: formFor(legacy) }), 'delete legacy-funded entry');

         const newest = await newestOnChain(root.retainer_id);
         expect(newest.created_by_user_id, "the compensating snapshot is attributed to the AUTHENTICATED actor performing the delete, not the entry's original creator").to.equal(EDITOR);
         expect(num(newest.current_amount)).to.equal(-500);
         expect(await txnRow(legacy.transaction_id)).to.equal(undefined);
      });
   });

   // ── A4 (2026-09 review): a string "false" must not be coerced to true ────
   describe('A4 — a string "false" billable/subscription flag is honored, not coerced to true', () => {
      it('isTransactionBillable: "false" with a retainer selected stores non-billable and funds NOTHING — no draw, no payment', async () => {
         const cust = await makeCustomer('string-false');
         const job = await makeJob(cust);
         const root = await makeRetainer(cust, 500);

         const entry = await createEntry(cust, job, { selectedRetainerID: root.retainer_id, isTransactionBillable: 'false' });

         expect(entry.is_transaction_billable, 'the string "false" must be stored as false, not true (Boolean("false") === true)').to.equal(false);
         expect(entry.retainer_id, 'a non-billable entry never funds — no draw is created').to.equal(null);
         expect(await paymentsOf(cust)).to.have.lengthOf(0);
         expect(num((await retainerRow(root.retainer_id)).current_amount), 'the retainer is untouched').to.equal(-500);
      });

      it('isInAdditionToMonthlyCharge: "false" is honored on both create and update', async () => {
         const cust = await makeCustomer('string-false-excess');
         const job = await makeJob(cust);

         // CREATE with the string "false" — Boolean('false') === true, so a
         // naive coercion would store true here; this must store false.
         const entry = await createEntry(cust, job, { isInAdditionToMonthlyCharge: 'false' });
         expect(entry.is_excess_to_subscription, 'string "false" on CREATE must store false, not true').to.equal(false);

         expectEnvelopeOk(await http.update(formFor(entry, { isInAdditionToMonthlyCharge: 'true' })), 'excess-flag string-true edit');
         expect((await txnRow(entry.transaction_id)).is_excess_to_subscription).to.equal(true);

         expectEnvelopeOk(await http.update(formFor(entry, { isInAdditionToMonthlyCharge: 'false' })), 'excess-flag string-false edit');
         expect((await txnRow(entry.transaction_id)).is_excess_to_subscription).to.equal(false);
      });
   });

   // ── training-insert SAVEPOINT: a real PostgreSQL error, not a JS throw ───
   describe('training-insert SAVEPOINT isolation against a genuine PostgreSQL error', () => {
      it('a real division-by-zero during the AI training insert is contained by its SAVEPOINT — the entry commits and the connection stays usable', async () => {
         const aiCategoryTrainingService = require('../../src/endpoints/aiIntegration/ai-category-training-service');
         const cust = await makeCustomer('training-savepoint');
         const job = await makeJob(cust);
         const original = aiCategoryTrainingService.insert;
         // A genuine PostgreSQL error INSIDE the savepoint transaction (not a
         // JS-level throw, which the unit spec already covers but which cannot
         // exercise real savepoint recovery — see sharedTransactionFunctions.spec.js).
         aiCategoryTrainingService.insert = sp => sp.raw('SELECT 1/0');

         let entry;
         try {
            entry = await createEntry(cust, job, { detailedJobDescription: `${RUN_TAG} training-savepoint` });
         } finally {
            aiCategoryTrainingService.insert = original;
         }

         expect(entry.transaction_id, 'the entry commits despite the training insert failing inside its own savepoint').to.be.a('number');
         expect(await txnRow(entry.transaction_id)).to.exist;
         expect(await latestJobTotal(job)).to.equal(50);
         // A real (non-savepoint) Postgres error poisons a transaction until
         // ROLLBACK; the shared connection pool remaining usable afterward
         // confirms the failure was truly contained to the SAVEPOINT.
         expect((await db.raw('SELECT 1 AS ok')).rows[0].ok).to.equal(1);
      });
   });
});
