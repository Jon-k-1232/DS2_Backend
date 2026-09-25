# Accounts receivable

## 1. Purpose and UI

Accounts Receivable shows current issued-statement balances, statement-age buckets and an estimated oldest unpaid charge date. It excludes unbilled work from AR dollars. Route `/invoices/accountsReceivable` renders `../DS2_Frontend/src/Pages/AccountsReceivable/AccountsReceivablePage.js:81`. It has customer search, age filters, sort, pagination and CSV export. Displayed page totals sum only the loaded page. Sources: `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:35`, `../DS2_Frontend/src/Pages/AccountsReceivable/AccountsReceivablePage.js:102`, `../DS2_Frontend/src/Pages/AccountsReceivable/AccountsReceivablePage.js:171`.

## 2. Access rules

Authentication and backend manager/admin/super admin/owner are required. accountID must be an integer matching session account_id through enforceAccountId. No self-or-privileged userID check is registered; the report is account-wide. Frontend manager gating omits owner ([F37](../_review/findings.md#f37)). Sources: `src/app.js:169`, `src/endpoints/accountsReceivable/accounts-receivable-router.js:5`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.

## 3. API reference

Unexpected database failure in the role middleware can return HTTP 500 through the global handler. Source: `src/endpoints/auth/jwt-auth.js:77`, `src/app.js:178`.

### GET /accountsReceivable/aging/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountsReceivable/aging/:accountID/:userID` |
| Path | Required accountID/userID; account scoped, userID not used as a row filter. |
| Pagination | Optional page=1, limit=50; parseInt values, reject NaN/<1, cap limit at 500. offset=(page-1)×limit. Numeric prefixes/fractions are accepted by parseInt. |
| Filters/sort | Optional search, filter, sort, direction; rules below. |
| Success | HTTP 200 {arAging:{customers,pagination,searchTerm},message,status:200}. pagination={page,limit,totalItems,totalPages}. |
| Errors | HTTP 401 missing/invalid/expired/unresolvable login; 403 role/account mismatch; 429 general API limit; 400 Invalid pagination; 500 other query failures. Errors carry message/status except middleware-specific envelopes. |
| Evidence | `src/endpoints/accountsReceivable/accounts-receivable-router.js:73`, `src/utils/pagination.js:4`, `src/app.js:100`. |

### GET /accountsReceivable/aging/:accountID/:userID/export

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountsReceivable/aging/:accountID/:userID/export` |
| Inputs | Same search/filter/sort/direction. page and limit are not used. |
| Limit | First 10,000 matched rows at offset 0; not truly unbounded despite the full-dataset comment. |
| Success | HTTP 200 text/csv attachment accounts_receivable_YYYYMMDD_HHmmss.csv. Server-local timestamp names the file. |
| Errors | HTTP 401/403/429 as above; HTTP 500 query/CSV errors with message/status. No pagination 400 since request pagination is ignored. |
| Evidence | `src/endpoints/accountsReceivable/accounts-receivable-router.js:121`. |

| Query field | Rules |
|---|---|
| search | Optional string, trimmed in service; nonstring becomes ''. Matches LOWER business_name/customer_name/display_name LIKE %term%, or exact customer ID text. %/_ act as wildcards. |
| filter | '30' means statement age <=30; '60' means 31..60; '90' means 61..90; 'over_90' means >90. Invalid value means no age filter. |
| sort | business_name, customer_name, display_name, bucket_0_30, bucket_31_60, bucket_61_90, bucket_over_90, total_outstanding, last_payment_date, has_work_since_last_payment, oldest_days, statement_date, oldest_open_charge_date, is_customer_active. Invalid means default order. |
| direction | Case-insensitive 'asc', else desc. Default order ignores this and uses oldest_days DESC, total_outstanding DESC, customer_id ASC. Custom orders tie-break by customer_id ASC; configured nullable fields use NULLS LAST. |
| Other filters | No active-only switch and no public exclude-ID parameter. The service accepts exclusions internally for the analytics year-end packet. |
| Evidence | `src/endpoints/accountsReceivable/accounts-receivable-router.js:12`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:48`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:133`. |

Customer response fields: customer_id, display_name, business_name, customer_name, is_commercial_customer, is_customer_active, total_outstanding, four bucket amounts, oldest_days, most_recent_invoice_date, statement_date, statement_count, oldest_open_charge_date/days, last_payment_date/amount and has_work_since_last_payment. Money/count output fields are explicitly Number-converted; missing last payment remains null. Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:203`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:266`.

## 4. Data model

| Table | Columns read |
|---|---|
| customer_invoices | account/customer IDs, invoice ID/parent, invoice_date, created_at, remaining_balance_on_invoice. Paid flag, due_date and original charges do not decide AR bucket totals. |
| customers | Account and names, active/commercial flags. Inactive customers with positive AR remain included. |
| customer_transactions | Account/customer, ID/date, billable flag, invoice link, positive total_transaction for oldest-open-charge estimate; billable flag/date for work-since-payment. |
| customer_payments | Account/customer, payment_date, payment_id, signed payment_amount; latest amount displayed as ABS. |
| Evidence | `src/endpoints/accountsReceivable/accounts-receivable-service.js:80`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:167`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:194`. |

No write-off or retainer table is read directly. Their effect reaches AR only through stored invoice balances. No data or notes markers are written by these routes. Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:80`.

## 5. Read logic

1. current_chains selects account-owned **NULL-parent** invoices. Compute MAX(invoice_date) over customer; keep every parent on that latest date.
2. For each root, LATERAL-select its account-owned newest child by created_at DESC, invoice ID DESC; use child remaining if present, otherwise parent remaining.
3. Group customer/date. Sum GREATEST(remaining,0), count all those roots and keep only positive summed AR.
4. Compute statement age/buckets. Join account-owned customers, estimated oldest open charge and latest payment; apply search/age filters.
5. Sort and limit/offset. A separate count query repeats balance/customer/filter logic. Data and count run concurrently without a shared snapshot.

Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:80`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:233`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:243`.

This intentionally drops earlier rolled-forward parent dates even when old rows retain stale balances. Same-date duplicate roots are added together. Negative chain balances are clipped to zero, not used to offset a positive chain. Self-parent legacy invoice rows are not roots here, although the billing marker helper recognizes them. Sources: `src/endpoints/accountsReceivable/accounts-receivable-service.js:94`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:111`, `src/endpoints/invoice/invoice-service.js:183`.

Latest payment uses DISTINCT ON customer and payment_date DESC, payment_id DESC. It does not exclude unlinked payments, retainer draws or positive NSF/reversal rows. Therefore “last payment” means the most recent payment-table event, not necessarily the last receipt of cash. Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:194`.

Work since payment is EXISTS any account/customer billable transaction strictly after that payment_date, with no invoice-link or positive-amount requirement. If there is no payment, any billable transaction qualifies. Same-day work does not qualify as after. Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:225`.

## 6. Calculations

### Statement age

days_old = EXTRACT(DAY FROM (NOW() - statement_date))::int using the database clock/timezone. Entire customer AR goes into exactly one bucket:

| Age | Bucket |
|---|---|
| <=30, including negative/future statement ages | bucket_0_30 |
| 31..60 inclusive | bucket_31_60 |
| 61..90 inclusive | bucket_61_90 |
| >90 | bucket_over_90 |

This ages from statement date, not due date or original service date. oldest_days is that same latest-statement age. Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:108`.

Example: a 100-day-old $400 balance rolled onto a statement 10 days ago is $400 in 0–30, even if its unpaid underlying charge remains 100 days old. Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:106`.

### Oldest open charge

Read **billed, billable, positive** transactions. For each customer, order transaction_date DESC, transaction_id DESC; calculate the total of strictly newer charges. A charge remains within the unpaid tail when newer_charge_sum < current total_outstanding. Take MIN(transaction_date) over qualifying rows. This models credits paying oldest charges first, without actually allocating individual payments/write-offs. Source: `src/endpoints/accountsReceivable/accounts-receivable-service.js:167`.

Example: billed charges Jan $100, Feb $200, Mar $300; outstanding $350. March qualifies (newer=0), February qualifies (newer=$300), January does not (newer=$500). Oldest open date is February; $50 of its charge is notionally unpaid. At outstanding $300, February no longer qualifies because 300 < 300 is false. The oldest date is March.

If stored positive billed charges total less than AR, the oldest available charge is only a lower-bound estimate. No billed charge history gives null. oldest_open_charge_days uses database NOW()-that date, independent of statement buckets. Sources: `src/endpoints/accountsReceivable/accounts-receivable-service.js:167`, `src/endpoints/accountsReceivable/accounts-receivable-service.js:219`.

### CSV

CSV exports ID, three names, four buckets, total owed, most recent invoice date/days, last payment date/absolute amount, work-since flag, oldest open charge date/days and active flag. Currency is fixed to two decimals; dates are YYYY-MM-DD; booleans Yes/No. It does not add a totals row. Quoting doubles quotes and protects formula-leading text; valid signed numeric strings remain numeric. Sources: `src/endpoints/accountsReceivable/accounts-receivable-router.js:43`, `src/endpoints/analytics/csv-util.js:25`.

## 7. Create, edit and delete

Both routes are read-only and generate CSV in memory. No database transaction writes, audit record, S3 object or notification is created. Payments/write-offs/billing/cascade edits change stored invoice balances elsewhere, and the next read reflects them. Source: `src/endpoints/accountsReceivable/accounts-receivable-router.js:73`.

## 8. Invariants and tests

| Existing spec | Assertions |
|---|---|
| test/integration/analytics.integration.spec.js | Latest-date/same-day chain sums, inactive customers, FIFO date estimate, exclusions and AR/engine/audit comparisons. |
| test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js | HTTP access/scope, invalid pagination, search, row fields, CSV formula escaping. |
| test/integration/cascade-edit-recompute.integration.spec.js | AR follows billed financial deltas alongside engine/audit. |
| test/endpoints/analytics/csv-util.spec.js | Shared CSV safety and formatting. |

Tests were read, not executed. The oldest-charge calculation is an estimate, not a stored payment-allocation ledger.

## 9. Known limitations and open decisions

FINAL_REPORT explicitly separates statement aging from FIFO oldest-open-charge estimates and leaves true charge aging as a product/accountant decision. Duplicate statements and old mirror errors still require reviewed remediation. Credit balances cannot reduce another chain in this report. Sources: `scripts/review-2026-09/FINAL_REPORT.md:47`, `scripts/review-2026-09/FINAL_REPORT.md:50`, `scripts/review-2026-09/FINAL_REPORT.md:56`, `scripts/review-2026-09/FINAL_REPORT.md:61`.

The report's migration/cutover and environment settings are rollout requirements. Whether they have been applied to production is **not determined from the code**. Source: `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **2 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
