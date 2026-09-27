-- Additive amendment support. Application is an explicit reviewed operator step.
SELECT set_config('app.audit_source','migration/037.legacy_opening_scope_amendment',true),
 set_config('app.audit_reason','Preserve pre-cutover client opening positions together; retain tracker reporting attribution',true);
CREATE TABLE IF NOT EXISTS billing_cutover_amendments (
 amendment_id bigserial PRIMARY KEY, account_id integer NOT NULL,
 cutover_id integer NOT NULL, supersedes_cutover_id integer NOT NULL,
 billing_entity_id integer NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,supersedes_cutover_id), UNIQUE(account_id,amendment_id),
 FOREIGN KEY(account_id,cutover_id) REFERENCES billing_cutovers(account_id,cutover_id),
 FOREIGN KEY(account_id,supersedes_cutover_id) REFERENCES billing_cutovers(account_id,cutover_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id),
 CHECK(cutover_id<>supersedes_cutover_id)
);
CREATE TABLE IF NOT EXISTS legacy_billing_scopes (
 scope_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer,
 amendment_id bigint NOT NULL, table_name text NOT NULL CHECK(table_name IN('customer_transactions','timesheet_entries')),
 record_id integer NOT NULL, billing_entity_id integer NOT NULL, reporting_entity_id integer,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 reporting_basis text NOT NULL CHECK(reporting_basis IN('legacy attribution: tracker entity','unattributed legacy work')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,table_name,record_id),
 FOREIGN KEY(account_id,amendment_id) REFERENCES billing_cutover_amendments(account_id,amendment_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id),
 FOREIGN KEY(account_id,reporting_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
DO $$ DECLARE spec text;t text;k text; BEGIN
 FOREACH spec IN ARRAY ARRAY['billing_cutover_amendments:amendment_id','legacy_billing_scopes:scope_id'] LOOP
  t:=split_part(spec,':',1);k:=split_part(spec,':',2);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_capture ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit(%L)',t,k);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_immutable ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_audit_immutable()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON %I EXECUTE FUNCTION ds2_audit_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION ds2_effective_entity(aid integer,t text,rid integer,eid integer) RETURNS integer LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT COALESCE(eid,
 (SELECT s.billing_entity_id FROM legacy_billing_scopes s WHERE s.account_id=aid AND s.table_name=t AND s.record_id=rid),
 (SELECT a.billing_entity_id FROM legacy_financial_entity_attributions a WHERE a.account_id=aid AND a.table_name=t AND a.record_id=rid),
 (SELECT s.billing_entity_id FROM billing_entity_reviews r JOIN billing_entity_resolutions s USING(review_id,account_id) WHERE r.account_id=aid AND r.table_name=t AND r.record_id=rid))
$$;
CREATE OR REPLACE FUNCTION ds2_legacy_reporting_entity(aid integer,t text,rid integer) RETURNS integer LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT reporting_entity_id FROM legacy_billing_scopes WHERE account_id=aid AND table_name=t AND record_id=rid
$$;
