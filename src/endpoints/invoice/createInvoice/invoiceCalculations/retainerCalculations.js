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
   return hideRetainers ? { retainerTotal: 0, retainerRecords: [] } : { retainerTotal, retainerRecords };
};

module.exports = { groupAndTotalRetainers };

/**
 * Group retainers by parent_retainer_id. return the oldest record for the cycle.
 * @param {*} customerRetainerRecords
 * @returns
 */
const groupRetainersByParent = customerRetainerRecords => {
   const map = customerRetainerRecords.reduce((acc, retainerRecord) => {
      const parentRetainerID = retainerRecord.parent_retainer_id || retainerRecord.retainer_id;
      if (!acc[parentRetainerID]) acc[parentRetainerID] = retainerRecord;

      // If the acc record is older than the current disregard the current.
      if (new Date(acc[parentRetainerID].created_at) < new Date(retainerRecord.created_at)) return acc;

      acc[parentRetainerID] = retainerRecord;
      return acc;
   }, {});
   return Object.values(map);
};
