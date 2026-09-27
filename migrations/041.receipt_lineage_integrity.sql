-- Cross-business transfers retain the same client and receipt; they never move
-- another client's funds. Forward-only refinement, with no source-row changes.
SELECT set_config('app.audit_source','migration/041.receipt_lineage_integrity',true),set_config('app.audit_reason','Enforce client-specific receipt lineage and exact credit-event relationships',true);
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_client_key ON payment_receipts(account_id,customer_id,receipt_id);
ALTER TABLE client_credit_lots DROP CONSTRAINT IF EXISTS credit_origin_client;
ALTER TABLE client_credit_lots ADD CONSTRAINT credit_origin_client FOREIGN KEY(account_id,customer_id,origin_receipt_id) REFERENCES payment_receipts(account_id,customer_id,receipt_id);
ALTER TABLE ar_applications DROP CONSTRAINT IF EXISTS application_one_funding_source;
ALTER TABLE ar_applications ADD CONSTRAINT application_one_funding_source CHECK(receipt_id IS NULL OR credit_id IS NULL);
CREATE OR REPLACE FUNCTION ds2_credit_lineage_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE original client_credit_events;app ar_applications;BEGIN
 IF NEW.kind='application' THEN
  SELECT * INTO app FROM ar_applications WHERE application_id=NEW.application_id;
  IF NOT FOUND OR app.account_id<>NEW.account_id OR app.customer_id<>NEW.customer_id OR app.billing_entity_id<>NEW.billing_entity_id OR app.credit_id IS DISTINCT FROM NEW.credit_id OR app.direction<>1 OR NEW.direction<>-1 OR app.amount<>NEW.amount OR app.effective_date<>NEW.effective_date THEN
   RAISE EXCEPTION 'Credit use must exactly match its own application' USING ERRCODE='P0409';END IF;
 END IF;
 IF NEW.reversal_of IS NOT NULL THEN
  SELECT * INTO original FROM client_credit_events WHERE event_id=NEW.reversal_of;
  IF NOT FOUND OR original.account_id<>NEW.account_id OR original.customer_id<>NEW.customer_id OR original.billing_entity_id<>NEW.billing_entity_id OR original.credit_id<>NEW.credit_id OR original.amount<>NEW.amount OR original.direction<>-NEW.direction OR NEW.effective_date<original.effective_date THEN
   RAISE EXCEPTION 'Reverse the complete original credit event in its own scope' USING ERRCODE='P0409';END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ds2_credit_lineage_guard ON client_credit_events;
CREATE TRIGGER ds2_credit_lineage_guard BEFORE INSERT ON client_credit_events FOR EACH ROW EXECUTE FUNCTION ds2_credit_lineage_guard();
