const groupAndTotalWriteOffs = (customer_id, invoiceQueryData, showWriteOffs) => {
   // Fetch the transactions and write-offs related to the customer_id
   const customerWriteOffRecords = invoiceQueryData.customerWriteOffs[customer_id] || [];
   const customerTransactions = invoiceQueryData.customerTransactions[customer_id] || [];
   const lastBillDate = invoiceQueryData.lastInvoiceDateByCustomerID?.[customer_id] || null;

   // Filter write-offs by customer_invoice_id and customer_job_id
   const writeOffsByInvoice = customerWriteOffRecords.filter(writeOff => writeOff.customer_invoice_id);

   // Override showWriteOffs to true if transactions are empty but invoice-linked write-offs exist.
   // Job-only write-offs are excluded from this override — they were already consumed as billing
   // adjustments when the original invoice amount was set, so showing them here creates a phantom credit.
   if (!showWriteOffs && !customerTransactions.length && writeOffsByInvoice.length) {
      showWriteOffs = true;
   }
   const writeOffsByJob = customerWriteOffRecords.filter(writeOff => writeOff.customer_job_id);

   // SINGLE-COUNT RULE. A write-off linked to the CURRENT chain already reduced
   // the outstanding remaining when its snapshot was created — counting it in
   // the total again would credit the customer twice. Only write-offs whose
   // chain was absorbed by the last bill (root invoice_date < lastBillDate)
   // act as next-bill credits, because the date gate hides their snapshot.
   const isAbsorbedChainCredit = writeOff => {
      if (!writeOff.customer_invoice_id) return true; // job-level: not chain-linked
      if (!lastBillDate || !writeOff.linked_chain_invoice_date) return true;
      return new Date(writeOff.linked_chain_invoice_date) < new Date(lastBillDate);
   };

   // Calculate the write-off total (engine math — excludes current-chain
   // write-offs already reflected in the outstanding balance)
   const writeOffTotal = showWriteOffs
      ? customerWriteOffRecords.filter(isAbsorbedChainCredit).reduce((acc, writeOffRecord) => acc + Number(writeOffRecord.writeoff_amount), 0)
      : writeOffsByInvoice.filter(isAbsorbedChainCredit).reduce((acc, writeOffRecord) => acc + Number(writeOffRecord.writeoff_amount), 0);

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

   // Return the final object based on the value of showWriteOffs.
   // writeOffsListedTotal sums the records the bill actually lists so the
   // printed total always matches the printed rows (current-chain write-offs
   // are listed but excluded from the engine total above).
   if (!showWriteOffs) {
      const writeOffsListedTotal = writeOffsByInvoice.reduce((acc, writeOffRecord) => acc + Number(writeOffRecord.writeoff_amount), 0);
      return { writeOffTotal, writeOffsListedTotal, writeOffRecords: writeOffsByInvoice, allWriteOffRecords: writeOffsByJob };
   }

   const writeOffsListedTotal = customerWriteOffRecords.reduce((acc, writeOffRecord) => acc + Number(writeOffRecord.writeoff_amount), 0);
   return { writeOffTotal, writeOffsListedTotal, writeOffRecords: customerWriteOffRecords, allWriteOffRecords: customerWriteOffRecords };
};

module.exports = { groupAndTotalWriteOffs };
