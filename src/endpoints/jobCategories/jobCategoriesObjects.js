const restoreDataTypesJobCategoriesOnCreate = data => ({
  account_id: Number(data.accountID),
  customer_job_category: data.category,
  is_job_category_active: Boolean(data.isActive),
  created_by_user_id: Number(data.createdBy)
});

const restoreDataTypesJobCategoriesOnUpdate = data => ({
  customer_job_category_id: Number(data.customerJobCategoryID),
  account_id: Number(data.accountID),
  customer_job_category: data.selectedNewJobCategory,
  is_job_category_active: Boolean(data.isJobCategoryActive),
  created_by_user_id: Number(data.createdByUserID)
});

module.exports = {
  restoreDataTypesJobCategoriesOnCreate,
  restoreDataTypesJobCategoriesOnUpdate
};
