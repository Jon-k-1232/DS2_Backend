const {
   restoreDataTypesRecurringCustomerTableOnCreate,
   restoreDataTypesRecurringCustomerTableOnUpdate
} = require('../../../src/endpoints/recurringCustomer/recurringCustomerObjects');

describe('fix 6: recurringCustomerObjects — start date + active-flag mapping bugs', () => {
   describe('restoreDataTypesRecurringCustomerTableOnCreate', () => {
      it('honours an explicit startDate instead of always defaulting to now', () => {
         const result = restoreDataTypesRecurringCustomerTableOnCreate(
            { accountID: 1, customerID: 5, startDate: '2025-03-15', isActive: true, userID: 21 },
            5
         );
         expect(result.start_date).to.equal('2025-03-15');
      });

      it('falls back to selectedStartDate (the actual key the frontend posts) when startDate is absent', () => {
         const result = restoreDataTypesRecurringCustomerTableOnCreate(
            { accountID: 1, customerID: 5, selectedStartDate: '2025-06-01', userID: 21 },
            5
         );
         expect(result.start_date).to.equal('2025-06-01');
      });

      it('defaults to now only when neither startDate nor selectedStartDate is supplied', () => {
         const before = Date.now();
         const result = restoreDataTypesRecurringCustomerTableOnCreate({ accountID: 1, customerID: 5, userID: 21 }, 5);
         const parsed = new Date(result.start_date).getTime();
         expect(parsed).to.be.at.least(before - 5000);
         expect(parsed).to.be.at.most(Date.now() + 5000);
      });

      it('defaults is_recurring_customer_active to true when isActive is omitted (today\'s "New Customer" form never sends it)', () => {
         const result = restoreDataTypesRecurringCustomerTableOnCreate({ accountID: 1, customerID: 5, userID: 21 }, 5);
         expect(result.is_recurring_customer_active).to.equal(true);
      });

      it('honours an explicit isActive: false on create (old `Boolean(x) || true` bug always forced true)', () => {
         const result = restoreDataTypesRecurringCustomerTableOnCreate({ accountID: 1, customerID: 5, userID: 21, isActive: false }, 5);
         expect(result.is_recurring_customer_active).to.equal(false);
      });

      it('honours an explicit isActive: true on create', () => {
         const result = restoreDataTypesRecurringCustomerTableOnCreate({ accountID: 1, customerID: 5, userID: 21, isActive: true }, 5);
         expect(result.is_recurring_customer_active).to.equal(true);
      });
   });

   describe('restoreDataTypesRecurringCustomerTableOnUpdate', () => {
      it('sets is_recurring_customer_active: false when explicitly requested', () => {
         const result = restoreDataTypesRecurringCustomerTableOnUpdate(
            { recurringCustomerID: 9, accountID: 1, userID: 21, isActive: false },
            5
         );
         expect(result.is_recurring_customer_active).to.equal(false);
      });

      it('sets is_recurring_customer_active: true when explicitly requested', () => {
         const result = restoreDataTypesRecurringCustomerTableOnUpdate(
            { recurringCustomerID: 9, accountID: 1, userID: 21, isActive: true },
            5
         );
         expect(result.is_recurring_customer_active).to.equal(true);
      });

      it('omits is_recurring_customer_active entirely when isActive is not supplied, so an unrelated field edit cannot silently deactivate the row', () => {
         const result = restoreDataTypesRecurringCustomerTableOnUpdate(
            { recurringCustomerID: 9, accountID: 1, userID: 21, recurringAmount: 250 },
            5
         );
         expect(result).to.not.have.property('is_recurring_customer_active');
      });

      it('honours an explicit startDate on update', () => {
         const result = restoreDataTypesRecurringCustomerTableOnUpdate(
            { recurringCustomerID: 9, accountID: 1, userID: 21, startDate: '2025-09-01' },
            5
         );
         expect(result.start_date).to.equal('2025-09-01');
      });
   });
});
