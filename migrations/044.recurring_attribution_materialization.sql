-- Preflight for 043 on a legacy populated database, also safe after 043.
-- Materializing an existing recurring-plan legacy attribution does not move
-- the plan to a different business. Keep the admin gate for actual changes.
DO $$ DECLARE definition text; old_test text; new_test text; BEGIN
 definition:=pg_get_functiondef('ds2_guard_billing_entity'::regproc);
 old_test:='IF OLD.billing_entity_id IS DISTINCT FROM NEW.billing_entity_id AND NOT(TG_TABLE_NAME=''customer_payments_processed'' AND oldr->>''is_processed''=''false'' AND OLD.billing_entity_id IS NULL) THEN';
 new_test:='IF OLD.billing_entity_id IS DISTINCT FROM NEW.billing_entity_id AND NOT(TG_TABLE_NAME=''customer_payments_processed'' AND oldr->>''is_processed''=''false'' AND OLD.billing_entity_id IS NULL) AND NOT(TG_TABLE_NAME=''recurring_customers'' AND OLD.billing_entity_id IS NULL AND old_eid=NEW.billing_entity_id) THEN';
 IF position(old_test IN definition)>0 THEN EXECUTE replace(definition,old_test,new_test);
 ELSIF position(new_test IN definition)=0 THEN RAISE EXCEPTION 'Unexpected billing entity guard definition; review before recurring cutover';END IF;
END $$;
