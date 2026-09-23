/**
 * Internal customers = the firm's own entities (prod: 5 "James F Kimmel &
 * Associates", 6 "Kimmel Financial Partners"). Staff log internal time (admin,
 * email, CPE, staff meetings) with Company Name = the firm itself; those rows
 * were auto-inserted as BILLABLE, parking ~$1.43M of "billable" work on the
 * firm's own customers at the top of Create Invoice. Every auto-inserted or
 * manually applied transaction for an internal customer must be written with
 * is_transaction_billable = false (hours are still recorded for analytics).
 *
 * A customer is internal when:
 *   (a) its id is listed in INTERNAL_CUSTOMER_IDS (comma-separated, default empty), or
 *   (b) its display_name / business_name equals — case / punctuation / word-order /
 *       legal-suffix insensitive — the account's account_name, or an ESTABLISHED
 *       tracker Entity value: one used by at least INTERNAL_ENTITY_MIN_EMPLOYEES
 *       (default 2) distinct employees. The Entity column names the employer
 *       (JFK&A / KFA, 13 employees each in prod); the threshold stops a single
 *       person's typo (a client typed into Entity — "LTDFH III, LLC",
 *       "Jim Kimmel Insurance Agency, Inc.", both one employee) from making a
 *       paying client non-billable.
 *
 * "Kimmel Financial Partners" (6) does not share a name with any entity, so it
 * is covered by INTERNAL_CUSTOMER_IDS, not by rule (b).
 */
const { canonicalNameKey } = require('../../utils/fuzzyMatch');

const DEFAULT_MIN_ENTITY_EMPLOYEES = 2;

const parseInternalCustomerIds = value =>
   new Set(
      String(value == null ? '' : value)
         .split(',')
         .map(part => Number(part.trim()))
         .filter(id => Number.isInteger(id) && id > 0)
   );

const _minEntityEmployees = () => {
   const configured = Number(process.env.INTERNAL_ENTITY_MIN_EMPLOYEES);
   return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MIN_ENTITY_EMPLOYEES;
};

/**
 * Pure resolver.
 * @param {{ customers: Array<{customer_id, display_name?, business_name?}>, accountName?: string,
 *           entityUsage?: Array<{entity: string, employees: number|string}>, envIds?: Set<number>, minEmployees?: number }} args
 * @returns {Set<number>} internal customer ids
 */
const resolveInternalCustomerIds = ({ customers = [], accountName = null, entityUsage = [], envIds = new Set(), minEmployees = _minEntityEmployees() }) => {
   const internalKeys = new Set();
   const accountKey = canonicalNameKey(accountName);
   if (accountKey) internalKeys.add(accountKey);
   for (const usage of entityUsage || []) {
      if (Number(usage.employees) < minEmployees) continue;
      const key = canonicalNameKey(usage.entity);
      if (key) internalKeys.add(key);
   }

   const ids = new Set([...envIds].map(Number));
   for (const customer of customers || []) {
      if (!customer) continue;
      const matches = [customer.display_name, customer.business_name].some(name => {
         const key = canonicalNameKey(name);
         return key !== '' && internalKeys.has(key);
      });
      if (matches) ids.add(Number(customer.customer_id));
   }
   return ids;
};

/**
 * @param {*} db knex (or transaction)
 * @param {number} accountId
 * @param {{ customers?: Array, envValue?: string }} [options] pass `customers` to reuse an already-loaded catalog
 * @returns {Promise<Set<number>>}
 */
const loadInternalCustomerIds = async (db, accountId, { customers = null, envValue = process.env.INTERNAL_CUSTOMER_IDS } = {}) => {
   const [account, entityUsage, customerRows] = await Promise.all([
      db('accounts').where({ account_id: accountId }).select('account_name').first(),
      db('timesheet_entries')
         .where({ account_id: accountId, is_deleted: false })
         .whereNotNull('entity')
         .groupBy('entity')
         .select('entity')
         .countDistinct({ employees: 'user_id' }),
      customers ? Promise.resolve(customers) : db('customers').where({ account_id: accountId }).select('customer_id', 'display_name', 'business_name')
   ]);
   return resolveInternalCustomerIds({
      customers: customerRows,
      accountName: account ? account.account_name : null,
      entityUsage,
      envIds: parseInternalCustomerIds(envValue)
   });
};

const isInternalCustomer = async (db, accountId, customerId, options = {}) =>
   customerId != null && (await loadInternalCustomerIds(db, accountId, options)).has(Number(customerId));

module.exports = { loadInternalCustomerIds, resolveInternalCustomerIds, parseInternalCustomerIds, isInternalCustomer, DEFAULT_MIN_ENTITY_EMPLOYEES };
