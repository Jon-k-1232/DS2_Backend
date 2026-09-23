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
const { createGrid, generateTreeGridData } = require('../../utils/gridFunctions');
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
      res.send({
         message: err.message || 'An error occurred while retrieving the initial data.',
         status: 500
      });
   }
});

module.exports = initialDataRouter;

// Fields on a `users` row that are compensation/contact detail rather than
// directory info. A "User" role has no business reading a coworker's pay
// rates (or resolving their email for phishing/spam purposes) just because
// initialData returns the whole account's team roster for dropdowns.
const SENSITIVE_USER_FIELDS = ['cost_rate', 'billing_rate', 'email'];

const isPrivilegedCaller = requestingUser => {
   const role = (requestingUser?.access_level || '').toLowerCase();
   return PRIVILEGED_ROLES.includes(role);
};

// Strips compensation/contact fields for non-privileged callers WITHOUT
// changing the payload shape: activeUsers stays an array of the same objects
// with the same set of privileged-only keys present-or-absent consistently,
// so `createGrid`'s "columns from Object.keys(data[0])" still works — a
// non-privileged response just renders those columns without data instead of
// leaking every teammate's pay rate and email to anyone logged in.
const sanitizeUsersForCaller = (users, requestingUser) => {
   if (isPrivilegedCaller(requestingUser)) return users;
   return users.map(user => {
      const sanitized = { ...user };
      SENSITIVE_USER_FIELDS.forEach(field => delete sanitized[field]);
      return sanitized;
   });
};

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

   const sanitizedActiveUsers = sanitizeUsersForCaller(activeUsers, requestingUser);
   const activeUserData = {
      activeUsers: sanitizedActiveUsers,
      grid: createGrid(sanitizedActiveUsers)
   };

   const { transactions: activeTransactions, totalCount: transactionsCount } = activeTransactionsPage;

   const activeTransactionsData = {
      activeTransactions,
      grid: createGrid(activeTransactions),
      pagination: getPaginationMetadata(transactionsCount, 1, DEFAULT_TRANSACTIONS_PAGE_SIZE)
   };

   const { invoices: activeInvoices, totalCount: invoicesCount } = activeInvoicesPage;
   // No treeGrid here: a tree built from one page promotes children whose
   // parents fell outside the page to fake roots, and nothing renders the
   // blob's invoice treeGrid anyway (the Invoices grid reads .grid and pages
   // server-side; per-customer trees come from the profile endpoint).
   const activeInvoiceData = {
      activeInvoices,
      grid: createGrid(activeInvoices),
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
