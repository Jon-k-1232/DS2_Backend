const { fetchUserTime } = require('../../../src/endpoints/transactions/transactionLogic');

describe('transactionLogic.fetchUserTime', () => {
   const activeUsers = [{ user_id: 21, display_name: 'Active Alice' }];

   it('matches transaction_type case-insensitively', () => {
      const transactions = [
         { display_name: 'Acme', job_description: 'Job A', quantity: 2, logged_for_user_id: 21, transaction_type: 'TIME' },
         { display_name: 'Acme', job_description: 'Job A', quantity: 3, logged_for_user_id: 21, transaction_type: 'time' },
         { display_name: 'Acme', job_description: 'Job A', quantity: 5, logged_for_user_id: 21, transaction_type: 'Charge' }
      ];

      const result = fetchUserTime(activeUsers, transactions, 'Time');
      const alice = result.find(r => r.user.user_id === 21);
      // Both TIME/time rows count (case-insensitive); the Charge row is excluded.
      expect(alice.time).to.equal(5);
   });

   it('does not crash when a transaction belongs to a user absent from activeUsers (deactivated since)', () => {
      const transactions = [
         { display_name: 'Acme', job_description: 'Job A', quantity: 2, logged_for_user_id: 21, transaction_type: 'Time' },
         // logged_for_user_id 999 is not in activeUsers - used to throw
         // "Cannot read properties of undefined (reading 'customers')".
         { display_name: 'Acme', job_description: 'Job A', quantity: 4, logged_for_user_id: 999, transaction_type: 'Time' }
      ];

      expect(() => fetchUserTime(activeUsers, transactions, 'Time')).to.not.throw();

      const result = fetchUserTime(activeUsers, transactions, 'Time');
      const alice = result.find(r => r.user && r.user.user_id === 21);
      expect(alice.time).to.equal(2); // only the active user's row is attributed
      // the deactivated user's transaction is silently skipped, not present under any key
      expect(result.some(r => r.user && r.user.user_id === 999)).to.equal(false);
   });

   it('returns every active user even with zero matching transactions', () => {
      const result = fetchUserTime(activeUsers, [], 'Time');
      expect(result).to.have.lengthOf(1);
      expect(result[0].time).to.equal(0);
   });
});
