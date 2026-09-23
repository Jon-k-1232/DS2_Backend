const {
   restoreDataTypesCustomersInformationOnCreate,
   restoreDataTypesCustomersInformationOnUpdate
} = require('../../../src/endpoints/customer/customerObjects');

describe('fix 4: customerObjects — edit paths must not overwrite audit columns', () => {
   it('restoreDataTypesCustomersInformationOnCreate still sets created_by_user_id (a real INSERT needs it — the column is NOT NULL)', () => {
      const result = restoreDataTypesCustomersInformationOnCreate({
         accountID: 1,
         customer_id: 5,
         userID: 21,
         customerStreet: '1 Main St'
      });
      expect(result.created_by_user_id).to.equal(21);
   });

   it('restoreDataTypesCustomersInformationOnUpdate does NOT include created_by_user_id at all, so a knex .update() with this object cannot overwrite the original creator', () => {
      const result = restoreDataTypesCustomersInformationOnUpdate({
         customerInfoID: 99,
         accountID: 1,
         customerID: 5,
         userID: 21, // the user submitting THIS edit — must not become the row's created_by_user_id
         customerStreet: '2 Elm St'
      });
      expect(result).to.not.have.property('created_by_user_id');
   });

   it('restoreDataTypesCustomersInformationOnUpdate does not include created_at either (relies on the DB default, never touched again after insert)', () => {
      const result = restoreDataTypesCustomersInformationOnUpdate({
         customerInfoID: 99,
         accountID: 1,
         customerID: 5,
         userID: 21,
         customerStreet: '2 Elm St'
      });
      expect(result).to.not.have.property('created_at');
   });
});
