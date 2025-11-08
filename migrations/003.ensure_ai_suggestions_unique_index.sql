-- Ensure unique index exists for ON CONFLICT to work
CREATE UNIQUE INDEX IF NOT EXISTS ai_time_tracker_transaction_suggestions_entry_idx ON ai_time_tracker_transaction_suggestions(timesheet_entry_id);

-- Ensure supporting account index exists for filtering
CREATE INDEX IF NOT EXISTS ai_time_tracker_transaction_suggestions_account_idx ON ai_time_tracker_transaction_suggestions(account_id);

