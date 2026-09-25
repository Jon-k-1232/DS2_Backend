# Initial data and notifications

## 1. Purpose and UI

`PrimaryRouter` loads the initial data blob after login into shared customer data used by grids and selectors. This is not a separate page. The fetch wrapper is `getInitialAppData` in `FetchCalls` (`../DS2_Frontend/src/Routes/PrimaryRouter.js:55`, `../DS2_Frontend/src/Services/ApiCalls/FetchCalls.js:44`).

`DashboardNavbar` includes `NotificationBell`. It shows unread count, opens a notification list, marks one/all read, and routes clicks by notification type. The hook polls unread count every 60 seconds, stops on hidden-page visibility events, and refreshes when visible again. Opening the popover fetches items; marking read refreshes count and items (`../DS2_Frontend/src/Layouts/Drawer/DashboardNavbar.js:69`, `../DS2_Frontend/src/Components/Notifications/NotificationBell.js:13`, `../DS2_Frontend/src/Components/Notifications/useNotifications.js:5`).

Tracker notification staff and their settings UI are documented in [time tracking](../platform/time-tracking.md). Public health checks are documented in [operations](../platform/operations.md). Review date: 2026-09-24; source and tests read only.

## 2. Access rules

| Area | Actual authorization |
|---|---|
| Initial blob | `requireAuth` at mount, account guard only. No role gate or self check. URL userID is ignored. Session role controls removal of only three user fields. Other financial/contact lists are returned even to plain User ([F3](../_review/findings.md#f3)) (`src/app.js:147`, `src/endpoints/initialData/initialData-router.js:4`, `src/endpoints/initialData/initialData-router.js:45`). |
| Notifications | `requireAuth`, `enforceAccountId`, `enforceSelfOrPrivileged`. Plain users must request their own user ID; manager/admin/super admin/owner may request another user's notifications within their account (`src/app.js:161`, `src/endpoints/notifications/notifications-router.js:4`, `src/endpoints/auth/account-scope.js:22`). |

Roles are compared lowercase. Auth uses cookie JWT before Bearer; validates token and loads subject user by email; missing/invalid/expired token or missing user returns HTTP 401. Role/self/account rejection returns HTTP 403. Account parameter must number-convert to integer equal to session account. Frontend manager access accepts admin/manager/super admin and omits backend's owner role (`src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`, `src/endpoints/auth/account-scope.js:7`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common transport behavior: the global 300/minute limiter, unless test/disabled, applies even to public health and can return HTTP 429. JSON parsing can return HTTP 400 malformed body or 413 over 1 MB. Uncaught/asyncHandler errors use HTTP `err.status || 500`, with production `{message:'Server error'}` or development `{message,error}` (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`, `src/utils/asyncHandler.js:1`). No endpoint below accepts a client sort parameter.

### Initial blob

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/initialData/initialBlob/:accountID/:userID` | Required path IDs; account checked, user ignored. No body/search/page/limit/filter | HTTP 200 blob B below | Common auth/account/transport errors; caught read/format failure ->HTTP 200 `{message,status:500}`. No partial-success blob. `src/endpoints/initialData/initialData-router.js:22` |

### List notifications

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/notifications/:accountID/:userID` | Required IDs. Optional `unreadOnly` activates only for exact string `'true'`; optional numeric-converted `limit=30`, capped 200 | HTTP 200 `{message:'ok',notifications:[rawRow]}` | Common auth/account/self/transport errors; HTTP 500 malformed SQL IDs or invalid SQL limit/read failure. No HTTP 400 validation. `src/endpoints/notifications/notifications-router.js:13` |

Effective limit=`Math.min(Number(limit)||30,200)`: 0/NaN revert to30; negatives are not rejected by application code. SQL/knex handling of every fractional value is **not determined from the code**. There is no page/offset/cursor; lists cannot request older pages (`src/endpoints/notifications/notifications-service.js:42`).

### Unread count

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/notifications/:accountID/:userID/unread-count` | Required IDs; no filters/body | HTTP 200 `{message:'ok',count:number}` | Common auth/account/self/transport errors; HTTP 500 SQL/read failure. Missing user has count0. `src/endpoints/notifications/notifications-router.js:25` |

### Mark notification read

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/notifications/:notificationID/:accountID/:userID/read` | Required number-coerced IDs; body unused | HTTP 200 `{message:'ok',notification:rawUpdatedRow}` | Common auth/account/self/transport errors; actual HTTP 404 `{message:'notification not found'}` if no account+user+notification match; HTTP 500 malformed IDs/write failure. `src/endpoints/notifications/notifications-router.js:35` |

### Mark all read

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/notifications/:accountID/:userID/read-all` | Required IDs; body unused | HTTP 200 `{message:'ok'}`, including zero matching rows | Common auth/account/self/transport errors; HTTP 500 SQL/write failure. `src/endpoints/notifications/notifications-router.js:48` |

Health contracts belong to [operations](../platform/operations.md#3-operational-api-reference). Staff membership contracts belong to [time tracking](../platform/time-tracking.md#3-api-reference).

## 4. Data model

Initial data reads all tables listed in section5. User rows contain user_id/account_id/email/display_name/cost_rate/billing_rate/job_title/access_level/is_user_active/created_at. Nonprivileged callers lose only cost_rate, billing_rate, email in the roster and its grid; privileged callers retain all fields. This is not a whole-blob redaction (`src/endpoints/initialData/initialData-router.js:43`, `migrations/schema-snapshot-2026-09-22.sql:1117`).

| Table | Columns, limits and relationships |
|---|---|
| `notifications` | Identity notification_id, non-null account/user; type varchar60; title varchar200; nullable body text; non-null payload JSONB default{}; nullable read_at/expires_at; created_at timestamp defaultnow. Account and user FKs each cascade delete. No enum CHECK restricts type in this schema (`migrations/schema-snapshot-2026-09-22.sql:894`, `migrations/schema-snapshot-2026-09-22.sql:2142`). |
| `time_tracker_staff` | Identity id, non-null unique user_id, is_active boolean defaulttrue, created_at defaultnow. No account_id column: account scope is through users. User FK cascades (`migrations/schema-snapshot-2026-09-22.sql:987`, `migrations/schema-snapshot-2026-09-22.sql:2190`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:51`). |
| `users` | Staff reads user_id/account/display_name/email/active; membership writes never alter the user record (`src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:1`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:40`). |

Notification type constants are tracker_upload_processed, rows_held_for_review, new_customer_needs_addition, ai_processing_failed. They are application constants, not API-validated enum inputs. No public notification-create API exists (`src/endpoints/notifications/notifications-service.js:1`, `src/endpoints/notifications/notifications-router.js:13`). These modules add no financial note markers. Initial data returns stored signs unchanged, including negative payments/write-offs/retainer credit (`src/endpoints/initialData/initialData-router.js:130`).

## 5. Read logic

Blob **B** has all rows below plus `{message:'Successfully Retrieved Data.',status:200}`. Each nested object includes `grid`. Four lists have fixed page1/limit20 metadata; callers cannot change this through the blob endpoint. No search term is supplied. Promise.all performs independent queries without one consistent database snapshot (`src/endpoints/initialData/initialData-router.js:65`, `src/endpoints/initialData/initialData-router.js:190`).

| Blob path / row key | Exact source read and shape additions |
|---|---|
| `customersList.activeCustomerData.activeCustomers` | All customers INNER JOIN owned active contacts, customer active and both account predicates; customer_name ASC; no pagination (`src/endpoints/customer/customer-service.js:1`, `src/endpoints/customer/customer-service.js:52`). |
| `recurringCustomersList.activeRecurringCustomersData.activeRecurringCustomers` | Active recurring account rows INNER JOIN customers on ID; only customer display_name added; no customer active/account predicate or order (`src/endpoints/recurringCustomer/recurringCustomer-service.js:3`). |
| `teamMembersList.activeUserData.activeUsers` | SELECT * active users by account, no order; redaction before grid creation (`src/endpoints/user/user-service.js:2`, `src/endpoints/initialData/initialData-router.js:124`). |
| `transactionsList.activeTransactionsData.activeTransactions` | Transactions.* + customer/employee/work/type labels; INNER customer/user/job, LEFT general description/type; transaction account; created_at DESC; count+first20; pagination (`src/endpoints/transactions/transactions-service.js:1`, `src/endpoints/transactions/transactions-service.js:51`). |
| `invoicesList.activeInvoiceData.activeInvoices` | Invoices.* + customer/creator labels; INNER customer/user; invoice account, invoice_date DESC; parents and snapshots; count+first20; pagination, **no treeGrid** (`src/endpoints/invoice/invoice-service.js:31`, `src/endpoints/invoice/invoice-service.js:59`, `src/endpoints/initialData/initialData-router.js:138`). |
| `accountJobsList.activeJobData.activeJobs` | jobs.* then types.* plus category/customer/creator labels; INNER types/categories/customers/users, jobs account, jobs created_at ASC; all versions/completion states; treeGrid by customer_job_id/parent_job_id (`src/endpoints/job/job-service.js:22`). |
| `jobCategoriesList.activeJobCategoriesData.activeJobCategories` | Raw account categories, active=true, no order (`src/endpoints/jobCategories/jobCategories-service.js:2`). |
| `jobTypesList.activeJobTypesData.jobTypesData` | types.* + category label LEFT JOIN category; type account/active, job_description ASC (`src/endpoints/jobType/jobType-service.js:18`). |
| `writeOffsList.activeWriteOffsData.activeWriteOffs` | writeoffs.* + customer/creator labels and job/type labels; INNER customer/user, LEFT job/type; writeoff account; created_at DESC, count+first20; pagination (`src/endpoints/writeOffs/writeOffs-service.js:1`, `src/endpoints/writeOffs/writeOffs-service.js:40`). |
| `paymentsList.activePaymentsData.activePayments` | payments.* + customer/creator labels; INNER customer/user; payment account; created_at DESC, count+first20; pagination (`src/endpoints/payments/payments-service.js:1`, `src/endpoints/payments/payments-service.js:36`). |
| `accountRetainersList.activeRetainerData.activeRetainers` | retainer rows + customer/creator labels; INNER customer/user; retainer account; created_at DESC, **no active filter**; all rows, treeGrid by retainer_id/parent_retainer_id (`src/endpoints/retainer/retainer-service.js:10`). |
| `workDescriptionsList.activeWorkDescriptionsData.workDescriptions` | Raw owned active general descriptions, general_work_description ASC; note row key workDescriptions, unlike mutation response's workDescriptionsData (`src/endpoints/workDescriptions/workDescriptions-service.js:2`, `src/endpoints/initialData/initialData-router.js:185`). |

Quotes are not in B. Pagination uses counts of those joined queries, not raw table counts, and each count/page pair is separate. There is no sort tie-breaker on the paginated services. Grid derives columns from first-row keys and creates positional IDs; empty grids have empty columns/rows. Trees attach direct parents or promote rows with missing parents (`src/endpoints/initialData/initialData-router.js:130`, `src/utils/pagination.js:22`, `src/utils/gridFunctions.js:6`, `src/utils/gridFunctions.js:68`).

Notification list reads raw rows by account+user, newest created_at first, limited, with optional read_at NULL and mandatory expires_at NULL OR expires_at>current JavaScript Date. Count uses identical ownership/expiry and read_at NULL but no limit. Equality with expiry time is expired. No SQL joins or secondary sort (`src/endpoints/notifications/notifications-service.js:42`).

Tracker-staff selection and active-recipient rules are in [time tracking](../platform/time-tracking.md#5-exact-read-logic). Membership determines recipients, not billing permissions.

Health root reads no data; check performs only `db.raw('SELECT 1')`. Healthy means a query succeeded, not that any feature or integration was verified (`src/endpoints/health/health-service.js:7`).

## 6. Calculations

Blob metadata has page1, limit20, totalItems from count, totalPages=`ceil(count/20)`. It calculates no new balances; it returns stored monetary values. Tree construction does not sum child snapshots (`src/endpoints/initialData/initialData-router.js:130`, `src/utils/pagination.js:22`, `src/utils/gridFunctions.js:68`).

Unread count is Number(database COUNT or0). Staff active IDs are a filter+map, not a role grant. For example, a membership marked active for a deactivated user is present in activeStaffUserIds but absent from email/fan-out recipient queries (`src/endpoints/notifications/notifications-service.js:52`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:19`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:24`).

Auto-ingest notification recipients are the deduplicated truthy union of submitter userId and active tracker-staff user IDs. Type is new_customer_needs_addition when rows are held and any held reason is that value; otherwise rows_held_for_review when held>0; otherwise tracker_upload_processed. Title includes held count/plural or auto-inserted count; body includes auto count, held count and daily AI cost with four decimals. Payload stores `{autoInserted,held,totalCostUsd}` (`src/endpoints/timesheets/auto-ingest-runner.js:32`). No billing/retainer formula belongs to notification or staff CRUD.

## 7. Create, edit, and delete

Initial blob is read-only. It does not write snapshots, notifications or S3 objects. Notification HTTP APIs only set read timestamps. Mark-one matches account+user+notification and writes now even if already read or expired. Mark-all updates every unread row in that account/user, including expired rows hidden by list/count. Each is a single SQL update, with no customer ledger lock and no cross-table side effects (`src/endpoints/notifications/notifications-service.js:61`). There is no public notification delete or mark-unread endpoint.

Internal notification insertion requires truthy account/user/type/title in the single-row helper; body defaults null, payload{}, expiresAt null; payload is passed through if string, otherwise JSON.stringify. Bulk insertion returns[] for empty/missing userIds, otherwise creates one row per supplied ID with the same JavaScript created-at. Bulk helper itself does not deduplicate or validate role/tenant correspondence; the runner selects recipients first. SQL FKs/length/JSONB constraints can reject inserts (`src/endpoints/notifications/notifications-service.js:8`, `src/endpoints/notifications/notifications-service.js:26`).

Auto-ingestion runs only with valid db/account/user/nonempty entryIds and feature flag `TIME_TRACKER_AI_FEATURE_FLAG=on`, or `test` with account listed in comma-separated `TIME_TRACKER_AI_TEST_ACCOUNT_IDS`; default/off/other values skip. It schedules processing with setImmediate, then inserts fan-out notifications. Insertion failure is logged and does not undo processed work. Fatal processing failure is logged; despite the constant, this runner does not emit ai_processing_failed. A persistent queue/retry/delivery guarantee is **not determined from the code** (`src/endpoints/timesheets/auto-ingest-runner.js:8`, `src/endpoints/timesheets/auto-ingest-runner.js:55`, `src/endpoints/timesheets/auto-ingest-runner.js:69`).

UI navigation is tracker_upload_processed ->`/time-tracking/history`; held/new-customer/failure ->`/time-tracking/billingReview?tab=needsReview`; unknown ->`/time-tracking/billingReview`. Notification text is displayed as React text. Navigation still passes through the target route's own role gate; receiving a notification grants no new access (`../DS2_Frontend/src/Components/Notifications/notificationRouting.js:1`, `../DS2_Frontend/src/Components/Notifications/NotificationBell.js:46`, `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:41`).

Staff membership changes are documented in [time tracking](../platform/time-tracking.md#7-create-edit-delete-and-side-effects). They do not alter notification history.

Staff CRUD itself sends no emails. Later tracker validation obtains active staff emails for this account; if missing db/invalid account, empty result or read error, it falls back to comma-separated `TIME_TRACKING_ADMIN_EMAILS`, trimmed/deduplicated. Success/failure email helpers send at their validation call sites, not upon adding staff; timestamps format America/Phoenix. Auto-ingest notifications are database rows, separate from these emails (`src/timeTrackerValidation/notifications.js:10`, `src/timeTrackerValidation/notifications.js:33`, `src/timeTrackerValidation/notifications.js:51`, `src/timeTrackerValidation/notifications.js:79`).

## 8. Invariants, edge cases, and tests

| Rule | Source-read test evidence |
|---|---|
| Plain User roster strips rates/email; admin retains them; full top-level shell shape retained | `test/endpoints/initialData/initialDataUserFields.integration.spec.js:50`, `test/endpoints/initialData/initialDataUserFields.integration.spec.js:66`, `test/endpoints/initialData/initialDataUserFields.integration.spec.js:75`. These assertions do not prove financial/contact payload minimization ([F3](../_review/findings.md#f3)). |
| Initial blob keys, wrong-account rejection, authenticated User access | `test/integration/coverage-account-users-auth-misc.integration.spec.js:1201`. |
| Notification newest-first/unread/self guards/count/mark one/all | `test/integration/coverage-account-users-auth-misc.integration.spec.js:1014`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1062`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1096`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1132`; query behavior `test/endpoints/notifications/notifications-service.spec.js:1`. |
| Healthy and failed database probe; mounted aliases | `test/endpoints/health/healthCheck.spec.js:1`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1171`. |
| Staff list, 201 add, empty-array400, boolean validation, removal | `test/integration/coverage-account-users-auth-misc.integration.spec.js:1430`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1451`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1486`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1528`. |
| Notification routing targets | `../DS2_Frontend/src/Components/Notifications/notificationRouting.test.js:1`. |

## 9. Limitations and open decisions

[F3](../_review/findings.md#f3) in [consolidated findings](../_review/findings.md) describes the initial-data authorization gap: hiding three roster fields leaves account financial and customer-contact lists exposed to ordinary users. Existing related-ID join defects can also flow into this aggregate ([F2](../_review/findings.md#f2) in feature documents). Large unpaginated master/customer/job/retainer lists and independent reads remain part of this endpoint's contract (`src/endpoints/initialData/initialData-router.js:65`).

Notification paging, user-configurable retention, reliable background retry and expiry cleanup are **not determined from the code**. The health check does not verify migration readiness. Staff membership identifies recipients, not permission to approve work; role gates still control billing review (`src/endpoints/notifications/notifications-router.js:13`, `src/endpoints/timesheets/auto-ingest-runner.js:72`, `src/endpoints/health/health-service.js:7`, `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:41`).

Accountant issues in report section3 include duplicate/sign/desynchronized statements, stale/jobless/cross-customer work, internal billability and credit carry; those affect amounts returned in the blob and are not corrected by loading it. See [customers.md](customers.md) for the detailed report list (`scripts/review-2026-09/FINAL_REPORT.md:45`).

Section6 requires backups/reviewed migration rehearsal, schema020 immediately before backend without an account-creation gap, schema021 before backend, then reviewed tracker ownership backfill and employee isolation verification; backend before frontend; explicit internal-customer and billing-timezone settings. A health200 is insufficient evidence for those checks. These are report requirements, not actions performed by this documentation review (`scripts/review-2026-09/FINAL_REPORT.md:67`).

Coverage: **5 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
