const { resolveInternalCustomerIds, loadInternalCustomerIds, parseInternalCustomerIds, isInternalCustomer } = require('../../../src/endpoints/timesheets/internal-customers');
const { _decideBillable } = require('../../../src/endpoints/timesheets/auto-ingest-orchestrator');

// Shaped like prod account 1.
const customers = [
   { customer_id: 5, display_name: 'James F Kimmel & Associates', business_name: 'James F Kimmel & Associates' },
   { customer_id: 6, display_name: 'Kimmel Financial Partners', business_name: 'Kimmel Financial Partners' },
   { customer_id: 47, display_name: 'Jim Kimmel Insurance Agency', business_name: 'Jim Kimmel Insurance Agency' },
   { customer_id: 10, display_name: 'LTDFH III', business_name: 'LTDFH III' },
   { customer_id: 70, display_name: 'Jonathon and Kathy Kimmel', business_name: null }
];
// Entity column usage: the two firm entities (13 employees each) plus one-off
// typos where somebody put a client in Entity.
const entityUsage = [
   { entity: 'Kimmel Financial Advisors', employees: '13' },
   { entity: 'James F. Kimmel & Associates', employees: '13' },
   { entity: 'Jim Kimmel Insurance Agency, Inc.', employees: '1' },
   { entity: 'LTDFH III, LLC', employees: '1' }
];

describe('internal customers', () => {
   it('the account name / established tracker entity marks "James F Kimmel & Associates" internal (punctuation-insensitive)', () => {
      const ids = resolveInternalCustomerIds({ customers, accountName: 'James F. Kimmel & Associates', entityUsage });
      expect([...ids]).to.deep.equal([5]);
   });

   it('INTERNAL_CUSTOMER_IDS adds "Kimmel Financial Partners" (its name matches no entity)', () => {
      const ids = resolveInternalCustomerIds({ customers, accountName: 'James F. Kimmel & Associates', entityUsage, envIds: parseInternalCustomerIds('6') });
      expect([...ids].sort((a, b) => a - b)).to.deep.equal([5, 6]);
   });

   it('an entity value used by a single employee (a client typed into Entity) never makes that client internal', () => {
      const ids = resolveInternalCustomerIds({ customers, accountName: 'Some Other Firm', entityUsage });
      expect(ids.has(47)).to.equal(false);
      expect(ids.has(10)).to.equal(false);
      expect(ids.has(5)).to.equal(true); // still an established entity
   });

   it('entity matches are exact names, not fuzzy: a related-name household is not internal', () => {
      const ids = resolveInternalCustomerIds({ customers, accountName: 'James F. Kimmel & Associates', entityUsage, envIds: parseInternalCustomerIds('6') });
      expect(ids.has(70)).to.equal(false);
   });

   it('parseInternalCustomerIds tolerates blanks / junk and defaults to empty', () => {
      expect([...parseInternalCustomerIds(' 5, 6 ,,x, -3, 7.5')]).to.deep.equal([5, 6]);
      expect(parseInternalCustomerIds(undefined).size).to.equal(0);
      expect(parseInternalCustomerIds('').size).to.equal(0);
   });

   it('loadInternalCustomerIds reads account name, entity usage and customers from the DB', async () => {
      const calls = [];
      const chain = result => {
         const c = {};
         ['where', 'whereNotNull', 'groupBy', 'select', 'countDistinct'].forEach(m => {
            c[m] = (...args) => {
               calls.push(m);
               return m === 'countDistinct' ? Promise.resolve(result) : c;
            };
         });
         c.first = () => Promise.resolve(result);
         c.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
         return c;
      };
      const fakeDb = table => {
         if (table === 'accounts') return chain({ account_name: 'James F. Kimmel & Associates' });
         if (table === 'timesheet_entries') return chain(entityUsage);
         if (table === 'customers') return chain(customers);
         throw new Error(`unexpected table ${table}`);
      };
      const ids = await loadInternalCustomerIds(fakeDb, 1, { envValue: '6' });
      expect([...ids].sort((a, b) => a - b)).to.deep.equal([5, 6]);
      expect(await isInternalCustomer(fakeDb, 1, 47, { envValue: '6' })).to.equal(false);
      expect(await isInternalCustomer(fakeDb, 1, '6', { envValue: '6' })).to.equal(true);
      expect(calls).to.include('countDistinct');
   });

   it('an internal customer is never auto-billed, even when history says the work is billable', () => {
      const customerPatterns = { workDescToBillableMap: new Map([[7, { billable: 40, nonBillable: 0 }]]) };
      const args = { entry: { category: 'Administrative', notes: 'Staff meeting re: Q3 workflow' }, suggestion: { suggested_general_work_description_id: 7 }, customerPatterns };
      expect(_decideBillable({ ...args, internalCustomer: true })).to.equal(false);
      expect(_decideBillable({ ...args, internalCustomer: false })).to.equal(true);
   });
});
