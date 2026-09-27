'use strict';
const { ruleError } = require('../payments/ledger-helpers');
const { reason, id } = require('../../utils/ledgerAction');

// Call inside the transaction which owns the tracker claim/reset. Corrections
// are audited with the authenticated actor, and roll back with a failed apply.
module.exports = async function reviewWorkProvenance(trx, accountId, entryId, { employeeId, minutes, costChangeReason } = {}) {
   const entry = await trx('timesheet_entries').where({ account_id: accountId, timesheet_entry_id: entryId }).forUpdate().first();
   if (!entry) throw ruleError('Tracker source was not found.', 404);
   const patch = {};
   if (employeeId != null) {
      employeeId = id(employeeId);
      const employee = await trx('users').where({ account_id: accountId, user_id: employeeId }).first();
      if (!employee) throw ruleError('Employee must belong to this account.', 400);
      const owners = entry.matched_user_id ? [{ user_id: entry.matched_user_id }] : await trx('users')
         .where({ account_id: accountId }).whereRaw('lower(btrim(display_name)) = lower(btrim(?))', [entry.employee_name || '']).select('user_id');
      if (owners.length === 1 && Number(owners[0].user_id) !== Number(employeeId)) {
         if (!costChangeReason) throw ruleError('Explain the employee change before applying this work.', 400);
         const why = reason(costChangeReason);
         await trx.raw("SELECT set_config('app.cost_change_reason', ?, true), set_config('app.audit_reason', ?, true), set_config('ds2.reason', ?, true)", [why, why, why]);
      }
      if (Number(entry.matched_user_id) !== Number(employeeId)) patch.matched_user_id = Number(employeeId);
   }
   if (minutes != null) {
      if (!Number.isInteger(Number(minutes)) || Number(minutes) <= 0) throw ruleError('Duration must be greater than zero minutes.', 400);
      if (Number(entry.duration) !== Number(minutes)) patch.duration = Number(minutes);
   }
   if (Object.keys(patch).length) await trx('timesheet_entries').where({ account_id: accountId, timesheet_entry_id: entryId }).update(patch);
};
