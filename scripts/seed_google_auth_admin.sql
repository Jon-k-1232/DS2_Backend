-- Seed: admin user for Google OAuth login cutover.
-- Run on the dev DB AFTER migration 016.google_auth_drop_user_login.sql is applied.
--
-- Idempotent: only inserts if no active row with this email exists.
--
-- Prereq: admin@jimkimmel.com must be a real Google Workspace account.
-- For prod cutover, change the email to your production admin email before running.

INSERT INTO users (account_id, email, display_name, job_title, access_level, is_user_active)
SELECT 1, 'admin@jimkimmel.com', 'Admin', 'Administrator', 'admin', TRUE
WHERE NOT EXISTS (
   SELECT 1 FROM users WHERE email = 'admin@jimkimmel.com' AND is_user_active = true
);
