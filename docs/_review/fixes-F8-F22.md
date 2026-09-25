# F8–F22 remediation log

Scope: local sandbox only. `ds2_local` writes use fixture account 9001, plus disposable new accounts for F20; the account 1 production-copy rows are not mutated. The required clean-room suite resets and exercises its separate `ds2_clean` seed. No production connections, git commands, commits, or running-server lifecycle changes. Findings outside F8–F22 are unchanged.

## Running results

Started: 2026-09-24. Test output is captured under `/tmp/ds2-f2-tests/`.

- **F8 FIXED** — Same-job invoice credits are excluded from hidden job netting. Test: `test/endpoints/invoice/review-writeoff.spec.js`; red 2 failed, green 2 passed (current and absorbed chains).

- **F9 FIXED** — Billing Review appends the shared family total under the customer lock, summing after save with delta zero. `test/integration/review-job-family.integration.spec.js` F9: red 3 failed; green 3 passed (repricing and same/cross-family moves).

- **F10 FIXED** — Snapshots copy the latest owned family metadata, ordered by created_at then ID. `test/integration/review-job-family.integration.spec.js` F10: red 1 failed; green 1 passed; combined suite 4 passed.

- **F11 FIXED** — Shared create/update validation enforces finite nonnegative two-decimal inputs, supplied-duration agreement after six-minute rounding, and rounded quantity × rate; zero quantity survives updates. Direct decimal-hour quantities without supplied minutes remain valid, including 0.25 hours at $75 = $18.75. The initial blanket 0.1-hour check was too broad and broke existing direct-entry and finalize-preservation contracts; the [regression repair](regression-repair.md) narrows it to the duration-based path, keeps all original quarter-hour/amount/note assertions, and adds create/update coverage. Initial F11 run: red 15 failed / 2 passed, green 17 passed. Billing Review retains its documented explicit correction override.

- **F12 FIXED** — Shared create/update applies internal-customer and customer is_billable policy under the ledger lock before funding; no retainer draw for forced nonbillable work. `test/integration/review-transaction-policy.integration.spec.js` F12: red 4 failed, green 4 passed (combined 21 passed). Tracker ingestion uses the same core.

- **F13 FIXED** — Customer profile displays paymentsReceivedTotal (all marker-qualified receipts) once, with a matching tooltip. Frontend `CustomerProfile.payments.test.js`: red 1 failed, green 1 passed, including cash, retainer and tagged receipts.

- **F14 FIXED** — Preview, eligibility and finalization exclude work after the billing date while recovering old unbilled work. `test/integration/review-invoice-outcomes.integration.spec.js` F14: red 1 failed, green 1 passed (past/today selected; future remains unstamped).

- **F15 FIXED** — Postcommit export/readback failures return status 200, committed=true, committed invoice IDs/numbers/individual ZIP paths, and warnings. Frontend preserves existing lists if refresh is absent. `test/integration/review-invoice-outcomes.integration.spec.js` F15: red 2 failed, green 2 passed; individual files downloaded successfully; combined suite 3 passed.

- **F16 FIXED** — Soft-delete conditions its write on unprocessed, nondeleted state and returns 409 if approval won. `test/integration/review-pending-files.integration.spec.js` F16: red 1 failed; green 1 passed with a real approval committed between delete read and write.

- **F17 FIXED** — File deletion locks extracted rows against approval, removes matching archive and pending objects, propagates storage failure before queue flags commit, and preview requires nondeleted evidence. `test/integration/review-pending-files.integration.spec.js` F17: red 2 failed / 1 passed; green 3 passed (combined 4). S3 deletion is idempotently retryable, not transactionally reversible.

- **F18 FIXED** — Canonical physical identity strips the reserved receipt suffix in file grouping, ownership, preview, locking and deletion; original source_file remains the dedup token and list rows expose source_reference. Existing suffixed rows work without historical rewrites or schema changes. `test/integration/review-pending-files.integration.spec.js` F18: red 3 failed; green 3 passed (combined 7).

- **F19 FIXED** — Enabled state and recipient replacement commit in one transaction under an account lock; recipient validation precedes deletion. `test/integration/review-account-atomicity.integration.spec.js` F19: red 2 failed; green 2 passed (foreign-user rejection and injected late write failure preserve old recipients/enabled state). No mail sent.

- **F20 FIXED** — Account text lengths are validated before writes; account/slug and address share an encompassing transaction. `test/integration/review-account-atomicity.integration.spec.js` F20: red 2 failed; green 2 passed (invalid address, forced address failure, successful retry); combined 4 passed. Disposable new accounts were removed.

- **F21 FIXED** — Customer/contact/recurring updates and dedicated recurring creation now share transactions under the customer ledger lock; missing contact writes are refused. `test/integration/review-customer-recurring.integration.spec.js` F21: red 4 failed; green 4 passed (contact SQL failure, missing contact, recurring SQL failure and injected dedicated insertion failure all roll back). The [regression repair](regression-repair.md) restores dedicated recurring creation's documented HTTP 422 for missing/foreign customers by running the owned-customer validator before the lock, inside the same transaction. The lock still rechecks existence before writes. Previously its `statusCode`-only error reached the global `err.status` handler as HTTP 500. The existing validation test now also proves customer flags and recurring rows are unchanged.

- **F22 FIXED** — Every recurring mutation reconciles customers.is_recurring from remaining active owned subscriptions in the same locked transaction, including embedded edits. Explicit active flags retain existing precedence over dates. `test/integration/review-customer-recurring.integration.spec.js` F22: red 4 failed; green 4 passed (last removal, multiple subscriptions, inactive create/reactivation); combined 8 passed.

- **F14 parity follow-up** — Account Audit now uses the same billing-date upper bound for current balance; lifetime diagnostics keep future work. `test/endpoints/accountAudit/review-future.spec.js`: red 1 failed, green 1 passed.

- **F14 calendar follow-up** — WIP now receives the same server billing calendar date as preview/finalize, including aging buckets and days_old. A fixed-date HTTP-harness regression failed (200 due instead of 100); after the fix it passes.

- **F11 rounding follow-up** — Integer hundredths pricing preserves half-cent rounding (0.02 × 200.75 = 4.02); `transactionPricing.spec.js` reproduced a binary rounding refusal, then passed.

## Final verification — complete

All runs are sequential. Commands use the local environment and the existing test harness.

| Check | Result |
| --- | --- |
| Backend unit suite | 989 passing, 0 failing |
| `review-job-family.integration.spec.js` | 4 passing, 0 failing |
| `review-transaction-policy.integration.spec.js` | 21 passing, 0 failing |
| `review-invoice-outcomes.integration.spec.js` | 4 passing, 0 failing |
| `review-pending-files.integration.spec.js` | 7 passing, 0 failing |
| `review-account-atomicity.integration.spec.js` | 4 passing, 0 failing |
| `review-customer-recurring.integration.spec.js` | 8 passing, 0 failing |
| `coverage-invoices-audit-ar-analytics.integration.spec.js` | 131 passing, 0 failing |
| `coverage-payments-pending.integration.spec.js` | 102 passing, 0 failing |
| Clean-room three-cycle regression | 18 passing, 0 failing |
| Frontend Jest | 95 passing, 0 failing; 23 suites passed; 0 snapshots |
| Read-only drift, engine vs audit | 0 differences / 319 active customers |
| Read-only drift, engine vs AR | 0 differences / 320 customers (39 AR rows, 1 inactive) |

Final totals: **989 backend unit tests, 281 tests across the eight listed `ds2_local` integration files, 18 clean-room tests, and 95 frontend tests: 1,383 passing, 0 failing.** The clean-room spec is the ninth touched/required integration file and is counted separately. These are final suite counts, not a sum of repeated red/green runs. All final commands completed successfully. Drift output is `/tmp/drift.json`; its summary is `/tmp/ds2-f2-tests/final-drift.log`.

Clean-room fixture compatibility: its initial run had 1 passing / 17 failing after the first quarter-hour Time entry was rejected by F11, cascading into later phases. The fixture now uses six-minute increments and retains every expected statement balance, payment and retainer total. Individual transaction-detail and nonbillable family-total expectations reflect the adjusted inputs. The final 18-test run verifies three complete statement cycles, PDF/CSV contents, payments, reversals, retainers and engine/audit/AR agreement against `ds2_clean` only.

The first full unit run exposed query-method gaps in the in-memory transaction and Billing Review fakes. Those fakes now support the family-history and internal-customer queries used by the real services. The existing invoice timestamp assertion is scoped to invoice snapshots because job snapshots now also receive the post-lock clock. Production validation was not relaxed to satisfy the old fakes.

Commands (integration files ran individually, with no simultaneous test runs):

```sh
# Backend
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js --recursive --exclude 'test/integration/**' test
# Repeated separately for each of the eight ds2_local files listed above:
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js test/integration/<file> --exit --timeout 180000
npm run -s test:cleanroom
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js /tmp/drift.json
# DS2_Frontend
CI=true node_modules/.bin/react-scripts test --watchAll=false
```

Logs: `/tmp/ds2-f2-tests/unit-final.log`, `final-review-*.log`, `final-coverage-*.log`, `final-cleanroom.log`, `final-frontend.log`, and `final-drift.log`. Earlier red/green logs remain in the same directory.

## Outcome summary

**Fixed: F8–F22, all 15 findings.** Each finding's named regression and red/green result are recorded above and in `findings.md`. F8/F13 correct double-counting; F9/F10 preserve family totals and current metadata; F11/F12 enforce pricing and billability across shared transaction entry; F14 aligns work cutoffs; F15 preserves committed billing outcomes; F16–F18 protect pending payment state and file identity; F19–F21 make multi-record saves atomic; F22 reconciles recurring membership.

**Not fixed / deferred within F8–F22: none.** No new owner/accountant decision was needed. Existing explicit Billing Review amount overrides, subscription active-flag semantics, and historical accounting decisions are preserved. Historical data repairs and findings F23 onward remain outside this run; earlier finding statuses were left as found. No schema migration was introduced.

Operational limits: the postcommit invoice response points to saved individual ZIPs for recovery; it does not add a persisted billing-run/export-retry system. S3 deletion cannot be rolled back with PostgreSQL; failures preserve queue state and deletion can be retried. All verification is local and does not establish deployment status.

## Files changed

55 files added or changed in this run, including this report. Inventory uses content hashes captured at the start plus the newly added regression files; no git command was used.

### Backend implementation (21)

- [DS2_Backend/src/endpoints/account/account-router.js](../../src/endpoints/account/account-router.js)
- [DS2_Backend/src/endpoints/account/accountObjects.js](../../src/endpoints/account/accountObjects.js)
- [DS2_Backend/src/endpoints/account/automation-settings-service.js](../../src/endpoints/account/automation-settings-service.js)
- [DS2_Backend/src/endpoints/accountAudit/account-audit-logic.js](../../src/endpoints/accountAudit/account-audit-logic.js)
- [DS2_Backend/src/endpoints/analytics/analytics-service.js](../../src/endpoints/analytics/analytics-service.js)
- [DS2_Backend/src/endpoints/billingReview/cascadeEdit.js](../../src/endpoints/billingReview/cascadeEdit.js)
- [DS2_Backend/src/endpoints/customer/customer-router.js](../../src/endpoints/customer/customer-router.js)
- [DS2_Backend/src/endpoints/invoice/createInvoice/createInvoiceQueries.js](../../src/endpoints/invoice/createInvoice/createInvoiceQueries.js)
- [DS2_Backend/src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js](../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js)
- [DS2_Backend/src/endpoints/invoice/invoice-router.js](../../src/endpoints/invoice/invoice-router.js)
- [DS2_Backend/src/endpoints/invoice/invoice-service.js](../../src/endpoints/invoice/invoice-service.js)
- [DS2_Backend/src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js)
- [DS2_Backend/src/endpoints/invoice/invoiceEligibility/invoiceEligibility.js](../../src/endpoints/invoice/invoiceEligibility/invoiceEligibility.js)
- [DS2_Backend/src/endpoints/job/job-service.js](../../src/endpoints/job/job-service.js)
- [DS2_Backend/src/endpoints/pendingPayments/pendingPayments-router.js](../../src/endpoints/pendingPayments/pendingPayments-router.js)
- [DS2_Backend/src/endpoints/pendingPayments/pendingPayments-service.js](../../src/endpoints/pendingPayments/pendingPayments-service.js)
- [DS2_Backend/src/endpoints/recurringCustomer/recurringCustomer-router.js](../../src/endpoints/recurringCustomer/recurringCustomer-router.js)
- [DS2_Backend/src/endpoints/recurringCustomer/recurringCustomer-service.js](../../src/endpoints/recurringCustomer/recurringCustomer-service.js)
- [DS2_Backend/src/endpoints/transactions/sharedTransactionFunctions.js](../../src/endpoints/transactions/sharedTransactionFunctions.js)
- [DS2_Backend/src/endpoints/transactions/transactionPricing.js](../../src/endpoints/transactions/transactionPricing.js)
- [DS2_Backend/src/endpoints/transactions/transactionsObjects.js](../../src/endpoints/transactions/transactionsObjects.js)

### Backend tests and fixtures (14)

- [DS2_Backend/test/endpoints/accountAudit/review-future.spec.js](../../test/endpoints/accountAudit/review-future.spec.js)
- [DS2_Backend/test/endpoints/billingReview/_stubDb.js](../../test/endpoints/billingReview/_stubDb.js)
- [DS2_Backend/test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)
- [DS2_Backend/test/endpoints/invoice/review-writeoff.spec.js](../../test/endpoints/invoice/review-writeoff.spec.js)
- [DS2_Backend/test/endpoints/transactions/_fakeDb.js](../../test/endpoints/transactions/_fakeDb.js)
- [DS2_Backend/test/endpoints/transactions/transactionPricing.spec.js](../../test/endpoints/transactions/transactionPricing.spec.js)
- [DS2_Backend/test/integration/_review-fixture.js](../../test/integration/_review-fixture.js)
- [DS2_Backend/test/integration/clean-room-regression.integration.spec.js](../../test/integration/clean-room-regression.integration.spec.js)
- [DS2_Backend/test/integration/review-account-atomicity.integration.spec.js](../../test/integration/review-account-atomicity.integration.spec.js)
- [DS2_Backend/test/integration/review-customer-recurring.integration.spec.js](../../test/integration/review-customer-recurring.integration.spec.js)
- [DS2_Backend/test/integration/review-invoice-outcomes.integration.spec.js](../../test/integration/review-invoice-outcomes.integration.spec.js)
- [DS2_Backend/test/integration/review-job-family.integration.spec.js](../../test/integration/review-job-family.integration.spec.js)
- [DS2_Backend/test/integration/review-pending-files.integration.spec.js](../../test/integration/review-pending-files.integration.spec.js)
- [DS2_Backend/test/integration/review-transaction-policy.integration.spec.js](../../test/integration/review-transaction-policy.integration.spec.js)

### Frontend implementation and test (3)

- [DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js)
- [DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.payments.test.js](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.payments.test.js)
- [DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js)

### Documentation (17)

- [DS2_Backend/docs/README.md](../README.md)
- [DS2_Backend/docs/_review/findings.md](findings.md)
- [DS2_Backend/docs/_review/fixes-F8-F22.md](fixes-F8-F22.md)
- [DS2_Backend/docs/architecture.md](../architecture.md)
- [DS2_Backend/docs/invoicing/account-audit.md](../invoicing/account-audit.md)
- [DS2_Backend/docs/invoicing/analytics.md](../invoicing/analytics.md)
- [DS2_Backend/docs/invoicing/billing-review.md](../invoicing/billing-review.md)
- [DS2_Backend/docs/invoicing/create-invoice-engine.md](../invoicing/create-invoice-engine.md)
- [DS2_Backend/docs/invoicing/month-end-finalize.md](../invoicing/month-end-finalize.md)
- [DS2_Backend/docs/ledger/ledger-conventions.md](../ledger/ledger-conventions.md)
- [DS2_Backend/docs/ledger/pending-payments.md](../ledger/pending-payments.md)
- [DS2_Backend/docs/ledger/write-offs-and-adjustments.md](../ledger/write-offs-and-adjustments.md)
- [DS2_Backend/docs/platform/accounts-users-auth.md](../platform/accounts-users-auth.md)
- [DS2_Backend/docs/platform/storage-and-downloads.md](../platform/storage-and-downloads.md)
- [DS2_Backend/docs/work/customers.md](../work/customers.md)
- [DS2_Backend/docs/work/jobs.md](../work/jobs.md)
- [DS2_Backend/docs/work/transactions.md](../work/transactions.md)
