'use strict';
const { scheduledAutomationsEnabled } = require('../../utils/environmentSwitches');
const { asSystem, storage } = require('../../utils/auditContext');
const service = require('../../endpoints/recurringCustomer/recurring-billing');
async function prepareRecurring(db) {
  if (!scheduledAutomationsEnabled()) return [];
  const accounts = await db('public.recurring_customers').distinct('account_id').where({ is_recurring_customer_active: true });
  const results = [];
  for (const { account_id: accountId } of accounts) {
    try {
      const result = await storage.run({ accountId, correlationId: require('crypto').randomUUID() }, () => asSystem('automation/recurring/scheduler', () => db.transaction(async trx => {
        await require('../../endpoints/billingEntities/entities-service').lockAccount(trx, accountId, null, 'Scheduled recurring fee preparation');
        return service.prepareInside(trx, { accountId, body: {}, source: 'scheduler' });
      })));
      results.push({ accountId, generated: result.generated, remaining: result.remaining, catchUpRequired: result.catchUpRequired });
    } catch (error) { console.error('Recurring preparation failed for account', accountId, error.message); results.push({ accountId, error: error.message }); }
  }
  return results;
}
module.exports = { prepareRecurring };
