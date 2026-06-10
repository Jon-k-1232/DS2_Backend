/**
 * Analytics service shape contract. Runs against the dev-DB fixture account —
 * asserts structure and math invariants, not specific business values.
 * Skipped when the dev DB isn't reachable.
 */
const { requireDb, closeDb, cleanupTestData, TEST_ACCOUNT_ID, TEST_ADMIN_USER_ID } = require('./_setup');
const analyticsService = require('../../src/endpoints/analytics/analytics-service');

describe('integration: analytics service', function () {
   this.timeout(30_000);
   let db;

   before(async function () {
      db = await requireDb.call(this);
      await cleanupTestData(db);

      // Two billable time entries + one fixed charge + one non-billable admin
      // entry for the fixture customer in a fixed year.
      const base = {
         account_id: TEST_ACCOUNT_ID,
         customer_id: 900101,
         customer_job_id: 9001001,
         logged_for_user_id: 90011,
         general_work_description_id: 90031,
         created_by_user_id: TEST_ADMIN_USER_ID,
         is_excess_to_subscription: false
      };
      await db('customer_transactions').insert([
         { ...base, transaction_date: '2025-03-01', transaction_type: 'Time', quantity: 2, unit_cost: 100, total_transaction: 200, is_transaction_billable: true },
         { ...base, transaction_date: '2025-04-01', transaction_type: 'Time', quantity: 1, unit_cost: 100, total_transaction: 100, is_transaction_billable: true },
         { ...base, transaction_date: '2025-05-01', transaction_type: 'Charge', quantity: 1, unit_cost: 50, total_transaction: 50, is_transaction_billable: true },
         { ...base, transaction_date: '2025-06-01', transaction_type: 'Time', quantity: 1.5, unit_cost: 0, total_transaction: 0, is_transaction_billable: false }
      ]);
   });

   after(async () => {
      if (db) await cleanupTestData(db);
      await closeDb();
   });

   it('getClientRates: effective rate = time billings ÷ time hours; charges excluded from the rate', async () => {
      const { clients, years, firm } = await analyticsService.getClientRates(db, TEST_ACCOUNT_ID, { yearsBack: 3 });
      expect(years).to.be.an('array').that.includes(2025);
      const acme = clients.find(c => c.customer_id === 900101);
      expect(acme, 'fixture customer present').to.exist;
      const y = acme.years[2025];
      expect(y.hours).to.equal(3); // billable Time only
      expect(y.time_billed).to.equal(300);
      expect(y.charges_billed).to.equal(50);
      expect(y.total_billed).to.equal(350);
      expect(y.effective_rate).to.equal(100);
      expect(firm).to.have.property('suggestion_formula');
   });

   it('getTimeAllocation: billable/non-billable hours split and tracker section', async () => {
      const ta = await analyticsService.getTimeAllocation(db, TEST_ACCOUNT_ID, { year: 2025 });
      expect(ta.summary.total_hours).to.equal(4.5);
      expect(ta.summary.billable_hours).to.equal(3);
      expect(ta.summary.nonbillable_hours).to.equal(1.5);
      expect(ta.summary.billed_amount).to.equal(350);
      expect(ta).to.not.have.property('byEmployee'); // removed per request
      expect(ta.byWorkDescription[0].hours).to.equal(4.5);
      const march = ta.monthly.find(m => m.month === 3);
      expect(march.billable_hours).to.equal(2);
      expect(ta).to.have.property('trackerByCategory').that.is.an('array');
      expect(ta.availableYears).to.be.an('array');
   });

   it('getTimeAllocation: excludeIds removes a customer from the totals', async () => {
      const full = await analyticsService.getTimeAllocation(db, TEST_ACCOUNT_ID, { year: 2025 });
      const excluded = await analyticsService.getTimeAllocation(db, TEST_ACCOUNT_ID, { year: 2025, excludeIds: [900101] });
      // 900101 (Acme) is the only customer in the fixture, so excluding it
      // drops the transaction-based totals to zero (tracker is separate).
      expect(full.summary.total_hours).to.equal(4.5);
      expect(excluded.summary.total_hours).to.equal(0);
      expect(excluded.byCustomer).to.have.lengthOf(0);
   });

   it('getExcludableCustomers: returns the customer list and default-excluded ids', async () => {
      const { customers, defaultExcludedIds } = await analyticsService.getExcludableCustomers(db, TEST_ACCOUNT_ID);
      expect(customers).to.be.an('array');
      expect(defaultExcludedIds).to.be.an('array'); // none in the fixture account, but the shape is the contract
   });
});
