-- Preserve default-routed opening evidence as strictly as a reviewed split.
-- New payments and statements append company snapshots; old source rows never
-- become writable merely because an accountant kept the default allocation.
SELECT set_config('app.audit_source','migration/035.entity_default_opening_immutability',true);
CREATE OR REPLACE FUNCTION ds2_guard_legacy_opening() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM billing_cutover_positions p
   WHERE p.account_id=OLD.account_id
   AND p.source_root_id=COALESCE(OLD.parent_invoice_id,OLD.customer_invoice_id)
   AND OLD.created_at<=(p.created_at AT TIME ZONE 'UTC')) THEN
  RAISE EXCEPTION 'The original cutover source is immutable; append a business snapshot' USING ERRCODE='P0409';
 END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS ds2_legacy_opening_immutable ON customer_invoices;
CREATE TRIGGER ds2_legacy_opening_immutable BEFORE UPDATE OR DELETE ON customer_invoices
FOR EACH ROW EXECUTE FUNCTION ds2_guard_legacy_opening();
