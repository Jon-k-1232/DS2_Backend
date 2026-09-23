/**
 * Minimal reference rows every customer_invoices/customer_payments/customer_transactions/
 * customer_writeoffs fixture needs to satisfy FK constraints, for a throwaway ledger database
 * built from migrations/schema-snapshot-2026-09-22.sql. Returns the ids inserted so a spec can
 * build invoice/payment/transaction/write-off rows on top of them.
 */
const seedReferenceData = async (db, { accountId = 1, customerIds = [1, 2] } = {}) => {
   await db('accounts').insert({ account_id: accountId, account_name: 'Test Account', account_type: 'tax', is_account_active: true });
   await db('users').insert({ user_id: 1, account_id: accountId, email: 'tester@test.local', display_name: 'Test User', job_title: 'Admin', access_level: 'admin' });
   await db('customer_general_work_descriptions').insert({
      general_work_description_id: 1,
      account_id: accountId,
      general_work_description: 'General',
      estimated_time: 60,
      is_general_work_description_active: true,
      created_by_user_id: 1
   });
   for (const customerId of customerIds) {
      await db('customers').insert({
         customer_id: customerId,
         account_id: accountId,
         customer_name: `Customer ${customerId}`,
         display_name: `Customer ${customerId}`,
         is_commercial_customer: false,
         is_customer_active: true,
         is_billable: true,
         is_recurring: false
      });
      await db('customer_information').insert({
         customer_info_id: customerId,
         account_id: accountId,
         customer_id: customerId,
         is_this_address_active: true,
         is_customer_physical_address: true,
         is_customer_billing_address: true,
         is_customer_mailing_address: true,
         created_by_user_id: 1
      });
   }
   return { accountId, userId: 1, gwdId: 1, customerInfoIdByCustomer: Object.fromEntries(customerIds.map(id => [id, id])) };
};

/** Common defaults for a customer_invoices row (parent or child) on top of seedReferenceData. */
const invoiceDefaults = (ref, customerId, overrides = {}) =>
   Object.assign(
      {
         account_id: ref.accountId,
         customer_id: customerId,
         customer_info_id: ref.customerInfoIdByCustomer[customerId],
         created_by_user_id: ref.userId,
         invoice_date: '2026-01-01',
         due_date: '2026-01-17',
         beginning_balance: 0,
         total_payments: 0,
         total_charges: 0,
         total_write_offs: 0,
         total_retainers: 0,
         total_amount_due: 0,
         is_invoice_paid_in_full: false
      },
      overrides
   );

const paymentDefaults = (ref, customerId, overrides = {}) =>
   Object.assign(
      {
         account_id: ref.accountId,
         customer_id: customerId,
         created_by_user_id: ref.userId,
         payment_date: '2026-01-01',
         form_of_payment: 'Check'
      },
      overrides
   );

const transactionDefaults = (ref, customerId, overrides = {}) =>
   Object.assign(
      {
         account_id: ref.accountId,
         customer_id: customerId,
         logged_for_user_id: ref.userId,
         created_by_user_id: ref.userId,
         general_work_description_id: ref.gwdId,
         transaction_date: '2026-01-01',
         unit_cost: 0,
         total_transaction: 0,
         is_transaction_billable: true,
         is_excess_to_subscription: false
      },
      overrides
   );

const writeoffDefaults = (ref, customerId, overrides = {}) =>
   Object.assign(
      {
         account_id: ref.accountId,
         customer_id: customerId,
         created_by_user_id: ref.userId,
         writeoff_date: '2026-01-01',
         transaction_type: 'Write Off',
         writeoff_reason: 'Other'
      },
      overrides
   );

module.exports = { seedReferenceData, invoiceDefaults, paymentDefaults, transactionDefaults, writeoffDefaults };
