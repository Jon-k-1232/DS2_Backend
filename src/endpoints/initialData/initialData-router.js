const express = require('express');
const { enforceAccountId, PRIVILEGED_ROLES } = require('../auth/account-scope');
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
const { getPaginationMetadata } = require('../../utils/pagination');
const DEFAULT_TRANSACTIONS_PAGE_SIZE = 20;

// Initial data object on app load
initialDataRouter.route('/initialBlob/:accountID/:userID').get(async (req, res) => {
   const db = req.app.get('db');
   const { accountID } = req.params;

   try {
      await initialData(db, res, accountID, req.user);
   } catch (err) {
      console.log(err);
      res.status(500).send({
         message: err.message || 'An error occurred while retrieving the initial data.',
         status: 500
      });
   }
});

module.exports = initialDataRouter;

const isPrivilegedCaller = requestingUser => PRIVILEGED_ROLES.includes((requestingUser?.access_level || '').toLowerCase());

const initialData = async (db, res, accountID, requestingUser) => {
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
   ] = isPrivilegedCaller(requestingUser) ? await Promise.all([
      customerService.getCustomerDirectory(db, accountID),
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
      Promise.resolve([]),
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
      retainerService.getActiveRetainers(db, accountID).limit(20),
      workDescriptionService.getActiveWorkDescriptions(db, accountID)
   ]) : [
      // Staff upload/history uses dedicated self-scoped endpoints. Keep shell
      // keys stable without querying contacts, master data or any ledger.
      [], [], [{ user_id: requestingUser.user_id, display_name: requestingUser.display_name }],
      { transactions: [], totalCount: 0 }, { invoices: [], totalCount: 0 },
      [], [], [], { writeoffs: [], totalCount: 0 }, { payments: [], totalCount: 0 }, [], []
   ];

   const activeCustomerData = Array.isArray(activeCustomers) ? {activeCustomers,remote:false,threshold:1000,totalCount:0} : activeCustomers;

   const activeRecurringCustomersData = {
      activeRecurringCustomers,
   };

   const sanitizedActiveUsers = activeUsers;
   const activeUserData = {
      activeUsers: sanitizedActiveUsers,
   };

   const { transactions: activeTransactions, totalCount: transactionsCount } = activeTransactionsPage;

   const activeTransactionsData = {
      activeTransactions,
      pagination: getPaginationMetadata(transactionsCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const { invoices: activeInvoices, totalCount: invoicesCount } = activeInvoicesPage;
   // No treeGrid here: a tree built from one page promotes children whose
   // parents fell outside the page to fake roots, and nothing renders the
   // blob's invoice treeGrid anyway (the Invoices grid reads .grid and pages
   // server-side; per-customer trees come from the profile endpoint).
   const activeInvoiceData = {
      activeInvoices,
      pagination: getPaginationMetadata(invoicesCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const activeJobData = {
      activeJobs,
   };

   const activeJobCategoriesData = {
      activeJobCategories,
   };

   const activeJobTypesData = {
      jobTypesData,
   };

   const { writeoffs: activeWriteOffs, totalCount: writeoffsCount } = activeWriteOffsPage;
   const activeWriteOffsData = {
      activeWriteOffs,
      pagination: getPaginationMetadata(writeoffsCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const { payments: activePayments, totalCount: paymentsCount } = activePaymentsPage;
   const activePaymentsData = {
      activePayments,
      pagination: getPaginationMetadata(paymentsCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const activeRetainerData = {
      activeRetainers,
   };

   const activeWorkDescriptionsData = {
      workDescriptions,
   };

   res.send(require('../../utils/listPayload').compactPayload({
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
   }));
};
