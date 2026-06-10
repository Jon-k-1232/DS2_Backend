const { NODE_ENV } = require('../../config');

// Database/driver/stack internals must never reach the client in production —
// they leak schema and implementation detail that aid an attacker. This matches
// messages that look like SQL, Postgres/knex errors, connection errors, or stack
// frames. Clean operational messages (e.g. "Customer already exists") don't match
// and pass through unchanged.
const SENSITIVE = /(\bselect\b|\binsert\b|\bupdate\b.*\bset\b|\bdelete\b|\bfrom\s+\w|\bwhere\b|\bjoin\b|\bcolumn\b|\brelation\b|\bconstraint\b|duplicate key|violates|syntax error|sqlstate|\bknex\b|\bpg_|econnrefused|etimedout|enotfound|password|node_modules|\/src\/|\bat\s+\w+\s+\()/i;

// Return an error message that is safe to send to the client. In production,
// messages that look like internal/DB errors are replaced with `fallback`.
const clientSafeMessage = (err, fallback = 'An unexpected error occurred.') => {
   const msg = (err && err.message) || '';
   if (!msg) return fallback;
   if (NODE_ENV === 'production' && SENSITIVE.test(msg)) return fallback;
   return msg;
};

module.exports = { clientSafeMessage };
