const { _filterToEditable, _diffFields, EDITABLE_FIELDS } = require('../../../src/endpoints/billingReview/cascadeEdit');

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
   });

   describe('_diffFields', () => {
      it('returns only fields whose values differ', () => {
         const orig = { customer_id: 1, note: 'a', total_transaction: 100 };
         const next = { customer_id: 2, note: 'a', total_transaction: 100 };
         expect(_diffFields(orig, next)).to.deep.equal({ customer_id: { from: 1, to: 2 } });
      });

      it('compares as strings (ignores int vs string drift)', () => {
         const orig = { quantity: 5 };
         const next = { quantity: '5' };
         expect(_diffFields(orig, next)).to.deep.equal({});
      });

      it('returns empty object when nothing changed', () => {
         expect(_diffFields({ a: 1 }, { a: 1 })).to.deep.equal({});
      });
   });
});
