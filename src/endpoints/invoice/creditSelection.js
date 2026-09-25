'use strict';
const { ruleError } = require('../payments/ledger-helpers');
const { reason } = require('../../utils/ledgerAction');
// Validate before sanitization/coercion, so strings and objects cannot opt in.
function validateSelection(configuration) {
   if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw ruleError('Invalid invoice configuration.', 400);
   const rows = configuration.invoicesToCreate;
   if (!Array.isArray(rows) || !rows.length) throw ruleError('Select at least one customer to invoice.', 400);
   const ids = rows.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
         !['number','string'].includes(typeof row.customer_id) || !/^[1-9]\d*$/.test(String(row.customer_id)) || Number(row.customer_id) > 2147483647) throw ruleError('Invalid customer selection.', 400);
      if (row.includeCreditStatement !== undefined && typeof row.includeCreditStatement !== 'boolean') throw ruleError('includeCreditStatement must be a boolean.', 400);
      if (row.issueReason !== undefined) reason(row.issueReason);
      return Number(row.customer_id);
   });
   if (new Set(ids).size !== ids.length) throw ruleError('A customer was selected more than once; select each customer once.', 400);
   const settings = configuration.invoiceCreationSettings;
   if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings))) throw ruleError('Invalid invoice creation settings.', 400);
   for (const field of ['isFinalized', 'isRoughDraft', 'isCsvOnly', 'allowSameDayRebill']) {
      if (settings?.[field] !== undefined && typeof settings[field] !== 'boolean') throw ruleError(`${field} must be a boolean.`, 400);
   }
   return ids;
}
module.exports = { validateSelection };
