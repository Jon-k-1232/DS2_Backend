// `Boolean(x) || true` always evaluates to true (a boolean OR'd with true is
// always true), which made it impossible to ever save is_job_type_active as
// false. Only a genuinely absent value (null/undefined) falls back to the
// default; an explicit false/'false' is honored.
const parseActiveFlag = (value, defaultValue) => (value == null ? defaultValue : value === true || value === 'true');

const restoreDataTypesJobTypeTableOnCreate = jobType => ({
  account_id: Number(jobType.accountID),
  customer_job_category_id: Number(jobType.customerJobCategory),
  job_description: jobType.jobDescription,
  book_rate: Number(jobType.bookRate),
  estimated_straight_time: Number(jobType.estimatedStraightTime),
  is_job_type_active: parseActiveFlag(jobType.isActive, true),
  created_by_user_id: Number(jobType.userID)
});

const restoreDataTypesJobTypeTableOnUpdate = jobType => ({
  job_type_id: Number(jobType.jobTypeID),
  account_id: Number(jobType.accountID),
  customer_job_category_id: Number(jobType.customerJobCategory),
  job_description: jobType.jobDescription,
  book_rate: Number(jobType.bookRate),
  estimated_straight_time: Number(jobType.estimatedStraightTime),
  is_job_type_active: parseActiveFlag(jobType.isActive, true),
  created_by_user_id: Number(jobType.userID)
});

module.exports = {
  restoreDataTypesJobTypeTableOnCreate,
  restoreDataTypesJobTypeTableOnUpdate
};
