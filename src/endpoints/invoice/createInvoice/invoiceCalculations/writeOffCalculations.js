const groupAndTotalWriteOffs = (customer_id, invoiceQueryData, showWriteOffs) => {
   // Fetch the transactions and write-offs related to the customer_id
   const customerWriteOffRecords = invoiceQueryData.customerWriteOffs[customer_id] || [];
   const customerTransactions = invoiceQueryData.customerTransactions[customer_id] || [];

   // Override showWriteOffs to true if transactions are empty but there are write-offs
   if (!showWriteOffs && !customerTransactions.length && customerWriteOffRecords.length) {
      showWriteOffs = true;
   }

   // Filter write-offs by customer_invoice_id and customer_job_id
   const writeOffsByInvoice = customerWriteOffRecords.filter(writeOff => writeOff.customer_invoice_id);
   const writeOffsByJob = customerWriteOffRecords.filter(writeOff => writeOff.customer_job_id);

   // Calculate the write-off total
   const writeOffTotal = showWriteOffs
      ? customerWriteOffRecords.reduce((acc, writeOffRecord) => acc + Number(writeOffRecord.writeoff_amount), 0)
      : writeOffsByInvoice.reduce((acc, writeOffRecord) => acc + Number(writeOffRecord.writeoff_amount), 0);

   // Validation checks
   if (isNaN(writeOffTotal)) {
      console.log(`Write Off Total on customerID:${customer_id} is NaN`);
      throw new Error(`Write Off Total on customerID:${customer_id} is NaN`);
   }
   if (writeOffTotal === null || writeOffTotal === undefined) {
      console.log(`Write Off Total on customerID:${customer_id} is null or undefined`);
      throw new Error(`Write Off Total on customerID:${customer_id} is null or undefined`);
   }
   if (typeof writeOffTotal !== 'number') {
      console.log(`Write Off Total on customerID:${customer_id} is not a number`);
      throw new Error(`Write Off Total on customerID:${customer_id} is not a number`);
   }

   // Return the final object based on the value of showWriteOffs
   if (!showWriteOffs) {
      return { writeOffTotal, writeOffRecords: writeOffsByInvoice, allWriteOffRecords: writeOffsByJob };
   }

   return { writeOffTotal, writeOffRecords: customerWriteOffRecords, allWriteOffRecords: customerWriteOffRecords };
};

module.exports = { groupAndTotalWriteOffs };
