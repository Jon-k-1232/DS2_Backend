# General work descriptions

## 1. Purpose and UI

General work descriptions are the account's reusable labels for time and charge entries. The list is `/jobs/workDescriptionsList`. Its grid opens the add form. Edit and delete are `/jobs/workDescriptionsList/editWorkDescription` and `/jobs/workDescriptionsList/deleteWorkDescription`. Files: `../DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/JobRoutes.js:30`, `../DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/WorkDescriptionSubRoutes.js:35`, `../DS2_Frontend/src/Pages/WorkDescriptions/WorkDescriptionGrids/WorkDescriptionGrids.js:1`. Time and charge selectors use these labels (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/TimeOptions.js:44`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/ChargeOptions.js:25`).

This is a source review dated 2026-09-24. Tests were read, not executed. Backend paths are relative to DS2_Backend; `../DS2_Frontend/` identifies the frontend repository.

## 2. Access rules

All four endpoints require authentication and `requireManagerOrAdmin`: case-insensitive `manager`, `admin`, `super admin`, or `owner`. Authentication prefers the session cookie, then a Bearer token, verifies it, and retrieves the user by JWT subject email. Missing/expired/invalid tokens or missing users produce HTTP 401. A disallowed role produces HTTP 403 (`src/app.js:148`, `src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`).

`enforceAccountId` requires the URL account to convert to an integer equal to the authenticated account; otherwise HTTP 403. No `enforceSelfOrPrivileged` is registered here. Create records the URL `userID`; update records the body `createdByUserID`. Neither is checked against the actor by this router (`src/endpoints/workDescriptions/workDescriptions-router.js:4`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/workDescriptions/workDescriptionsObjects.js:8`). The frontend gate allows only `admin`, `manager`, and `super admin`, so `owner` differs from the backend (`../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common transport errors: HTTP 401/403 above; HTTP 429 after 300 requests/minute per client unless rate limiting is disabled/test mode; malformed JSON HTTP 400 and JSON bodies over 1 MB HTTP 413. Uncaught errors use HTTP `err.status || 500` with `{message}` in production and an additional `error` outside production (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`). In the tables, **E500** means **HTTP 200** with `{message, status:500}` from the route's catch, including mapper, SQL type/length/FK, or list-refresh errors. A missing nested object fails sanitization (`src/utils/sanitizeFields.js:8`).

All path IDs are required strings; the account guard validates `accountID`. Other IDs are passed to SQL without a positive-integer precheck. There are no pagination, search, sorting, or filtering query parameters on these routes (`src/endpoints/workDescriptions/workDescriptions-router.js:13`).

### Create

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/workDescriptions/createWorkDescription/:accountID/:userID` | Required `workDescription` object; create fields below | HTTP 200, `{workDescriptionsList:{activeWorkDescriptionsData:{workDescriptionsData:[row],grid}}, message:'Successful',status:200}` | Common errors; E500 for missing body object, invalid DB values or query failure. `src/endpoints/workDescriptions/workDescriptions-router.js:13`, `src/endpoints/workDescriptions/workDescriptions-router.js:121` |

### Detail

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID` | Path IDs only | HTTP 200, `{activeWorkDescriptionData:{workDescriptionData:[row],grid},message:'Successful',status:200}`; unknown/foreign ID within the permitted URL account returns an empty array, not 404 | Common errors; E500 for malformed SQL ID or read failure. `src/endpoints/workDescriptions/workDescriptions-router.js:35` |

### Update

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/workDescriptions/updateWorkDescription/:accountID/:userID` | Required `workDescription`; update fields below | Same refreshed list as create | Common errors; HTTP 404 `{message:'Work description not found.',status:404}` when update affects zero rows; E500 for mapper/DB/list failure. `src/endpoints/workDescriptions/workDescriptions-router.js:63` |

### Delete

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID` | Path IDs only | Same refreshed list as create | Common errors; E500 if any account transaction references the description, or SQL/read fails; HTTP 404 if delete affects zero rows. `src/endpoints/workDescriptions/workDescriptions-router.js:91` |

| Body field | Type, requirement, and mapping |
|---|---|
| `generalWorkDescription` | String; required on create by DB `NOT NULL`; max 255 characters. Empty text is not explicitly refused. On update an omitted string is not explicitly validated (`src/endpoints/workDescriptions/workDescriptionsObjects.js:8`, `migrations/schema-snapshot-2026-09-22.sql:378`). |
| `estimatedTime` | Required integer-compatible number/string for a successful ordinary save; converted with `Number`. Stored as integer, no positive/min/max business validation. `null`/empty string convert to zero; omission converts to NaN and fails integer storage (`src/endpoints/workDescriptions/workDescriptionsObjects.js:11`, `migrations/schema-snapshot-2026-09-22.sql:379`). |
| `isGeneralWorkDescriptionActive` | Optional boolean or string; null/undefined defaults to true; only `true` or `'true'` becomes true when supplied, all other supplied values become false. Applies to create and update (`src/endpoints/workDescriptions/workDescriptionsObjects.js:6`). |
| `generalWorkDescriptionID` | Update identity, number-coerced; required to identify a row (`src/endpoints/workDescriptions/workDescriptionsObjects.js:17`). |
| `createdByUserID` | Update creator ID, number-coerced and FK-backed; effectively required. It replaces the original creator (`src/endpoints/workDescriptions/workDescriptionsObjects.js:23`, `migrations/schema-snapshot-2026-09-22.sql:1854`). |
| `createdAt` | Optional update timestamp, passed through; supplying it can replace `created_at` (`src/endpoints/workDescriptions/workDescriptionsObjects.js:22`). |
| `accountID` | Body value is overridden by the verified URL account on update; create uses the URL directly (`src/endpoints/workDescriptions/workDescriptions-router.js:20`, `src/endpoints/workDescriptions/workDescriptions-router.js:73`). |

Strings are passed through the shared recursive XSS sanitizer before mapping. Sanitization is not a field-schema validator (`src/utils/sanitizeFields.js:8`).

## 4. Data model

`customer_general_work_descriptions` stores `general_work_description_id`, `account_id`, `general_work_description`, integer `estimated_time`, `is_general_work_description_active`, default-now `created_at`, and `created_by_user_id`. Account and creator have FKs; descriptions referenced by `customer_transactions.general_work_description_id` cannot be physically deleted through the FK. AI suggestions also reference descriptions (`migrations/schema-snapshot-2026-09-22.sql:375`, `migrations/schema-snapshot-2026-09-22.sql:1798`, `migrations/schema-snapshot-2026-09-22.sql:1846`, `migrations/schema-snapshot-2026-09-22.sql:2094`). There are no money signs or note markers in this table.

## 5. Read logic

The list, used by initial data and every successful mutation, selects all columns from descriptions where `account_id=accountID` and `is_general_work_description_active=true`, ordered by `general_work_description ASC`. No joins, grouping, or pagination. Detail selects by description ID plus account, including inactive rows, with no order (`src/endpoints/workDescriptions/workDescriptions-service.js:2`). Initial data names the array `workDescriptions`; mutation responses name it `workDescriptionsData` (`src/endpoints/initialData/initialData-router.js:185`, `src/endpoints/workDescriptions/workDescriptions-router.js:125`).

`grid` is `{columns,rows}`. Columns come from the first row's keys, with title-cased underscore-separated names; each row gets a positional `id`. An empty list produces empty columns/rows (`src/utils/gridFunctions.js:6`).

## 6. Calculations

This CRUD path only converts `estimatedTime` with `Number`; it does not calculate a rate, line amount, or job total. The unit for this estimate is **not determined from the code** in the mapper/schema. Time pricing uses the chosen employee's `billing_rate`, not this estimate (`src/endpoints/workDescriptions/workDescriptionsObjects.js:11`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.js:35`).

## 7. Create, edit, and delete

Create inserts one row. Update changes that row in place by account and ID, including optional creation time and supplied creator. There is no version history, customer-row lock, or explicit transaction spanning mutation and refreshed list. Deactivation removes the row from active selectors but retains existing transaction references (`src/endpoints/workDescriptions/workDescriptions-service.js:10`, `src/endpoints/workDescriptions/workDescriptions-router.js:63`).

Delete first queries **all** transactions in the account with this description ID, regardless of billable or billed status. Any match refuses deletion. With no matches it attempts a hard delete. Other FKs, including AI suggestions, can still refuse at SQL level. The precheck and delete are separate statements (`src/endpoints/workDescriptions/workDescriptions-router.js:95`, `src/endpoints/transactions/transactions-service.js:148`, `migrations/schema-snapshot-2026-09-22.sql:1798`).

Renaming an in-use description is allowed. The row ID on billed entries is unchanged, but views that join the current label show the new name. No saved invoice PDF regeneration, S3 operation, invoice-parent sync, or notification is invoked by these handlers (`src/endpoints/workDescriptions/workDescriptions-router.js:63`, `src/endpoints/transactions/transactions-service.js:7`).

## 8. Invariants, edge cases, and test evidence

| Rule | Source/test evidence, read only |
|---|---|
| Own-account detail/update/delete; missing detail is empty success, missing mutation is HTTP 404 | `test/integration/coverage-jobs-masterdata.integration.spec.js:1292`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1354`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1410`. |
| Explicit inactive value persists and disappears from returned active list | `test/integration/coverage-jobs-masterdata.integration.spec.js:1362`; parser cases in `test/endpoints/job/activeFlagParsing.spec.js:1`. |
| Invalid integer estimate fails; linked transaction prevents delete | `test/integration/coverage-jobs-masterdata.integration.spec.js:1277`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1415`. |
| Manager/admin gate; unauthenticated and foreign-account calls refused | `test/integration/coverage-jobs-masterdata.integration.spec.js:1262`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1311`. |

## 9. Limitations and open decisions

No duplicate-label guard, immutable audit fields, or billed-history rename gate exists in these CRUD handlers. No application limit beyond the database's text/integer types is enforced (`src/endpoints/workDescriptions/workDescriptions-router.js:13`, `src/endpoints/workDescriptions/workDescriptionsObjects.js:16`). Transaction callers do not validate description account ownership before storing its FK; see [F2](../_review/findings.md#f2) in [consolidated findings](../_review/findings.md).

The accounting decisions in `scripts/review-2026-09/FINAL_REPORT.md:45` concern ledger repairs rather than description CRUD. Shared rollout requirements include migration rehearsal/backup, schema-before-backend ordering for 020/021, backend-before-frontend deployment, reviewed tracker ownership backfill with readback/access checks, and `INTERNAL_CUSTOMER_IDS`/`BILLING_TIMEZONE=America/Phoenix` (`scripts/review-2026-09/FINAL_REPORT.md:67`). This documentation does not establish that those rollout steps occurred.

Coverage: **4 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
