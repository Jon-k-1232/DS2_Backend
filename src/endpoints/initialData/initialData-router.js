const express = require('express');
const { enforceAccountId } = require('../auth/account-scope');
const initialDataRouter = express.Router();
initialDataRouter.param('accountID', enforceAccountId);
const customerService = require('../customer/customer-service');
const invoiceService = require('../invoice/invoice-service');
const transactionsService = require('../transactions/transactions-service');
const jobService = require('../job/job-service');
const recurringCustomerService = require('../recurringCustomer/recurringCustomer-service');
const retainerService = require('../retainer/retainer-service');
const accountUserService = require('../user/user-service');
const jobCategoriesService = require('../jobCategories/jobCategories-service');
const jobTypeService = require('../jobType/jobType-service');
const writeOffsService = require('../writeOffs/writeOffs-service');
const paymentsService = require('../payments/payments-service');
const workDescriptionService = require('../workDescriptions/workDescriptions-service');
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
const { getPaginationMetadata } = require('../../utils/pagination');
const DEFAULT_TRANSACTIONS_PAGE_SIZE = 20;

// Initial data object on app load
initialDataRouter.route('/initialBlob/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      await initialData(db, res, accountID);
   } catch (err) {
      console.log(err);
      res.send({
         message: err.message || 'An error occurred while retrieving the initial data.',
         status: 500
      });
   }
});

module.exports = initialDataRouter;

const initialData = async (db, res, accountID) => {
   const [
      activeCustomers,
      activeRecurringCustomers,
      activeUsers,
      activeTransactionsPage,
      activeInvoicesPage,
      activeJobs,
      activeJobCategories,
      jobTypesData,
      activeWriteOffsPage,
      activePaymentsPage,
      activeRetainers,
      workDescriptions
   ] = await Promise.all([
      customerService.getActiveCustomers(db, accountID),
      recurringCustomerService.getActiveRecurringCustomers(db, accountID),
      accountUserService.getActiveAccountUsers(db, accountID),
      transactionsService.getActiveTransactionsPaginated(db, accountID, {
         limit: DEFAULT_TRANSACTIONS_PAGE_SIZE,
         offset: 0,
         searchTerm: ''
      }),
      // First page only. The full table (parents + every payment/write-off
      // snapshot, growing monotonically under the rolling-balance model) was
      // serialized three ways into every app load; the Invoices grid pages and
      // searches server-side anyway (fetchInvoices → getInvoicesPaginated).
      invoiceService.getInvoicesPaginated(db, accountID, {
         limit: DEFAULT_TRANSACTIONS_PAGE_SIZE,
         offset: 0,
         searchTerm: ''
      }),
      jobService.getActiveJobs(db, accountID),
      jobCategoriesService.getActiveJobCategories(db, accountID),
      jobTypeService.getActiveJobTypes(db, accountID),
      writeOffsService.getActiveWriteOffsPaginated(db, accountID, {
         limit: DEFAULT_TRANSACTIONS_PAGE_SIZE,
         offset: 0,
         searchTerm: ''
      }),
      paymentsService.getActivePaymentsPaginated(db, accountID, {
         limit: DEFAULT_TRANSACTIONS_PAGE_SIZE,
         offset: 0,
         searchTerm: ''
      }),
      retainerService.getActiveRetainers(db, accountID),
      workDescriptionService.getActiveWorkDescriptions(db, accountID)
   ]);

   const activeCustomerData = {
      activeCustomers,
      grid: createGrid(activeCustomers)
   };

   const activeRecurringCustomersData = {
      activeRecurringCustomers,
      grid: createGrid(activeRecurringCustomers)
   };

   const activeUserData = {
      activeUsers,
      grid: createGrid(activeUsers)
   };

   const { transactions: activeTransactions, totalCount: transactionsCount } = activeTransactionsPage;

   const activeTransactionsData = {
      activeTransactions,
      grid: createGrid(activeTransactions),
      pagination: getPaginationMetadata(transactionsCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const { invoices: activeInvoices, totalCount: invoicesCount } = activeInvoicesPage;
   const activeInvoiceData = {
      activeInvoices,
      grid: createGrid(activeInvoices),
      treeGrid: generateTreeGridData(activeInvoices, 'customer_invoice_id', 'parent_invoice_id'),
      pagination: getPaginationMetadata(invoicesCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const activeJobData = {
      activeJobs,
      grid: createGrid(activeJobs),
      treeGrid: generateTreeGridData(activeJobs, 'customer_job_id', 'parent_job_id')
   };

   const activeJobCategoriesData = {
      activeJobCategories,
      grid: createGrid(activeJobCategories)
   };

   const activeJobTypesData = {
      jobTypesData,
      grid: createGrid(jobTypesData)
   };

   const { writeoffs: activeWriteOffs, totalCount: writeoffsCount } = activeWriteOffsPage;
   const activeWriteOffsData = {
      activeWriteOffs,
      grid: createGrid(activeWriteOffs),
      pagination: getPaginationMetadata(writeoffsCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const { payments: activePayments, totalCount: paymentsCount } = activePaymentsPage;
   const activePaymentsData = {
      activePayments,
      grid: createGrid(activePayments),
      pagination: getPaginationMetadata(paymentsCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const activeRetainerData = {
      activeRetainers,
      grid: createGrid(activeRetainers),
      treeGrid: generateTreeGridData(activeRetainers, 'retainer_id', 'parent_retainer_id')
   };

   const activeWorkDescriptionsData = {
      workDescriptions,
      grid: createGrid(workDescriptions)
   };

   res.send({
      customersList: { activeCustomerData },
      recurringCustomersList: { activeRecurringCustomersData },
      teamMembersList: { activeUserData },
      transactionsList: { activeTransactionsData },
      invoicesList: { activeInvoiceData },
      accountJobsList: { activeJobData },
      jobCategoriesList: { activeJobCategoriesData },
      jobTypesList: { activeJobTypesData },
      writeOffsList: { activeWriteOffsData },
      paymentsList: { activePaymentsData },
      accountRetainersList: { activeRetainerData },
      workDescriptionsList: { activeWorkDescriptionsData },
      message: 'Successfully Retrieved Data.',
      status: 200
   });
};
