# Month-end finalization

## Owner decision update — 2026-09-25

The successful finalize transaction is the issuance/sent boundary; draft generation is not sent. After parent creation/stamping, capture the exact renderer payload, artifact key and ledger basis into invoice_issues/membership/revision 0/history in the same transaction. Existing issued chains are absorbed by appending zero closing children, never editing their rows. Storage/DB failures before commit leave no issued metadata; concurrent writers serialize on customer locks. New same-day issuance uses the existing explicit rebill rule. [Full contract](invoices.md).

**Owner confirmation (2026-09-25):** a draft run is not sent and writes nothing to the ledger; a finalize run is the same as sending the invoices it issues, and locks them. No separate "mark as sent" step exists or is planned.


## 1. Purpose and UI

Finalization issues rolling statements, links newly billed transactions/payments, absorbs prior statement balances and creates download artifacts. The same Create Invoice page also offers drafts and CSV-only output. Route: `/invoices/createInvoice`; page: `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:17`; output defaults are CSV=true, draft=false, finalize=false. At least one selected customer and one output option are required by the UI, and finalized billing opens a confirmation dialog. Sources: `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:26`, `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:10`, `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:62`.

After success, completed selections are cleared; skipped customer choices remain available. A subsequent download failure is displayed separately from successful finalization. The server also returns committed success plus warnings when the combined ZIP or invoice-list refresh fails; see [F15](../_review/findings.md#f15). Source: `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:85`.

## 2. Access rules

POST requires authentication, account-scoped accountID, and backend role manager, admin, super admin or owner. No self-or-privileged userID check is installed. The created_by user is req.user.user_id with a URL fallback only if absent. Frontend manager gating includes owner. Sources: `src/app.js:138`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/invoice/invoice-router.js:242`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.

## 3. API reference

Unexpected database failure in the role middleware can return HTTP 500 through the global handler. Source: `src/endpoints/auth/jwt-auth.js:77`, `src/app.js:178`.

### POST /invoices/createInvoice/:accountID/:userID

| Item | Contract |
|---|---|
| Method | POST |
| Path | `/invoices/createInvoice/:accountID/:userID` |
| Required body | invoiceConfiguration.invoicesToCreate: nonempty array of unique positive int32 customer_id scalar number/numeric-string values. |
| Optional per customer | showWriteOffs true/'true'; invoiceNote; strict boolean includeCreditStatement (default false); optional nonblank issueReason, max2000 characters; names used in skip messages. No explicit note length/type validation. |
| Optional settings | invoiceConfiguration.invoiceCreationSettings: isFinalized, isRoughDraft, isCsvOnly, allowSameDayRebill (strict JSON booleans), globalInvoiceNote. Absent flags are false. |
| Query/pagination | None consumed. No date parameter: billingDate is computed on the server. |
| Success | HTTP 200 `{invoicesWithDetail,fileLocation,skippedCustomers,invoicesList:{activeInvoiceData},message,status:200}`. A wholly skipped batch has empty detail/fileLocation and succeeds. |
| Authentication/errors | 401 missing/invalid/expired authentication; 403 role/account mismatch; 429 general 300/min limiter; 400 malformed JSON; 413 JSON >1 MB. |
| Handler errors | Actual HTTP400 invalid IDs/options/reason,404 missing/foreign customer,409 concurrent ledger/number/same-day conflict,500 missing mailing data, numbering overflow, schema or PDF/CSV/storage/DB failure. After commit, export/readback failure remains200 with committed=true, IDs/artifact keys and warnings. |
| Evidence | `src/endpoints/invoice/invoice-router.js:236`, `src/endpoints/invoice/invoice-router.js:249`, `src/endpoints/invoice/invoice-router.js:287`, `src/endpoints/invoice/invoice-router.js:389`, `src/app.js:70`, `src/app.js:100`. |

This is the sole contract for compute-only, draft, CSV and final modes. Selection and calculation rules are in [create-invoice-engine.md](create-invoice-engine.md).

| Configuration field | Type, default and validation |
|---|---|
| invoicesToCreate | Required nonempty array. No explicit batch-count ceiling. |
| invoicesToCreate[].customer_id | Positive int32 scalar number/numeric string, unique after conversion; ownership checked before pricing. Account-scoped reads supply authoritative customer data. |
| invoicesToCreate[].showWriteOffs | Optional; true or 'true' selects shown mode. An automatic override is described below. |
| invoicesToCreate[].invoiceNote | Optional individual PDF note; no explicit type/length validation. |
| invoicesToCreate[].display_name / customer_name | Optional labels for skipped-customer messages. Billing contact details come from the database. |
| invoiceCreationSettings | Optional, defaults to {}. |
| invoiceCreationSettings.isFinalized / isRoughDraft / isCsvOnly | Optional strict JSON booleans, default false; strings are refused. |
| invoiceCreationSettings.allowSameDayRebill | Optional, true only for true or 'true'. |
| invoiceCreationSettings.globalInvoiceNote | Optional PDF note; no explicit type/length validation. Global and individual notes render independently; null/undefined become empty strings (fixed [F31](../_review/findings.md#f31)). |
| Evidence | `src/endpoints/invoice/invoice-router.js:243`, `src/endpoints/invoice/invoice-router.js:249`, `src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:45`, `src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js:72`. |

## 4. Data model

| Table/object | Fields read or written |
|---|---|
| accounts | account_id lock; immutable storage_slug and account/logo details for artifact ownership. |
| customers | customer_id/account_id ledger locks, acquired in ascending ID order. |
| customer_invoices | New NULL-parent row with account/customer/contact/creator IDs, invoice_number/date, start_date/end_date, beginning_balance, total_payments, total_charges, total_write_offs, total_retainers, total_amount_due, remaining_balance_on_invoice, paid flag/date, invoice_file_location, notes. Existing chain rows get balance zero and absorption marker. |
| customer_transactions | Selected IDs, account/customer, amount/billable state and NULL invoice link are checked. Only customer_invoice_id is stamped by finalization. |
| customer_payments | Selected uninvoiced payment IDs get customer_invoice_id. Signed amounts stay unchanged. |
| customer_writeoffs | Read for snapshot/fingerprint/calculation; **not stamped or rewritten** by finalization. Timestamp membership advances with the new parent. |
| customer_retainers_and_prepayments | Read for current snapshots/fingerprint; no draw or new retainer history is created here. |
| S3 | Per-customer ZIPs stored on invoice rows; combined final/draft/CSV ZIP key returned to caller. |
| Evidence | `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:70`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:108`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:248`. |

Payments and write-offs remain signed negatives for credits. A parent is the statement; payment/write-off/cascade operations may later append children. Finalize itself creates one new parent per accepted customer, not an opening child. The new parent's notes is NULL; individual/global PDF notes are not persisted in that column. Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:248`, `src/endpoints/invoice/invoice-service.js:509`.

## 5. Read logic

### Snapshot

readBillingSnapshot starts a transaction and makes its first statement `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`. It captures now()::timestamp::text, the ledger fingerprint, account information and fetchInitialQueryItems from that snapshot. It returns and releases the read transaction before PDF generation or writes. Source: `src/endpoints/invoice/createInvoice/billingSnapshot.js:27`.

The fingerprint is per selected customer across five datasets: all payments, write-offs, invoice rows and retainers, plus only unbilled transactions. Each component is `count:md5(string_agg(to_jsonb(row)::text,'|' ORDER BY primary_id))`; missing data uses '0', and the five components are joined with '/'. Hashing whole rows catches edits as well as insertions/deletions. Jobs, contacts and employee rates are not included. Source: `src/endpoints/invoice/invoice-service.js:570`.

The detailed reads/gates are documented in [create-invoice-engine.md](create-invoice-engine.md). The same-day precheck is a separate earlier query for NULL-parent invoices dated billingDate. It is repeated under locks. Sources: `src/endpoints/invoice/invoice-router.js:271`, `src/endpoints/invoice/invoice-service.js:609`.

### Number and contact detail

The service finds the largest numeric suffix for an account's NULL-parent invoice matching exactly INV-currentYear-fiveDigits. addInvoiceDetail increments in customer request order. It requires an active MAILING contact, attaches pay-to/customer detail and logo, applies individual/global notes, and makes the due date billingDate +16 days. Sources: `src/endpoints/invoice/invoice-service.js:140`, `src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:99`.

Logo loading accepts supported PNG/JPEG bytes, authorized storage_slug/app/assets keys or the slug/logo.png fallback; it ultimately uses the local noImage asset when needed. It does not accept an arbitrary foreign S3 logo key. Source: `src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:8`.

## 6. Calculations and dates

billingDate is computed once for the request in BILLING_TIMEZONE, default America/Phoenix. An invalid timezone falls back to server-local date; it does not fail the request. The same date drives invoice_date, due date, invoice-number year, end_date, paid-at-issue date and same-day checking. Archive timestamps use dayjs's server-local clock independently. Sources: `src/endpoints/invoice/billingDate.js:11`, `src/endpoints/invoice/invoice-router.js:259`, `src/pdfCreator/zipOrchestrator.js:16`.

Invoice numbers are INV-YYYY-NNNNN. Incrementing a valid same-year number advances the suffix; a changed year restarts at 00001. The helper refuses more than 99999 rather than widening the field. Malformed/nonconforming stored numbers are not used by the lookup. Sources: `src/endpoints/invoice/sharedInvoiceFunctions.js:42`, `src/endpoints/invoice/invoice-service.js:140`.

Amounts use the engine formula in [create-invoice-engine.md](create-invoice-engine.md). On persistence, each monetary column uses Math.round((Number(value)+Number.EPSILON)*100)/100. Both amount due and remaining equal the rounded engine invoiceTotal. total_payments contains only uninvoiced payments; total_charges can include hidden job write-offs; total_retainers is informational. A rounded zero invoice is marked paid and fully_paid_date=billingDate. Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:8`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:248`.

Example: last number INV-2026-00124 and three accepted customers produce 00125, 00126 and 00127. Billing 2026-09-24 gives due date 2026-10-10. A stored engine total 450.005 is rounded using the JavaScript helper, not a decimal-arithmetic library. Source: `src/endpoints/invoice/sharedInvoiceFunctions.js:42`, `src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:99`.

## 7. Create, edit and delete

### Orchestration order

1. Validate raw configuration/strict booleans/customer IDs/reason, then sanitize and verify account ownership; compute billingDate and a new UUID runID.
2. If finalized and allowSameDayRebill is false, remove customers already having a NULL-parent invoice on that date. Return successful skips if none remain.
3. Take the repeatable-read billing snapshot; calculate invoices. For finalized output, skip negative totals unless that customer explicitly sent includeCreditStatement:true. Nonfinite totals fail. Zero is allowed. Drafts can expose negative totals and remain editable without ledger writes.
4. Enrich contacts/numbering/logo/notes. Whenever any output flag is truthy, generate **both** CSV data and every PDF, even CSV-only mode.
5. For finalized output, run the insertion orchestrator below. After it commits, upload the combined final ZIP.
6. Read the current invoice list and return the detailed results, artifact key and skips.

Sources: `src/endpoints/invoice/invoice-router.js:243`, `src/endpoints/invoice/invoice-router.js:271`, `src/endpoints/invoice/invoice-router.js:307`, `src/endpoints/invoice/invoice-router.js:317`, `src/endpoints/invoice/invoice-router.js:342`.

### Insertion orchestrator and locks

The actual code uploads each customer's PDF ZIP **before** it constructs/validates all new invoice rows and enters the write transaction. The header comment's stronger validation-before-artifacts claim is not the executable order. It validates IDs, uniqueness, finite signed totals with explicit credit selection and a stamping plan; invoice schema checks include required keys, numeric/date/boolean/string types and permitted nulls. Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:32`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:60`, `src/endpoints/invoice/invoiceDataInsertions/schemaValidation/invoiceValidation.js:2`.

Within **one transaction for the accepted batch**:

- Lock the account row FOR NO KEY UPDATE. Then lock each selected customer's account-scoped row FOR NO KEY UPDATE in ascending ID order.
- Recheck same-day billing unless explicitly allowed. If a conflicting concurrent statement appeared, abort the batch rather than turn it into a successful skip.
- Refuse any planned invoice number already present in that account.
- Check for payments/write-offs/invoices created after runStartedAt. Recheck each planned transaction still belongs to the account/customer, is unbilled and has the same rounded amount and billable flag.
- Recompute and compare the complete selected-customer fingerprints. A change aborts before ledger inserts.
- Insert all new parents, absorb old balances, stamp transactions and payments. Require the exact expected update count for each stamping operation. Any failure rolls back these ledger writes together.

Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:70`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:157`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:200`.

The stamp plan includes every selected transaction, including nonbillable rows, but only previously uninvoiced payments. WHERE account/customer/ID and invoice ID NULL protects the update. Finalize does not alter amount/rate/date, consume retainers, stamp write-offs, email customers or send notifications. Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:113`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:124`.

### Absorption and rebilling

For calculated outstanding chain roots, account/customer-scoped old parent/child rows are set to remaining_balance_on_invoice=0 and receive `[absorbed_by:<new number>@<billing date>]`. Paid flags are not changed. The preferred explicit-root path covers same-day older chains; the fallback covers positive balances created strictly before the new parent using an SQL timestamp comparison. The new chain is excluded. Source: `src/endpoints/invoice/invoice-service.js:509`.

allowSameDayRebill=true permits another parent on the same billing date; it does not permit duplicate numbers, stale fingerprints or already-stamped work. There is no persisted billing_runs/idempotency-key table. A UUID distinguishes artifact paths, not a reusable retry transaction identity. Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:76`, `src/endpoints/invoice/invoice-router.js:259`, `scripts/review-2026-09/FINAL_REPORT.md:61`.

### Artifact keys and export modes

The immutable account storage_slug owns artifacts. Each ZIP call makes a server-local MM-DD-YYYY_T_HH_mm_ss timestamp and appends runID. Compression level is 9. Filename-derived display names replace spaces with underscores; PDF ZIP member names are sanitized displayName + `_customer_<customer_id>.pdf`; repeated normalized names get a numeric suffix. Source: `src/pdfCreator/zipOrchestrator.js:16`, `src/utils/createAndSavePDFs.js:8`.

| Mode/key pattern | Contents and side effects |
|---|---|
| `<slug>/invoicing/invoice_images/<timestamp>_<runID>/customer_<customer_id>/<displayName>.zip` | Per-customer PDF ZIP, uploaded before transaction; key stored in the new parent. |
| `<slug>/invoicing/final_invoices/<timestamp>_<runID>/zipped_files.zip` | PDFs; adds CSV when isCsvOnly is also truthy. Created after commit. Finalized mode takes precedence over rough draft. |
| `<slug>/invoicing/csv_report_and_draft_invoices/<timestamp>_<runID>/zipped_files.zip` | Draft PDFs plus CSV; no ledger writes. |
| `<slug>/invoicing/csv_report/<timestamp>_<runID>/zipped_files.zip` | CSV only, although PDFs have already been generated in memory; no ledger writes. |
| `<slug>/invoicing/draft_invoices/<timestamp>_<runID>/zipped_files.zip` | PDFs only; no ledger writes. |
| All flags false | Enriched preview response, no artifact upload or ledger writes. |
| Evidence | `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:225`, `src/endpoints/invoice/invoice-router.js:346`, `src/pdfCreator/zipOrchestrator.js:38`. |

CSV columns start with customer ID/name, beginning balance, payments, transactions, write-offs, retainer and invoice total. The header also has Hold/Send/Mail/Email/Add Note/Adjustment Amount/Reason review columns; data rows populate only the first eight. CSV escaping protects formula-like strings while keeping valid signed numbers numeric. Sources: `src/endpoints/invoice/createInvoiceCsv/createInvoiceCsv.js:26`, `src/endpoints/analytics/csv-util.js:25`.

S3 is outside the database transaction. Failed validation/commit can leave orphan individual ZIPs. Failure of the combined ZIP or final list read after commit returns committed success, saved individual-file identities and a warning to retrieve them from Invoices without re-finalizing ([F15](../_review/findings.md#f15)). There is no S3 cleanup/compensation in this flow. Same-name customer PDFs have distinct ID-qualified archive member names (fixed [F33](../_review/findings.md#f33)). Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:60`, `src/endpoints/invoice/invoice-router.js:355`, `src/pdfCreator/zipOrchestrator.js:56`.

### Edits/deletes after billing

This route does not revise an issued invoice in place. Sent transaction edits and issued-invoice deletion now refuse with HTTP409. A flagged bounced receipt creates a permitted positive reversal, followed by an archived revision package or carry-forward resolution. Unissued edits retain their existing delta-snapshot logic. Original saved PDF ZIPs are never regenerated or overwritten. See [billing-review.md](billing-review.md) and [invoices.md](invoices.md). Sources: `src/endpoints/billingReview/cascadeEdit.js:386`, `src/endpoints/invoice/invoice-router.js:59`.

## 8. Invariants and tests

| Existing spec | What it checks |
|---|---|
| test/endpoints/invoice/billingDate.spec.js | Billing timezone and date boundaries. |
| test/endpoints/invoice/engine-units.spec.js | Stamp plan, parent amounts, zero paid status, invoice year and five-digit overflow. |
| test/endpoints/invoice/createInvoiceCsv.spec.js | CSV financial fields/escaping. |
| test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js | Finalize/preview, same-day behavior, concurrency/validation and route contracts. |
| test/endpoints/accountAudit/statement-gate.spec.js | Entries on billing day and repeated billing are counted once by the membership gate. |
| test/pdfCreator/templateOnePagination.spec.js | PDF row/note/page behavior before any finalize commit. |

The original review was read-only. Subsequent local F14/F15 integration and clean-room results are in the [F8–F22 log](../_review/fixes-F8-F22.md); production was not accessed.

## 9. Known limitations and open decisions

### Accountant review queue recorded in FINAL_REPORT section 3

These are the report's historical findings and amounts, not a new database audit.

| Recorded item | Decision/evidence |
|---|---|
| Same-day statements | Tomo Buncic INV-2026-00188/00189; Robert & Debra Peterson 00202/00203; John & Colleen Cappelli 00068/00069; Caroline Hernandez 00183/00184; also 2024 pairs. Review which are duplicates before any remedy. `scripts/review-2026-09/FINAL_REPORT.md:47`. |
| Bill-day write-offs | 61 write-offs / 28 customers; $8,331.75 supported and $12,208.00 possible double credits. `scripts/review-2026-09/FINAL_REPORT.md:48`. |
| Payment signs | 904 parent candidates included in migration 019's reviewed sign-change manifest; 14 exceptions remain, stored $11,727 versus tagged net -$28,154.50. `scripts/review-2026-09/FINAL_REPORT.md:49`. |
| Mirror discrepancies | Invoice row IDs 2015 (Tomo) and 506 (customer 97). `scripts/review-2026-09/FINAL_REPORT.md:50`. |
| Job links | 5 billable transactions missing jobs ($365); 9 cross-customer links involving KFP/JFK&A. `scripts/review-2026-09/FINAL_REPORT.md:51`. |
| Stale work | 51 customers / about $14,800 unbilled. `scripts/review-2026-09/FINAL_REPORT.md:52`. |
| Retainer double subtraction | Customer 228, INV-2024-00397, remaining $472 includes a second subtraction of a $153 retainer payment. `scripts/review-2026-09/FINAL_REPORT.md:53`. |
| Stored job totals | 151 families, net -$485, range -$275 to +$4; family 1343 stored $1,235 versus recomputed $960. Billing Review now appends whole-family totals under the customer lock; the historical report predates this correction ([F9](../_review/findings.md#f9)). `scripts/review-2026-09/FINAL_REPORT.md:54`. |
| Internal billing | Customers 5 and 6 contain about $1.43 million of internal time labeled billable; configure INTERNAL_CUSTOMER_IDS and decide whether to add an explicit internal flag. `scripts/review-2026-09/FINAL_REPORT.md:55`. |
| Credit/aging policy | Run 3 implements optional signed credit statements and carry-forward. AR buckets still age statements; oldest_open_charge_date is a FIFO estimate. `scripts/review-2026-09/FINAL_REPORT.md:56`. |

The historical report requires accountant decisions for duplicate parents, bill-day write-offs, the 14 excluded sign exceptions, stale parent mirrors, broken job links, stale WIP, retainer double subtraction and job-family totals. The owner decisions now provide optional credit statements/carry-forward, sent-record locks, duplicate review and narrow bounced-payment corrections. Broader period policies, general void/reissue workflows and persisted billing_runs remain outside this implementation. Source: `scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:61`.

Rollout requires backup and reviewed migration rehearsal; 019 then 020 and 021 as described by the migration guide. Apply 020 immediately before the new backend with no account creation in between; deploy backend before frontend. The tracker ownership backfill follows the new backend and requires reviewed manifests. Set INTERNAL_CUSTOMER_IDS and BILLING_TIMEZONE=America/Phoenix. These are recorded rollout requirements, not actions performed here. Source: `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **1 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F14 cutoff: preview, eligibility and finalization include unbilled work through the server billing date (America/Phoenix by default), including stale past work. Future transactions remain unlinked and are eligible on their date; there is no advance-billing option. Regression: `review-invoice-outcomes.integration.spec.js`.


## Owner run 2 — retainers and duplicate review

Migration 024 events participate in the repeatable-read billing inputs/fingerprint. Customer locks serialize refunds/adjustments, duplicate deletion and finalize. Issuance captures event membership and frozen rendering payload; no prior event/retainer row is rewritten. Pending events survive precommit DB/storage refusal and appear on the next successful statement once. Duplicate flags never change totals or authorize finalization edits.

## Run 3 credit selection and errors

A customer with `invoiceTotal < 0` is skipped by finalize unless `invoicesToCreate[].includeCreditStatement === true`. The skip reports `code:CREDIT_NOT_SELECTED` and preserves all pending rows and billing markers. Selection is per customer; no global opt-in. A stale positive grid total never authorizes a newly negative statement. Drafts can show signed credits without the flag. Finalize means sent and locked for both signs.

`issueReason` is optional trimmed nonblank text of at most2000 characters; omission uses a descriptive server reason. Output flags (`isFinalized`, `isRoughDraft`, `isCsvOnly`, `allowSameDayRebill`) and credit selection are strict JSON booleans. Real HTTP statuses are400 for malformed options/IDs,401/403 for session/role/account denial,404 for missing or foreign selected customers,409 for concurrent ledger/number/finalization conflict,500 for DB/storage failures. A committed export/list-refresh failure remains200 with `committed:true` and a warning; never resubmit it.

Migration025 adds immutable `invoice_issues.credit_selection_reason`; session actor, server time, exact signed payload and original artifact are already stored there. The `issued` history detail now carries reason, selection and signed amount; transaction-local actor/reason is set for the ledger writes. A chosen credit issues a normal locked parent with negative remaining, zero payment due, no new credit payment, and paid-in-full=false. Exact carried chains of either sign close once. Tests: scenario15 (selection/refusals/faults),16 (all five decisions),17 (time boundaries), existing finalize race/fault suites.


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.
