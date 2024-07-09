const restoreDataTypesJobTypeTableOnCreate = jobType => ({
  account_id: Number(jobType.accountID),
  customer_job_category_id: Number(jobType.customerJobCategory),
  job_description: jobType.jobDescription,
  book_rate: Number(jobType.bookRate),
  estimated_straight_time: Number(jobType.estimatedStraightTime),
  is_job_type_active: Boolean(jobType.isActive) || true,
  created_by_user_id: Number(jobType.userID)
});

const restoreDataTypesJobTypeTableOnUpdate = jobType => ({
  job_type_id: Number(jobType.jobTypeID),
  account_id: Number(jobType.accountID),
  customer_job_category_id: Number(jobType.customerJobCategory),
  job_description: jobType.jobDescription,
  book_rate: Number(jobType.bookRate),
  estimated_straight_time: Number(jobType.estimatedStraightTime),
  is_job_type_active: Boolean(jobType.isActive) || true,
  created_by_user_id: Number(jobType.userID)
});

module.exports = {
  restoreDataTypesJobTypeTableOnCreate,
  restoreDataTypesJobTypeTableOnUpdate
};
