# Invoicing and reporting findings

Reviewed 2026-09-24. Scope: local source and existing specs. No code fixes, git commands, integration tests, database writes or cloud calls were performed. INV-01 was checked with a pure calculation helper. INV-04 was checked with the notes renderer and an in-memory document stub (no PDF or file generation). Other reproductions below are proposed isolated checks, not claims of executed integration tests.

Priorities: P1 data loss/leak; P2 wrong result; P3 minor. These are specific current-source issues, separate from the accountant/rollout decisions already recorded in FINAL_REPORT.

## INV-01 — P2 — Hiding write-offs can apply an invoice-linked credit twice

**Evidence:** `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:52`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:74`, `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`. The write-off creation path explicitly permits a job link on an invoice-linked write-off: `src/endpoints/writeOffs/writeOffs-logic.js:85`, `src/endpoints/writeOffs/writeOffs-logic.js:125`.

**What happens:** In hidden mode, every pending write-off is grouped by job, including invoice-linked ones. A job with unbilled transactions starts with the sum of all those write-offs. A current-chain write-off has already reduced the beginning balance, and the separate write-off calculator correctly excludes it from new credits. The job calculation nevertheless deducts it again. For an older-chain link, it can instead be deducted in both job total and separate write-off total.

**Reproduction:** Supply a current outstanding snapshot of $90 after a -$10 invoice-linked write-off, plus $50 of unbilled work on the same job. Give the write-off the current linked_chain_invoice_date. calculateInvoices returned $130 with showWriteOffs=false and $140 with true in a pure-helper check. Expected new balance is $140. Existing `test/endpoints/invoice/engine-units.spec.js:206` uses a different write-off job and misses this case.

**Suggested fix:** Exclude invoice-linked rows before all hidden-mode job netting, not just adjustment-only groups. Add same-job current-chain and absorbed-chain cases asserting shown/hidden totals agree.

## INV-02 — P2 — A failed combined download reports failure after invoices have committed

**Evidence:** `src/endpoints/invoice/invoice-router.js:355`, `src/endpoints/invoice/invoice-router.js:389`; commit is inside `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:70`. The frontend returns early for a body status other than 200: `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:85`.

**What happens:** dataInsertionOrchestrator commits parents, absorption and transaction/payment stamps. The route then creates/uploads the batch ZIP and rereads the invoice list. Failure of either later step returns the generic body status:500 with no committed result. Individual invoice ZIPs and ledger changes already exist. A user can reasonably treat the run as failed and attempt a same-day rebill override.

**Reproduction:** In an isolated fixture, allow per-customer ZIP uploads and the database transaction, but fail only the final_invoices S3 upload. Confirm persisted invoice/stamped rows despite the error response. Separately fail the postcommit getInvoices query.

**Suggested fix:** Distinguish committed billing from export/readback failure. Return the committed invoice identities and an artifact warning, retain accessible individual ZIPs and provide retryable export generation. Persist a billing run if durable retries are introduced; do not report the ledger as uncommitted.

## INV-03 — P2 — Billing Review recomputes one job version instead of the job family

**Evidence:** `src/endpoints/billingReview/cascadeEdit.js:281`, `src/endpoints/billingReview/cascadeEdit.js:691`. The normal creator/update path uses all family IDs and appends a new job history row: `src/endpoints/transactions/sharedTransactionFunctions.js:461`.

**What happens:** Cascade editing sums transactions only where customer_job_id equals the edited version and updates that version's current_job_total in place. Job history can have transactions spread across root and children, while the visible latest job remains unchanged. This contradicts the family total maintained by other transaction operations.

**Reproduction:** Root J1 has a $100 transaction; child J2 has $50; latest version J3 displays $150. Use Billing Review to change J1's transaction to $120. J1 becomes $120 and latest J3 remains $150, rather than family total $170. Also check moving work between versions/families.

**Suggested fix:** Reuse a shared, lock-aware family-total operation with correct after-edit semantics and append/update the authoritative latest history consistently. Do not apply the monetary delta twice if summing after the transaction update.

## INV-04 — P2 — Global invoice note disappears unless an individual note is present

**Evidence:** `src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js:72`, `src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js:82`; both notes pass through without defaults: `src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:107`. The global-note UI is `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:194`.

**What happens:** Rendering globalInvoiceNote is nested inside if(invoiceNote). A global note supplied for all customers silently disappears on customers with blank individual notes. Conversely, an API request with an individual note but no global note reaches undefined.length and aborts PDF generation.

**Reproduction:** Generate a draft with invoiceCreationSettings.globalInvoiceNote='Please use the new remittance address' and no per-customer invoiceNote. Inspect the PDF: the message is absent. Then supply invoiceNote but omit globalInvoiceNote and observe renderer failure. An in-memory document stub reproduced both: global-only printed no text; individual-only threw an undefined.length TypeError. No database or PDF output was involved.

**Suggested fix:** Normalize both notes to strings; render the Notes block when either is nonempty, independently drawing each populated value. Test global-only, individual-only, both and neither.

## INV-05 — P2 — Rate agreements trust unscoped customer and forged actor IDs

**Evidence:** `src/endpoints/analytics/analytics-router.js:203`, `src/endpoints/analytics/analytics-router.js:214`, `src/endpoints/analytics/analytics-service.js:351`. Schema has separate account/customer/user foreign keys, not tenant-composite references: `migrations/schema-snapshot-2026-09-22.sql:2026`.

**What happens:** Path accountID is guarded, but body customerId is not checked against that account. An existing customer from another account can be linked to a new agreement under the caller's account. URL userID becomes created_by_user_id without checking it against req.user or account. This creates invalid tenant associations and false creator attribution. No cross-account read disclosure or overwrite of the other account's own rate row was demonstrated, so this is classified P2.

**Reproduction:** As account A's super admin, POST rateAgreement using account A in the URL, an existing customer from B, and another existing user's ID in the userID segment. Use a valid year/rate. The SQL foreign keys allow those independent references and RETURNING exposes the incorrect created row.

**Suggested fix:** Resolve customer by both account_id and customer_id and refuse mismatches; take actor from req.user.user_id. Add positive-integer/finite/range validation and body-reference tenancy/actor tests.

## INV-06 — P2 — Same-name customers collide inside the combined invoice ZIP

**Evidence:** `src/utils/createAndSavePDFs.js:8`, `src/pdfCreator/zipOrchestrator.js:56`, `src/endpoints/invoice/invoice-router.js:349`.

**What happens:** Per-customer S3 keys contain customer IDs, but archive member names are only displayName.type. Two selected customers with the same display name create two members named identically. Typical extraction tools overwrite one or ask to replace it; a batch can appear to contain fewer statements than billed.

**Reproduction:** Supply two PDF buffers with different customerID metadata and identical displayName. Inspect the generated archive directory or extract it into an empty folder: both entries have the same filename. This affects draft and final combined archives.

**Suggested fix:** Include customer ID and/or invoice number in every PDF member name, or give each customer a unique directory. Preserve a human-readable name and test collisions after name normalization.

## INV-07 — P2 — Invoice detail omits retainers created during the statement's ending day

**Evidence:** `src/endpoints/invoice/invoice-router.js:487`, `src/endpoints/retainer/retainer-service.js:20`; finalize stores date-only end_date: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:287`.

**What happens:** The Retainers tab uses created_at <= end_date. PostgreSQL compares the timestamp against midnight at the beginning of the end date. A retainer created at noon on that billing date is omitted even though the billing engine reads all retainer history and can print its balance.

**Reproduction:** Create a retainer snapshot at 2026-09-24 12:00, finalize later that day with end_date=2026-09-24, then read invoice details. The engine/PDF can include it while invoiceRetainers excludes it.

**Suggested fix:** Define whether this tab means history during inclusive business dates or balance as of issuance. For inclusive dates use created_at < end_date + interval '1 day'; for issuance membership use a documented statement timestamp and latest-chain logic. Test the midnight/noon/end-day boundary.

## INV-08 — P3 — Backend owner access is blocked by the frontend manager gate

**Evidence:** `src/endpoints/auth/jwt-auth.js:94` includes owner; `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9` allows only admin/manager/super admin. Invoice and Billing Review routes use this frontend gate: `../DS2_Frontend/src/Routes/PrimaryRouter.js:114`, `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:40`.

**What happens:** A user whose current role is owner can access the backend invoice/AR/Billing Review APIs but sees Unauthorized in the corresponding frontend screens.

**Reproduction:** Use a local owner-role session, navigate to /invoices/invoices or /time-tracking/billingReview and compare the UI with an authorized direct API request using the same account/session.

**Suggested fix:** Align the frontend allowed-role list with the intended backend manager gate, or explicitly change/document the policy on both sides. Test owner along with the existing staff roles.

## INV-09 — P3 — Account Audit accepts ar_60 but does not apply it

**Evidence:** `src/endpoints/accountAudit/account-audit-router.js:60` accepts ar_60. Service quick filters at `src/endpoints/accountAudit/account-audit-service.js:106` and audit-match filters at `src/endpoints/accountAudit/account-audit-service.js:169` implement no ar_60 branch.

**What happens:** A caller asking for filter=ar_60 gets the ordinary eligible customer set, including accounts whose statements are not 60 days old. The accepted parameter silently has no effect.

**Reproduction:** Use eligible customers with 10-day and 80-day latest statements. Compare customers?filter=ar_60 with the same request without a filter; both queries have the same predicates.

**Suggested fix:** Either implement a precisely defined statement-age predicate using current chain semantics, or remove/refuse the unsupported parameter and update the API/UI contract. Test both matching and nonmatching accounts.

## INV-10 — P3 — PDF “Original Amount” repeats the remaining balance

**Evidence:** `src/pdfCreator/templateOne/templateFunctions/templateOneOutstandingCharges.js:18`.

**What happens:** Beginning Balance's Original Amount and Outstanding columns both read remaining_balance_on_invoice. A partially paid invoice no longer displays its original charge, although the heading says it does.

**Reproduction:** Render a statement with an outstanding invoice issued for $100 and currently remaining $60. Both columns print 60.00.

**Suggested fix:** Carry an explicit original issued amount from the root if that is the intended column, or remove/rename the redundant column. Do not substitute a snapshot total without defining what “original” means after adjustments.

## INV-11 — P2 — Future-dated work is excluded from due WIP but finalized today

**Evidence:** `src/endpoints/analytics/analytics-service.js:377` separates future billable work from due WIP and its aging buckets. `src/endpoints/invoice/invoice-service.js:263` selects every uninvoiced transaction without a date upper bound; `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:83` adds every billable selected amount. Finalize stamps all selected transaction IDs: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:113`.

**What happens:** A reviewer can see $0 due WIP and a separate future-dated warning, yet Create Invoice bills that future amount now and stamps it as invoiced. The removal of the old last-bill lower bound correctly recovers stale work, but it also has no billing-date upper bound. This is especially significant for the future-date typos acknowledged in `src/endpoints/analytics/analytics-service.js:308`.

**Reproduction:** Give an account-owned customer a valid job and one unbilled billable $100 transaction dated 2058-01-01. WIP reports due amount $0, future amount $100; today's engine reports $100 new charges, and finalized billing links the transaction to today's invoice.

**Suggested fix:** Keep recovery of old unbilled rows, but define and enforce the billing-date upper bound. If advance billing is intentional, make it an explicit reviewed option and ensure preview/WIP explain that selection. Test stale past work and future work separately.

## INV-12 — P2 — Time reports merge distinct customers or employees sharing a display name

**Evidence:** Customer time allocation groups only c.display_name at `src/endpoints/analytics/analytics-service.js:256`; tax-season capacity groups only u.display_name and week at `src/endpoints/analytics/analytics-service.js:487`. Client-rate and WIP reports instead retain customer IDs: `src/endpoints/analytics/analytics-service.js:59`, `src/endpoints/analytics/analytics-service.js:382`.

**What happens:** Two separate customers with the same display name become one top-20 customer row with combined hours/dollars. Two employees sharing a name become one weekly capacity row. Totals may still add up, but the individual client/staff attribution is wrong and can differ from ID-based reports.

**Reproduction:** Add two same-name customers with 1 and 2 time hours in the selected year: byCustomer returns one 3-hour row. Give two same-name employees 4 and 6 hours in the same tax-season week: capacity returns one 10-hour row.

**Suggested fix:** Group by stable customer_id/user_id plus display name and return the ID. Keep distinct identities through CSV/UI rendering, with a secondary disambiguating label where needed. Test duplicate names.

## Output summary

Files written: 8 feature documents under ../invoicing/ (create-invoice-engine.md, month-end-finalize.md, invoices.md, billing-review.md, accounts-receivable.md, account-audit.md, analytics.md, pdf-statements.md), plus this findings file. **37 distinct endpoints covered; 12 findings (9 P2, 3 P3; no P1 established).** No application code was modified.
