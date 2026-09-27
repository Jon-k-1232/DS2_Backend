-- H10 forward correction: joined projections are for nonlocking reads only.
-- Restore the original single-base-table views for row-locking statements.
-- No source/audit rows, attribution rules, constraints or triggers change.
CREATE SCHEMA IF NOT EXISTS billing_reads;
DO $$
DECLARE spec text; t text; k text; cols text; expr text; shared text;
BEGIN
 FOREACH spec IN ARRAY ARRAY['customer_transactions:transaction_id','customer_jobs:customer_job_id'] LOOP
  t:=split_part(spec,':',1); k:=split_part(spec,':',2);
  shared:=CASE WHEN t='customer_jobs' THEN 'OR r.billing_entity_id IS NULL' ELSE '' END;
  expr:='COALESCE(r.billing_entity_id,ls.billing_entity_id,la.billing_entity_id,br.billing_entity_id)';
  SELECT string_agg(CASE WHEN column_name='billing_entity_id' THEN expr||' AS billing_entity_id' ELSE 'r.'||quote_ident(column_name) END,', ' ORDER BY ordinal_position)
   INTO cols FROM information_schema.columns WHERE table_schema='billing_scope' AND table_name=t;
  EXECUTE format('CREATE OR REPLACE VIEW billing_reads.%I AS SELECT %s FROM public.%I r
   LEFT JOIN public.legacy_billing_scopes ls ON ls.account_id=r.account_id AND ls.table_name=%L AND ls.record_id=r.%I
   LEFT JOIN public.legacy_financial_entity_attributions la ON la.account_id=r.account_id AND la.table_name=%L AND la.record_id=r.%I
   LEFT JOIN public.billing_entity_reviews rv ON rv.account_id=r.account_id AND rv.table_name=%L AND rv.record_id=r.%I
   LEFT JOIN public.billing_entity_resolutions br ON br.account_id=rv.account_id AND br.review_id=rv.review_id
   WHERE NULLIF(current_setting(''app.billing_entity_id'',true),'''') IS NULL
    OR %s=NULLIF(current_setting(''app.billing_entity_id'',true),'''')::integer %s',
   t,cols,t,t,k,t,k,t,k,expr,shared);
  expr:=format('public.ds2_effective_entity(r.account_id,%L,r.%I,r.billing_entity_id)',t,k);
  SELECT string_agg(CASE WHEN column_name='billing_entity_id' THEN expr||' AS billing_entity_id' ELSE 'r.'||quote_ident(column_name) END,', ' ORDER BY ordinal_position)
   INTO cols FROM information_schema.columns WHERE table_schema='billing_scope' AND table_name=t;
  EXECUTE format('CREATE OR REPLACE VIEW billing_scope.%I AS SELECT %s FROM public.%I r
   WHERE NULLIF(current_setting(''app.billing_entity_id'',true),'''') IS NULL
    OR %s=NULLIF(current_setting(''app.billing_entity_id'',true),'''')::integer %s',t,cols,t,expr,shared);
 END LOOP;
END $$;
