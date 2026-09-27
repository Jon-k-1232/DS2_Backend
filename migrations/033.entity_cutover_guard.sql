-- Shared triggers must access optional invoice fields through JSON.
SELECT set_config('app.audit_source','migration/033.entity_cutover_guard',true);
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
 IF TG_OP IN('UPDATE','DELETE') AND TG_TABLE_NAME='customer_invoices' AND EXISTS(SELECT 1 FROM billing_cutover_allocations a WHERE a.account_id=(r->>'account_id')::integer AND a.source_root_id=COALESCE((r->>'parent_invoice_id')::integer,(r->>'customer_invoice_id')::integer) AND (r->>'created_at')::timestamp<=(a.created_at AT TIME ZONE 'UTC')) THEN
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
