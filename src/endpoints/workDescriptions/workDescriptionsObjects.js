const restoreDataTypesWorkDescriptionTableOnCreate = (description, accountID, userID) => ({
  account_id: Number(accountID),
  general_work_description: description.generalWorkDescription,
  estimated_time: Number(description.estimatedTime),
  is_general_work_description_active: Boolean(description.isGeneralWorkDescriptionActive) || true,
  created_by_user_id: Number(userID)
});

const restoreDataTypesWorkDescriptionTableOnUpdate = description => ({
  general_work_description_id: Number(description.generalWorkDescriptionID),
  account_id: Number(description.accountID),
  general_work_description: description.generalWorkDescription,
  estimated_time: Number(description.estimatedTime),
  is_general_work_description_active: Boolean(description.isGeneralWorkDescriptionActive) || true,
  created_at: description.createdAt,
  created_by_user_id: Number(description.createdByUserID)
});

module.exports = {
  restoreDataTypesWorkDescriptionTableOnCreate,
  restoreDataTypesWorkDescriptionTableOnUpdate
};
