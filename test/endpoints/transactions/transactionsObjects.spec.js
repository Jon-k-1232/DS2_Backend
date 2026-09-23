const {
   normalizeTransactionType,
   nullableString,
   parseBooleanFlag,
   restoreDataTypesTransactionsTableOnCreate,
   restoreDataTypesTransactionsTableOnUpdate,
   restoreDataTypesOnTransactions,
   createPaymentObjectFromTransaction
} = require('../../../src/endpoints/transactions/transactionsObjects');

const validCreatePayload = () => ({
   accountID: 1,
   customerID: 100,
   customerJobID: 501,
   loggedForUserID: 21,
   selectedGeneralWorkDescriptionID: 7,
   detailedJobDescription: 'some work',
   transactionDate: '2026-04-01',
   transactionType: 'time',
   quantity: 2,
   unitCost: 50,
   totalTransaction: 100,
   isTransactionBillable: true,
   loggedByUserID: 21,
   note: 'a note'
});

describe('transactionsObjects', () => {
   describe('normalizeTransactionType', () => {
      it('normalizes case-insensitively to the canonical casing', () => {
         expect(normalizeTransactionType('time')).to.equal('Time');
         expect(normalizeTransactionType('TIME')).to.equal('Time');
         expect(normalizeTransactionType('Time')).to.equal('Time');
         expect(normalizeTransactionType('charge')).to.equal('Charge');
         expect(normalizeTransactionType('CHARGE')).to.equal('Charge');
         expect(normalizeTransactionType('  Charge  ')).to.equal('Charge');
      });

      it('throws a clear error for anything else', () => {
         expect(() => normalizeTransactionType('bogus')).to.throw(/Invalid transaction_type/);
         expect(() => normalizeTransactionType(undefined)).to.throw(/Invalid transaction_type/);
         expect(() => normalizeTransactionType(null)).to.throw(/Invalid transaction_type/);
         expect(() => normalizeTransactionType('')).to.throw(/Invalid transaction_type/);
      });
   });

   describe('nullableString', () => {
      it('returns null for null/undefined/empty string instead of the literal word', () => {
         // The bug this replaces: String(undefined) === 'undefined' (truthy),
         // String(null) === 'null' (truthy), so `String(x) || fallback` never
         // fell back and stored the literal word.
         expect(nullableString(undefined)).to.equal(null);
         expect(nullableString(null)).to.equal(null);
         expect(nullableString('')).to.equal(null);
      });

      it('stringifies everything else', () => {
         expect(nullableString('hello')).to.equal('hello');
         expect(nullableString(0)).to.equal('0');
         expect(nullableString(42)).to.equal('42');
      });
   });

   describe('parseBooleanFlag', () => {
      it('honors an explicit false instead of always returning true', () => {
         expect(parseBooleanFlag(false, true)).to.equal(false);
         expect(parseBooleanFlag('false', true)).to.equal(false);
      });

      it('honors an explicit true', () => {
         expect(parseBooleanFlag(true, false)).to.equal(true);
         expect(parseBooleanFlag('true', false)).to.equal(true);
      });

      it('uses the default only when the value is null/undefined', () => {
         expect(parseBooleanFlag(undefined, true)).to.equal(true);
         expect(parseBooleanFlag(null, false)).to.equal(false);
      });
   });

   describe('restoreDataTypesTransactionsTableOnCreate', () => {
      it('prefers a trusted snake_case account_id over the body-controlled camelCase one', () => {
         const fields = restoreDataTypesTransactionsTableOnCreate({ ...validCreatePayload(), account_id: 1, accountID: 999 });
         expect(fields.account_id).to.equal(1);
      });

      it('falls back to the camelCase accountID when account_id is absent', () => {
         const fields = restoreDataTypesTransactionsTableOnCreate(validCreatePayload());
         expect(fields.account_id).to.equal(1);
      });

      it('normalizes transaction_type and never persists the literal "undefined"/"null" for note/detailed_work_description', () => {
         const fields = restoreDataTypesTransactionsTableOnCreate({ ...validCreatePayload(), note: undefined, detailedJobDescription: undefined });
         expect(fields.transaction_type).to.equal('Time');
         expect(fields.note).to.equal(null);
         expect(fields.detailed_work_description).to.equal(null);
      });

      // A4 (2026-09 review): the create mapper bypassed parseBooleanFlag and used
      // `Boolean(x)` directly, so the string "false" a form can send (Boolean('false') === true)
      // stored true regardless — a $50 entry marked isTransactionBillable:"false" with a
      // retainer selected drew $50 from it. Both boolean flags go through parseBooleanFlag now.
      it('A4: honors a string "false" for isTransactionBillable and isInAdditionToMonthlyCharge instead of always storing true', () => {
         const fields = restoreDataTypesTransactionsTableOnCreate({ ...validCreatePayload(), isTransactionBillable: 'false', isInAdditionToMonthlyCharge: 'false' });
         expect(fields.is_transaction_billable).to.equal(false);
         expect(fields.is_excess_to_subscription).to.equal(false);
      });

      it('A4: still honors an actual boolean false for both flags', () => {
         const fields = restoreDataTypesTransactionsTableOnCreate({ ...validCreatePayload(), isTransactionBillable: false, isInAdditionToMonthlyCharge: false });
         expect(fields.is_transaction_billable).to.equal(false);
         expect(fields.is_excess_to_subscription).to.equal(false);
      });

      it('A4: honors true in both string and boolean form for both flags', () => {
         const strFields = restoreDataTypesTransactionsTableOnCreate({ ...validCreatePayload(), isTransactionBillable: 'true', isInAdditionToMonthlyCharge: 'true' });
         expect(strFields.is_transaction_billable).to.equal(true);
         expect(strFields.is_excess_to_subscription).to.equal(true);
         const boolFields = restoreDataTypesTransactionsTableOnCreate({ ...validCreatePayload(), isTransactionBillable: true, isInAdditionToMonthlyCharge: true });
         expect(boolFields.is_transaction_billable).to.equal(true);
         expect(boolFields.is_excess_to_subscription).to.equal(true);
      });

      it('defaults is_excess_to_subscription to false when genuinely absent (unchanged default)', () => {
         const { isInAdditionToMonthlyCharge, ...rest } = validCreatePayload();
         expect(restoreDataTypesTransactionsTableOnCreate(rest).is_excess_to_subscription).to.equal(false);
      });
   });

   describe('restoreDataTypesTransactionsTableOnUpdate', () => {
      it('omits customer_invoice_id entirely so an update can never move a transaction on/off an invoice', () => {
         const fields = restoreDataTypesTransactionsTableOnUpdate({ ...validCreatePayload(), transactionID: 1, customerInvoicesID: 12345 });
         expect(fields).to.not.have.property('customer_invoice_id');
      });

      it('omits created_at entirely so an update never resets the audit column', () => {
         const fields = restoreDataTypesTransactionsTableOnUpdate({ ...validCreatePayload(), transactionID: 1 });
         expect(fields).to.not.have.property('created_at');
      });

      // A3 (2026-09 review): an edit used to re-stamp created_by_user_id from
      // the request body's loggedByUserID (spoofable, and it overwrote the
      // original creator on every save). The audit column is now stamped once
      // at creation (see addNewTransaction) and never touched by an update —
      // omitting the key means knex's .update() leaves it untouched.
      it('A3: omits created_by_user_id entirely so an update never overwrites the original creator', () => {
         const fields = restoreDataTypesTransactionsTableOnUpdate({ ...validCreatePayload(), transactionID: 1, loggedByUserID: 999 });
         expect(fields).to.not.have.property('created_by_user_id');
      });

      // A4: the update mapper had the identical Boolean(x) bug as create.
      it('A4: honors a string "false" for isTransactionBillable and isInAdditionToMonthlyCharge instead of always storing true', () => {
         const fields = restoreDataTypesTransactionsTableOnUpdate({ ...validCreatePayload(), transactionID: 1, isTransactionBillable: 'false', isInAdditionToMonthlyCharge: 'false' });
         expect(fields.is_transaction_billable).to.equal(false);
         expect(fields.is_excess_to_subscription).to.equal(false);
      });

      it('A4: honors true in both string and boolean form for both flags', () => {
         const strFields = restoreDataTypesTransactionsTableOnUpdate({ ...validCreatePayload(), transactionID: 1, isTransactionBillable: 'true', isInAdditionToMonthlyCharge: 'true' });
         expect(strFields.is_transaction_billable).to.equal(true);
         expect(strFields.is_excess_to_subscription).to.equal(true);
      });
   });

   describe('restoreDataTypesOnTransactions (db-shaped input)', () => {
      it('applies the same normalization/nullable-string treatment', () => {
         const fields = restoreDataTypesOnTransactions({
            transaction_id: 1,
            account_id: 1,
            customer_id: 100,
            customer_job_id: 501,
            retainer_id: null,
            customer_invoice_id: null,
            logged_for_user_id: 21,
            general_work_description_id: 7,
            detailed_work_description: undefined,
            transaction_date: '2026-04-01',
            transaction_type: 'CHARGE',
            quantity: 1,
            unit_cost: 100,
            total_transaction: -100,
            is_transaction_billable: true,
            is_excess_to_subscription: false,
            created_at: '2026-04-01T00:00:00Z',
            created_by_user_id: 21,
            note: null
         });
         expect(fields.transaction_type).to.equal('Charge');
         expect(fields.detailed_work_description).to.equal(null);
         expect(fields.note).to.equal(null);
         expect(fields.total_transaction).to.equal(100); // Math.abs preserved
      });
   });

   describe('createPaymentObjectFromTransaction', () => {
      it('parses is_transaction_billable properly instead of always forcing true', () => {
         const billable = createPaymentObjectFromTransaction({ ...validCreatePayload(), selectedRetainerID: 10, isTransactionBillable: true });
         const nonBillable = createPaymentObjectFromTransaction({ ...validCreatePayload(), selectedRetainerID: 10, isTransactionBillable: false });
         expect(billable.is_transaction_billable).to.equal(true);
         expect(nonBillable.is_transaction_billable).to.equal(false);
      });

      it('defaults is_transaction_billable to true only when genuinely absent', () => {
         const { isTransactionBillable, ...rest } = { ...validCreatePayload(), selectedRetainerID: 10 };
         const payment = createPaymentObjectFromTransaction(rest);
         expect(payment.is_transaction_billable).to.equal(true);
      });

      it('prefers a trusted snake_case account_id over the camelCase one', () => {
         const payment = createPaymentObjectFromTransaction({ ...validCreatePayload(), selectedRetainerID: 10, account_id: 1, accountID: 999 });
         expect(payment.account_id).to.equal(1);
      });
   });
});
