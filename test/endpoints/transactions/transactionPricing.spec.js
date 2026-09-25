const { validateTransactionPrice } = require('../../../src/endpoints/transactions/transactionPricing');
it('F11 prices fractional cents using integer hundredths before rounding', () => {
   const result = validateTransactionPrice({ transactionType: 'Charge', quantity: 0.02, unitCost: 200.75, totalTransaction: 4.02 });
   expect(result.totalTransaction).to.equal(4.02);
});

it('F11 accepts decimal-hour direct Time entries with absent duration', () => {
   for (const minutes of [undefined, null, '']) {
      const result = validateTransactionPrice({ transactionType: 'Time', quantity: 0.25, unitCost: 75, totalTransaction: 18.75, minutes });
      expect(result.quantity).to.equal(0.25);
      expect(result.totalTransaction).to.equal(18.75);
   }
});

it('F11 still requires Time quantity to match supplied duration rounded up to six minutes', () => {
   const fields = { transactionType: 'Time', quantity: 0.25, unitCost: 75, totalTransaction: 18.75, minutes: 15 };
   expect(() => validateTransactionPrice(fields)).to.throw('Time quantity must match the duration rounded up to six-minute increments.');
   expect(validateTransactionPrice({ ...fields, quantity: 0.3, totalTransaction: 22.5 }).totalTransaction).to.equal(22.5);
});
