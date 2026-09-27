-- Reviewed slices route opening balances without changing an issued source row.
SELECT set_config('app.audit_source','migration/032.entity_cutover_slices',true);
CREATE TABLE IF NOT EXISTS billing_cutover_allocations (
 allocation_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL,
 billing_entity_id integer NOT NULL, cutover_id integer NOT NULL, position_id bigint NOT NULL REFERENCES billing_cutover_positions(position_id),
 source_root_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id),
 source_snapshot_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id),
 opening_amount numeric(14,2) NOT NULL CHECK(opening_amount<>0), source_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,source_root_id,billing_entity_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id),
 FOREIGN KEY(account_id,cutover_id) REFERENCES billing_cutovers(account_id,cutover_id)
);
CREATE TABLE IF NOT EXISTS billing_cutover_allocation_links (
 link_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL,
 billing_entity_id integer NOT NULL, allocation_id bigint NOT NULL UNIQUE REFERENCES billing_cutover_allocations(allocation_id),
 invoice_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
DO $$ DECLARE spec text;t text;k text;BEGIN
 FOREACH spec IN ARRAY ARRAY['billing_cutover_allocations:allocation_id','billing_cutover_allocation_links:link_id'] LOOP
 t:=split_part(spec,':',1);k:=split_part(spec,':',2);
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_capture ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit(%L)',t,k);
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_immutable ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_audit_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_audit_immutable()',t);
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON %I EXECUTE FUNCTION ds2_audit_immutable()',t);
 END LOOP;
END $$;
-- Validate the whole source group at COMMIT, after all slices have been added.
CREATE OR REPLACE FUNCTION ds2_cutover_slice_integrity() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p billing_cutover_positions; n numeric;BEGIN
 SELECT * INTO p FROM billing_cutover_positions WHERE position_id=NEW.position_id;
 IF p.account_id<>NEW.account_id OR p.customer_id<>NEW.customer_id OR p.source_root_id<>NEW.source_root_id OR p.source_snapshot_id<>NEW.source_snapshot_id OR p.source_sha256<>NEW.source_sha256 THEN
  RAISE EXCEPTION 'Cutover source ownership or evidence changed' USING ERRCODE='P0409';END IF;
 SELECT sum(opening_amount) INTO n FROM billing_cutover_allocations WHERE position_id=p.position_id;
 IF n<>p.opening_amount OR EXISTS(SELECT 1 FROM billing_cutover_allocations WHERE position_id=p.position_id AND sign(opening_amount)<>sign(p.opening_amount)) THEN
  RAISE EXCEPTION 'Opening slices must equal the source balance, with the same sign' USING ERRCODE='P0409';END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ds2_cutover_slice_integrity ON billing_cutover_allocations;
CREATE CONSTRAINT TRIGGER ds2_cutover_slice_integrity AFTER INSERT ON billing_cutover_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ds2_cutover_slice_integrity();
-- Financial readers see each opening slice INSTEAD OF its old aggregate chain.
-- Existing public rows and frozen issue/PDF evidence are never updated.
-- New child snapshots use the old root identity plus the selected company.
-- Effective legacy entity must still be exposed by the view's output, not only
-- its predicate. Rebuild the column projection without changing its row type.
DO $$ DECLARE cols text;BEGIN
 SELECT string_agg('q.'||quote_ident(column_name),', ' ORDER BY ordinal_position) INTO cols FROM information_schema.columns
 WHERE table_schema='public' AND table_name='customer_invoices' AND column_name<>'billing_entity_id';
 EXECUTE 'CREATE OR REPLACE VIEW billing_scope.customer_invoices AS SELECT '||cols||',public.ds2_effective_entity(q.account_id,''customer_invoices'',q.customer_invoice_id,q.billing_entity_id) AS billing_entity_id FROM (
 SELECT r.* FROM public.customer_invoices r WHERE NOT EXISTS(SELECT 1 FROM public.billing_cutover_allocations a WHERE a.account_id=r.account_id AND a.source_root_id=COALESCE(r.parent_invoice_id,r.customer_invoice_id) AND(r.parent_invoice_id IS NULL OR r.created_at<=(a.created_at AT TIME ZONE ''UTC'')))
 UNION ALL SELECT (jsonb_populate_record(NULL::public.customer_invoices,to_jsonb(p)||jsonb_build_object(''billing_entity_id'',a.billing_entity_id,''remaining_balance_on_invoice'',a.opening_amount,''total_amount_due'',a.opening_amount,''beginning_balance'',a.opening_amount,''total_charges'',0,''total_payments'',0,''total_write_offs'',0,''total_retainers'',0,''is_invoice_paid_in_full'',false,''notes'',concat_ws('' '',p.notes,''Legacy opening balance attributed to this business.'')))).* FROM public.billing_cutover_allocations a JOIN public.customer_invoices p ON p.account_id=a.account_id AND p.customer_invoice_id=a.source_root_id
 )q WHERE NULLIF(current_setting(''app.billing_entity_id'',true),'''') IS NULL OR public.ds2_effective_entity(q.account_id,''customer_invoices'',q.customer_invoice_id,q.billing_entity_id)=NULLIF(current_setting(''app.billing_entity_id'',true),'''')::integer';
END $$;
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
 IF TG_OP IN('UPDATE','DELETE') AND TG_TABLE_NAME='customer_invoices' AND EXISTS(SELECT 1 FROM billing_cutover_allocations a WHERE a.account_id=OLD.account_id AND a.source_root_id=COALESCE(OLD.parent_invoice_id,OLD.customer_invoice_id) AND OLD.created_at<=(a.created_at AT TIME ZONE 'UTC')) THEN
  RAISE EXCEPTION 'The original cutover source is immutable; append a business snapshot' USING ERRCODE='P0409';END IF;
 IF TG_OP='UPDATE' THEN
  oldr:=to_jsonb(OLD);old_eid:=ds2_effective_entity(OLD.account_id,TG_TABLE_NAME,(oldr->>TG_ARGV[0])::integer,OLD.billing_entity_id);
  IF OLD.billing_entity_id IS DISTINCT FROM NEW.billing_entity_id AND NOT(TG_TABLE_NAME='customer_payments_processed' AND oldr->>'is_processed'='false' AND OLD.billing_entity_id IS NULL) THEN
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
   IF cid IS NULL OR cid IS DISTINCT FROM (r->>'customer_id')::integer OR(target IS DISTINCT FROM eid AND NOT(rt='customer_jobs' AND target IS NULL) AND NOT(rt='customer_invoices' AND ((TG_TABLE_NAME='customer_invoices' AND col='parent_invoice_id') OR (TG_TABLE_NAME IN('customer_payments','customer_writeoffs') AND col='customer_invoice_id')) AND EXISTS(SELECT 1 FROM billing_cutover_allocations a WHERE a.account_id=(r->>'account_id')::integer AND a.customer_id=cid AND a.source_root_id=ref AND a.billing_entity_id=eid))) THEN
    RAISE EXCEPTION 'Selected % belongs to another client or entity',col USING ERRCODE='P0409';
   END IF;
  END IF;
 END LOOP;
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;



CREATE OR REPLACE FUNCTION ds2_cutover_link_integrity() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE a billing_cutover_allocations;i customer_invoices;BEGIN
 SELECT * INTO a FROM billing_cutover_allocations WHERE allocation_id=NEW.allocation_id;
 SELECT * INTO i FROM customer_invoices WHERE customer_invoice_id=NEW.invoice_id;
 IF a.account_id<>NEW.account_id OR a.customer_id<>NEW.customer_id OR a.billing_entity_id<>NEW.billing_entity_id OR i.account_id<>NEW.account_id OR i.customer_id<>NEW.customer_id OR i.billing_entity_id<>NEW.billing_entity_id THEN
 RAISE EXCEPTION 'Cutover consumption belongs to another account, client or business' USING ERRCODE='P0409';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ds2_cutover_link_integrity ON billing_cutover_allocation_links;
CREATE TRIGGER ds2_cutover_link_integrity BEFORE INSERT ON billing_cutover_allocation_links FOR EACH ROW EXECUTE FUNCTION ds2_cutover_link_integrity();
