-- H10: replace per-row entity-function lookups with unique, account-qualified
-- joins on the two high-volume work/job read views. No ledger or audit writes.
-- Exact precedence: explicit entity, amended scope, original attribution,
-- reviewed resolution. Shared jobs retain their existing null-physical rule.
DO $$
DECLARE spec text; t text; k text; cols text; expr text;
BEGIN
 FOREACH spec IN ARRAY ARRAY['customer_transactions:transaction_id','customer_jobs:customer_job_id'] LOOP
  t:=split_part(spec,':',1); k:=split_part(spec,':',2);
  expr:='COALESCE(r.billing_entity_id,ls.billing_entity_id,la.billing_entity_id,br.billing_entity_id)';
  -- Use current VIEW order: 045 appended source columns after the original
  -- billing_entity_id position. CREATE OR REPLACE must preserve that contract.
  SELECT string_agg(CASE WHEN column_name='billing_entity_id' THEN expr||' AS billing_entity_id' ELSE 'r.'||quote_ident(column_name) END,', ' ORDER BY ordinal_position)
   INTO cols FROM information_schema.columns WHERE table_schema='billing_scope' AND table_name=t;
  EXECUTE format('CREATE OR REPLACE VIEW billing_scope.%I AS SELECT %s FROM public.%I r
   LEFT JOIN public.legacy_billing_scopes ls ON ls.account_id=r.account_id AND ls.table_name=%L AND ls.record_id=r.%I
   LEFT JOIN public.legacy_financial_entity_attributions la ON la.account_id=r.account_id AND la.table_name=%L AND la.record_id=r.%I
   LEFT JOIN public.billing_entity_reviews rv ON rv.account_id=r.account_id AND rv.table_name=%L AND rv.record_id=r.%I
   LEFT JOIN public.billing_entity_resolutions br ON br.account_id=rv.account_id AND br.review_id=rv.review_id
   WHERE NULLIF(current_setting(''app.billing_entity_id'',true),'''') IS NULL
    OR %s=NULLIF(current_setting(''app.billing_entity_id'',true),'''')::integer %s',
   t,cols,t,t,k,t,k,t,k,expr,CASE WHEN t='customer_jobs' THEN 'OR r.billing_entity_id IS NULL' ELSE '' END);
 END LOOP;
END $$;
