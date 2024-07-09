const groupAndTotalTransactionRetainerPayments = (customer_id, invoiceQueryData) => {
   const customerTransactions = invoiceQueryData.customerTransactions[customer_id] || [];
   const customerRetainerRecords = invoiceQueryData.customerRetainers[customer_id] || [];

   // Grouping by retainer_id and the value is the parent_retainer_id
   const retainerLookupMap = customerRetainerRecords.reduce((acc, retainer) => {
      acc[retainer.retainer_id] = retainer.parent_retainer_id || retainer.retainer_id;
      return acc;
   }, {});

   const groupedByRetainer = groupByRetainer(customerTransactions, retainerLookupMap);
   const transactionRetainerPaymentRecords = calculateGroupTotal(groupedByRetainer);
   const transactionRetainerPaymentTotal = transactionRetainerPaymentRecords.reduce((acc, group) => acc + -Math.abs(group.retainerTotal), 0);

   if (isNaN(transactionRetainerPaymentTotal)) {
      console.log(`Transaction Retainer Payment Total on customerID:${customer_id} is NaN`);
      throw new Error(`Transaction Retainer Payment Total on customerID:${customer_id} is NaN`);
   }
   if (transactionRetainerPaymentTotal === null || transactionRetainerPaymentTotal === undefined) {
      console.log(`Transaction Retainer Payment Total on customerID:${customer_id} is null or undefined`);
      throw new Error(`Transaction Retainer Payment Total on customerID:${customer_id} is null or undefined`);
   }
   if (typeof transactionRetainerPaymentTotal !== 'number') {
      console.log(`Transaction Retainer Payment Total on customerID:${customer_id} is not a number`);
      throw new Error(`Transaction Retainer Payment Total on customerID:${customer_id} is not a number`);
   }

   return { transactionRetainerPaymentTotal, transactionRetainerPaymentRecords };
};

const groupByRetainer = (transactions, retainerLookupMap) => {
   return transactions.reduce((acc, transaction) => {
      if (!transaction.retainer_id) return acc;

      // Find parent retainer id
      const parentRetainerID = retainerLookupMap[transaction.retainer_id] || transaction.retainer_id;

      if (!acc[parentRetainerID]) acc[parentRetainerID] = [];
      acc[parentRetainerID].push(transaction);
      return acc;
   }, {});
};

const calculateGroupTotal = groupedTransactions => {
   return Object.keys(groupedTransactions).map(retainerID => {
      const records = groupedTransactions[retainerID];
      const retainerTotal = records.reduce((acc, transaction) => acc + Number(transaction.total_transaction), 0);
      return {
         retainer_id: Number(retainerID),
         records,
         retainerTotal
      };
   });
};

module.exports = { groupAndTotalTransactionRetainerPayments };
