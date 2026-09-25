const { uniqueName } = require('./_http');
const { restoreDataTypesTransactionsTableOnCreate } = require('../../src/endpoints/transactions/transactionsObjects');

module.exports = h => {
   const customers = [];
   const insert = async (table, fields) => (await h.db(table).insert({ ...fields, account_id: 9001 }).returning('*'))[0];
   const customer = async (fields = {}) => {
      const name = uniqueName('F8-F22');
      const c = await insert('customers', { customer_name: name, display_name: name, is_commercial_customer: false, is_customer_active: true, is_billable: true, is_recurring: false, ...fields });
      customers.push(c.customer_id);
      const info = await insert('customer_information', { customer_id: c.customer_id, customer_state: 'AZ', is_customer_physical_address: false, is_customer_billing_address: false, is_this_address_active: true, is_customer_mailing_address: true, created_by_user_id: 90013 });
      return { ...c, customer_info_id: info.customer_info_id };
   };
   const job = (c, fields = {}) => insert('customer_jobs', { customer_id: c.customer_id, job_type_id: 900201, job_quote_amount: 0, agreed_job_amount: 0, current_job_total: 0, is_job_complete: false, is_quote: false, created_by_user_id: 90013, ...fields });
   const body = (c, j, fields = {}) => ({ accountID: 9001, customerID: c.customer_id, customerJobID: j.customer_job_id,
      loggedForUserID: 90011, loggedByUserID: 90013, selectedGeneralWorkDescriptionID: 90031, transactionType: 'Time',
      transactionDate: '2026-09-01', quantity: 1, unitCost: 100, totalTransaction: 100, isTransactionBillable: true, ...fields });
   const transaction = (c, j, fields = {}) => insert('customer_transactions', restoreDataTypesTransactionsTableOnCreate(body(c, j, fields)));
   const cleanup = async () => {
      await require('./_sent-fixture').unseal(h.db,9001,customers);
      const tids = (await h.db('customer_transactions').where({ account_id: 9001 }).whereIn('customer_id', customers)).map(r => r.transaction_id);
      for (const table of ['ai_reviewer_corrections', 'ai_category_training_examples']) await h.db(table).where({ account_id: 9001 }).whereIn('transaction_id', tids).del();
      for (const table of ['customer_payments', 'customer_writeoffs', 'customer_transactions', 'customer_invoices', 'customer_retainers_and_prepayments', 'recurring_customers', 'customer_jobs', 'customer_information', 'customers']) {
         await h.db(table).where({ account_id: 9001 }).whereIn('customer_id', customers).del();
      }
   };
   return { insert, customer, job, body, transaction, cleanup };
};
