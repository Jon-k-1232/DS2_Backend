-- H5 continuation: audited tracker corrections preserve actual minutes and staff cost.
-- Function-only replacement: no historical rows or estimates are changed.
CREATE OR REPLACE FUNCTION ds2_work_cost_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE uid integer; olduid integer; rate numeric; bill numeric; src timesheet_entries; est legacy_work_cost_estimates; changed boolean; why text; minutes numeric;
BEGIN
 IF TG_TABLE_NAME='timesheet_entries' THEN
  -- user_id can be the uploader. Only the named/matched employee owns cost.
  uid:=COALESCE(NEW.matched_user_id,(SELECT CASE WHEN count(*)=1 THEN min(user_id) END FROM users WHERE account_id=NEW.account_id AND lower(btrim(display_name))=lower(btrim(NEW.employee_name))));
  changed:=TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN
   olduid:=COALESCE(OLD.matched_user_id,(SELECT CASE WHEN count(*)=1 THEN min(user_id) END FROM users WHERE account_id=OLD.account_id AND lower(btrim(display_name))=lower(btrim(OLD.employee_name))));
   -- Resolving a previously unknown owner cannot reconstruct a historical rate.
   -- An explicit correction of an already known owner captures the new rate.
   changed:=NEW.employee_name IS DISTINCT FROM OLD.employee_name OR (olduid IS NOT NULL AND uid IS DISTINCT FROM olduid);
   IF changed THEN
    why:=NULLIF(btrim(current_setting('app.cost_change_reason',true)),'');
    IF why IS NULL THEN RAISE EXCEPTION 'A reason is required when changing the employee on work' USING ERRCODE='P0400'; END IF;
    PERFORM set_config('app.audit_reason',why,true);
   END IF;
   IF NOT changed THEN
    NEW.cost_rate_snapshot:=OLD.cost_rate_snapshot; NEW.cost_rate_source:=OLD.cost_rate_source; NEW.cost_snapshot_at:=OLD.cost_snapshot_at; NEW.billing_rate_snapshot:=OLD.billing_rate_snapshot;
   END IF;
  END IF;
  NEW.actual_duration_minutes:=NEW.duration; NEW.duration_source:='tracker actual';
 ELSE
  uid:=NEW.logged_for_user_id; changed:=TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN
   changed:=NEW.logged_for_user_id IS DISTINCT FROM OLD.logged_for_user_id;
   IF NEW.source_timesheet_entry_id IS DISTINCT FROM OLD.source_timesheet_entry_id THEN RAISE EXCEPTION 'Work source is immutable' USING ERRCODE='P0409'; END IF;
   IF changed THEN
    why:=NULLIF(btrim(current_setting('app.cost_change_reason',true)),'');
    IF why IS NULL THEN RAISE EXCEPTION 'A reason is required when changing the employee on work' USING ERRCODE='P0400'; END IF;
    PERFORM set_config('app.audit_reason',why,true);
   ELSE
    NEW.cost_rate_snapshot:=OLD.cost_rate_snapshot; NEW.cost_rate_source:=OLD.cost_rate_source; NEW.cost_snapshot_at:=OLD.cost_snapshot_at; NEW.billing_rate_snapshot:=OLD.billing_rate_snapshot;
   END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.source_timesheet_entry_id IS NOT NULL THEN
   SELECT * INTO src FROM timesheet_entries WHERE account_id=NEW.account_id AND timesheet_entry_id=NEW.source_timesheet_entry_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Tracker source belongs to another account' USING ERRCODE='P0404'; END IF;
   SELECT * INTO est FROM legacy_work_cost_estimates WHERE account_id=NEW.account_id AND table_name='timesheet_entries' AND record_id=src.timesheet_entry_id;
   NEW.cost_rate_snapshot:=COALESCE(src.cost_rate_snapshot,est.cost_rate_snapshot); NEW.cost_rate_source:=COALESCE(src.cost_rate_source,est.cost_rate_source,'unknown');
   NEW.cost_snapshot_at:=COALESCE(src.cost_snapshot_at,est.cost_snapshot_at,clock_timestamp()); NEW.billing_rate_snapshot:=COALESCE(src.billing_rate_snapshot,est.billing_rate_snapshot);
   NEW.actual_duration_minutes:=src.duration; NEW.duration_source:='tracker actual'; changed:=false;
  ELSIF lower(NEW.transaction_type)='time' THEN
   minutes:=NULLIF(current_setting('app.work_minutes',true),'')::numeric;
   IF minutes IS NOT NULL THEN
    NEW.actual_duration_minutes:=minutes; NEW.duration_source:='entered actual';
   ELSIF TG_OP='INSERT' OR NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    NEW.actual_duration_minutes:=NEW.quantity*60; NEW.duration_source:='estimated from quantity';
   ELSE NEW.actual_duration_minutes:=OLD.actual_duration_minutes; NEW.duration_source:=OLD.duration_source; END IF;
  ELSE NEW.actual_duration_minutes:=NULL; NEW.duration_source:='not time'; END IF;
 END IF;
 IF changed THEN
  SELECT cost_rate,billing_rate INTO rate,bill FROM users WHERE account_id=NEW.account_id AND user_id=uid;
  NEW.cost_rate_snapshot:=rate; NEW.cost_rate_source:=CASE WHEN rate IS NULL THEN 'unknown' ELSE 'recorded' END;
  NEW.cost_snapshot_at:=clock_timestamp(); NEW.billing_rate_snapshot:=bill;
 END IF;
 IF TG_TABLE_NAME='timesheet_entries' THEN NEW.standard_value_snapshot:=round((ceil(NEW.duration/6)*NEW.billing_rate_snapshot/10)::numeric,2);
 ELSE
  -- An explicitly entered work rate is the standard price; actual labor uses
  -- actual minutes even when the billed quantity rounds up to six minutes.
  IF TG_OP='INSERT' THEN NEW.billing_rate_snapshot:=NEW.unit_cost; END IF;
  NEW.standard_value_snapshot:=round((NEW.quantity*COALESCE(NEW.billing_rate_snapshot,NEW.unit_cost))::numeric,2);
 END IF;
 RETURN NEW;
END $$;
