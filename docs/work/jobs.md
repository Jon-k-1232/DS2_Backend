# Jobs and job families

**H6 navigation:** Time & Work → Client jobs: `/work/jobs`; record edit/delete URLs include the job ID. [Route/permission and bookmark rules](../platform/workspace-navigation.md).

## Owner decision update — 2026-09-25

Deleting or reassigning a job family containing frozen invoice work, receipts or write-offs (including families with no work) now returns HTTP 409 naming that statement before the generic linked-record refusal. Customer locks and SQL triggers protect concurrent/indirect writes. Ordinary description edits do not regenerate archived statement content. New work on the same family still appends normal job snapshots. [Sent contract](../invoicing/invoices.md).


## 1. Purpose and UI

A job assigns a reusable job type to a customer, with quote/agreed amounts, notes, completion and a stored running total. `/work/jobs` uses `JobsGrid` and the server-paged `PagedRegister`; search, business filter and sorting are server-side. Add uses `NewJob` and `NewJobSelections`. Edit/delete load the selected ID at `/work/jobs/:recordId/:action` through `RecordPage`. Customer-profile job trees remain scoped to the selected client. Legacy bookmarks redirect through the workspace navigation rules above.

The form selects a customer, category and type, and permits quote amount, agreed amount, notes, quote status and completion. Customer choices use the compact directory through 1,000 active clients and server type-ahead above that threshold. Job lookup, dependency previews, empty/error states, mutations and historical record hydration are covered by H9 Jest and browser regression.

## 2. Access rules

`/jobs` requires authenticated `manager`, `admin`, `super admin` or `owner`, compared lowercase. Frontend permits the same four roles (`src/app.js:130`, `src/endpoints/auth/jwt-auth.js:94`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`). Auth accepts cookie first, Bearer fallback, validates JWT and loads the subject user; failures produce HTTP 401. Role rejection is HTTP 403 (`src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`).

`enforceAccountId` requires integer URL account equal to the user's account; otherwise HTTP 403. There is no `enforceSelfOrPrivileged` check. URL/body `userID` is ignored for attribution: create stamps the session user and update preserves the stored creator. Account is overwritten with the URL account. Customer ownership is checked while locking the customer ledger, and the selected type must exist in the verified account before any job write (`src/endpoints/job/job-router.js:4`, `src/endpoints/job/job-router.js:61`, `src/endpoints/job/jobObjects.js:12`, `src/endpoints/payments/ledger-helpers.js:62`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common transport errors: HTTP 401/403 above; HTTP 429 for the general 300/minute limiter unless test/disabled; malformed JSON HTTP 400 and over-1-MB JSON HTTP 413. Uncaught errors use `err.status || 500`, production `{message:'Server error'}`, nonproduction `{message,error}` (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`). **E500** means HTTP 200, `{message,status:500}`. Job mutation handlers convert **all** caught errors, including ledger errors with intended 400/404/409 statuses, into E500 (`src/endpoints/job/job-router.js:78`, `src/endpoints/job/job-router.js:191`, `src/endpoints/job/job-router.js:231`).

All path parameters below are required. The register and client lookup support bounded paging, search, sorting and business filters, described in [H9 bounded job reads](#h9-bounded-job-reads). Mutation fields remain unchanged.

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
| GET | `/jobs/getActiveCustomerJobs/:accountID/:userID/:customerID` | IDs plus bounded lookup parameters; optional `currentCycle=true` | HTTP 200 `{status:200,activeCustomerJobData:{activeCustomerJobs,pagination}}`; owned client with no matches returns empty rows | HTTP 400 invalid input, 404 missing/foreign client, 500 read failure; auth/business guards also apply. |
| GET | `/jobs/getJobs/:accountID/:userID` | Bounded lookup parameters; no current-cycle mode | HTTP 200 `{status:200,accountJobsList:{activeJobData:{activeJobs,pagination,partial:true}}}` | HTTP 400 invalid input, 500 read failure; auth/business guards also apply. |

### Update

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/jobs/updateJob/:accountID/:userID` | Required `job`, update ID and fields below | HTTP 200 envelope J; `warning` when reassigned | Common errors; E500 for missing job, invalid/non-owned destination customer, job changed/deleted while waiting for lock, reassignment with transaction/write-off/payment on any family row, invalid DB fields, or write/refresh failure. `src/endpoints/job/job-router.js:134`, `src/endpoints/job/job-router.js:34` |

### Delete family

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/jobs/deleteJob/:jobID/:accountID/:userID` | IDs only; ID can be root or version | HTTP 200 envelope J | Common errors; E500 for missing/changed job or missing customer; any transaction/write-off/payment in family; other FK failure such as quote reference; query failure. `src/endpoints/job/job-router.js:201`, `migrations/schema-snapshot-2026-09-22.sql:2022` |

Envelope **J**: `{accountJobsList:{activeJobData:{activeJobs,pagination,partial:true}},changed:{jobs?,deletedJobs?},committed:true,message,status:200,warning?}`. Refresh is first20 current job families only; no grid/tree copies. Changed identities are independent of the page. Successful reassignment retains its explicit warning. A failed postcommit refresh returns the existing saved/reload/do-not-resubmit envelope.

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
| Account jobs | H9 `getJobsPage` scopes account/business, ranks family versions by created_at DESC then ID DESC, and keeps rank1 before search/sort/paging. Joins owned types/categories/customers; no implicit active/completion/quote filter. Limit<=100. |
| Single job | Exact account/ID row with whole-family linked transaction/write-off/payment counts and at most100 preview rows of each kind. |
| Customer jobs source | `customer_jobs.*` plus type description/category ID and category label from scoped INNER JOIN types/categories; jobs account/customer equality and type/category account equality; jobs `created_at ASC, customer_job_id ASC`. No completion/active filter (`src/endpoints/job/job-service.js:41`). |
| Customer jobs endpoint reduction | H9 ranks latest versions in SQL, then searches, sorts and pages the selected client/business. It never transfers all historical versions merely to reduce them in JavaScript. Display label remains description + category. |
| Family IDs | Read selected job by account/ID; root = parent or own ID; select account jobs where own ID=root OR parent=root (`src/endpoints/job/job-service.js:77`). |
| `getRecentJob` | Resolve the owned family and select copyable columns from its latest row, ordered created-at DESC then job ID DESC (`src/endpoints/job/job-service.js:106`). |
| Customer-profile tree | Uses all customer job rows, builds tree, replaces each displayed root total with the child having greatest `customer_job_id`; never sums snapshot totals (`src/endpoints/customer/customer-router.js:165`). |

Register rows use stable job IDs and latest family snapshots. The browser derives grid views on access; bootstrap and save responses contain no duplicate grid/tree rows. Single-record and per-client profile readers retain their legacy presentation shape; the profile links direct family children and promotes rows with a missing parent. The profile root-total replacement remains separate from account-register paging.

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

## H1 business scope (2026-09-26)

New-job UI chooses a billing business. Existing shared jobs can serve explicitly selected work in any business; a business-specific job can serve only its own business. Filtered trees retain shared roots and matching children. Changing a form’s business clears an incompatible job. Reassigning a work entry’s business does not independently move or recompute job-family totals.

[Business entity contracts and rules](../platform/billing-entities.md) and [H1 results](../decisions/2026-09-26-run-H1-results.md) supersede earlier account-wide scope descriptions.

## H4 recurring jobs

A recurring plan may select an open same-client/business job or use a description-only fee. Shared jobs remain supported. Generation refuses a missing, closed or wrong-business job, and maintains the existing job-family total when generating or editing a charge. Plan changes affect ungenerated periods only; [recurring billing](recurring-billing.md) owns those contracts.

## H9 bounded job reads

`GET /jobs/getJobs/:accountID/:userID` is the account register. `GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID` now shares the bounded query for client choices. Both require the existing manager/admin gate and account ownership; `entityId` passes through effective-business scope. Inputs: `page` positive integer (default1, max1,000,000), `limit`1–100 (default20), `search` string <=200 characters, `direction=asc|desc`, `sort` one of customer_job_id/customer_name/job_description/created_at/current_job_total/is_job_complete. Optional positive `jobTypeId`/`categoryId` narrow dependency previews. Default order is ID ascending for read endpoints; mutation first-page refresh orders descending.

Each returns `status:200` and rows plus `{page,limit,totalItems,totalPages}`: account reads use `accountJobsList.activeJobData.{activeJobs,pagination,partial:true}`; client reads use `activeCustomerJobData.{activeCustomerJobs,pagination}`. Only latest family versions are included. Search matches description, category, client name, job notes or exact job ID. Invalid query returns400; malformed client400; missing/foreign client404; auth401/403; database failure500 with a safe retry message. Empty searches/high pages succeed with an empty bounded list and correct total. No duplicate grid/tree data is sent.

Create/edit/delete return a changed job (or deleted ID) and the first20 account jobs, via the [H9 save contract](../platform/performance.md#mutation-responses). Single-job reads hydrate the selected historical version’s description, category and book rate, and include `dependencies` for the complete family: counts and up to100 each of transactions/writeoffs/payments. The delete screen blocks any linked family and explains payment-only links. Client-profile trees remain client-scoped. Catalog deletion queries by type/category instead of relying on bootstrap jobs. Current owned endpoint count: **6**. Proof: `path-matrix-H9-loading`, existing family/ledger suites and browser jobs/edit/delete tests.

### Scoped entry-form reads (H9)

The write-off job picker adds `currentCycle=true` to the existing per-client endpoint. It searches/pages exact referenced job versions and preserves the former amount rule: sum only billable work without an invoice or retainer, grouped by exact job ID. Zero-valued historical groups remain selectable; IDs disambiguate identical descriptions. Lifetime `current_job_total` is never substituted for this amount. Client/business changes invalidate old choices and clear the visible job text and server search, even when switching away and back. Recurring-plan and inline billing-review job searches use the same scope reset. The current-cycle aggregate uses account-qualified unique-key joins with the exact `ds2_effective_entity` precedence: explicit entity, amended legacy billing scope, original attribution, then reviewed resolution. Read-only legacy equivalence tests compare both the rows and amounts with the existing scoped view.

Legacy payment and write-off invoice selectors request `GET /customer/activeCustomers/customerByID/A/U/C?section=invoices&entityId=E`. This projection returns only that client's invoice snapshots in `customerInvoiceData`, preserving current-chain/absorption selection rules without downloading jobs, work, payments or retainers. It rejects malformed sections and missing/foreign clients, retains existing role/business guards, and performs no writes. Full client-profile/history views remain unchanged. Late responses cannot reset an invoice/job or overwrite the new client's choices.


## H8 review presentation

Job deletion review shows the creator name from the scoped detail response, including inactive staff, and names the service instead of labeling it a type ID. Dependency instructions say to move the linked records to the correct job. Read-only labels never change job records, dependencies, deletion guards or audit evidence.
