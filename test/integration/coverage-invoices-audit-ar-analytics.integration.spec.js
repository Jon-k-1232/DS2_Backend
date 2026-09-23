/**
 * HTTP-level route coverage for invoices, account audit, accounts receivable,
 * analytics and the customer statement PDF (review/full-audit-2026-09).
 *
 * Scope is deliberately NOT the finalize/rolling-balance math itself —
 * month-end-lifecycle.integration.spec.js and finalize-engine.integration.spec.js
 * already drive that end to end (month 1 -> month 2 rollover, allowSameDayRebill
 * absorption, deleteInvoice guards for a 'rolled' parent and a payment snapshot,
 * a zero-history parent deleting cleanly, getInvoiceDetails chain reads, the
 * three-views-agree invariant). This spec does not repeat those scenarios; see
 * the per-route comments below for exactly which existing test covers what, and
 * the final report for the full cross-reference. This spec's job is HTTP-surface
 * coverage: every route's happy path + response/DB proof, validation failures,
 * 401/403 (role gate + cross-tenant), not-found, and a few domain edges that
 * were NOT already exercised (drafts/CSV-only persisting no rows, a "linked
 * rows" deleteInvoice refusal, search, pagination, the audit run -> job ->
 * detail -> PDF pipeline, AR aging + CSV, and the analytics surface).
 *
 * Fixtures: two fresh account-9001 customers created directly in SQL (not
 * through the customer/job routers, which are out of this spec's area):
 *   custA — plain "invoice ops" customer. Gets one unbilled transaction, is run
 *           through POST createInvoice (draft/csv-only/finalized/same-day-skip),
 *           and its finalized parent is reused for getInvoices / paginated
 *           search / getInvoiceDetails / deleteInvoice ("linked rows" refusal)
 *           / the account audit run.
 *   custB — display/business/customer name starts with '=' (CSV formula-
 *           injection probe) and carries one unbilled + one billed transaction
 *           plus a directly-inserted invoice, for the accountsReceivable aging
 *           row/export and the analytics clientRates export + rateAgreement.
 *
 * Account 1 (the prod copy) is used strictly READ-ONLY, via the persistent
 * `superAdmin` identity from _http.js, for the analytics endpoints that don't
 * need controllable fixture data (numeric-shape + role/tenant gates only).
 *
 * accountAudit is super-admin only. There is no super admin in the account
 * 9001 fixture (test/fixtures/seed.sql), so `before` creates a temporary one
 * (deleted in `after`) and mints its token via h.mint('admin', {user_id,
 * email}) — the 'admin' identity base carries account_id 9001; only the
 * user_id/email are overridden, and auth resolves account_id / access_level
 * fresh from the users row this spec inserts.
 *
 * Bedrock is stubbed fail-closed (test/fixtures/integrationHelpers) for the
 * audit narrative call so the audit run completes fast and deterministically
 * instead of making a real network call (mirrors pii-leak.integration.spec.js).
 *
 * Run:
 *   DS2_ENV_FILE=.env.local npx mocha --require test/setup.js \
 *     test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js \
 *     test/integration/analytics.integration.spec.js --exit --timeout 180000
 */
const dayjs = require('dayjs');
const { bootHttp, uniqueName, expectEnvelopeOk, expectEnvelopeRefused } = require('./_http');
const { TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');
const { putObject, deleteObject } = require('../../src/utils/s3');
const { installFailClosedAws } = require('../fixtures/integrationHelpers');

const A = TEST_ACCOUNT_ID; // 9001 — the fixture account. Never account 1.
const REAL_ACCOUNT_ID = 1; // prod copy — READ-ONLY in this spec.
const REAL_SUPERADMIN_USER_ID = 21; // admin@jimkimmel.com — matches _http.js IDENTITIES.superAdmin.
const U = TEST_ADMIN_USER_ID; // 90013
const JOB_TYPE_ID = 900201; // seed: '1040 Individual Return'
const GWD_ID = 90031; // seed: 'Tax Return Preparation'

const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ymd = d => dayjs(d).format('YYYY-MM-DD');
const daysAgo = n => dayjs().subtract(n, 'day').format('YYYY-MM-DD');

describe('integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP)', function () {
   this.timeout(180_000);

   let h;
   let db;
   const s3Keys = [];
   const createdCustomerIds = [];
   let tempSuperAdmin = null; // { user_id, email, token }
   let createdAccountInfoId = null;
   let accountColumnsToRestore = null;

   // Ledger state shared across describe blocks, populated by the earlier
   // blocks and consumed by later ones (mocha runs sibling describes in file
   // order, so this is safe — same pattern finalize-engine.spec.js uses within
   // one describe, just spread across route-titled ones here).
   let custA; // { customerId, customerInfoId, name }
   let custB;
   let custAJobId;
   let custAUnbilledTxn;
   let finalizedInvoice; // custA's real parent invoice from POST createInvoice
   let auditJobId;
   let auditId;
   let realAudit; // a real, pre-existing completed account-1 audit — READ-ONLY use only.

   // ── harness helpers ───────────────────────────────────────────────────────
   const asTemp = () => {
      const token = tempSuperAdmin.token;
      const wrap = method => url => h.request[method](url).set('Authorization', `Bearer ${token}`);
      return { get: wrap('get'), post: wrap('post'), delete: wrap('delete') };
   };

   const createCustomer = async ({ label, formulaName = false }) => {
      const stamp = uniqueName(label);
      const name = (formulaName ? '=' : '') + stamp;
      const [customer] = await db('customers')
         .insert({
            account_id: A,
            business_name: name,
            customer_name: name,
            display_name: name,
            is_commercial_customer: true,
            is_customer_active: true,
            is_billable: true,
            is_recurring: false
         })
         .returning('*');
      createdCustomerIds.push(customer.customer_id);
      const [info] = await db('customer_information')
         .insert({
            account_id: A,
            customer_id: customer.customer_id,
            customer_street: '1 Coverage Way',
            customer_city: 'Phoenix',
            customer_state: 'AZ',
            customer_zip: '85001',
            customer_email: `${stamp.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.test`,
            customer_phone: '5551234567',
            is_this_address_active: true,
            is_customer_physical_address: true,
            is_customer_billing_address: true,
            is_customer_mailing_address: true,
            created_by_user_id: U
         })
         .returning('*');
      return { customerId: customer.customer_id, customerInfoId: info.customer_info_id, name };
   };

   const createJob = async customerId => {
      const [job] = await db('customer_jobs')
         .insert({ account_id: A, customer_id: customerId, job_type_id: JOB_TYPE_ID, current_job_total: 0, is_quote: false, is_job_complete: false, created_by_user_id: U })
         .returning('*');
      return job.customer_job_id;
   };

   const insertTransaction = async ({ customerId, jobId, date, quantity = 1, unitCost, billable = true, invoiceId = null, type = 'Time' }) => {
      const total = money(quantity * unitCost);
      const [txn] = await db('customer_transactions')
         .insert({
            account_id: A,
            customer_id: customerId,
            customer_job_id: jobId,
            customer_invoice_id: invoiceId,
            logged_for_user_id: h.employeeUserID,
            general_work_description_id: GWD_ID,
            detailed_work_description: 'coverage spec fixture',
            transaction_date: date,
            transaction_type: type,
            quantity,
            unit_cost: unitCost,
            total_transaction: total,
            is_transaction_billable: billable,
            is_excess_to_subscription: false,
            created_by_user_id: U
         })
         .returning('*');
      return txn;
   };

   const insertInvoiceRow = async fields => {
      const [row] = await db('customer_invoices')
         .insert({
            account_id: A,
            created_by_user_id: U,
            is_invoice_paid_in_full: false,
            beginning_balance: 0,
            total_payments: 0,
            total_charges: 0,
            total_write_offs: 0,
            total_retainers: 0,
            total_amount_due: 0,
            ...fields
         })
         .returning('*');
      return row;
   };

   const engineTotalFor = async customerId => {
      const invoicesToCreate = [{ customer_id: customerId, showWriteOffs: false }];
      const queryData = await fetchInitialQueryItems(db, { [customerId]: invoicesToCreate[0] }, A);
      const [calc] = calculateInvoices(invoicesToCreate, queryData);
      return money(calc.invoiceTotal);
   };

   const waitForJob = async (jobId, { timeoutMs = 30000, intervalMs = 250 } = {}) => {
      const start = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
         const res = await asTemp().get(`/accountAudit/job/${jobId}/${A}/${tempSuperAdmin.user_id}`);
         if (res.body && (res.body.processing_status === 'complete' || res.body.processing_status === 'failed')) return res.body;
         if (Date.now() - start > timeoutMs) throw new Error(`audit job ${jobId} did not complete within ${timeoutMs}ms — last body: ${JSON.stringify(res.body).slice(0, 300)}`);
         await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
   };

   // ── fixture ────────────────────────────────────────────────────────────────
   before(async function () {
      h = await bootHttp.call(this);
      db = h.db;
      installFailClosedAws(); // audit narrative's Bedrock call fails fast & deterministically — no live network

      // accountService.getAccount INNER JOINs account_information; the PDF path
      // (createInvoice draft/csv-only/finalized) needs both this row and the two
      // account text fields. seed.sql already provisions both for 9001 as of
      // 2026-09; this is defensive-only (mirrors finalize-engine.integration.spec.js
      // so this file is correct even against an older seed).
      const existingInfo = await db('account_information').where({ account_id: A }).first();
      if (!existingInfo) {
         const [row] = await db('account_information')
            .insert({
               account_id: A,
               account_street: '100 Fixture Way',
               account_city: 'Phoenix',
               account_state: 'AZ',
               account_zip: '85001',
               account_email: 'billing+test@example.com',
               account_phone: '5550100000',
               is_this_address_active: true,
               is_account_physical_address: true,
               is_account_billing_address: true,
               is_account_mailing_address: true
            })
            .returning('account_info_id');
         createdAccountInfoId = row.account_info_id || row;
      }
      const account = await db('accounts').where({ account_id: A }).first();
      const patch = {};
      if (account.account_statement == null) patch.account_statement = 'Please reference invoice number on payment.';
      if (account.account_interest_statement == null) patch.account_interest_statement = 'Balances unpaid for 30 days accrue interest at the rate of 18% per annum.';
      if (account.account_invoice_interest_rate == null) patch.account_invoice_interest_rate = 1.5;
      if (account.account_invoice_template_option == null) patch.account_invoice_template_option = 'template_one';
      if (Object.keys(patch).length) {
         accountColumnsToRestore = Object.keys(patch).reduce((acc, key) => ({ ...acc, [key]: account[key] }), {});
         await db('accounts').where({ account_id: A }).update(patch);
      }

      // No super admin exists in the 9001 fixture (seed.sql: 90011/90012 employee,
      // 90013 admin, 90014 inactive employee) — accountAudit and analytics are
      // super-admin-only, so mint one for account-9001-scoped runs.
      const tempEmail = `${uniqueName('covsuperadmin').toLowerCase()}@example.test`;
      const [tempUser] = await db('users')
         .insert({ account_id: A, email: tempEmail, display_name: 'Coverage Temp Super Admin', job_title: 'Auditor', access_level: 'super admin', is_user_active: true })
         .returning(['user_id', 'email']);
      tempSuperAdmin = { user_id: tempUser.user_id, email: tempUser.email, token: h.mint('admin', { user_id: tempUser.user_id, email: tempUser.email }) };

      // custA — plain customer driven through POST createInvoice.
      custA = await createCustomer({ label: 'CovA' });
      custAJobId = await createJob(custA.customerId);
      custAUnbilledTxn = await insertTransaction({ customerId: custA.customerId, jobId: custAJobId, date: daysAgo(2), quantity: 2.5, unitCost: 100 });

      // custB — CSV formula-injection probe, feeds AR + analytics.
      custB = await createCustomer({ label: 'CovB', formulaName: true });
      const custBJobId = await createJob(custB.customerId);
      await insertTransaction({ customerId: custB.customerId, jobId: custBJobId, date: daysAgo(3), quantity: 2, unitCost: 100 }); // unbilled — clientRates/wipAging
      const custBInvoice = await insertInvoiceRow({
         customer_id: custB.customerId,
         customer_info_id: custB.customerInfoId,
         invoice_number: uniqueName('CovBInv'),
         invoice_date: daysAgo(20),
         due_date: daysAgo(4),
         start_date: daysAgo(50),
         end_date: daysAgo(20),
         total_charges: 200,
         total_amount_due: 200,
         remaining_balance_on_invoice: 200
      });
      await insertTransaction({ customerId: custB.customerId, jobId: custBJobId, date: daysAgo(20), quantity: 1, unitCost: 200, invoiceId: custBInvoice.customer_invoice_id }); // billed — AR oldest-open-charge
      custB.invoiceId = custBInvoice.customer_invoice_id;

      // A real, already-completed account-1 audit (never created or mutated by
      // this spec) — lets the GET accountAudit routes get one genuinely
      // READ-ONLY pass against real data, per the task's instruction to use
      // the superAdmin identity for read-only account-1 calls.
      realAudit = await db('account_audits').where({ account_id: REAL_ACCOUNT_ID, status: 'completed' }).whereNotNull('pdf_s3_key').orderBy('audit_id', 'desc').first();
   });

   after(async function () {
      this.timeout(60_000);
      if (db) {
         for (const id of createdCustomerIds) {
            const where = { account_id: A, customer_id: id };
            await db('customer_rate_agreements').where(where).del().catch(() => {});
            // Audit runs save a PDF to S3 (account_audits/<account>/<customer>/audit-<id>-<ts>.pdf,
            // written by accountAudit's runAuditBatch) — the DB row cascades from
            // `customers`, but the S3 object does not, so it must be swept here too.
            (await db('account_audits').where(where).whereNotNull('pdf_s3_key').pluck('pdf_s3_key')).forEach(key => s3Keys.push(key));
            await db('account_audits').where(where).del().catch(() => {});
            const myTxnIds = await db('customer_transactions').where(where).pluck('transaction_id');
            if (myTxnIds.length) await db('ai_category_training_examples').whereIn('transaction_id', myTxnIds).del().catch(() => {});
            (await db('customer_invoices').where(where).whereNotNull('invoice_file_location').pluck('invoice_file_location')).forEach(key => s3Keys.push(key));
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
         if (tempSuperAdmin) {
            await db('ai_call_log').where({ account_id: A, user_id: tempSuperAdmin.user_id }).del().catch(() => {});
            await db('users').where({ account_id: A, user_id: tempSuperAdmin.user_id }).del();
         }
         if (createdAccountInfoId) await db('account_information').where({ account_info_id: createdAccountInfoId, account_id: A }).del();
         if (accountColumnsToRestore) await db('accounts').where({ account_id: A }).update(accountColumnsToRestore);
      }
      for (const key of new Set(s3Keys.filter(Boolean))) {
         await deleteObject(key).catch(() => {});
      }
      await h.close();
   });

   // ════════════════════════════════════════════════════════════════════════
   // src/endpoints/invoice/**
   // ════════════════════════════════════════════════════════════════════════

   describe('GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/invoices/createInvoice/AccountsWithBalance/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/invoices/createInvoice/AccountsWithBalance/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/invoices/createInvoice/AccountsWithBalance/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it("lists custA's unbilled balance with the engine-computed invoice_total, before it is billed", async () => {
         const engineTotal = await engineTotalFor(custA.customerId);
         const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/createInvoice/AccountsWithBalance/${A}/${U}`), 'AccountsWithBalance');
         const data = body.outstandingBalanceList.activeOutstandingBalancesData;
         const row = data.activeOutstandingBalances.find(c => c.customer_id === custA.customerId);
         expect(row, 'custA listed').to.exist;
         expect(row.transaction_count).to.equal(1);
         expect(money(row.billable_transactions_total)).to.equal(money(custAUnbilledTxn.total_transaction));
         expect(money(row.invoice_total)).to.equal(engineTotal);
         expect(row.billed_today).to.equal(false);
         const gridRow = data.grid.rows.find(r => r.customer_id === custA.customerId);
         expect(gridRow, 'custA in grid view').to.exist;
      });
   });

   describe('POST /invoices/createInvoice/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.post(`/invoices/createInvoice/${A}/${U}`).send({ invoiceConfiguration: {} });
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').post(`/invoices/createInvoice/${A}/${U}`).send({ invoiceConfiguration: {} });
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').post(`/invoices/createInvoice/${A}/${U}`).send({ invoiceConfiguration: {} });
         expect(res.status).to.equal(403);
      });
      it('validation failure: no customers selected', async () => {
         const res = await h
            .as('admin')
            .post(`/invoices/createInvoice/${A}/${U}`)
            .send({ invoiceConfiguration: { invoicesToCreate: [], invoiceCreationSettings: { isFinalized: true } } });
         const body = expectEnvelopeRefused(res, /Select at least one customer/, 'createInvoice (empty selection)');
         expect(body.message).to.include('Select at least one customer');
      });
      it('isRoughDraft + isCsvOnly build a downloadable zip but persist no invoice or transaction rows', async () => {
         const before = await db('customer_invoices').where({ account_id: A, customer_id: custA.customerId }).count({ count: '*' }).first();
         expect(Number(before.count)).to.equal(0);

         const body = expectEnvelopeOk(
            await h
               .as('admin')
               .post(`/invoices/createInvoice/${A}/${U}`)
               .send({
                  invoiceConfiguration: {
                     invoicesToCreate: [{ customer_id: custA.customerId, showWriteOffs: false }],
                     invoiceCreationSettings: { isFinalized: false, isRoughDraft: true, isCsvOnly: true, globalInvoiceNote: 'draft note' }
                  }
               }),
            'createInvoice (draft + csv-only)'
         );
         expect(body.message).to.equal('Successfully generated invoice preview.');
         expect(body.fileLocation, 'a draft/csv zip was produced').to.be.a('string').and.not.equal('');
         expect(body.fileLocation).to.include('invoicing/csv_report_and_draft_invoices');
         s3Keys.push(body.fileLocation);

         const after = await db('customer_invoices').where({ account_id: A, customer_id: custA.customerId }).count({ count: '*' }).first();
         expect(Number(after.count), 'draft/csv-only must not write customer_invoices').to.equal(0);
         const txn = await db('customer_transactions').where({ transaction_id: custAUnbilledTxn.transaction_id }).first();
         expect(txn.customer_invoice_id, 'the transaction must stay unbilled').to.equal(null);
      });
      it('isFinalized creates a parent invoice and stamps the transaction', async () => {
         const engineTotal = await engineTotalFor(custA.customerId);
         const body = expectEnvelopeOk(
            await h
               .as('admin')
               .post(`/invoices/createInvoice/${A}/${U}`)
               .send({
                  invoiceConfiguration: {
                     invoicesToCreate: [{ customer_id: custA.customerId, showWriteOffs: false }],
                     invoiceCreationSettings: { isFinalized: true, isRoughDraft: false, isCsvOnly: false, globalInvoiceNote: 'Thank you for your business.' }
                  }
               }),
            'createInvoice (finalize custA)'
         );
         expect(body.message).to.equal('Finalized 1 invoice(s).');
         expect(body.skippedCustomers).to.deep.equal([]);
         s3Keys.push(body.fileLocation);

         const parents = await db('customer_invoices').where({ account_id: A, customer_id: custA.customerId }).whereNull('parent_invoice_id');
         expect(parents).to.have.lengthOf(1);
         [finalizedInvoice] = parents;
         expect(money(finalizedInvoice.total_charges)).to.equal(money(custAUnbilledTxn.total_transaction));
         expect(money(finalizedInvoice.remaining_balance_on_invoice)).to.equal(engineTotal);
         expect(finalizedInvoice.is_invoice_paid_in_full).to.equal(false);

         const txn = await db('customer_transactions').where({ transaction_id: custAUnbilledTxn.transaction_id }).first();
         expect(txn.customer_invoice_id, 'the transaction is now billed to the new parent').to.equal(finalizedInvoice.customer_invoice_id);
      });
      it('a same-day re-run without allowSameDayRebill reports custA in skippedCustomers and creates no second parent', async () => {
         const body = expectEnvelopeOk(
            await h
               .as('admin')
               .post(`/invoices/createInvoice/${A}/${U}`)
               .send({
                  invoiceConfiguration: {
                     invoicesToCreate: [{ customer_id: custA.customerId, showWriteOffs: false }],
                     invoiceCreationSettings: { isFinalized: true, isRoughDraft: false, isCsvOnly: false }
                  }
               }),
            'createInvoice (same-day re-run)'
         );
         expect(body.invoicesWithDetail).to.deep.equal([]);
         expect(body.fileLocation).to.equal('');
         expect(body.skippedCustomers).to.have.lengthOf(1);
         expect(body.skippedCustomers[0].customer_id).to.equal(custA.customerId);
         expect(body.skippedCustomers[0].invoice_number).to.equal(finalizedInvoice.invoice_number);
         expect(body.skippedCustomers[0].reason).to.include('Already finalized today');

         const parents = await db('customer_invoices').where({ account_id: A, customer_id: custA.customerId }).whereNull('parent_invoice_id');
         expect(parents, 'still exactly one parent').to.have.lengthOf(1);
      });
      // NOTE: allowSameDayRebill absorption, the credit-balance skip, and the
      // full drift-detected-mid-run refusal are already covered by
      // finalize-engine.integration.spec.js (its 4a/4b/4b-ii/4b-iii) and are not
      // repeated here.
   });

   describe('GET /invoices/getInvoices/:accountID/:invoiceID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/invoices/getInvoices/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/invoices/getInvoices/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/invoices/getInvoices/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it("lists the freshly finalized custA invoice, in the grid and tree grid", async () => {
         const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/getInvoices/${A}/${U}`), 'getInvoices');
         const row = body.activeInvoiceData.activeInvoices.find(i => i.customer_invoice_id === finalizedInvoice.customer_invoice_id);
         expect(row, 'finalized invoice present').to.exist;
         expect(row.invoice_number).to.equal(finalizedInvoice.invoice_number);
         expect(money(row.remaining_balance_on_invoice)).to.equal(money(finalizedInvoice.remaining_balance_on_invoice));
         expect(body.activeInvoiceData.grid.rows.some(r => r.customer_invoice_id === finalizedInvoice.customer_invoice_id)).to.equal(true);
         // generateTreeGridData returns { rows, columns }, not a bare array.
         expect(body.activeInvoiceData.treeGrid.rows.some(r => r.customer_invoice_id === finalizedInvoice.customer_invoice_id)).to.equal(true);
      });
   });

   describe('GET /invoices/getInvoicesPaginated/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/invoices/getInvoicesPaginated/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/invoices/getInvoicesPaginated/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/invoices/getInvoicesPaginated/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('400 for invalid pagination (page=0)', async () => {
         const res = await h.as('admin').get(`/invoices/getInvoicesPaginated/${A}/${U}?page=0`);
         expect(res.status).to.equal(400);
      });
      it('search finds the invoice by a substring of its invoice_number', async () => {
         const needle = finalizedInvoice.invoice_number.slice(-6);
         const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/getInvoicesPaginated/${A}/${U}?search=${encodeURIComponent(needle)}`), 'getInvoicesPaginated (by number)');
         const rows = body.invoicesList.activeInvoiceData.activeInvoices;
         expect(rows.some(r => r.customer_invoice_id === finalizedInvoice.customer_invoice_id)).to.equal(true);
      });
      it("search finds the invoice by custA's display name", async () => {
         const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/getInvoicesPaginated/${A}/${U}?search=${encodeURIComponent(custA.name)}`), 'getInvoicesPaginated (by name)');
         const rows = body.invoicesList.activeInvoiceData.activeInvoices;
         expect(rows).to.have.lengthOf(1);
         expect(rows[0].customer_invoice_id).to.equal(finalizedInvoice.customer_invoice_id);
         expect(body.invoicesList.activeInvoiceData.pagination.totalItems).to.equal(1);
      });
      it('a search with no matches returns an empty page, not an error', async () => {
         const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/getInvoicesPaginated/${A}/${U}?search=${encodeURIComponent(uniqueName('NoSuchInvoice'))}`), 'getInvoicesPaginated (no match)');
         expect(body.invoicesList.activeInvoiceData.activeInvoices).to.deep.equal([]);
      });
   });

   describe('GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID', () => {
      let chainParent;
      let chainSnapshot;
      let chainPayment;

      before(async () => {
         chainParent = await insertInvoiceRow({
            customer_id: custA.customerId,
            customer_info_id: custA.customerInfoId,
            invoice_number: uniqueName('CovAChain'),
            invoice_date: daysAgo(15),
            due_date: daysAgo(-1),
            start_date: daysAgo(45),
            end_date: daysAgo(15),
            total_charges: 100,
            total_amount_due: 100,
            total_payments: -20,
            remaining_balance_on_invoice: 80
         });
         chainSnapshot = await insertInvoiceRow({
            customer_id: custA.customerId,
            customer_info_id: custA.customerInfoId,
            parent_invoice_id: chainParent.customer_invoice_id,
            invoice_number: chainParent.invoice_number,
            invoice_date: daysAgo(15),
            due_date: daysAgo(-1),
            start_date: daysAgo(45),
            end_date: daysAgo(15),
            total_charges: 100,
            total_amount_due: 100,
            total_payments: -20,
            remaining_balance_on_invoice: 80
         });
         const [payment] = await db('customer_payments')
            .insert({
               customer_id: custA.customerId,
               account_id: A,
               customer_invoice_id: chainSnapshot.customer_invoice_id,
               payment_date: daysAgo(14),
               payment_amount: -20,
               form_of_payment: 'Check',
               payment_reference_number: uniqueName('PMT'),
               is_transaction_billable: true,
               created_by_user_id: U
            })
            .returning('*');
         chainPayment = payment;
      });

      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/invoices/getInvoiceDetails/${finalizedInvoice.customer_invoice_id}/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/invoices/getInvoiceDetails/${finalizedInvoice.customer_invoice_id}/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/invoices/getInvoiceDetails/${finalizedInvoice.customer_invoice_id}/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('404 for an unknown invoice id', async () => {
         const res = await h.as('admin').get(`/invoices/getInvoiceDetails/999999999/${A}/${U}`);
         expect(res.status).to.equal(404);
         expect(res.body.message).to.include('not found');
      });
      it("returns the transactions billed on custA's freshly finalized parent", async () => {
         const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/getInvoiceDetails/${finalizedInvoice.customer_invoice_id}/${A}/${U}`), 'getInvoiceDetails (finalized parent)');
         expect(body.invoiceDetails.customer_invoice_id).to.equal(finalizedInvoice.customer_invoice_id);
         expect(body.invoiceTransactionsData.invoiceTransactions.map(t => t.transaction_id)).to.deep.equal([custAUnbilledTxn.transaction_id]);
         expect(money(body.invoiceDetails.remaining_balance_on_invoice)).to.equal(money(finalizedInvoice.remaining_balance_on_invoice));
      });
      it("returns chain-wide payments tagged to a snapshot row, not just the parent", async () => {
         const body = expectEnvelopeOk(await h.as('admin').get(`/invoices/getInvoiceDetails/${chainParent.customer_invoice_id}/${A}/${U}`), 'getInvoiceDetails (chain)');
         expect(body.invoicePaymentsData.invoicePayments.map(p => p.payment_id)).to.deep.equal([chainPayment.payment_id]);
         expect(money(body.invoicePaymentsData.invoicePayments[0].payment_amount)).to.equal(-20);
         expect(body.invoicePaymentsData.grid.rows).to.have.lengthOf(1);
      });
   });

   describe('DELETE /invoices/deleteInvoice/:accountID/:invoiceID', () => {
      let zeroParent;

      before(async () => {
         zeroParent = await insertInvoiceRow({
            customer_id: custA.customerId,
            customer_info_id: custA.customerInfoId,
            invoice_number: uniqueName('CovAZero'),
            invoice_date: daysAgo(10),
            due_date: daysAgo(-6),
            start_date: daysAgo(40),
            end_date: daysAgo(10),
            is_invoice_paid_in_full: true,
            fully_paid_date: daysAgo(10)
         });
      });

      it('401 without a token', async () => {
         const res = await h.anonymous.delete(`/invoices/deleteInvoice/${A}/${finalizedInvoice.customer_invoice_id}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').delete(`/invoices/deleteInvoice/${A}/${finalizedInvoice.customer_invoice_id}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').delete(`/invoices/deleteInvoice/${A}/${finalizedInvoice.customer_invoice_id}`);
         expect(res.status).to.equal(403);
      });
      it('not-found: refuses a bogus invoice id', async () => {
         const body = expectEnvelopeRefused(await h.as('admin').delete(`/invoices/deleteInvoice/${A}/999999999`), /not found/i, 'deleteInvoice (bogus id)');
         expect(body.message).to.include('not found');
      });
      it('refuses a parent with linked transactions ("linked rows")', async () => {
         // Distinct from finalize-engine's 2a ('rolled' — a parent whose
         // beginning_balance absorbed a prior chain) and 2b ('snapshot' — a
         // parent_invoice_id row): this parent is neither, it just has a
         // transaction billed directly to it, hitting the EARLIER
         // transactions/payments/writeoffs guard (invoice-router.js:85-91).
         const body = expectEnvelopeRefused(await h.as('admin').delete(`/invoices/deleteInvoice/${A}/${finalizedInvoice.customer_invoice_id}`), /Cannot delete invoice with/, 'deleteInvoice (linked transaction)');
         expect(body.message).to.include('transactions, retainers, payments, or writeoffs');
         const still = await db('customer_invoices').where({ customer_invoice_id: finalizedInvoice.customer_invoice_id }).first();
         expect(still, 'invoice not deleted').to.exist;
      });
      it('cleanly deletes a zero-history parent with no linked rows', async () => {
         const body = expectEnvelopeOk(await h.as('admin').delete(`/invoices/deleteInvoice/${A}/${zeroParent.customer_invoice_id}`), 'deleteInvoice (zero-history parent)');
         expect(body.message).to.equal('Successfully deleted invoice.');
         const gone = await db('customer_invoices').where({ customer_invoice_id: zeroParent.customer_invoice_id }).first();
         expect(gone).to.equal(undefined);
      });
      // NOTE: the 'rolled' (absorbing parent) and payment-snapshot refusals are
      // already covered by finalize-engine.integration.spec.js 2a / 2b / 2b-ii,
      // as is a finalize-produced zero-history parent deleting cleanly (2c) —
      // not repeated here.
   });

   describe('GET /invoices/downloadFile/:accountID/:userID', () => {
      let uploadedKey;
      const uploadedBytes = Buffer.from('%PDF-1.4 coverage spec fixture bytes');

      before(async () => {
         uploadedKey = `coverage-spec/${uniqueName('download')}.pdf`;
         await putObject(uploadedKey, uploadedBytes, 'application/pdf');
         s3Keys.push(uploadedKey);
      });

      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(uploadedKey)}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(uploadedKey)}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(uploadedKey)}`);
         expect(res.status).to.equal(403);
      });
      it('400 for a missing fileLocation query param', async () => {
         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.include('Invalid or no file path');
      });
      it('400 for a bogus path that does not exist in S3', async () => {
         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent('coverage-spec/does-not-exist-' + uniqueName('x') + '.pdf')}`);
         expect(res.status).to.equal(400);
         expect(res.body.message).to.include('does not exist');
      });
      it('200 streams back the uploaded bytes with the right filename', async () => {
         const res = await h.as('admin').get(`/invoices/downloadFile/${A}/${U}?fileLocation=${encodeURIComponent(uploadedKey)}`);
         expect(res.status).to.equal(200);
         expect(Buffer.isBuffer(res.body), 'body is a Buffer').to.equal(true);
         expect(Buffer.compare(res.body, uploadedBytes)).to.equal(0);
         expect(res.headers['content-disposition']).to.include(uploadedKey.split('/').pop());
      });
   });

   // ════════════════════════════════════════════════════════════════════════
   // src/endpoints/accountAudit/**  (router-level requireAuth + requireSuperAdmin)
   // ════════════════════════════════════════════════════════════════════════

   describe('POST /accountAudit/run/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.post(`/accountAudit/run/${A}/${U}`).send({ customer_ids: [custA.customerId] });
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').post(`/accountAudit/run/${A}/${U}`).send({ customer_ids: [custA.customerId] });
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').post(`/accountAudit/run/${A}/${REAL_SUPERADMIN_USER_ID}`).send({ customer_ids: [custA.customerId] });
         expect(res.status).to.equal(403);
      });
      it('400 validation failure: no customers selected', async () => {
         const res = await asTemp().post(`/accountAudit/run/${A}/${tempSuperAdmin.user_id}`).send({ customer_ids: [] });
         expect(res.status).to.equal(400);
         expect(res.body.message).to.include('No customers selected');
      });
      it('runs a background job for custA that completes with an audit_balance matching the engine total', async () => {
         const engineTotal = await engineTotalFor(custA.customerId);
         const startRes = await asTemp().post(`/accountAudit/run/${A}/${tempSuperAdmin.user_id}`).send({ customer_ids: [custA.customerId], notes: 'coverage spec run' });
         expect(startRes.status).to.equal(200);
         expect(startRes.body.total).to.equal(1);
         auditJobId = startRes.body.job_id;
         expect(auditJobId).to.be.a('string');

         const job = await waitForJob(auditJobId);
         expect(job.processing_status).to.equal('complete');
         expect(job.done).to.equal(1);
         expect(job.results).to.have.lengthOf(1);
         expect(job.results[0].status).to.equal('completed');
         expect(job.results[0].customer_id).to.equal(custA.customerId);
         auditId = job.results[0].audit_id;
         expect(money(job.results[0].audit_balance), 'audit_balance must match the engine total').to.equal(engineTotal);
         expect(money(job.results[0].app_invoice_total)).to.equal(engineTotal);
      });
   });

   describe('GET /accountAudit/customers/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/accountAudit/customers/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/accountAudit/customers/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/customers/${A}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('search by id lists custA with the audit fields just computed', async () => {
         const res = await asTemp().get(`/accountAudit/customers/${A}/${tempSuperAdmin.user_id}?search=${custA.customerId}`);
         expect(res.status).to.equal(200);
         const row = res.body.customers.find(c => c.customer_id === custA.customerId);
         expect(row, 'custA listed').to.exist;
         expect(row.last_audit_id).to.equal(auditId);
         expect(row.last_audit_balance).to.be.a('number');
      });
      it('filter=billing_ready restricts to customers with an open parent invoice', async () => {
         const res = await asTemp().get(`/accountAudit/customers/${A}/${tempSuperAdmin.user_id}?filter=billing_ready&limit=200`);
         expect(res.status).to.equal(200);
         expect(res.body.customers.some(c => c.customer_id === custA.customerId), 'custA has an open balance').to.equal(true);
      });
      it('READ-ONLY: lists real customers for account 1', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/customers/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}?search=${realAudit.customer_id}`);
         expect(res.status).to.equal(200);
         expect(res.body.customers.some(c => c.customer_id === realAudit.customer_id)).to.equal(true);
      });
   });

   describe('GET /accountAudit/customer/:customerID/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/accountAudit/customer/${custA.customerId}/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/accountAudit/customer/${custA.customerId}/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/customer/${custA.customerId}/${A}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it("returns custA's audit history including the run we just created", async () => {
         const res = await asTemp().get(`/accountAudit/customer/${custA.customerId}/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(200);
         expect(res.body.audits.map(a => a.audit_id)).to.include(auditId);
      });
      it('returns an empty list for a customer with no audits', async () => {
         const res = await asTemp().get(`/accountAudit/customer/${custB.customerId}/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(200);
         expect(res.body.audits).to.deep.equal([]);
      });
      it("READ-ONLY: returns a real account-1 customer's audit history", async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/customer/${realAudit.customer_id}/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body.audits.map(a => a.audit_id)).to.include(realAudit.audit_id);
      });
   });

   describe('GET /accountAudit/audit/:auditID/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/accountAudit/audit/1/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/accountAudit/audit/1/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/audit/1/${A}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('404 for an unknown audit id', async () => {
         const res = await asTemp().get(`/accountAudit/audit/999999999/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(404);
      });
      it('returns the full audit detail and its audit_balance equals the engine total (fetchInitialQueryItems + calculateInvoices)', async () => {
         const engineTotal = await engineTotalFor(custA.customerId);
         const res = await asTemp().get(`/accountAudit/audit/${auditId}/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(200);
         expect(res.body.audit.audit_id).to.equal(auditId);
         expect(res.body.audit.customer_id).to.equal(custA.customerId);
         expect(money(res.body.audit.audit_balance)).to.equal(engineTotal);
         expect(res.body.audit.balance_difference).to.equal(0);
         expect(res.body.audit.discrepancies).to.be.an('array');
         expect(res.body.audit.ledger).to.be.an('array');
      });
      it('READ-ONLY: returns a real account-1 audit detail', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/audit/${realAudit.audit_id}/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(200);
         expect(res.body.audit.audit_id).to.equal(realAudit.audit_id);
         expect(res.body.audit.customer_id).to.equal(realAudit.customer_id);
         expect(res.body.audit.audit_balance).to.be.a('number');
      });
   });

   describe('GET /accountAudit/audit/:auditID/pdf/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/accountAudit/audit/${auditId}/pdf/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/accountAudit/audit/${auditId}/pdf/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/audit/${auditId}/pdf/${A}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('404 for an unknown audit id', async () => {
         const res = await asTemp().get(`/accountAudit/audit/999999999/pdf/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(404);
      });
      it('returns application/pdf bytes for the audit', async () => {
         const res = await asTemp().get(`/accountAudit/audit/${auditId}/pdf/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('application/pdf');
         expect(Buffer.isBuffer(res.body), 'body is a Buffer').to.equal(true);
         expect(res.body.length).to.be.greaterThan(0);
         expect(res.body.slice(0, 4).toString('latin1')).to.equal('%PDF');
      });
      it('READ-ONLY: returns application/pdf bytes for a real account-1 audit', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/audit/${realAudit.audit_id}/pdf/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('application/pdf');
         expect(Buffer.isBuffer(res.body), 'body is a Buffer').to.equal(true);
         expect(res.body.slice(0, 4).toString('latin1')).to.equal('%PDF');
      });
   });

   describe('GET /accountAudit/job/:jobId/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/accountAudit/job/${auditJobId}/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/accountAudit/job/${auditJobId}/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/job/${auditJobId}/${A}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('404 for an unknown job id', async () => {
         const res = await asTemp().get(`/accountAudit/job/not-a-real-job-id/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(404);
      });
      it("returns the completed job's results", async () => {
         const res = await asTemp().get(`/accountAudit/job/${auditJobId}/${A}/${tempSuperAdmin.user_id}`);
         expect(res.status).to.equal(200);
         expect(res.body.job_id).to.equal(auditJobId);
         expect(res.body.processing_status).to.equal('complete');
         expect(res.body.total).to.equal(1);
         expect(res.body.done).to.equal(1);
         expect(res.body.results[0].audit_id).to.equal(auditId);
      });
      // DEFECT (account_audit_router.js: GET /job/:jobId/:accountID/:userID):
      // the in-memory job store (`auditJobs`, a plain Map keyed only by jobId)
      // is never partitioned by account_id — the handler reads
      // `req.params.accountID` only through the shared `enforceAccountId`
      // gate (which checks the CALLER's own token account, not which account
      // the job belongs to) and then does `auditJobs.get(req.params.jobId)`
      // with no ownership check at all. A super admin of ANY account who
      // learns another account's jobId (logs, a shared ticket, a referrer
      // header, timing-based guessing of the `audit-<ms>-<6 base36 chars>`
      // id) can read that job's full results — customer_id, audit_balance,
      // discrepancy counts — for an account they have no access to. Evidence
      // below: the persistent account-1 super admin successfully reads the
      // account-9001 job created by `tempSuperAdmin` earlier in this file.
      // Fix: store `account_id` on the job at creation and check it before
      // returning results (404 on mismatch, same as an unknown jobId).
      // Verified 2026-09-23: unskipping this locally against the sandbox
      // returns HTTP 200 with the full account-9001 job payload — e.g.
      // {"job_id":"audit-...","processing_status":"complete","results":
      // [{"customer_id":901088,"audit_id":"1185","audit_balance":250,...}]}
      // — read via the persistent account-1 super admin token.
      it('FIXED (was DEFECT): job results are scoped to the account that created them', async () => {
         const res = await h.as('superAdmin').get(`/accountAudit/job/${auditJobId}/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status, 'a job created for account 9001 must not be readable via account 1').to.be.oneOf([403, 404]);
      });
   });

   // ════════════════════════════════════════════════════════════════════════
   // src/endpoints/accountsReceivable/**
   // ════════════════════════════════════════════════════════════════════════

   describe('GET /accountsReceivable/aging/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/accountsReceivable/aging/${A}/${U}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/accountsReceivable/aging/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/accountsReceivable/aging/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('400 for invalid pagination (page=0)', async () => {
         const res = await h.as('admin').get(`/accountsReceivable/aging/${A}/${U}?page=0`);
         expect(res.status).to.equal(400);
      });
      it("returns custB's aging row: bucket, statement_date and is_customer_active", async () => {
         const body = expectEnvelopeOk(await h.as('admin').get(`/accountsReceivable/aging/${A}/${U}?search=${custB.customerId}`), 'AR aging (custB)');
         const rows = body.arAging.customers;
         expect(rows).to.have.lengthOf(1);
         const [row] = rows;
         expect(row.customer_id).to.equal(custB.customerId);
         expect(money(row.total_outstanding)).to.equal(200);
         expect(money(row.bucket_0_30)).to.equal(200);
         expect(ymd(row.statement_date)).to.equal(daysAgo(20));
         expect(row.is_customer_active).to.equal(true);
         expect(ymd(row.oldest_open_charge_date)).to.equal(daysAgo(20));
      });
      it('search narrows the list to the matching customer only', async () => {
         const body = expectEnvelopeOk(await h.as('admin').get(`/accountsReceivable/aging/${A}/${U}?search=${encodeURIComponent(custB.name)}`), 'AR aging (search by name)');
         expect(body.arAging.customers.map(r => r.customer_id)).to.deep.equal([custB.customerId]);
      });
   });

   describe('GET /accountsReceivable/aging/:accountID/:userID/export', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/accountsReceivable/aging/${A}/${U}/export`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/accountsReceivable/aging/${A}/${U}/export`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/accountsReceivable/aging/${A}/${U}/export`);
         expect(res.status).to.equal(403);
      });
      it("returns text/csv with a header row and quote-guards custB's name (starts with '=')", async () => {
         const res = await h.as('admin').get(`/accountsReceivable/aging/${A}/${U}/export?search=${custB.customerId}`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('text/csv');
         expect(res.headers['content-disposition']).to.include('accounts_receivable_');
         const lines = res.text.split('\n');
         expect(lines[0]).to.equal('Customer ID,Business Name,Customer Name,Display Name,0-30 Days,31-60 Days,61-90 Days,>90 Days,Total Owed,Most Recent Invoice Date,Days Since Last Invoice,Last Payment Date,Last Payment Amount,Work Since Last Payment,Oldest Open Charge Date,Days Since Oldest Open Charge,Active Customer');
         const dataLine = lines.find(l => l.startsWith(`${custB.customerId},`));
         expect(dataLine, 'custB row present').to.exist;
         expect(dataLine).to.include(`'${custB.name}`);
         expect(dataLine).to.not.include(`,${custB.name},`); // never unescaped/unprefixed
      });
   });

   // ════════════════════════════════════════════════════════════════════════
   // src/endpoints/analytics/**  (app.js: requireAuth + requireSuperAdmin)
   // ════════════════════════════════════════════════════════════════════════

   describe('GET /analytics/clientRates/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/clientRates/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/clientRates/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/clientRates/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('returns numeric per-year fields for account 1 (read-only)', async () => {
         const body = expectEnvelopeOk(await h.as('superAdmin').get(`/analytics/clientRates/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}?yearsBack=3`), 'clientRates (account 1)');
         const { clientRates } = body;
         expect(clientRates.years).to.be.an('array').that.is.not.empty;
         expect(clientRates.clients).to.be.an('array');
         expect(clientRates.firm).to.have.property('suggestion_formula');
         const withYears = clientRates.clients.find(c => Object.keys(c.years || {}).length);
         expect(withYears, 'at least one client has year data').to.exist;
         const [year] = Object.keys(withYears.years);
         expect(withYears.years[year].hours).to.be.a('number');
         expect(withYears.years[year].effective_rate === null || typeof withYears.years[year].effective_rate === 'number').to.equal(true);
      });
   });

   describe('GET /analytics/clientRates/:accountID/:userID/export', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/clientRates/${A}/${U}/export`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/clientRates/${A}/${U}/export`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/analytics/clientRates/${A}/${U}/export`);
         expect(res.status).to.equal(403);
      });
      it("returns text/csv with a header row and quote-guards custB's name", async () => {
         const res = await asTemp().get(`/analytics/clientRates/${A}/${tempSuperAdmin.user_id}/export?yearsBack=1`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('text/csv');
         const lines = res.text.split('\n');
         expect(lines[0]).to.include('Customer');
         expect(lines[0]).to.include('Suggested Rate');
         const custBLine = lines.find(l => l.includes(custB.name.slice(1))); // sans leading '='
         expect(custBLine, 'custB row present').to.exist;
         expect(custBLine.startsWith(`'${custB.name}`), `expected a quote-guarded cell, got: ${custBLine}`).to.equal(true);
      });
   });

   describe('GET /analytics/timeAllocation/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/timeAllocation/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/timeAllocation/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/timeAllocation/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('returns numeric summary fields for account 1 (read-only)', async () => {
         const body = expectEnvelopeOk(await h.as('superAdmin').get(`/analytics/timeAllocation/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`), 'timeAllocation (account 1)');
         const { timeAllocation } = body;
         expect(timeAllocation.summary.total_hours).to.be.a('number');
         expect(timeAllocation.summary.billable_hours).to.be.a('number');
         expect(timeAllocation.summary.billed_amount).to.be.a('number');
         expect(timeAllocation.byWorkDescription).to.be.an('array');
         // Only months with at least one transaction are present (no
         // generate_series padding in analytics-service.js getTimeAllocation),
         // so the length varies by data — just check the shape.
         expect(timeAllocation.monthly).to.be.an('array').that.is.not.empty;
         timeAllocation.monthly.forEach(m => {
            expect(m.month).to.be.a('number').within(1, 12);
            expect(m.billable_hours).to.be.a('number');
         });
         expect(timeAllocation.availableYears).to.be.an('array');
      });
   });

   describe('GET /analytics/timeAllocation/:accountID/:userID/export', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/timeAllocation/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}/export`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/timeAllocation/${A}/${U}/export`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/timeAllocation/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}/export`);
         expect(res.status).to.equal(403);
      });
      it('returns text/csv with a header row for account 1', async () => {
         const res = await h.as('superAdmin').get(`/analytics/timeAllocation/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}/export`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('text/csv');
         expect(res.text.split('\n')[0]).to.include('Time Allocation');
      });
   });

   describe('POST /analytics/rateAgreement/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.post(`/analytics/rateAgreement/${A}/${U}`).send({});
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').post(`/analytics/rateAgreement/${A}/${U}`).send({});
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').post(`/analytics/rateAgreement/${A}/${U}`).send({});
         expect(res.status).to.equal(403);
      });
      it('validation failure: missing customer/year/rate', async () => {
         const res = await asTemp().post(`/analytics/rateAgreement/${A}/${tempSuperAdmin.user_id}`).send({ customerId: custB.customerId });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(500);
         expect(res.body.message).to.include('agreed rate');
      });
      it("creates the rate agreement row for custB", async () => {
         const year = dayjs().year();
         const res = await asTemp().post(`/analytics/rateAgreement/${A}/${tempSuperAdmin.user_id}`).send({ customerId: custB.customerId, year, agreedRate: 185.5, notes: 'coverage spec' });
         expect(res.status).to.equal(200);
         expect(res.body.status).to.equal(200);
         expect(money(res.body.agreement.agreed_rate)).to.equal(185.5);

         const row = await db('customer_rate_agreements').where({ account_id: A, customer_id: custB.customerId, agreement_year: year }).first();
         expect(row, 'row persisted').to.exist;
         expect(money(row.agreed_rate)).to.equal(185.5);
         expect(row.notes).to.equal('coverage spec');
      });
   });

   describe('GET /analytics/wipAging/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/wipAging/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/wipAging/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/wipAging/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('returns numeric aging fields for account 1 (read-only)', async () => {
         const body = expectEnvelopeOk(await h.as('superAdmin').get(`/analytics/wipAging/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`), 'wipAging (account 1)');
         expect(body.wipAging).to.be.an('array').that.is.not.empty;
         const [row] = body.wipAging;
         expect(row.unbilled_amount).to.be.a('number');
         expect(row.unbilled_hours).to.be.a('number');
         expect(row.bucket_0_30 + row.bucket_31_60 + row.bucket_61_90 + row.bucket_over_90).to.be.a('number');
      });
   });

   describe('GET /analytics/jobBudgets/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/jobBudgets/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/jobBudgets/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/jobBudgets/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('returns numeric budget fields for account 1 (read-only)', async () => {
         const body = expectEnvelopeOk(await h.as('superAdmin').get(`/analytics/jobBudgets/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`), 'jobBudgets (account 1)');
         // Account 1's real jobs currently have no agreed_job_amount set (the
         // query itself filters to agreed_job_amount > 0), so an empty array is
         // a legitimate, correct response — assert shape, not occupancy.
         expect(body.jobBudgets).to.be.an('array');
         body.jobBudgets.forEach(row => {
            expect(row.budget).to.be.a('number').greaterThan(0);
            expect(row.actual).to.be.a('number');
            expect(row.remaining).to.be.a('number');
         });
      });
   });

   describe('GET /analytics/yearEndPacket/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/yearEndPacket/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/yearEndPacket/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/yearEndPacket/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('returns a zip for account 1 (read-only)', async () => {
         const res = await h.as('superAdmin').get(`/analytics/yearEndPacket/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}?year=${dayjs().year() - 1}`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('application/zip');
         expect(res.headers['content-disposition']).to.include('year_end_packet_');
      });
   });

   describe('GET /analytics/taxSeasonCapacity/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/taxSeasonCapacity/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/taxSeasonCapacity/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/taxSeasonCapacity/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('returns numeric capacity fields for account 1 (read-only)', async () => {
         const body = expectEnvelopeOk(await h.as('superAdmin').get(`/analytics/taxSeasonCapacity/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`), 'taxSeasonCapacity (account 1)');
         expect(body.taxSeasonCapacity.current).to.be.an('array');
         if (body.taxSeasonCapacity.current.length) {
            expect(body.taxSeasonCapacity.current[0].hours).to.be.a('number');
         }
      });
   });

   describe('GET /analytics/exclusions/:accountID/:userID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/analytics/exclusions/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(401);
      });
      it('403 for a non-super-admin (admin) token', async () => {
         const res = await h.as('admin').get(`/analytics/exclusions/${A}/${U}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await asTemp().get(`/analytics/exclusions/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`);
         expect(res.status).to.equal(403);
      });
      it('returns the customer list and default-excluded ids for account 1 (read-only)', async () => {
         const body = expectEnvelopeOk(await h.as('superAdmin').get(`/analytics/exclusions/${REAL_ACCOUNT_ID}/${REAL_SUPERADMIN_USER_ID}`), 'exclusions (account 1)');
         expect(body.exclusions.customers).to.be.an('array').that.is.not.empty;
         expect(body.exclusions.defaultExcludedIds).to.be.an('array');
      });
   });

   // ════════════════════════════════════════════════════════════════════════
   // GET /customer/statement/:accountID/:userID/:customerID  (route-level
   // requireManagerOrAdmin — out of the analytics/invoice/audit/AR area, but
   // explicitly in scope per the task).
   // ════════════════════════════════════════════════════════════════════════

   describe('GET /customer/statement/:accountID/:userID/:customerID', () => {
      it('401 without a token', async () => {
         const res = await h.anonymous.get(`/customer/statement/${A}/${U}/${custA.customerId}`);
         expect(res.status).to.equal(401);
      });
      it('403 for an employee (manager+ required)', async () => {
         const res = await h.as('employee').get(`/customer/statement/${A}/${U}/${custA.customerId}`);
         expect(res.status).to.equal(403);
      });
      it('403 cross-tenant (right role, wrong account)', async () => {
         const res = await h.as('superAdmin').get(`/customer/statement/${A}/${U}/${custA.customerId}`);
         expect(res.status).to.equal(403);
      });
      it('unknown customer id returns a clean error envelope, not a crash', async () => {
         const res = await h.as('admin').get(`/customer/statement/${A}/${U}/999999999`);
         expect(res.status).to.equal(500);
         expect(res.body.message).to.include('No matching customer record found');
      });
      it("returns application/pdf bytes for custA's statement", async () => {
         const res = await h.as('admin').get(`/customer/statement/${A}/${U}/${custA.customerId}`);
         expect(res.status).to.equal(200);
         expect(res.headers['content-type']).to.include('application/pdf');
         expect(Buffer.isBuffer(res.body), 'body is a Buffer').to.equal(true);
         expect(res.body.slice(0, 4).toString('latin1')).to.equal('%PDF');
      });
   });
});
