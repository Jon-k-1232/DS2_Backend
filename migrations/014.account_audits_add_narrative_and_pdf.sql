ALTER TABLE account_audits
   ADD COLUMN narrative text,
   ADD COLUMN narrative_findings jsonb,
   ADD COLUMN narrative_actions jsonb,
   ADD COLUMN narrative_model varchar(120),
   ADD COLUMN narrative_cost_usd numeric(10, 6),
   ADD COLUMN narrative_request_id varchar(64),
   ADD COLUMN pdf_s3_key text,
   ADD COLUMN pdf_generated_at timestamp;
