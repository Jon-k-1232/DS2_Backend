# Pass 4 results — actual-screen mistakes and final acceptance

Completed 2026-09-25. **4,210 tests passed, zero failed, zero skipped**, counting each test only in its final full acceptance run. The complete browser run finished with **114 passed** in 10.0m; the CI production build compiled successfully.

The five previously blocked owner-decision browser checks ran first and passed after fixing the focus defect and remote-download harness. The final full browser run includes those five, all 69 original tests and 40 additional mistake cases in five `user-mistakes*.spec.js` files. [Hand-written expectations and corrections](ui-mistakes.md) were recorded before their scenarios ran.

## Counts

| Acceptance group | Files/suites | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Backend unit command | Full recursive unit suite | 1,073 | 0 | 0 |
| Ordinary backend integrations | 40 files, one at a time | 1,139 | 0 | 0 |
| Clean-room npm suite | 1 integration file | 18 | 0 | 0 |
| Scenario npm suite | 40 integration files | 1,602 | 0 | 0 |
| Frontend Jest | 49 suites | 264 | 0 | 0 |
| Complete Playwright suite | 22 files, one worker | 114 | 0 | 0 |
| **Total** | **All 81 backend integration files included once** | **4,210** | **0** | **0** |

The 81 integration files total 2,759 tests. Clean-room and scenario counts are included in that total, not added to it again. Targeted red/green reruns are retained as defect evidence and excluded from the 4,210 acceptance total.

## Scenarios and exact results

- Pending double-clicks on payment, write-off, retainer, charge, time and finalize create one operation. $5 receipts, $2 credits and $25 retainer receipts retain their signed meanings. 0.25 entered hours rounds to 0.3 × $75 = $22.50; quantity 2 × $10 = $20.
- Empty, zero, negative, garbage and excessive values either receive the specified refusal or follow the documented signed-credit normalization. Failed transport requests preserve entered values and save nothing; explicit retries succeed once. Abandoned forms and browser Back never replay a save. Long notes round-trip exactly; August 31 at 11:59 PM saves August 31.
- Two browser sessions prove stale delete/finalize and stale fully-paid invoice refusals, preserving all stored financial rows. Fresh sent work, receipt, write-off and retainer screens show the lock and invoice-history link.
- $22.50 − $50 issues an explicitly selected −$27.50 credit; bulk selection excludes it. $25 + $5 − $10 leaves $20 available; another session's stale $25 refund refuses. Retainer funds remain separate from customer debt.
- Duplicate review covers missing records, required reason/IDs, flag/dismiss history, unchanged-pair conflict, eligible removal and sent-removal refusal. Removing the separate duplicate charge preserves the original work.
- A sent receipt exception requires reason and eligible receipt, permits cancellation before reversal, and adds one +$5 reversal. The issued $17.50 invoice stays unchanged; revision 1 is $22.50 and reopening the original returns identical bytes.
- Both Audit Record print options are printed, listed, reopened byte-identically and verified. Client text has business language, no raw JSON/internal table names, one archive summary for the invoice's two statement copies, and plain verification wording. Full evidence retains itemization. Every page of the 2-page Client record and 4-page Full evidence record was rendered and visually inspected: [Client sample](evidence/pass4/pdf/client.pdf), [Full evidence sample](evidence/pass4/pdf/full-evidence.pdf).
- Audit tests cover invalid ranges/IDs/options, no-match ranges, missing/foreign records, unsupported tampering routes, employee refusal for every Audit operation, manager-page refusal, and read-only super-admin access. Backend suites additionally test real DB immutability, chain tampering, storage/hash/integrity failures, tenant boundaries and transactional rollback.
- 26 real $20 charges produce $520. Page 1 has 20 and page 2 has 6; a no-match filter resets pagination, clearing it recovers the records, and Audit pagination retains $520.
- Cancelling or failing eligible financial deletes preserves every row. Retrying removes only the intended record and restores $22.50 live debt for the pending receipt/write-off examples. A failed retainer linked-payment check keeps Delete unavailable until a successful reload. A $25 retainer funding $20 work leaves $5 available and zero customer debt; the linked root's Delete control is disabled, and the server refuses draw deletion with originating-entry guidance. Every financial row stays unchanged.

The [coverage mapping](ui-mistakes.md#browser-and-backend-refusal-coverage) connects browser checks to the existing lifecycle/what-if/path-matrix tests for validation, permission, tenant, not-found, conflict, lock, database and storage refusal branches. Browser request aborts are transport tests; actual database/storage fault injection runs in the backend scenario suites.

## Defects fixed and regression evidence

| Defect | Smallest correction | Regression evidence |
| --- | --- | --- |
| Grid refresh steals focus from an open customer picker | Removed forced background-search focus in transaction/payment/write-off grids | `GridFocus.test.js`; owner-decision browser checks; `grid-focus-red/green.log` |
| Four financial create forms accept another click while pending | Shared synchronous pending guard and disabled progress button | `FinancialSubmission.test.js`, `useFinancialSubmit.test.js`; five real double-submit browser cases; `double-submit-browser-red.log` |
| Empty/invalid time and charge input can reach the API with fallback values | Required selection/date and finite nonnegative value checks; positive time duration | `FinancialValidation.test.js`, empty-form Jest and browser cases |
| Create failures escape without a durable actionable message | Catch server/network errors and preserve entered values; retain success message | `FinancialSubmission.test.js`; five failure/retry browser cases; `financial-submission-red/green.log` |
| Grid refresh remounts the toolbar and destroys its open form/message | Stable toolbar component with separate props | `DataGrid.test.js`; `dialog-refresh-red/green.log`; retainer submit browser case |
| Stale work deletion throws instead of showing sent-lock/server refusal | Shared guarded submit/error display | `DeleteTimeOrCharge.failure.test.js`; two-session browser test; `stale-delete-and-amount-red/green.log` |
| Detail arrives before lookup arrays and crashes or loses saved identity | Safe lookup defaults and stored-ID fallbacks; sent notice requires no lookup | `SentScreens.test.js`, delayed-detail regression and browser reload; `sent-screens-red/green.log` |
| Sent retainer lock notice incorrectly returned from an effect | Render notice at the component boundary; preserve valid effect cleanup | Four locked-screen Jest/browser checks and clean unmount |
| Invalid retainer-event input shows $NaN or misleading availability | Exact positive-cent validation and meaningful invalid preview | `RetainerEvents.test.js`; adjustment/stale-refund browser case |
| Other financial delete failures are unhandled; retainer API swallows errors | Guarded form submit/catch and propagate retainer failure | `DeleteFinancial.failure.test.js`, `DeleteCalls.failure.test.js`; four cancel/failure/retry browser cases plus used-root/draw refusal; `delete-financial-red/green.log` |
| Retainer dependency lookup failure is treated as no linked payments | Keep Delete disabled, show error and allow reload retry | Three failed-lookup Jest cases and real browser abort/reload; `delete-browser.log` |

All fixes are frontend changes. No backend production code or accounting rule changed during this pass. The backend acceptance run was completed against the current owner-decision implementation.

## Corrected expectations and harness repairs

1. The documented receipt forms accept either sign and store negative magnitude: entering −5 creates one $5 credit, not a reversal. The initial stricter refusal expectation was corrected before those value cases ran.
2. A resolved, unchanged duplicate pair cannot be reflagged: 409 preserves its review. Removal uses a separate unbilled charge; changed-candidate reopening remains covered by backend scenarios.
3. Three original browser assertions predated sent locks. Issued totals/membership and the $22.50 parent remain frozen; later payment/write-off activity gives $15.50 live debt and a +$5 reversal gives $20.50. A fresh sent screen hides Delete; an already-open stale deletion is refused by the server.
4. Remote browser downloads require `download.saveAs`, not server filesystem `download.path`. Required MUI labels include their required marker. Credit-only bulk selection is disabled. Duplicate-removal DB checks now wait for the actual response rather than matching the confirmation warning. A saved retainer event reloads a fresh form, so the next adjustment explicitly selects its type again.

5. The added used-retainer case initially equated work and payment retainer IDs. The documented link keeps the payment's root ID and stores the work's exact draw in `[retainer_draw:N]`. The corrected test asserts both identities and the exact marker, plus root dependency guidance and child deletion refusal, with the same $25 → $5 oracle.

No assertion was weakened to accept incorrect money or a failed operation. The first full browser diagnostic run was 101 passed / 7 failed; all seven were repaired and rerun. Five additional delete/failure cases passed in a complete 113-test run. One more used-retainer case then closed the earlier documented browser gap before the final 114-test run.

## OPEN business questions and scope

**No new OPEN business decision was required by this pass.** The owner's decisions remain authoritative: drafts are editable and write nothing to the ledger; **finalize means sent and locked**. Retainer refunds/adjustments, duplicate review, optional credit statements, six-minute rounding and immutable/readable Audit Records keep their agreed behavior.

Existing UI limits are explicit in the e2e README: transaction-family edit screens and quote CRUD screens are not exposed; the backend APIs are exercised separately. The fixture has an admin and employee, with super-admin screens inspected read-only in account 1; role/tenant combinations are tested in isolated backend scenarios. This is local application evidence, not a production deployment or external email/payment-delivery test.

## Data boundary and preservation

Both checkouts remained on `review/full-audit-2026-09` (read from `.git/HEAD` without invoking git). All operations stayed on loopback PostgreSQL 5433, local MinIO 9000, app ports 3003/8003 and the existing browser server 3334. No AWS/production connection, git command, commit, deployment, application restart or browser-server restart was made. Browser writes used only E2E-prefixed account 9001 fixtures in `ds2_local`; account 1 and `ds2_ref_20260922` were read-only. Existing backend fixture/clean-room commands retained their guarded local targets; all 40 scenario files reset and ran in `ds2_scenarios` through `.env.scenarios` and `test:scenarios`.

The existing idempotent reset/helper/npm script were reused, including schema baseline, clean seed and current migrations through 027. No new backend scenario helper expands their database scope. The added UI safety guard refuses any other host/port/database/MinIO target. Cleanup is tenant/prefix scoped; immutable fixture teardown retains the account's audit event chain. Known objects from the early failed cleanup were recovered from their exact retained local evidence and removed. Normal test cleanup passed; local report/PDF artifacts are deliberately retained.

Final drift: **0 engine-versus-audit differences across 319 active customers; 0 engine-versus-AR differences across 320 customers**. `/tmp/drift.json` retains the requested detailed local snapshot; the report stores only the aggregate summary.

| Account 1 table | Before | After | Reference |
| --- | ---: | ---: | ---: |
| `customers` | 338 | 338 | 338 |
| `customer_transactions` | 39,052 | 39,052 | 39,052 |
| `customer_payments` | 1,005 | 1,005 | 1,005 |
| `customer_writeoffs` | 657 | 657 | 657 |
| `customer_invoices` | 2,253 | 2,253 | 2,253 |
| `timesheet_entries` | 28,255 | 28,255 | 28,255 |
| `users` | 23 | 23 | 23 |

All seven counts are unchanged and equal the reference. [Before](evidence/pass4/account1-before.json), [after](evidence/pass4/account1-after.json), [drift summary](evidence/pass4/drift-summary.json).

## Exact backend counts

Every integration file was run alone. Clean-room and scenario npm scripts each ran their constituent files sequentially. [Machine-readable reports](evidence/pass4/acceptance/summary.json) retain names, environment, start/end times and counts; their neighboring JSON/log files retain each result.

| Suite/file | Passed | Failed | Pending |
| --- | ---: | ---: | ---: |
| `unit` | 1073 | 0 | 0 |
| `analytics.integration.spec.js` | 11 | 0 | 0 |
| `billing-regression.integration.spec.js` | 2 | 0 | 0 |
| `cascade-edit-recompute.integration.spec.js` | 11 | 0 | 0 |
| `coverage-account-users-auth-misc.integration.spec.js` | 200 | 0 | 0 |
| `coverage-billing-review.integration.spec.js` | 31 | 0 | 0 |
| `coverage-downloads-authz.integration.spec.js` | 36 | 0 | 0 |
| `coverage-invoices-audit-ar-analytics.integration.spec.js` | 131 | 0 | 0 |
| `coverage-jobs-masterdata.integration.spec.js` | 124 | 0 | 0 |
| `coverage-payments-pending.integration.spec.js` | 102 | 0 | 0 |
| `coverage-pending-payments-authz.integration.spec.js` | 10 | 0 | 0 |
| `coverage-timetracking-timesheets.integration.spec.js` | 106 | 0 | 0 |
| `coverage-transactions-retainers-writeoffs.integration.spec.js` | 84 | 0 | 0 |
| `finalize-engine.integration.spec.js` | 15 | 0 | 0 |
| `finalize-snapshot.integration.spec.js` | 9 | 0 | 0 |
| `month-end-lifecycle.integration.spec.js` | 19 | 0 | 0 |
| `orchestrator.integration.spec.js` | 7 | 0 | 0 |
| `payment-reversal.integration.spec.js` | 49 | 0 | 0 |
| `pii-leak.integration.spec.js` | 2 | 0 | 0 |
| `review-account-atomicity.integration.spec.js` | 4 | 0 | 0 |
| `review-analytics-identities.integration.spec.js` | 2 | 0 | 0 |
| `review-audit-download.integration.spec.js` | 4 | 0 | 0 |
| `review-audit-filter.integration.spec.js` | 3 | 0 | 0 |
| `review-customer-delete.integration.spec.js` | 4 | 0 | 0 |
| `review-customer-recurring.integration.spec.js` | 8 | 0 | 0 |
| `review-customer-response.integration.spec.js` | 2 | 0 | 0 |
| `review-initial-data-roles.integration.spec.js` | 18 | 0 | 0 |
| `review-invoice-outcomes.integration.spec.js` | 4 | 0 | 0 |
| `review-job-family.integration.spec.js` | 4 | 0 | 0 |
| `review-job-selection.integration.spec.js` | 2 | 0 | 0 |
| `review-pending-files.integration.spec.js` | 7 | 0 | 0 |
| `review-rate-agreements.integration.spec.js` | 10 | 0 | 0 |
| `review-related-ids.integration.spec.js` | 24 | 0 | 0 |
| `review-retainer-dates.integration.spec.js` | 1 | 0 | 0 |
| `review-statement-snapshot.integration.spec.js` | 1 | 0 | 0 |
| `review-template-storage.integration.spec.js` | 1 | 0 | 0 |
| `review-tracker-outcome.integration.spec.js` | 1 | 0 | 0 |
| `review-transaction-policy.integration.spec.js` | 22 | 0 | 0 |
| `review-user-guards.integration.spec.js` | 7 | 0 | 0 |
| `tracker-excel-end-to-end.integration.spec.js` | 33 | 0 | 0 |
| `transactions-ledger-seams.integration.spec.js` | 28 | 0 | 0 |
| `clean-room-regression.integration.spec.js` | 18 | 0 | 0 |
| `path-matrix-01-guards.integration.spec.js` | 437 | 0 | 0 |
| `path-matrix-02-read-failures.integration.spec.js` | 43 | 0 | 0 |
| `path-matrix-03-commit-outcomes.integration.spec.js` | 24 | 0 | 0 |
| `path-matrix-04-admin-controls.integration.spec.js` | 29 | 0 | 0 |
| `path-matrix-05-timesheets.integration.spec.js` | 27 | 0 | 0 |
| `path-matrix-06-pending-payments.integration.spec.js` | 12 | 0 | 0 |
| `path-matrix-07-tracker-storage.integration.spec.js` | 29 | 0 | 0 |
| `path-matrix-08-reports.integration.spec.js` | 11 | 0 | 0 |
| `path-matrix-09-ledger-defenses.integration.spec.js` | 17 | 0 | 0 |
| `path-matrix-10-races-and-review.integration.spec.js` | 14 | 0 | 0 |
| `path-matrix-11-tracker-validation.integration.spec.js` | 20 | 0 | 0 |
| `path-matrix-12-global-errors.integration.spec.js` | 7 | 0 | 0 |
| `path-matrix-13-optional-services.integration.spec.js` | 9 | 0 | 0 |
| `path-matrix-14-response-decoration.integration.spec.js` | 5 | 0 | 0 |
| `path-matrix-15-defensive-faults.integration.spec.js` | 13 | 0 | 0 |
| `path-matrix-16-workbook-and-audit.integration.spec.js` | 10 | 0 | 0 |
| `scenario-lifecycle-01-work.integration.spec.js` | 13 | 0 | 0 |
| `scenario-lifecycle-02-retainers.integration.spec.js` | 9 | 0 | 0 |
| `scenario-lifecycle-03-payments.integration.spec.js` | 7 | 0 | 0 |
| `scenario-lifecycle-04-writeoffs.integration.spec.js` | 6 | 0 | 0 |
| `scenario-lifecycle-05-monthend.integration.spec.js` | 7 | 0 | 0 |
| `scenario-lifecycle-06-cascade.integration.spec.js` | 9 | 0 | 0 |
| `scenario-lifecycle-07-refusals.integration.spec.js` | 122 | 0 | 0 |
| `scenario-lifecycle-08-failures.integration.spec.js` | 24 | 0 | 0 |
| `scenario-lifecycle-09-state-boundaries.integration.spec.js` | 21 | 0 | 0 |
| `scenario-lifecycle-10-integrity.integration.spec.js` | 22 | 0 | 0 |
| `scenario-lifecycle-11-finalize-races.integration.spec.js` | 15 | 0 | 0 |
| `scenario-lifecycle-12-sent-exceptions.integration.spec.js` | 72 | 0 | 0 |
| `scenario-lifecycle-13-retainer-events.integration.spec.js` | 24 | 0 | 0 |
| `scenario-lifecycle-14-duplicates.integration.spec.js` | 23 | 0 | 0 |
| `scenario-lifecycle-15-credit-statements.integration.spec.js` | 11 | 0 | 0 |
| `scenario-lifecycle-16-owner-combined.integration.spec.js` | 4 | 0 | 0 |
| `scenario-lifecycle-17-time-boundaries.integration.spec.js` | 10 | 0 | 0 |
| `scenario-lifecycle-18-audit-record.integration.spec.js` | 32 | 0 | 0 |
| `scenario-what-if-01-values.integration.spec.js` | 308 | 0 | 0 |
| `scenario-what-if-02-retries.integration.spec.js` | 23 | 0 | 0 |
| `scenario-what-if-03-history.integration.spec.js` | 25 | 0 | 0 |
| `scenario-what-if-04-calendar-races.integration.spec.js` | 13 | 0 | 0 |
| `scenario-what-if-05-csv.integration.spec.js` | 13 | 0 | 0 |
| `scenario-what-if-06-boundaries.integration.spec.js` | 82 | 0 | 0 |

## Exact frontend Jest counts

[Full JSON](evidence/pass4/frontend-jest-results.json), [console log](evidence/pass4/frontend-jest-final.log), [successful CI build](evidence/pass4/frontend-build.log).

| Test file (under frontend src) | Passed | Failed | Pending |
| --- | ---: | ---: | ---: |
| `Components/DataGrids/CreateInvoiceGrid.test.js` | 11 | 0 | 0 |
| `Components/DataGrids/DataGrid.test.js` | 1 | 0 | 0 |
| `Components/DataGrids/ExpandableGrid.test.js` | 2 | 0 | 0 |
| `Components/DataGrids/PaginationGrid.test.js` | 2 | 0 | 0 |
| `Components/DataGrids/sentLockColumn.test.js` | 3 | 0 | 0 |
| `Components/Notifications/notificationRouting.test.js` | 5 | 0 | 0 |
| `Components/SentInvoiceNotice.test.js` | 1 | 0 | 0 |
| `Layouts/Drawer/ServerStatus.test.jsx` | 1 | 0 | 0 |
| `Pages/AccountsReceivable/AccountsReceivablePage.credit.test.js` | 1 | 0 | 0 |
| `Pages/Analytics/TaxSeasonCapacityPage.identities.test.js` | 1 | 0 | 0 |
| `Pages/Customer/CustomerProfile/CustomerProfile.payments.test.js` | 1 | 0 | 0 |
| `Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js` | 16 | 0 | 0 |
| `Pages/Customer/CustomerProfile/EditCustomerProfile.test.js` | 8 | 0 | 0 |
| `Pages/Customer/CustomerProfile/RetainerEvents.test.js` | 11 | 0 | 0 |
| `Pages/Invoices/CreateNewInvoice/CreateNewInvoices.finalize.test.js` | 5 | 0 | 0 |
| `Pages/Invoices/CreateNewInvoice/CreateNewInvoices.test.js` | 4 | 0 | 0 |
| `Pages/Invoices/CreateNewInvoice/SubComponents/CreateInvoiceCheckBoxes.test.js` | 4 | 0 | 0 |
| `Pages/Invoices/InvoiceDetails/InvoiceDetails.credit.test.js` | 1 | 0 | 0 |
| `Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js` | 10 | 0 | 0 |
| `Pages/Invoices/InvoiceGrids/InvoicesGrid.test.js` | 1 | 0 | 0 |
| `Pages/Transactions/BillingReview/components/AiSuggestionChip.test.js` | 4 | 0 | 0 |
| `Pages/Transactions/BillingReview/components/CascadeImpactPanel.test.js` | 4 | 0 | 0 |
| `Pages/Transactions/BillingReview/components/HoldReasonBadge.test.js` | 5 | 0 | 0 |
| `Pages/Transactions/BillingReview/tabs/ConsolidatedTab.test.js` | 1 | 0 | 0 |
| `Pages/Transactions/Duplicates/PossibleDuplicates.test.js` | 6 | 0 | 0 |
| `Pages/Transactions/PendingPayments/components/ReviewPaymentDialog.test.js` | 3 | 0 | 0 |
| `Pages/Transactions/TransactionForms/AddTransaction/FinancialSubmission.test.js` | 15 | 0 | 0 |
| `Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/FinancialValidation.test.js` | 37 | 0 | 0 |
| `Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.test.js` | 6 | 0 | 0 |
| `Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/TimeOptions.test.js` | 2 | 0 | 0 |
| `Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/TimeTrackingIncrements.test.js` | 10 | 0 | 0 |
| `Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/useFinancialSubmit.test.js` | 1 | 0 | 0 |
| `Pages/Transactions/TransactionForms/DeleteTransaction/DeleteFinancial.failure.test.js` | 10 | 0 | 0 |
| `Pages/Transactions/TransactionForms/DeleteTransaction/DeleteTimeOrCharge.failure.test.js` | 3 | 0 | 0 |
| `Pages/Transactions/TransactionForms/DeleteTransaction/SentScreens.test.js` | 4 | 0 | 0 |
| `Pages/Transactions/TransactionForms/ReversePayment/ReversePayment.test.js` | 1 | 0 | 0 |
| `Pages/Transactions/TransactionGrids/GridFocus.test.js` | 3 | 0 | 0 |
| `Pages/Transactions/TransactionGrids/PaymentsGrid.test.js` | 3 | 0 | 0 |
| `Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js` | 7 | 0 | 0 |
| `Routes/ManagerAndAdminProtectedAccess.test.js` | 10 | 0 | 0 |
| `Services/ApiCalls/AuditRecordCalls.test.js` | 3 | 0 | 0 |
| `Services/ApiCalls/DeleteCalls.failure.test.js` | 1 | 0 | 0 |
| `Services/ApiCalls/FetchCalls.test.js` | 3 | 0 | 0 |
| `Services/ApiCalls/InvoiceExceptionCalls.test.js` | 4 | 0 | 0 |
| `Services/ApiCalls/LedgerReviewCalls.test.js` | 6 | 0 | 0 |
| `Services/ApiCalls/PendingPaymentsCalls.test.js` | 5 | 0 | 0 |
| `Services/SharedFunctions.test.js` | 7 | 0 | 0 |
| `Services/SharedPostObjects/SharedPostObjects.test.js` | 10 | 0 | 0 |
| `__tests__/App.test.jsx` | 1 | 0 | 0 |

## Exact final browser counts

[Complete list reporter](evidence/pass4/e2e-final.log). All files ran in one final process, one worker, zero automatic retries, using the supplied remote Chromium endpoint. Both required browser variables were set for every Playwright command.

| File | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `tests/account-users.spec.js` | 2 | 0 | 0 |
| `tests/analytics-pages.spec.js` | 3 | 0 | 0 |
| `tests/auth-and-navigation.spec.js` | 23 | 0 | 0 |
| `tests/customer-profile.spec.js` | 3 | 0 | 0 |
| `tests/customers.spec.js` | 1 | 0 | 0 |
| `tests/edit-flows.spec.js` | 2 | 0 | 0 |
| `tests/invoices-quotes.spec.js` | 4 | 0 | 0 |
| `tests/jobs-and-transactions.spec.js` | 1 | 0 | 0 |
| `tests/jobs-list.spec.js` | 2 | 0 | 0 |
| `tests/master-data.spec.js` | 7 | 0 | 0 |
| `tests/month-end.spec.js` | 2 | 0 | 0 |
| `tests/path-matrix-owner-decisions.spec.js` | 5 | 0 | 0 |
| `tests/payments-writeoffs-retainers.spec.js` | 2 | 0 | 0 |
| `tests/read-only-pages.spec.js` | 9 | 0 | 0 |
| `tests/role-matrix.spec.js` | 3 | 0 | 0 |
| `tests/time-tracker-upload.spec.js` | 1 | 0 | 0 |
| `tests/time-tracking-admin.spec.js` | 4 | 0 | 0 |
| `tests/user-mistakes-audit.spec.js` | 6 | 0 | 0 |
| `tests/user-mistakes-decisions.spec.js` | 7 | 0 | 0 |
| `tests/user-mistakes-delete.spec.js` | 6 | 0 | 0 |
| `tests/user-mistakes-financial.spec.js` | 19 | 0 | 0 |
| `tests/user-mistakes-navigation.spec.js` | 2 | 0 | 0 |

## Commands and files changed

Backend: the requested recursive unit command with `.env.local`; every ordinary integration file with the requested mocha bootstrap/180000ms timeout; `npm run -s test:cleanroom`; `npm run -s test:scenarios`. JSON reporting was added for exact counts. The final read-only drift command was `DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js /tmp/drift.json`.

Frontend: `CI=true node_modules/.bin/react-scripts test --watchAll=false --runInBand --json --outputFile=../DS2_Backend/docs/scenarios/evidence/pass4/frontend-jest-results.json`, then `CI=true npm run build`.

Final browser command, from `DS2_Frontend/e2e`:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Frontend/e2e/.browsers \
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3334/ \
npm test -- --reporter=list
```

Source, test and documentation inventory (generated evidence/build outputs are separate):

```text
DS2_Backend/docs/README.md
DS2_Backend/docs/ledger/payments.md
DS2_Backend/docs/ledger/retainers-and-prepayments.md
DS2_Backend/docs/ledger/write-offs-and-adjustments.md
DS2_Backend/docs/scenarios/RESULTS-PASS4.md
DS2_Backend/docs/scenarios/ui-mistakes.md
DS2_Backend/docs/work/transactions.md
DS2_Frontend/e2e/README.md
DS2_Frontend/e2e/lib/db.js
DS2_Frontend/e2e/lib/download.js
DS2_Frontend/e2e/lib/mistakes.js
DS2_Frontend/e2e/lib/scenario-safety.js
DS2_Frontend/e2e/lib/storage.js
DS2_Frontend/e2e/lib/ui.js
DS2_Frontend/e2e/tests/edit-flows.spec.js
DS2_Frontend/e2e/tests/invoices-quotes.spec.js
DS2_Frontend/e2e/tests/path-matrix-owner-decisions.spec.js
DS2_Frontend/e2e/tests/payments-writeoffs-retainers.spec.js
DS2_Frontend/e2e/tests/user-mistakes-audit.spec.js
DS2_Frontend/e2e/tests/user-mistakes-decisions.spec.js
DS2_Frontend/e2e/tests/user-mistakes-delete.spec.js
DS2_Frontend/e2e/tests/user-mistakes-financial.spec.js
DS2_Frontend/e2e/tests/user-mistakes-navigation.spec.js
DS2_Frontend/src/Components/DataGrids/DataGrid.js
DS2_Frontend/src/Components/DataGrids/DataGrid.test.js
DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.js
DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Charge.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FinancialSubmission.test.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/FinancialValidation.test.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/useFinancialSubmit.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/useFinancialSubmit.test.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Retainer.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Time.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/WriteOff.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeleteFinancial.failure.test.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeletePayment.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeleteRetainer.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeleteTimeOrCharge.failure.test.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeleteTimeOrCharge.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeleteWriteOff.js
DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/SentScreens.test.js
DS2_Frontend/src/Pages/Transactions/TransactionGrids/GridFocus.test.js
DS2_Frontend/src/Pages/Transactions/TransactionGrids/PaymentsGrid.js
DS2_Frontend/src/Pages/Transactions/TransactionGrids/TransactionsGrid.js
DS2_Frontend/src/Pages/Transactions/TransactionGrids/WriteOffsGrid.js
DS2_Frontend/src/Services/ApiCalls/DeleteCalls.failure.test.js
DS2_Frontend/src/Services/ApiCalls/DeleteCalls.js
```

Evidence is retained under `docs/scenarios/evidence/pass4/`, including red/green logs, complete final reports, aggregate preservation checks and all six visually inspected PDF pages. This report is also copied to the requested scenario workspace's `output.md`.
