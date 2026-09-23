// Canonical access_level values. Must match DS2_Frontend's AccessSelections.js
// dropdown (`['Super Admin', 'Admin', 'Manager', 'User']`) exactly, since the
// frontend's role gates (SuperAdminAccess.js / AdminProtectedAccess.js /
// ManagerAndAdminProtectedAccess.js) do case-insensitive comparisons against
// these same four strings — a stray value (typo, legacy 'employee', etc.)
// wouldn't match any gate and would silently lock a user out of everything,
// or (worse) fail open on a gate that does a substring/loose check elsewhere.
const CANONICAL_ACCESS_LEVELS = ['Super Admin', 'Admin', 'Manager', 'User'];

// Case/whitespace-insensitive match against the canonical set, returned in
// canonical casing. Throws (with an HTTP status attached, matching the
// convention used elsewhere in this codebase e.g. automation-settings-service.js)
// on anything else, so create/update reject bad access levels instead of
// silently persisting them.
const normalizeAccessLevel = rawValue => {
  const candidate = String(rawValue || '').trim();
  const match = CANONICAL_ACCESS_LEVELS.find(level => level.toLowerCase() === candidate.toLowerCase());
  if (!match) {
    const error = new Error(`Invalid access level "${rawValue}". Must be one of: ${CANONICAL_ACCESS_LEVELS.join(', ')}.`);
    error.status = 400;
    throw error;
  }
  return match;
};

const restoreDataTypesUserOnCreate = userData => ({
  account_id: Number(userData.accountID),
  email: userData.userEmail,
  display_name: userData.userDisplayName,
  cost_rate: Number(userData.costRate),
  billing_rate: Number(userData.billingRate),
  job_title: userData.role,
  access_level: userData.accessLevel,
  // Default to active only when the caller omits the field entirely;
  // honour an explicit false. `Boolean(x) || true` was always true
  // (Boolean(false) || true === true), so isActive:false could never
  // take effect.
  is_user_active: userData.isActive === undefined ? true : Boolean(userData.isActive)
});

const restoreDataTypesUserOnUpdate = userData => ({
  user_id: userData.userID,
  account_id: userData.accountID,
  email: userData.userEmail,
  display_name: userData.userDisplayName,
  cost_rate: userData.costRate,
  billing_rate: userData.billingRate,
  job_title: userData.role,
  access_level: userData.accessLevel,
  is_user_active: userData.isUserActive,
  created_at: userData.createdAt
});

module.exports = {
  restoreDataTypesUserOnCreate,
  restoreDataTypesUserOnUpdate,
  normalizeAccessLevel,
  CANONICAL_ACCESS_LEVELS
};
