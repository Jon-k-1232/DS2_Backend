ALTER TABLE timesheet_entries
   ADD COLUMN hold_reason text NULL,
   ADD COLUMN ai_attempted_at timestamp NULL,
   ADD COLUMN ai_payload jsonb NULL,
   ADD COLUMN suggested_customer_id integer NULL
      REFERENCES customers(customer_id) ON DELETE SET NULL,
   ADD COLUMN matched_user_id integer NULL
      REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX timesheet_entries_hold_reason_idx
   ON timesheet_entries(account_id, hold_reason)
   WHERE is_processed = FALSE AND is_deleted = FALSE AND hold_reason IS NOT NULL;

UPDATE timesheet_entries SET hold_reason = 'legacy_pre_ai'
   WHERE is_processed = FALSE AND is_deleted = FALSE AND hold_reason IS NULL;

ALTER TABLE ai_time_tracker_transaction_suggestions
   DROP CONSTRAINT IF EXISTS ai_time_tracker_transaction_suggestions_status_check;
