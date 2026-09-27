SELECT set_config('app.audit_source','migration/040.receipt_conservation_and_opening_sources',true),set_config('app.audit_reason','Enforce complete receipt conservation and reviewed legacy source relationships',true);
CREATE OR REPLACE FUNCTION ds2_ar_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb;iid integer;BEGIN
 r:=to_jsonb(NEW);
 PERFORM pg_advisory_xact_lock(260026,NEW.account_id);
 PERFORM customer_id FROM customers WHERE account_id=NEW.account_id AND customer_id=NEW.customer_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AR client not found in this account' USING ERRCODE='P0404';END IF;
 iid:=COALESCE((r->>'original_invoice_id')::integer,(r->>'invoice_id')::integer,(r->>'carrying_invoice_id')::integer);
 IF iid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_invoices i WHERE i.account_id=NEW.account_id AND i.customer_id=NEW.customer_id AND i.customer_invoice_id=iid
 AND (ds2_effective_entity(i.account_id,'customer_invoices',i.customer_invoice_id,i.billing_entity_id)=NEW.billing_entity_id OR EXISTS(
 SELECT 1 FROM billing_cutover_allocations a WHERE a.account_id=i.account_id AND a.customer_id=i.customer_id AND a.source_root_id=i.customer_invoice_id AND a.billing_entity_id=NEW.billing_entity_id))) THEN
 RAISE EXCEPTION 'AR invoice belongs to another client or business' USING ERRCODE='P0409';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION ds2_receipt_conservation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE rid bigint;r payment_receipts;allocated numeric;available numeric;expected numeric;BEGIN
 IF TG_TABLE_NAME='payment_receipts' THEN rid:=NEW.receipt_id;
 ELSIF TG_TABLE_NAME='client_credit_lots' THEN rid:=NEW.origin_receipt_id;
 ELSIF TG_TABLE_NAME='ar_applications' THEN
 rid:=NEW.receipt_id;IF rid IS NULL THEN SELECT origin_receipt_id INTO rid FROM client_credit_lots WHERE credit_id=NEW.credit_id;END IF;
 ELSIF TG_TABLE_NAME='client_credit_events' THEN SELECT origin_receipt_id INTO rid FROM client_credit_lots WHERE credit_id=NEW.credit_id;
 ELSE rid:=NEW.receipt_id;END IF;
 IF rid IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO r FROM payment_receipts WHERE receipt_id=rid;
 IF r.source_kind<>'manual' THEN RETURN NULL;END IF;
 SELECT COALESCE(sum(a.amount*a.direction),0) INTO allocated FROM ar_applications a LEFT JOIN client_credit_lots l ON l.credit_id=a.credit_id WHERE a.receipt_id=rid OR l.origin_receipt_id=rid;
 SELECT COALESCE(sum(l.amount+COALESCE((SELECT sum(e.amount*e.direction) FROM client_credit_events e WHERE e.credit_id=l.credit_id),0)),0) INTO available FROM client_credit_lots l WHERE l.origin_receipt_id=rid;
 expected:=CASE WHEN EXISTS(SELECT 1 FROM receipt_events WHERE receipt_id=rid AND kind='reversed') THEN 0 ELSE r.amount END;
 IF allocated+available<>expected THEN RAISE EXCEPTION 'Receipt applications and available credit must reconcile to the complete receipt' USING ERRCODE='P0409';END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['payment_receipts','ar_applications','client_credit_lots','client_credit_events','receipt_events'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_receipt_conservation ON %I',t);
 EXECUTE format('CREATE CONSTRAINT TRIGGER ds2_receipt_conservation AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ds2_receipt_conservation()',t);
 END LOOP;
END $$;
