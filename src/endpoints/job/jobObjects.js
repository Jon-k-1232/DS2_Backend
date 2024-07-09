const restoreDataTypesJobTableOnCreate = job => ({
   parent_job_id: Number(job.parentJobID) || null,
   account_id: Number(job.accountID),
   customer_id: Number(job.customerID),
   job_type_id: Number(job.jobTypeID),
   job_quote_amount: Number(job.quoteAmount),
   agreed_job_amount: Number(job.agreedJobAmount) || 0.0,
   current_job_total: Number(job.currentJobTotal) || 0.0,
   job_status: Number(job.jobStatus) || null,
   is_job_complete: Boolean(job.isJobComplete) || false,
   is_quote: Boolean(job.isQuote) || false,
   created_by_user_id: Number(job.userID),
   notes: job.note || null
});

const restoreDataTypesJobTableOnUpdate = job => ({
   customer_job_id: Number(job.customerJobID),
   parent_job_id: Number(job.parentJobID) || null,
   account_id: Number(job.accountID),
   customer_id: Number(job.customerID),
   job_type_id: Number(job.jobTypeID),
   job_quote_amount: Number(job.quoteAmount),
   agreed_job_amount: Number(job.agreedJobAmount) || 0,
   current_job_total: Number(job.currentJobTotal) || 0,
   job_status: Number(job.jobStatus) || null,
   is_job_complete: Boolean(job.isJobComplete) || false,
   is_quote: Boolean(job.isQuote) || false,
   created_by_user_id: Number(job.userID),
   notes: job.notes || null
});

module.exports = {
   restoreDataTypesJobTableOnCreate,
   restoreDataTypesJobTableOnUpdate
};
