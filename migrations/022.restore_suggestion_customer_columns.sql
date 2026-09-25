-- F30: 005 removed these columns; current ingestion and review require them.
-- Additive and safe on the 2026-09-22 snapshot, where they already exist.
-- Historical values removed by 005 cannot be reconstructed by this migration.
ALTER TABLE ai_time_tracker_transaction_suggestions
    ADD COLUMN IF NOT EXISTS suggested_entity text,
    ADD COLUMN IF NOT EXISTS suggested_customer_id integer,
    ADD COLUMN IF NOT EXISTS suggested_customer_display_name text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'ai_time_tracker_transaction_suggestions'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
              WHERE attrelid = 'ai_time_tracker_transaction_suggestions'::regclass
                AND attname = 'suggested_customer_id')]::smallint[]
          AND confrelid = 'customers'::regclass
    ) THEN
        ALTER TABLE ai_time_tracker_transaction_suggestions
            ADD CONSTRAINT ai_time_tracker_transaction_suggesti_suggested_customer_id_fkey
            FOREIGN KEY (suggested_customer_id) REFERENCES customers(customer_id);
    END IF;
END;
$$;
