const { redactRowForAi, unredactSuggestion, assertNoPii, containsAnyName, _knownNamesFromCatalogs, PII_COLUMNS } = require('../../src/utils/piiRedactor');
const comprehend = require('../../src/utils/comprehend');

describe('piiRedactor', () => {
   afterEach(() => comprehend._setClientForTest(null));

   const seedCustomers = [
      { customer_id: 1, display_name: 'Acme Corp', business_name: 'Acme Corporation', customer_name: '', first_name: '', last_name: '' },
      { customer_id: 2, display_name: 'Smith, John', business_name: '', customer_name: 'John Smith', first_name: 'John', last_name: 'Smith' }
   ];
   const seedEmployees = [
      { user_id: 7, display_name: 'Eliza Smith' },
      { user_id: 8, display_name: 'Bob Jones' }
   ];

   describe('redactRowForAi', () => {
      it('strips every PII column from the sanitized output', async () => {
         comprehend._setClientForTest({ send: () => Promise.resolve({ Entities: [] }) });
         const row = {
            date: '2026-05-01',
            entity: 'Acme Corp',
            category: 'Consulting',
            employee_name: 'Eliza Smith',
            company_name: 'Acme Corp',
            first_name: 'Jane',
            last_name: 'Doe',
            duration: 60,
            notes: 'work session'
         };
         const { sanitized } = await redactRowForAi(row, seedCustomers, seedEmployees, { resolvedCustomerId: 1, resolvedUserId: 7 });
         for (const col of PII_COLUMNS) {
            expect(sanitized).to.not.have.property(col);
         }
         expect(sanitized.entity_token).to.equal('CUSTOMER_1');
         expect(sanitized.employee_token).to.equal('EMPLOYEE_7');
         expect(sanitized.notes).to.equal('work session');
      });

      it('returns CUSTOMER_UNKNOWN / EMPLOYEE_UNKNOWN when not resolved', async () => {
         comprehend._setClientForTest({ send: () => Promise.resolve({ Entities: [] }) });
         const { sanitized, mapping } = await redactRowForAi({ date: '2026-05-01', notes: 'x', duration: 30 }, seedCustomers, seedEmployees);
         expect(sanitized.entity_token).to.equal('CUSTOMER_UNKNOWN');
         expect(sanitized.employee_token).to.equal('EMPLOYEE_UNKNOWN');
         expect(mapping.resolvedCustomerId).to.equal(null);
         expect(mapping.resolvedUserId).to.equal(null);
      });

      it('redacts customer/employee names that leak into notes', async () => {
         comprehend._setClientForTest({ send: () => Promise.reject(new Error('mock fail')) });
         const row = {
            date: '2026-05-01',
            duration: 60,
            notes: 'Talked to John Smith from ACME Corp about Eliza Smith\'s schedule'
         };
         const { sanitized, redactionMeta } = await redactRowForAi(row, seedCustomers, seedEmployees, { resolvedCustomerId: 1, resolvedUserId: 7 });
         expect(redactionMeta.usedComprehend).to.equal(false);
         expect(sanitized.notes).to.contain('[REDACTED_NAME]');
         expect(sanitized.notes.toLowerCase()).to.not.contain('john smith');
         expect(sanitized.notes.toLowerCase()).to.not.contain('acme corp');
         expect(sanitized.notes.toLowerCase()).to.not.contain('eliza smith');
      });

      it('preserves duration as a number even if input is string', async () => {
         comprehend._setClientForTest({ send: () => Promise.resolve({ Entities: [] }) });
         const { sanitized } = await redactRowForAi({ date: '2026-05-01', notes: 'x', duration: '90' }, [], []);
         expect(sanitized.duration_minutes).to.equal(90);
      });
   });

   describe('unredactSuggestion', () => {
      it('maps customer token back to id', () => {
         const out = unredactSuggestion({ suggested_customer_token: 'CUSTOMER_42', suggested_category_label: 'X' }, { resolvedCustomerId: 42 });
         expect(out.suggested_customer_id).to.equal(42);
         expect(out).to.not.have.property('suggested_customer_token');
      });

      it('returns input unchanged when no mapping is present', () => {
         const input = { foo: 'bar' };
         expect(unredactSuggestion(input, {})).to.deep.equal(input);
      });

      it('handles non-object input safely', () => {
         expect(unredactSuggestion(null)).to.equal(null);
         expect(unredactSuggestion('hello')).to.equal('hello');
      });
   });

   describe('assertNoPii / containsAnyName (defense-in-depth invariant)', () => {
      it('throws when serialized payload contains a customer name', () => {
         const payload = JSON.stringify({ field: 'note', notes: 'sent invoice to Acme Corp' });
         expect(() => assertNoPii(payload, seedCustomers, seedEmployees)).to.throw(/PII leak/);
      });

      it('throws when serialized payload contains an employee name', () => {
         const payload = JSON.stringify({ note: 'Eliza Smith handled it' });
         expect(() => assertNoPii(payload, seedCustomers, seedEmployees)).to.throw(/PII leak/);
      });

      it('passes when payload only references opaque tokens', () => {
         const payload = JSON.stringify({ entity_token: 'CUSTOMER_1', employee_token: 'EMPLOYEE_7', notes: '[REDACTED_NAME] reviewed [REDACTED_NAME]' });
         expect(assertNoPii(payload, seedCustomers, seedEmployees)).to.equal(true);
      });

      it('containsAnyName is case-insensitive', () => {
         expect(containsAnyName('we billed acme corp', ['Acme Corp'])).to.equal(true);
      });
   });

   describe('_knownNamesFromCatalogs', () => {
      it('flattens display_name and business_name from customers and display_name from users', () => {
         const names = _knownNamesFromCatalogs(seedCustomers, seedEmployees);
         expect(names).to.include('Acme Corp');
         expect(names).to.include('Acme Corporation');
         expect(names).to.include('Eliza Smith');
         expect(names).to.include('John Smith');
      });
   });
});
