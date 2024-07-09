const bcrypt = require('bcryptjs');

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

const restoreDataTypesUserLoginOnCreate = async sanitizedUserLogin => {
  const salt = bcrypt.genSaltSync(10);
  // Hash the password with the salt
  const hashedPassword = bcrypt.hashSync(sanitizedUserLogin.userLoginPassword, salt);

  return {
    account_id: Number(sanitizedUserLogin.accountID),
    user_id: Number(sanitizedUserLogin.user_id),
    user_name: sanitizedUserLogin.userLoginName,
    password_hash: hashedPassword,
    is_login_active: Boolean(sanitizedUserLogin.isLoginActive) || true
  };
};

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

const restoreDataTypesUserLoginOnUpdate = async sanitizedUserLogin => {
  const salt = bcrypt.genSaltSync(10);
  // Hash the password with the salt
  const hashedPassword = bcrypt.hashSync(sanitizedUserLogin.userLoginPassword, salt);

  return {
    user_login_id: Number(sanitizedUserLogin.userLoginID),
    account_id: Number(sanitizedUserLogin.accountID),
    user_id: Number(sanitizedUserLogin.userID),
    user_name: sanitizedUserLogin.userLoginName,
    password_hash: hashedPassword,
    is_login_active: Boolean(sanitizedUserLogin.isLoginActive)
  };
};

module.exports = {
  restoreDataTypesUserOnCreate,
  restoreDataTypesUserLoginOnCreate,
  restoreDataTypesUserOnUpdate,
  restoreDataTypesUserLoginOnUpdate
};
