# Write-offs and adjustments

Pass 4 UI correction: background grid refreshes preserve focus in open write-off forms (`GridFocus.test.js`).

Write-off details tolerate customer/job lookups still loading and retain their stored IDs. Sent write-offs immediately show **Sent — locked** and **Open invoice history**, without an ordinary delete control (`SentScreens.test.js`).

Delete requests guard pending clicks and display HTTP/network failures while retaining the record. Cancelling or failing the request changes no money; an explicit retry can remove an eligible unissued write-off (`DeleteFinancial.failure.test.js`, `user-mistakes-delete.spec.js`).

Creation now guards repeated clicks while pending and catches failed requests. Failure messages remain visible with form values intact, allowing an explicit retry. Empty/zero/nonfinite amounts are refused. Receipt sign normalization remains unchanged.

## Owner decision update — 2026-09-25

Hidden/netted credits as well as visibly printed write-offs are captured in immutable statement membership. Update/delete of any such row returns HTTP 409 naming its statement, with no writes. A new invoice-level credit still appends a child and changes current debt, leaving issued totals/paid status unchanged. A later statement locks that child/credit. Billing Review cannot cascade through sent work. [Sent contract](../invoicing/invoices.md).


Source review dated 2026-09-24. This file owns five write-off endpoints. The [billing-review guide](../invoicing/billing-review.md) owns transaction corrections and invoice adjustment events. Shared rules are in [ledger-conventions.md](ledger-conventions.md).

## 1. Purpose and UI

An invoice-linked write-off immediately reduces current billed debt through a snapshot. A write-off without an invoice is a pending credit for a later bill, optionally attached to a job. A billing-review adjustment changes a work transaction and, when permitted, posts its billable amount difference to the linked statement. These are distinct paths. (`src/endpoints/writeOffs/writeOffs-logic.js:67`, `src/endpoints/billingReview/cascadeEdit.js:764`.)

| UI | Route and files |
| --- | --- |
| Write-off grid/add | `/transactions/customerWriteOffs`; `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:30`; `../DS2_Frontend/src/Pages/Transactions/TransactionGrids/WriteOffsGrid.js:77`; `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/WriteOff.js:34`. |
| Delete | `/transactions/customerWriteOffs/deleteWriteOff`; `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/WriteOffSubRoutes.js:36`; `../DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeleteWriteOff.js:1`. |
| Edit availability | `EditWriteOff.js` exists under frontend `Pages/Transactions/TransactionForms/EditTransaction`; its `editWriteOff` route and menu item are commented out. The update API exists. (`../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/WriteOffSubRoutes.js:43`.) |
| Invoice history | `/invoices/invoices/invoiceDetail/invoiceWriteOffs`; `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceSubRoutes.js:57`; `../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceWriteOffs.js:1`. |
| Work corrections | `/time-tracking/billingReview`; `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:41`; `../DS2_Frontend/src/Pages/Transactions/BillingReview/BillingReviewPage.js:6`; its consolidated/pre-invoice tabs and `components/CascadeImpactPanel.js` show correction impact. |

The write-off form offers prior-invoice and current-job selections. Its help says adjustments are unsupported, asks for the invoice number in the reason, and describes a job outstanding-amount limit. Those statements are not equivalent to backend validation: the API requires a nonempty reason but no invoice-number pattern; it allows general credits and does not cap an uninvoiced credit to a job's current balance. The separate billing-review correction path exists. (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/WriteOff.js:60`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/WriteOff.js:89`, `src/endpoints/writeOffs/writeOffs-logic.js:75`, `src/endpoints/billingReview/billingReview-router.js:311`.)

## 2. Access rules

All documented routes require active-user authentication and role `manager`, `admin`, `super admin`, or `owner`. `enforceAccountId` requires integer URL account ID equal to the authenticated user's account. No self-or-privileged check applies to URL user ID. Creates and adjustment events use the authenticated actor; ordinary write-off edits preserve the original creator. Wrong/missing authentication returns HTTP 401; wrong account/role returns 403. Frontend manager-level routes include `owner`, matching the backend (fixed [F37](../_review/findings.md#f37)). (`src/app.js:146`, `src/app.js:160`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/writeOffs/writeOffs-router.js:6`, `src/endpoints/writeOffs/writeOffs-router.js:29`, `src/endpoints/billingReview/billingReview-router.js:317`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.)

## 3. API reference

Create/update input errors return HTTP400. Other write-off mutation and single-record errors retain HTTP200 with a JSON error status. The write-off list and billing-review adjustment route use real HTTP statuses. All also have the common middleware errors in [conventions](ledger-conventions.md#3-api-conventions), including 401/403, JSON parser 400/413, and rate-limit 429. Billing-review mutations additionally use the 30-requests-per-minute expensive-operation limiter, subject to the same disable/test conditions. (`src/endpoints/writeOffs/writeOffs-router.js:35`, `src/endpoints/writeOffs/writeOffs-router.js:167`, `src/endpoints/billingReview/billingReview-router.js:330`, `src/app.js:111`, `src/app.js:160`.)

### Write-off fields

| Field in `{writeOff:{...}}` | Type, requiredness, and rules |
| --- | --- |
| `customerID` | Required create numeric/coercible positive integer in this account. Optional update; a different valid positive ID is refused. (`src/endpoints/writeOffs/writeOffsObjects.js:13`, `src/endpoints/writeOffs/writeOffs-logic.js:84`, `src/endpoints/writeOffs/writeOffs-logic.js:147`.) |
| `unitCost` | Required create/update, including metadata-only update. Number/coercible string; `round2(abs(value)) > 0`; stored negative. SQL `numeric(10,2)`. Linked invoice remaining caps the amount; uninvoiced credit has no job-total cap. (`src/endpoints/writeOffs/writeOffs-logic.js:78`, `src/endpoints/writeOffs/writeOffs-logic.js:114`, `src/endpoints/writeOffs/writeOffs-logic.js:157`, `migrations/schema-snapshot-2026-09-22.sql:806`.) |
| `selectedDate` | Required create, a real YYYY-MM-DD date or supported ISO timestamp; SQL date. Optional update: omission preserves the date; explicit invalid/null/empty refuses. No future-date or accounting-period validation here. (`src/endpoints/writeOffs/writeOffs-logic.js:82`, `src/endpoints/writeOffs/writeOffs-logic.js:187`.) |
| `writeoffReason` or `writeOffReason` | Required truthy nullable string on create; first spelling wins unless null/undefined. SQL varchar(50), a request limit of50 characters; the mapper does not trim. Optional update; omission preserves the reason; explicit null/empty/blank refuses. (`src/endpoints/writeOffs/writeOffsObjects.js:5`, `src/endpoints/writeOffs/writeOffs-logic.js:81`, `src/endpoints/writeOffs/writeOffs-logic.js:185`.) |
| `customerInvoiceID` | Optional; convert with `Number(value)` and map falsy result to null. If supplied, must resolve within account to this customer's invoice. Old chains remap to a live current chain. Update cannot move to another invoice or attach a previously uninvoiced credit; omitted/null retains stored link. (`src/endpoints/writeOffs/writeOffsObjects.js:15`, `src/endpoints/writeOffs/writeOffs-logic.js:93`, `src/endpoints/writeOffs/writeOffs-logic.js:150`.) |
| `selectedJobID` | Optional positive integer scalar; malformed nonempty values refuse. Create validates it against account/customer even when an invoice is also supplied. Update can change/clear it only on an uninvoiced write-off; omission leaves unchanged. (`src/endpoints/writeOffs/writeOffsObjects.js:16`, `src/endpoints/writeOffs/writeOffs-logic.js:85`, `src/endpoints/writeOffs/writeOffs-logic.js:179`.) |
| `note` | Optional nullable text; XSS-sanitized by router. Create does not call `stripLinkMarkers`; update preserves stored system markers and strips recognized new links via `preserveSystemMarkers`. (`src/endpoints/writeOffs/writeOffs-router.js:23`, `src/endpoints/writeOffs/writeOffs-logic.js:77`, `src/endpoints/writeOffs/writeOffs-logic.js:188`.) |
| `writeoffID` or `writeOffID` | Required update/delete ID; first spelling wins unless null/undefined; coerced numeric and validated on stored-row lock/lookup. (`src/endpoints/writeOffs/writeOffsObjects.js:28`, `src/endpoints/payments/ledger-helpers.js:75`.) |
| `accountID`, `loggedByUserID`, `transactionType` | Client cannot choose account/creator/type. Create type is `Writeoff`; update keeps stored type and creator. (`src/endpoints/writeOffs/writeOffsObjects.js:19`, `src/endpoints/writeOffs/writeOffs-router.js:29`, `src/endpoints/writeOffs/writeOffs-logic.js:177`.) |

### Create write-off

| Property | Contract |
| --- | --- |
| Method/path | `POST /writeOffs/createWriteOffs/:accountID/:userID` |
| Body | `{writeOff:{customerID,unitCost,selectedDate,writeoffReason,...optionalFields}}`. |
| Success | HTTP 200, `{status:200,message,...writeOffTables}`; tables defined below. |
| Errors | Common middleware errors; input-validation HTTP400 takes precedence; otherwise HTTP200/JSON500 for ledger state, including wrong/missing job or invoice, cross-customer invoice, no current chain/all-newest-chains-absorbed inconsistency, remapped nonpositive balance, amount exceeding linked balance, precommit DB failure. |
| Source | `src/endpoints/writeOffs/writeOffs-router.js:18`, `src/endpoints/writeOffs/writeOffs-logic.js:75`. |

### Single write-off

| Property | Contract |
| --- | --- |
| Method/path | `GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID` |
| Parameters | Positive integer/coercible write-off ID. No paging/filter/sort fields. |
| Success | HTTP 200, `{status:200,message,activeWriteOffsData:{activeWriteOffs:[rawRow],grid}}`. |
| Errors | Common middleware errors; HTTP 200/JSON 404 for malformed/missing/other-account ID; HTTP 200/JSON 500 for other failures. |
| Source | `src/endpoints/writeOffs/writeOffs-router.js:45`. |

### Update write-off

| Property | Contract |
| --- | --- |
| Method/path | `PUT /writeOffs/updateWriteOffs/:accountID/:userID` |
| Body | `{writeOff:{writeoffID,unitCost,...optionalUpdateFields}}`. |
| Success | HTTP 200, `{status:200,message,...writeOffTables}`. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: missing record; billed event; cross-customer stored invoice; attempted customer/invoice movement; invalid amount; direct-parent repricing; newer child; negative resulting invoice balance; wrong-customer new job; precommit DB failure. |
| Source | `src/endpoints/writeOffs/writeOffs-router.js:84`, `src/endpoints/writeOffs/writeOffs-logic.js:143`. |

### Delete write-off

| Property | Contract |
| --- | --- |
| Method/path | `DELETE /writeOffs/deleteWriteOffs/:accountID/:userID` |
| Body | `{writeOff:{writeoffID}}` (alias `writeOffID` accepted). Only ID is trusted for selecting what to undo. |
| Success | HTTP 200, `{status:200,message,...writeOffTables}`. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: missing record, billed event, cross-customer stored invoice, newer child, precommit DB failure. |
| Source | `src/endpoints/writeOffs/writeOffs-router.js:108`, `src/endpoints/writeOffs/writeOffs-logic.js:200`. |

### Paginated write-offs

| Property | Contract |
| --- | --- |
| Method/path | `GET /writeOffs/getWriteOffs/:accountID/:userID` |
| Query | Optional `page=1`, `limit=20` capped at 500, `search=''` trimmed string (other types become empty); shared parseInt pagination. Fixed `created_at DESC`; no client sort/date/customer/amount filter. |
| Success | HTTP 200, `{status:200,message,writeOffsList:{activeWriteOffsData:{activeWriteOffs:[joinedRow...],grid,pagination,searchTerm}}}`. |
| Errors | Common middleware errors; real HTTP/JSON 400 for bad pagination; real HTTP/JSON 500 for other errors. |
| Source | `src/endpoints/writeOffs/writeOffs-router.js:135`, `src/endpoints/writeOffs/writeOffs-service.js:40`. |

`writeOffTables` contains `invoicesList.activeInvoiceData.{activeInvoices,grid,treeGrid}` and `writeOffsList.activeWriteOffsData.{activeWriteOffs,grid}`. Note the invoice array key is `activeInvoices`, unlike payment responses' `invoicesList`. These are full-account refreshes after commit, without current page/search constraints. (`src/endpoints/writeOffs/writeOffs-router.js:178`.)

### Billing-review transaction adjustment

The [billing-review guide](../invoicing/billing-review.md#3-api-reference) owns the adjustment endpoint, accepted fields, validation and error contract. It corrects a work transaction; it does not create a write-off row.

### Pass 2 input and committed-response contract

Create/update requests validate their raw object before coercion and check sanitized text again before mapping (`src/utils/ledgerInput.js`). Money must be a finite number or numeric string, nonzero after cent rounding, with magnitude at most99999999.99. Booleans/arrays/objects are refused. Customer IDs must be positive integer scalars; malformed nonempty optional selections refuse instead of becoming null. Dates must be real YYYY-MM-DD calendar dates or supported ISO timestamps. Required text cannot be blank; bounded text is limited to the schema character count, and notes must be text without null characters. These input errors return real HTTP400 and make no writes. Omitted optional update fields retain their documented meaning.

After a successful commit, a failed list refresh returns HTTP200 with `status:200`, `committed:true`, and a warning to reload without resubmitting. The write remains committed. Ordinary successful responses keep their existing tables. Tests: `scenario-what-if-01-values`, `02-retries` and `06-boundaries`.

## 4. Data model

`customer_writeoffs` contains ID, customer/account, nullable invoice/job links, SQL date, negative `numeric(10,2)` amount, varchar(50) transaction type and required reason, creator, creation timestamp and note. Invoice-linked create/edit/delete touches invoice snapshot/parent remaining, `total_write_offs`, paid flag/date; it does not change work transaction amounts or retainer balances. Customer/job/creator tables support ownership and display. (`migrations/schema-snapshot-2026-09-22.sql:799`, `src/endpoints/writeOffs/writeOffs-logic.js:123`, `src/endpoints/writeOffs/writeOffs-service.js:1`.)

Remapped write-offs use `[applied to NEW; referenced OLD]` in `note` (payment wording includes `customer referenced` instead). The billing-review event instead writes `[adjustment: transaction #N Δ+/-amount]` in invoice `notes`. It edits `customer_transactions`, invoice totals/snapshots and specific `customer_jobs` row totals; it also records reviewer corrections and, on work-description change, category-training history through their services. No `customer_writeoffs` row is created by that correction path. (`src/endpoints/writeOffs/writeOffs-logic.js:110`, `src/endpoints/billingReview/cascadeEdit.js:281`, `src/endpoints/billingReview/cascadeEdit.js:397`, `src/endpoints/billingReview/cascadeEdit.js:676`, `src/endpoints/billingReview/cascadeEdit.js:705`.)

## 5. Read logic

The account write-off query selects all write-off fields plus customer/creator names, job type and job description. It inner-joins customers/users, left-joins `customer_jobs` and `customer_job_types`, and filters write-off account. Search ORs lowercase LIKE over customer name, job description, reason, note, IDs cast to text and date formatted `YYYY-MM-DD`. `%`/`_` remain wildcards; amount is not included. Paginated results use created-at descending with no ID tie-break; count and page are separate queries. Mutation refresh uses the same joined query with **no explicit order**. (`src/endpoints/writeOffs/writeOffs-service.js:1`, `src/endpoints/writeOffs/writeOffs-service.js:17`, `src/endpoints/writeOffs/writeOffs-service.js:36`.)

Single detail returns a raw account/ID array. Helper queries by invoice ID or job ID are exact-link filters without ordering/pagination. The invoice UI uses a different chain-wide query: resolve root and all children, then account-scoped write-offs with invoice ID in that set, creation ascending. Initial application data uses the paginated account query. (`src/endpoints/writeOffs/writeOffs-service.js:58`, `src/endpoints/writeOffs/writeOffs-service.js:62`, `src/endpoints/writeOffs/writeOffs-service.js:66`, `src/endpoints/invoice/invoice-router.js:483`, `src/endpoints/initialData/initialData-router.js:100`.)

Billing reads this account's selected customers' write-offs after the latest parent creation timestamp, regardless of write-off date. Left joins provide the linked invoice, its root using `COALESCE(parent_invoice_id,customer_invoice_id)`, linked chain invoice date, and job/type data. Rows are grouped by customer in memory; the query has no explicit order. The exact last-parent timestamp comparison is in PostgreSQL. (`src/endpoints/invoice/invoice-service.js:10`, `src/endpoints/invoice/invoice-service.js:315`.)

Adjustment preview reads the transaction by account/ID. Apply then locks customer ledgers and rereads the transaction `FOR UPDATE`; invoice root/latest state is loaded only for a date-period check or nonzero billable delta. Newer-parent detection tests a later root creation timestamp **or** later invoice date, not only the payment router's newest-date selection. (`src/endpoints/billingReview/cascadeEdit.js:319`, `src/endpoints/billingReview/cascadeEdit.js:536`, `src/endpoints/billingReview/cascadeEdit.js:641`.)

## 6. Calculations and bill-day behavior

### Immediate write-off effects

Create normalizes `w=-round2(abs(unitCost))`. Invoice-linked remaining becomes `round2(latestRemaining+w)`, and parent `total_write_offs += w`. A $40 credit against $300 leaves $260. Job/general create leaves invoices unchanged. Amount edit uses `delta=newMagnitude-oldMagnitude`, snapshot remaining minus delta, and parent write-offs minus delta. Editing $40 to $70 leaves $230. Delete restores snapshot remaining plus absolute stored write-off and removes its signed parent contribution. (`src/endpoints/writeOffs/writeOffs-logic.js:75`, `src/endpoints/writeOffs/writeOffs-logic.js:157`, `src/endpoints/writeOffs/writeOffs-logic.js:207`.)

### Next bill and pending credits

1. Fetch period write-offs by **creation timestamp**, not entered date. A credit entered after a same-day statement remains eligible for the next bill; one created at/before the parent is behind the gate. Finalization does not attach job/general write-offs to an invoice ID. The new parent timestamp becomes their later immutability/membership boundary. (`src/endpoints/invoice/invoice-service.js:10`, `src/endpoints/invoice/invoice-service.js:315`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:200`, `src/endpoints/writeOffs/writeOffs-logic.js:36`.)
2. `showWriteOffs` is true only for true/`"true"`, or is forced true when there is no unbilled work and at least one invoice-linked credit. All calculators receive that effective flag. (`src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:45`.)
3. An uninvoiced credit is eligible for a separate deduction. An invoice-linked credit is separately deducted only if its chain date is earlier than the last bill date, or either date is unknown. Current-chain credit is excluded because it already reduced outstanding balance. The comparison is strictly `<`, not `<=`. (`src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`.)
4. When shown, the engine write-off total sums all eligible credits; the listed total sums all displayed credit rows, including current-chain credits. Thus displayed and engine totals can differ by design. (`src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:31`, `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:49`.)
5. When hidden, invoice-linked eligible credits remain a separate write-off contribution. Job/general credits reduce job totals. A job with no unbilled work gets an adjustment-only group; a credit with no job gets `General credit`. Nonbillable work is retained in detail but does not add charge amount. (`src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:20`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:52`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:81`.)
6. Example: $200 work and a new -$30 job credit become $170 transaction total with hidden credits, or $200 transaction total plus -$30 write-off total when shown. With no work, the -$30 remains as an adjustment-only group. A final negative customer balance is skipped unless explicitly selected for a credit statement; selected credits carry forward once under owner decision2. (`src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:20`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:4`, `src/endpoints/invoice/invoice-router.js:315`.)
7. Hidden-credit grouping excludes every invoice-linked row, including credits sharing a job with unbilled work. A current invoice balance $80 after a -$20 invoice/job credit, plus $100 new work on that job, gives $180 in both display modes. Current-chain and absorbed-chain regression cases cover the fixed [F8](../_review/findings.md#f8). (`src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:52`, `test/endpoints/invoice/review-writeoff.spec.js`.)

### Work correction / adjustment

Use [Billing Review calculations and edits](../invoicing/billing-review.md#6-calculations) for the billed delta, snapshot, locking and correction rules. Direct transaction edits and write-off mutations have different guards; they are not interchangeable.

## 7. Create, edit, delete, and side effects

Write-off cores share the customer `FOR NO KEY UPDATE` lock and one transaction. Create validates amount/reason/date, account/customer and any job, then resolves a selected invoice to its same-customer live chain. Older/absorbed references remap with notes; all-absorbed newest roots refuse; invoice amount cannot exceed latest remaining. Insert child/mirror before the write-off row. Both event timestamps use `clock_timestamp()` after the lock. Without an invoice, insert only the negative credit; job is optional and its current total is not changed. No retainer/payment/PDF/S3/notification side effects occur in this core. (`src/endpoints/writeOffs/writeOffs-logic.js:75`, `src/endpoints/payments/payment-logic.js:99`, `src/endpoints/payments/ledger-helpers.js:30`, `src/endpoints/payments/ledger-helpers.js:62`.)

Update/delete lock the stored owner's customer. A linked invoice row is the billed anchor; otherwise the write-off row is. SQL `created_at <= newestParent.created_at` refuses already billed data, including pending job credits consumed by an intervening bill. Cross-customer stored invoice links are refused. The router translates even this core 423 refusal into HTTP 200/JSON 500. (`src/endpoints/writeOffs/writeOffs-logic.js:36`, `src/endpoints/writeOffs/writeOffs-router.js:98`.)

Update cannot move customer/invoice or convert an uninvoiced credit to an invoice credit. Amount changes on linked data require a child, latest-child status and resulting remaining at least zero, then edit that child and parent. Same-amount metadata edits do not need latest-child status. Only uninvoiced rows can change job; a valid new job must belong to the customer. Omitted reason/date fields are preserved; explicitly invalid values refuse at the request boundary; note updates preserve system markers. Creator/type/creation time stay stored. (`src/endpoints/writeOffs/writeOffs-logic.js:143`.)

Delete a latest unbilled child-linked credit by restoring parent balance/totals, deleting its invoice child, then deleting the write-off. A parent invoice is never deleted by this path. An uninvoiced credit just deletes its own row. A legacy direct-parent link that gets past the billed guard also bypasses parent restoration and snapshot deletion. No general write-off reversal endpoint exists in this router; after billing, ordinary delete/edit is refused. (`src/endpoints/writeOffs/writeOffs-logic.js:200`, `src/endpoints/writeOffs/writeOffs-router.js:18`.)

Billing-review corrections have a separate lock, validation and snapshot sequence. See [cascade edits](../invoicing/billing-review.md#cascade-edit) for that sequence and the shared job-family recomputation. Corrections do not create write-off rows or regenerate issued PDFs.

## 8. Invariants and tests

The original documentation review read existing tests. F8 and F9 now have executed regression tests; see the [remediation log](../_review/fixes-F8-F22.md) for red/green evidence and final verification.

| Rule | Test evidence |
| --- | --- |
| Field spelling aliases and signed input | `test/endpoints/writeOffs/writeOffs-objects.spec.js:1`. |
| Invoice create/remap, customer ownership and job credit | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1115`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1171`, `test/integration/payment-reversal.integration.spec.js:768`, `test/integration/payment-reversal.integration.spec.js:819`. |
| Amount edit updates child/parent; billed immutability; symmetric deletion | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1198`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1243`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1260`. |
| Detail/list/pagination errors and cap | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1309`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1354`. |
| Exact statement timestamp and job ownership even with invoice supplied | `test/integration/payment-reversal.integration.spec.js:1540`, `test/integration/payment-reversal.integration.spec.js:1592`. |
| Single-count engine rule | `test/endpoints/payments/payment-integrity.spec.js:23`; `test/endpoints/invoice/review-writeoff.spec.js` covers linked credits plus same-job work in both display modes. |
| Financial delta adjustment, paid/absorbed guards and recomputation | `test/integration/cascade-edit-recompute.integration.spec.js:1`. |

## 9. Known limitations and open decisions

[F8](../_review/findings.md#f8) and [F9](../_review/findings.md#f9) are fixed and regression-tested. Historical accountant populations remain separate: the report lists 61 write-offs for 28 customers for accountant decision, parent mirror inconsistencies, job-family total drift, and negative-credit finalization policy. These fixes do not classify those historical customers or repair stored financial data. (`scripts/review-2026-09/FINAL_REPORT.md:48`, `scripts/review-2026-09/FINAL_REPORT.md:50`, `scripts/review-2026-09/FINAL_REPORT.md:54`, `scripts/review-2026-09/FINAL_REPORT.md:56`.)

The UI help and backend adjustment capability differ; write-off edit UI is disabled despite the API. A generalized accountant-approved method to reverse every already-billed write-off is **not determined from the code**. Period locks, adjustment-only corrections, voids and persisted billing runs remain open choices. (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/WriteOff.js:89`, `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/WriteOffSubRoutes.js:43`, `scripts/review-2026-09/FINAL_REPORT.md:59`.)

Use report section 6's migration sequencing, reviewed backfills and backend-before-frontend rollout requirements. Remediation tests ran only in the local sandbox; there was no production execution. (`scripts/review-2026-09/FINAL_REPORT.md:67`.)

## Completion summary

Coverage: **5 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F8 regression: `test/endpoints/invoice/review-writeoff.spec.js` verifies same-job current-chain and absorbed-chain invoice credits count once in both shown and hidden modes (2 passing). Invoice-linked credits are excluded before all hidden job grouping.


## Owner run 2 — retainers and duplicate review

Manual write-off creation flags possible duplicates atomically when same customer/type/job/amount/reason and date within three days. Deleting an unissued duplicate invokes `deleteWriteOffCore`; sent/dependent credits refuse unchanged. This workflow is separate from [retainer adjustments](retainers-and-prepayments.md), which change available funds only. See [duplicate review](duplicates.md).


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.
