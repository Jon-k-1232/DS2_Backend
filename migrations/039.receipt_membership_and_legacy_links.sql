-- Forward correction: immutable evidence may retain IDs of deletable legacy
-- unissued compatibility rows. New receipt-backed rows have their own guard.
SELECT set_config('app.audit_source','migration/039.receipt_membership_and_legacy_links',true),set_config('app.audit_reason','Capture subledger statement membership and preserve legacy correction lineage',true);
ALTER TABLE ar_applications DROP CONSTRAINT IF EXISTS ar_applications_compatibility_payment_id_fkey;
ALTER TABLE ar_applications DROP CONSTRAINT IF EXISTS ar_applications_compatibility_writeoff_id_fkey;
ALTER TABLE invoice_statement_members DROP CONSTRAINT IF EXISTS invoice_statement_members_table_name_check;
ALTER TABLE invoice_statement_members ADD CONSTRAINT invoice_statement_members_table_name_check CHECK(table_name IN('customer_invoices','customer_transactions','customer_payments','customer_writeoffs','customer_retainers_and_prepayments','retainer_events','ar_obligations','payment_receipts','ar_applications','client_credit_lots','client_credit_events','receipt_events'));
