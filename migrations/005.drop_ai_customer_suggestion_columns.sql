-- Drop customer-related suggestion columns we no longer need
ALTER TABLE ai_time_tracker_transaction_suggestions
     DROP COLUMN IF EXISTS suggested_entity,
     DROP COLUMN IF EXISTS suggested_customer_id,
     DROP COLUMN IF EXISTS suggested_customer_display_name;

