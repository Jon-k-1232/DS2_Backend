-- H9: index-only DDL. No business-row backfill, no audit/source data changes.
CREATE INDEX IF NOT EXISTS customer_jobs_account_customer_idx
  ON customer_jobs (account_id, customer_id, created_at DESC, customer_job_id DESC);
CREATE INDEX IF NOT EXISTS customer_jobs_account_family_idx
  ON customer_jobs (account_id, (COALESCE(parent_job_id, customer_job_id)), created_at DESC, customer_job_id DESC);
CREATE INDEX IF NOT EXISTS customers_account_directory_idx
  ON customers (account_id, is_customer_active, display_name, customer_id);
CREATE INDEX IF NOT EXISTS retainers_account_created_idx
  ON customer_retainers_and_prepayments (account_id, created_at DESC, retainer_id DESC);
CREATE INDEX IF NOT EXISTS retainers_account_customer_idx
  ON customer_retainers_and_prepayments (account_id, customer_id);
