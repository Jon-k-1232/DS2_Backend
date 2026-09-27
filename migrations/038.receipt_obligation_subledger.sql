-- True debt ages and immutable receipt/application/credit evidence.
SELECT set_config('app.audit_source','migration/038.receipt_obligation_subledger',true),set_config('app.audit_reason','Owner-authorized receipt and obligation subledger; no source-row backfill',true);
CREATE TABLE IF NOT EXISTS ar_derivations (
 derivation_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 manifest jsonb NOT NULL,manifest_sha256 text NOT NULL,as_of date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,customer_id,billing_entity_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
CREATE TABLE IF NOT EXISTS ar_obligations (
 obligation_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 original_invoice_id integer REFERENCES customer_invoices(customer_invoice_id),source_key text NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0),gross_charges numeric(14,2),price_adjustments numeric(14,2),
 obligation_date date,due_date date,effective_date date NOT NULL,source_kind text NOT NULL,derivation_label text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,source_key),UNIQUE(account_id,customer_id,billing_entity_id,obligation_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
CREATE TABLE IF NOT EXISTS payment_receipts (
 receipt_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0),receipt_date date NOT NULL,method text NOT NULL,
 reference text,source_kind text NOT NULL DEFAULT 'manual',source_key text,reason text,created_by integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,source_key),UNIQUE(account_id,receipt_id),UNIQUE(account_id,customer_id,billing_entity_id,receipt_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
CREATE TABLE IF NOT EXISTS client_credit_lots (
 credit_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0),kind text NOT NULL CHECK(kind IN('held_receipt','statement_credit')),
 receipt_id bigint,origin_receipt_id bigint,source_key text NOT NULL,effective_date date NOT NULL,
 original_invoice_id integer REFERENCES customer_invoices(customer_invoice_id),derivation_label text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(account_id,source_key),UNIQUE(account_id,customer_id,billing_entity_id,credit_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,receipt_id) REFERENCES payment_receipts(account_id,customer_id,billing_entity_id,receipt_id),
 FOREIGN KEY(account_id,origin_receipt_id) REFERENCES payment_receipts(account_id,receipt_id)
);
CREATE TABLE IF NOT EXISTS ar_applications (
 application_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 obligation_id bigint NOT NULL,receipt_id bigint,credit_id bigint,amount numeric(14,2) NOT NULL CHECK(amount>0),
 direction smallint NOT NULL DEFAULT 1 CHECK(direction IN(1,-1)),reversal_of bigint UNIQUE REFERENCES ar_applications(application_id),
 source_kind text NOT NULL,source_key text NOT NULL,compatibility_payment_id integer REFERENCES customer_payments(payment_id),
 compatibility_writeoff_id integer REFERENCES customer_writeoffs(writeoff_id),carrying_invoice_id integer REFERENCES customer_invoices(customer_invoice_id),
 effective_date date NOT NULL,reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((direction=1 AND reversal_of IS NULL) OR (direction=-1 AND reversal_of IS NOT NULL)),
 UNIQUE(account_id,source_key),UNIQUE(account_id,customer_id,billing_entity_id,application_id),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,obligation_id) REFERENCES ar_obligations(account_id,customer_id,billing_entity_id,obligation_id),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,receipt_id) REFERENCES payment_receipts(account_id,customer_id,billing_entity_id,receipt_id),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,credit_id) REFERENCES client_credit_lots(account_id,customer_id,billing_entity_id,credit_id)
);
CREATE INDEX IF NOT EXISTS ar_application_obligation ON ar_applications(obligation_id,effective_date,created_at);
CREATE INDEX IF NOT EXISTS ar_application_payment ON ar_applications(compatibility_payment_id);
CREATE TABLE IF NOT EXISTS client_credit_events (
 event_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 credit_id bigint NOT NULL,amount numeric(14,2) NOT NULL CHECK(amount>0),direction smallint NOT NULL CHECK(direction IN(1,-1)),
 kind text NOT NULL,application_id bigint REFERENCES ar_applications(application_id),transfer_key uuid,
 reversal_of bigint UNIQUE REFERENCES client_credit_events(event_id),effective_date date NOT NULL,reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,credit_id) REFERENCES client_credit_lots(account_id,customer_id,billing_entity_id,credit_id)
);
CREATE TABLE IF NOT EXISTS receipt_events (
 event_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 receipt_id bigint NOT NULL,kind text NOT NULL,reason text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',
 effective_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,receipt_id) REFERENCES payment_receipts(account_id,customer_id,billing_entity_id,receipt_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS receipt_one_reversal ON receipt_events(receipt_id) WHERE kind='reversed';
CREATE TABLE IF NOT EXISTS ar_obligation_carriers (
 carrier_id bigserial PRIMARY KEY,account_id integer NOT NULL,customer_id integer NOT NULL,billing_entity_id integer NOT NULL,
 obligation_id bigint NOT NULL,invoice_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id),
 effective_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(obligation_id,invoice_id),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,obligation_id) REFERENCES ar_obligations(account_id,customer_id,billing_entity_id,obligation_id)
);
-- Every write is captured in the same transaction, and never silently edited.
DO $$ DECLARE spec text;t text;k text; BEGIN
 FOREACH spec IN ARRAY ARRAY['ar_derivations:derivation_id','ar_obligations:obligation_id','payment_receipts:receipt_id','ar_applications:application_id','client_credit_lots:credit_id','client_credit_events:event_id','receipt_events:event_id','ar_obligation_carriers:carrier_id'] LOOP
  t:=split_part(spec,':',1);k:=split_part(spec,':',2);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_capture ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit(%L)',t,k);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_immutable ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_audit_immutable()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON %I EXECUTE FUNCTION ds2_audit_immutable()',t);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(account_id,customer_id,billing_entity_id)',t||'_scope',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION ds2_ar_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb;invoice_id integer;BEGIN
 r:=to_jsonb(NEW);
 PERFORM pg_advisory_xact_lock(260026,NEW.account_id);
 PERFORM customer_id FROM customers WHERE account_id=NEW.account_id AND customer_id=NEW.customer_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AR client not found in this account' USING ERRCODE='P0404';END IF;
 invoice_id:=COALESCE((r->>'original_invoice_id')::integer,(r->>'invoice_id')::integer,(r->>'carrying_invoice_id')::integer);
 IF invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_invoices i WHERE i.account_id=NEW.account_id AND i.customer_id=NEW.customer_id AND i.customer_invoice_id=invoice_id
 AND ds2_effective_entity(i.account_id,'customer_invoices',i.customer_invoice_id,i.billing_entity_id)=NEW.billing_entity_id) THEN
 RAISE EXCEPTION 'AR invoice belongs to another client or business' USING ERRCODE='P0409';END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['ar_derivations','ar_obligations','payment_receipts','ar_applications','client_credit_lots','client_credit_events','receipt_events','ar_obligation_carriers'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS ds2_ar_scope_guard ON %I',t);
 EXECUTE format('CREATE TRIGGER ds2_ar_scope_guard BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION ds2_ar_scope_guard()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION ds2_ar_application_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o ar_obligations;p ar_applications;remaining numeric;BEGIN
 SELECT * INTO o FROM ar_obligations WHERE obligation_id=NEW.obligation_id FOR NO KEY UPDATE;
 IF NEW.effective_date<o.effective_date THEN RAISE EXCEPTION 'Application predates its obligation' USING ERRCODE='P0409';END IF;
 SELECT o.amount-COALESCE(sum(amount*direction),0) INTO remaining FROM ar_applications WHERE obligation_id=o.obligation_id;
 IF NEW.direction=1 AND NEW.amount>remaining THEN RAISE EXCEPTION 'Application exceeds open obligation' USING ERRCODE='P0409';END IF;
 IF NEW.direction=-1 THEN
  SELECT * INTO p FROM ar_applications WHERE application_id=NEW.reversal_of;
  IF p.direction<>1 OR p.obligation_id<>NEW.obligation_id OR p.amount<>NEW.amount OR p.receipt_id IS DISTINCT FROM NEW.receipt_id OR p.credit_id IS DISTINCT FROM NEW.credit_id THEN
   RAISE EXCEPTION 'Reverse the complete original application' USING ERRCODE='P0409';END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ds2_ar_application_guard ON ar_applications;
CREATE TRIGGER ds2_ar_application_guard BEFORE INSERT ON ar_applications FOR EACH ROW EXECUTE FUNCTION ds2_ar_application_guard();
CREATE OR REPLACE FUNCTION ds2_ar_credit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE credit client_credit_lots;available numeric;BEGIN
 SELECT * INTO credit FROM client_credit_lots WHERE credit_id=NEW.credit_id FOR NO KEY UPDATE;
 SELECT credit.amount+COALESCE(sum(amount*direction),0) INTO available FROM client_credit_events WHERE credit_id=NEW.credit_id;
 IF NEW.effective_date<credit.effective_date OR available+NEW.amount*NEW.direction<0 OR available+NEW.amount*NEW.direction>credit.amount THEN
 RAISE EXCEPTION 'Credit is unavailable for this amount or date' USING ERRCODE='P0409';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ds2_ar_credit_guard ON client_credit_events;
CREATE TRIGGER ds2_ar_credit_guard BEFORE INSERT ON client_credit_events FOR EACH ROW EXECUTE FUNCTION ds2_ar_credit_guard();
CREATE OR REPLACE FUNCTION ds2_receipt_payment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ar_applications a JOIN payment_receipts r USING(receipt_id) WHERE a.compatibility_payment_id=OLD.payment_id AND r.source_kind='manual') THEN
 RAISE EXCEPTION 'Receipt application is immutable; correct it through its receipt before finalization' USING ERRCODE='P0409';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ds2_receipt_payment_guard ON customer_payments;
CREATE TRIGGER ds2_receipt_payment_guard BEFORE UPDATE OR DELETE ON customer_payments FOR EACH ROW EXECUTE FUNCTION ds2_receipt_payment_guard();
ALTER TABLE duplicate_flags DROP CONSTRAINT IF EXISTS duplicate_flags_kind_check;
ALTER TABLE duplicate_flags ADD CONSTRAINT duplicate_flags_kind_check CHECK(kind IN('transaction','payment','writeoff','retainer','payment_receipt'));
