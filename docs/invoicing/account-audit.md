# Account audit

## Owner decision update — 2026-09-25

Audit reads `sent_locked` from the SQL lock function. For issued parents, a different latest-child balance is expected and is no longer `stale_parent_remaining`; paid-flag consistency uses the latest child. Unissued legacy mirrors retain their old diagnostic. Absorption markers on new closing children preserve chain detection. No arithmetic is changed: Audit balance equals Create Invoice; its billed component equals AR. Bounced reversals contribute once. [Contract](invoices.md).


## 1. Purpose and UI

Account Audit independently recomputes customer balances from raw ledger rows, compares them with the billing engine, records discrepancies and saves an audit report/PDF. UI route `/invoices/accountAudit` uses AccountAuditPage, AuditDetailDialog and AuditPrintView in `../DS2_Frontend/src/Pages/AccountAudit/`. The route has an auditor gate. The page polls a batch every two seconds and initially hides customers whose saved app balance is zero or missing. Sources: `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:28`, `../DS2_Frontend/src/Pages/AccountAudit/AccountAuditPage.js:66`, `../DS2_Frontend/src/Pages/AccountAudit/AccountAuditPage.js:200`.

An audit is a stored observation, not an automatic repair. The independent logic does not import invoice calculators; a separate engine call supplies the comparison. Source: `src/endpoints/accountAudit/account-audit-logic.js:673`, `src/endpoints/accountAudit/account-audit-router.js:137`.

## 2. Access rules

All /accountAudit routes require authentication and the exact role `super admin`. manager, admin and owner do not satisfy this role gate. enforceAccountId still requires the URL account to match the authenticated account; super admin does not bypass tenancy. userID has no self-only check and does not determine the stored auditor; req.user does. Sources: `src/app.js:165`, `src/endpoints/accountAudit/account-audit-router.js:6`, `src/endpoints/accountAudit/account-audit-router.js:37`, `src/endpoints/auth/jwt-auth.js:91`, `src/endpoints/auth/account-scope.js:7`.

Shared failures: HTTP 401 missing/invalid/expired/unresolvable login; 403 role/account mismatch; 429 general 300/minute limiter and an additional 30/minute limiter for mutations; malformed JSON 400 and >1 MB 413. Sources: `src/app.js:70`, `src/app.js:100`, `src/app.js:111`, `src/app.js:165`.

Audit PDFs are available only through the dedicated Super Admin route. The generic invoice download route refuses the audit namespace for all roles; `review-audit-download.integration.spec.js` checks identical saved bytes through both surfaces (fixed F4). Source: `src/utils/downloadAuthorization.js:40`.

## 3. API reference

Unexpected database failure in the role middleware can return HTTP 500 through the global handler. Source: `src/endpoints/auth/jwt-auth.js:77`, `src/app.js:178`.

All required accountID/userID path segments are scoped as above. auditID/customerID are Number-converted where used; no separate positive-integer validator exists in these handlers. Sources: `src/endpoints/accountAudit/account-audit-router.js:339`, `src/endpoints/accountAudit/account-audit-router.js:425`.

### GET /accountAudit/whoami/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountAudit/whoami/:accountID/:userID` |
| Inputs | No query/body. |
| Success | HTTP 200 {status:200,auditor:{user_id,display_name,access_level}} from authenticated user. |
| Errors | Shared authentication/account/role/rate errors. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:40`. |

### GET /accountAudit/customers/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountAudit/customers/:accountID/:userID` |
| Query | page, limit, search, filter, sort, direction, hideZeroAppBalance; rules below. |
| Success | HTTP 200 {status:200,customers,pagination:{page,limit,totalCount,totalPages}}. totalPages has a minimum of 1 even with no rows. |
| Customer shape | customer_id, display_name, business_name, is_commercial, last_audit_at/id/balance, last_app_invoice_total, last_balance_difference, last_discrepancy_count. Missing audit fields remain null. |
| Errors | Shared errors; HTTP 500 listing/query errors with client-safe message/status. Numeric paging is clamped rather than rejected with 400. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:52`. |

| Query field | Validation/default |
|---|---|
| page | max(1,Number(value) or 1), without an integer check. |
| limit | min(200,max(1,Number(value) or 25)), without an integer check. |
| search | String-converted, trimmed in service. Searches names via LOWER LIKE and exact ID text. |
| filter | billing_ready, needs_audit, matched, mismatched. ar_60 is explicitly refused with HTTP 400 and guidance to use the Accounts Receivable aging report; other unrecognized values become null (fixed [F38](../_review/findings.md#f38)). |
| sort | customer_id, display_name, last_audit_at, last_audit_balance, last_app_invoice_total, last_balance_difference. Default display_name. Difference sorts by absolute magnitude. |
| direction | Case-insensitive desc, otherwise asc. Tie-break customer_id ASC; audit fields NULLS LAST. |
| hideZeroAppBalance | true only for true/'true'/'1'. HTTP default false, although the UI sends true initially and service's standalone default is true. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:55`, `src/endpoints/accountAudit/account-audit-service.js:198`. |

### POST /accountAudit/run/:accountID/:userID

| Item | Contract |
|---|---|
| Method | POST |
| Path | `/accountAudit/run/:accountID/:userID` |
| Body | customer_ids required nonempty array, maximum 200 **before** conversion. Items map Number and retain finite values. Positive/integer/uniqueness checks are absent; duplicates can be audited twice and all invalid strings can leave zero IDs. notes optional, defaults null, no explicit text/length validation. |
| Success | HTTP **200**, {status:200,job_id,total}; processing continues asynchronously. This is not a completed-audit response. |
| Errors | Shared errors; HTTP 400 missing/nonarray/empty customer_ids or >200 original items; 500 startup failures. Per-customer failures are returned later in job results. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:278`. |

### GET /accountAudit/job/:jobId/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountAudit/job/:jobId/:accountID/:userID` |
| Inputs | Required opaque jobId; no query/paging. |
| Success | HTTP 200 {status:200,job_id,processing_status,total,done,results,created_at,completed_at,error}. Completed result rows carry customer_id, audit_id, audit_balance, app_invoice_total, unrounded balance_difference, strict_ledger_balance, discrepancy_count, pdf_available, narrative_available and created_at; failed rows carry customer_id, error and audit_id if failure persistence succeeded (`src/endpoints/accountAudit/account-audit-router.js:239`). processing_status is processing/complete/failed. |
| Errors | Shared errors; 404 for missing, expired or another account's job, same message for all. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:321`. |

### GET /accountAudit/audit/:auditID/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountAudit/audit/:auditID/:accountID/:userID` |
| Inputs | Required auditID; no query/paging. |
| Success | HTTP 200 {status:200,audit}. Returns all stored audit columns, Number-converted monetary fields, parsed summary/ledger/discrepancies/narrative lists, balance_difference=rounded(audit_balance-app_invoice_total) or null. |
| Errors | Shared errors; 404 unknown/foreign audit; 500 DB/JSON conversion failure. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:339`. |

### GET /accountAudit/audit/:auditID/pdf/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountAudit/audit/:auditID/pdf/:accountID/:userID` |
| Inputs | Required auditID. No client-supplied S3 key. |
| Success | HTTP 200 application/pdf, inline filename audit-ID.pdf. Fetch saved object, or rebuild from the stored audit if missing/unreadable. |
| Errors | Shared errors; 404 unknown/foreign audit; 500 fallback rendering/data failure. An S3 failure alone does not fail the request if rebuild succeeds. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:382`. |

### GET /accountAudit/customer/:customerID/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/accountAudit/customer/:customerID/:accountID/:userID` |
| Inputs | Required customerID, no paging/search/sort. |
| Success | HTTP 200 {status:200,audits:[...]}, created_at DESC. Empty array when no account-scoped audits, including an unknown/foreign customer ID. |
| Row fields | audit ID/time/actor/status; audit/app/difference/strict/outstanding/unbilled/total amounts; discrepancy_count, notes, narrative, pdf_available and error_message. Full ledger/summary are omitted. |
| Errors | Shared errors; HTTP 500 query/conversion errors. No customer-not-found 404 here. |
| Evidence | `src/endpoints/accountAudit/account-audit-router.js:425`. |

## 4. Data model

| Table | Reads/writes |
|---|---|
| customers | Account-owned customer identity/names/commercial/active. Listing is active-only; a direct run can audit an inactive account-owned customer. |
| customer_invoices | All root/snapshot rows: IDs, parent, business/creation dates, signed component totals, remaining, paid flags and notes markers. |
| customer_payments | All rows including unlinked payments, retainer draws and positive reversals; payment_date and exact created_at. |
| customer_writeoffs | All signed amounts and links/dates/notes; audit generally expresses credit magnitudes as positive ABS. |
| customer_transactions | All totals, billable flags, dates and invoice/job links, including rows missing jobs. |
| customer_retainers_and_prepayments | Entire root/snapshot history, current/starting balances, active state and cancellation notes. |
| account_audits | IDs/account/customer/actor; status; NUMERIC(12,2) totals; discrepancy_count; JSONB discrepancies/ledger/summary; notes/error; created_at; narrative text/lists/model/cost/request ID; pdf_s3_key/generated_at; app_invoice_total/app_balance_error. |
| Evidence | `src/endpoints/accountAudit/account-audit-service.js:8`, `migrations/schema-snapshot-2026-09-22.sql:44`. |

The audit reads `absorbed_by:` markers and `[cancelled by reversal of payment #...]` retainer markers. It never appends ledger correction markers or changes balances. Sources: `src/endpoints/accountAudit/account-audit-logic.js:166`, `src/endpoints/accountAudit/account-audit-logic.js:577`.

## 5. Read logic

Customer listing begins with account-owned active customers. Without search, require any open nonzero signed NULL-parent invoice or any unbilled billable transaction. Searching lifts this activity gate, but not the active-only gate. billing_ready means an open parent exists; it can include a stale older parent. needs_audit means a transaction created after the most recent completed audit (or 1970). It does not detect payments, write-offs, edits or deletes since an audit. Source: `src/endpoints/accountAudit/account-audit-service.js:53`.

Left join latest completed audit using DISTINCT ON customer, created_at DESC then audit_id DESC. matched requires both saved balances and abs(difference)<0.01; mismatched requires >=0.01. hideZeroAppBalance requires a nonnull saved app total with abs(total)>=0.01, so never-audited customers disappear too. Count and page are separate reads, not an audit snapshot. Source: `src/endpoints/accountAudit/account-audit-service.js:146`.

Each batch customer gets a separate **REPEATABLE READ READ ONLY** transaction. Fetch customer and all five ledger datasets, independently calculate the audit, then run fetchInitialQueryItems/calculateInvoices in a savepoint within the same snapshot. Engine failure records a nullable app total and error text, without losing the independent audit. Release the read transaction before external narrative/PDF/persistence work. Source: `src/endpoints/accountAudit/account-audit-router.js:126`.

Raw reads filter both account and customer, with no period or active-row exclusion. Invoices order invoice_date ASC then ID; payments/write-offs/transactions order their business date ASC then ID; retainers order created_at ASC then ID. Invoice/payment/write-off/retainer reads also select created_at::text for microsecond ordering. Source: `src/endpoints/accountAudit/account-audit-service.js:18`.

Stored audit detail/history read account_audits by account plus audit/customer ID; history order is created_at DESC with no ID tie-break or limit. Source: `src/endpoints/accountAudit/account-audit-service.js:243`.

## 6. Calculations

### Chains, gates and per-invoice reconciliation

Root grouping uses parent_invoice_id || own ID; snapshots are sorted by exact timestamp and ID, with legacy self-parent support. Last statement date and newest marker are separate concepts. The marker orders invoice date, exact created_at and ID; membership is strictly after its created_at, with legacy date fallback. Sources: `src/endpoints/accountAudit/account-audit-logic.js:47`, `src/endpoints/accountAudit/account-audit-logic.js:130`, `src/endpoints/accountAudit/account-audit-logic.js:143`.

For each chain, collect payments/write-offs/transactions linked to any chain ID. Payments linked directly to the parent and created at/before its issue timestamp are issue-time payments already included in parent.total_amount_due. Exclude those from post-issue payment subtraction. Positive payment reversals reduce paid-against. expected_remaining = parent.total_amount_due - post_issue_net_paid - ABS(linked write-offs). actual_remaining is the latest snapshot, or root if no child. Drift = expected - actual. Source: `src/endpoints/accountAudit/account-audit-logic.js:166`.

Example: parent due $80 already includes an issue-time -$20 payment. Later -$30 payment and -$10 write-off imply remaining $40, not $20. Source: `src/endpoints/accountAudit/account-audit-logic.js:166`.

### Current audit balance

1. Sum signed latest balances for chains whose parent invoice_date is the latest statement date. Earlier nonzero chains of either sign are stale_rolled_forward, not added again. Same-date nonzero live chains are summed and flagged when multiple.
2. Sum all unbilled billable work for diagnostics; for current billing parity, use work through the billing date with a truthy job ID and group by that job. Future work remains in lifetime diagnostics. F14 regression: `test/endpoints/accountAudit/review-future.spec.js`.
3. Among statement-gated, uninvoiced write-offs, net job credits against corresponding unbilled groups; credit the others as adjustment-only write-offs.
4. unbilled_payments = negative of the signed sum of gated payments with no invoice link.
5. invoice_linked_writeoffs_recent = ABS sum of gated write-offs linked to older statement-date chains. Missing chain/date falls back to crediting. Current-date linked write-offs are already in remaining balances.
6. audit_balance = round2(outstanding + unbilled_work_on_jobs - job_writeoffs_netted - adjustment_writeoffs - unbilled_payments - old_chain_writeoff_credits).
7. unbilled_writeoffs is currently fixed to 0, so strict_ledger_balance = audit_balance. Keep the separate field for historical/alternative formula compatibility.

Sources: `src/endpoints/accountAudit/account-audit-logic.js:715`, `src/endpoints/accountAudit/account-audit-logic.js:780`, `src/endpoints/accountAudit/account-audit-logic.js:867`, `src/endpoints/accountAudit/account-audit-logic.js:883`, `src/endpoints/accountAudit/account-audit-logic.js:907`.

For outstanding $350, job work $200, job credits $20, adjustment credits $5, unlinked payments $70 and old-chain credits $10: audit balance = 350+200-20-5-70-10 = $445. [F8](../_review/findings.md#f8) is fixed; missing-job join differences can still cause discrepancies. The independent audit does not prove parity by definition.

### Lifetime and retainer metrics

total_invoiced sums issued NULL-parent amount due, including repeated rolling beginning balances. total_paid = -SUM(signed payments), net of positive NSF reversals. total_writeoffs = SUM(ABS(writeoff_amount)). total_transactions includes nonbillable values; total_billable_transactions does not. net_position_lifetime = total_invoiced + all unbilled billable - total_paid - total_writeoffs. This lifetime diagnostic is not current AR and can count rolled balances repeatedly. Source: `src/endpoints/accountAudit/account-audit-logic.js:685`, `src/endpoints/accountAudit/account-audit-logic.js:927`.

Retainers select latest exact-timestamp/ID snapshot per chain. An orphan chain uses its earliest available snapshot as the starting row and flags it. Cancellation-by-reversal markers exclude the chain from prepaid/available/drawn totals. Starting/current magnitudes are absolute; drawn=start-current; available counts only active latest snapshots. net_position_after_retainer = audit_balance - available, informational only. Source: `src/endpoints/accountAudit/account-audit-logic.js:577`, `src/endpoints/accountAudit/account-audit-logic.js:934`.

### Discrepancy rules

Audit severities below are its info/low/medium/high labels, distinct from documentation finding priorities P1/P2/P3.

| Kind | Trigger and severity |
|---|---|
| duplicate_same_day_parent_invoices | More than one live parent on newest date; medium. |
| stale_rolled_forward_balance | Older chain of either sign still holds more than$0.009 in magnitude after a newer statement; info. |
| writeoff_on_paid_invoice | Pending linked write-off targets a paid invoice; info, requiring accountant judgment. |
| invoice_remaining_drift | abs(expected-actual)>=0.01, except deliberately absorbed zero chains. Positive drift can consume a pool of historical uninvoiced job-write-off magnitudes, oldest invoices first. Fully explained drift is info; unexplained amount sets severity. This is a heuristic, not a causal allocation record. |
| stale_parent_remaining | Positive-due parent differs from latest by >=0.01, except absorbed-zero chains; medium. |
| paid_flag_mismatch_open | Paid flag true but absolute latest remaining >0.009; amount-based severity. |
| paid_flag_mismatch_closed | Paid flag false, absolute latest remaining <=0.009 and original due positive, not deliberately absorbed; low. |
| writeoff_exceeds_invoice | Linked write-off magnitude > amount due +0.01; high. |
| unlinked_payments | Any invoice-unlinked payments, including historical rows; one low, multiple medium. |
| unbilled_pre_bill_transactions | Billable unbilled transaction date strictly before last bill date; medium. The description's on/before wording is broader than the predicate. |
| Amount severity | Unexplained absolute amount <1 info; <50 low; <500 medium; otherwise high. |
| Evidence | `src/endpoints/accountAudit/account-audit-logic.js:257`, `src/endpoints/accountAudit/account-audit-logic.js:334`, `src/endpoints/accountAudit/account-audit-logic.js:418`. |

### Chronological ledger

Billable transactions create charges; nonbillable transactions contribute zero. Negative payments are credits, positive reversals are charges; write-offs use absolute credit amounts. Parent invoices and root retainer establishment are zero-value informational events. Sort business date then event type (retainer, transaction, invoice, payment, write-off); update running balance rounded to cents after each event. This transaction-based running ledger is separate from rolling invoice totals. Source: `src/endpoints/accountAudit/account-audit-logic.js:441`.

## 7. Create, edit and delete

The in-memory job is keyed by generated job ID and owning account. Customers run sequentially; each gets its own snapshot and persisted audit. Missing customers add a failed result without a saved audit. Other errors try to insert a failed audit with capped error text. A batch can finish processing_status=complete while some result rows failed. Finished jobs are removed after two hours; restarts or another server process lose access to that Map. Sources: `src/endpoints/accountAudit/account-audit-router.js:112`, `src/endpoints/accountAudit/account-audit-router.js:126`, `src/endpoints/accountAudit/account-audit-router.js:239`, `src/endpoints/accountAudit/account-audit-router.js:278`.

After the snapshot, optional Bedrock narration sends compact customer/totals/methodology/per-invoice/retainer/discrepancy data, not the full chronological ledger. Model selection: BEDROCK_MODEL_AUDIT, then BEDROCK_MODEL_TIMETRACKER_FAST, then the configured Haiku default; fallback BEDROCK_MODEL_TIMETRACKER or the configured Sonnet default. maxTokens=900, temperature=0.1, feature account_audit_narrative. It records model/cost/request ID and returns null on failure; narration never controls audit arithmetic. Sources: `src/endpoints/accountAudit/account-audit-narrative.js:5`, `src/endpoints/accountAudit/account-audit-narrative.js:17`, `src/endpoints/accountAudit/account-audit-narrative.js:60`.

Insert account_audits status completed with authenticated actor, totals, serialized JSON, comparison and optional narrative. Render PDF and upload `account_audits/<accountID>/<customerID>/audit-<auditID>-<ISO timestamp with colon/dot replaced>.pdf`, metadata auditid/customerid. Then update pdf_s3_key/pdf_generated_at. PDF/upload failure is logged; the audit remains completed. DB persistence, Bedrock and S3 are not atomic together. Source: `src/endpoints/accountAudit/account-audit-router.js:168`, `src/endpoints/accountAudit/account-audit-router.js:208`.

PDF download first tries the saved key, then reconstructs from the **saved** summary/ledger/narrative; it does not re-audit live data or persist a replacement object. There are no audit edit/delete/repair endpoints and no ledger mutations or billing notifications. Source: `src/endpoints/accountAudit/account-audit-router.js:382`.

### Audit PDF layout

The audit PDF is LETTER, margin 36, buffered pages. It prints customer/auditor/time; optional narrative/findings/actions; lifetime totals; signed audit-balance breakdown and strict-ledger step; retainer totals/history; methodology; per-invoice breakdown; discrepancies; chronological ledger. Per-invoice/discrepancy/ledger sections each start new pages. Sources: `src/endpoints/accountAudit/account-audit-pdf.js:82`, `src/endpoints/accountAudit/account-audit-pdf.js:228`, `src/endpoints/accountAudit/account-audit-pdf.js:272`.

Current signed breakdown lines sum to the balance. Legacy stored summaries lacking those lines rebuild from available fields and print an explicit residual adjustment; strict-ledger difference gets a legacy label where appropriate. Source: `src/endpoints/accountAudit/account-audit-pdf.js:37`.

Retainer rows advance 12 points and break after y>740, invoice rows 14 points after y>720, ledger rows 10 points after y>740. These fixed-row tables do not repeat column headers on manually added continuation pages. Retainer descriptions/form strings and ledger descriptions are truncated; this is not templateOne's measured-row paginator. Source: `src/endpoints/accountAudit/account-audit-pdf.js:193`, `src/endpoints/accountAudit/account-audit-pdf.js:247`, `src/endpoints/accountAudit/account-audit-pdf.js:311`.

## 8. Invariants and tests

| Existing spec | Assertions |
|---|---|
| test/endpoints/accountAudit/engine-parity.spec.js | Independent engine parity scenarios, issue-time payment handling, exact timestamp ordering and retainers. |
| test/endpoints/accountAudit/statement-gate.spec.js | Same-day and repeated-statement gate behavior. |
| test/endpoints/accountAudit/audit-pdf-breakdown.spec.js | Current signed breakdown and legacy residual/strict-ledger lines add up. |
| test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js | Super-admin/account scope; batch run/poll/results; detail/history/PDF; comparison fields and cross-account job denial. |
| test/integration/cascade-edit-recompute.integration.spec.js | Audit versus engine/AR after billed edits. |

The original review inspected tests; subsequent local regression and drift results are in the [F8–F22 log](../_review/fixes-F8-F22.md). Saved matched status is historical; it is not independent proof that the current ledger remains matched.

## 9. Known limitations and open decisions

The unsupported ar_60 filter is refused with HTTP 400 (fixed [F38](../_review/findings.md#f38)); freshness only detects newly created transactions; active-only listing can hide inactive debtors; jobs are not durable across process changes. Source: `src/endpoints/accountAudit/account-audit-service.js:53`, `src/endpoints/accountAudit/account-audit-router.js:112`.

FINAL_REPORT section 3 identifies specific duplicate parents, bill-day write-offs, sign exceptions, mirror desynchronization, broken jobs, stale WIP, retainer double subtraction, stale job totals and internal billing. Audit discrepancy text is advisory; delete recommendations still face invoice delete guards. Accountant decisions and rollout status are **not determined from the code**. Follow section 6's reviewed migration/backup/cutover sequence and environment settings. Sources: `scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **7 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).


## Owner run 2 — retainers and duplicate review

The snapshot reader includes `retainer_events`. The chronological ledger prints refund/adjustment amount, availability before/after and evidence as zero-charge/zero-credit informational entries. Retainer summary separately reports refunds and net adjustment credit; drawn-to-date excludes those events. Current credit follows the latest retainer snapshot. Audit debt and engine comparison remain unchanged. Duplicate review has no balance effect until an existing guarded deletion core commits; then the next audit recomputes from surviving ledger rows.

## Run 3 signed statement credits

Outstanding invoices now sum the latest signed balances of the newest-date chains. A negative balance is credit, not paid-in-full; exactly zero is paid. Credit customers appear in the default/billing-ready customer gate. Zero-only settled chains do not create duplicate-debt findings. No-write-off negative statements do not trigger writeoff-exceeds-invoice; actual excess invoice-linked write-offs remain checked. Saved audit totals/PDFs and engine comparisons use the signed result. Migration025 selection evidence remains frozen with the issued statement. Scenario15 and the combined scenario16 assert zero differences at each transition.


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.

Pass 3 verifies optional comparison/PDF-store failures independently of numerical audit completion. An unavailable stored PDF may be rebuilt; if rendering also fails, the response is JSON 500. PDF headers are set only after bytes are ready, so error JSON is never mislabeled as a PDF. Failed audit recording cannot create partial financial writes. See `path-matrix-08-reports.integration.spec.js`.
