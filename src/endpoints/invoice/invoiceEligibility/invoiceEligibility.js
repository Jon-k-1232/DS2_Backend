const invoiceService = require('../invoice-service');
const customerService = require('../../customer/customer-service');
const transactionsService = require('../../transactions/transactions-service');
const retainerService = require('../../retainer/retainer-service');
const writeOffsService = require('../../writeOffs/writeOffs-service');
const { groupByFunction } = require('../sharedInvoiceFunctions');
const dayjs = require('dayjs');
const { billingDateToday } = require('../billingDate');
const paymentsService = require('../../payments/payments-service');

/**
 * Orchestrate the invoice eligibility page
 * @param {*} db
 * @param {*} accountID
 * @returns {}
 */
const findCustomersNeedingInvoices = async (db, accountID, today = billingDateToday()) => {
   const [customers, invoices, transactions, retainers, writeOffs, payments, events] = await fetchData(db, accountID);
   const [invoicesByCustomer, transactionsByCustomer, retainersByCustomer, writeOffsByCustomer, paymentsByCustomer, eventsByCustomer] = groupDataByCustomerId([invoices, transactions, retainers, writeOffs, payments, events]);
   return invoiceEligibilityPerCustomer(customers, invoicesByCustomer, transactionsByCustomer, retainersByCustomer, writeOffsByCustomer, paymentsByCustomer, today, eventsByCustomer);
};

module.exports = { findCustomersNeedingInvoices };

// Fetch all data needed for the invoice eligibility page
const fetchData = async (db, accountID) => {
   return Promise.all([
      customerService.getActiveCustomers(db, accountID),
      invoiceService.getInvoices(db, accountID),
      transactionsService.getActiveTransactions(db, accountID),
      retainerService.getActiveRetainers(db, accountID),
      writeOffsService.getActiveWriteOffs(db, accountID),
      paymentsService.getActivePayments(db, accountID),
      db('retainer_events as e').where('e.account_id',accountID).whereNotExists(db('customer_invoices as p').select(db.raw('1')).whereRaw('p.account_id=e.account_id AND p.customer_id=e.customer_id AND p.parent_invoice_id IS NULL AND p.created_at >= e.created_at'))
   ]);
};

// Group the data by customer_id
const groupDataByCustomerId = data => {
   return data.map(dataset => groupByFunction(dataset, 'customer_id'));
};

const isParent = invoice => invoice.parent_invoice_id === null || invoice.parent_invoice_id === undefined || Number(invoice.parent_invoice_id) === Number(invoice.customer_invoice_id);
const dateKey = value => dayjs(value).format('YYYY-MM-DD');
const byNewest = (a, b) => {
   const dateDiff = new Date(b.invoice_date) - new Date(a.invoice_date);
   if (dateDiff !== 0) return dateDiff;
   const createdDiff = new Date(b.created_at) - new Date(a.created_at);
   if (createdDiff !== 0) return createdDiff;
   return Number(b.customer_invoice_id) - Number(a.customer_invoice_id);
};

/**
 * Rolling-balance view of a customer's ledger for the Create Invoice grid.
 * Returns the newest parent statement(s), the outstanding amount the engine will
 * roll forward (latest snapshot of every chain dated on the newest statement date
 * — same-day duplicates are summed exactly like the engine does), and the
 * newest parent row itself.
 */
const currentChainsSummary = customerInvoices => {
   const parents = customerInvoices.filter(isParent).sort(byNewest);
   if (!parents.length) return { newestParent: null, currentParents: [], outstandingTotal: 0, outstandingRecords: [] };

   const newestParent = parents[0];
   const newestDate = dateKey(newestParent.invoice_date);
   const currentParents = parents.filter(parent => dateKey(parent.invoice_date) === newestDate);

   const outstandingRecords = currentParents
      .map(parent => {
         const chainRows = customerInvoices.filter(row => Number(row.customer_invoice_id) === Number(parent.customer_invoice_id) || Number(row.parent_invoice_id) === Number(parent.customer_invoice_id));
         // Latest snapshot carries the authoritative remaining (falls back to the parent row).
         return chainRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || Number(b.customer_invoice_id) - Number(a.customer_invoice_id))[0] || parent;
      })
      .filter(record => Number(record.remaining_balance_on_invoice) !== 0);

   const outstandingTotal = outstandingRecords.reduce((acc, record) => acc + Number(record.remaining_balance_on_invoice), 0);
   return { newestParent, currentParents, outstandingTotal, outstandingRecords };
};

const invoiceEligibilityPerCustomer = (customers, invoicesByCustomer, transactionsByCustomer, retainersByCustomer, writeOffsByCustomer, paymentsByCustomer, today = billingDateToday(), eventsByCustomer = {}) => {
   return customers
      .map(customer => {
         const { customer_id } = customer;
         const customerInvoices = invoicesByCustomer[customer_id] || [];
         const { newestParent, outstandingTotal, outstandingRecords } = currentChainsSummary(customerInvoices);
         const newestParentCreatedAt = newestParent ? new Date(newestParent.created_at) : null;

         // Unbilled work = every transaction not yet stamped with a statement,
         // through the billing date, with no lower bound — the SAME rule the billing engine uses
         // (getTransactionsByCustomerID). Filtering on transaction_date > the last
         // statement date hid back-dated or missed work for good: the engine would
         // have billed it, but the customer never appeared in this list.
         const customerTransactions = transactionsByCustomer[customer_id] || [];
         const unbilledTransactions = customerTransactions.filter(transaction => !transaction.customer_invoice_id && dateKey(transaction.transaction_date) <= today);

         const customerRetainers = retainersByCustomer[customer_id] || [];
         const customerActiveRetainers = customerRetainers.filter(retainer => Number(retainer.current_amount) < 0 && retainer.is_retainer_active !== false);

         // Write-offs entered since the newest statement act as credits on the next
         // one; older write-offs are already reflected in a prior statement.
         const customerWriteOffs = writeOffsByCustomer[customer_id] || [];
         const pendingWriteOffs = customerWriteOffs.filter(writeOff => Number(writeOff.writeoff_amount) < 0 && (!newestParentCreatedAt || new Date(writeOff.created_at) > newestParentCreatedAt));

         const customerPayments = paymentsByCustomer[customer_id] || [];
         const pendingPayments = customerPayments.filter(payment => !newestParentCreatedAt || new Date(payment.created_at) > newestParentCreatedAt);

         const hasOpenBalance = Math.abs(outstandingTotal) >= 0.005;
         if (!hasOpenBalance && !unbilledTransactions.length && !pendingWriteOffs.length && !pendingPayments.length && !(eventsByCustomer[customer_id] || []).length) {
            return null;
         }

         // Dollar totals — used by the frontend filter to hide zero-balance rows without
         // running the full invoice calculation for every customer.
         const billableTransactionsTotal = unbilledTransactions
            .filter(t => t.is_transaction_billable)
            .reduce((acc, t) => acc + Number(t.total_transaction || 0), 0);

         const billedToday = Boolean(newestParent) && dateKey(newestParent.invoice_date) === today;

         return {
            ...customer,
            retainer_count: customerActiveRetainers.length,
            retainer_event_count: (eventsByCustomer[customer_id] || []).length,
            transaction_count: unbilledTransactions.length,
            invoice_count: outstandingRecords.length,
            write_off_count: pendingWriteOffs.length,
            outstanding_invoice_total: Math.round(outstandingTotal * 100) / 100,
            billable_transactions_total: Math.round(billableTransactionsTotal * 100) / 100,
            last_invoice_number: newestParent ? newestParent.invoice_number : null,
            last_invoice_date: newestParent ? dateKey(newestParent.invoice_date) : null,
            // A statement was already finalized for this customer today. The Create
            // Invoice route skips these unless allowSameDayRebill is set; the grid
            // warns and excludes them from select-all.
            billed_today: billedToday
         };
      })
      .filter(Boolean); // Removes null entries
};

module.exports._invoiceEligibilityPerCustomer = invoiceEligibilityPerCustomer;
module.exports._currentChainsSummary = currentChainsSummary;
