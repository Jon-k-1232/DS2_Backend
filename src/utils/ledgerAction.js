const { ruleError } = require('../endpoints/payments/ledger-helpers');
const id = value => {
   if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw ruleError('A positive record ID is required.', 400);
   return Number(value);
};
const text = (value, name, max, required = true) => {
   if (value == null && !required) return null;
   if (typeof value !== 'string' || value.includes('\0') || value.trim().length > max || (required && !value.trim())) throw ruleError(`${name} is required and must be at most ${max} characters.`, 400);
   return value.trim() || null;
};
const reason = value => text(value, 'Reason', 2000);
// Transaction-local context for the account audit capture introduced next run.
const actionContext = (trx, actor, why) => trx.raw("SELECT set_config('ds2.actor_id', ?, true), set_config('ds2.reason', ?, true)", [String(actor), why]);
const route = fn => async (req, res) => {
   try { res.send({ status: 200, ...await fn(req) }); }
   catch (error) {
      const status = error.code === 'P0409' ? 409 : (error.statusCode || 500);
      res.status(status).send({ status, code: error.code, message: status === 500 ? 'The operation failed. No changes were saved. Please retry.' : error.message });
   }
};
module.exports = { id, text, reason, actionContext, route };
