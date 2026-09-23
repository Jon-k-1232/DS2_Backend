const { restoreDataTypesWriteOffsTableOnCreate, restoreDataTypesWriteOffsTableOnUpdate, restoreDataTypesOnWriteOffs } = require('../../../src/endpoints/writeOffs/writeOffsObjects');

describe('write-off object mappers', () => {
   it('create: negative amount, the form reason key, nulls stay null', () => {
      const row = restoreDataTypesWriteOffsTableOnCreate({ customerID: 7, accountID: 1, customerInvoiceID: '900', unitCost: 25, writeoffReason: 'Courtesy', loggedByUserID: 21, note: '' });
      expect(row.writeoff_amount).to.equal(-25);
      expect(row.customer_invoice_id).to.equal(900);
      expect(row.customer_job_id).to.equal(null);
      expect(row.writeoff_reason).to.equal('Courtesy');
      expect(row.note).to.equal(null);
      expect(restoreDataTypesWriteOffsTableOnCreate({ unitCost: 5, writeOffReason: 'Alt key' }).writeoff_reason).to.equal('Alt key');
   });

   it('update: reads either id key and leaves omitted fields undefined', () => {
      const row = restoreDataTypesWriteOffsTableOnUpdate({ writeoffID: 12, writeOffID: null, unitCost: -40 });
      expect(row.writeoff_id).to.equal(12);
      expect(row.writeoff_amount).to.equal(-40);
      expect(row.note).to.equal(undefined);
      expect(row.writeoff_reason).to.equal(undefined);
      expect(row.customer_job_id).to.equal(undefined);
      expect(restoreDataTypesWriteOffsTableOnUpdate({ writeOffID: 13 }).writeoff_id).to.equal(13);
   });

   it('stored-row mapper never writes the literal string null', () => {
      const row = restoreDataTypesOnWriteOffs({ writeoff_id: 1, customer_id: 7, account_id: 1, writeoff_amount: '25', writeoff_reason: 'Courtesy', note: null, transaction_type: null });
      expect(row.note).to.equal(null);
      expect(row.transaction_type).to.equal('Write Off');
      expect(row.writeoff_amount).to.equal(-25);
   });
});
