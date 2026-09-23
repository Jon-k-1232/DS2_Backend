const { _filterToEditable, _diffFields, _normalizeUpdates, _toISODate, EDITABLE_FIELDS, ERRORS } = require('../../../src/endpoints/billingReview/cascadeEdit');

describe('cascadeEdit pure helpers', () => {
   describe('_filterToEditable', () => {
      it('drops fields not in the EDITABLE_FIELDS allowlist', () => {
         const out = _filterToEditable({
            customer_id: 1,
            transaction_id: 999,
            account_id: 9001,
            note: 'hi',
            random_field: 'nope'
         });
         expect(out).to.deep.equal({ customer_id: 1, note: 'hi' });
      });

      it('keeps every field that is editable', () => {
         const all = {};
         for (const k of EDITABLE_FIELDS) all[k] = 'v';
         const out = _filterToEditable(all);
         expect(Object.keys(out).sort()).to.deep.equal([...EDITABLE_FIELDS].sort());
      });

      it('tolerates a null/non-object payload', () => {
         expect(_filterToEditable(null)).to.deep.equal({});
         expect(_filterToEditable('nope')).to.deep.equal({});
      });
   });

   describe('_diffFields', () => {
      it('returns only fields whose values differ', () => {
         const orig = { customer_id: 1, note: 'a', total_transaction: 100 };
         const next = { customer_id: 2, note: 'a', total_transaction: 100 };
         expect(_diffFields(orig, next)).to.deep.equal({ customer_id: { from: 1, to: 2 } });
      });

      it('compares numbers by value (ignores int vs string drift)', () => {
         expect(_diffFields({ quantity: 5 }, { quantity: '5' })).to.deep.equal({});
         // NUMERIC(10,2) comes back from pg as a string
         expect(_diffFields({ total_transaction: '100.00', unit_cost: '150.00' }, { total_transaction: 100, unit_cost: 150 })).to.deep.equal({});
         expect(_diffFields({ customer_job_id: 12 }, { customer_job_id: '12' })).to.deep.equal({});
      });

      it('compares amounts at cent precision', () => {
         expect(_diffFields({ total_transaction: '0.30' }, { total_transaction: 0.1 + 0.2 })).to.deep.equal({});
         expect(_diffFields({ total_transaction: '0.30' }, { total_transaction: 0.31 })).to.have.key('total_transaction');
      });

      it('compares dates as YYYY-MM-DD (pg Date vs UI string is not a change)', () => {
         // node-postgres parses a DATE column to LOCAL midnight
         const pgDate = new Date(2026, 3, 15);
         expect(_diffFields({ transaction_date: pgDate }, { transaction_date: '2026-04-15' })).to.deep.equal({});
         expect(_diffFields({ transaction_date: pgDate }, { transaction_date: '2026-04-15T00:00:00-07:00' })).to.deep.equal({});
      });

      it('reports a real date change with normalised from/to', () => {
         const diff = _diffFields({ transaction_date: new Date(2026, 3, 15) }, { transaction_date: '2026-04-20' });
         expect(diff).to.deep.equal({ transaction_date: { from: '2026-04-15', to: '2026-04-20' } });
      });

      it('compares booleans by meaning', () => {
         expect(_diffFields({ is_transaction_billable: true }, { is_transaction_billable: 'true' })).to.deep.equal({});
         expect(_diffFields({ is_transaction_billable: false }, { is_transaction_billable: 0 })).to.deep.equal({});
         expect(_diffFields({ is_transaction_billable: true }, { is_transaction_billable: false })).to.have.key('is_transaction_billable');
      });

      it('treats null and empty text as the same note', () => {
         expect(_diffFields({ note: null, detailed_work_description: undefined }, { note: '', detailed_work_description: '' })).to.deep.equal({});
      });

      it('returns empty object when nothing changed', () => {
         expect(_diffFields({ a: 1 }, { a: 1 })).to.deep.equal({});
      });
   });

   describe('_toISODate', () => {
      it('uses local calendar components for Date values', () => {
         expect(_toISODate(new Date(2026, 0, 1))).to.equal('2026-01-01');
      });
      it('keeps the calendar date a string was written with', () => {
         expect(_toISODate('2026-02-03')).to.equal('2026-02-03');
         expect(_toISODate('2026-02-03T23:30:00-07:00')).to.equal('2026-02-03');
      });
      it('returns null for blanks and garbage', () => {
         expect(_toISODate('')).to.equal(null);
         expect(_toISODate(null)).to.equal(null);
         expect(_toISODate('not a date')).to.equal(null);
      });
   });

   describe('_normalizeUpdates', () => {
      const invalid = fn => {
         try {
            fn();
         } catch (e) {
            return e;
         }
         return null;
      };

      it('canonicalises ids, amounts, dates and booleans', () => {
         expect(
            _normalizeUpdates({
               customer_id: '5',
               quantity: '1.005',
               total_transaction: 150,
               transaction_date: '2026-04-15T00:00:00-07:00',
               is_transaction_billable: 'false',
               note: null
            })
         ).to.deep.equal({ customer_id: 5, quantity: 1.01, total_transaction: 150, transaction_date: '2026-04-15', is_transaction_billable: false, note: null });
      });

      it('rejects blanks and garbage in NOT NULL fields', () => {
         for (const bad of [{ quantity: null }, { quantity: '' }, { quantity: -1 }, { total_transaction: 'abc' }, { transaction_date: '2026-02-30' }, { is_transaction_billable: 'maybe' }, { customer_id: 0 }, { general_work_description_id: null }]) {
            const err = invalid(() => _normalizeUpdates(bad));
            expect(err, JSON.stringify(bad)).to.be.an('error');
            expect(err.code).to.equal(ERRORS.INVALID_FIELD_VALUE);
            expect(err.field).to.equal(Object.keys(bad)[0]);
         }
      });

      it('allows a blank job (only a CHANGE to no job is refused later)', () => {
         expect(_normalizeUpdates({ customer_job_id: null })).to.deep.equal({ customer_job_id: null });
      });
   });
});
