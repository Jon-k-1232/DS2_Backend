ALTER TABLE account_audits
   ADD COLUMN app_invoice_total numeric(12, 2),
   ADD COLUMN app_balance_error text;
