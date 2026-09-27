-- Forward safeguards and historical source attribution. Plain SQL, idempotent.
SELECT set_config('app.audit_source','migration/030.entity_safeguards',true),set_config('app.audit_reason','Owner-authorized source attribution and entity integrity',true);
-- Analytics can attribute verified historical tracker sources without changing
-- raw tracker text or row values. Ambiguous names remain explicitly unassigned.
INSERT INTO legacy_financial_entity_attributions(account_id,customer_id,table_name,record_id,billing_entity_id,cutover_id,basis,source_sha256)
 SELECT t.account_id,t.suggested_customer_id,'timesheet_entries',t.timesheet_entry_id,m.ids[1],c.cutover_id,
 'Exact normalized tracker name at entity cutover',encode(sha256(convert_to((to_jsonb(t)-'billing_entity_id')::text,'UTF8')),'hex')
 FROM timesheet_entries t JOIN billing_cutovers c ON c.account_id=t.account_id AND c.source='migration/028/default'
 CROSS JOIN LATERAL(SELECT ds2_entity_match(t.account_id,t.entity) AS ids)m
 WHERE t.billing_entity_id IS NULL AND cardinality(m.ids)=1
 ON CONFLICT(account_id,table_name,record_id) DO NOTHING;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS billing_entity_id integer;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='audit_records_billing_entity_fk') THEN
  ALTER TABLE audit_records ADD CONSTRAINT audit_records_billing_entity_fk FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id);
 END IF;
END $$;
-- Each sequence has a distinct ledger identity even across years.
DROP TRIGGER IF EXISTS ds2_audit_capture ON billing_entity_invoice_sequences;
CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON billing_entity_invoice_sequences FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit('billing_entity_id','year');
CREATE OR REPLACE FUNCTION ds2_guard_billing_entity() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb;oldr jsonb;eid integer;old_eid integer;ctx integer;target integer;ref integer;spec text;rt text;rk text;col text;cid integer;locked text;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 ctx:=NULLIF(current_setting('app.billing_entity_id',true),'')::integer;
 eid:=ds2_effective_entity((r->>'account_id')::integer,TG_TABLE_NAME,(r->>TG_ARGV[0])::integer,(r->>'billing_entity_id')::integer);
 IF TG_OP='INSERT' THEN
  -- Internal evidence inherits its linked source, never today's default.
  IF NEW.billing_entity_id IS NULL AND TG_TABLE_NAME='retainer_events' THEN
   SELECT ds2_effective_entity(account_id,'customer_retainers_and_prepayments',retainer_id,billing_entity_id) INTO target
   FROM customer_retainers_and_prepayments WHERE account_id=NEW.account_id AND retainer_id=(r->>'root_retainer_id')::integer;
  ELSIF NEW.billing_entity_id IS NULL AND TG_TABLE_NAME='invoice_issues' THEN
   SELECT ds2_effective_entity(account_id,'customer_invoices',customer_invoice_id,billing_entity_id) INTO target
   FROM customer_invoices WHERE account_id=NEW.account_id AND customer_invoice_id=(r->>'invoice_id')::integer;
  END IF;
  NEW.billing_entity_id:=COALESCE(NEW.billing_entity_id,ctx,target);eid:=NEW.billing_entity_id;r:=to_jsonb(NEW);
 END IF;
 IF TG_TABLE_NAME IN ('timesheet_entries','ai_time_tracker_transaction_suggestions','customer_jobs','customer_payments_processed') AND eid IS NULL THEN RETURN COALESCE(NEW,OLD);END IF;
 IF eid IS NULL AND TG_OP='INSERT' THEN RAISE EXCEPTION 'Choose a billing entity' USING ERRCODE='P0400';END IF;
 IF ctx IS NOT NULL AND eid IS NOT NULL AND ctx<>eid THEN RAISE EXCEPTION 'The record belongs to another billing entity' USING ERRCODE='P0409';END IF;
 IF TG_OP='UPDATE' THEN
  oldr:=to_jsonb(OLD);old_eid:=ds2_effective_entity(OLD.account_id,TG_TABLE_NAME,(oldr->>TG_ARGV[0])::integer,OLD.billing_entity_id);
  IF OLD.billing_entity_id IS DISTINCT FROM NEW.billing_entity_id THEN
   locked:=ds2_locked_invoice(TG_TABLE_NAME,(oldr->>TG_ARGV[0])::integer,OLD.account_id);
   IF locked IS NOT NULL THEN RAISE EXCEPTION 'Entity cannot change on sent invoice %',locked USING ERRCODE='P0409';END IF;
   IF NULLIF(btrim(current_setting('ds2.reason',true)),'') IS NULL THEN RAISE EXCEPTION 'Entity reclassification requires a reason' USING ERRCODE='P0400';END IF;
   IF NOT EXISTS(SELECT 1 FROM users WHERE account_id=OLD.account_id AND user_id=NULLIF(current_setting('app.actor_user_id',true),'')::integer AND lower(access_level) IN('admin','super admin')) THEN
    RAISE EXCEPTION 'Only admins can reclassify work' USING ERRCODE='P0403';END IF;
  END IF;
 END IF;
 IF eid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_entities WHERE account_id=(r->>'account_id')::integer AND billing_entity_id=eid) THEN RAISE EXCEPTION 'Billing entity not found in this account' USING ERRCODE='P0404';END IF;
 IF TG_OP='INSERT' AND eid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_entities WHERE billing_entity_id=eid AND active)
 AND NULLIF(current_setting('ds2.reason',true),'') IS NULL THEN RAISE EXCEPTION 'Billing entity is inactive' USING ERRCODE='P0409';END IF;
 -- Deterministic same-account/customer/entity links, including internal snapshots.
 IF TG_OP<>'DELETE' THEN
 FOREACH spec IN ARRAY ARRAY['customer_invoice_id:customer_invoices:customer_invoice_id','parent_invoice_id:customer_invoices:customer_invoice_id','invoice_id:customer_invoices:customer_invoice_id','retainer_id:customer_retainers_and_prepayments:retainer_id','parent_retainer_id:customer_retainers_and_prepayments:retainer_id','root_retainer_id:customer_retainers_and_prepayments:retainer_id','customer_job_id:customer_jobs:customer_job_id'] LOOP
  col:=split_part(spec,':',1);rt:=split_part(spec,':',2);rk:=split_part(spec,':',3);
  IF col=TG_ARGV[0] OR TG_TABLE_NAME IN ('customer_payments_processed','timesheet_entries','ai_time_tracker_transaction_suggestions') THEN CONTINUE;END IF;
  ref:=NULLIF(r->>col,'')::integer;
  IF ref IS NOT NULL AND ref>0 AND(TG_OP='INSERT' OR oldr->col IS DISTINCT FROM r->col OR old_eid IS DISTINCT FROM eid) THEN
   EXECUTE format('SELECT ds2_effective_entity(account_id,%L,%I,billing_entity_id),customer_id FROM %I WHERE account_id=$1 AND %I=$2',rt,rk,rt,rk) INTO target,cid USING (r->>'account_id')::integer,ref;
   IF cid IS NULL OR cid IS DISTINCT FROM (r->>'customer_id')::integer OR(target IS DISTINCT FROM eid AND NOT(rt='customer_jobs' AND target IS NULL)) THEN
    RAISE EXCEPTION 'Selected % belongs to another client or entity',col USING ERRCODE='P0409';
   END IF;
  END IF;
 END LOOP;
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;

-- Final-state validation allows atomic default replacement but never a commit
-- with no active default. Lock order matches application account-first writes.
CREATE OR REPLACE FUNCTION ds2_entity_default_invariant() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM accounts WHERE account_id=COALESCE(NEW.account_id,OLD.account_id)) AND NOT EXISTS(
  SELECT 1 FROM billing_entities WHERE account_id=COALESCE(NEW.account_id,OLD.account_id) AND active AND is_default) THEN
  RAISE EXCEPTION 'An active default business is required' USING ERRCODE='P0409';
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ds2_entity_default_invariant ON billing_entities;
CREATE CONSTRAINT TRIGGER ds2_entity_default_invariant AFTER INSERT OR UPDATE OR DELETE ON billing_entities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ds2_entity_default_invariant();
CREATE OR REPLACE FUNCTION ds2_entity_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(260026,COALESCE(NEW.account_id,OLD.account_id));
 IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active THEN
  IF EXISTS(
   SELECT 1 FROM customer_invoices p CROSS JOIN LATERAL(
    SELECT s.remaining_balance_on_invoice FROM customer_invoices s WHERE s.account_id=p.account_id
     AND(s.customer_invoice_id=p.customer_invoice_id OR s.parent_invoice_id=p.customer_invoice_id) ORDER BY s.created_at DESC,s.customer_invoice_id DESC LIMIT 1)s
   WHERE p.account_id=OLD.account_id AND p.parent_invoice_id IS NULL
    AND ds2_effective_entity(p.account_id,'customer_invoices',p.customer_invoice_id,p.billing_entity_id)=OLD.billing_entity_id
    AND p.invoice_date=(SELECT max(q.invoice_date) FROM customer_invoices q WHERE q.account_id=p.account_id AND q.customer_id=p.customer_id AND q.parent_invoice_id IS NULL
     AND ds2_effective_entity(q.account_id,'customer_invoices',q.customer_invoice_id,q.billing_entity_id)=OLD.billing_entity_id)
    AND s.remaining_balance_on_invoice<>0
  ) OR EXISTS(
   SELECT 1 FROM customer_retainers_and_prepayments r CROSS JOIN LATERAL(
    SELECT s.current_amount FROM customer_retainers_and_prepayments s WHERE s.account_id=r.account_id
    AND(s.retainer_id=r.retainer_id OR s.parent_retainer_id=r.retainer_id) ORDER BY s.created_at DESC,s.retainer_id DESC LIMIT 1)s
   WHERE r.account_id=OLD.account_id AND r.parent_retainer_id IS NULL
    AND ds2_effective_entity(r.account_id,'customer_retainers_and_prepayments',r.retainer_id,r.billing_entity_id)=OLD.billing_entity_id AND s.current_amount<>0
  ) THEN RAISE EXCEPTION 'This business has open balances or held funds' USING ERRCODE='P0409';END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.invoice_prefix<>NEW.invoice_prefix AND EXISTS(SELECT 1 FROM billing_entity_invoice_sequences WHERE account_id=OLD.account_id AND billing_entity_id=OLD.billing_entity_id) THEN
  RAISE EXCEPTION 'An issued number prefix is permanent' USING ERRCODE='P0409';END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS ds2_entity_settings_guard ON billing_entities;
CREATE TRIGGER ds2_entity_settings_guard BEFORE INSERT OR UPDATE OR DELETE ON billing_entities FOR EACH ROW EXECUTE FUNCTION ds2_entity_settings_guard();
CREATE OR REPLACE FUNCTION ds2_entity_sequence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.last_number<OLD.last_number OR NEW.billing_entity_id<>OLD.billing_entity_id OR NEW.year<>OLD.year THEN
  RAISE EXCEPTION 'Invoice numbering cannot move backwards or change business' USING ERRCODE='P0409';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ds2_entity_sequence_guard ON billing_entity_invoice_sequences;
CREATE TRIGGER ds2_entity_sequence_guard BEFORE UPDATE OR DELETE ON billing_entity_invoice_sequences FOR EACH ROW EXECUTE FUNCTION ds2_entity_sequence_guard();
