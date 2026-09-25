# Create-invoice engine

## 1. Purpose and UI

The engine builds the next rolling statement from existing balances, unbilled work and payments/write-offs entered since the last statement. UI route: `/invoices/createInvoice`. Page: `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:17`; grid wrapper: `../DS2_Frontend/src/Pages/Invoices/InvoiceGrids/CreateInvoiceGrid.js:5`; route: `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:26`. The customer profile also requests a balance preview with all output flags false. Source: `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:44`.

Source review date: 2026-09-24. Tests named below were read, not run. Backend paths are relative to DS2_Backend; frontend paths begin with ../DS2_Frontend. The schema snapshot is the baseline, supplemented by later migrations, especially storage_slug. This does not establish live database state. Source: `migrations/README.md:12`.

## 2. Access rules

Invoice endpoints require authentication and one of the exact backend roles `manager`, `admin`, `super admin`, `owner`. Roles are reread from the database and lowercased. The access-token cookie takes precedence over a Bearer token; authentication verifies the JWT and loads the current user by its subject email. Missing/invalid/expired/unresolvable authentication returns HTTP 401; disallowed roles return 403. Sources: `src/app.js:138`, `src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:64`, `src/endpoints/auth/jwt-auth.js:94`.

enforceAccountId requires numeric accountID to be an integer equal to session account_id. Missing user/account context returns 401; bad/foreign account returns 403. No self-or-privileged check is registered on userID. Finalization records req.user.user_id, with a URL fallback only if absent. Sources: `src/endpoints/invoice/invoice-router.js:5`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/invoice/invoice-router.js:242`.

The frontend manager gate permits manager, admin and super admin but omits owner. Finding [F37](../_review/findings.md#f37) records this discrepancy. Source: `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.

## 3. API reference

Unexpected database failure in the role middleware can return HTTP 500 through the global handler. Source: `src/endpoints/auth/jwt-auth.js:77`, `src/app.js:178`.

The eligibility route also has the general 300 requests/minute limiter: HTTP 429 when exceeded, skipped in tests or with DISABLE_RATE_LIMIT. Malformed JSON returns 400; JSON over 1 MB returns 413. Sources: `src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`.

### GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID` |
| Path | accountID required and scoped; invoiceID is a required route segment but ignored. |
| Query/body | None consumed. No pagination, sorting or search. |
| Success | HTTP 200, `{outstandingBalanceList:{activeOutstandingBalancesData:{activeOutstandingBalances,grid}},message,status:200}`. Customer rows contain eligibility totals, last invoice information, billed_today and last_audit_at for a matched completed audit. |
| Errors | 401/403/429 above. Unexpected eligibility/grid failures reach the global **HTTP 500** handler. The batch recalculation has its own catch: one calculation/query failure leaves invoice_total=0 for every listed customer. Audit lookup failures are also swallowed, leaving last_audit_at null. |
| Evidence | `src/endpoints/invoice/invoice-router.js:155`, `src/endpoints/invoice/invoice-router.js:172`, `src/endpoints/invoice/invoice-router.js:213`. |

The [generation and finalization contract](month-end-finalize.md#3-api-reference) owns all POST modes: compute-only, draft, CSV and final. This guide owns the eligibility read and the shared calculation engine.

## 4. Data model

| Table | Fields and use |
|---|---|
| accounts, account_information | Identity, storage_slug/logo, pay-to address, account_statement, account_interest_statement. Active MAILING account information is left joined. |
| customers, customer_information | IDs/account, names, active flag; active MAILING contact/address and customer_info_id. |
| customer_invoices | IDs/parent, invoice_number/date, created_at, remaining_balance_on_invoice, paid flag/date and monetary components. NULL parents are statements; children are snapshots. Marker reads also accept legacy self-parent rows. |
| customer_transactions | Account/customer/job/invoice IDs, transaction_date, billable flag, total_transaction, quantity/rate, retainer_id. New work has invoice ID NULL. |
| customer_jobs, customer_job_types | Description/type for groups. Actual transaction job ID, not family root, defines a group. |
| customer_payments | Signed payment_amount, payment_date, created_at, form, invoice link, reference. Normal payments/draws are negative; positive reversals raise balances. |
| customer_writeoffs | Negative writeoff_amount, date/created_at, invoice/job links, type/reason. Both links may exist. |
| customer_retainers_and_prepayments | Root/child history, signed starting/current amounts, active flag, timestamp and IDs. Credit balances normally are negative; latest balance is informational. |
| account_audits | Latest completed audit and comparison totals on the selection screen; not a prerequisite for billing. |
| Evidence | `src/endpoints/invoice/invoice-service.js:162`, `src/endpoints/invoice/invoice-service.js:233`, `src/endpoints/invoice/invoice-service.js:263`, `src/endpoints/invoice/invoice-service.js:288`, `src/endpoints/invoice/invoice-service.js:315`, `src/endpoints/invoice/invoice-service.js:349`, `src/endpoints/invoice/invoice-router.js:183`. |

Calculation does not write markers. Finalization appends `[absorbed_by:INV-YYYY-NNNNN@YYYY-MM-DD]` to old invoices. See [month-end-finalize.md](month-end-finalize.md). Source: `src/endpoints/invoice/invoice-service.js:509`.

## 5. Read logic

### fetchInitialQueryItems

It gets customer IDs from the request map, derives billingYear from billingDate (otherwise server year), fetches last invoice dates and markers, then fetches invoice numbering, pay-to details, mailing contacts, transactions, payments, write-offs, retainer histories and outstanding candidates using Promise.all. It returns these maps without mutations. The caller supplies the database/transaction; the finalize route supplies a consistent snapshot. Source: `src/endpoints/invoice/createInvoice/createInvoiceQueries.js:10`.

| Read | Membership, joins and order |
|---|---|
| Last date | MAX(invoice_date) per selected customer/account; parent NULL or own ID. `src/endpoints/invoice/invoice-service.js:183`. |
| Last marker | DISTINCT ON customer, same root definitions; invoice_date DESC, created_at DESC, ID DESC. `src/endpoints/invoice/invoice-service.js:207`. |
| Invoice number | Account, NULL parent, exact INV-year-five-digits pattern; greatest numeric suffix. `src/endpoints/invoice/invoice-service.js:140`. |
| Customer mailing | Inner join active MAILING customer_information, account conditions on both tables. Map reduction has no ordering; multiple active mailing records can overwrite in unspecified order. `src/endpoints/invoice/invoice-service.js:233`. |
| Transactions | Account/customer IDs, invoice ID NULL; inner jobs and job types. **No date cutoff**, including future work; no billable filter; missing jobs disappear. No ordering. Transaction columns selected last preserve their customer identity. `src/endpoints/invoice/invoice-service.js:263`. |
| Payments | Account/customer and statement gate below; left invoice join for number; all forms, linked or unlinked. No ordering. `src/endpoints/invoice/invoice-service.js:288`. |
| Write-offs | Account/customer and same gate; left linked invoice, root via COALESCE(parent,id), job/type; exposes linked_chain_invoice_date. No ordering. `src/endpoints/invoice/invoice-service.js:315`. |
| Retainers | All account/customer history, no date cutoff; created_at ASC, ID ASC; created_at::text preserves microseconds. `src/endpoints/invoice/invoice-service.js:349`. |
| Outstanding candidates | Account/customer NULL parents, created_at DESC then ID DESC; children by parent ID in the same order, without repeating account_id on that child query. Skip parent dates older than latest statement date. `src/endpoints/invoice/invoice-service.js:377`. |

### Statement membership

A payment/write-off belongs to the next statement when **created_at > newest parent created_at**. Its business date does not decide membership. When the marker includes an ID, SQL compares against that parent's timestamp in a scalar subquery, preserving microseconds. Equal timestamps are excluded. Legacy markers without a timestamp use created_at >= last invoice date. Never-billed customers have no gate. Source: `src/endpoints/invoice/invoice-service.js:1`.

After a parent at 10:00:00.123400, a payment created at 10:00:00.123500 qualifies even if payment_date is yesterday. A payment at exactly the parent's timestamp does not. Sources: `src/endpoints/invoice/invoice-service.js:17`, `test/endpoints/accountAudit/statement-gate.spec.js:1`.

### Outstanding chains

A childless parent qualifies only with positive remaining balance. A newest child at zero and paid=true closes the chain. Any positive child causes children and parent to be supplied. Otherwise a parent created on/after last bill date or a zero child created after that date can retain the chain. Source: `src/endpoints/invoice/invoice-service.js:409`.

The calculator groups by **invoice_number**. A paid flag, fully_paid_date or zero remaining discards the number's group unless a pending payment matches its number or pending write-off matches that exact row ID. A retained row must have positive remaining and invoice_date <= lastInvoiceDate. A same-date parent does not replace the newest child arriving first. Sum the remaining balances of retained groups. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js:48`.

### Selection-list eligibility

Eligibility reads active customers with an active address (not specifically MAILING), invoice rows, transaction-service rows and payment/write-off/retainer histories. Transaction-service inner joins can omit broken jobs. Actual statement detail later requires an active MAILING record. Sources: `src/endpoints/invoice/invoiceEligibility/invoiceEligibility.js:16`, `src/endpoints/customer/customer-service.js:1`, `src/endpoints/transactions/transactions-service.js:1`.

Current balance uses the latest snapshot of every parent on the latest invoice date, including same-day duplicates. Keep customers with abs(balance) >= $0.005, any unbilled transaction (including nonbillable), or pending negative write-offs/payments. Retainers alone do not establish eligibility. retainer_count counts all active negative history rows, not latest chains; invoice_count counts nonzero current-chain rows; transaction_count counts all unbilled rows; write_off_count counts pending negative write-offs. The customer list inherits customer_name ASC ordering from the customer service (`src/endpoints/customer/customer-service.js:52`). Eligibility's created_at comparisons use JavaScript timestamp precision, unlike the SQL membership gate. Sources: `src/endpoints/invoice/invoiceEligibility/invoiceEligibility.js:41`, `src/endpoints/invoice/invoiceEligibility/invoiceEligibility.js:92`.

The route recalculates all eligible customers together with showWriteOffs=false; any failure leaves every displayed invoice_total at zero. Latest completed audits are ordered by created_at DESC without an ID tie-break. Matching means saved audit/app balances both exist and abs(difference) < $0.01; it does not establish freshness against today's ledger. Source: `src/endpoints/invoice/invoice-router.js:167`, `src/endpoints/invoice/invoice-router.js:183`.

## 6. Calculations

For each customer, calculateInvoices performs these steps. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:9`.

1. Choose one effective showWriteOffs flag for all calculators. Explicit true/'true' wins; otherwise no unbilled transaction rows plus an invoice-linked pending write-off forces shown mode. hideRetainers=false. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:45`.
2. Sum retained outstanding snapshots into the rolling beginning balance. Do not sum all historical issued amounts. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js:10`.
3. Sum **uninvoiced** gated payments into paymentTotal; all gated payments into paymentsReceivedTotal for display; uninvoiced forms exactly 'Retainer' or 'Prepayment' into retainerPaymentTotal. Linked payments already affected their chain. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:6`.
4. Select latest retainer snapshot per root using exact timestamp text where available, then timestamp milliseconds/ID fallback. Keep is_retainer_active !== false and nonzero current_amount. Sum signed balances; do not automatically draw them. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:3`, `src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:33`.
5. Group transactions by actual job ID. Preserve all rows for later stamping; sum only billable total_transaction. Hidden mode nets pending write-offs into jobs. Uninvoiced write-offs without new work create adjustment-only groups; null job uses General credit. Shown mode leaves job charges gross. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:20`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:52`.
6. Unlinked write-offs reduce the bill. Linked write-offs on the current/newer statement date do not reduce it again. Linked write-offs on older chains are next-bill credits. Missing last/root dates fall back to crediting. Shown mode counts all eligible credits here; hidden mode counts only invoice-linked eligible credits here because unlinked credits are in jobs. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`.
7. writeOffsListedTotal sums printed records, which can differ from writeOffTotal. Shown mode prints all gated write-offs; hidden mode prints invoice-linked ones. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:54`.
8. A separate transaction-retainer diagnostic sums unbilled transactions linked to retainers, including nonbillable rows, and returns a negative absolute total. It does not affect invoiceTotal. Sources: `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js:6`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:4`.
9. **invoiceTotal = outstandingInvoiceTotal + transactionsTotal + paymentTotal + writeOffTotal.** preRetainerInvoiceTotal = invoiceTotal - retainerPaymentTotal; retainerAppliedToInvoice = retainerPaymentTotal; remainingRetainer = retainerTotal. Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:4`.

The engine sums stored transaction totals without re-pricing or six-minute rounding. Sums generally are not rounded after each addition. Persistence rounds monetary invoice columns to cents; PDFs format with toFixed(2). Sources: `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:83`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:8`. Six-minute ingestion/manual-apply calculations are in [billing-review.md](billing-review.md).

### Worked example

Latest balance is $350 after a linked -$50 payment. New work is $120 on job A plus $80 on job B. Pending credits are an unlinked job-A write-off -$20, unlinked cash payment -$30, retainer draw payment -$40 and older-chain write-off -$10. Latest active retainer balance is -$160.

| Component | Hidden write-offs | Shown write-offs |
|---|---:|---:|
| Beginning balance | 350 | 350 |
| Services | (120 - 20) + 80 = 180 | 120 + 80 = 200 |
| Payments affecting new bill | -30 - 40 = -70 | -70 |
| Separate write-offs affecting new bill | -10 | -20 - 10 = -30 |
| Balance due | **450** | **450** |
| Pre-retainer subtotal | 450 - (-40) = 490 | 490 |
| Retainer applied | -40 | -40 |
| Remaining retainer, informational | -160 | -160 |

If the linked -$50 payment passed the gate, displayed Payments Received is -$120, while only -$70 enters the new total. It is already represented in the $350 beginning balance. Formula sources: `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:11`, `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:4`.

**Exception found:** hidden mode also nets invoice-linked write-offs into an existing same-job transaction group. A pure-helper check returned $130 hidden versus $140 shown for $90 already-adjusted beginning balance, $50 new work and an already-applied -$10 write-off. See [F8](../_review/findings.md#f8). Source: `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:74`.

### Returned calculation groups

| Group | Returned fields |
|---|---|
| outstandingInvoices | outstandingInvoiceTotal; outstandingInvoiceRecords (selected invoice rows). |
| payments | paymentTotal, paymentsReceivedTotal, retainerPaymentTotal, paymentRecords and allPaymentRecords (both contain all gated rows). |
| retainers | retainerTotal and retainerRecords (latest active nonzero snapshots). |
| transactions | transactionsTotal; transactionRecords (jobDescription/customerID/jobID/jobTotal/jobWriteOffTotal/jobWriteOffRecords/transactionRecords per group); allTransactionRecords for stamping. |
| writeOffs | writeOffTotal, writeOffsListedTotal, writeOffRecords; allWriteOffRecords is all gated rows in shown mode, but job-linked rows in hidden mode. Finalize does not stamp this collection. |
| transactionRetainerPayments | transactionRetainerPaymentTotal; transactionRetainerPaymentRecords with retainer_id, underlying records and retainerTotal. Diagnostic total is SUM(-ABS(each retainer group's transaction sum)). |
| Top-level totals | customer_id, lastInvoiceDate, invoiceTotal, preRetainerInvoiceTotal, retainerAppliedToInvoice, remainingRetainer. |
| Evidence | `src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:25`, `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:38`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:97`, `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:54`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js:13`. |

invoicesWithDetail adds invoiceNumber, dueDate, billingDate, globalInvoiceNote, invoiceNote, accountBillingInformation, customerContactInformation and companyLogo. skippedCustomers rows contain customer_id, display_name, invoice_number (null for credit skips) and reason. Sources: `src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:119`, `src/endpoints/invoice/invoice-router.js:277`, `src/endpoints/invoice/invoice-router.js:321`.

### Where the retainer draw comes from

For a billable positive transaction explicitly funded by a retainer, the shared transaction writer validates the whole chain belongs to the account/customer. available=round2(max(0,-latest.current_amount)); inactive/empty chains or an amount greater than available are refused. A draw creates a new retainer snapshot with current_amount=round2(previous current_amount+charge), active only while the result is negative. It also creates an uninvoiced payment of -round2(charge), form/reference Retainer, business date from the transaction and an exact draw marker. All of this uses the customer ledger transaction; it happens when work is recorded, not at month-end. Sources: `src/endpoints/transactions/sharedTransactionFunctions.js:117`, `src/endpoints/transactions/sharedTransactionFunctions.js:131`, `src/endpoints/transactions/sharedTransactionFunctions.js:150`, `src/endpoints/transactions/sharedTransactionFunctions.js:200`, `src/endpoints/transactions/sharedTransactionFunctions.js:586`.

Example: a -$200 available balance funding $40 becomes -$160, and a -$40 payment offsets the $40 charge on the next bill. Deducting the remaining $160 again would be wrong. Nonbillable/zero work does not draw. Held-entry apply supplies no retainer and therefore creates no such payment. Source: `src/endpoints/transactions/sharedTransactionFunctions.js:601`, `src/endpoints/billingReview/billingReview-service.js:341`.

## 7. Create, edit and delete

Direct API selection does not require customers.is_customer_active=true; account-owned mailing information and ledger reads still apply. Only the eligibility list filters active customers. Sources: `src/endpoints/invoice/invoice-service.js:233`, `src/endpoints/customer/customer-service.js:1`. Future work is also selected without a date ceiling; see [F14](../_review/findings.md#f14).

Helpers only read. With all output flags false, the route still loads statement/contact/logo detail, but does not export or finalize. Draft/CSV modes generate artifacts. Finalize performs the ledger transaction and absorbs old balances. Full sequence: [month-end-finalize.md](month-end-finalize.md). Source: `src/endpoints/invoice/invoice-router.js:307`, `src/endpoints/invoice/invoice-router.js:342`.

No engine edit/delete API exists. Billed corrections use [billing-review.md](billing-review.md); guarded invoice deletion uses [invoices.md](invoices.md). Sources: `src/endpoints/billingReview/billingReview-router.js:312`, `src/endpoints/invoice/invoice-router.js:59`.

## 8. Invariants, edge cases and test evidence

| Existing spec | Assertions |
|---|---|
| test/endpoints/invoice/engine-units.spec.js | Latest retainer/microseconds; informational retainers; old unbilled work; same-day parents; pending credits; nonbillable stamping; zero invoices; adjustment-only/general credits; common display-mode override; number overflow. Its invoice-linked hidden-mode test uses a different job and misses [F8](../_review/findings.md#f8). |
| test/endpoints/accountAudit/statement-gate.spec.js | Bill-day membership, repeated billing and audit gate parity. |
| test/endpoints/accountAudit/engine-parity.spec.js | Raw-ledger/engine comparisons, issue-time payments and timestamp precision. |
| test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js | HTTP access/scope, eligibility, create modes and envelopes. |
| test/integration/cascade-edit-recompute.integration.spec.js | Engine/audit/AR agreement after billed deltas. |

These are source assertions, not test results from this documentation run.

## 9. Known limitations and open decisions

Missing/cross-customer jobs, missing mailing information, stale unbilled work and duplicate statements need accountant review. The report also records retainer double subtraction and parent-mirror discrepancies. Negative finalized balances are skipped pending a credit/carry-forward decision. Sources: `scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:56`.

Section 6 requires reviewed migrations/backup/cutover, backend before frontend, INTERNAL_CUSTOMER_IDS and BILLING_TIMEZONE=America/Phoenix. Production completion is **not determined from the code**. Source: `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **1 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
