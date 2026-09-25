# DS2 owner decisions — run 6 client-record polish

Completed locally on 2026-09-25. Both requested presentation changes are implemented. **Drafts remain editable; finalize means sent and locked.** No open business questions were introduced.

## Built and retained

- **Client record PDF and matching Audit Record tab:** archived statement copies are summarized once per posting/invoice/revision, with invoice/action, total and business-kind counts, the exact covered-change count and change numbers, and “Itemized in the full evidence record.” Reversal additions are identified as a bounced-check reversal, never a new issuance. Reconstructed evidence is explicitly reconstructed; unknown kinds are counted; unexpected archive updates/deletes remain individual entries.
- **Client verification:** plain instructions ask the reader to give the firm the record ID so its system can recompute the SHA-256 digest and check the stored original and audit chain. Record ID, document digest, chain anchor and source-archive digest remain. Matching instructions appear above Printed records in the tab.
- **Full evidence:** every itemized entry, API retrieval path and structured-value descriptor remains. Its original itemized presentation is unchanged. Both run-5 PDFs and source archives still match their retained hashes; see [preservation evidence](evidence/run-6/acceptance/run-5-preservation.json).

Application files: `src/endpoints/auditRecord/audit-record-presentation.js`, `src/endpoints/auditRecord/audit-record-pdf.js`, and `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.js`. The existing Audit Record tab and print options are used; no new screen or endpoint.

**Migrations: none.** Migration 027 remains the latest migration. No route handler, capture trigger, hashing protocol, storage operation, financial calculation or lock/unlock rule changed. No financial data migration or by-hand SQL application is needed. The added `presentation.client_changes` and coverage counts are display data supplied by the existing history presentation; source events and itemized `presentation.changes` remain intact. Existing stored artifacts are never regenerated.

The design record, documentation README, audit-ledger guide, scenario 18 guide, operations rollout notes, FINAL_REPORT section 6 and run-5 follow-up link are updated. Future release notes specify matching backend/frontend deployment and the presentation smoke checks; no deployment was performed.

## Completeness and deliberate test changes

The client sample retains **22 postings, 89 captured changes and 906 source-field changes**. Its **61 individually listed changes + 28 changes covered by 3 archive summaries = 89**, rendered as 64 change-log entries. Business fields shown remain 237; supporting fields retained remain 669.

| Posting | Invoice balances | Work items | Payments | Write-offs | Retainer records | Retainer adjustments | Covered changes |
|---|---:|---:|---:|---:|---:|---:|---:|
| First finalization | 1 | 2 | 1 | 1 | 4 | 2 | **11** |
| Second finalization | 4 | 2 | 2 | 1 | 4 | 2 | **15** |
| Bounced-check reversal | 1 | 0 | 1 | 0 | 0 | 0 | **2** |

The former client-PDF assertion requiring one `Change N` heading per captured change is replaced by exact coverage: every selected database event ID and change number occurs once across individual entries and summaries; all original field keys retain their shown/supporting disposition; category sums and each summary's covered count match the database; extracted PDF individual headings plus summary counts equal the captured total. Full evidence must still have one heading per change and all 28 itemized statement-copy entries. No capture, financial, role/tenant, refusal, rollback, storage-failure or integrity coverage was removed.

Six new backend unit cases cover category counts, separation by invoice/revision/posting, noncontiguous change numbers, multiple actors/reasons, reconstruction/unknown kinds, unexpected updates/deletes, both PDF types, preserved identities/digests and plain verification wording. One new frontend case checks the summary, original source-change count, retained business fields and matching instructions. Scenario 18 retains all 32 cases and strengthens its completeness/PDF assertions.

The money oracle is unchanged: work100→120; funded work50/draw50 leaves120 debt/50 retainer; write-off20 leaves100 debt; refund10/adjustment+5 leaves45 retainer; finalized100 then check30 leaves70 debt; finalized bounced-check reversal restores100; duplicate10+10 less removed10 leaves **110 debt = 100 billed + 10 unbilled**, with **45 retainer available**. Issuance remains informational in the audit ledger.

## Complete validation

All commands ran successfully, with one test process at a time and every integration file launched separately. The checkout now contains 81 integration files, including the 16 existing path-matrix files; all were run. Scenario/path-matrix files use `.env.scenarios`; clean-room uses `.env.clean`; other integrations use `.env.local`, with the existing provisioning guard redirecting its two account-creation suites to ds2_clean. The standard unit command ran without an added `--exit`. Drift ran with PostgreSQL's read-only option as an additional guard.

| Check | Exact result |
|---|---|
| Backend unit | **1,073 passing; 0 failing; 0 pending** |
| Every integration file, serial | **2,759 passing / 81 files; 0 failing; 0 pending** |
| Dedicated `npm run -s test:scenarios` | **1,602 passing / 40 files; 0 failing; 0 pending** |
| Dedicated `npm run -s test:cleanroom` | **18 passing; 0 failing; 0 pending** |
| Three-view drift | **0 differences**; Audit/engine 319 customers; engine/AR 320 including inactive |
| Frontend Jest | **185 tests / 40 suites passing** |
| Frontend CI build | **Compiled successfully** |
| Final database integrity | **All account chains valid in all three allowed databases; 33 capture tables each; immutable record guard enabled** |

Scenario and clean-room commands repeat integration coverage and are not additional unique tests. The earlier focused checks also passed: 15 presentation/PDF unit cases, 32 Audit Record scenario cases, and 16 frontend tab cases.

Evidence: [exact counts](evidence/run-6/acceptance/suite-counts.json), [every command, environment and exit status](evidence/run-6/acceptance/validation-results.json), [serial runner](evidence/run-6/acceptance/run-validation.py), [unit](evidence/run-6/acceptance/unit.log), [scenarios](evidence/run-6/acceptance/scenarios.log), [clean-room](evidence/run-6/acceptance/cleanroom.log), [drift](evidence/run-6/acceptance/drift-summary.json), [frontend Jest](evidence/run-6/acceptance/frontend-jest.log), [build](evidence/run-6/acceptance/frontend-build.log), [database integrity](evidence/run-6/acceptance/final-database-integrity.json). The requested detailed drift output is also at `/tmp/drift.json`.

## Final PDFs and every-page visual inspection

- [Client record](evidence/run-6/client-record.pdf): **6 pages**, all 22 postings / 89 captured changes / 906 fields accounted for. Summaries cover 11, 15 and 2 changes. Page 6 retains all verification identities/digests and plain wording without an API path. [Metadata](evidence/run-6/client-record.json), [exact source archive](evidence/run-6/client-record.evidence.json).
- [Full evidence record](evidence/run-6/full-evidence-record.pdf): **13 pages**, all **27 postings / 94 captured changes / 943 fields**, including the original 28 itemized archive copies and unchanged retrieval paths. Its later snapshot also includes the preceding print/reopen/profile-change proof. [Metadata](evidence/run-6/full-evidence-record.json), [exact source archive](evidence/run-6/full-evidence-record.evidence.json).

Both final PDFs were generated by real local scenario requests and rendered with Poppler at 100 dpi. **All 19 pages were visually inspected individually:** ledger columns align, archive summaries wrap legibly, change details and source descriptors are complete, hashes fit, page numbers are present, and no clipping, overlap or footer collision was observed. Text bounds and artifact hashes were checked as well. [Visual review and per-page evidence](evidence/run-6/acceptance/pdf-visual-review.json).

These sample artifacts were saved before later disposable scenario resets; their API IDs may no longer be present in the reset database. Normal application records are not reset or rerendered. Prior run-5 evidence remains intact.

## Protected account and boundaries

Live ds2_local account-1 counts match both this run's starting counts and the **retained ds2_ref_20260922 reference-count evidence**. The reference database was never connected to in run 6. This is a comparison with its recorded reference counts, not a fresh reference query. Account 1 still has **0 audit events**. [Comparison](evidence/run-6/acceptance/protected-account-counts.json), [starting snapshot](evidence/run-6/acceptance/protected-account-before.json).

| Table | Start | Final | Recorded reference |
|---|---:|---:|---:|
| customers | 338 | 338 | 338 |
| customer_transactions | 39,052 | 39,052 | 39,052 |
| customer_payments | 1,005 | 1,005 | 1,005 |
| customer_writeoffs | 657 | 657 | 657 |
| customer_invoices | 2,253 | 2,253 | 2,253 |
| timesheet_entries | 28,255 | 28,255 | 28,255 |
| users | 23 | 23 | 23 |

No git command, commit, production/AWS connection, reference-database connection, or local-server start/stop was performed. Dummy data remained in the permitted local databases and local MinIO; ds2_local mutations were confined to fixture account 9001. The validation exercised the checkout directly and the frontend production build; long-running servers were not restarted or certified as refreshed. Open questions for this presentation-only run: **none**.

## Per-file integration results

| File | Passing | Failing | Pending |
|---|---:|---:|---:|
| [analytics.integration.spec.js](evidence/run-6/acceptance/analytics.integration.spec.log) | 11 | 0 | 0 |
| [billing-regression.integration.spec.js](evidence/run-6/acceptance/billing-regression.integration.spec.log) | 2 | 0 | 0 |
| [cascade-edit-recompute.integration.spec.js](evidence/run-6/acceptance/cascade-edit-recompute.integration.spec.log) | 11 | 0 | 0 |
| [clean-room-regression.integration.spec.js](evidence/run-6/acceptance/clean-room-regression.integration.spec.log) | 18 | 0 | 0 |
| [coverage-account-users-auth-misc.integration.spec.js](evidence/run-6/acceptance/coverage-account-users-auth-misc.integration.spec.log) | 200 | 0 | 0 |
| [coverage-billing-review.integration.spec.js](evidence/run-6/acceptance/coverage-billing-review.integration.spec.log) | 31 | 0 | 0 |
| [coverage-downloads-authz.integration.spec.js](evidence/run-6/acceptance/coverage-downloads-authz.integration.spec.log) | 36 | 0 | 0 |
| [coverage-invoices-audit-ar-analytics.integration.spec.js](evidence/run-6/acceptance/coverage-invoices-audit-ar-analytics.integration.spec.log) | 131 | 0 | 0 |
| [coverage-jobs-masterdata.integration.spec.js](evidence/run-6/acceptance/coverage-jobs-masterdata.integration.spec.log) | 124 | 0 | 0 |
| [coverage-payments-pending.integration.spec.js](evidence/run-6/acceptance/coverage-payments-pending.integration.spec.log) | 102 | 0 | 0 |
| [coverage-pending-payments-authz.integration.spec.js](evidence/run-6/acceptance/coverage-pending-payments-authz.integration.spec.log) | 10 | 0 | 0 |
| [coverage-timetracking-timesheets.integration.spec.js](evidence/run-6/acceptance/coverage-timetracking-timesheets.integration.spec.log) | 106 | 0 | 0 |
| [coverage-transactions-retainers-writeoffs.integration.spec.js](evidence/run-6/acceptance/coverage-transactions-retainers-writeoffs.integration.spec.log) | 84 | 0 | 0 |
| [finalize-engine.integration.spec.js](evidence/run-6/acceptance/finalize-engine.integration.spec.log) | 15 | 0 | 0 |
| [finalize-snapshot.integration.spec.js](evidence/run-6/acceptance/finalize-snapshot.integration.spec.log) | 9 | 0 | 0 |
| [month-end-lifecycle.integration.spec.js](evidence/run-6/acceptance/month-end-lifecycle.integration.spec.log) | 19 | 0 | 0 |
| [orchestrator.integration.spec.js](evidence/run-6/acceptance/orchestrator.integration.spec.log) | 7 | 0 | 0 |
| [path-matrix-01-guards.integration.spec.js](evidence/run-6/acceptance/path-matrix-01-guards.integration.spec.log) | 437 | 0 | 0 |
| [path-matrix-02-read-failures.integration.spec.js](evidence/run-6/acceptance/path-matrix-02-read-failures.integration.spec.log) | 43 | 0 | 0 |
| [path-matrix-03-commit-outcomes.integration.spec.js](evidence/run-6/acceptance/path-matrix-03-commit-outcomes.integration.spec.log) | 24 | 0 | 0 |
| [path-matrix-04-admin-controls.integration.spec.js](evidence/run-6/acceptance/path-matrix-04-admin-controls.integration.spec.log) | 29 | 0 | 0 |
| [path-matrix-05-timesheets.integration.spec.js](evidence/run-6/acceptance/path-matrix-05-timesheets.integration.spec.log) | 27 | 0 | 0 |
| [path-matrix-06-pending-payments.integration.spec.js](evidence/run-6/acceptance/path-matrix-06-pending-payments.integration.spec.log) | 12 | 0 | 0 |
| [path-matrix-07-tracker-storage.integration.spec.js](evidence/run-6/acceptance/path-matrix-07-tracker-storage.integration.spec.log) | 29 | 0 | 0 |
| [path-matrix-08-reports.integration.spec.js](evidence/run-6/acceptance/path-matrix-08-reports.integration.spec.log) | 11 | 0 | 0 |
| [path-matrix-09-ledger-defenses.integration.spec.js](evidence/run-6/acceptance/path-matrix-09-ledger-defenses.integration.spec.log) | 17 | 0 | 0 |
| [path-matrix-10-races-and-review.integration.spec.js](evidence/run-6/acceptance/path-matrix-10-races-and-review.integration.spec.log) | 14 | 0 | 0 |
| [path-matrix-11-tracker-validation.integration.spec.js](evidence/run-6/acceptance/path-matrix-11-tracker-validation.integration.spec.log) | 20 | 0 | 0 |
| [path-matrix-12-global-errors.integration.spec.js](evidence/run-6/acceptance/path-matrix-12-global-errors.integration.spec.log) | 7 | 0 | 0 |
| [path-matrix-13-optional-services.integration.spec.js](evidence/run-6/acceptance/path-matrix-13-optional-services.integration.spec.log) | 9 | 0 | 0 |
| [path-matrix-14-response-decoration.integration.spec.js](evidence/run-6/acceptance/path-matrix-14-response-decoration.integration.spec.log) | 5 | 0 | 0 |
| [path-matrix-15-defensive-faults.integration.spec.js](evidence/run-6/acceptance/path-matrix-15-defensive-faults.integration.spec.log) | 13 | 0 | 0 |
| [path-matrix-16-workbook-and-audit.integration.spec.js](evidence/run-6/acceptance/path-matrix-16-workbook-and-audit.integration.spec.log) | 10 | 0 | 0 |
| [payment-reversal.integration.spec.js](evidence/run-6/acceptance/payment-reversal.integration.spec.log) | 49 | 0 | 0 |
| [pii-leak.integration.spec.js](evidence/run-6/acceptance/pii-leak.integration.spec.log) | 2 | 0 | 0 |
| [review-account-atomicity.integration.spec.js](evidence/run-6/acceptance/review-account-atomicity.integration.spec.log) | 4 | 0 | 0 |
| [review-analytics-identities.integration.spec.js](evidence/run-6/acceptance/review-analytics-identities.integration.spec.log) | 2 | 0 | 0 |
| [review-audit-download.integration.spec.js](evidence/run-6/acceptance/review-audit-download.integration.spec.log) | 4 | 0 | 0 |
| [review-audit-filter.integration.spec.js](evidence/run-6/acceptance/review-audit-filter.integration.spec.log) | 3 | 0 | 0 |
| [review-customer-delete.integration.spec.js](evidence/run-6/acceptance/review-customer-delete.integration.spec.log) | 4 | 0 | 0 |
| [review-customer-recurring.integration.spec.js](evidence/run-6/acceptance/review-customer-recurring.integration.spec.log) | 8 | 0 | 0 |
| [review-customer-response.integration.spec.js](evidence/run-6/acceptance/review-customer-response.integration.spec.log) | 2 | 0 | 0 |
| [review-initial-data-roles.integration.spec.js](evidence/run-6/acceptance/review-initial-data-roles.integration.spec.log) | 18 | 0 | 0 |
| [review-invoice-outcomes.integration.spec.js](evidence/run-6/acceptance/review-invoice-outcomes.integration.spec.log) | 4 | 0 | 0 |
| [review-job-family.integration.spec.js](evidence/run-6/acceptance/review-job-family.integration.spec.log) | 4 | 0 | 0 |
| [review-job-selection.integration.spec.js](evidence/run-6/acceptance/review-job-selection.integration.spec.log) | 2 | 0 | 0 |
| [review-pending-files.integration.spec.js](evidence/run-6/acceptance/review-pending-files.integration.spec.log) | 7 | 0 | 0 |
| [review-rate-agreements.integration.spec.js](evidence/run-6/acceptance/review-rate-agreements.integration.spec.log) | 10 | 0 | 0 |
| [review-related-ids.integration.spec.js](evidence/run-6/acceptance/review-related-ids.integration.spec.log) | 24 | 0 | 0 |
| [review-retainer-dates.integration.spec.js](evidence/run-6/acceptance/review-retainer-dates.integration.spec.log) | 1 | 0 | 0 |
| [review-statement-snapshot.integration.spec.js](evidence/run-6/acceptance/review-statement-snapshot.integration.spec.log) | 1 | 0 | 0 |
| [review-template-storage.integration.spec.js](evidence/run-6/acceptance/review-template-storage.integration.spec.log) | 1 | 0 | 0 |
| [review-tracker-outcome.integration.spec.js](evidence/run-6/acceptance/review-tracker-outcome.integration.spec.log) | 1 | 0 | 0 |
| [review-transaction-policy.integration.spec.js](evidence/run-6/acceptance/review-transaction-policy.integration.spec.log) | 22 | 0 | 0 |
| [review-user-guards.integration.spec.js](evidence/run-6/acceptance/review-user-guards.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-01-work.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-01-work.integration.spec.log) | 13 | 0 | 0 |
| [scenario-lifecycle-02-retainers.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-02-retainers.integration.spec.log) | 9 | 0 | 0 |
| [scenario-lifecycle-03-payments.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-03-payments.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-04-writeoffs.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-04-writeoffs.integration.spec.log) | 6 | 0 | 0 |
| [scenario-lifecycle-05-monthend.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-05-monthend.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-06-cascade.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-06-cascade.integration.spec.log) | 9 | 0 | 0 |
| [scenario-lifecycle-07-refusals.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-07-refusals.integration.spec.log) | 122 | 0 | 0 |
| [scenario-lifecycle-08-failures.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-08-failures.integration.spec.log) | 24 | 0 | 0 |
| [scenario-lifecycle-09-state-boundaries.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-09-state-boundaries.integration.spec.log) | 21 | 0 | 0 |
| [scenario-lifecycle-10-integrity.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-10-integrity.integration.spec.log) | 22 | 0 | 0 |
| [scenario-lifecycle-11-finalize-races.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-11-finalize-races.integration.spec.log) | 15 | 0 | 0 |
| [scenario-lifecycle-12-sent-exceptions.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-12-sent-exceptions.integration.spec.log) | 72 | 0 | 0 |
| [scenario-lifecycle-13-retainer-events.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-13-retainer-events.integration.spec.log) | 24 | 0 | 0 |
| [scenario-lifecycle-14-duplicates.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-14-duplicates.integration.spec.log) | 23 | 0 | 0 |
| [scenario-lifecycle-15-credit-statements.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-15-credit-statements.integration.spec.log) | 11 | 0 | 0 |
| [scenario-lifecycle-16-owner-combined.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-16-owner-combined.integration.spec.log) | 4 | 0 | 0 |
| [scenario-lifecycle-17-time-boundaries.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-17-time-boundaries.integration.spec.log) | 10 | 0 | 0 |
| [scenario-lifecycle-18-audit-record.integration.spec.js](evidence/run-6/acceptance/scenario-lifecycle-18-audit-record.integration.spec.log) | 32 | 0 | 0 |
| [scenario-what-if-01-values.integration.spec.js](evidence/run-6/acceptance/scenario-what-if-01-values.integration.spec.log) | 308 | 0 | 0 |
| [scenario-what-if-02-retries.integration.spec.js](evidence/run-6/acceptance/scenario-what-if-02-retries.integration.spec.log) | 23 | 0 | 0 |
| [scenario-what-if-03-history.integration.spec.js](evidence/run-6/acceptance/scenario-what-if-03-history.integration.spec.log) | 25 | 0 | 0 |
| [scenario-what-if-04-calendar-races.integration.spec.js](evidence/run-6/acceptance/scenario-what-if-04-calendar-races.integration.spec.log) | 13 | 0 | 0 |
| [scenario-what-if-05-csv.integration.spec.js](evidence/run-6/acceptance/scenario-what-if-05-csv.integration.spec.log) | 13 | 0 | 0 |
| [scenario-what-if-06-boundaries.integration.spec.js](evidence/run-6/acceptance/scenario-what-if-06-boundaries.integration.spec.log) | 82 | 0 | 0 |
| [tracker-excel-end-to-end.integration.spec.js](evidence/run-6/acceptance/tracker-excel-end-to-end.integration.spec.log) | 33 | 0 | 0 |
| [transactions-ledger-seams.integration.spec.js](evidence/run-6/acceptance/transactions-ledger-seams.integration.spec.log) | 28 | 0 | 0 |
