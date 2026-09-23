/**
 * Analytics service shape contract. Runs against the dev-DB fixture account —
 * asserts structure and math invariants, not specific business values.
 * Skipped when the dev DB isn't reachable.
 *
 * Also pins the review fixes of 2026-09:
 *   - transaction_type is compared case-insensitively ('time' rows count);
 *   - WIP aging keeps future-dated rows out of the buckets (future_dated_count);
 *   - job budgets count billable work only;
 *   - the AR aging used by the year-end packet aggregates every newest-date
 *     parent's LATEST snapshot, includes inactive debtors, and exposes the
 *     FIFO oldest open charge — agreeing with the engine and the audit.
 */
const dayjs = require('dayjs');
const { requireDb, closeDb, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const analyticsService = require('../../src/endpoints/analytics/analytics-service');
const accountsReceivableService = require('../../src/endpoints/accountsReceivable/accounts-receivable-service');
const accountAuditService = require('../../src/endpoints/accountAudit/account-audit-service');
const { auditCustomerLedger } = require('../../src/endpoints/accountAudit/account-audit-logic');
const { fetchInitialQueryItems } = require('../../src/endpoints/invoice/createInvoice/createInvoiceQueries');
const { calculateInvoices } = require('../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices');

const ACME = 900101; // analytics fixture customer (job 9001001)
const GLOBEX = 900102; // AR fixture customer (job 9001002, customer_info 343)
const ymd = d => dayjs(d).format('YYYY-MM-DD');

describe('integration: analytics service', function () {
   this.timeout(30_000);
   let db;
   let originalAgreedAmount;
   let globexWasActive;
   const insertedInvoiceIds = [];
   // Scoped cleanup: track exactly the transaction rows THIS spec inserts so
   // `after` deletes only those, instead of the old cleanupTestData(db) call,
   // which wiped every customer_transactions/timesheet_entries row for the
   // whole account-9001 fixture — including rows other suites (or a concurrent
   // run) created. See test/integration/_setup.js cleanupTestData for what
   // that helper does; it is still fine for suites that own the whole account
   // sandbox for their run (e.g. pii-leak.integration.spec.js), just not here.
   const insertedTransactionIds = [];

   before(async function () {
      db = await requireDb.call(this);

      // Two billable time entries + one fixed charge + one non-billable admin
      // entry for the fixture customer in a fixed year, plus one billable entry
      // logged with the lowercase 'time' type the auto-ingest path used to write.
      const base = {
         account_id: TEST_ACCOUNT_ID,
         customer_id: ACME,
         customer_job_id: 9001001,
         logged_for_user_id: 90011,
         general_work_description_id: 90031,
         created_by_user_id: TEST_ADMIN_USER_ID,
         is_excess_to_subscription: false
      };
      const insertedBase = await db('customer_transactions')
         .insert([
            { ...base, transaction_date: '2025-03-01', transaction_type: 'Time', quantity: 2, unit_cost: 100, total_transaction: 200, is_transaction_billable: true },
            { ...base, transaction_date: '2025-04-01', transaction_type: 'Time', quantity: 1, unit_cost: 100, total_transaction: 100, is_transaction_billable: true },
            { ...base, transaction_date: '2025-05-01', transaction_type: 'Charge', quantity: 1, unit_cost: 50, total_transaction: 50, is_transaction_billable: true },
            { ...base, transaction_date: '2025-06-01', transaction_type: 'Time', quantity: 1.5, unit_cost: 100, total_transaction: 150, is_transaction_billable: false },
            { ...base, transaction_date: '2025-04-10', transaction_type: 'time', quantity: 1, unit_cost: 100, total_transaction: 100, is_transaction_billable: true },
            // Typo'd future date — unbilled, billable.
            { ...base, transaction_date: ymd(dayjs().add(400, 'day')), transaction_type: 'Time', quantity: 3, unit_cost: 100, total_transaction: 300, is_transaction_billable: true }
         ])
         .returning('transaction_id');
      insertedTransactionIds.push(...insertedBase.map(r => r.transaction_id));

      const job = await db('customer_jobs').where({ customer_job_id: 9001001 }).first('agreed_job_amount');
      originalAgreedAmount = job ? job.agreed_job_amount : null;
      const customer = await db('customers').where({ customer_id: GLOBEX }).first('is_customer_active');
      globexWasActive = customer ? customer.is_customer_active : true;
   });

   after(async () => {
      if (db) {
         if (insertedTransactionIds.length) {
            await db('customer_transactions').whereIn('transaction_id', insertedTransactionIds).del();
         }
         if (insertedInvoiceIds.length) {
            await db('customer_invoices').whereIn('customer_invoice_id', insertedInvoiceIds).whereNotNull('parent_invoice_id').del();
            await db('customer_invoices').whereIn('customer_invoice_id', insertedInvoiceIds).del();
         }
         await db('customer_jobs').where({ customer_job_id: 9001001 }).update({ agreed_job_amount: originalAgreedAmount });
         await db('customers').where({ customer_id: GLOBEX }).update({ is_customer_active: globexWasActive });
      }
      await closeDb();
   });

   it('getClientRates: effective rate = time billings ÷ time hours; charges excluded; lowercase "time" counts', async () => {
      const { clients, years, firm } = await analyticsService.getClientRates(db, TEST_ACCOUNT_ID, { yearsBack: 3 });
      expect(years).to.be.an('array').that.includes(2025);
      const acme = clients.find(c => c.customer_id === ACME);
      expect(acme, 'fixture customer present').to.exist;
      const y = acme.years[2025];
      expect(y.hours).to.equal(4); // billable Time + time
      expect(y.time_billed).to.equal(400);
      expect(y.charges_billed).to.equal(50);
      expect(y.total_billed).to.equal(450);
      expect(y.time_billed + y.charges_billed).to.equal(y.total_billed);
      expect(y.effective_rate).to.equal(100);
      expect(firm).to.have.property('suggestion_formula');
   });

   it('getTimeAllocation: billable/non-billable hours split and tracker section', async () => {
      const ta = await analyticsService.getTimeAllocation(db, TEST_ACCOUNT_ID, { year: 2025 });
      expect(ta.summary.total_hours).to.equal(5.5);
      expect(ta.summary.billable_hours).to.equal(4);
      expect(ta.summary.nonbillable_hours).to.equal(1.5);
      expect(ta.summary.billed_amount).to.equal(450);
      expect(ta).to.not.have.property('byEmployee'); // removed per request
      expect(ta.byWorkDescription[0].hours).to.equal(5.5);
      const march = ta.monthly.find(m => m.month === 3);
      expect(march.billable_hours).to.equal(2);
      const april = ta.monthly.find(m => m.month === 4);
      expect(april.billable_hours, 'Time 04-01 + lowercase time 04-10').to.equal(2);
      expect(ta).to.have.property('trackerByCategory').that.is.an('array');
      expect(ta.availableYears).to.be.an('array');
   });

   it('getTimeAllocation: excludeIds removes a customer from the totals', async () => {
      const full = await analyticsService.getTimeAllocation(db, TEST_ACCOUNT_ID, { year: 2025 });
      const excluded = await analyticsService.getTimeAllocation(db, TEST_ACCOUNT_ID, { year: 2025, excludeIds: [ACME] });
      // 900101 (Acme) is the only customer with 2025 work in the fixture, so
      // excluding it drops the transaction-based totals to zero (tracker is separate).
      expect(full.summary.total_hours).to.equal(5.5);
      expect(excluded.summary.total_hours).to.equal(0);
      expect(excluded.byCustomer).to.have.lengthOf(0);
   });

   it('getTaxSeasonCapacity: lowercase "time" hours count', async () => {
      const { current } = await analyticsService.getTaxSeasonCapacity(db, TEST_ACCOUNT_ID, { year: 2025 });
      const hours = current.reduce((a, r) => a + r.hours, 0);
      // Jan 1 – Apr 15 2025: 'Time' 03-01 (2h) + 'Time' 04-01 (1h) + 'time' 04-10 (1h).
      expect(hours).to.equal(4);
   });

   it('getWipAging: future-dated rows stay out of the buckets and are reported separately', async () => {
      const rows = await analyticsService.getWipAging(db, TEST_ACCOUNT_ID);
      const acme = rows.find(r => r.customer_id === ACME);
      expect(acme, 'Acme has unbilled work').to.exist;
      expect(acme.unbilled_amount).to.equal(450); // 200 + 100 + 50 + 100; the $300 future row excluded
      expect(acme.unbilled_hours).to.equal(4); // 2 + 1 + 1 (lowercase 'time'); non-billable + future excluded
      expect(acme.entries).to.equal(4);
      expect(acme.future_dated_count).to.equal(1);
      expect(acme.future_dated_amount).to.equal(300);
      expect(acme.bucket_0_30 + acme.bucket_31_60 + acme.bucket_61_90 + acme.bucket_over_90).to.equal(acme.unbilled_amount);
      expect(dayjs(acme.oldest_date).format('YYYY-MM-DD')).to.equal('2025-03-01');
   });

   it('getJobBudgets: actual counts billable work only', async () => {
      await db('customer_jobs').where({ customer_job_id: 9001001 }).update({ agreed_job_amount: 1000 });
      const rows = await analyticsService.getJobBudgets(db, TEST_ACCOUNT_ID);
      const job = rows.find(r => r.customer_job_id === 9001001);
      expect(job, 'budgeted fixture job').to.exist;
      // Billable: 200 + 100 + 50 + 100 + 300 (future-dated, still billable work) = 750.
      // The $150 non-billable entry must not consume the client's budget.
      expect(job.actual).to.equal(750);
      expect(job.budget).to.equal(1000);
      expect(job.remaining).to.equal(250);
      expect(job.consumed_pct).to.equal(75);
   });

   it('getExcludableCustomers: returns the customer list and default-excluded ids', async () => {
      const { customers, defaultExcludedIds } = await analyticsService.getExcludableCustomers(db, TEST_ACCOUNT_ID);
      expect(customers).to.be.an('array');
      expect(defaultExcludedIds).to.be.an('array'); // none in the fixture account, but the shape is the contract
   });

   describe('AR aging (year-end packet sheet)', () => {
      const statementDate = dayjs().subtract(45, 'day');
      let parentA;

      before(async () => {
         await db('customers').where({ customer_id: GLOBEX }).update({ is_customer_active: false });
         const invoice = fields => ({
            account_id: TEST_ACCOUNT_ID,
            customer_id: GLOBEX,
            customer_info_id: 343,
            due_date: ymd(statementDate.add(15, 'day')),
            beginning_balance: 0,
            total_payments: 0,
            total_charges: 0,
            total_write_offs: 0,
            total_retainers: 0,
            is_invoice_paid_in_full: false,
            created_by_user_id: TEST_ADMIN_USER_ID,
            ...fields
         });
         // Older statement never zeroed (legacy stale remainder) — NOT owed on top.
         const [old] = await db('customer_invoices')
            .insert(invoice({ invoice_number: 'ARTEST-2000-00001', invoice_date: ymd(statementDate.subtract(30, 'day')), total_amount_due: 999, remaining_balance_on_invoice: 999 }))
            .returning('*');
         // Same-day duplicate statements. A's parent mirror is stale (300) — its
         // latest snapshot says 120.
         [parentA] = await db('customer_invoices')
            .insert(invoice({ invoice_number: 'ARTEST-2000-00002', invoice_date: ymd(statementDate), total_amount_due: 300, remaining_balance_on_invoice: 300 }))
            .returning('*');
         const [snapA] = await db('customer_invoices')
            .insert(invoice({ parent_invoice_id: parentA.customer_invoice_id, invoice_number: 'ARTEST-2000-00002', invoice_date: ymd(statementDate), total_amount_due: 300, remaining_balance_on_invoice: 120 }))
            .returning('*');
         const [parentB] = await db('customer_invoices')
            .insert(invoice({ invoice_number: 'ARTEST-2000-00003', invoice_date: ymd(statementDate), total_amount_due: 200, remaining_balance_on_invoice: 200 }))
            .returning('*');
         insertedInvoiceIds.push(old.customer_invoice_id, parentA.customer_invoice_id, snapA.customer_invoice_id, parentB.customer_invoice_id);

         const billed = {
            account_id: TEST_ACCOUNT_ID,
            customer_id: GLOBEX,
            customer_job_id: 9001002,
            logged_for_user_id: 90011,
            general_work_description_id: 90031,
            created_by_user_id: TEST_ADMIN_USER_ID,
            is_excess_to_subscription: false,
            transaction_type: 'Charge',
            quantity: 1
         };
         const insertedBilled = await db('customer_transactions')
            .insert([
               { ...billed, transaction_date: ymd(statementDate.subtract(60, 'day')), unit_cost: 250, total_transaction: 250, is_transaction_billable: true, customer_invoice_id: old.customer_invoice_id },
               { ...billed, transaction_date: ymd(statementDate.subtract(10, 'day')), unit_cost: 100, total_transaction: 100, is_transaction_billable: true, customer_invoice_id: parentA.customer_invoice_id },
               { ...billed, transaction_date: ymd(statementDate.subtract(5, 'day')), unit_cost: 500, total_transaction: 500, is_transaction_billable: false, customer_invoice_id: parentA.customer_invoice_id }
            ])
            .returning('transaction_id');
         insertedTransactionIds.push(...insertedBilled.map(r => r.transaction_id));
      });

      it('sums the latest snapshot of every newest-date parent, includes the inactive debtor, and ages by statement date', async () => {
         const { rows } = await accountsReceivableService.getAging(db, TEST_ACCOUNT_ID, { limit: 100, offset: 0 });
         const globex = rows.find(r => Number(r.customer_id) === GLOBEX);
         expect(globex, 'inactive customer with a balance is listed').to.exist;
         expect(globex.is_customer_active).to.equal(false);
         expect(globex.total_outstanding).to.equal(320); // 120 (snapshot, not the 300 mirror) + 200; stale 999 excluded
         expect(globex.statement_count).to.equal(2);
         expect(globex.bucket_31_60).to.equal(320);
         expect(globex.oldest_days).to.be.within(44, 46);
         expect(dayjs(globex.statement_date).format('YYYY-MM-DD')).to.equal(ymd(statementDate));
         expect(dayjs(globex.most_recent_invoice_date).format('YYYY-MM-DD')).to.equal(ymd(statementDate));
      });

      it('oldest_open_charge_date walks billed billable charges newest-first (FIFO) until they cover the balance', async () => {
         const { rows } = await accountsReceivableService.getAging(db, TEST_ACCOUNT_ID, { limit: 100, offset: 0, search: String(GLOBEX) });
         const [globex] = rows;
         // $100 newest charge does not cover $320, so the $250 charge 60 days
         // before the statement is still (partly) open; the non-billable $500 is ignored.
         expect(dayjs(globex.oldest_open_charge_date).format('YYYY-MM-DD')).to.equal(ymd(statementDate.subtract(60, 'day')));
         expect(globex.oldest_open_charge_days).to.be.within(104, 106);
      });

      it('agrees with the billing engine and the account audit', async () => {
         const invoicesToCreate = [{ customer_id: GLOBEX, showWriteOffs: false }];
         const queryData = await fetchInitialQueryItems(db, { [GLOBEX]: invoicesToCreate[0] }, TEST_ACCOUNT_ID);
         const [calc] = calculateInvoices(invoicesToCreate, queryData);
         const [customer, invoices, payments, writeoffs, transactions, retainers] = await Promise.all([
            accountAuditService.getCustomer(db, TEST_ACCOUNT_ID, GLOBEX),
            accountAuditService.getInvoices(db, TEST_ACCOUNT_ID, GLOBEX),
            accountAuditService.getPayments(db, TEST_ACCOUNT_ID, GLOBEX),
            accountAuditService.getWriteoffs(db, TEST_ACCOUNT_ID, GLOBEX),
            accountAuditService.getTransactions(db, TEST_ACCOUNT_ID, GLOBEX),
            accountAuditService.getRetainers(db, TEST_ACCOUNT_ID, GLOBEX)
         ]);
         const audit = auditCustomerLedger({ customer, invoices, payments, writeoffs, transactions, retainers });
         const { rows } = await accountsReceivableService.getAging(db, TEST_ACCOUNT_ID, { limit: 100, offset: 0, search: String(GLOBEX) });

         expect(Math.round(calc.outstandingInvoices.outstandingInvoiceTotal * 100) / 100).to.equal(320);
         expect(audit.totals.outstanding_invoices).to.equal(320);
         expect(rows[0].total_outstanding).to.equal(320);
      });

      it('excludeIds drops the customer (year-end packet exclusions)', async () => {
         const { rows } = await accountsReceivableService.getAging(db, TEST_ACCOUNT_ID, { limit: 100, offset: 0, excludeIds: [GLOBEX] });
         expect(rows.some(r => Number(r.customer_id) === GLOBEX)).to.equal(false);
      });
   });
});
