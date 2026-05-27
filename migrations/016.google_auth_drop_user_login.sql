-- Google OAuth migration: drop password-based auth and enforce email uniqueness on active users.
-- After this migration, authentication is handled by Google Workspace OAuth via /auth/google.
--
-- A *partial* unique index (WHERE is_user_active) is used instead of a full UNIQUE constraint
-- because there are historic inactive user rows with empty/duplicate emails that we don't want
-- to clean up here. The auth code only ever looks up `is_user_active = true` rows, so this
-- matches the actual lookup semantics.

DROP TABLE IF EXISTS user_login;

CREATE UNIQUE INDEX IF NOT EXISTS users_active_email_unique_idx
   ON users (email) WHERE is_user_active = true;
