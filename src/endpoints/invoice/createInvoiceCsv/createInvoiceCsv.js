/**
 * Create Csv Data
 * @param {*} invoicesWithDetail
 * @return {Buffer} Buffer containing the CSV data
 */
const createCsvData = invoicesWithDetail => {
   const csvData = convertToCSV(invoicesWithDetail);
   const buffer = Buffer.from(csvData);

   return {
      buffer,
      metadata: { type: 'csv', displayName: 'Monthly_CSV_Report' }
   };
};

/**
 * Create Rows and Columns
 * @param {*} invoicesWithDetail
 * @returns {string} CSV data as a string
 */
const convertToCSV = invoicesWithDetail => {
   const headers = [
      'Customer ID',
      'Customer Name',
      'Beginning Balance',
      'Payment Total',
      'Transactions Total',
      'Write Off Total',
      'Retainer Total',
      'Invoice Total',
      'Hold',
      'Send',
      'Mail',
      'Email',
      'Add Note To Invoice',
      'Adjustment Amount',
      'Adjustment Reason'
   ];

   const rows = invoicesWithDetail.map(customer => [
      customer.customer_id,
      customer.customerContactInformation.display_name.replace(/,/g, ''),
      customer.outstandingInvoices.outstandingInvoiceTotal,
      customer.payments.paymentTotal,
      customer.transactions.transactionsTotal,
      customer.writeOffs.writeOffTotal,
      customer.retainers.retainerTotal,
      customer.invoiceTotal
   ]);

   rows.unshift(headers);
   const csvRows = rows.map(row => row.join(','));
   return csvRows.join('\n');
};

module.exports = { createCsvData };
