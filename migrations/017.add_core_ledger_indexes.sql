-- Core ledger indexes. The four ledger tables had no secondary indexes at all;
-- every per-customer query (profile, payment pickers, audit, AR, billing runs)
-- and every chain walk (parent_invoice_id) was a sequential scan. customer_id
-- leads the composites because the deployment is effectively single-account
-- (account_id=1 on every row carries no selectivity).

CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer_date
   ON customer_invoices (customer_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_parent
   ON customer_invoices (parent_invoice_id)
   WHERE parent_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer
   ON customer_payments (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_payments_invoice
   ON customer_payments (customer_invoice_id);

CREATE INDEX IF NOT EXISTS idx_customer_transactions_customer
   ON customer_transactions (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_transactions_invoice
   ON customer_transactions (customer_invoice_id);

CREATE INDEX IF NOT EXISTS idx_customer_transactions_job
   ON customer_transactions (customer_job_id);

CREATE INDEX IF NOT EXISTS idx_customer_writeoffs_customer
   ON customer_writeoffs (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_writeoffs_invoice
   ON customer_writeoffs (customer_invoice_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_date
   ON timesheet_entries (account_id, date);
