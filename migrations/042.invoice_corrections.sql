-- H3: append-only correction documents. No backfill or source-row update.
SELECT set_config('app.audit_source','migration/042.invoice_corrections',true),set_config('app.audit_reason','Add owner-authorized invoice corrections and money-return evidence',true);
CREATE TABLE IF NOT EXISTS credit_memos (
 memo_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL, billing_entity_id integer NOT NULL,
 original_invoice_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id), number text NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0), debt_reduction numeric(14,2) NOT NULL CHECK(debt_reduction>=0 AND debt_reduction<=amount),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), actor_id integer NOT NULL, effective_date date NOT NULL,
 artifact_key text NOT NULL, artifact_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,number), UNIQUE(account_id,customer_id,billing_entity_id,memo_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
CREATE TABLE IF NOT EXISTS credit_memo_lines (
 line_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL, billing_entity_id integer NOT NULL,
 memo_id bigint NOT NULL, original_transaction_id integer REFERENCES customer_transactions(transaction_id), description text NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,memo_id) REFERENCES credit_memos(account_id,customer_id,billing_entity_id,memo_id)
);
CREATE TABLE IF NOT EXISTS credit_memo_reversals (
 reversal_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL, billing_entity_id integer NOT NULL,
 memo_id bigint NOT NULL UNIQUE, amount numeric(14,2) NOT NULL CHECK(amount>0), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id integer NOT NULL, effective_date date NOT NULL, artifact_key text NOT NULL, artifact_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,memo_id) REFERENCES credit_memos(account_id,customer_id,billing_entity_id,memo_id)
);
CREATE TABLE IF NOT EXISTS invoice_voids (
 void_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL, billing_entity_id integer NOT NULL,
 original_invoice_id integer NOT NULL UNIQUE REFERENCES customer_invoices(customer_invoice_id),
 amount numeric(14,2) NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), actor_id integer NOT NULL,
 effective_date date NOT NULL, artifact_key text NOT NULL, artifact_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,customer_id,billing_entity_id,void_id),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
CREATE TABLE IF NOT EXISTS rebill_links (
 link_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL, billing_entity_id integer NOT NULL,
 void_id bigint NOT NULL UNIQUE REFERENCES invoice_voids(void_id), original_invoice_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id),
 replacement_invoice_id integer NOT NULL UNIQUE REFERENCES customer_invoices(customer_invoice_id), replacement_entity_id integer NOT NULL,
 lines jsonb NOT NULL, source_evidence jsonb NOT NULL, reason text NOT NULL, actor_id integer NOT NULL, effective_date date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id),
 FOREIGN KEY(account_id,replacement_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
CREATE TABLE IF NOT EXISTS client_refunds (
 refund_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL, billing_entity_id integer NOT NULL,
 credit_id bigint NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>0), method text NOT NULL, reference text,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), actor_id integer NOT NULL, effective_date date NOT NULL,
 artifact_key text NOT NULL, artifact_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,customer_id,billing_entity_id,credit_id) REFERENCES client_credit_lots(account_id,customer_id,billing_entity_id,credit_id)
);
CREATE TABLE IF NOT EXISTS correction_postings (
 posting_id bigserial PRIMARY KEY, account_id integer NOT NULL, customer_id integer NOT NULL, billing_entity_id integer NOT NULL,
 invoice_id integer NOT NULL REFERENCES customer_invoices(customer_invoice_id), snapshot_id integer NOT NULL UNIQUE REFERENCES customer_invoices(customer_invoice_id),
 kind text NOT NULL, source_id bigint NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount<>0), reason text NOT NULL,
 actor_id integer NOT NULL, effective_date date NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,billing_entity_id) REFERENCES billing_entities(account_id,billing_entity_id)
);
DO $$ DECLARE spec text;t text;k text; BEGIN
 FOREACH spec IN ARRAY ARRAY['credit_memos:memo_id','credit_memo_lines:line_id','credit_memo_reversals:reversal_id','invoice_voids:void_id','rebill_links:link_id','client_refunds:refund_id','correction_postings:posting_id'] LOOP
  t:=split_part(spec,':',1);k:=split_part(spec,':',2);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_capture ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_capture_audit(%L)',t,k);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_immutable ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ds2_audit_immutable()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_audit_no_truncate ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_audit_no_truncate BEFORE TRUNCATE ON %I EXECUTE FUNCTION ds2_audit_immutable()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS ds2_ar_scope_guard ON %I',t);
  EXECUTE format('CREATE TRIGGER ds2_ar_scope_guard BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION ds2_ar_scope_guard()',t);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(account_id,customer_id,billing_entity_id)',t||'_scope',t);
 END LOOP;
END $$;
-- Membership records retain every correction included on a later statement.
ALTER TABLE invoice_statement_members DROP CONSTRAINT IF EXISTS invoice_statement_members_table_name_check;
ALTER TABLE invoice_statement_members ADD CONSTRAINT invoice_statement_members_table_name_check CHECK(table_name IN(
 'customer_invoices','customer_transactions','customer_payments','customer_writeoffs','customer_retainers_and_prepayments','retainer_events',
 'ar_obligations','payment_receipts','ar_applications','client_credit_lots','client_credit_events','receipt_events',
 'credit_memos','credit_memo_lines','credit_memo_reversals','invoice_voids','rebill_links','client_refunds','correction_postings'));
-- Money returned is the third disposition of a receipt, alongside applied and held.
CREATE OR REPLACE FUNCTION ds2_receipt_conservation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE rid bigint;r payment_receipts;allocated numeric;available numeric;returned numeric;expected numeric;BEGIN
 IF TG_TABLE_NAME='payment_receipts' THEN rid:=NEW.receipt_id;
 ELSIF TG_TABLE_NAME='client_credit_lots' THEN rid:=NEW.origin_receipt_id;
 ELSIF TG_TABLE_NAME='ar_applications' THEN
 rid:=NEW.receipt_id;IF rid IS NULL THEN SELECT origin_receipt_id INTO rid FROM client_credit_lots WHERE credit_id=NEW.credit_id;END IF;
 ELSIF TG_TABLE_NAME IN('client_credit_events','client_refunds') THEN SELECT origin_receipt_id INTO rid FROM client_credit_lots WHERE credit_id=NEW.credit_id;
 ELSE rid:=NEW.receipt_id;END IF;
 IF rid IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO r FROM payment_receipts WHERE receipt_id=rid;
 IF r.source_kind<>'manual' THEN RETURN NULL;END IF;
 SELECT COALESCE(sum(a.amount*a.direction),0) INTO allocated FROM ar_applications a LEFT JOIN client_credit_lots l ON l.credit_id=a.credit_id WHERE a.receipt_id=rid OR l.origin_receipt_id=rid;
 SELECT COALESCE(sum(l.amount+COALESCE((SELECT sum(e.amount*e.direction) FROM client_credit_events e WHERE e.credit_id=l.credit_id),0)),0) INTO available FROM client_credit_lots l WHERE l.origin_receipt_id=rid;
 SELECT COALESCE(sum(f.amount),0) INTO returned FROM client_refunds f JOIN client_credit_lots l USING(credit_id) WHERE l.origin_receipt_id=rid;
 expected:=CASE WHEN EXISTS(SELECT 1 FROM receipt_events WHERE receipt_id=rid AND kind='reversed') THEN 0 ELSE r.amount END;
 IF allocated+available+returned<>expected THEN RAISE EXCEPTION 'Receipt applications, available credit and money returned must reconcile to the complete receipt' USING ERRCODE='P0409';END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ds2_receipt_conservation ON client_refunds;
CREATE CONSTRAINT TRIGGER ds2_receipt_conservation AFTER INSERT ON client_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ds2_receipt_conservation();
