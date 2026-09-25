const groupAndTotalRetainers = (customer_id, invoiceQueryData, hideRetainers) => {
   const customerRetainerRecords = invoiceQueryData.customerRetainers[customer_id] || [];
   const retainerRecords = groupRetainersByParent(customerRetainerRecords);

   const retainerTotal = customerRetainerRecords ? retainerRecords.reduce((acc, retainerRecord) => acc + Number(retainerRecord.current_amount), 0) : 0;

   if (isNaN(retainerTotal)) {
      console.log(`Retainer Total on customerID:${customer_id} is NaN`);
      throw new Error(`Retainer Total on customerID:${customer_id} is NaN`);
   }
   if (retainerTotal === null || retainerTotal === undefined) {
      console.log(`Retainer Total on customerID:${customer_id} is null or undefined`);
      throw new Error(`Retainer Total on customerID:${customer_id} is null or undefined`);
   }
   if (typeof retainerTotal !== 'number') {
      console.log(`Retainer Total on customerID:${customer_id} is not a number`);
      throw new Error(`Retainer Total on customerID:${customer_id} is not a number`);
   }
   return hideRetainers ? { retainerTotal: 0, retainerRecords: [], events: [] } : { retainerTotal, retainerRecords, events: invoiceQueryData.customerRetainerEvents?.[customer_id] || [] };
};

module.exports = { groupAndTotalRetainers };

/**
 * "candidate was written after existing" with Postgres' own ordering
 * (created_at, retainer_id). Rows read through invoice-service carry
 * `created_at_exact` (the timestamp as text, microsecond precision); the text
 * form compares correctly as a string. A JS Date keeps only milliseconds, so
 * two snapshots written within one millisecond (a draw and its re-price) tied
 * and the FIRST one won, printing a stale retainer balance and storing it as
 * total_retainers. Rows without the exact text fall back to ms, then id.
 */
const writtenAfter = (candidate, existing) => {
   if (!existing) return true;
   if (candidate.created_at_exact && existing.created_at_exact) {
      if (candidate.created_at_exact !== existing.created_at_exact) return candidate.created_at_exact > existing.created_at_exact;
   } else {
      const candidateMs = new Date(candidate.created_at).getTime();
      const existingMs = new Date(existing.created_at).getTime();
      if (candidateMs !== existingMs) return candidateMs > existingMs;
   }
   return Number(candidate.retainer_id) > Number(existing.retainer_id);
};

/**
 * One record per retainer chain: the LATEST snapshot (current balance), active
 * chains with a non-zero balance only. The previous version kept the OLDEST row
 * (the original starting amount), so an exhausted or partly drawn retainer kept
 * printing its full original balance on every statement.
 * @param {*} customerRetainerRecords
 * @returns
 */
const groupRetainersByParent = customerRetainerRecords => {
   const map = customerRetainerRecords.reduce((acc, retainerRecord) => {
      const parentRetainerID = retainerRecord.parent_retainer_id || retainerRecord.retainer_id;
      if (writtenAfter(retainerRecord, acc[parentRetainerID])) acc[parentRetainerID] = retainerRecord;
      return acc;
   }, {});
   return Object.values(map).filter(record => record.is_retainer_active !== false && Number(record.current_amount) !== 0);
};
