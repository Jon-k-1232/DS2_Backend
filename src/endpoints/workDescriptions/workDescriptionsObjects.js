// `Boolean(x) || true` always evaluates to true (a boolean OR'd with true is
// always true), which made it impossible to ever save
// is_general_work_description_active as false. Only a genuinely absent value
// (null/undefined) falls back to the default; an explicit false/'false' is
// honored.
const parseActiveFlag = (value, defaultValue) => (value == null ? defaultValue : value === true || value === 'true');

const restoreDataTypesWorkDescriptionTableOnCreate = (description, accountID, userID) => ({
  account_id: Number(accountID),
  general_work_description: description.generalWorkDescription,
  estimated_time: Number(description.estimatedTime),
  is_general_work_description_active: parseActiveFlag(description.isGeneralWorkDescriptionActive, true),
  created_by_user_id: Number(userID)
});

const restoreDataTypesWorkDescriptionTableOnUpdate = description => ({
  general_work_description_id: Number(description.generalWorkDescriptionID),
  account_id: Number(description.accountID),
  general_work_description: description.generalWorkDescription,
  estimated_time: Number(description.estimatedTime),
  is_general_work_description_active: parseActiveFlag(description.isGeneralWorkDescriptionActive, true),
  created_at: description.createdAt,

});

module.exports = {
  restoreDataTypesWorkDescriptionTableOnCreate,
  restoreDataTypesWorkDescriptionTableOnUpdate
};
