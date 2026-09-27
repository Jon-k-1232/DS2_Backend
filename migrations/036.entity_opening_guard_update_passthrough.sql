-- Forward fix for 035: ordinary mutable invoice updates must return NEW.
-- Protected opening rows still refuse before reaching this return.
SELECT set_config('app.audit_source','migration/036.entity_opening_guard_update_passthrough',true);
CREATE OR REPLACE FUNCTION ds2_guard_legacy_opening() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM billing_cutover_positions p
   WHERE p.account_id=OLD.account_id
   AND p.source_root_id=COALESCE(OLD.parent_invoice_id,OLD.customer_invoice_id)
   AND OLD.created_at<=(p.created_at AT TIME ZONE 'UTC')) THEN
  RAISE EXCEPTION 'The original cutover source is immutable; append a business snapshot' USING ERRCODE='P0409';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
