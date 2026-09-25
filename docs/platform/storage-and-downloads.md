# Storage and downloads

## Owner decision update — 2026-09-25

Each issued original and revision references a separate immutable artifact key. Revision upload occurs before metadata commit; storage failure preserves pending exception state. A DB failure after successful upload may leave an unreferenced unique object for operator cleanup, never overwrite an original. Reprint uses the existing account-authorized invoice downloader and causes no ledger entry or delivery claim. This run uses only loopback MinIO. [Contract](../invoicing/invoices.md).


Source review: 2026-09-24. Backend-relative citations describe code. `../DS2_Lambdas/Process_Payment_Images/` identifies the separate Lambda repository. No S3 objects, database records or running services were accessed for this document.

## 1. Purpose and UI

DS2 stores original trackers, template versions, company logos, invoice ZIP exports, audit PDFs and payment-source documents in S3. Tracker UI/routes are documented in time-tracking.md. Account settings reads the logo; invoice generation embeds it. Invoice exports appear under `/invoices/*`; payment PDF upload/list/preview appears at `/transactions/pendingPayments` in `Pages/Transactions/PendingPayments/PendingPaymentsPage.js`. Audit PDF controls appear at `/invoices/accountAudit`, in `Pages/AccountAudit/AccountAuditPage.js` and `AuditDetailDialog.js`. Sources: `../DS2_Frontend/src/Routes/PrimaryRouter.js:113`, `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:27`, `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:15`, `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:29`, `../DS2_Frontend/src/Services/ApiCalls/AccountAuditCalls.js:1`.

## 2. Access rules

Invoice export/download and pending-payment file APIs require active JWT identity, own URL account and Manager/Admin/Super Admin/legacy Owner. Audit PDF API requires Super Admin. The generic invoice downloader refuses all audit keys, even for Super Admin; saved audits use the dedicated Super Admin endpoint (fixed [F4](../_review/findings.md#f4)). Company-logo update/information requires Admin/Super Admin. Sources: `src/app.js:138`, `src/app.js:155`, `src/endpoints/accountAudit/account-audit-router.js:37`, `src/endpoints/account/account-router.js:151`, `src/utils/downloadAuthorization.js:40`.

General download authorization accepts only immutable `accounts.storage_slug + '/invoicing/'`. Logo authorization is separate: own slug + `/app/assets/`. A nonempty string must contain no `..` anywhere, leading slash, backslash, residual `%`, ASCII control 0–31 or DEL 127. Bare filenames also cannot contain `/`. Express decodes query strings once; the downloader does not decode them again. Prefix authorization precedes S3 calls. Sources: `src/utils/downloadAuthorization.js:40`, `src/utils/downloadAuthorization.js:78`, `src/utils/downloadAuthorization.js:91`, `src/endpoints/invoice/invoice-router.js:398`.

Tracker history requires its own numeric-owner/exact-key rules, not these invoice prefixes. Payment file preview/delete require a customer_payments_processed row with matching canonical physical filename and own account. Preview requires nondeleted evidence; deletion locks all siblings, including previously dismissed rows, and refuses processed siblings. Unknown and foreign names both return 404. New automatic payment uploads are available **only to account 1** because the backend has a fixed shared prefix and single-account Lambda integration. Sources: `src/endpoints/timeTracking/timeTracking-router.js:240`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`, `src/endpoints/pendingPayments/pendingPayments-router.js:274`.

## 3. API reference

`A=:accountID`, `U=:userID`; all are required paths. U is not file ownership or actor authority on these routes; authenticated identity is used where an actor is recorded. Shared middleware errors: **401** identity, **403** account/role, **429** rate limit; **400** malformed JSON and **413** parser body limit. Unexpected errors are handled as specified per endpoint. Sources: `src/app.js:70`, `src/app.js:100`, `src/endpoints/auth/account-scope.js:7`.

Related contracts: [generation/finalization](../invoicing/month-end-finalize.md#3-api-reference), [audit PDF](../invoicing/account-audit.md#3-api-reference), [payment upload/list/delete/preview](../ledger/pending-payments.md#3-api-reference), [logos](accounts-users-auth.md#3-api-reference) and [trackers](time-tracking.md#3-api-reference).

### Download an authorized export key

| Item | Contract |
|---|---|
| Method/path | `GET /invoices/downloadFile/A/U` |
| Input | Required query fileLocation: nonempty string; trimmed, then authorized. No paging/filter/sort. |
| Success | **200** binary attachment named from key basename, S3 Content-Type/Content-Length when supplied. |
| Errors | **400** missing/nonstring location, missing file, any S3 failure or other outer error; **403** unsafe/unowned key before S3. No 404 for a missing invoice object. |
| Source | `src/endpoints/invoice/invoice-router.js:398` |

This guide owns the generic export-key download contract. Related feature guides own the creation, upload and deletion contracts linked above.

## 4. Data model and S3 layout

| Namespace | Stored data / database reference |
|---|---|
| `{storage_slug}/app/assets/logo.png` or other authorized own assets key | accounts.account_company_logo may point to a custom key. API has no logo-byte upload route. `src/endpoints/account/account-router.js:172`. |
| `{storage_slug}/invoicing/{subarea}/{MM-DD-YYYY_T_HH_mm_ss}_{run UUID}/[customer_ID/]filename.zip` | Subareas final_invoices, draft_invoices, csv_report, csv_report_and_draft_invoices, invoice_images. Individual committed invoice_file_location points to invoice_images/customer_ID ZIP. `src/pdfCreator/zipOrchestrator.js:16`, `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:225`. |
| `account_audits/{accountID}/{customerID}/audit-{auditID}-{ISO timestamp with colon/dot replaced}.pdf` | account_audits.pdf_s3_key/pdf_generated_at plus saved summary, ledger, discrepancies and narrative. Object metadata auditid/customerid. `src/endpoints/accountAudit/account-audit-router.js:208`. |
| `James_F__Kimmel___Associates/time_tracking/tracker_versions/` and `/processed/` | Original templates/raw bytes and gzip tracker originals; tracker_file_owners exact-key ownership. `src/endpoints/timeTracking/timeTracking-router.js:41`. |
| `James_F__Kimmel___Associates/payments/processing_pending/{bare filename}` | Raw uploaded PDF with canonical lowercase .pdf extension; metadata uploaded-by=authenticated ID, account-id, upload-date. Same name targets same object key. `src/endpoints/pendingPayments/pendingPayments-router.js:278`. |
| `James_F__Kimmel___Associates/payments/processed_payments/{month folder}/{filename}` | Lambda archived source; month folder is YYYY_MonthName or unknown_month, derived from beginning filename date, not payment_date. `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:13`. |
| Backend LLM log bucket: `YYYY/MM/DD/HHMMSS_acct<ID>_<feature>_<UUID>.json` | ai_call_log metadata/s3_log_key; no raw prompt by default. `src/ai_integrations/bedrock/audit.js:1`. |
| Lambda LLM log bucket: `YYYY/MM/DD/HHMMSSmicroseconds_<step>.json` | Separate logger, includes first 200 response characters by default, even when raw logging is off. Optional raw content redacted through Comprehend. `../DS2_Lambdas/Process_Payment_Images/llm.py:32`. |

S3 client requires bucket/region/endpoint outside test mode, sets forcePathStyle, uses explicit access/secret only when both exist, otherwise AWS credential chain. ListObjects and ListFolderPrefixes paginate all S3 pages; getObject buffers the entire stream; uploads specify MIME/metadata but no per-call ACL or encryption setting. Template versions additionally use a UUID key and `If-None-Match: *` to prevent overwrites; other put callers retain their existing behavior. Actual bucket policies, encryption, versioning, lifecycle, retention and deployment values are **not determined from the code**. Source: `src/utils/s3.js:1`.

The [pending-payment guide](../ledger/pending-payments.md#4-data-model-and-file-identity) owns extraction-row identity and financial posting. Uploading a file does not post a ledger payment.

## 5. Exact read logic

Generic download reads the own account through accountService's account/address join, obtains storage_slug, validates key/prefix, then fetches exactly one object. It does not look up an invoice_file_location row or check that the object represents a committed final. Consequently an authorized prefix, rather than invoice-row membership, is its boundary. Source: `src/endpoints/invoice/invoice-router.js:398`.

Account settings accepts an authorized saved logo key or the own default key and returns bytes as base64. Invalid/foreign legacy saved keys are ignored. If a valid custom key is missing, settings reports unavailable; it does not retry the default in that branch. PDF logo loading does retry own default, can accept a supported image buffer, and finally loads `src/images/noImage.png`. This can make settings and PDF appearance differ. Sources: `src/endpoints/account/account-router.js:48`, `src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:43`.

[Account audit](../invoicing/account-audit.md#5-read-logic) describes saved-PDF fallback. [Pending payments](../ledger/pending-payments.md#5-read-logic) describes DB-backed file lists and preview lookup. Invoice query membership and timestamp gates are defined once in the [invoice engine](../invoicing/create-invoice-engine.md#5-read-logic).

## 6. Calculations and payment-image extraction

Export rendering uses the [invoice engine calculations](../invoicing/create-invoice-engine.md#6-calculations) and [ledger conventions](../ledger/ledger-conventions.md). Invoice-linked write-offs are excluded from hidden job netting; Show Write Offs changes presentation without duplicating credits ([F8](../_review/findings.md#f8)). Final parent rounding and negative-total handling belong to [finalization](../invoicing/month-end-finalize.md#6-calculations-and-dates).

ZIP compression is level 9 and fully buffered. Object keys include run UUID/customer ID. PDF ZIP members use a sanitized display name and customer ID; a numeric suffix resolves any remaining case-insensitive collision (fixed [F33](../_review/findings.md#f33)). Flags choose output: finalized → final PDFs, plus CSV when isCsvOnly; draft+CSV → both; CSV-only → CSV; draft-only → PDFs. Both CSV/PDF generation are called whenever any export flag is truthy, even CSV-only. Source: `src/pdfCreator/zipOrchestrator.js:16`, `src/pdfCreator/zipOrchestrator.js:56`, `src/endpoints/invoice/invoice-router.js:346`.

The separate [payment-image Lambda pipeline](../ledger/pending-payments.md#6-extraction-matching-normalization-and-calculations) owns OCR, CSV parsing, matching and extraction rules. Its source-file identity and archive failures are documented with that workflow.

## 7. Creation, edits, deletion and side effects

The [finalization sequence](../invoicing/month-end-finalize.md#7-create-edit-and-delete) uploads individual ZIPs before the ledger transaction and the combined ZIP after commit. S3 and PostgreSQL do not share a transaction. A precommit failure can leave an unused individual object. Postcommit export/readback failure returns committed success with saved individual-file identities and warnings ([F15](../_review/findings.md#f15)).

[Audit generation](../invoicing/account-audit.md#7-create-edit-and-delete) persists the audit before its best-effort PDF upload. [Payment-file handling](../ledger/pending-payments.md#7-create-approve-delete-files-and-audit-trail) owns overwrite behavior, queue deletion and archival. Extraction now commits atomically before archival (fixed [F5](../_review/findings.md#f5)). Archive upload and HEAD length verification must succeed before source deletion; failures retain the source and propagate for retry (fixed [F6](../_review/findings.md#f6)). Explicit deletion removes pending and matching archived objects; storage failures are reported and queue flags roll back (fixed [F17](../_review/findings.md#f17)).

## 8. Invariants and test evidence

| Behavior | Inspected tests |
|---|---|
| Own-prefix binary download; foreign/tracker/traversal/double-encoding denial before S3 | `test/integration/coverage-downloads-authz.integration.spec.js:145`; pure checks `test/utils/downloadAuthorization.spec.js:1`. |
| Logo writes/reads require own assets; explicit clearing permitted | `test/integration/coverage-downloads-authz.integration.spec.js:299`. |
| Payment account-1 upload; foreign source preview/delete refused; valid ownership remains usable | `test/integration/coverage-pending-payments-authz.integration.spec.js:214`, `test/integration/coverage-pending-payments-authz.integration.spec.js:244`, `test/integration/coverage-pending-payments-authz.integration.spec.js:282`. |
| Lambda numeric-PII barrier and pending-row normalization/dedup behavior | `../DS2_Lambdas/Process_Payment_Images/tests/test_pii_barrier.py:1`, `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:1`. Added `test/lambda/payment-durability.spec.js` exercises actual Lambda modules with fake DB/S3 failures, rollback, retries and verification (13 passing). |

## 9. Limitations and open decisions

Configured prefixes/IAM/Terraform do not prove an active event notification or successful Lambda processing. Frontend PDF upload supports fewer formats than the Lambda. Numeric-PII redaction keeps customer names for matching, and Lambda response previews are logged; it is inaccurate to describe all Lambda audit content as metadata-only. Sources: `src/endpoints/pendingPayments/pendingPayments-router.js:254`, `../DS2_Lambdas/Process_Payment_Images/config.py:70`, `../DS2_Lambdas/Process_Payment_Images/llm.py:32`.

Storage_slug rollout must precede new code; original shared tracker files need migration 021 plus reviewed ownership backfill. Historical balance/write-off/payment/job decisions and negative credit finalization remain accountant/rollout items; document generation does not settle them. Sources: `scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:69`. See [operations.md](operations.md).

Coverage: **1 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.

Invoice archive downloads additionally return500 with no bytes if recording the reprint fails; source-file validation/missing-file responses retain their existing contract. Both modern revisions and historical parent artifacts are identified without changing original ledger rows.

## Run 5 presentation

Run 5 archives both Client and Full evidence PDFs plus a separate UTF-8 JSON source under the private `audit-records/` prefix. Both objects use unique UUID names and conditional create-only writes. The scoped evidence download verifies key identity, bytes, SHA-256, chain and anchor; generic file download never gains access to this prefix. Metadata never exposes either storage key. See [Audit Record storage and API](audit-ledger.md).
