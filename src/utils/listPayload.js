'use strict';
const { getPaginationMetadata } = require('./pagination');
const PAGE_SIZE = 20;
// One wire representation. Views are derived by the browser only when needed.
function compactPayload(value) {
   if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
   if (Array.isArray(value)) return value.map(compactPayload);
   return Object.fromEntries(Object.entries(value).filter(([key]) => !['grid','treeGrid'].includes(key)).map(([key,v]) => [key,compactPayload(v)]));
}
async function firstPage(db, accountId, kind) {
   const options = { limit: PAGE_SIZE, offset: 0, searchTerm: '', latest:true };
   const specs = {
      transactions: ['transactions/transactions-service','getActiveTransactionsPaginated','transactions','transactionsList','activeTransactionsData','activeTransactions'],
      payments: ['payments/payments-service','getActivePaymentsPaginated','payments','paymentsList','activePaymentsData','activePayments'],
      invoices: ['invoice/invoice-service','getInvoicesPaginated','invoices','invoicesList','activeInvoiceData','activeInvoices'],
      writeoffs: ['writeOffs/writeOffs-service','getActiveWriteOffsPaginated','writeoffs','writeOffsList','activeWriteOffsData','activeWriteOffs'],
      customers: ['customer/customer-service','getActiveCustomersPaginated','customers','customersList','activeCustomerData','activeCustomers'],
      jobs: ['job/job-service','getJobsPage','jobs','accountJobsList','activeJobData','activeJobs'],
      retainers: ['retainer/retainer-service','getRetainersPage','retainers','accountRetainersList','activeRetainerData','activeRetainers']
   };
   const [file, method, rows, list, data, key] = specs[kind];
   const result = await require('../endpoints/'+file)[method](db, accountId, options);
   return {[list]: {[data]: {[key]:result[rows], pagination:getPaginationMetadata(result.totalCount,1,PAGE_SIZE), partial:true}}};
}
async function firstPages(db, accountId, kinds) {
   return Object.assign({}, ...await Promise.all(kinds.map(kind=>firstPage(db,accountId,kind))));
}
module.exports={compactPayload,firstPage,firstPages,PAGE_SIZE};
