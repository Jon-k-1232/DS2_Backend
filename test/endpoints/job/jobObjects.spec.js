const { restoreDataTypesJobTableOnCreate, restoreDataTypesJobTableOnUpdate } = require('../../../src/endpoints/job/jobObjects');

const basePayload = overrides => ({
   accountID: 1,
   customerID: 100,
   jobTypeID: 5,
   quoteAmount: 0,
   userID: 21,
   ...overrides
});

describe('jobObjects notes field fallback', () => {
   describe('restoreDataTypesJobTableOnCreate', () => {
      it('accepts `notes` (what the New Job form actually sends)', () => {
         const fields = restoreDataTypesJobTableOnCreate(basePayload({ notes: 'from the form' }));
         expect(fields.notes).to.equal('from the form');
      });

      it('still accepts `note` for backward compatibility', () => {
         const fields = restoreDataTypesJobTableOnCreate(basePayload({ note: 'legacy field name' }));
         expect(fields.notes).to.equal('legacy field name');
      });

      it('prefers `note` when both are somehow present', () => {
         const fields = restoreDataTypesJobTableOnCreate(basePayload({ note: 'note wins', notes: 'notes loses' }));
         expect(fields.notes).to.equal('note wins');
      });

      it('falls back to null when neither is present', () => {
         const fields = restoreDataTypesJobTableOnCreate(basePayload());
         expect(fields.notes).to.equal(null);
      });
   });

   describe('restoreDataTypesJobTableOnUpdate', () => {
      it('accepts either `note` or `notes`', () => {
         expect(restoreDataTypesJobTableOnUpdate(basePayload({ customerJobID: 1, notes: 'from the form' })).notes).to.equal('from the form');
         expect(restoreDataTypesJobTableOnUpdate(basePayload({ customerJobID: 1, note: 'legacy' })).notes).to.equal('legacy');
      });
   });
});
