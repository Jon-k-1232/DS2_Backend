# Invoice list, detail and deletion

## 1. Purpose and UI

The invoice register lists issued parent statements and balance snapshots. UI route `/invoices/invoices` renders `../DS2_Frontend/src/Pages/Invoices/InvoiceGrids/InvoicesGrid.js`. Nested `/invoices/invoices/invoiceDetail/*` renders InvoiceSubRoutes with Transactions, Payments, Write-offs, Outstanding Invoices and Retainers tabs. The selected invoice comes from client context; the frontend chooses parent_invoice_id || customer_invoice_id and redirects when no selection exists. Sources: `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:24`, `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceSubRoutes.js:31`.

Create/export and calculations are in [create-invoice-engine.md](create-invoice-engine.md) and [month-end-finalize.md](month-end-finalize.md).

## 2. Access rules

Every route below requires authentication and backend role manager, admin, super admin or owner. The current role is loaded from the database. enforceAccountId rejects a noninteger/foreign numeric account with 403; missing authentication/account context produces 401. userID is not a self-only restriction; these are account-wide operations. Sources: `src/app.js:138`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/invoice/invoice-router.js:5`, `src/endpoints/auth/account-scope.js:7`.

The frontend gate omits owner ([F37](../_review/findings.md#f37)). Source: `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.

## 3. API reference

Unexpected database failure in the role middleware can return HTTP 500 through the global handler. Source: `src/endpoints/auth/jwt-auth.js:77`, `src/app.js:178`.

All routes share 401/403 above and HTTP 429 from the 300/minute API limiter. Unexpected rejected promises without a route catch are forwarded by express-async-errors to the global HTTP 500 handler. Sources: `src/app.js:7`, `src/app.js:100`, `src/app.js:178`.

### GET /invoices/getInvoices/:accountID/:invoiceID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/invoices/getInvoices/:accountID/:invoiceID` |
| Inputs | Required scoped accountID; invoiceID route segment is ignored. No query/body consumed; no pagination, filter or sort parameter. |
| Success | HTTP 200 `{activeInvoiceData:{activeInvoices,grid,treeGrid},message,status:200}`. activeInvoices includes parent and child rows. |
| Errors | Shared 401/403/429. Unexpected DB/grid errors reach the global **HTTP 500** handler. |
| Evidence | `src/endpoints/invoice/invoice-router.js:37`. |

### GET /invoices/getInvoicesPaginated/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/invoices/getInvoicesPaginated/:accountID/:userID` |
| Inputs | accountID scoped; userID required route segment but not a user filter. Optional page default 1, limit default 20, search default ''. page/limit use parseInt; values <1 or NaN fail; limit capped at 500. Numeric prefixes/fractions are parsed, not strictly validated as integers. |
| Search/sort | String search is trimmed; nonstring becomes ''. Matches customer display name, invoice number, invoice/due dates in YYYY-MM-DD. Fixed invoice_date DESC, no sort parameter. |
| Success | HTTP 200 `{invoicesList:{activeInvoiceData:{activeInvoices,grid,pagination,searchTerm}},message,status:200}`. pagination = {page,limit,totalItems,totalPages}; no treeGrid. |
| Errors | Shared 401/403/429; HTTP 400 Invalid pagination; HTTP 500 other caught failures, each with message/status. |
| Evidence | `src/endpoints/invoice/invoice-router.js:538`, `src/utils/pagination.js:4`. |

### GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/invoices/getInvoiceDetails/:invoiceID/:accountID/:userID` |
| Inputs | Required invoiceID/accountID/userID; account-scoped exact invoice-row lookup. No explicit numeric ID validation beyond the account guard. No query/paging/filter parameters. |
| Success | HTTP 200 `{invoiceDetails,invoiceTransactionsData,invoicePaymentsData,invoiceWriteoffsData,invoiceRetainersData,invoiceOutstandingInvoicesData,message,status:200}`. Each Data member has its named array plus grid; retainer/outstanding groups also have treeGrid. |
| Errors | Shared 401/403/429; HTTP 404 when the account-scoped invoice/contact query finds no row; unexpected failures go to the global HTTP 500 handler. |
| Evidence | `src/endpoints/invoice/invoice-router.js:464`, `src/endpoints/invoice/invoice-router.js:495`, `src/app.js:178`. |

### DELETE /invoices/deleteInvoice/:accountID/:invoiceID

| Item | Contract |
|---|---|
| Method | DELETE |
| Path | `/invoices/deleteInvoice/:accountID/:invoiceID` |
| Inputs | accountID scoped; invoiceID required; no body/query. No numeric validation or force-delete flag. |
| Success | HTTP 200 `{invoicesList:{activeInvoiceData},message,status:200}`, refreshed raw/grid/tree invoice list. |
| Refusals/errors | Shared 401/403/429. Missing invoice, child/snapshot target, direct transactions/payments/write-offs, absorbed marker, child history, absorbed source chains, nonzero beginning balance, changed customer/links during locking, or DB failure all return **HTTP 200 with body status:500** and message. |
| Evidence | `src/endpoints/invoice/invoice-router.js:59`, `src/endpoints/invoice/invoice-router.js:146`. |

Artifact downloads are documented in [storage and downloads](../platform/storage-and-downloads.md#3-api-reference).

## 4. Data model

| Source | Fields/behavior |
|---|---|
| customer_invoices | All invoice columns, including parent_invoice_id, invoice_number/date, due_date, remaining_balance_on_invoice, beginning_balance, monetary totals, paid status, notes, contact/creator and invoice_file_location. Only a guarded row deletion mutates them here. |
| customers / users | display_name becomes customer_name and created_by_user_name in lists; both are inner joins. |
| customer_information | Joined by the invoice's stored customer_info_id for detail; it need not still be active. |
| customer_transactions / customer_payments / customer_writeoffs | Full account-scoped rows linked to any ID in the selected invoice chain. Payments/write-offs are signed credits or reversals, not display-normalized absolute values. |
| customer_retainers_and_prepayments | Account/date-window history filtered to this customer; not limited to active/latest snapshots. |
| accounts / S3 | storage_slug determines allowed download prefixes; stored objects are fetched unchanged. |
| Evidence | `src/endpoints/invoice/invoice-service.js:31`, `src/endpoints/invoice/invoice-service.js:114`, `src/endpoints/invoice/invoice-router.js:480`, `src/endpoints/invoice/invoice-router.js:423`. |

Markers `[absorbed_by:...]` prevent deleting rolled-forward chains. Adjustment/payment snapshots are children, not independent issued statements. Source: `src/endpoints/invoice/invoice-router.js:81`, `src/endpoints/invoice/invoice-service.js:597`.

## 5. Read logic

Both list methods select invoice.* and joined customer/creator display names, filter invoice.account_id and order invoice_date DESC. They do not filter active customers, unpaid status or NULL parent. The paginated method counts a cloned filtered query, then fetches limit/offset; this is not a shared repeatable-read snapshot. Equal dates have no ID tie-break, so stable paging under ties/concurrent edits is not guaranteed. Source: `src/endpoints/invoice/invoice-service.js:31`.

Search uses case-insensitive LIKE on display name/number and TO_CHAR(date,'YYYY-MM-DD') LIKE. User % and _ retain SQL wildcard meaning. Count and page use identical filters. Source: `src/endpoints/invoice/invoice-service.js:39`.

Detail first joins the selected account invoice to customer and its stored contact. Resolve root = parent_invoice_id || requested ID. Read root/children scoped to account, ordered created_at DESC then ID DESC, and overlay **only remaining_balance_on_invoice** from the latest row. Other selected invoice fields remain as stored, so the result is not a fully reconstructed historical snapshot. Sources: `src/endpoints/invoice/invoice-service.js:82`, `src/endpoints/invoice/invoice-service.js:114`, `src/endpoints/invoice/invoice-router.js:473`.

Then retrieve all chain IDs. Transactions have no explicit order; payments/write-offs order created_at ASC without an ID tie-break. These are chain-wide records, not rows gated by the statement timestamp. Source: `src/endpoints/invoice/invoice-router.js:483`.

Retainers use account-wide created_at >= start_date AND created_at <= end_date, then customer filtering. Date-only end_date resolves to midnight, so later activity on that date is omitted ([F34](../_review/findings.md#f34)). Older still-active retainers created before start_date are also not returned. It is a history-window query, despite the route comment saying active retainers. Sources: `src/endpoints/invoice/invoice-router.js:487`, `src/endpoints/retainer/retainer-service.js:20`.

The outstanding tab fetches the customer's **current latest statement date** and today's outstanding candidate chains, even when opening an old invoice. It is not the saved beginning-balance section of that invoice. Source: `src/endpoints/invoice/invoice-router.js:490`.

Grid columns derive from keys in the first row; rows receive index-based grid IDs. Tree data nests on parent IDs; rows whose parent is absent are promoted to roots. Empty input gives empty rows/columns. Source: `src/utils/gridFunctions.js:6`, `src/utils/gridFunctions.js:68`.

## 6. Calculations

These endpoints do not recompute billing amounts. Detail replaces selected-row remaining balance with the latest chain balance. Pagination offset = (page-1) × capped limit; totalPages = ceil(totalItems/limit), including zero pages for no items. Sources: `src/endpoints/invoice/invoice-router.js:476`, `src/utils/pagination.js:4`.

Example: a parent is $500 and its latest payment child is $350. Detail shows remaining $350 while its other fields still come from the originally selected parent. The Payments tab includes payments linked to any child. Source: `src/endpoints/invoice/invoice-router.js:473`.

## 7. Create, edit and delete

No create/update endpoint exists in this register subset. Creation uses finalize; billed changes use the cascade route. The following delete sequence is narrower than voiding a statement:

1. Read account-scoped invoice; refuse if missing or parent_invoice_id is truthy.
2. Refuse any directly linked transaction, payment or write-off, any absorption marker or children.
3. Refuse if other invoice rows contain this invoice's absorption marker, or beginning_balance is nonzero.
4. Begin transaction; lock the owning customer FOR NO KEY UPDATE, then the invoice FOR NO KEY UPDATE. Re-read and refuse a changed customer.
5. Recheck structural/absorption conditions and all linked row counts under locks; delete only the account-scoped invoice row.
6. Fetch refreshed register data after commit.

Source: `src/endpoints/invoice/invoice-router.js:59`, `src/endpoints/invoice/invoice-router.js:105`.

There is no S3 delete, child deletion, ledger unlink/reprice, retainer restoration or notification in this handler. Its wording mentions retainers, but the explicit direct-link count queries are transactions, payments and write-offs. A post-delete list failure can return an error after the row is gone. Source: `src/endpoints/invoice/invoice-router.js:66`, `src/endpoints/invoice/invoice-router.js:134`.

The [generic download contract](../platform/storage-and-downloads.md#3-api-reference) authorizes account prefixes rather than invoice-row membership. It accepts own-account audit PDFs for Manager/Admin/Owner, although the dedicated audit API requires Super Admin. This is the role-gate bypass recorded as [F4](../_review/findings.md#f4). Sources: `src/utils/downloadAuthorization.js:40`, `src/endpoints/accountAudit/account-audit-router.js:37`.

## 8. Invariants and tests

| Existing spec | Evidence |
|---|---|
| test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js | Register/list/detail/delete/download status contracts, linked-ledger guards and tenant scoping. |
| test/integration/coverage-downloads-authz.integration.spec.js | Key ownership, foreign paths and download authorization boundaries. |
| test/utils/downloadAuthorization.spec.js | Traversal/encoding/control-character refusals and account namespaces. |
| ../DS2_Frontend/src/Pages/Invoices/InvoiceGrids/InvoicesGrid.test.js | Frontend register behavior. |

No tests were executed for this documentation task. Stored PDF content is evidence of generation time, not proof that the current detail rows still match it. Sources: `src/endpoints/invoice/invoice-router.js:398`, `src/endpoints/billingReview/cascadeEdit.js:386`.

## 9. Known limitations and open decisions

The report leaves void-versus-delete and adjustment-only closed-period behavior open. It identifies duplicate parents, stale mirrors and rolled-forward balances needing accountant decisions, not automatic deletion. Source: `scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:61`.

Storage authorization depends on migration 020 and the backend cutover; production completion is **not determined from the code**. Follow FINAL_REPORT section 6 for backup, migration ordering, backend-before-frontend and environment settings. Source: `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **4 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
