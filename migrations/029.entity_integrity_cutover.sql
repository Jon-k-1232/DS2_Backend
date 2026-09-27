-- Integrity, cutover provenance, retry-safe transfers. No legacy business-row update.
SELECT set_config('app.audit_source','migration/029.entity_integrity_cutover',true),set_config('app.audit_reason','Owner-authorized default legacy opening positions',true);
CREATE TABLE IF NOT EXISTS billing_cutover_positions (
 position_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL,
 billing_entity_id integer NOT NULL, cutover_id integer NOT NULL,
 source_root_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id),
 source_snapshot_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id),
 opening_amount numeric(14,2) NOT NULL, source_sha256 text NOT NULL, basis text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,source_root_id), FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id),
 FOREIGN KEY(account_id,cutover_id) REFERENCES billing_cutovers(account_id,cutover_id)
);
CREATE TABLE IF NOT EXISTS billing_cutover_links (
 link_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL,
 billing_entity_id integer NOT NULL, position_id bigint NOT NULL UNIQUE REFERENCES billing_cutover_positions(position_id),
 invoice_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
CREATE TABLE IF NOT EXISTS financial_requests (
 request_id uuid PRIMARY KEY, account_id integer NOT NULL REFERENCES accounts(account_id), customer_id integer NOT NULL,
 operation text NOT NULL, idempotency_key uuid NOT NULL, input_hash text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(account_id,operation,idempotency_key)
);
CREATE TABLE IF NOT EXISTS billing_credit_transfers (
 transfer_id uuid PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL REFERENCES customers(customer_id),
 billing_entity_id integer NOT NULL, destination_entity_id integer NOT NULL,
 source_retainer_id integer NOT NULL REFERENCES customer_retainers_and_prepayments(retainer_id),
 source_snapshot_id integer NOT NULL UNIQUE REFERENCES customer_retainers_and_prepayments(retainer_id),
 destination_retainer_id integer NOT NULL UNIQUE REFERENCES customer_retainers_and_prepayments(retainer_id),
 amount numeric(10,2) NOT NULL CHECK(amount>0), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(billing_entity_id<>destination_entity_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id),
 FOREIGN KEY(account_id,destination_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
DO $$ DECLARE spec text;t text;k text; BEGIN
 FOREACH spec IN ARRAY ARRAY['billing_cutover_positions:position_id','billing_cutover_links:link_id','financial_requests:request_id','billing_credit_transfers:transfer_id'] LOOP
 t:=split_part(spec,':',1);k:=split_part(spec,':',2);
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_capture ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit(%L)',t,k);
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON %I EXECUTE FUNCTION ds2_audit_immutable()',t);
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_immutable ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_audit_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_audit_immutable()',t);
 END LOOP;
END $$;
INSERT INTO billing_cutover_positions(account_id,customer_id,billing_entity_id,cutover_id,source_root_id,source_snapshot_id,opening_amount,source_sha256,basis)
 SELECT p.account_id,p.customer_id,a.billing_entity_id,a.cutover_id,p.customer_invoice_id,s.customer_invoice_id,s.remaining_balance_on_invoice,
 encode(sha256(convert_to((to_jsonb(s)-'billing_entity_id')::text,'UTF8')),'hex'),'Default routing of existing live balance; not an additional charge'
 FROM customer_invoices p JOIN legacy_financial_entity_attributions a ON a.account_id=p.account_id AND a.table_name='customer_invoices' AND a.record_id=p.customer_invoice_id
 CROSS JOIN LATERAL(SELECT ch.* FROM customer_invoices ch WHERE ch.account_id=p.account_id AND(ch.customer_invoice_id=p.customer_invoice_id OR ch.parent_invoice_id=p.customer_invoice_id) ORDER BY ch.created_at DESC,ch.customer_invoice_id DESC LIMIT 1)s
 WHERE p.parent_invoice_id IS NULL AND p.invoice_date=(SELECT max(q.invoice_date) FROM customer_invoices q WHERE q.account_id=p.account_id AND q.customer_id=p.customer_id AND q.parent_invoice_id IS NULL)
 AND s.remaining_balance_on_invoice<>0 ON CONFLICT(account_id,source_root_id) DO NOTHING;
CREATE OR REPLACE FUNCTION ds2_guard_billing_entity() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb;oldr jsonb;eid integer;old_eid integer;ctx integer;target integer;ref integer;spec text;rt text;rk text;col text;cid integer;locked text;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 ctx:=NULLIF(current_setting('app.billing_entity_id',true),'')::integer;
 eid:=ds2_effective_entity((r->>'account_id')::integer,TG_TABLE_NAME,(r->>TG_ARGV[0])::integer,(r->>'billing_entity_id')::integer);
 IF TG_OP='INSERT' THEN
  NEW.billing_entity_id:=COALESCE(NEW.billing_entity_id,ctx);eid:=NEW.billing_entity_id;r:=to_jsonb(NEW);
 END IF;
 IF TG_TABLE_NAME IN ('timesheet_entries','ai_time_tracker_transaction_suggestions','customer_jobs','customer_payments_processed') AND eid IS NULL THEN RETURN COALESCE(NEW,OLD);END IF;
 IF eid IS NULL AND TG_OP='INSERT' THEN RAISE EXCEPTION 'Choose a billing entity' USING ERRCODE='P0400';END IF;
 IF ctx IS NOT NULL AND eid IS NOT NULL AND ctx<>eid THEN RAISE EXCEPTION 'The record belongs to another billing entity' USING ERRCODE='P0409';END IF;
 IF TG_OP='UPDATE' THEN
  oldr:=to_jsonb(OLD);old_eid:=ds2_effective_entity(OLD.account_id,TG_TABLE_NAME,(oldr->>TG_ARGV[0])::integer,OLD.billing_entity_id);
  IF OLD.billing_entity_id IS DISTINCT FROM NEW.billing_entity_id THEN
   locked:=ds2_locked_invoice(TG_TABLE_NAME,(oldr->>TG_ARGV[0])::integer,OLD.account_id);
   IF locked IS NOT NULL THEN RAISE EXCEPTION 'Entity cannot change on sent invoice %',locked USING ERRCODE='P0409';END IF;
   IF NULLIF(current_setting('ds2.reason',true),'') IS NULL THEN RAISE EXCEPTION 'Entity reclassification requires a reason' USING ERRCODE='P0400';END IF;
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
DO $$ DECLARE spec text;t text;k text; BEGIN
 FOREACH spec IN ARRAY ARRAY['customer_transactions:transaction_id','customer_payments:payment_id','customer_writeoffs:writeoff_id','customer_retainers_and_prepayments:retainer_id','customer_invoices:customer_invoice_id','retainer_events:event_id','invoice_issues:invoice_id','recurring_customers:recurring_customer_id','customer_quotes:customer_quote_id','customer_jobs:customer_job_id','customer_payments_processed:payment_id','timesheet_entries:timesheet_entry_id','ai_time_tracker_transaction_suggestions:suggestion_id'] LOOP
 t:=split_part(spec,':',1);k:=split_part(spec,':',2);
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_billing_entity_guard ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_billing_entity_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_guard_billing_entity(%L)',t,k);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION ds2_seed_account_entity() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO billing_entities(account_id,name,legal_name,invoice_prefix,is_default) VALUES(NEW.account_id,NEW.account_name,NEW.account_name,'INV',true);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ds2_seed_account_entity ON accounts;
CREATE TRIGGER ds2_seed_account_entity AFTER INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION ds2_seed_account_entity();
-- A transferred snapshot is immutable evidence, even before the next statement.
CREATE OR REPLACE FUNCTION ds2_guard_transferred_credit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM billing_credit_transfers WHERE source_snapshot_id=OLD.retainer_id OR destination_retainer_id=OLD.retainer_id OR source_retainer_id=OLD.retainer_id) THEN
  RAISE EXCEPTION 'Transferred credit is immutable; append a reasoned event' USING ERRCODE='P0409';
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS ds2_transferred_credit ON customer_retainers_and_prepayments;
CREATE TRIGGER ds2_transferred_credit BEFORE UPDATE OR DELETE ON customer_retainers_and_prepayments FOR EACH ROW EXECUTE FUNCTION ds2_guard_transferred_credit();

-- Preserve sent locks within the same business.
CREATE OR REPLACE FUNCTION ds2_locked_invoice(t text, rid integer, aid integer)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE n text; r jsonb; key text;
BEGIN
 SELECT i.invoice_number INTO n FROM invoice_statement_members m JOIN invoice_issues i USING(account_id,invoice_id)
 WHERE m.account_id=aid AND m.table_name=t AND m.record_id=rid ORDER BY i.issued_at,m.invoice_id LIMIT 1;
 IF n IS NOT NULL THEN RETURN n; END IF;
 key := CASE t WHEN 'customer_invoices' THEN 'customer_invoice_id' WHEN 'customer_transactions' THEN 'transaction_id'
 WHEN 'customer_payments' THEN 'payment_id' WHEN 'customer_writeoffs' THEN 'writeoff_id'
 WHEN 'customer_retainers_and_prepayments' THEN 'retainer_id' ELSE NULL END;
 IF key IS NULL THEN RETURN NULL; END IF;
 EXECUTE format('SELECT to_jsonb(r) FROM %I r WHERE account_id=$1 AND %I=$2',t,key) INTO r USING aid,rid;
 IF r IS NULL THEN RETURN NULL; END IF;
 SELECT p.invoice_number INTO n FROM customer_invoices p, invoice_lock_policy policy
 WHERE p.account_id=aid AND p.customer_id=(r->>'customer_id')::integer AND p.parent_invoice_id IS NULL
 AND p.created_at < policy.legacy_before AND NULLIF(p.invoice_file_location,'') IS NOT NULL
 AND ds2_effective_entity(p.account_id,'customer_invoices',p.customer_invoice_id,p.billing_entity_id) IS NOT DISTINCT FROM ds2_effective_entity(aid,t,rid,(r->>'billing_entity_id')::integer)
 AND ((t='customer_invoices' AND p.customer_invoice_id=rid)
 OR (t IN ('customer_transactions','customer_payments','customer_writeoffs') AND p.customer_invoice_id=(r->>'customer_invoice_id')::integer)
 OR (t <> 'customer_transactions' AND (r->>'created_at')::timestamp <= p.created_at))
 ORDER BY p.created_at,p.customer_invoice_id LIMIT 1;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION ds2_guard_sent_record() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb; n text; key text; cid integer; aid integer;
BEGIN
 r := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 cid := (r->>'customer_id')::integer; aid := (r->>'account_id')::integer;
 -- Serializes raw imports with the application's finalize boundary too.
 PERFORM customer_id FROM customers WHERE account_id=aid AND customer_id=cid FOR NO KEY UPDATE;
 key := TG_ARGV[0];
 IF TG_OP <> 'INSERT' THEN
   n := ds2_locked_invoice(TG_TABLE_NAME,(to_jsonb(OLD)->>key)::integer,OLD.account_id);
 END IF;
 IF n IS NULL AND TG_TABLE_NAME IN ('customer_transactions','customer_payments','customer_writeoffs') AND TG_OP <> 'DELETE' THEN
   IF TG_OP='INSERT' OR (to_jsonb(OLD)->>'customer_invoice_id') IS DISTINCT FROM (r->>'customer_invoice_id') THEN
     n := ds2_locked_invoice('customer_invoices',(r->>'customer_invoice_id')::integer,aid);
   END IF;
 END IF;
 IF n IS NULL AND TG_OP='INSERT' AND TG_TABLE_NAME <> 'customer_transactions' THEN
   SELECT invoice_number INTO n FROM invoice_issues WHERE account_id=aid AND customer_id=cid
   AND ds2_effective_entity(account_id,'invoice_issues',invoice_id,billing_entity_id) IS NOT DISTINCT FROM ds2_effective_entity(aid,TG_TABLE_NAME,(r->>key)::integer,(r->>'billing_entity_id')::integer)
   AND (r->>'created_at')::timestamp <= issued_at ORDER BY issued_at DESC LIMIT 1;
 END IF;
 IF n IS NOT NULL THEN RAISE EXCEPTION 'locked: part of sent invoice %', n USING ERRCODE='P0409'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
