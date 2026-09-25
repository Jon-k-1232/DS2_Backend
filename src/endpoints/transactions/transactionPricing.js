const { normalizeTransactionType } = require('./transactionsObjects');

// Direct entry and tracker ingestion share this contract. Billing Review has
// its own explicit amount-override workflow for historical corrections.
const validateTransactionPrice = transaction => {
   const values = {};
   for (const key of ['quantity', 'unitCost', 'totalTransaction']) {
      const value = transaction[key];
      const n = Number(value);
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(n) || n < 0 || n > 99999999.99) {
         throw new Error(`${key} must be a finite nonnegative number within the supported range.`);
      }
      if (Math.abs(n * 100 - Math.round(n * 100)) > 0.000001) throw new Error(`${key} supports at most two decimal places.`);
      values[key] = n;
   }
   if (normalizeTransactionType(transaction.transactionType) === 'Time') {
      // Decimal-hour direct entries (including existing quarter-hour work)
      // need not have come from a duration calculator. Apply six-minute
      // rounding only when a duration is supplied, as tracker ingestion does.
      if (transaction.minutes != null && transaction.minutes !== '') {
         const minutes = Number(transaction.minutes);
         if (!Number.isFinite(minutes) || minutes < 0 || Math.abs(Math.ceil(minutes / 6) / 10 - values.quantity) > 0.000001) {
            throw new Error('Time quantity must match the duration rounded up to six-minute increments.');
         }
      }
   }
   // Both factors have two decimals; multiply integer hundredths before
   // rounding, matching tracker pricing and avoiding binary half-cent drift.
   const total = Math.round(Math.round(values.quantity * 100) * Math.round(values.unitCost * 100) / 100) / 100;
   if (Math.abs(total - values.totalTransaction) > 0.000001) throw new Error('Transaction total must equal quantity times rate rounded to cents.');
   return { ...transaction, ...values, totalTransaction: total };
};

module.exports = { validateTransactionPrice };
