const restoreDataTypesUserOnCreate = userData => ({
  account_id: Number(userData.accountID),
  email: userData.userEmail,
  display_name: userData.userDisplayName,
  cost_rate: Number(userData.costRate),
  billing_rate: Number(userData.billingRate),
  job_title: userData.role,
  access_level: userData.accessLevel,
  is_user_active: Boolean(userData.isActive) || true
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
  restoreDataTypesUserOnUpdate
};
