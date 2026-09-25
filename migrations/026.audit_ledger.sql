-- Universal audit capture. Additive, no historical business-row backfill.
-- Apply with psql -X -1 -v ON_ERROR_STOP=1 -f.
CREATE TABLE IF NOT EXISTS audit_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO audit_policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS audit_events (
 event_id bigserial PRIMARY KEY,
 account_id integer NOT NULL,
 customer_id integer,
 previous_customer_id integer,
 entity text NOT NULL,
 entity_id text NOT NULL,
 action text NOT NULL,
 occurred_at timestamptz NOT NULL,
 transaction_id text NOT NULL,
 correlation_id text NOT NULL,
 actor_user_id integer,
 actor_name text NOT NULL,
 source text NOT NULL,
 reason text,
 before_value jsonb,
 after_value jsonb,
 changes jsonb NOT NULL,
 previous_hash text NOT NULL,
 event_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_customer_history ON audit_events(account_id,customer_id,event_id);
CREATE INDEX IF NOT EXISTS audit_previous_customer_history ON audit_events(account_id,previous_customer_id,event_id);
CREATE INDEX IF NOT EXISTS audit_account_chain ON audit_events(account_id,event_id);
CREATE INDEX IF NOT EXISTS audit_customer_dates ON audit_events(account_id,customer_id,occurred_at,event_id);
CREATE INDEX IF NOT EXISTS audit_request_history ON audit_events(correlation_id,event_id);
CREATE TABLE IF NOT EXISTS audit_chain_heads (
 account_id integer PRIMARY KEY, event_id bigint NOT NULL, event_hash text NOT NULL, event_count bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_records (
 record_id uuid PRIMARY KEY,
 account_id integer NOT NULL,
 customer_id integer NOT NULL,
 start_date date, end_date date,
 generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 generated_by integer NOT NULL,
 generated_by_name text NOT NULL,
 storage_key text NOT NULL UNIQUE,
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 chain_event_id bigint,
 chain_hash text NOT NULL,
 byte_length integer NOT NULL CHECK(byte_length>0),
 CHECK(start_date IS NULL OR end_date IS NULL OR start_date<=end_date)
);
CREATE INDEX IF NOT EXISTS audit_records_customer ON audit_records(account_id,customer_id,generated_at,record_id);
-- Non-row actions, such as opening an archived invoice/PDF, join the same chain.
CREATE TABLE IF NOT EXISTS audit_actions (
 action_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer,
 action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION ds2_audit_hash(e audit_events) RETURNS text
LANGUAGE sql IMMUTABLE SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
 SELECT encode(sha256(convert_to((to_jsonb(e)-'event_hash')::text,'UTF8')),'hex')
$$;
CREATE OR REPLACE FUNCTION ds2_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Audit evidence is append-only' USING ERRCODE='P0409';
END $$;
CREATE OR REPLACE FUNCTION ds2_audit_internal_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()<2 THEN
   RAISE EXCEPTION 'Audit chain can only be written by capture triggers' USING ERRCODE='P0409';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION ds2_audit_customer(t text, r jsonb) RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE cid integer;
BEGIN
 IF r IS NULL THEN RETURN NULL; END IF;
 cid:=COALESCE((r->>'customer_id')::integer,(r->>'matched_customer_id')::integer,(r->>'suggested_customer_id')::integer);
 IF cid IS NULL AND jsonb_exists(r,'invoice_id') THEN
   SELECT customer_id INTO cid FROM invoice_issues WHERE account_id=(r->>'account_id')::integer AND invoice_id=(r->>'invoice_id')::integer;
 END IF;
 IF cid IS NULL AND jsonb_exists(r,'duplicate_id') THEN
   SELECT customer_id INTO cid FROM duplicate_flags WHERE account_id=(r->>'account_id')::integer AND duplicate_id=(r->>'duplicate_id')::integer;
 END IF;
 IF cid IS NULL AND t='ai_category_training_examples' THEN
   SELECT customer_id INTO cid FROM customer_transactions WHERE account_id=(r->>'account_id')::integer AND transaction_id=(r->>'transaction_id')::integer;
 END IF;
 RETURN cid;
END $$;
CREATE OR REPLACE FUNCTION ds2_capture_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE b jsonb; a jsonb; r jsonb; e audit_events; h audit_chain_heads; actor text;
BEGIN
 b:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) ELSE NULL END;
 a:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) ELSE NULL END;
 r:=COALESCE(a,b);
 -- Identity cannot migrate between tenants; a legitimate transfer is a delete/insert.
 IF TG_OP='UPDATE' AND (b->>'account_id') IS DISTINCT FROM (a->>'account_id') THEN
   RAISE EXCEPTION 'Audited records cannot change account' USING ERRCODE='P0409';
 END IF;
 e.account_id:=(r->>'account_id')::integer;
 PERFORM pg_advisory_xact_lock(260026,e.account_id);
 SELECT * INTO h FROM audit_chain_heads WHERE account_id=e.account_id;
 e.event_id:=nextval('audit_events_event_id_seq');
 e.customer_id:=ds2_audit_customer(TG_TABLE_NAME,r);
 e.previous_customer_id:=ds2_audit_customer(TG_TABLE_NAME,b);
 e.entity:=TG_TABLE_NAME;
 e.entity_id:=concat_ws(':',r->>TG_ARGV[0],CASE WHEN TG_NARGS>1 THEN r->>TG_ARGV[1] END,CASE WHEN TG_NARGS>2 THEN r->>TG_ARGV[2] END);
 e.action:=CASE WHEN TG_TABLE_NAME='audit_actions' THEN r->>'action' ELSE lower(TG_OP) END;
 e.occurred_at:=clock_timestamp();
 e.transaction_id:=txid_current()::text;
 e.correlation_id:=COALESCE(NULLIF(current_setting('app.correlation_id',true),''),'database:'||e.transaction_id);
 actor:=NULLIF(current_setting('app.actor_user_id',true),'');
 IF actor IS NOT NULL THEN
   SELECT user_id,display_name INTO e.actor_user_id,e.actor_name FROM users WHERE user_id=actor::integer;
   -- Preserve attribution when an authorized deletion removes the acting user
   -- itself (or an account cascade already removed it). The application name
   -- snapshot comes from the authenticated session, never request body fields.
   IF e.actor_user_id IS NULL AND TG_TABLE_NAME='users' AND TG_OP='DELETE' AND (b->>'user_id')::integer=actor::integer THEN
     e.actor_user_id:=actor::integer; e.actor_name:=b->>'display_name';
   ELSIF e.actor_user_id IS NULL AND NULLIF(current_setting('app.actor_name',true),'') IS NOT NULL THEN
     e.actor_user_id:=actor::integer; e.actor_name:=current_setting('app.actor_name',true);
   END IF;
   IF e.actor_user_id IS NULL THEN RAISE EXCEPTION 'Unknown audit actor' USING ERRCODE='22023'; END IF;
 END IF;
 e.actor_name:=COALESCE(e.actor_name,'system');
 e.source:=COALESCE(NULLIF(current_setting('app.audit_source',true),''),'database/'||COALESCE(NULLIF(current_setting('application_name',true),''),session_user)||'/'||TG_TABLE_NAME);
 e.reason:=COALESCE(NULLIF(current_setting('ds2.reason',true),''),NULLIF(current_setting('app.audit_reason',true),''),r->>'reason',r->>'resolution_reason',r->>'note',r->>'notes');
 e.before_value:=b; e.after_value:=a;
 SELECT COALESCE(jsonb_object_agg(k,jsonb_build_object('before',b->k,'after',a->k)),'{}'::jsonb) INTO e.changes
 FROM (SELECT jsonb_object_keys(COALESCE(a,'{}')||COALESCE(b,'{}')) AS k) keys
 WHERE (b->k) IS DISTINCT FROM (a->k);
 e.previous_hash:=COALESCE(h.event_hash,repeat('0',64));
 e.event_hash:=ds2_audit_hash(e);
 INSERT INTO audit_events SELECT e.*;
 INSERT INTO audit_chain_heads VALUES(e.account_id,e.event_id,e.event_hash,COALESCE(h.event_count,0)+1)
 ON CONFLICT(account_id) DO UPDATE SET event_id=EXCLUDED.event_id,event_hash=EXCLUDED.event_hash,event_count=EXCLUDED.event_count;
 RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION ds2_verify_audit(aid integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE e audit_events; h audit_chain_heads; previous text:=repeat('0',64); n bigint:=0; last_id bigint;
BEGIN
 FOR e IN SELECT * FROM audit_events WHERE account_id=aid ORDER BY event_id LOOP
   IF e.previous_hash<>previous OR e.event_hash<>ds2_audit_hash(e) THEN
     RETURN jsonb_build_object('valid',false,'failed_event_id',e.event_id,'checked_events',n);
   END IF;
   previous:=e.event_hash; n:=n+1; last_id:=e.event_id;
 END LOOP;
 SELECT * INTO h FROM audit_chain_heads WHERE account_id=aid;
 RETURN jsonb_build_object('valid',CASE WHEN n=0 THEN h.account_id IS NULL ELSE h.account_id IS NOT NULL AND h.event_count=n AND h.event_id=last_id AND h.event_hash=previous END,
   'checked_events',n,'event_id',last_id,'hash',previous);
END $$;

DO $$
DECLARE t text; keys text[]; spec text;
BEGIN
 FOREACH spec IN ARRAY ARRAY[
  'customers:customer_id','customer_information:customer_info_id','customer_jobs:customer_job_id',
  'customer_transactions:transaction_id','customer_payments:payment_id','customer_writeoffs:writeoff_id',
  'customer_retainers_and_prepayments:retainer_id','customer_invoices:customer_invoice_id',
  'recurring_customers:recurring_customer_id','customer_rate_agreements:rate_agreement_id',
  'customer_job_types:job_type_id','customer_job_categories:customer_job_category_id',
  'customer_general_work_descriptions:general_work_description_id','customer_quotes:customer_quote_id',
  'users:user_id','accounts:account_id','account_information:account_info_id',
  'timesheet_entries:timesheet_entry_id','ai_time_tracker_transaction_suggestions:suggestion_id',
  'ai_category_training_examples:training_id','customer_payments_processed:payment_id',
  'retainer_events:event_id','duplicate_flags:duplicate_id','duplicate_history:history_id',
  'invoice_issues:invoice_id','invoice_statement_members:invoice_id:table_name:record_id',
  'invoice_exceptions:exception_id','invoice_exception_payments:exception_id:payment_id',
  'invoice_revisions:invoice_id:revision','invoice_history:history_id',
  'ledger_normalization_log:log_id','audit_records:record_id','audit_actions:action_id'
 ] LOOP
   keys:=string_to_array(spec,':'); t:=keys[1];
   IF to_regclass(t) IS NULL THEN RAISE EXCEPTION 'Missing audited table %',t; END IF;
   EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_capture ON %I',t);
   EXECUTE format('CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit(%s)',t,
     (SELECT string_agg(quote_literal(k),',') FROM unnest(keys[2:]) k));
   EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON %I',t);
   EXECUTE format('CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON %I EXECUTE FUNCTION ds2_audit_immutable()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['audit_events','audit_records','audit_actions','audit_policy'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_immutable ON %I',t);
   EXECUTE format('CREATE TRIGGER ds2_audit_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_audit_immutable()',t);
   EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON %I',t);
   EXECUTE format('CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON %I EXECUTE FUNCTION ds2_audit_immutable()',t);
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS ds2_audit_insert_guard ON audit_events;
CREATE TRIGGER ds2_audit_insert_guard BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ds2_audit_internal_only();
DROP TRIGGER IF EXISTS ds2_audit_head_guard ON audit_chain_heads;
CREATE TRIGGER ds2_audit_head_guard BEFORE INSERT OR UPDATE OR DELETE ON audit_chain_heads FOR EACH ROW EXECUTE FUNCTION ds2_audit_internal_only();
DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON audit_chain_heads;
CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON audit_chain_heads EXECUTE FUNCTION ds2_audit_immutable();
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON audit_events,audit_chain_heads FROM PUBLIC;
REVOKE UPDATE,DELETE,TRUNCATE ON audit_records,audit_actions,audit_policy FROM PUBLIC;
