# Accounts, users and authentication

Source review: 2026-09-24. Backend-relative `path:line` citations describe checked-out code, not verified production configuration. Frontend paths begin `../DS2_Frontend/`. The original review inspected tests; executed F19/F20 regressions and final local checks are in the [F8–F22 log](../_review/fixes-F8-F22.md).

## 1. Purpose and UI

`/login` renders `Pages/Login/Login.js` and `LoginForm.js`. The form uses GoogleLogin with a `jimkimmel.com` hosted-domain hint, then posts its credential to DS2. Google verification on the backend is authoritative. The UI stores account/user/name/job-title/access-level plus an expiry marker in sessionStorage, not the JWT. Axios sends credentials. Sources: `../DS2_Frontend/src/Routes/PrimaryRouter.js:86`, `../DS2_Frontend/src/Pages/Login/LoginForm.js:15`, `../DS2_Frontend/src/Pages/Login/LoginForm.js:52`, `../DS2_Frontend/src/Services/TokenService.js:7`, `../DS2_Frontend/src/index.js:10`.

`/account/accountUsers` renders `Pages/Account/AccountGrids/AccountUsersGrid.js`; its add/edit/delete components are `AccountForms/AddNewUser/AddUser.js`, `AccountForms/EditAccount/EditUser.js` and `AccountForms/DeleteUser/DeleteUser.js`. `/account/accountSettings` uses `Pages/Account/AccountSettings/AccountSettings.js`, `AccountForms/EditAccount/UpdateAccount.js`, and `UpdateAccountAddress.js`. `/account/automations` uses `Pages/Account/Automations/AccountAutomations.js`. User administration is Super Admin-only; settings/automations are Admin/Super Admin-only. Sources: `../DS2_Frontend/src/Routes/GroupedRoutes/AccountRoutes/AccountRoutes.js:1`, `../DS2_Frontend/src/Routes/GroupedRoutes/AccountRoutes/AccountRoutes.js:23`, `../DS2_Frontend/src/Routes/GroupedRoutes/AccountRoutes/UsersSubRoutes.js:37`.

## 2. Access rules and role matrix across routers

`requireAuth` prefers cookie `ds2_auth` over Bearer authorization. It verifies HS256, then looks up an active user by token subject/email on **every request**. Request identity comes from that current row, not URL/body fields. Missing/invalid/expired token or missing/inactive user gives 401; database lookup exceptions also become 401. It does not test accounts.is_account_active. `checkRole` repeats token/user validation and lowercases the stored role without trimming it. Sources: `src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`.

`enforceAccountId` requires a present authenticated account and integer numeric URL account equal to it; Super Admin has no cross-account exception. Missing identity/account gives 401; mismatch/malformed account gives 403. `enforceSelfOrPrivileged` accepts numeric user-ID equality or lowercase manager/admin/super admin/owner. Canonical user creation/update accepts only **Super Admin, Admin, Manager, User**, with trim/case normalization. Thus legacy `Owner` can pass several backend gates but cannot be newly assigned through users CRUD and passes frontend manager gates; Admin and Super Admin gates remain restricted to their named roles. Sources: `src/endpoints/auth/account-scope.js:7`, `src/endpoints/auth/account-scope.js:22`, `src/endpoints/user/userObjects.js:8`, `../DS2_Frontend/src/Routes/GroupedRoutes/AccountRoutes/AccountRoutes.js:23`.

In the matrix, **M** = Manager, Admin, Super Admin, legacy Owner; **A** = Admin, Super Admin; **S** = Super Admin. All protected account-param routers register enforceAccountId; account update without a URL account uses req.user.account_id. Sources: `src/app.js:121`, `src/endpoints/auth/jwt-auth.js:91`, `src/endpoints/account/account-router.js:162`.

| Router/mount | Backend gate and exceptions |
|---|---|
| `/auth` | Public google/logout; renew requires valid active identity. `src/endpoints/auth/auth-router.js:23`, `src/endpoints/auth/auth-router.js:80`. |
| `/customer` | Authentication at mount; all six handlers require M. `src/endpoints/customer/customer-router.js:29`, `src/endpoints/customer/customer-router.js:118`, `src/endpoints/customer/customer-router.js:212`, `src/endpoints/customer/customer-router.js:239`, `src/endpoints/customer/customer-router.js:316`, `src/endpoints/customer/customer-router.js:384`. |
| `/jobs`, `/transactions`, `/invoices`, `/jobCategories`, `/jobTypes`, `/quotes`, `/payments` | Authentication + M at mount. `src/app.js:130`, `src/app.js:138`. |
| `/recurringCustomer` | Authentication at mount + M throughout router. `src/app.js:144`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:13`. |
| `/retainers`, `/writeOffs`, `/workDescriptions` | Authentication + M. `src/app.js:145`, `src/app.js:148`. |
| `/user` | Authentication + self/privileged URL user; create/update/delete S; fetch self or privileged. `src/endpoints/user/user-router.js:1`, `src/endpoints/user/user-router.js:41`. |
| `/account` | Create S; update/information/automation GET+PUT A. `src/endpoints/account/account-router.js:115`, `src/endpoints/account/account-router.js:151`, `src/endpoints/account/account-router.js:234`, `src/endpoints/account/account-router.js:275`. |
| `/initialData` | Authentication + own account only. Nonprivileged callers receive empty collections and only their own user_id/display_name; privileged roles retain full lists (fixed [F3](../_review/findings.md#f3)). `src/app.js:147`, `src/endpoints/initialData/initialData-router.js:22`, `src/endpoints/initialData/initialData-router.js:56`. |
| `/timesheets` | Self/privileged queryUserID on per-employee reads; M for account queue/count/move/delete; AI kickoff allows self or privileged entries. `src/endpoints/timesheets/timesheets-router.js:5`, `src/endpoints/timesheets/timesheets-router.js:36`, `src/endpoints/timesheets/timesheets-router.js:88`. |
| `/time-tracking` | Self/privileged URL user; additional owner/on-behalf/template rules in time-tracking.md. `src/endpoints/timeTracking/timeTracking-router.js:30`. |
| `/time-tracker-staff` | Authentication + M. `src/app.js:151`. |
| `/ai-integration` | Authentication; every method/path returns 410. No account parameter guard in deprecated router. `src/app.js:154`, `src/endpoints/aiIntegration/aiIntegration-router.js:16`. |
| `/pending-payments`, `/billing-review`, `/accountsReceivable` | Authentication + M. Pending-PDF upload additionally account 1 only. `src/app.js:155`, `src/app.js:160`, `src/app.js:169`, `src/endpoints/pendingPayments/pendingPayments-router.js:274`. |
| `/notifications` | Authentication, account and self/privileged URL user. `src/app.js:161`, `src/endpoints/notifications/notifications-router.js:1`. |
| `/accountAudit` | Authentication + S in router. Generic invoice download refuses audit-prefix files for all roles; use the dedicated S endpoint (fixed [F4](../_review/findings.md#f4)). `src/endpoints/accountAudit/account-audit-router.js:37`, `src/utils/downloadAuthorization.js:40`. |
| `/analytics` | Authentication + S at mount. `src/app.js:170`. |
| `/api/health`, `/healthz` | Public router aliases; global rate limit still applies. `src/app.js:120`, `src/app.js:152`. |

## 3. API reference

`A=:accountID`, `U=:userID`; required path values inherit the account/self rules above. Protected routes share 401/403, 429 rate-limit errors, and unexpected 500. JSON is limited to 1 MB (413); malformed JSON gives 400. Auth endpoints additionally share 30 requests per 15 minutes; general API defaults to 300/minute. Sources: `src/app.js:70`, `src/app.js:81`, `src/app.js:100`, `src/app.js:178`.

### Google login

| Item | Contract |
|---|---|
| Method/path | `POST /auth/google` |
| Input | Required truthy `credential`, intended Google ID-token string; no separate type/length validation beyond JSON limit. |
| Success | **200** `{user:<full users row>,status:200}` and httpOnly cookie. No JWT in JSON. |
| Errors | **400** missing credential; **401** Google verification, audience, Workspace domain or verified-email failure; **403** exact email has no active provisioned user; **500** login-log/database/JWT-signing failure; rate/parser errors above. |
| Source | `src/endpoints/auth/auth-router.js:23`, `src/endpoints/auth/auth-service.js:8` |

### Renew session

| Item | Contract |
|---|---|
| Method/path | `POST /auth/renew` |
| Input | Still-valid JWT; no identity/body fields used. |
| Success | **200** `{status:200}` and fresh cookie/JWT. |
| Errors | **401** invalid/expired/inactive identity; **500** signing/system failure; shared parser/rate errors. |
| Source | `src/endpoints/auth/auth-router.js:80` |

### Logout

| Item | Contract |
|---|---|
| Method/path | `POST /auth/logout` |
| Input | None; no authentication required. |
| Success | **200** `{status:200}`, clears cookie at same path/security attributes. |
| Errors | Shared parser/rate/system errors; no logout-specific validation. |
| Source | `src/endpoints/auth/auth-router.js:93`, `src/endpoints/auth/auth-cookie.js:24` |

### Create account

| Item | Contract |
|---|---|
| Method/path | `POST /account/createAccount` |
| Input | S; JSON `{account:{...}}`, fields below. Account ID allocated by server; storage_slug input ignored. |
| Success | **200** `{account:{returnedFields:<merged account+address>,grid},message:'Successfully updated customer.',status:200}`. This message is used even on creation. |
| Errors | **400** missing/blank account name/type or invalid text types/lengths; **500** other constraint/conversion or address persistence failures. All account/address writes roll back together ([F20](../_review/findings.md#f20), fixed). Shared authorization/rate/parser errors. |
| Source | `src/endpoints/account/account-router.js:115` |

### Update account/settings/address

| Item | Contract |
|---|---|
| Method/path | `PUT /account/updateAccount` |
| Input | A; JSON `{account:{...partial fields...}}`; authenticated account replaces body account_id. Any supplied address-field set requires positive integer account_info_id. |
| Success | **200** same merged `returnedFields/grid/message/status` shape; only supplied fields change. |
| Errors | **400** invalid logo key or absent/invalid address ID; **500** required-field/length/DB errors, absent account or a valid-shaped address ID not belonging to the account (transaction rolls back). |
| Source | `src/endpoints/account/account-router.js:151` |

### Account information/logo

| Item | Contract |
|---|---|
| Method/path | `GET /account/AccountInformation/A/U` (case as declared) |
| Input | A; no optional query/body fields. U is not used to select the account. |
| Success | **200** `{account:{accountData:<joined account/address plus account_company_logo,account_logo_s3_key,account_logo_base64,account_logo_content_type,account_logo_source>},message,status}`. Source is `s3` or `unavailable`; type defaults image/png. |
| Errors | **404** account join empty; **500** DB/system exception. Missing/unreadable/invalid logo is represented as unavailable, not a failed account response. |
| Source | `src/endpoints/account/account-router.js:48`, `src/endpoints/account/account-router.js:234` |

### Read automation settings

| Item | Contract |
|---|---|
| Method/path | `GET /account/automations/A/U` |
| Input | A; no optional query/body fields. |
| Success | **200** `{automations:[{key,label,description,isEnabled,recipientUserIds}],availableUsers:[{userId,displayName,email}],status:200}`. This GET may insert defaults and prune stored recipients. |
| Errors | **400** invalid numeric account in handler (normally guard rejects first); **500** database/service failure. |
| Source | `src/endpoints/account/account-router.js:275` |

### Update automation setting

| Item | Contract |
|---|---|
| Method/path | `PUT /account/automations/A/U` |
| Input | A; required nonempty `automationKey`; at least one of `isEnabled` or `recipientUserIds`. Enabled accepts boolean, trimmed case-insensitive 'true'/'false', or number (only 1 is true). Recipients must be array; elements parseInt, service deduplicates positive integers; every retained ID must be an active account user. Empty array is allowed. |
| Success | **200** `{automation,status:200}`. |
| Errors | **400** invalid key, account, enabled type/value, nonarray recipients, no updates, or inactive/foreign recipient. **500** database/service failure. Rejected requests preserve both enabled state and recipients ([F19](../_review/findings.md#f19), fixed). |
| Source | `src/endpoints/account/account-router.js:332`, `src/endpoints/account/automation-settings-service.js:56` |

### Create user

| Item | Contract |
|---|---|
| Method/path | `POST /user/createUser/A/U` |
| Input | S; required `user` object; accepted fields in user field table below. Account is taken from URL; accessLevel is required/canonicalized. |
| Success | **200** `{teamMembersList:{activeUserData:{activeUsers,grid}},message:'Success',status:200}`. |
| Errors | **400** noncanonical/missing accessLevel; **500** required DB field/unique active email/rate/length error; shared errors. |
| Source | `src/endpoints/user/user-router.js:41`, `src/endpoints/user/userObjects.js:26` |

### Update user

| Item | Contract |
|---|---|
| Method/path | `PUT /user/updateUser/A/U` |
| Input | S; `user.userID` is target (different from URL actor), `accessLevel` required, other accepted fields below. |
| Success | **200** updated active roster/grid as above; nonexistent target is a zero-row success. |
| Errors | **400** invalid role, nonboolean active flag, self-deactivation, or removal of last active Super Admin by deactivation/demotion; **500** DB/constraint/conversion error. |
| Source | `src/endpoints/user/user-router.js:73` |

### Delete user

| Item | Contract |
|---|---|
| Method/path | `DELETE /user/deleteUser/A/U` |
| Input | S; U is target to delete; no body. |
| Success | **200** roster/grid as above, even if target does not exist. |
| Errors | **400** deleting self or last active Super Admin; **500** FK/database error, reported as data tied to user. |
| Source | `src/endpoints/user/user-router.js:118` |

### Fetch user

| Item | Contract |
|---|---|
| Method/path | `GET /user/fetchSingleUser/A/U` |
| Input | Self or privileged; U is target. No optional parameters. |
| Success | **200** `{activeUserData:{activeUser:<users row>,grid},message,status:200}`. Inactive targets can be fetched by privileged callers. `grid` receives an object rather than array, so it is empty. |
| Errors | **404** target not in account; **500** DB/system error; shared errors. |
| Source | `src/endpoints/user/user-router.js:154`, `src/utils/gridFunctions.js:6` |

Initial application data is documented in [initial data and notifications](../work/initial-data-and-notifications.md#initial-blob).

### Account field contract

All fields live in `body.account`; strings are recursively sanitized with xss. The API does not enforce the schema lengths with friendly field errors; PostgreSQL does. Unknown keys are not copied. Sources: `src/utils/sanitizeFields.js:1`, `src/endpoints/account/accountObjects.js:15`.

| Fields | Type, requiredness and database limits |
|---|---|
| account_name, account_type | String; required/non-null on create, optional on update, maximum 100/50 characters. |
| is_account_active | Converted with JavaScript Boolean; omitted create becomes false; omitted update preserved. String 'false' is truthy, not a typed false. |
| account_statement, account_interest_statement, account_invoice_template_option, account_company_logo | Optional nullable strings; limits 255/255/100/255. Nonempty logo update must be safe own-slug `app/assets/` key; null/empty clear allowed. |
| created_at | Optional create date processed by dayjs (omitted means now); ignored on update. |
| account_info_id | Required positive integer if update contains any address fields; no client-created ID on account create. |
| account_street, account_city, account_state, account_zip, account_email, account_phone | Optional nullable strings; limits 255/100/2/10/255/20. No format validation for phone/email/state beyond DB type/length. |
| is_this_address_active, is_account_physical_address, is_account_billing_address, is_account_mailing_address | Boolean conversion on supplied fields; create omission becomes false. No rule requiring exactly one address type. |
| storage_slug, account_invoice_interest_rate, ai_daily_cost_cap_usd | Not accepted by the create/update mappers, even though the latter two exist in schema. |
| Source | `src/endpoints/account/accountObjects.js:15`, `src/endpoints/account/accountObjects.js:63`, `migrations/schema-snapshot-2026-09-22.sql:155`, `migrations/schema-snapshot-2026-09-22.sql:190`, `src/endpoints/account/account-router.js:179`. |

### User field contract

| Fields in body.user | Type, requiredness and handling |
|---|---|
| userEmail, userDisplayName, role | Email/display/job-title strings, non-null on create, lengths 255/100/50. `role` means job title, **not** access level. No explicit email syntax validation. |
| accessLevel | Required on create/update; only four canonical roles listed above. |
| costRate, billingRate | Database numeric(10,2), nullable. Create applies Number (e.g. empty string becomes 0); update passes raw values. No explicit positivity/finite/two-decimal validation here. |
| isActive | Create-only; default true if omitted, otherwise Boolean(value). |
| userID, isUserActive, createdAt | Update target ID; optional literal-boolean update active value; optional raw created_at replacement. Omitted values are passed as undefined and skipped by Knex. Strings, numbers and null are refused with 400; omission preserves the stored flag (fixed [F29](../_review/findings.md#f29)). |
| accountID | Ignored for authority; authenticated URL account replaces it. |
| Source | `src/endpoints/user/userObjects.js:26`, `src/endpoints/user/userObjects.js:41`, `src/endpoints/user/user-router.js:41`, `migrations/schema-snapshot-2026-09-22.sql:1117`. |

## 4. Data model

| Table/columns | Use |
|---|---|
| accounts | Fields above plus generated account_id and immutable unique non-null storage_slug from migration 020. No ledger amounts changed by account CRUD. `migrations/020.accounts_storage_slug.sql:52`. |
| account_information | Generated account_info_id, account FK, address/contact/boolean fields and created_at. The read is an inner join, not an active-address lookup. `src/endpoints/account/account-service.js:4`. |
| users | Generated user_id, account, email, display, cost/billing rates, job_title, access_level, active, created_at. Active email is globally unique by exact stored email, not LOWER(email). `migrations/016.google_auth_drop_user_login.sql:1`; `migrations/schema-snapshot-2026-09-22.sql:1117`. |
| user_login_log | user_id, account_id, login_ip inserted on successful provisioning lookup before issuing JWT. Legacy user_login table is removed, not this log. `src/endpoints/auth/auth-router.js:60`, `migrations/016.google_auth_drop_user_login.sql:1`. |
| account_automation_settings / account_automation_recipients | Account/key/enabled/updated_at and account/key/user membership. Read can create defaults/prune recipients. `src/endpoints/account/automation-settings-service.js:7`. |

Accounts/users/auth introduce no negative-payment convention or billing note marker. Bootstrap returns existing ledger values unchanged; their signs are not normalized here. Source: `src/endpoints/initialData/initialData-router.js:79`.

## 5. Read logic

Login uses exact email equality plus is_user_active=true and `.first()`; no account selector or join. Google claims must match configured audience, nonempty configured Workspace domain (case-insensitive hd), and email_verified. Successful login inserts the preferred forwarded IP (first 192.168.* or 172.31.* if present, otherwise first forwarded value, otherwise req.ip). Sources: `src/endpoints/auth/auth-service.js:8`, `src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-router.js:9`.

Account information selects all columns from accounts inner-joined account_information on account_id, filters account ID and takes the first result without address ordering or active filter. It can therefore choose any joined address if multiple exist. Logo behavior is in [storage-and-downloads.md](storage-and-downloads.md). Source: `src/endpoints/account/account-service.js:4`, `src/endpoints/account/account-router.js:234`.

User fetch filters user_id+account_id without active filter. Post-mutation roster selects every active account user, all columns, without ordering/paging. Last-Super-Admin check counts other active users in the account with LOWER(access_level)='super admin'. Source: `src/endpoints/user/user-service.js:3`, `src/endpoints/user/user-service.js:23`, `src/endpoints/user/user-service.js:29`.

Automation read first inserts missing defaults ON CONFLICT IGNORE. It selects own settings and recipients and maps results in definition order; missing settings default enabled. Active account users provide availableUsers. Stale/inactive recipient IDs are removed by calling replacement during GET. Sources: `src/endpoints/account/automation-settings-service.js:7`, `src/endpoints/account/automation-settings-service.js:20`, `src/endpoints/account/account-router.js:290`.

The bootstrap payload, privileged queries, first-page limits and staff projection are documented in [initial data and notifications](../work/initial-data-and-notifications.md#5-read-logic). That guide is the sole owner of the initial-data contract.

## 6. Calculations

JWT expiry uses configured JWT_EXPIRATION through jsonwebtoken; cookie lifetime separately accepts digits with optional s/m/h/d unit, falling back to 11 hours for absent/unrecognized input. Cookie is httpOnly, SameSite=Strict, path=/, Secure only in production. UI expiry marker always defaults to 11 hours, independently of backend environment. Example: `2h` cookie lifetime is 7,200,000 ms; an 11-hour UI marker need not match it. Sources: `src/endpoints/auth/auth-service.js:38`, `src/endpoints/auth/auth-cookie.js:10`, `../DS2_Frontend/src/Services/TokenService.js:8`.

New storage slug base replaces each character outside ASCII letters/digits with an underscore; it does not collapse runs. Empty base uses account_ID. Under an account-storage advisory lock it tries base, base_ID, base_ID_2, base_ID_3... against the live table. Thus two names `A B` and `A_B` collide on `A_B`; the later account gets a suffixed free candidate. Migration 020 preserves the lowest account ID's bare slug and resolves collisions against live values, including names already containing suffixes. JavaScript UTF-16 emoji handling is matched by SQL's double-underscore conversion. Sources: `src/utils/invoicePath.js:1`, `src/utils/storageSlug.js:47`, `src/utils/storageSlug.js:107`, `migrations/020.accounts_storage_slug.sql:54`.

Grid conversion derives columns from the first row's keys and makes index-based row IDs. Pagination metadata is totalPages=ceil(totalItems/limit), including 0 pages for 0 rows. These are presentation values, not ledger calculations. Sources: `src/utils/gridFunctions.js:6`, `src/utils/pagination.js:1`.

## 7. Create, edit, delete and side effects

Account creation reserves a sequence ID and allocates/inserts the slug transactionally, with one savepoint retry for a slug-unique conflict. Account and account_information are committed in one encompassing transaction after text validation. Address persistence failure rolls back the account and slug too; sequence gaps are harmless ([F20](../_review/findings.md#f20), fixed). Update, by contrast, writes the account and requested address together and rolls back if either row is absent. It preserves omitted fields/created_at and ignores storage_slug input. No account-delete endpoint is mounted despite a service helper. Sources: `src/endpoints/account/account-service.js:41`, `src/endpoints/account/account-service.js:70`, `src/endpoints/account/account-router.js:125`, `src/endpoints/account/account-router.js:209`.

User create writes one scoped row, then rereads roster. Update can change email/role/rates/active/created_at, but not account ownership. Changes to role or active status affect the next authenticated request because it rereads users; changing email prevents old email-subject JWTs finding the user. Delete is a hard delete subject to FK restrictions. Existing billed transactions are not repriced by changing a user's rate; future ingestion reads the current billing rate. Sources: `src/endpoints/user/user-service.js:9`, `src/endpoints/user/user-service.js:15`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:575`.

Self-deactivation uses the validated boolean. Update and delete acquire the same account FOR NO KEY UPDATE lock and re-read/count active Super Admins inside the mutation transaction. Concurrent demotions therefore cannot both remove the last administrator (fixed [F29](../_review/findings.md#f29)); `review-user-guards.integration.spec.js` covers malformed flags, omission, self-deactivation and a controlled concurrent demotion.

Automation update serializes on the account row and commits enabled state and recipient replacement together. Replacement validates requested active owned users before deleting old recipients. Invalid recipients or later write failures roll back the full request ([F19](../_review/findings.md#f19), fixed). An intentionally saved empty recipient list retains the existing meaning of all active users with email. Automation keys are thursday_reminder_emails, friday_reminder_emails, missing_tracker_reminders and ai_training_weekly_upload. The last remains configurable but has no scheduled upload job; see operations. Sources: `src/endpoints/account/automation-settings-service.js:56`, `src/endpoints/account/automation-settings-service.js:101`, `src/automations/automationScripts/timeTrackerReminders.js:24`, `src/automations/automationDefinitions.js:1`.

Logout clears only the cookie; it does not revoke a separately held JWT or write a server session record. Renewal requires an unexpired JWT; it does not re-contact Google. Source: `src/endpoints/auth/auth-router.js:80`.

## 8. Invariants and tests

| Behavior | Inspected test source |
|---|---|
| Account body cannot redirect update across tenants; partial updates preserve omitted fields; invalid address rolls back | `test/integration/coverage-account-users-auth-misc.integration.spec.js:305`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:409`. |
| Concurrent/suffixed slug allocation; canonical role validation; inactive create honored | `test/integration/coverage-account-users-auth-misc.integration.spec.js:527`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:732`. |
| Unknown user update/delete return 200; fetch missing gives 404 | `test/integration/coverage-account-users-auth-misc.integration.spec.js:830`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:865`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:910`. |
| Google missing/invalid credential and renew cookie | `test/integration/coverage-account-users-auth-misc.integration.spec.js:931`. Real Google account verification is not established by those invalid-token cases. |
| Role and self/last-super guards | `test/endpoints/auth/roleGates.integration.spec.js:1`, `test/endpoints/user/userGuards.integration.spec.js:1`. |
| Slug input dropped by mappers; migration collision/Unicode behavior | `test/endpoints/account/accountObjects.spec.js:1`, `test/scripts/migration-020.spec.js:1`. |

## 9. Limitations and open decisions

Provisioning a DS2 row does not provision a Google Workspace account. Account-active flags do not revoke login. Duplicate lowercase variants of email are not prevented by the exact active-email index. Missing-field errors often surface as 500. The exact desired policy for these cases is not determined from the code. Sources: `src/endpoints/auth/auth-service.js:26`, `src/endpoints/user/userObjects.js:26`, `migrations/016.google_auth_drop_user_login.sql:1`.

Migration 020 must immediately precede the updated backend, with no old-backend account-creation interval: old code cannot populate the new NOT NULL slug. Migrations/backfill and unresolved historical financial questions are detailed in [operations.md](operations.md), from `scripts/review-2026-09/FINAL_REPORT.md:45` and `scripts/review-2026-09/FINAL_REPORT.md:69`. Findings linked here are [F3](../_review/findings.md#f3), [F4](../_review/findings.md#f4), [F19](../_review/findings.md#f19), [F20](../_review/findings.md#f20) and [F29](../_review/findings.md#f29) in [consolidated findings](../_review/findings.md).

Coverage: **12 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
