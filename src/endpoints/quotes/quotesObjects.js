const restoreDataTypesQuotesTableOnCreate = data => ({
  account_id: Number(data.account_id),
  customer_id: Number(data.customer_id),
  customer_job_id: Number(data.customer_job_id),
  amount_quoted: Number(data.amount_quoted),
  is_quote_active: Boolean(data.is_quote_active),
  created_by_user_id: Number(data.created_by_user_id),
  notes: data.notes
});

const restoreDataTypesQuotesTableOnUpdate = data => ({
  customer_quote_id: Number(data.customer_quote_id),
  account_id: Number(data.account_id),
  customer_id: Number(data.customer_id),
  customer_job_id: Number(data.customer_job_id),
  amount_quoted: Number(data.amount_quoted),
  is_quote_active: Boolean(data.is_quote_active),
  created_by_user_id: Number(data.created_by_user_id),
  notes: data.notes
});

module.exports = {
  restoreDataTypesQuotesTableOnCreate,
  restoreDataTypesQuotesTableOnUpdate
};
