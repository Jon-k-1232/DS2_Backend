# F23–F39 remediation log

Scope: findings F23–F39 only; PostgreSQL 127.0.0.1:5433 and MinIO 127.0.0.1:9000. Integration writes in ds2_local target fixture account 9001; its production-copy account 1 is read-only. The required clean-room suite separately creates synthetic account 1 data in ds2_clean; unit migration tests use disposable ds2_mig_test databases. No git, commits, production connections, or running-server lifecycle changes.

Started 2026-09-24. Test logs: `/tmp/ds2-f3-tests/`. Baseline copies: `/tmp/ds2-f3-baseline/`.

## Running results

- **F23 FIXED** — Job joins preserve job metadata; customer selectors and profile totals select the same latest family row by SQL timestamp then ID. `test/integration/review-job-selection.integration.spec.js`: red 2 failed; green 2 passed (multiple versions, timestamp ties, backdated higher ID, creator preservation).

- **F24 FIXED** — Unused-customer deletion removes all owned contacts atomically; quote history blocks hard deletion and directs callers to deactivate. `test/integration/review-customer-delete.integration.spec.js` F24: red 2 failed; green 2 passed.

- **F25 FIXED** — Deletion holds the shared customer FOR NO KEY UPDATE lock through raw history checks and contact/customer deletion. `test/integration/review-customer-delete.integration.spec.js` F25: red 2 failed; green 2 passed (real two-request lock race and malformed historical job join); combined 4 passed.

- **F26 FIXED** — Job-type update/delete await refresh so rejection reaches the existing error envelope after the committed mutation. `test/endpoints/jobType/review-refresh.spec.js`: red 2 failed; green 2 passed in isolated strict-unhandled-rejection Node processes.

- **F27 FIXED** — Customer, five ledger datasets and account header are read in one REPEATABLE READ READ ONLY transaction. `test/integration/review-statement-snapshot.integration.spec.js`: red 1 failed with -100 instead of 0; green 1 passed across a controlled concurrent atomic charge/payment commit.

- **F28 FIXED** — Postcommit staff-recipient lookup and delivery are best effort; successful uploads retain 201 and storedKey. `test/integration/review-tracker-outcome.integration.spec.js`: red 1 failed; green 1 passed, verifying saved MinIO bytes, entry/owner records and duplicate retry; no email or AI calls.

- **F29 FIXED** — Update active flags accept only literal booleans (or omission); update/delete serialize last-Super-Admin checks and mutations under an account lock. `test/integration/review-user-guards.integration.spec.js`: red 6 failed / 1 passed; green 7 passed, including concurrent self-demotions.

- **F30 FIXED** — Added additive migration 022 to restore the three runtime suggestion columns and customer FK without changing existing values. `test/scripts/migration-022.spec.js`: red 1 failed / 1 passed; green 2 passed (historical 005 gap, supported snapshot baseline through pending migrations, runtime-shaped upsert/read, idempotent rerun). Tested only in disposable ds2_mig_test databases; no historical data repair.

- **F31 FIXED** — Both notes normalize to strings and the Notes section renders when either is populated. `test/pdfCreator/review-notes.spec.js`: red 2 failed / 2 passed; green 4 passed (global only, individual only, both, neither).

- **F32 FIXED** — Rate agreements validate positive integer customer/year and finite positive two-decimal rate within numeric(10,2), lock/verify the owned customer, and derive creator from session while preserving it on edits. `test/integration/review-rate-agreements.integration.spec.js`: red 3 failed / 7 passed; green 10 passed.

- **F33 FIXED** — PDF archive members include customer IDs and safe display names, with a case-insensitive collision fallback. `test/pdfCreator/review-zip-names.spec.js`: red 2 failed; green 2 passed (draft/final archives, same names, normalized path names, distinct bytes).

- **F34 FIXED** — Invoice retainer history uses inclusive business dates: created_at >= start_date and < end_date + 1 day. `test/integration/review-retainer-dates.integration.spec.js`: red 1 failed; green 1 passed (midnight/noon/final microsecond included, adjacent days and other customer excluded).

- **F35 FIXED** — Time allocation and capacity group and return stable customer/user IDs; CSV and UI retain those IDs and distinguish same-name rows/cards. `review-analytics-identities.integration.spec.js`: red 2 failed; green 2 passed. Frontend `TaxSeasonCapacityPage.identities.test.js`: red 1 failed; green 1 passed.

- **F36 FIXED** — Accepted PDF extensions are stored and returned as lowercase .pdf to match the checked-in S3 notification. `test/endpoints/pendingPayments/review-upload-extension.spec.js`: red 2 failed / 1 passed; green 3 passed (.pdf, .PDF, .PdF). Router/trigger contract uses in-memory storage with fixture account 9001; no cloud configuration changed.

- **F37 FIXED** — The frontend manager gate now admits legacy Owner like the backend; Admin-only and Super-Admin-only gates retain their existing roles. Frontend `ManagerAndAdminProtectedAccess.test.js`: red 2 failed / 8 passed; green 10 passed (role matrix and higher-privilege exclusions).

- **F38 FIXED** — Account Audit explicitly returns HTTP 400 for unsupported ar_60 instead of silently ignoring it; supported filters and ordinary listing remain. `test/integration/review-audit-filter.integration.spec.js`: red 2 failed / 1 passed; green 3 passed (10-day and 80-day statements plus normal listing).

- **F39 FIXED** — Removed the duplicate/misleading Original Amount column; Beginning Balance prints the selected outstanding balance once. No original issued amount is inferred from mutable invoice totals. `test/pdfCreator/review-outstanding-column.spec.js`: red 2 failed; green 2 passed on rendered PDFs; with existing pagination regressions 14 passed.

## Verification log

All 17 scoped findings have passing focused regressions. No finding requires deferral or an owner/accountant decision. Starting the required serial backend unit, touched/required integration, clean-room, frontend and drift runs.

- Final backend unit suite: **1004 passing, 0 failing, 0 pending**. `unit-final.log`.

- Final review-job-selection.integration.spec.js: **2 passing, 0 failing, 0 pending**. `final-review-job-selection.log`.

- Final review-customer-delete.integration.spec.js: **4 passing, 0 failing, 0 pending**. `final-review-customer-delete.log`.

- Final review-statement-snapshot.integration.spec.js: **1 passing, 0 failing, 0 pending**. `final-review-statement-snapshot.log`.

- Final review-tracker-outcome.integration.spec.js: **1 passing, 0 failing, 0 pending**. `final-review-tracker-outcome.log`.

- Final review-user-guards.integration.spec.js: **7 passing, 0 failing, 0 pending**. `final-review-user-guards.log`.

- Final review-rate-agreements.integration.spec.js: **10 passing, 0 failing, 0 pending**. `final-review-rate-agreements.log`.

- Final review-retainer-dates.integration.spec.js: **1 passing, 0 failing, 0 pending**. `final-review-retainer-dates.log`.

- Final review-analytics-identities.integration.spec.js: **2 passing, 0 failing, 0 pending**. `final-review-analytics-identities.log`.

- Final review-audit-filter.integration.spec.js: **3 passing, 0 failing, 0 pending**. `final-review-audit-filter.log`.

- Final coverage-invoices-audit-ar-analytics.integration.spec.js: **131 passing, 0 failing, 0 pending**. `final-coverage-invoices-audit-ar-analytics.log`.

- Final coverage-payments-pending.integration.spec.js: **102 passing, 0 failing, 0 pending**. `final-coverage-payments-pending.log`.

- Final Clean-room suite: **15 passing, 3 failing, 0 pending**. `final-cleanroom.log`.

- Clean-room follow-up: the first final run had 15 passing / 3 failing because PDF extras still expected duplicate outstanding amounts removed by F39. Updated only those four row expectations, retained every ledger/CSV/balance assertion, and added an explicit absence check for the misleading column. Failed-run evidence: `cleanroom-before-F39-expectation-update.log`. Customer-delete and rate-agreement fixture cleanup now selects only this run's IDs/unique notes; rerunning those two specs as well.

- Final review-customer-delete.integration.spec.js: **4 passing, 0 failing, 0 pending**. `final-review-customer-delete.log`.

- Final review-rate-agreements.integration.spec.js: **10 passing, 0 failing, 0 pending**. `final-review-rate-agreements.log`.

- Final Clean-room suite: **14 passing, 4 failing, 0 pending**. `final-cleanroom.log`.

- Clean-room assertion refinement: Retainers legitimately has its own Original Amount heading. Scoped the new PDF check specifically to Beginning Balance instead of forbidding that label throughout the PDF. No renderer or ledger logic changed; previous run evidence is `cleanroom-before-section-specific-assertion.log`.

- Final Clean-room suite: **16 passing, 2 failing, 0 pending**. `final-cleanroom.log`.

- Clean-room final expectation sweep: the remaining two failures were customer D rows that still asserted the removed duplicate amount. Updated both (300 and 350); all six Beginning Balance row expectations now match the single Outstanding column. Previous evidence: `cleanroom-before-remaining-D-row-update.log`.

- Final Clean-room suite: **18 passing, 0 failing, 0 pending**. `final-cleanroom.log`.

- Final Frontend Jest: **106 passing, 0 failing, 0 pending**. `final-frontend.log`.

- Final Drift check: exit 0; see drift summary. `final-drift.log`.

## Final result — complete

**All 17 findings F23–F39 are FIXED.** Each was reproduced by a failing regression before its code change; the running results above name the tests and record the red/green counts. The final test runs are below. No scoped finding is deferred or classified NOT A DEFECT; no owner/accountant decision remains for this scope. F1–F22 and the four original review files were compared with the starting copies and left unchanged. The original review's concluding summary remains historical.

Material behavior choices: F38 refuses unsupported `ar_60` with HTTP 400 and directs callers to Accounts Receivable aging. F39 removes the redundant Beginning Balance Original Amount column, preserving the selected Outstanding amount. Neither change invents an accounting rule. F30 supplies migration 022 and tests it on disposable databases; it was not applied to ds2_local, ds2_clean, or production and does not reconstruct values previously dropped by 005. No deployment was performed.

All runs completed serially; integration files ran individually. Earlier clean-room assertion failures above are retained as history and were resolved by updating the expectations for F33/F39. The counts below report only the final successful run of each suite, without double-counting focused tests or reruns.

| Final suite | Passing | Failing | Pending |
|---|---:|---:|---:|
| Backend unit suite | 1,004 | 0 | 0 |
| Local integration: nine touched review specs plus two required coverage specs | 264 | 0 | 0 |
| Clean-room integration (ds2_clean) | 18 | 0 | 0 |
| Frontend Jest (25 suites) | 106 | 0 | 0 |
| **Total** | **1,392** | **0** | **0** |

**Drift: 0 differences.** Engine versus audit: 319 customers, 0 mismatches. Engine versus AR: 320 compared, 39 AR rows including 1 inactive row, 0 mismatches. The read-only ds2_local run exited 0 and wrote `/tmp/drift.json`.

### Individual final runs

| Run | Passing | Log |
|---|---:|---|
| Backend unit suite | 1,004 | [unit-final.log](/tmp/ds2-f3-tests/unit-final.log) |
| review-job-selection.integration.spec.js | 2 | [final-review-job-selection.log](/tmp/ds2-f3-tests/final-review-job-selection.log) |
| review-statement-snapshot.integration.spec.js | 1 | [final-review-statement-snapshot.log](/tmp/ds2-f3-tests/final-review-statement-snapshot.log) |
| review-tracker-outcome.integration.spec.js | 1 | [final-review-tracker-outcome.log](/tmp/ds2-f3-tests/final-review-tracker-outcome.log) |
| review-user-guards.integration.spec.js | 7 | [final-review-user-guards.log](/tmp/ds2-f3-tests/final-review-user-guards.log) |
| review-retainer-dates.integration.spec.js | 1 | [final-review-retainer-dates.log](/tmp/ds2-f3-tests/final-review-retainer-dates.log) |
| review-analytics-identities.integration.spec.js | 2 | [final-review-analytics-identities.log](/tmp/ds2-f3-tests/final-review-analytics-identities.log) |
| review-audit-filter.integration.spec.js | 3 | [final-review-audit-filter.log](/tmp/ds2-f3-tests/final-review-audit-filter.log) |
| coverage-invoices-audit-ar-analytics.integration.spec.js | 131 | [final-coverage-invoices-audit-ar-analytics.log](/tmp/ds2-f3-tests/final-coverage-invoices-audit-ar-analytics.log) |
| coverage-payments-pending.integration.spec.js | 102 | [final-coverage-payments-pending.log](/tmp/ds2-f3-tests/final-coverage-payments-pending.log) |
| review-customer-delete.integration.spec.js | 4 | [final-review-customer-delete.log](/tmp/ds2-f3-tests/final-review-customer-delete.log) |
| review-rate-agreements.integration.spec.js | 10 | [final-review-rate-agreements.log](/tmp/ds2-f3-tests/final-review-rate-agreements.log) |
| Clean-room suite | 18 | [final-cleanroom.log](/tmp/ds2-f3-tests/final-cleanroom.log) |
| Frontend Jest | 106 | [final-frontend.log](/tmp/ds2-f3-tests/final-frontend.log) |

Commands (backend directory unless noted):

```sh
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js --recursive --exclude 'test/integration/**' test
# Each integration file listed above, in a separate serial invocation:
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js test/integration/<file> --exit --timeout 180000
npm run -s test:cleanroom
# In DS2_Frontend:
CI=true node_modules/.bin/react-scripts test --watchAll=false
# Back in DS2_Backend:
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js /tmp/drift.json
```

### Files changed

68 files were added or modified, determined by content comparison with copies taken at the start of this run; no git command was used. Paths below are relative to the DS2 workspace. `Added` means absent from that starting copy.

#### Backend implementation (16)

- [DS2_Backend/src/endpoints/accountAudit/account-audit-router.js](../../src/endpoints/accountAudit/account-audit-router.js)
- [DS2_Backend/src/endpoints/analytics/analytics-router.js](../../src/endpoints/analytics/analytics-router.js)
- [DS2_Backend/src/endpoints/analytics/analytics-service.js](../../src/endpoints/analytics/analytics-service.js)
- [DS2_Backend/src/endpoints/customer/customer-router.js](../../src/endpoints/customer/customer-router.js)
- [DS2_Backend/src/endpoints/customer/customer-statement.js](../../src/endpoints/customer/customer-statement.js)
- [DS2_Backend/src/endpoints/job/job-router.js](../../src/endpoints/job/job-router.js)
- [DS2_Backend/src/endpoints/job/job-service.js](../../src/endpoints/job/job-service.js)
- [DS2_Backend/src/endpoints/jobType/jobType-router.js](../../src/endpoints/jobType/jobType-router.js)
- [DS2_Backend/src/endpoints/pendingPayments/pendingPayments-router.js](../../src/endpoints/pendingPayments/pendingPayments-router.js)
- [DS2_Backend/src/endpoints/retainer/retainer-service.js](../../src/endpoints/retainer/retainer-service.js)
- [DS2_Backend/src/endpoints/timeTracking/timeTracking-router.js](../../src/endpoints/timeTracking/timeTracking-router.js)
- [DS2_Backend/src/endpoints/user/user-router.js](../../src/endpoints/user/user-router.js)
- [DS2_Backend/src/endpoints/user/userObjects.js](../../src/endpoints/user/userObjects.js)
- [DS2_Backend/src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js](../../src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js)
- [DS2_Backend/src/pdfCreator/templateOne/templateFunctions/templateOneOutstandingCharges.js](../../src/pdfCreator/templateOne/templateFunctions/templateOneOutstandingCharges.js)
- [DS2_Backend/src/pdfCreator/zipOrchestrator.js](../../src/pdfCreator/zipOrchestrator.js)

#### Backend regression tests (18)

- [DS2_Backend/test/endpoints/jobType/review-refresh.spec.js](../../test/endpoints/jobType/review-refresh.spec.js) — Added
- [DS2_Backend/test/endpoints/pendingPayments/review-upload-extension.spec.js](../../test/endpoints/pendingPayments/review-upload-extension.spec.js) — Added
- [DS2_Backend/test/integration/clean-room-regression.integration.spec.js](../../test/integration/clean-room-regression.integration.spec.js)
- [DS2_Backend/test/integration/review-analytics-identities.integration.spec.js](../../test/integration/review-analytics-identities.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-audit-filter.integration.spec.js](../../test/integration/review-audit-filter.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-customer-delete.integration.spec.js](../../test/integration/review-customer-delete.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-job-selection.integration.spec.js](../../test/integration/review-job-selection.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-rate-agreements.integration.spec.js](../../test/integration/review-rate-agreements.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-retainer-dates.integration.spec.js](../../test/integration/review-retainer-dates.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-statement-snapshot.integration.spec.js](../../test/integration/review-statement-snapshot.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-tracker-outcome.integration.spec.js](../../test/integration/review-tracker-outcome.integration.spec.js) — Added
- [DS2_Backend/test/integration/review-user-guards.integration.spec.js](../../test/integration/review-user-guards.integration.spec.js) — Added
- [DS2_Backend/test/pdfCreator/review-notes.spec.js](../../test/pdfCreator/review-notes.spec.js) — Added
- [DS2_Backend/test/pdfCreator/review-outstanding-column.spec.js](../../test/pdfCreator/review-outstanding-column.spec.js) — Added
- [DS2_Backend/test/pdfCreator/review-zip-names.spec.js](../../test/pdfCreator/review-zip-names.spec.js) — Added
- [DS2_Backend/test/pdfCreator/templateOnePagination.spec.js](../../test/pdfCreator/templateOnePagination.spec.js)
- [DS2_Backend/test/scripts/migrate.spec.js](../../test/scripts/migrate.spec.js)
- [DS2_Backend/test/scripts/migration-022.spec.js](../../test/scripts/migration-022.spec.js) — Added

#### Schema migration and guidance (2)

- [DS2_Backend/migrations/022.restore_suggestion_customer_columns.sql](../../migrations/022.restore_suggestion_customer_columns.sql) — Added
- [DS2_Backend/migrations/README.md](../../migrations/README.md)

#### Frontend implementation and tests (5)

- [DS2_Frontend/src/Pages/Analytics/TaxSeasonCapacityPage.identities.test.js](../../../DS2_Frontend/src/Pages/Analytics/TaxSeasonCapacityPage.identities.test.js) — Added
- [DS2_Frontend/src/Pages/Analytics/TaxSeasonCapacityPage.js](../../../DS2_Frontend/src/Pages/Analytics/TaxSeasonCapacityPage.js)
- [DS2_Frontend/src/Pages/Analytics/TimeAllocationPage.js](../../../DS2_Frontend/src/Pages/Analytics/TimeAllocationPage.js)
- [DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js](../../../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js)
- [DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.test.js](../../../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.test.js) — Added

#### Documentation and review log (27)

- [DS2_Backend/docs/_review/findings.md](findings.md)
- [DS2_Backend/docs/_review/fixes-F23-F39.md](fixes-F23-F39.md) — Added
- [DS2_Backend/docs/architecture.md](../architecture.md)
- [DS2_Backend/docs/invoicing/account-audit.md](../invoicing/account-audit.md)
- [DS2_Backend/docs/invoicing/accounts-receivable.md](../invoicing/accounts-receivable.md)
- [DS2_Backend/docs/invoicing/analytics.md](../invoicing/analytics.md)
- [DS2_Backend/docs/invoicing/create-invoice-engine.md](../invoicing/create-invoice-engine.md)
- [DS2_Backend/docs/invoicing/invoices.md](../invoicing/invoices.md)
- [DS2_Backend/docs/invoicing/month-end-finalize.md](../invoicing/month-end-finalize.md)
- [DS2_Backend/docs/invoicing/pdf-statements.md](../invoicing/pdf-statements.md)
- [DS2_Backend/docs/ledger/ledger-conventions.md](../ledger/ledger-conventions.md)
- [DS2_Backend/docs/ledger/payments.md](../ledger/payments.md)
- [DS2_Backend/docs/ledger/pending-payments.md](../ledger/pending-payments.md)
- [DS2_Backend/docs/ledger/retainers-and-prepayments.md](../ledger/retainers-and-prepayments.md)
- [DS2_Backend/docs/ledger/write-offs-and-adjustments.md](../ledger/write-offs-and-adjustments.md)
- [DS2_Backend/docs/platform/accounts-users-auth.md](../platform/accounts-users-auth.md)
- [DS2_Backend/docs/platform/operations.md](../platform/operations.md)
- [DS2_Backend/docs/platform/storage-and-downloads.md](../platform/storage-and-downloads.md)
- [DS2_Backend/docs/platform/time-tracking.md](../platform/time-tracking.md)
- [DS2_Backend/docs/platform/timesheets-and-ingestion.md](../platform/timesheets-and-ingestion.md)
- [DS2_Backend/docs/work/customers.md](../work/customers.md)
- [DS2_Backend/docs/work/initial-data-and-notifications.md](../work/initial-data-and-notifications.md)
- [DS2_Backend/docs/work/job-categories-and-types.md](../work/job-categories-and-types.md)
- [DS2_Backend/docs/work/jobs.md](../work/jobs.md)
- [DS2_Backend/docs/work/quotes.md](../work/quotes.md)
- [DS2_Backend/docs/work/transactions.md](../work/transactions.md)
- [DS2_Backend/docs/work/work-descriptions.md](../work/work-descriptions.md)
