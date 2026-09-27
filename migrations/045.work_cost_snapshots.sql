-- H5. Preserve issued work; historical estimates live in an immutable sidecar.
SELECT set_config('app.audit_source','migration/045.work_cost_snapshots',true),
 set_config('app.audit_reason','Snapshot known labor rates once as estimates; preserve historical work and issued records',true);
CREATE TABLE IF NOT EXISTS legacy_work_cost_estimates (
 estimate_id bigserial PRIMARY KEY, account_id integer NOT NULL REFERENCES accounts(account_id),
 customer_id integer, billing_entity_id integer, table_name text NOT NULL CHECK(table_name IN ('customer_transactions','timesheet_entries')),
 record_id integer NOT NULL, staff_id integer, source_timesheet_entry_id integer,
 cost_rate_snapshot numeric(14,4), cost_rate_source text NOT NULL CHECK(cost_rate_source IN ('estimated','unknown')),
 actual_duration_minutes numeric(14,4), duration_source text NOT NULL,
 billing_rate_snapshot numeric(14,4), standard_value_snapshot numeric(14,2),
 cost_snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 basis text NOT NULL DEFAULT 'Known staff rate at H5 migration; historical rate unknown',
 UNIQUE(account_id,table_name,record_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
DROP TRIGGER IF EXISTS ds2_audit_capture ON legacy_work_cost_estimates;
CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON legacy_work_cost_estimates FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit('estimate_id');
DROP TRIGGER IF EXISTS ds2_audit_immutable ON legacy_work_cost_estimates;
CREATE TRIGGER ds2_audit_immutable BEFORE UPDATE OR DELETE ON legacy_work_cost_estimates FOR EACH ROW EXECUTE FUNCTION ds2_audit_immutable();
DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON legacy_work_cost_estimates;
CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON legacy_work_cost_estimates EXECUTE FUNCTION ds2_audit_immutable();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customer_transactions','timesheet_entries'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS cost_rate_snapshot numeric(14,4), ADD COLUMN IF NOT EXISTS cost_rate_source text CHECK(cost_rate_source IN (''recorded'',''estimated'',''unknown'')), ADD COLUMN IF NOT EXISTS cost_snapshot_at timestamptz, ADD COLUMN IF NOT EXISTS actual_duration_minutes numeric(14,4), ADD COLUMN IF NOT EXISTS duration_source text, ADD COLUMN IF NOT EXISTS billing_rate_snapshot numeric(14,4), ADD COLUMN IF NOT EXISTS standard_value_snapshot numeric(14,2)',t);
 END LOOP;
END $$;
ALTER TABLE customer_transactions ADD COLUMN IF NOT EXISTS source_timesheet_entry_id integer REFERENCES timesheet_entries(timesheet_entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_source_tracker_unique ON customer_transactions(account_id,source_timesheet_entry_id) WHERE source_timesheet_entry_id IS NOT NULL;

-- Exact, unique tracker provenance only; no name/date/amount guessing.
INSERT INTO legacy_work_cost_estimates(account_id,customer_id,billing_entity_id,table_name,record_id,staff_id,source_timesheet_entry_id,cost_rate_snapshot,cost_rate_source,actual_duration_minutes,duration_source,billing_rate_snapshot,standard_value_snapshot)
SELECT t.account_id,t.customer_id,ds2_effective_entity(t.account_id,'customer_transactions',t.transaction_id,t.billing_entity_id),'customer_transactions',t.transaction_id,t.logged_for_user_id,s.entry_id,u.cost_rate,
 CASE WHEN u.cost_rate IS NULL THEN 'unknown' ELSE 'estimated' END,
 CASE WHEN lower(t.transaction_type)='time' THEN COALESCE(te.duration,t.quantity*60) END,
 CASE WHEN te.duration IS NOT NULL THEN 'tracker actual' ELSE 'estimated from quantity' END,t.unit_cost,t.quantity*t.unit_cost
FROM customer_transactions t LEFT JOIN users u ON u.account_id=t.account_id AND u.user_id=t.logged_for_user_id
LEFT JOIN LATERAL(SELECT CASE WHEN count(DISTINCT a.timesheet_entry_id)=1 THEN min(a.timesheet_entry_id) END entry_id FROM ai_category_training_examples a WHERE a.account_id=t.account_id AND a.transaction_id=t.transaction_id) s ON true
LEFT JOIN timesheet_entries te ON te.account_id=t.account_id AND te.timesheet_entry_id=s.entry_id
WHERE t.cost_snapshot_at IS NULL ON CONFLICT(account_id,table_name,record_id) DO NOTHING;
INSERT INTO legacy_work_cost_estimates(account_id,customer_id,billing_entity_id,table_name,record_id,staff_id,cost_rate_snapshot,cost_rate_source,actual_duration_minutes,duration_source,billing_rate_snapshot,standard_value_snapshot)
SELECT t.account_id,t.suggested_customer_id,ds2_effective_entity(t.account_id,'timesheet_entries',t.timesheet_entry_id,t.billing_entity_id),'timesheet_entries',t.timesheet_entry_id,u.user_id,u.cost_rate,
 CASE WHEN u.cost_rate IS NULL THEN 'unknown' ELSE 'estimated' END,t.duration,'tracker actual',u.billing_rate,round((ceil(t.duration/6)*u.billing_rate/10)::numeric,2)
FROM timesheet_entries t LEFT JOIN users u ON u.account_id=t.account_id AND u.user_id=COALESCE(t.matched_user_id,
 (SELECT CASE WHEN count(*)=1 THEN min(x.user_id) END FROM users x WHERE x.account_id=t.account_id AND lower(btrim(x.display_name))=lower(btrim(t.employee_name))))
WHERE t.cost_snapshot_at IS NULL ON CONFLICT(account_id,table_name,record_id) DO NOTHING;

CREATE OR REPLACE FUNCTION ds2_work_cost_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE uid integer; olduid integer; rate numeric; bill numeric; src timesheet_entries; est legacy_work_cost_estimates; changed boolean; why text;
BEGIN
 IF TG_TABLE_NAME='timesheet_entries' THEN
  -- user_id can be the uploader. Only the named/matched employee owns cost.
  uid:=COALESCE(NEW.matched_user_id,(SELECT CASE WHEN count(*)=1 THEN min(user_id) END FROM users WHERE account_id=NEW.account_id AND lower(btrim(display_name))=lower(btrim(NEW.employee_name))));
  changed:=TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN
   changed:=NEW.employee_name IS DISTINCT FROM OLD.employee_name;
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
   IF TG_OP='INSERT' OR NEW.quantity IS DISTINCT FROM OLD.quantity THEN
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
DROP TRIGGER IF EXISTS ds2_work_cost_snapshot ON customer_transactions;
CREATE TRIGGER ds2_work_cost_snapshot BEFORE INSERT OR UPDATE ON customer_transactions FOR EACH ROW EXECUTE FUNCTION ds2_work_cost_snapshot();
DROP TRIGGER IF EXISTS ds2_work_cost_snapshot ON timesheet_entries;
CREATE TRIGGER ds2_work_cost_snapshot BEFORE INSERT OR UPDATE ON timesheet_entries FOR EACH ROW EXECUTE FUNCTION ds2_work_cost_snapshot();

-- Append new columns to the entity views without changing their old positions.
DO $$ DECLARE t text; k text; cols text; BEGIN
 FOREACH t IN ARRAY ARRAY['customer_transactions','timesheet_entries'] LOOP
  k:=CASE t WHEN 'customer_transactions' THEN 'transaction_id' ELSE 'timesheet_entry_id' END;
  SELECT string_agg(CASE WHEN column_name='billing_entity_id' THEN format('public.ds2_effective_entity(r.account_id,%L,r.%I,r.billing_entity_id) AS billing_entity_id',t,k) ELSE format('r.%I',column_name) END,',' ORDER BY ordinal_position) INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name=t;
  EXECUTE format('CREATE OR REPLACE VIEW billing_scope.%I AS SELECT %s FROM public.%I r WHERE NULLIF(current_setting(''app.billing_entity_id'',true),'''') IS NULL OR public.ds2_effective_entity(r.account_id,%L,r.%I,r.billing_entity_id)=NULLIF(current_setting(''app.billing_entity_id'',true),'''')::integer',t,cols,t,t,k);
 END LOOP;
END $$;
