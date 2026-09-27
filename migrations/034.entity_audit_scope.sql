-- Retain the company of a saved comparison. NULL denotes an all-company audit.
SELECT set_config('app.audit_source','migration/034.entity_audit_scope',true);
ALTER TABLE account_audits ADD COLUMN IF NOT EXISTS billing_entity_id integer;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='account_audits_billing_entity_fk') THEN
 ALTER TABLE account_audits ADD CONSTRAINT account_audits_billing_entity_fk FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id);END IF;
END $$;
