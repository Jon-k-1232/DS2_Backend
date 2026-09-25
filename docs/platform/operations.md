# Platform operations

Source review: 2026-09-24. This guide records code and dated repository evidence. It does not assert that production was migrated, deployed, backfilled or tested during this task. All commands below are instructions for a future authorized operation; none was executed for this documentation review.

## 1. Purpose and UI

This guide covers startup, configuration, health, scheduled reminders, notifications, migrations, review/backfill tools and local validation. Reminders are configured at `/account/automations`; notification UI is `../DS2_Frontend/src/Components/Notifications/NotificationBell.js`, with `useNotifications.js` and `Services/ApiCalls/NotificationsCalls.js`. Health and maintenance scripts have no owner-facing page. Sources: `../DS2_Frontend/src/Routes/GroupedRoutes/AccountRoutes/AccountRoutes.js:47`, `../DS2_Frontend/src/Components/Notifications/NotificationBell.js:1`, `src/endpoints/health/health-router.js:1`.

## 2. Access and execution boundaries

Health aliases are public. Notifications require active JWT, own account and self or lowercase manager/admin/super admin/owner for URL userID. Automation settings require Admin/Super Admin. Maintenance CLIs do not use JWT/HTTP role gates: their database credentials, explicit environment, target checks and command flags control execution. Report scripts scope to account 1. Sources: `src/app.js:152`, `src/endpoints/notifications/notifications-router.js:1`, `src/endpoints/account/account-router.js:275`, `scripts/review-2026-09/_common.js:36`.

Production-looking migration targets are rejected by database-name or hostname `/prod/i`; this is a name heuristic, not verified server identity. Review scripts compare current_database() with the requested database; repair apply refuses ds2_local and needs `--i-know-this-is-prod` for ds2_prod. The flag is not authorization. Tracker backfill additionally binds reviewed CSV to database/bucket/legacy account. Sources: `scripts/migrate.js:67`, `scripts/review-2026-09/_common.js:36`, `scripts/timeTracking/backfill-tracker-owners.js:307`.

## 3. Operational API reference

All paths inherit the global API 429 limit; protected notification routes also inherit 401/403, JSON parsing 400/413 and unexpected 500. Health does not require identity/account parameters. Sources: `src/app.js:70`, `src/app.js:100`, `src/app.js:120`.

### API liveness

| Item | Contract |
|---|---|
| Method/path | `GET /api/health/` |
| Input | None. |
| Success | **200** `{status:'ok'}`. Does not access DB/S3/AI. |
| Errors | Global 429; no handler-specific error branch. |
| Source | `src/app.js:152`, `src/endpoints/health/health-router.js:22` |

### Liveness alias

| Item | Contract |
|---|---|
| Method/path | `GET /healthz/` |
| Input/output/errors | Same as /api/health. |
| Source | `src/app.js:153`, `src/endpoints/health/health-router.js:22` |

### API database probe

| Item | Contract |
|---|---|
| Method/path | `GET /api/health/check` |
| Input | None. |
| Success | **200** `{status:'ok',db:'ok',timestamp:<ISO>}` after SELECT 1. |
| Errors | **503** `{status:'error',db:'error',message:<DB error>,timestamp}`; global 429. |
| Source | `src/endpoints/health/health-router.js:9`, `src/endpoints/health/health-service.js:7` |

### Database probe alias

| Item | Contract |
|---|---|
| Method/path | `GET /healthz/check` |
| Input/output/errors | Same as /api/health/check. |
| Source | `src/app.js:153`, `src/endpoints/health/health-router.js:9` |

Notification contracts are in [initial data and notifications](../work/initial-data-and-notifications.md#3-api-reference). Tracker-recipient membership is in [time tracking](time-tracking.md#3-api-reference).

## 4. Configuration, data model and migrations

### Environment variables

These are names/defaults read by code, not disclosed live credentials. Numeric tunables largely use Number without range validation; zero/invalid values can behave differently from omission. Sources accompany each group.

| Variables | Meaning/default |
|---|---|
| NODE_ENV; NODE_PORT_DEV/PROD; HOST_IP_DEV/PROD; FRONT_END_URL_DEV/PROD | Only exact production chooses production settings. Server binds configured host/port; no code default for these values. `config.js:1`. |
| DB_DEV_HOST / DB_PROD_HOST; DATABASE_USER; DATABASE_PASSWORD; DATABASE_NAME; DB_DEV_PORT | App uses selected host, database name default ds2_dev/ds2_prod, port default 5432 (DB_DEV_PORT is used even in production). config.DATABASE_URL is a database **name**, not URL. `config.js:5`, `src/utils/db.js:6`. |
| DB_SSL_DISABLE; DB_SSL_CA_PATH; DB_SSL_REJECT_UNAUTHORIZED; PG_POOL_MAX | Disable SSL only string true. Default CA certs/rds-global-bundle.pem; default certificate verification is Boolean(CA loaded), so unreadable CA defaults to rejectUnauthorized=false. Explicit override string true enables verification. Pool 2–20 by default, acquire/idle 30s. `src/utils/db.js:12`. |
| JWT_SECRET / API_TOKEN; JWT_EXPIRATION | JWT_SECRET preferred, API_TOKEN fallback. Production startup rejects secret length<32; dev warns. JWT expiry has no config default; cookie parser separately falls back 11h. `config.js:10`, `config.js:36`, `src/endpoints/auth/auth-cookie.js:10`. |
| GOOGLE_CLIENT_ID; GOOGLE_WORKSPACE_DOMAIN; CORS_ORIGIN | Google audience/domain; comma-separated trimmed origin allowlist with credentials, otherwise CORS origin false. Frontend hosted-domain hint is hardcoded independently. `src/endpoints/auth/auth-service.js:8`, `src/app.js:71`. |
| DISABLE_RATE_LIMIT | Exact true disables API/expensive limiters; NODE_ENV=test also skips these. Auth limiter remains. Intended sandbox use is explicit in e2e README. `src/app.js:81`, `src/app.js:94`, `../DS2_Frontend/e2e/README.md:9`. |
| S3_BUCKET_NAME; S3_REGION; S3_ENDPOINT; S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY | Bucket/region/endpoint required outside tests; strip endpoint trailing slashes; optional paired static credentials otherwise AWS chain. `config.js:19`, `src/utils/s3.js:1`. |
| AWS_REGION; FROM_EMAIL; TIME_TRACKING_ADMIN_EMAILS; TIME_TRACKER_SEND_USER_SUCCESS_EMAILS | SES region default us-west-2, sender required, comma-list failure-recipient fallback, owner/requester success mail only exact '1'. `src/utils/email/sendEmail.js:5`, `src/timeTrackerValidation/notifications.js:33`, `src/endpoints/timeTracking/timeTracking-router.js:697`. |
| TIME_TRACKER_AI_FEATURE_FLAG; TIME_TRACKER_AI_TEST_ACCOUNT_IDS | on=all, test=comma-list account IDs, off/default/other=none. `src/endpoints/timesheets/auto-ingest-runner.js:8`. |
| BEDROCK_REGION; BEDROCK_MODEL_TIMETRACKER_FAST; BEDROCK_MODEL_TIMETRACKER | Default us-west-2; Haiku `us.anthropic.claude-haiku-4-5-20251001-v1:0`; Sonnet `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. `config.js:24`. |
| BEDROCK_MODEL_AUDIT | Optional audit narrative model; falls back to BEDROCK_MODEL_TIMETRACKER_FAST then the Haiku ID above. Audit fallback model is BEDROCK_MODEL_TIMETRACKER then the Sonnet ID above. `src/endpoints/accountAudit/account-audit-narrative.js:5`. |
| LLM_LOG_BUCKET; LLM_LOG_RAW | Backend log bucket default empty; raw opt-in only case-insensitive 'true'; metadata default, fallback redaction on raw path. `src/ai_integrations/bedrock/index.js:9`. |
| BEDROCK_RPM_HAIKU / BEDROCK_RPM_SONNET | Process-local token-bucket defaults 600/120 requests per minute; not an account-wide distributed quota. `src/ai_integrations/bedrock/rateLimiter.js:18`. |
| AUTO_INGEST_CONCURRENCY; AUTO_INSERT_CONFIDENCE_THRESHOLD; CUSTOMER_FUZZY_HIGH_THRESHOLD | Defaults 8 / 0.85 / 0.90. `src/endpoints/timesheets/auto-ingest-orchestrator.js:12`. |
| CATEGORY_ESCALATION_THRESHOLD; MAX_JOB_TYPES_IN_PROMPT; FEW_SHOT_LIMIT | Defaults .75 / 150 / 5. `src/ai_integrations/categoryInference.js:5`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:15`. |
| CUSTOMER_MATCH_THRESHOLD; CUSTOMER_LLM_SKIP_THRESHOLD; CUSTOMER_MATCH_MIN_MARGIN; CUSTOMER_MATCH_MIN_SHARED_TOKENS; CUSTOMER_ALIAS_MIN_CONFIRMATIONS | Defaults .62 / .90 / .08 / 2 / 2. `src/ai_integrations/customerMatching.js:4`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:18`. |
| CUSTOMER_FEWSHOT_LIMIT; CUSTOMER_HISTORY_LOOKBACK_DAYS; MIN_DETERMINISTIC_JOB_COUNT | Defaults 8 / 365 / 5. `src/ai_integrations/customerHistoricalPatterns.js:15`. |
| INTERNAL_CUSTOMER_IDS; INTERNAL_ENTITY_MIN_EMPLOYEES | Comma-list IDs default empty; established entity needs 2 distinct employees unless valid configured threshold. `src/endpoints/timesheets/internal-customers.js:37`. |
| TRACKER_ENTRY_LOOKBACK_DAYS | Default 7 days before tracker start allowed. `src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js:12`. |
| TEMPLATE_OWNER_ACCOUNT_ID; LEGACY_FLAT_TRACKER_ACCOUNT_ID | Numeric conversion followed by JavaScript logical-OR fallback to 1 (so zero/NaN also choose 1). Separate purposes: template administration versus legacy flat-key tenant. `src/endpoints/timeTracking/timeTracking-router.js:199`, `src/endpoints/timeTracking/timeTracking-router.js:1207`. |
| TEMPLATE_COLLAPSE_WINDOW_MS; TEMPLATE_PROTECT_PASSWORD; TEMPLATE_MAX_DATA_ROWS | Defaults 60000 / jka-internal / 1500. Workbook protection, not access control. `src/endpoints/timeTracking/template-builder.js:8`. |
| BILLING_TIMEZONE | Default America/Phoenix; shared date-only billing day. Reminder schedules independently hardcode Phoenix. `src/endpoints/invoice/billingDate.js:11`, `src/automations/automationOrchestrator.js:12`. |
| DS2_ENV_FILE; DB_HOST; DS2_REVIEW_OUT_DIR | Script environment selection; explicit DB_HOST overrides file host; review output defaults scripts/review-2026-09/out. scripts/_db parses file without mutating environment, refuses absent explicit host, uses ssl rejectUnauthorized=false unless disabled. `scripts/_db.js:56`, `scripts/review-2026-09/_common.js:45`. |
| DS2_TEST_ALLOW_REMOTE_DB; PGHARNESS_HOST/PORT/USER/PASSWORD/DEBUG | Test bootstrap refuses nonlocal host unless exact '1'; separate migration harness defaults localhost:5433 and fixed local sandbox identity, never inherits app DB env. `test/integration/_setup.js:22`, `test/scripts/helpers/pgHarness.js:25`. |

Lambda configuration is separate: ACCOUNT_ID, CREATED_BY_USER_ID, DB_ACCOUNT_ID (defaults ACCOUNT_ID), DB_HOST/DB_NAME(default ds2_prod)/DB_USER/DB_PASSWORD, SECRET_NAME, STAGE(default local), AWS_PROFILE/AWS_REGION(default us-west-2), S3_BUCKET_NAME/ENDPOINT/PENDING_PREFIX/BASE_PREFIX, BEDROCK_MODEL_EXTRACTION/MATCHING/CHECK_EXTRACTION, MATCH_THRESHOLD(default 62), LLM_MATCH_TOP_N(default 5), LLM_MATCH_SKIP_THRESHOLD(default 90), USE_BEDROCK_FALLBACK(default true), LLM_LOG_BUCKET and LLM_LOG_RAW. Secrets Manager loads only when non-local and SECRET_NAME is set; default nonempty DB_NAME prevents a secret's dbname replacing it. Source: `../DS2_Lambdas/Process_Payment_Images/config.py:24`, `../DS2_Lambdas/Process_Payment_Images/config.py:87`.

Checked-in production Terraform sets account/actor/account-match IDs to 1, **MATCH_THRESHOLD=30** (overriding Python's 62), 900-second timeout, 1,024 MB, three Sonnet model IDs, and S3 ObjectCreated on the exact pending prefix with lowercase `.pdf` suffix. CloudWatch retention is configured 14 days. These are configured intent, not observed deployment. Source: `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:191`, `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:248`.

### Schema sources and migration inventory

`tables.sql` is a historical bootstrap, not a current schema. `schema-snapshot-2026-09-22.sql` represents the 2026-09-22 production copy, before new migrations 019–022; those files must be considered alongside it. There is no 001 migration. A fresh database cannot safely be reconstructed by blindly applying every historical file onto the snapshot. The supported fresh build loads that snapshot as baseline 018 and applies 019–022. Migration 022 explicitly restores the runtime suggestion columns dropped by historical 005 (fixed [F30](../_review/findings.md#f30)). Sources: `migrations/README.md:5`, `migrations/README.md:27`, `migrations/schema-snapshot-2026-09-22.sql:335`.

| Migration | Data/schema effect and rerun implications |
|---|---|
| 002 | Creates ai_time_tracker_transaction_suggestions, category/customer/entity suggestions, status and timestamps; unique entry/account indexes. Bare CREATE fails on rerun. `migrations/002.add_ai_time_tracker_transaction_suggestions.sql:1`. |
| 003 | Ensures unique suggestion-entry and account indexes IF NOT EXISTS. `migrations/003.ensure_ai_suggestions_unique_index.sql:1`. |
| 004 | Creates old ai_request_logs IF NOT EXISTS; later removed by 011. `migrations/004.create_ai_request_logs.sql:1`. |
| 005 | Drops suggested_entity, suggested_customer_id, suggested_customer_display_name if present. 022 restores them; the dated snapshot already contains them. `migrations/005.drop_ai_customer_suggestion_columns.sql:1`. |
| 006 | Creates training examples with account cascade and entry/transaction SET NULL links; categories, notes, duration/entity, uploaded flags/timestamp. `migrations/006.create_ai_category_training_examples.sql:1`. |
| 007 | **Drops and recreates customer_payments_processed**, erasing existing pending queue on rerun. Defines nullable match IDs, source fields/default pending flags and coarse dedup unique key. `migrations/007.create_customer_payments_processed.sql:1`. |
| 008 | Changes customer_invoices.remaining_balance_on_invoice to decimal(10,2), avoiding integer truncation. `migrations/008.fix_remaining_balance_decimal.sql:1`. |
| 009 | Adds five holding columns: hold_reason, ai_attempted_at, ai_payload, suggested_customer_id, matched_user_id; pending-hold index; marks existing pending/nondeleted hold-null entries legacy_pre_ai; drops suggestion status check. Bare adds fail on rerun. `migrations/009.timesheet_entries_holding_columns.sql:1`. |
| 010 | Creates ai_call_log, notifications, template_downloads; adds accounts.ai_daily_cost_cap_usd. Bare CREATE/ADD fails on rerun. `migrations/010.create_ai_call_log_and_notifications.sql:1`. |
| 011 | Drops old ai_request_logs and ai_integrations IF EXISTS. `migrations/011.drop_openai_artifacts.sql:1`. |
| 012 | Creates reviewer correction history/indexes, account cascade, nullable transaction/entry/reviewer links. `migrations/012.create_ai_reviewer_corrections.sql:1`. |
| 013 | Creates saved account audits: account/customer, numeric totals, ledger/discrepancy/summary JSON, runner/status/notes/timestamps. Bare CREATE fails on rerun. `migrations/013.create_account_audits.sql:1`. |
| 014 | Adds narrative/findings/actions/model/cost/request ID/pdf key/generated time; bare adds fail on rerun. `migrations/014.account_audits_add_narrative_and_pdf.sql:1`. |
| 015 | Adds app_invoice_total/app_invoice_error to audits; bare adds fail on rerun. `migrations/015.account_audits_add_app_balance.sql:1`. |
| 016 | Drops legacy user_login; creates exact-email unique index only for active users. Keeps user_login_log. `migrations/016.google_auth_drop_user_login.sql:1`. |
| 017 | Adds nine core ledger/account/date indexes; no business-data repair. `migrations/017.add_core_ledger_indexes.sql:1`. |
| 018 | Creates customer_rate_agreements (account/customer/year unique, agreed hourly rate, notes/actor/timestamp). Timesheet ingestion does not read it for pricing. `migrations/018.customer_rate_agreements.sql:1`. |
| 019 | Locks four ledger tables; normalizes exact lowercase time/charge types and literal null/undefined notes/detail/references; logs before/after; flips only manifest-approved positive parent payment totals satisfying live checks. Idempotent state predicates. `migrations/019.ledger_data_normalization.sql:62`, `migrations/019.ledger_data_normalization.sql:108`, `migrations/019.ledger_data_normalization.sql:1094`. |
| 020 | Adds/backfills immutable storage_slug; live collision-resolution loop, lowest account ID keeps bare slug; NOT NULL + unique index; safe rerun but schema/app cutover required. `migrations/020.accounts_storage_slug.sql:52`. |
| 021 | Adds exact tracker_file_owners key PK/account FK/user ID without FK/source constraint/timestamp and owner index. Additive, idempotent; no object backfill inside migration. `migrations/021.tracker_file_owners.sql:45`. |
| 022 | Restores nullable suggestion entity/customer ID/display name and the customer FK; idempotent, preserving existing data. `migrations/022.restore_suggestion_customer_columns.sql`. |

Notifications have ID/account/user/type/title/body/payload/read_at/expires_at/created_at; account/user deletion cascades. template_downloads counts builds, not every download; ai_call_log stores token/cost/latency/status metadata. schemaversion tracks numeric version/name/time, not a source checksum. ledger_normalization_log records migration/table/row/account/customer/column/old/new/time for audit. Sources: `migrations/010.create_ai_call_log_and_notifications.sql:1`, `scripts/migrate.js:168`, `migrations/019.ledger_data_normalization.sql:62`.

## 5. Read and startup logic

Health DB check executes SELECT 1, independent of table population. Liveness does no dependency checking. On startup, S3 HeadBucket and database SELECT 1 log connectivity after listening; the DB 10-second timer logs a timeout but does not cancel the query or stop serving. AI flag truthy and not 'off' starts a tiny Bedrock smoke invocation; its catch **logs, does not abort startup**. Despite the comment, the smoke function does not test Comprehend and uses no DB audit connection. Sources: `src/endpoints/health/health-service.js:7`, `src/server.js:17`, `src/server.js:27`, `src/ai_integrations/bedrock/index.js:215`.

Notifications select own account/user, newest created_at first, bounded limit, and expires_at null or greater than current JS time. unreadOnly adds read_at IS NULL. Unread count uses the same expiry predicate. Mark-one and mark-all do not filter expired rows; mark-one can update already-read timestamps. Source: `src/endpoints/notifications/notifications-service.js:42`.

Reminder account selection left-joins settings for the key and includes active accounts whose setting is missing or enabled. Recipients are active users with email; a nonempty configured list restricts them, but empty means all. Missing-tracker check queries own-account/user nondeleted entries whose time_tracker_end_date falls in previous week's inclusive range; processed status is irrelevant. No matching row means reminder. Sources: `src/endpoints/account/automation-settings-service.js:153`, `src/automations/automationScripts/timeTrackerReminders.js:24`, `src/automations/automationScripts/timeTrackerReminders.js:109`.

## 6. Scheduling and calculations

Each non-test app process starts node-schedule jobs in America/Phoenix: Thursday 09:00, Friday 15:30, and daily 09:00 for missing prior-week trackers. Previous week is dayjs.startOf('week') minus one week through endOf('week') (Sunday–Saturday with default locale). Dedupe sets are in memory within a send invocation; no durable send log/distributed scheduler lock prevents a second process from sending again. Source: `src/app.js:173`, `src/automations/automationOrchestrator.js:10`, `src/automations/automationScripts/timeTrackerReminders.js:81`, `src/automations/automationScripts/timeTrackerReminders.js:131`.

AI daily cost rounds six decimals and uses UTC midnight; billing dates/reminders use Phoenix. These are deliberately distinct code clocks, not a shared business-day cost period. The visible ai_training_weekly_upload setting no longer has a scheduled job; current examples are read directly for few-shot prompts. Sources: `src/ai_integrations/bedrock/cost.js:1`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:155`, `src/automations/automationOrchestrator.js:4`.

## 7. Changes, migrations, rollout and repair procedures

### Migration runner

`npm run migrate` invokes scripts/migrate.js, not postgrator. It discovers NNN.description.sql in numeric order. All numbered files must be plain SQL without top-level transaction control or psql meta-commands; the lexer permits quoted/dollar-quoted function contents. A fixed transaction advisory lock serializes history bootstrap/baseline and each apply. Each file executes byte-for-byte through native node-pg inside the same transaction as its schemaversion row; '?' is not reinterpreted by Knex. An already-recorded numeric version is skipped even if its file later changes. Sources: `package.json:14`, `scripts/migrate.js:45`, `scripts/migrate.js:145`, `scripts/migrate.js:199`.

`node scripts/migrate.js --dry-run` takes a READ ONLY transaction and never creates schemaversion. `--baseline N` records existing versions≤N without executing SQL; only use after proving those schema changes already exist. The report's dev baseline18 is a dated environment instruction, not permission to baseline any database to 18. The old postgrator filename mismatch could complete with no migrations; exit 0 was not evidence of schema readiness. Sources: `scripts/migrate.js:128`, `scripts/migrate.js:154`, `migrations/README.md:155`, `scripts/review-2026-09/FINAL_REPORT.md:69`.

### Production rollout order from FINAL_REPORT section 6

1. Verify actual target/schema and backup. Production was recorded as lacking schemaversion; identify which historical files are pending. Never replay 007 merely because there is no migration history. Apply approved pending files individually in numeric order with `psql -X -1 -v ON_ERROR_STOP=1 -f <file>`; this **commits on success**. Sources: `migrations/README.md:59`, `migrations/README.md:101`, `scripts/review-2026-09/FINAL_REPORT.md:70`.
2. Rehearse the approved 019 file in one session using BEGIN, file, the exact audit SELECT from migrations/README.md:70, then ROLLBACK. Save SELECT output **before rollback**, which discards the audit rows. Review all 904 approved IDs for APPLIED/SKIPPED. The lock blocks concurrent writers during rehearsal too. Then separately authorize/execute the committing file. Sources: `migrations/README.md:65`, `migrations/README.md:84`.
3. Apply 020 immediately before updated backend, with **no old-backend account creation between schema and app**. There is deliberately no slug default/trigger to support old inserts. Source: `scripts/review-2026-09/FINAL_REPORT.md:71`.
4. Apply 021 after 020 and before backend code that unconditionally reads tracker_file_owners. It has no independent old-code hazard. Deploy backend, then immediately prepare the production ownership dry run: `DS2_ENV_FILE=.env.prod DATABASE_NAME=ds2_prod node scripts/timeTracking/backfill-tracker-owners.js`. Review its rows and unattributed CSVs in scripts/timeTracking/out; remove unapproved lines. Source: `scripts/review-2026-09/FINAL_REPORT.md:72`.
5. Apply exactly that reviewed CSV with `--apply --manifest <reviewed.csv> --i-know-this-is-prod`. Drift refuses by default. `--accept-drift` deliberately applies the reviewed ownership rather than fresh inference and needs a reviewed decision; existing different ownership still aborts. Check inserted+alreadyApplied equals approved rows, source counts, sample exact keys and both owner-positive/cross-user-negative UI downloads. Older files remain hidden between deploy and backfill; new uploads record ownership themselves. Source: `scripts/review-2026-09/FINAL_REPORT.md:72`, `scripts/timeTracking/backfill-tracker-owners.js:355`.
6. Deploy backend before frontend. Set reviewed INTERNAL_CUSTOMER_IDS and BILLING_TIMEZONE=America/Phoenix. Verify settings, one upload→holding→transaction flow, binary downloads, health dependencies and role boundaries against the intended environment. The first two requirements are report instructions; the end-to-end checks are suggested verification, not evidence already obtained. Source: `scripts/review-2026-09/FINAL_REPORT.md:73`.

Migration 019 flips only exact approved rows whose live account/customer, old total, signed net, exact payment-ID set and reversal/ownership predicates still match. A drifted row is silently skipped and left on 019-review. Its type/null-literal normalizations are independent of the payment manifest. Editing an already-applied 019 file does not rerun it under version tracking; new approvals require a reviewed follow-up apply/migration. Sources: `migrations/README.md:117`, `migrations/README.md:94`, `migrations/019.ledger_data_normalization.sql:1094`.

### Review and backfill tools

| Tool | What it does / refuses |
|---|---|
| same-day-duplicate-statements.js | Reports same-date chains; apply deletes only unique zero-charge duplicate parent matching other current balance and having no stamped/tagged/snapshot/absorption dependencies; >2-parent ambiguity stays manual. |
| mirror-desync.js | Reports parent/latest-child mismatch; apply copies only remaining/paid/fully-paid-date, not unreliable historical payment totals. |
| null-job-transactions.js | Reports NULL/foreign job links; apply relinks only one same-job_type_id candidate; does not infer missing type/create jobs. |
| billday-writeoff-double-credit.js | Report-only old/new statement-gate replay. Supported is included within possible; never add the columns. Historical rounding damage and missing presentation/history make it evidence, not a perfect invoice oracle. |
| positive-total-payments-exceptions.js / positive-total-payments-manifest.js | Exception report and candidate manifest generation; flags still require accountant review, not automatic adoption. |
| stale-unbilled-work.js | Report-only stale work for next-bill review. |
| Sources for above | `scripts/review-2026-09/README.md:24`, `scripts/review-2026-09/README.md:32`, `migrations/README.md:123`. |
| timeTracking/backfill-tracker-owners.js | Exact-key owner planning and reviewed manifest apply; full algorithm in time-tracking.md. No S3 object mutation. `scripts/timeTracking/backfill-tracker-owners.js:177`, `scripts/timeTracking/backfill-tracker-owners.js:355`. |
| timeTracking/build-neutral-template.js | Offline asset/manifest builder from a reviewed workbook. Human review and package/token tests precede committing resulting asset; template upload is not asset regeneration. `src/endpoints/timeTracking/assets/README.md:1`. |
| drift-check.js | Read-only engine/audit/AR comparison, supplied target via shared DB helper. A zero-drift report means three implementations agree, not that historical data was correct. `scripts/drift-check.js:1`. |
| test-coverage-matrix.js | Builds route-to-test reference inventory. A referenced route is not proof every failure path was tested. `scripts/test-coverage-matrix.js:1`, `test/COVERAGE_MATRIX.md:1`. |
| seed_google_auth_admin.sql | Provisioning SQL; writes users and is not a read-only diagnostic. Inspect exact target/fields before any separately authorized use. `scripts/seed_google_auth_admin.sql:1`. |

Report runs require explicit DS2_ENV_FILE and DATABASE_NAME, use READ ONLY REPEATABLE READ, and write CSV/JSON to DS2_REVIEW_OUT_DIR or scripts/review-2026-09/out. Repeating a run overwrites same-named reports. Apply uses SERIALIZABLE, 10-second table-lock timeout, reruns analysis under locks and records before/after; partial file output does not prove commit. Suggested rehearsal order is duplicate, mirror, job repair on a fresh throwaway copy. Sources: `scripts/review-2026-09/_common.js:36`, `scripts/review-2026-09/README.md:46`.

### Local sandbox and test commands

Documented sandbox endpoints are frontend localhost:3003, backend 127.0.0.1:8003, PostgreSQL 127.0.0.1:5433/ds2_local, MinIO port9000/bucket ds2-local. Frontend API must use localhost:8003 for cookie host consistency. ds2_clean is the separate clean-room database; ds2_ref_20260922 is recorded as pristine reference. The backend compose file only starts backend on external ds2_network; it is **not** a self-contained Postgres/MinIO sandbox bootstrap. Current running state is not determined from the code. Sources: `../DS2_Frontend/e2e/README.md:26`, `package.json:10`, `scripts/review-2026-09/FINAL_REPORT.md:257`, `docker-compose.backend.yml:3`.

The following are **write-capable test operations**, listed for a future authorized local run. None was run here. `test:unit` excludes only test/integration/**, so it still discovers endpoint *.integration.spec.js and test/scripts suites that create/drop throwaway databases. `requireDb()` can seed account9001; cleanup deletes fixtures. Do not describe the npm unit command as inherently read-only. Sources: `package.json:7`, `test/integration/_setup.js:60`, `test/scripts/helpers/pgHarness.js:55`.

| Run location / command | Scope and requirements |
|---|---|
| Backend: `DS2_ENV_FILE=.env.local npm run test:unit` | Mocha unit plus discovered DB-capable endpoint/script tests; test/setup forces NODE_ENV=test and placeholder S3 only if unset. |
| Backend: `DS2_ENV_FILE=.env.local npx mocha --require test/setup.js test/integration/coverage-timetracking-timesheets.integration.spec.js --timeout 180000 --exit` | Example one-file HTTP run; repeat independently for coverage-account-users-auth-misc, coverage-downloads-authz, coverage-pending-payments-authz, orchestrator, pii-leak, tracker-excel-end-to-end and other coverage specs. Sequential files avoid shared-fixture contention. |
| Backend: `DS2_ENV_FILE=.env.local npm run test:integration` | Package command discovers all test/integration files in one invocation; the historical final review instead ran files one at a time. |
| Backend: `npm run test:cleanroom` | Loads .env.clean; real three-month ledger/PDF regression on isolated clean-room target. |
| Frontend: `CI=true npm test -- --watchAll=false --runInBand`; `npm run build` | CRA/Jest and production build; build writes artifacts. |
| Frontend/e2e: `npm test` | Separate Playwright package, existing local apps required, one worker/no retries. Preflight checks DB/MinIO identity and AI flag off. Writes via actual UI. Setup/install commands and backend override DS2_BACKEND_DIR are in e2e README. |
| Lambda: `python3 -m unittest discover -s tests` | Unit tests in a separately prepared Lambda dependency environment; database/AWS dependencies are stubbed by these test files. Do not run process_payments.py as a test: CLI is the real pipeline. |
| Sources | `package.json:7`, `test/setup.js:1`, `../DS2_Frontend/package.json:43`, `../DS2_Frontend/e2e/README.md:7`, `../DS2_Frontend/e2e/playwright.config.js:4`, `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:1`. |

## 8. Invariants and recorded verification

Migration specs test transaction/file-history atomicity, SQL verbatim delivery, forbidden wrapper detection, baseline validation, production-looking target refusal and collision/manifest behavior: `test/scripts/migrate.spec.js:1`, `test/scripts/migration-019.spec.js:1`, `test/scripts/migration-020.spec.js:1`, `test/scripts/migration-021.spec.js:1`, `test/scripts/backfill-tracker-owners.spec.js:1`. The harness maps logical ds2_mig_test_* names to ds2_clean and rebuilds only that authorized schema; absent connectivity can skip suites, so a successful exit with pending tests is not full coverage. Sources: `test/scripts/helpers/pgHarness.js:37`, `test/scripts/helpers/pgHarness.js:49`.

FINAL_REPORT's last dated table (2026-09-24) records 970 backend unit including script tests, 156 script tests as a subset, 1,009 integration with zero pending, 18 clean-room, 0/320 three-view drift, 94 frontend tests, clean build and 69/69 Playwright. These are **historical recorded results**, not rerun/independently verified results of this documentation task; do not sum overlapping suites. Source: `scripts/review-2026-09/FINAL_REPORT.md:244`.

## 9. Accountant decisions and current documentation limits

FINAL_REPORT section 3 lists unresolved historical decisions below. Amounts/counts are snapshot findings, not live balances. Source: `scripts/review-2026-09/FINAL_REPORT.md:45`.

| Item | Recorded decision still needed |
|---|---|
| Same-day statements | Named 2026 duplicate pairs plus 2024 pairs require review before selective repair. |
| Bill-day write-offs | 61 write-offs/28 customers; $8,331.75 supported within $12,208 possible, not additive totals. |
| Payment signs | 904 sign-only parents adopted into 019; 14 exceptions remain (stored $11,727 versus tagged net −$28,154.50). |
| Mirrors | Invoice roots 2015 and 506 need reconciliation. |
| Job ownership | Five billable no-job entries ($365), nine cross-customer job links. |
| Stale work | 51 customers/~$14.8K unbilled. |
| Retainer double credit | Customer228/INV-2024-00397 remaining $472 reportedly subtracts $153 retainer payment twice. |
| Stored job totals | 151 families differ, net −$485; next edits recompute, but no blanket historical repair follows from deployment. |
| Internal entities | Customers5/6 carry $1.43M historical billable internal time; config prevents new automatic billing, not retroactive cleanup. |
| Credit/aging design | Run 3 resolves credit statements/carry-forward: default skip, explicit selection and signed balances. AR statement aging still differs from charge aging; oldest charge date is a FIFO estimate. |

The owner decisions supersede the historical report gaps for sent-record locks, bounced corrections, duplicate handling and credit carry-forward. Broader period policies, charge-level aging, general void/reissue workflows and persisted billing_runs remain separate work. Source: `scripts/review-2026-09/FINAL_REPORT.md:59`. Early report text about non-owner flag-off template leakage is historical and superseded by the committed neutral-asset design described later and in current code; it is not a current defect assertion. Sources: `scripts/review-2026-09/FINAL_REPORT.md:43`, `src/endpoints/timeTracking/template-builder.js:1143`.

Fresh platform findings are in [consolidated findings](../_review/findings.md). [F30](../_review/findings.md#f30) is fixed by additive migration 022 and disposable-database lineage tests. Applied schema, environment values, cloud deployment and completion of any accountant repair/backfill remain **not determined from the code**.

Coverage: **4 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

## Owner decisions 3 and 5: migration 023 rollout

This is a future operator procedure; this implementation run did **not** connect to production or AWS, deploy, restart a server or commit code.

1. Review the [owner contract](../decisions/2026-09-24-owner-decisions.md), backup/rehearse, and inventory historical issued statements. Artifact-bearing parents before migration cutover lock automatically; artifact-less issued history requires an approved archival/reconstruction plan before enabling ordinary edits. No historical money is normalized by 023.
2. Pause ledger/import/finalize writers for a coordinated schema/backend/frontend release. Old parent-mirror code is incompatible with the new SQL guards.
3. After 022, manually apply the approved `migrations/023.sent_invoice_locks.sql` with `psql -X -1 -v ON_ERROR_STOP=1 -f` against the separately authorized deployment target. Use its existing secure connection configuration; never substitute a sandbox command by casually changing credentials. No BEGIN/COMMIT inside the file. Save output; rerun is idempotent and must preserve `invoice_lock_policy.legacy_before`.
4. Deploy the matching backend, then frontend. Verify seven evidence/policy tables and eleven triggers. Confirm a preview makes no issue, finalize captures revision 0 and every supporting record, ordinary sent edits return HTTP 409, new payments create children, and an authorized bounced check produces one audited reversal and an archived revision or next-statement balance. Use an approved isolated rehearsal fixture, not invented production customer data.
5. Verify original artifact bytes, exception actor/time/record history, reprint permissions, three-view reconciliation and payment-picker latest balances. Resume writers only with the compatible code. Rolling back application code alone is unsafe because old mirror writes will refuse; preserve all issued evidence and use a reviewed forward fix.

Local run 1 manually applied 023 to ds2_local, ds2_clean and ds2_scenarios on loopback :5433. Business writes in ds2_local are restricted to account 9001. Unit migration/review utilities reuse ds2_clean; scenario files reset ds2_scenarios; MinIO is :9000. The reference database is read only for the owner's requested final count comparison. Tests run one process at a time; no local servers were started/stopped. Logs/counts and observed limits are in the [run results](../decisions/2026-09-24-run-1-results.md).

Revision storage is append-only at the application layer: every attempt uses a unique key. If upload succeeds but DB commit fails, an unreferenced object can remain. Cleanup must compare stored revision/issue references and retain every referenced original; no automated object deletion is part of this change.


## Owner decisions 1 and 4: migration 024 rollout

Future authorized operator step only: back up/rehearse the deployment target; pause financial writers during the migration/backend/frontend cutover. After 023, apply `psql -X -1 -v ON_ERROR_STOP=1 -f migrations/024.retainer_events_duplicates.sql` using the separately approved target connection. The file is plain SQL, idempotent, additive, and makes no existing ledger-row backfill. Save migration output. Deploy the matching backend and frontend together; old code cannot render event activity and must not resume once events are recorded. Retain immutable history/snapshot guards when rolling back; never drop evidence to restore old editing.

Smoke-test a synthetic account on the approved staging database: issue a retainer-funded invoice, refund unused funds, print the next statement, create/dismiss/remove an unissued duplicate and refuse sent removal. Reconcile availability, engine/Audit and AR billed components; verify session actor/reason and untouched original artifact. Run a reviewed duplicate scan only when authorized, as it writes advisory flags/history. No production action is authorized or performed by this implementation run.

Local run 2 applied 024 by hand to ds2_local, ds2_clean and ds2_scenarios on 127.0.0.1:5433. The permitted business-write scope in ds2_local is account9001 only. Two account-provisioning integration specs are forced to ds2_clean by test/setup.js, even with .env.local. An earlier run2 runner missed that override; temporary accounts were removed and the corrected run and boundary incident are documented in the results. Scenario reset includes 024; migration harness resets only ds2_clean and restores the fully migrated synthetic seed. See [run 2 results](../decisions/2026-09-25-run-2-results.md).

## Owner run 3 rollout — migration025 and signed credits

Future production operator step, not executed here: back up and rehearse, pause financial writers, apply migrations through024 then `psql -X -1 -v ON_ERROR_STOP=1 -f migrations/025.credit_statement_selection.sql`, deploy the paired backend then frontend, and resume only after smoke checks.025 adds immutable credit-selection reason evidence without backfilling business rows. Old clients omit selection and safely skip negative statements; deploy the backend before enabling the new selection UI.

Validate draft/no-ledger behavior; finalize=sent and locked; default skip and individually chosen credit; negative/positive/zero carry-forward; signed AR/Audit agreement; session actor/reason; retainer refund evidence, duplicate guarded removal and bounced-check revision/roll-forward. Verify six-minute boundaries and cent rounding. Do not roll back to code that drops signed credits after any credit statement has been issued; restore a compatible backend or use a reviewed recovery plan that preserves immutable evidence. Decision6 is implemented by migration026 below.

Local hand applications of025 completed on ds2_local, ds2_clean and ds2_scenarios (loopback5433); storage remained MinIO9000. No production/AWS connection or server restart is authorized. See [run3 results](../decisions/2026-09-25-run-3-results.md) for exact tests, counts and protected account1 comparison.


### Owner run 4 rollout — migration026

Future authorized operator step only: back up and rehearse; pause financial/import writers; apply migrations through025, then `psql -X -1 -v ON_ERROR_STOP=1 -f migrations/026.audit_ledger.sql`; deploy the matching backend and frontend before resuming writers. Use a non-owner runtime database role without superuser, replication or schema-DDL rights. Grant the runtime SELECT on audit tables, INSERT on audit_records/audit_actions and usage on their sequences; do not grant direct event/head mutation. Capture functions run as the migration owner. Restrict the `audit-records/` storage prefix to conditional unique creates and authorized reads; retain objects and independent hashes/backups outside runtime deletion authority. Verify raw SQL capture as system, authenticated write actors, UPDATE/DELETE/TRUNCATE refusal, chain verification, admin-only profile tab, stored PDF hashes and identical reopening, then reconcile engine/Audit/AR (drift0). Keep existing finalize=sent locks. Never roll back by deleting audit evidence or restoring a backend that omits actor context.

026 was applied by hand only to local ds2_local/ds2_clean/ds2_scenarios, without business-row backfill. Scenario reset includes it; clean-room reset rebuilds its disposable schema instead of truncating protected evidence. The runtime, archive and reconstructed-history limits are in `docs/platform/audit-ledger.md`; executed results are in `docs/decisions/2026-09-25-run-4-results.md`. Production/AWS execution is not authorized or performed.

### Owner run 5 rollout — migration027

Future authorized operator step only: back up and rehearse; apply `027.audit_record_presentations.sql` after 026 using `psql -X -1 -v ON_ERROR_STOP=1 -f migrations/027.audit_record_presentations.sql`, then deploy the matching backend and frontend. Existing capture/issued-lock triggers and runtime role protections stay in place. Extend existing create-only/read-only archive retention to `.evidence.json` objects in the same private `audit-records/` prefix. No new cloud service or permission to delete/overwrite evidence is needed. Smoke-test both print choices, record-type metadata, JSON source digest/anchor verification, legacy PDF verification, and exact reopening of both files, then confirm three-view drift 0. Rollback must preserve both files and all new immutable metadata.

027 was applied by hand only to the three allowed local databases, with scenario/clean-room reset inclusion and no business-row backfill. No production/AWS operation was performed. See `docs/decisions/2026-09-25-run-5-results.md` and `docs/platform/audit-ledger.md`.

### Owner run 6 presentation follow-up

Run 6 requires no migration or data operation. A future authorized release deploys the matching backend formatter/PDF renderer and frontend tab. Check that new client prints summarize archived statement copies with reconciled covered-change counts and plain verification instructions; full evidence still itemizes every copy and retains API paths. Previously stored documents and source archives must reopen with their original bytes. The migration027 and retention requirements above remain unchanged. Local validation and samples: `docs/decisions/2026-09-25-run-6-results.md`. No deployment was performed in this run.
