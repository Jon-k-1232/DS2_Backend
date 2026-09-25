# Jobs and job families

## Owner decision update — 2026-09-25

Deleting or reassigning a job family containing frozen invoice work, receipts or write-offs (including families with no work) now returns HTTP 409 naming that statement before the generic linked-record refusal. Customer locks and SQL triggers protect concurrent/indirect writes. Ordinary description edits do not regenerate archived statement content. New work on the same family still appends normal job snapshots. [Sent contract](../invoicing/invoices.md).


## 1. Purpose and UI

A job assigns a reusable job type to a customer, with quote/agreed amounts, notes, completion and a stored running total. `/jobs/jobsList` renders `JobsGrid`/`ExpandableGrid`. The add dialog uses `NewJob` and `NewJobSelections`. Row navigation opens `/jobs/jobsList/deleteJob`; the subroute menu also provides `/jobs/jobsList/editJob`, using `DeleteJob` and `EditJob` (`../DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/JobRoutes.js:24`, `../DS2_Frontend/src/Pages/Jobs/JobGrids/JobsGrid.js:15`, `../DS2_Frontend/src/Pages/Jobs/JobGrids/JobsGrid.js:44`, `../DS2_Frontend/src/Routes/GroupedRoutes/JobRoutes/JobSubRoutes.js:35`). Customer-profile jobs appear at `/customers/customersList/customerProfile/:customerId/customerJobs` in `CustomerProfileJobs` (`../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.js:94`).

The form selects an active customer, category and type, and permits quote amount, agreed amount, notes, quote status and completion (`../DS2_Frontend/src/Pages/Jobs/JobForms/AddJob/FormSubComponents/NewJobSelections.js:28`). Review date: 2026-09-24; code and tests were read only.

## 2. Access rules

`/jobs` requires authenticated `manager`, `admin`, `super admin` or `owner`, compared lowercase. Frontend permits the same four roles (`src/app.js:130`, `src/endpoints/auth/jwt-auth.js:94`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`). Auth accepts cookie first, Bearer fallback, validates JWT and loads the subject user; failures produce HTTP 401. Role rejection is HTTP 403 (`src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`).

`enforceAccountId` requires integer URL account equal to the user's account; otherwise HTTP 403. There is no `enforceSelfOrPrivileged` check. URL/body `userID` is ignored for attribution: create stamps the session user and update preserves the stored creator. Account is overwritten with the URL account. Customer ownership is checked while locking the customer ledger, and the selected type must exist in the verified account before any job write (`src/endpoints/job/job-router.js:4`, `src/endpoints/job/job-router.js:61`, `src/endpoints/job/jobObjects.js:12`, `src/endpoints/payments/ledger-helpers.js:62`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common transport errors: HTTP 401/403 above; HTTP 429 for the general 300/minute limiter unless test/disabled; malformed JSON HTTP 400 and over-1-MB JSON HTTP 413. Uncaught errors use `err.status || 500`, production `{message:'Server error'}`, nonproduction `{message,error}` (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`). **E500** means HTTP 200, `{message,status:500}`. Job mutation handlers convert **all** caught errors, including ledger errors with intended 400/404/409 statuses, into E500 (`src/endpoints/job/job-router.js:78`, `src/endpoints/job/job-router.js:191`, `src/endpoints/job/job-router.js:231`).

All path parameters below are required. There are no query parameters for server sorting, filters, pagination or search (`src/endpoints/job/job-router.js:52`, `src/endpoints/job/job-router.js:88`, `src/endpoints/job/job-router.js:108`).

### Create

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/jobs/createJob/:accountID/:userID` | Required `job` object; fields below | HTTP 200 mutation envelope J | Common errors; E500 for missing object, invalid/non-owned customer, duplicate customer+type, FK/type failure, or mutation/refresh failure. `src/endpoints/job/job-router.js:52` |

### Detail

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/jobs/getSingleJob/:customerJobID/:accountID/:userID` | IDs; job ID passed directly to SQL | HTTP 200 `{activeJobData:{activeJobs:[row],grid,treeGrid},message:'Successfully retrieved single job.',status:200}`. Unknown/foreign row ID is empty success | Common errors; uncaught HTTP 500 for malformed SQL ID or read failure. `src/endpoints/job/job-router.js:88` |

### Customer's jobs

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/jobs/getActiveCustomerJobs/:accountID/:userID/:customerID` | IDs; no active/completed filter option | HTTP 200 `{activeCustomerJobData:{activeCustomerJobs:[row],grid,treeGrid},message:'Successfully retrieved active customer jobs.',status:200}`; missing customer/jobs gives empty list | Common errors; uncaught HTTP 500 for SQL/read failure. `src/endpoints/job/job-router.js:108` |

### Update

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/jobs/updateJob/:accountID/:userID` | Required `job`, update ID and fields below | HTTP 200 envelope J; `warning` when reassigned | Common errors; E500 for missing job, invalid/non-owned destination customer, job changed/deleted while waiting for lock, reassignment with transaction/write-off/payment on any family row, invalid DB fields, or write/refresh failure. `src/endpoints/job/job-router.js:134`, `src/endpoints/job/job-router.js:34` |

### Delete family

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/jobs/deleteJob/:jobID/:accountID/:userID` | IDs only; ID can be root or version | HTTP 200 envelope J | Common errors; E500 for missing/changed job or missing customer; any transaction/write-off/payment in family; other FK failure such as quote reference; query failure. `src/endpoints/job/job-router.js:201`, `migrations/schema-snapshot-2026-09-22.sql:2022` |

Envelope **J**: `{accountJobsList:{activeJobData:{activeJobs:[joinedRow],grid,treeGrid}},message:'Successfully created new job.',status:200,warning?}`. The same message is returned after create, update and delete. Successful reassignment adds `Job was reassigned to a different customer. It had no linked transactions, write-offs, or payments.` (`src/endpoints/job/job-router.js:177`, `src/endpoints/job/job-router.js:261`).

| `job` field | Type, requirement, and actual mapping |
|---|---|
| `customerJobID` | Update identity; required number-coerced job ID. |
| `customerID` | Required integer-compatible ID; customer must exist in URL account. No active/billable customer check. |
| `jobTypeID` | Required number-coerced integer, FK to type. Must belong to the verified account; inactive types remain allowed. |
| `userID` | Untrusted; create uses the session user and update preserves the stored creator. |
| `accountID` | Optional/untrusted; overridden with URL account. |
| `parentJobID` | Ignored for family assignment: create forces null; update restores stored parent. |
| `quoteAmount` | `Number(value)` to numeric(10,2); no finite/positive validation. Null/empty becomes zero. |
| `agreedJobAmount`, `currentJobTotal` | Optional `Number(value) \|\| 0`; zero/omitted/NaN becomes zero. Both stored numeric(10,2). Client can set `currentJobTotal` directly in job CRUD. |
| `jobStatus` | Optional `Number(value) \|\| null`, numeric(10,2). Zero becomes null; no enum. |
| `isJobComplete`, `isQuote` | Optional `Boolean(value) \|\| false`; omitted false, string `'false'` true. |
| `note`, `notes` | Optional notes; `note ?? notes ?? null`, with `note` taking precedence even if empty. |

Mapping and limits: `src/endpoints/job/jobObjects.js:1`, `src/endpoints/job/jobObjects.js:18`, `src/endpoints/job/job-router.js:65`, `src/endpoints/job/job-router.js:146`, `migrations/schema-snapshot-2026-09-22.sql:545`. Strings are recursively XSS-filtered; there is no separate field-schema validator (`src/utils/sanitizeFields.js:8`). This PUT maps the supplied form rather than safely patching arbitrary subsets: omitted numeric/boolean fields may reset values (`src/endpoints/job/jobObjects.js:18`).

## 4. Data model

`customer_jobs` stores all mapped columns, `customer_job_id`, nullable `parent_job_id`, and default-now `created_at`. A family is one root plus every row whose parent points directly to that root; it is not a recursive tree. IDs from a version resolve through its stored parent (`src/endpoints/job/job-service.js:77`, `migrations/schema-snapshot-2026-09-22.sql:545`). Account, creator and job type have FKs; the snapshot has no customer or parent-job FK on this table (`migrations/schema-snapshot-2026-09-22.sql:1942`).

Reads join `customer_job_types`, `customer_job_categories`, `customers`, `users`. Guards read `customer_transactions`, `customer_writeoffs`, `customer_payments`. Quotes have a FK back to jobs. Transaction totals are nonnegative on transaction CRUD; payment/write-off signs do not enter the job-total calculation below (`src/endpoints/job/job-service.js:22`, `src/endpoints/job/job-router.js:159`, `src/endpoints/transactions/sharedTransactionFunctions.js:461`, `migrations/schema-snapshot-2026-09-22.sql:2022`). No job note markers are generated by these handlers.

## 5. Read logic

| View/helper | Exact read |
|---|---|
| Account jobs | Select `customer_jobs.*`, explicit type description/category ID/active/estimated time/book rate fields, category label, customer display name as `customer_name`, creator display name as `created_by_user`. INNER JOIN all four related tables on their IDs. Each joined table must share the jobs account. Order by jobs `created_at ASC, customer_job_id ASC`. No active/completion/quote predicate. Includes every version (`src/endpoints/job/job-service.js:22`). |
| Single job | Raw jobs columns by account and exact job ID; no family expansion (`src/endpoints/job/job-service.js:14`). |
| Customer jobs source | `customer_jobs.*` plus type description/category ID and category label from scoped INNER JOIN types/categories; jobs account/customer equality and type/category account equality; jobs `created_at ASC, customer_job_id ASC`. No completion/active filter (`src/endpoints/job/job-service.js:41`). |
| Customer jobs endpoint reduction | Keep the last SQL-ordered row per parent-or-own family ID. Add `display_name = job_description + ' - ' + customer_job_category`. Timestamp ordering retains PostgreSQL precision and ID breaks ties. Profile tree totals use the same selection. Fixed [F23](../_review/findings.md#f23), tested by `review-job-selection.integration.spec.js`. |
| Family IDs | Read selected job by account/ID; root = parent or own ID; select account jobs where own ID=root OR parent=root (`src/endpoints/job/job-service.js:77`). |
| `getRecentJob` | Resolve the owned family and select copyable columns from its latest row, ordered created-at DESC then job ID DESC (`src/endpoints/job/job-service.js:106`). |
| Customer-profile tree | Uses all customer job rows, builds tree, replaces each displayed root total with the child having greatest `customer_job_id`; never sums snapshot totals (`src/endpoints/customer/customer-router.js:165`). |

`createGrid` uses first-row columns and positional IDs. `generateTreeGridData` maps each row by job ID, links direct parents, and promotes a row with missing parent to a root (`src/utils/gridFunctions.js:6`, `src/utils/gridFunctions.js:68`). Account grids do not apply the customer-profile root-total replacement (`src/endpoints/job/job-router.js:265`, `../DS2_Frontend/src/Pages/Jobs/JobGrids/JobsGrid.js:44`).

## 6. Calculations

On transaction creation, amount change, cross-family move or deletion, `updateRecentJobTotal` runs **before** the transaction write. It obtains the family IDs; reads all account transactions referencing any family member; converts each `total_transaction` to Number; sums them and the proposed delta; inserts a new job row with that cumulative total and root parent. It does not filter billability, transaction type, invoice membership, or include payments/write-offs. It does not use agreed or quote amount as a cap. The reducer itself does not round; PostgreSQL stores numeric(10,2) (`src/endpoints/transactions/sharedTransactionFunctions.js:461`, `migrations/schema-snapshot-2026-09-22.sql:553`).

Example: root has a $100 transaction and a version has a $50 non-billable transaction. Adding $25 produces a $175 version total, not $125. Repricing the $100 entry to $80 applies delta −$20, so the family becomes $155. Moving an $80 entry to another family subtracts $80 from the old family and adds $80 to the new family. A move between versions of the same family applies only the amount delta; zero-delta same-family moves create no total snapshot (`src/endpoints/transactions/sharedTransactionFunctions.js:654`, `src/endpoints/transactions/sharedTransactionFunctions.js:704`).

Job CRUD itself accepts a caller's `currentJobTotal` rather than recomputing it; a later amount-changing transaction edit recomputes from transactions. Quote/agreed/status fields are stored inputs, not billing formulas (`src/endpoints/job/jobObjects.js:26`, `src/endpoints/transactions/sharedTransactionFunctions.js:708`).

## 7. Create, edit, and delete

Create sanitizes/maps, fixes account/root parent, starts a knex transaction and locks the owned customer row `FOR NO KEY UPDATE`. It then rejects any existing job with the same account/customer/type, including completed/version rows, and inserts the root. Response refresh is after commit (`src/endpoints/job/job-router.js:57`, `src/endpoints/job/job-service.js:10`, `src/endpoints/payments/ledger-helpers.js:62`).

Update/delete start a transaction, read the account-scoped target, lock current customer and destination customer (when moving) in ascending numeric ID order, then re-read the job. If it disappeared or its customer changed while waiting, refuse. `FOR NO KEY UPDATE` serializes ledger writers while remaining compatible with ingestion FK key-share locks (`src/endpoints/job/job-router.js:34`, `src/endpoints/payments/ledger-helpers.js:46`).

Reassignment checks every family ID for transactions, write-offs and payments. Any record, even non-billable, billed, reversed or zero-value, blocks the move. With no links, all family rows get the destination customer; a warning is returned. Completion changes update the whole family. Other submitted fields update only the named row, preserving its parent. Update does not run the create duplicate check (`src/endpoints/job/job-router.js:157`, `src/endpoints/job/job-router.js:180`, `src/endpoints/job/job-service.js:56`).

Delete checks those same three link sets across the family, then deletes every family row together. A quote FK can refuse at SQL level even though quotes are absent from the prechecks. All work inside these transactions rolls back on failure. There is no billed-history gate on a job's own label/type/amount metadata edit; only linked-history reassignment/deletion is blocked. No invoice sync, S3 operation or notification is invoked (`src/endpoints/job/job-router.js:213`, `src/endpoints/job/job-router.js:185`, `migrations/schema-snapshot-2026-09-22.sql:2022`).

## 8. Invariants, edge cases, and tests

| Rule | Read-only test evidence |
|---|---|
| Duplicate create refused; missing detail empty; missing mutation refused | `test/integration/coverage-jobs-masterdata.integration.spec.js:316`, `test/integration/coverage-jobs-masterdata.integration.spec.js:366`, `test/integration/coverage-jobs-masterdata.integration.spec.js:455`. |
| Family-wide reassignment and completion; linked history blocks reassignment/delete | `test/integration/coverage-jobs-masterdata.integration.spec.js:409`, `test/integration/coverage-jobs-masterdata.integration.spec.js:463`, `test/integration/coverage-jobs-masterdata.integration.spec.js:525`, `test/integration/coverage-jobs-masterdata.integration.spec.js:763`. |
| Racing transaction/reassignment serialized; final-write failure rolls family move back | `test/integration/coverage-jobs-masterdata.integration.spec.js:561`, `test/integration/coverage-jobs-masterdata.integration.spec.js:633`; unit lock-contract assertions in `test/endpoints/job/job-router.spec.js:133`. |
| Family ID resolution, whole-family deletion and transaction-total recomputation | `test/endpoints/job/job-service.spec.js:10`, `test/endpoints/job/job-service.spec.js:36`, `test/endpoints/transactions/sharedTransactionFunctions.spec.js:143`. |
| Same-family version move applies delta once | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:563`. |

## 9. Limitations and open decisions

F2 is fixed by ownership validation, scoped joins and creator preservation (`review-related-ids.integration.spec.js`). [F23](../_review/findings.md#f23) and [F10](../_review/findings.md#f10) in [consolidated findings](../_review/findings.md) record fixed joined-metadata/latest-version selection and fixed stale metadata copying. F10 snapshots preserve the latest family notes, agreed amount, and other copyable metadata; `review-job-family.integration.spec.js` verifies repricing an older-linked entry. The source distinguishes all three from the corrected family-total sum (`src/endpoints/job/job-service.js:41`, `src/endpoints/job/job-service.js:106`, `src/endpoints/transactions/sharedTransactionFunctions.js:478`).

The review report lists 151 families with stale stored totals (net −$485; largest example stored $1,235 versus $960), 5 billable transactions with no job ($365), and 9 cross-customer job links for accountant review. A metadata-only transaction edit does not necessarily recompute totals: the code only calls the recomputation for amount deltas or cross-family moves. The report's “next edit” statement should be read with that qualification (`scripts/review-2026-09/FINAL_REPORT.md:51`, `scripts/review-2026-09/FINAL_REPORT.md:54`, `src/endpoints/transactions/sharedTransactionFunctions.js:704`). These are historical report counts, not a new database measurement.

Owner decisions now provide sent-record locks, narrow bounced-payment corrections and optional signed credit carry-forward. Broader period locking, general void/reissue workflows and persisted billing runs remain separate work. Rollout calls for reviewed migration rehearsal/backup, 020/021 ordering and tracker backfill verification, backend before frontend, and internal-customer/timezone environment settings (`scripts/review-2026-09/FINAL_REPORT.md:59`, `scripts/review-2026-09/FINAL_REPORT.md:67`). No production readiness claim is made here.

Coverage: **5 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F2 verification: `test/integration/review-related-ids.integration.spec.js` covers forged related IDs on create/update, session creators, preserved update attribution, and historical malformed label joins. No historical production-copy rows are repaired by this change.


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.

## Pass 3 response after a committed change

Customer/recurring, job, catalog, quote and user mutations in this guide preserve their successful response payload. If the mutation commits but rebuilding its response lists fails, the API returns HTTP 200 with `status: 200`, `committed: true` and a warning to reload without submitting the change again. Precommit errors retain their existing refusal and rollback behavior. This prevents a saved create, edit or delete from being reported as an unsuccessful write. Regression: `path-matrix-03-commit-outcomes.integration.spec.js`, with exactly one stored mutation checked for each create/update/delete. Drafts stay editable and write nothing to the ledger; finalize is the sent/lock boundary.

The shared create/update/delete response says job changes were saved; it does not describe an update or deletion as creating a new job. A committed refresh failure includes the reload/do-not-resubmit warning in `message` as well as `warnings`, so existing forms display it. The exact saved-row and response assertions are in `path-matrix-03-commit-outcomes`.
