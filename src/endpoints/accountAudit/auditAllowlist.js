// Account Audit access is locked beyond admin role — only the principals listed
// here may invoke or view audits. Display name match is case-insensitive but
// otherwise exact, so renames in the users table require an update here.
const ACCOUNT_AUDIT_ALLOWED_NAMES = ['kasi kimmel', 'jon kimmel'];

const isAllowedAuditor = displayName => {
   if (!displayName) return false;
   return ACCOUNT_AUDIT_ALLOWED_NAMES.includes(displayName.trim().toLowerCase());
};

module.exports = { ACCOUNT_AUDIT_ALLOWED_NAMES, isAllowedAuditor };
