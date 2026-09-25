# Job categories and job types

## 1. Purpose and UI

Categories group job types. Types supply a job description, book rate and estimated straight time. Account lists are `/jobs/jobCategoriesList` and `/jobs/jobTypesList`. Grids use add dialogs, with edit/delete subroutes at `editJobCategory`, `deleteJobCategory`, `editJobType`, and `deleteJobType`. Relevant components are `JobCatagoriesGrid`, `JobTypesGrid`, `NewJobCategory`, `NewJobType`, `EditJobCategory`, `EditJobTypes`, `DeleteJobCategory`, and `DeleteJobTypes` (`../DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/JobRoutes.js:3`, `../DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/JobCategorySubRoutes.js:6`, `../DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/JobTypeSubRoutes.js:6`). The new/edit job form filters the active type list by selected category (`../DS2_Frontend/src/Pages/Jobs/JobForms/AddJob/FormSubComponents/NewJobSelections.js:22`).

Review date: 2026-09-24. Backend paths are relative to DS2_Backend; frontend paths begin `../DS2_Frontend/`. Test assertions were inspected, not executed.

## 2. Access rules

Both mounts require authentication plus `requireManagerOrAdmin`. Accepted role names are `manager`, `admin`, `super admin`, `owner`, compared lowercase. The frontend accepts the first three and omits `owner` (`src/app.js:139`, `src/app.js:141`, `src/endpoints/auth/jwt-auth.js:94`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`). Auth prefers the session cookie over Bearer token, verifies JWT and retrieves a user by subject email; failures are HTTP 401. A role failure is HTTP 403 (`src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`).

Both routers register `enforceAccountId`: URL account must be an integer equal to the session account, or HTTP 403. Neither registers `enforceSelfOrPrivileged`. The `userID` path is not an owner check. Writes replace body account with URL account but trust body creator IDs. Type category IDs are not checked for account ownership (`src/endpoints/jobCategories/jobCategories-router.js:4`, `src/endpoints/jobCategories/jobCategories-router.js:23`, `src/endpoints/jobType/jobType-router.js:4`, `src/endpoints/jobType/jobType-router.js:23`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/jobType/jobTypeObjects.js:7`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common errors: HTTP 401/403 above; HTTP 429 from the 300/minute global limit unless disabled/test mode; HTTP 400 for malformed JSON; HTTP 413 over the 1 MB JSON limit. Uncaught errors use `err.status || 500`, production `{message:'Server error'}`, nonproduction `{message,error}` (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`). **E500** means a caught failure returned as **HTTP 200**, body `{message,status:500}`. Missing nested body objects, invalid DB types/FKs and mutation/refresh errors take that path (`src/endpoints/jobCategories/jobCategories-router.js:28`, `src/endpoints/jobType/jobType-router.js:28`).

All shown path parameters are required. Only `accountID` has the account guard's integer check; other path IDs go directly to SQL. None of these eight endpoints accepts pagination, sorting, search or filter query parameters (`src/endpoints/jobCategories/jobCategories-router.js:13`, `src/endpoints/jobType/jobType-router.js:13`).

### Category create

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/jobCategories/createJobCategory/:accountID/:userID` | Required `jobCategory` object, create fields below | HTTP 200 category list envelope C | Common errors; E500 on missing object, invalid fields/FK or query failure. `src/endpoints/jobCategories/jobCategories-router.js:13` |

### Category update

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/jobCategories/updateJobCategory/:accountID/:userID` | Required `jobCategory` object, update fields below | HTTP 200 envelope C | Common errors; HTTP 404 `{message:'Job category not found.',status:404}` if no own-account row matched; E500 on mapping/SQL/refresh failure. `src/endpoints/jobCategories/jobCategories-router.js:38` |

### Category delete

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID` | IDs only | HTTP 200 envelope C | Common errors; E500 if any own-account job type references the category, or SQL failure; HTTP 404 if zero deleted rows. `src/endpoints/jobCategories/jobCategories-router.js:66` |

### Category detail

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID` | IDs only | HTTP 200 `{activeJobCategoriesData:{activeJobCategory:[row],grid},message:'Successfully retrieved job category.',status:200}`. Missing row is empty success | Common errors; uncaught HTTP 500 on SQL/read failure. `src/endpoints/jobCategories/jobCategories-router.js:90` |

### Type create

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/jobTypes/createJobType/:accountID/:userID` | Required `jobType` object, fields below | HTTP 200 type list envelope T | Common errors; E500 on mapping/SQL/refresh failure. `src/endpoints/jobType/jobType-router.js:13` |

### Type detail

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID` | IDs only | HTTP 200 `{activeJobData:{activeJobs:[row],grid},message:'Successfully retrieved single jobType.',status:200}`. Missing row is empty success | Common errors; uncaught HTTP 500 on SQL/read failure. `src/endpoints/jobType/jobType-router.js:38` |

### Type update

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/jobTypes/updateJobType/:accountID/:userID` | Required `jobType`, including `jobTypeID` | HTTP 200 envelope T | Common errors; HTTP 404 `{message:'Job type not found.',status:404}` if no own-account row matched; E500 on mapping/update failure. The refresh promise is not awaited here, so its rejection is not caught by this handler. `src/endpoints/jobType/jobType-router.js:60` |

### Type delete

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/jobTypes/deleteJobType/:jobTypeID/:accountID/:userID` | IDs only | HTTP 200 envelope T | Common errors; E500 if any own-account job references the type, or delete/precheck fails; HTTP 404 if zero rows deleted. Refresh is not awaited. `src/endpoints/jobType/jobType-router.js:87` |

Envelope **C** is `{jobCategoriesList:{activeJobCategoriesData:{activeJobCategories:[row],grid}},message:'Successfully deleted job category.',status:200}` for **all** category mutations, including creation/update. Envelope **T** is `{jobTypesList:{activeJobTypesData:{jobTypesData:[row],grid}},message:'Successfully deleted jobType.',status:200}` for all type mutations (`src/endpoints/jobCategories/jobCategories-router.js:109`, `src/endpoints/jobType/jobType-router.js:112`). Grid shape is `{columns:[{field,id,headerName}],rows:[{id,...row}]}`, with positional IDs and first-row-derived columns; empty data gives two empty arrays (`src/utils/gridFunctions.js:6`).

| Category body field | Requirement and actual conversion |
|---|---|
| `accountID` | Optional/untrusted; replaced with verified URL account. |
| `category` | Create label; string expected, nullable unbounded varchar in DB, no nonempty or uniqueness validation. |
| `isActive` | Create flag; optional `Boolean(value)`, omitted false, string `'false'` true. |
| `createdBy` | Create creator; required integer-compatible value, `Number(value)`, FK to users. |
| `customerJobCategoryID` | Update identity; required number-coerced ID. |
| `selectedNewJobCategory` | Update label, same DB limits as create. |
| `isJobCategoryActive` | Update flag; `Boolean(value)`, omitted false. |
| `createdByUserID` | Update creator; number-coerced FK, overwrites original creator. |

Category mappings: `src/endpoints/jobCategories/jobCategoriesObjects.js:1`; account overrides: `src/endpoints/jobCategories/jobCategories-router.js:23`, `src/endpoints/jobCategories/jobCategories-router.js:48`; column/FK requirements: `migrations/schema-snapshot-2026-09-22.sql:486`, `migrations/schema-snapshot-2026-09-22.sql:1910`.

| Type body field | Requirement and actual conversion |
|---|---|
| `jobTypeID` | Update only, required number-coerced ID. |
| `accountID` | Optional/untrusted; replaced by URL account. |
| `customerJobCategory` | Category ID converted with `Number`; FK if stored. DB allows null but mapper turns null/empty into 0 and omitted into NaN. Send an existing category ID for an ordinary successful save. |
| `jobDescription` | String; required by DB on create, unbounded varchar, no empty/duplicate check. |
| `bookRate`, `estimatedStraightTime` | Number-coerced, stored as integers. No positive/range check; blank/null becomes 0; omitted becomes NaN and fails integer storage. Decimal values are not rounded by this mapper. |
| `isActive` | Optional; null/undefined defaults true on both create/update. Only boolean true or string `'true'` gives true when supplied. False and `'false'` persist false. |
| `userID` | Required number-coerced creator FK; update also replaces the original creator. |

Type mappings: `src/endpoints/jobType/jobTypeObjects.js:5`; account overrides: `src/endpoints/jobType/jobType-router.js:23`, `src/endpoints/jobType/jobType-router.js:69`; DB requirements: `migrations/schema-snapshot-2026-09-22.sql:514`, `migrations/schema-snapshot-2026-09-22.sql:1926`, `migrations/schema-snapshot-2026-09-22.sql:1934`. Both nested objects pass through the recursive string XSS sanitizer, not a schema validator (`src/utils/sanitizeFields.js:8`).

## 4. Data model

Categories read/write `customer_job_categories`: category ID, account, label, active flag, default-now `created_at`, creator. Types read/write `customer_job_types`: type ID, account, category ID, description, integer book rate/estimate, active flag, default-now creation time, creator. Type-to-category and job-to-type are ordinary single-ID FKs, with no account equality constraint. The delete guards additionally read `customer_jobs` or `customer_job_types` (`migrations/schema-snapshot-2026-09-22.sql:486`, `migrations/schema-snapshot-2026-09-22.sql:514`, `migrations/schema-snapshot-2026-09-22.sql:1934`, `migrations/schema-snapshot-2026-09-22.sql:1958`). There are no note markers or payment sign conventions in these tables.

## 5. Read logic

| Read | Query |
|---|---|
| Active categories | All category columns, account equality, `is_job_category_active=true`; no ordering, grouping or pagination (`src/endpoints/jobCategories/jobCategories-service.js:2`). |
| Category detail | All columns by account and category ID, including inactive rows (`src/endpoints/jobCategories/jobCategories-service.js:6`). |
| Active types | `customer_job_types.*` plus category label through LEFT JOIN on category ID; own type account and `is_job_type_active=true`; `job_description ASC`. No category-active filter or joined-category account predicate (`src/endpoints/jobType/jobType-service.js:18`). |
| Type detail | Raw type row by type ID/account, including inactive rows (`src/endpoints/jobType/jobType-service.js:14`). |
| Category in-use check | Every type of this account with matching category ID, including inactive types (`src/endpoints/jobType/jobType-service.js:10`). |
| Type in-use check | Every job of this account with matching type ID, including completed jobs and version rows (`src/endpoints/job/job-service.js:18`). |

Lists are delivered by initial data and mutation refreshes, not separate list routes here (`src/endpoints/initialData/initialData-router.js:98`).

## 6. Calculations

These endpoints do no billing arithmetic. They convert type rate and estimate with `Number`, storing integers. The frontend labels estimatedStraightTime **Estimated Time In Hours**, but supplies no unit or currency clarification beyond **Book Rate** for bookRate (`../DS2_Frontend/src/Pages/Jobs/JobForms/AddJob/FormSubComponents/NewJobDescriptionSelections.js:30`). Actual manual time pricing uses `selectedTeamMember.billing_rate`, and submitted charge amount is quantity times unit cost, rounded with `toFixed(2)` in the frontend. No CRUD formula multiplies `book_rate` by `estimated_straight_time`; a business rule applying book rate to billing is **not determined from the code** in this path (`src/endpoints/jobType/jobTypeObjects.js:11`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.js:35`, `../DS2_Frontend/src/Services/SharedPostObjects/SharedPostObjects.js:62`).

## 7. Create, edit, and delete

Each create inserts one row; update changes one account-scoped ID in place. No duplicate guard, customer ledger lock, multi-statement transaction or version snapshot exists. Updates preserve DB `created_at` because it is not mapped, but overwrite creator IDs. Active flags change list membership without changing linked records (`src/endpoints/jobCategories/jobCategories-service.js:10`, `src/endpoints/jobCategories/jobCategoriesObjects.js:8`, `src/endpoints/jobType/jobType-service.js:28`, `src/endpoints/jobType/jobTypeObjects.js:17`).

Category delete refuses any matching type; type delete refuses any matching job. The checks and deletes run separately. Database FKs also protect references the application check does not cover, including AI suggestions, producing caught SQL errors (`src/endpoints/jobCategories/jobCategories-router.js:70`, `src/endpoints/jobType/jobType-router.js:91`, `migrations/schema-snapshot-2026-09-22.sql:1806`, `migrations/schema-snapshot-2026-09-22.sql:1822`).

Renaming, changing a type's category or changing its rates remains allowed when jobs have billed entries. Joins show the current labels; these routes do not revise stored transaction amounts or regenerate saved PDFs. No invoice-parent synchronization, S3 operations or notifications are called (`src/endpoints/jobType/jobType-router.js:60`, `src/endpoints/jobCategories/jobCategories-router.js:38`, `src/endpoints/transactions/transactions-service.js:7`).

## 8. Invariants, edge cases, and tests

| Rule | Read-only test evidence |
|---|---|
| Category CRUD, account guards, DB-invalid creator refusal, zero-match 404 and inactive filtering | `test/integration/coverage-jobs-masterdata.integration.spec.js:832`, `test/integration/coverage-jobs-masterdata.integration.spec.js:909`, `test/integration/coverage-jobs-masterdata.integration.spec.js:917`. |
| Category referenced by a type cannot be deleted | `test/integration/coverage-jobs-masterdata.integration.spec.js:975`. |
| Type CRUD, detail empty result and inactive removal | `test/integration/coverage-jobs-masterdata.integration.spec.js:1032`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1079`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1173`. |
| Type referenced by a job cannot be deleted | `test/integration/coverage-jobs-masterdata.integration.spec.js:1223`. |
| Explicit boolean/string false parsing for type and description active flags | `test/endpoints/job/activeFlagParsing.spec.js:1`. |

The old defect comment preceding the type-inactive assertion describes a missing filter; the current service contains that filter and the assertion requires removal. Use the implementation and assertion, not that historical comment (`src/endpoints/jobType/jobType-service.js:24`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1161`).

## 9. Limitations and open decisions

Related IDs and creator IDs can reference another account's rows; account checks protect the row being written, not every FK. The type list can then reveal the foreign category label. See [F2](../_review/findings.md#f2) in [consolidated findings](../_review/findings.md). Boolean parsing is inconsistent between categories (`Boolean`) and types (explicit true parser), so clients should send actual booleans (`src/endpoints/jobCategories/jobCategoriesObjects.js:4`, `src/endpoints/jobType/jobTypeObjects.js:5`). The unawaited type refresh can fail after a successful write without completing the response; see [F26](../_review/findings.md#f26) in the findings file (`src/endpoints/jobType/jobType-router.js:76`, `src/endpoints/jobType/jobType-router.js:100`).

The accountant decisions are ledger repairs, including historical cross-customer jobs and stale job-family totals, rather than type/category rate policies (`scripts/review-2026-09/FINAL_REPORT.md:45`). Production migration rehearsal, backup, 020/021 ordering, backend-first deployment and environment settings remain rollout requirements, not evidence of current deployment (`scripts/review-2026-09/FINAL_REPORT.md:67`).

Coverage: **8 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
