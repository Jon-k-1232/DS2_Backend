# Quotes

## 1. Purpose and UI

Quotes store a proposed amount against a customer and job. `/invoices/quotes` renders `QuotesGrid`, which fetches the quote list once initial customer data is present, then displays a `DataGridTable`. The create-quote route in the frontend is commented out. Create/update/delete backend APIs exist, but corresponding live quote forms were **not determined from the code** reviewed (`../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:25`, `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:36`, `../DS2_Frontend/src/Pages/Invoices/InvoiceGrids/QuotesGrid.js:32`).

The list API's second path parameter is named `quoteID`; the frontend passes `userID` because the backend ignores that parameter (`../DS2_Frontend/src/Services/ApiCalls/FetchCalls.js:337`, `src/endpoints/quotes/quotes-router.js:51`). These `customer_quotes` rows are separate from a job's `is_quote` and `job_quote_amount` fields (`src/endpoints/quotes/quotesObjects.js:1`, `src/endpoints/job/jobObjects.js:6`). Review date: 2026-09-24; source and test assertions were read, not run.

## 2. Access rules

The `/quotes` mount requires authentication and `requireManagerOrAdmin`: `manager`, `admin`, `super admin`, `owner`, case-insensitive (`src/app.js:142`, `src/endpoints/auth/jwt-auth.js:94`). Cookie token precedes Bearer header; user identity is retrieved by JWT subject email. Missing, expired, invalid token or absent user returns HTTP 401; disallowed role returns HTTP 403 (`src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`).

GET/DELETE use `enforceAccountId` on the URL account: integer conversion and exact account match or HTTP 403. POST/PUT have no account path; they overwrite body `account_id` with `req.user.account_id`. Both writes require owned customer/job rows and matching customer/job association. Create stamps the session creator; update preserves the original creator (`src/endpoints/quotes/quotes-router.js:4`, `src/endpoints/quotes/quotes-router.js:20`, `src/endpoints/quotes/quotes-router.js:90`, `src/endpoints/quotes/quotesObjects.js:1`). Frontend manager route gate includes `owner`, matching the backend (`../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common errors apply to every endpoint: HTTP 401/403 above; HTTP 429 for the general 300/minute limiter unless disabled/test mode. JSON parsing adds HTTP 400 for malformed JSON and 413 above 1 MB. Uncaught errors use `err.status || 500` (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`). **E500** below means HTTP 200 with `{message,status:500}`, including sanitizer, mapper, database, or refreshed-list errors; each quote handler catches its errors (`src/endpoints/quotes/quotes-router.js:41`).

### Create

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/quotes/createQuote` | Required `quote` object; fields below | HTTP 200 `{quote:{quotesData:[row],grid},message:'Successfully created new quote.',status:200}` | Common errors; E500 for absent nested object, invalid integer/numeric values, required-column/FK failure, or query failure. `src/endpoints/quotes/quotes-router.js:12` |

### List

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/quotes/getActiveQuotes/:accountID/:quoteID` | Required account; required but ignored `quoteID`. No query parameters | HTTP 200 `{activeQuoteData:{activeQuotes:[row],grid},message:'Successfully retrieved all active quotes.',status:200}`; empty list is success | Common errors; E500 on query failure. `src/endpoints/quotes/quotes-router.js:51` |

### Update

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/quotes/updateQuote` | Required `quote`, including `customer_quote_id` and write fields | HTTP 200 `{quote:{quotesData:[row],grid},message:'Successfully updated quote.',status:200}` | Common errors; HTTP 404 `{message:'Quote not found.',status:404}` for zero matched rows; E500 for invalid data or query failure. `src/endpoints/quotes/quotes-router.js:82` |

### Delete

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/quotes/deleteQuote/:accountID/:quoteID` | Required path IDs, no body | HTTP 200 `{quote:{quotesData:[row],grid},message:'Successfully deleted quote.',status:200}` | Common errors; HTTP 404 for zero deleted rows; E500 for malformed SQL ID or query failure. `src/endpoints/quotes/quotes-router.js:124` |

| Quote body field | Type, required/default, validation |
|---|---|
| `customer_quote_id` | Update-only identity; number-coerced integer. No separate positive-ID check (`src/endpoints/quotes/quotesObjects.js:12`). |
| `account_id` | Optional/untrusted; overwritten with session account (`src/endpoints/quotes/quotes-router.js:20`). |
| `customer_id` | Number/string converted to integer; required and resolved in the session account before any write (no database customer FK) (`src/endpoints/quotes/quotesObjects.js:3`, `migrations/schema-snapshot-2026-09-22.sql:664`, `migrations/schema-snapshot-2026-09-22.sql:2006`). |
| `customer_job_id` | DB allows null, but mapper always applies `Number`: omitted becomes NaN and null/empty becomes zero. Ordinary successful requests need an existing job ID; the route validates job account and customer correspondence (`src/endpoints/quotes/quotesObjects.js:4`, `migrations/schema-snapshot-2026-09-22.sql:2022`). |
| `amount_quoted` | Required number-coercible value; numeric(10,2), no finite/positive/minimum check. Null/empty becomes zero; negative amounts are not normalized (`src/endpoints/quotes/quotesObjects.js:5`, `migrations/schema-snapshot-2026-09-22.sql:666`). |
| `is_quote_active` | Optional; `Boolean(value)`, default false when omitted. String `'false'` is true (`src/endpoints/quotes/quotesObjects.js:6`). |
| `created_by_user_id` | Untrusted and ignored for attribution; create uses the session user and update preserves the stored creator (`src/endpoints/quotes/quotesObjects.js:7`, `src/endpoints/quotes/quotesObjects.js:18`, `migrations/schema-snapshot-2026-09-22.sql:2014`). |
| `notes` | Optional text; strings sanitized using XSS filter; no explicit size cap apart from request body (`src/endpoints/quotes/quotesObjects.js:8`, `src/endpoints/quotes/quotes-router.js:15`, `src/utils/sanitizeFields.js:8`). |

## 4. Data model

Only `customer_quotes` is read/written by this service: identity, account, customer, job, amount, active flag, created timestamp, creator and notes. `created_at` defaults to now and is not mapped during updates. Account, creator and job have FKs; there is no customer FK in the supplied schema. No sign normalization, stored note markers, version rows, quote-to-invoice relationship, or acceptance state is implemented (`migrations/schema-snapshot-2026-09-22.sql:661`, `migrations/schema-snapshot-2026-09-22.sql:2006`, `src/endpoints/quotes/quotes-service.js:1`, `src/endpoints/quotes/quotesObjects.js:11`).

## 5. Read logic

Despite its name, `getActiveQuotes` selects **every** `customer_quotes` row for the account, including `is_quote_active=false`. No join, active predicate, grouping, `ORDER BY`, pagination, text search or selectable sorting exists. List and post-mutation refresh use the same query (`src/endpoints/quotes/quotes-service.js:2`). Grid keys derive from the first record; empty data produces `{columns:[],rows:[]}` (`src/utils/gridFunctions.js:6`). There is no single-quote API; `quoteID` on GET does not narrow the result (`src/endpoints/quotes/quotes-router.js:54`).

## 6. Calculations

The amount is `Number(amount_quoted)` stored to numeric(10,2). The API does not derive it from hours, employee rate, type `book_rate`, a job quote, tax, discount, retainer or recurring amount. Quote-to-job or quote-to-invoice conversion is **not determined from the code**; none is invoked by these handlers (`src/endpoints/quotes/quotesObjects.js:5`, `src/endpoints/quotes/quotes-router.js:12`, `src/endpoints/quotes/quotes-router.js:82`).

## 7. Create, edit, and delete

Create inserts one row and returns the account list. Update rewrites mapped fields in place by `customer_quote_id` and account. The job must belong to the selected customer and account. There is no billed-history guard. Delete hard-deletes by quote ID/account, then refreshes the list. No explicit transaction surrounds mutation and refresh; no customer ledger lock, parent invoice sync, snapshot, S3/PDF generation or notification is invoked (`src/endpoints/quotes/quotes-service.js:6`, `src/endpoints/quotes/quotes-service.js:14`, `src/endpoints/quotes/quotes-service.js:24`).

## 8. Invariants, edge cases, and tests

`test/integration/coverage-jobs-masterdata.integration.spec.js:1442` covers create, missing payload and employee rejection. Its body-account spoof tests assert create/update remain in the session account (`test/integration/coverage-jobs-masterdata.integration.spec.js:1460`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1532`). List account guards, update/delete HTTP 404, and a self-contained quote lifecycle are covered at `test/integration/coverage-jobs-masterdata.integration.spec.js:1487`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1544`, `test/integration/coverage-jobs-masterdata.integration.spec.js:1565`, and `test/integration/coverage-jobs-masterdata.integration.spec.js:1599`. `review-related-ids.integration.spec.js` additionally verifies customer/job ownership, correspondence and immutable creator attribution.

## 9. Limitations and open decisions

The UI is a list and the API stores quote data; delivery, acceptance, expiry, conversion and automatic billing are **not determined from the code**. Inactive rows remain visible. New and edited customer/job associations are validated; fixed [F2](../_review/findings.md#f2) of [consolidated findings](../_review/findings.md) (`src/endpoints/quotes/quotesObjects.js:1`, `src/endpoints/quotes/quotes-service.js:2`).

The report's accountant items concern existing ledger repairs, including duplicate statements, double credits, sign exceptions and cross-customer jobs; they do not define a quote approval workflow (`scripts/review-2026-09/FINAL_REPORT.md:45`). The report requires reviewed migration/backup/cutover steps and backend-before-frontend rollout; current deployment state is **not determined from the code** (`scripts/review-2026-09/FINAL_REPORT.md:67`).

Coverage: **4 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F2 verification: `test/integration/review-related-ids.integration.spec.js` covers forged related IDs on create/update, session creators, preserved update attribution, and historical malformed label joins. No historical production-copy rows are repaired by this change.


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.

## Pass 3 response after a committed change

Customer/recurring, job, catalog, quote and user mutations in this guide preserve their successful response payload. If the mutation commits but rebuilding its response lists fails, the API returns HTTP 200 with `status: 200`, `committed: true` and a warning to reload without submitting the change again. Precommit errors retain their existing refusal and rollback behavior. This prevents a saved create, edit or delete from being reported as an unsuccessful write. Regression: `path-matrix-03-commit-outcomes.integration.spec.js`, with exactly one stored mutation checked for each create/update/delete. Drafts stay editable and write nothing to the ledger; finalize is the sent/lock boundary.
