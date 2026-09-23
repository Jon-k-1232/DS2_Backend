/**
 * Object mappers + shared ledger helpers (no DB).
 *
 * `String(x) || null` stored the literal strings 'null' / 'undefined' (a
 * non-empty string is truthy) and `Boolean(x) || true` could never be false.
 */
const { restoreDataTypesPaymentsTableOnCreate, restoreDataTypesPaymentsTableOnUpdate, restoreDataTypesOnPayments } = require('../../../src/endpoints/payments/paymentsObjects');
const { nullableString, parseBoolean, withTransaction, appendNoteMarker, round2 } = require('../../../src/endpoints/payments/ledger-helpers');

describe('ledger-helpers value parsing', () => {
   it('nullableString never produces the literal strings null / undefined', () => {
      expect(nullableString(null)).to.equal(null);
      expect(nullableString(undefined)).to.equal(null);
      expect(nullableString('')).to.equal(null);
      expect(nullableString('null')).to.equal(null);
      expect(nullableString('undefined')).to.equal(null);
      expect(nullableString('Check #12')).to.equal('Check #12');
      expect(nullableString(1234)).to.equal('1234');
   });

   it('parseBoolean honours an explicit false and defaults only when absent', () => {
      expect(parseBoolean(false, true)).to.equal(false);
      expect(parseBoolean('false', true)).to.equal(false);
      expect(parseBoolean(0, true)).to.equal(false);
      expect(parseBoolean(true, false)).to.equal(true);
      expect(parseBoolean('true', false)).to.equal(true);
      expect(parseBoolean(undefined, true)).to.equal(true);
      expect(parseBoolean(null, true)).to.equal(true);
      expect(parseBoolean('', true)).to.equal(true);
      expect(parseBoolean('maybe', true)).to.equal(true);
   });

   it('appendNoteMarker and round2', () => {
      expect(appendNoteMarker(null, '[m]')).to.equal('[m]');
      expect(appendNoteMarker('memo', '[m]')).to.equal('memo [m]');
      expect(round2(0.1 + 0.2)).to.equal(0.3);
      expect(round2('100.005')).to.equal(100.01);
   });

   it('withTransaction reuses a caller transaction and otherwise opens one', async () => {
      const trx = { isTransaction: true };
      expect(await withTransaction(trx, t => (t === trx ? 'reused' : 'new'))).to.equal('reused');

      let opened = 0;
      const db = { transaction: fn => { opened += 1; return fn({ isTransaction: true, opened }); } };
      expect(await withTransaction(db, t => t.opened)).to.equal(1);
   });
});

describe('payment object mappers', () => {
   const form = {
      customerID: '7',
      accountID: '1',
      selectedJobID: '44',
      selectedRetainerID: null,
      selectedInvoiceID: '900',
      transactionDate: '2026-09-22',
      unitCost: '125.50',
      formOfPayment: 'Check',
      paymentReferenceNumber: '',
      isTransactionBillable: false,
      loggedByUserID: '21',
      note: null
   };

   it('create: negative amount, nulls stay null, an explicit false billable flag survives', () => {
      const row = restoreDataTypesPaymentsTableOnCreate(form);
      expect(row.payment_amount).to.equal(-125.5);
      expect(row.customer_job_id).to.equal(44);
      expect(row.customer_invoice_id).to.equal(900);
      expect(row.retainer_id).to.equal(null);
      expect(row.payment_reference_number).to.equal(null);
      expect(row.note).to.equal(null);
      expect(row.is_transaction_billable).to.equal(false);
      expect(restoreDataTypesPaymentsTableOnCreate({ ...form, isTransactionBillable: undefined }).is_transaction_billable).to.equal(true);
   });

   it('update: omitted optional fields stay undefined so the column is left untouched', () => {
      const row = restoreDataTypesPaymentsTableOnUpdate({ paymentID: '5', unitCost: 10 });
      expect(row.payment_id).to.equal(5);
      ['note', 'form_of_payment', 'payment_reference_number', 'customer_job_id', 'is_transaction_billable'].forEach(key => expect(row[key], key).to.equal(undefined));
      const cleared = restoreDataTypesPaymentsTableOnUpdate({ paymentID: '5', unitCost: 10, note: '', paymentReferenceNumber: 'null' });
      expect(cleared.note).to.equal(null);
      expect(cleared.payment_reference_number).to.equal(null);
   });

   it('stored-row mapper keeps nulls null and a reversal row positive', () => {
      const row = restoreDataTypesOnPayments({
         payment_id: 3,
         customer_id: 7,
         account_id: 1,
         payment_date: '2026-09-01',
         payment_amount: '400.00',
         form_of_payment: 'Reversal',
         payment_reference_number: null,
         is_transaction_billable: false,
         created_at: '2026-09-01T10:00:00Z',
         created_by_user_id: 21,
         note: null
      });
      expect(row.note).to.equal(null);
      expect(row.payment_reference_number).to.equal(null);
      expect(row.payment_amount).to.equal(400);
      expect(row.is_transaction_billable).to.equal(false);
   });
});
