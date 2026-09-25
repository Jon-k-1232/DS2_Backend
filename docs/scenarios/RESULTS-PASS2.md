# Pass 2 execution report — what-if situations and careless-user mistakes

**Current owner-rule update (2026-09-25):** this is a retained dated scenario report/catalogue. The original five decisions are now implemented; optional credit selection, sent locks/corrections, retainer events and duplicate review are governed by the [owner record](../decisions/2026-09-24-owner-decisions.md). See [run3 results](../decisions/2026-09-25-run-3-results.md) and [the combined lifecycle](16-owner-combined.md) for current verification. Decision6 is implemented in [run4](../decisions/2026-09-25-run-4-results.md), with its own [audit history oracle](18-audit-record.md).

Historical pass evidence below predates the owner decisions. Current behavior and complete rerun counts are in [owner run1 results](../decisions/2026-09-24-run-1-results.md); changed oracles are documented in [the design record](../decisions/2026-09-24-owner-decisions.md).

Verified locally on **2026-09-24T23:45:41-07:00**. **2,881 passing, 0 failing, 0 pending** across 59 suite reports: one unit run and all 58 integration files, each run separately. This includes **464 new Pass 2 tests in six files**, 254 Pass 1 scenarios, 1,006 unit tests, 1,139 other integration tests, and 18 clean-room tests. The guarded `npm run -s test:scenarios` now discovers both passes: **718 tests across 17 files**.

The [scenario document](what-if-and-mistakes.md) contains the expectations written before execution, corrections with reasons, and an index of every case's input, expected outcome and observed result. The application fixes and all regressions pass. Two policies directly exercised here remain **OPEN**: duplicate manual submissions still create separate events, and changing a used retainer does not create a cash-refund event. These are not silently counted as implemented protections.

## Scenarios covered

| New integration file | Cases | What was proved |
|---|---:|---|
| `scenario-what-if-01-values.integration.spec.js` | 308 | Create/edit amount, type, range, date, precision, text and optional-ID validation; signed credits; half-cent rounding; omitted metadata fields; Unicode; work-price arithmetic. |
| `scenario-what-if-02-retries.integration.spec.js` | 23 | Four duplicate-submit characterizations; precommit rollback/retry; twelve postcommit create/edit/delete refresh failures; storage failure and repeated finalize; read failure/recovery. |
| `scenario-what-if-03-history.integration.spec.js` | 25 | Cross-customer/tenant and stale/missing/deleted targets; linked-record deletion; billed changes; retainer draws; retained staff attribution; roles and sessions. |
| `scenario-what-if-04-calendar-races.integration.spec.js` | 13 | Phoenix 23:59/00:00, month/year/leap boundaries, invoice numbering and due dates in real PDFs; future-work cutoff; payment/edit during rendering; concurrent finalize. |
| `scenario-what-if-05-csv.integration.spec.js` | 13 | Formula prefixes, quoting, Unicode and numeric CSV fields; tenant/role isolation; database/read failures; 1 MiB body limit; malformed JSON. |
| `scenario-what-if-06-boundaries.integration.spec.js` | 82 | Nonobject payloads, malformed customer IDs, century leap rules, exact varchar/money limits, alias and sanitizer expansion, paid absorbed invoice, user-delete faults and race. |
| **Pass 2 total** | **464** | Each test may contain several HTTP requests, row assertions and refusal branches. |

Amounts are literal hand-computed values. For example, work 100 minus receipt 10 leaves 90; hold 100 minus draw 30 leaves 70, and increasing its starting amount to 120 leaves 90; signed 1.005 becomes -1.01; a new 20 charge plus 100 carried debt is 120. Tests use real authenticated Express routes, PostgreSQL transactions and local MinIO. Calendar statements are downloaded as real ZIP/PDF files and checked using `pdftotext`. Controlled seams supply clock instants or force database/storage/read failures; the ledger calculator is never used to manufacture expected numbers.

## Defects reproduced before correction

| Defect | Smallest correction and regression evidence |
|---|---|
| Explicit malformed values could be coerced into other values, ignored on edit, or reach SQL instead of returning a clean input refusal. | Shared raw-input validation before sanitization/mapping; validate again after escaping to enforce stored varchar limits. Require real dates, scalar IDs/amounts and valid text. Return actual HTTP 400 with no partial writes. V01–V07 and boundary matrices. Initial values run: 23 passing / 285 failing; malformed-body/customer-ID extension: 31 / 39. |
| Retainer rounding lost a cent when the credit sign was applied before rounding a half-cent magnitude. | Round the positive magnitude first, then negate, on create and edit. Literal ±0.005 → -0.01, ±1.005 → -1.01, 1.015 → -1.02, 2.675 → -2.68, 12.345 → -12.35. V02/V03 red-to-green tests. |
| A successful money mutation could be reported as failed when the subsequent grid refresh failed, encouraging another submission. | A postcommit response wrapper reports `status:200`, `committed:true` and a reload-without-resubmission warning. Payment/write-off/retainer/work create, edit and delete all have failure-injection tests. Initial retry run: 9 passing / 12 failing. Read-only failures retain their failure response. |
| Deleting a user matched to another uploader's timesheet could erase employee attribution through `ON DELETE SET NULL`. | Lock the user and refuse uploaded/matched timesheet or created/logged-for work history with HTTP 409. Preserve the user and every attribution; use deactivation. History and user/work race tests. |
| Updating or deleting a missing or foreign user falsely reported success. | Validate and lock the scoped target, return HTTP 404 `User not found.`, and preserve all other users. Missing, deleted, malformed and foreign IDs are tested. The confirmed history run reproduced deletion false-success and attribution loss: 23 passing / 2 failing. A later missing/deleted-user update probe separately reproduced two failures; all 82 boundary tests now pass, including malformed-ID refusal, successful update, database rollback and retry. |

The two existing acceptance assertions that explicitly expected missing-user update/deletion to return 200 (marked GAP) now require 404, the exact error message, and unchanged users. No financial assertion was weakened. [Application patch](evidence/pass2/application.diff) contains only this pass's application changes, compared with the pre-pass filesystem snapshot; no git command was used.

## Expectation and test corrections

- **Future-dated work:** one shared guide incorrectly said all unbilled work was included regardless of date. The starting source and the owning invoice guides already apply the Phoenix billing-date cutoff. The corrected safe oracle is 0 before the service dates, 10 on the first date, then 30 including carry on the next year's date. Every stage checks which work rows are stamped. The stale guide was corrected; the application cutoff was preserved.
- **Long text:** the initial expected note accidentally trimmed its final newline. The documented round-trip preserves it, so the assertion now requires the entire original Unicode note.
- **Fixture and observation mechanics:** supplied required timesheet columns before the deletion probe; matched existing public refusal wording; observed the actual blocked work INSERT in the deletion race. The generic financial fault helper correctly refused the users table, so user-update failure injection uses its own local database trigger. These corrections did not change money, refusal or unchanged-state expectations.
- **Implementation regressions caught during this pass:** the first postcommit wrapper also covered a shared read-only report; a failing regression required the read to remain a failure. Boundary tests then required null-primary write-off reason alias fallback and post-escaping varchar validation on create/edit. These were fixed before final verification.

Raw red logs are retained under [evidence/pass2/](evidence/pass2/), including `values-red.log`, `retries-red.log`, `history-red-confirmed.log`, `boundaries-red.log`, `read-refresh-red.log`, `validation-boundary-red.log`, and `missing-user-update-red-confirmed.log`. Earlier exploratory failures are retained and explained, not presented as application defects indiscriminately.

A final rerun exposed one `ECONNRESET` in the existing concurrent retainer-funded-entry test, after the application logged one success and the expected insufficient-funds refusal. The installed Supertest version automatically closes an implicit shared listener when its owning request finishes. This concurrency test now owns a loopback listener until both responses finish; its one-funded-entry, one-refusal, remaining-40 and exact row-count assertions are unchanged. The failed run is retained as `evidence/pass2/transport-reset.log` and `.json`; the corrected test is rerun in the final evidence. No running development server was changed.

## Happy and unhappy path evidence

Refusals compare all rows in eight customer/financial tables before and after; user cases additionally compare users/time attribution. Concurrent cases assert the permitted competing commit and refuse the stale operation. The existing lifecycle, authorization, integrity, rollback and finalize-race suites were all rerun.

The [coverage review](COVERAGE-PASS2.md) records **188/216 explicit refusal sites** executed across the reviewed lifecycle modules and changed routers/helpers. All ten new validation gates plus their common throw and all six user-router throws executed. **27/27 catch handlers in the changed application modules executed.** The 28 remaining explicit sites repeat an earlier mandatory refusal or defend internal service contracts; each is accounted for in the review. This is a scoped refusal inventory, not a claim of 100% repository branch coverage or every possible combination.

**API compatibility limit:** new invalid input returns HTTP 400. Many existing business-state refusals still use HTTP 200 with JSON `status:500`; the tests assert the transport and envelope explicitly. This pass does not redesign that established response convention. New postcommit warning behavior is verified at the API level; browser presentation is outside this API pass.

## OPEN business decisions

1. **Repeated manual submissions:** simultaneous identical payments, write-offs, retainers and work each create two events. Decide between persisted request-id replay protection, duplicate-review confirmation, or treating every submission as a new event. A time-window-only filter can discard legitimate repeated work. The tests characterize exact current balances and do not claim accidental duplicates are prevented.
2. **Retainer edits after draws / refunds:** increasing starting funds preserves draws; reducing below funds already drawn and deleting a used root refuse. A permitted reduction records no cash-refund event. Decide between a linked refund ledger, externally managed refund with audited correction, or forbidding post-use financial edits.

The other [Pass 1 OPEN decisions](RESULTS.md#open-business-decisions)—negative-balance statements, issued PDF correction/versioning, and NSF on billed retainer-funded work—remain unchanged. This local API pass does not resolve them or certify a deployment.

## Data isolation and protected account 1

The existing `.env.scenarios`, guarded reset and clean baseline were reused. Every new scenario entry point imports the scenario guard before application/database access. It enforces loopback PostgreSQL port 5433, the `ds2_scenarios*` name, the sandbox user, local MinIO port 9000 and approved local buckets; it rejects production/URL overrides and non-loopback TCP destinations. New dummy data exists only in `ds2_scenarios`. Optional AI calls are disabled. No production or AWS resources were contacted.

The required pre-existing integration suites used their local account-9001 fixture in `ds2_local`; the established clean-room command used `ds2_clean`. Protected account 1 in `ds2_local` and `ds2_ref_20260922` were accessed only for read-only checks. Running backend/frontend servers were not started, stopped or restarted. No git commands, commits or deployment were performed.

| Account-1 table | Before | After | Reference | Unchanged |
|---|---:|---:|---:|---|
| `customers` | 338 | 338 | 338 | Yes |
| `customer_transactions` | 39,052 | 39,052 | 39,052 | Yes |
| `customer_payments` | 1,005 | 1,005 | 1,005 | Yes |
| `customer_writeoffs` | 657 | 657 | 657 | Yes |
| `customer_invoices` | 2,253 | 2,253 | 2,253 | Yes |
| `timesheet_entries` | 28,255 | 28,255 | 28,255 | Yes |
| `users` | 23 | 23 | 23 | Yes |

The drift check found **0 engine-versus-audit differences for 319 active customers**, and **0 engine-versus-AR differences across 320 customers**, including one inactive customer with receivables. Read-only session options were enforced. [Protected counts](evidence/pass2/final/protected-counts.json) and [drift summary](evidence/pass2/final/drift-summary.log) retain the evidence. The detailed drift output is `/tmp/drift.json`; copied customer details were not added to the scenario documentation.

## Commands and exact suite counts

Commands ran sequentially; integration files ran one per process. JSON reporters and V8 instrumentation were added for evidence, without changing application logic. Concurrent HTTP requests appear only within deliberate race tests.

```sh
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js --recursive --exclude 'test/integration/**' test
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js test/integration/<file> --exit --timeout 180000
npm run -s test:cleanroom
npm run -s test:scenarios
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js /tmp/drift.json
```

Scenario files use the scenario runner's `.env.scenarios`, not `.env.local`; clean-room uses its established `.env.clean`. [Machine-readable counts](evidence/pass2/final/counts.json) and individual final JSON reports list exact test names, timing and results. All rows below have zero failures and zero pending tests.

| Suite / integration file | Passing | Failing | Pending |
|---|---:|---:|---:|
| `unit` | 1006 | 0 | 0 |
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
| `scenario-lifecycle-01-work.integration.spec.js` | 13 | 0 | 0 |
| `scenario-lifecycle-02-retainers.integration.spec.js` | 9 | 0 | 0 |
| `scenario-lifecycle-03-payments.integration.spec.js` | 7 | 0 | 0 |
| `scenario-lifecycle-04-writeoffs.integration.spec.js` | 6 | 0 | 0 |
| `scenario-lifecycle-05-monthend.integration.spec.js` | 7 | 0 | 0 |
| `scenario-lifecycle-06-cascade.integration.spec.js` | 8 | 0 | 0 |
| `scenario-lifecycle-07-refusals.integration.spec.js` | 122 | 0 | 0 |
| `scenario-lifecycle-08-failures.integration.spec.js` | 24 | 0 | 0 |
| `scenario-lifecycle-09-state-boundaries.integration.spec.js` | 21 | 0 | 0 |
| `scenario-lifecycle-10-integrity.integration.spec.js` | 22 | 0 | 0 |
| `scenario-lifecycle-11-finalize-races.integration.spec.js` | 15 | 0 | 0 |
| `scenario-what-if-01-values.integration.spec.js` | 308 | 0 | 0 |
| `scenario-what-if-02-retries.integration.spec.js` | 23 | 0 | 0 |
| `scenario-what-if-03-history.integration.spec.js` | 25 | 0 | 0 |
| `scenario-what-if-04-calendar-races.integration.spec.js` | 13 | 0 | 0 |
| `scenario-what-if-05-csv.integration.spec.js` | 13 | 0 | 0 |
| `scenario-what-if-06-boundaries.integration.spec.js` | 82 | 0 | 0 |
| **Total** | **2,881** | **0** | **0** |

## Files changed in this pass

Compared with the pre-pass filesystem snapshot; pre-existing work was retained. Evidence files are grouped separately to keep this list reviewable.

- `src/endpoints/payments/payment-logic.js` — modified.
- `src/endpoints/payments/payments-router.js` — modified.
- `src/endpoints/retainer/retainer-logic.js` — modified.
- `src/endpoints/retainer/retainer-router.js` — modified.
- `src/endpoints/transactions/transactions-router.js` — modified.
- `src/endpoints/user/user-router.js` — modified.
- `src/endpoints/writeOffs/writeOffs-router.js` — modified.
- `src/utils/committedResponse.js` — added.
- `src/utils/ledgerInput.js` — added.
- `scripts/scenarios/run.js` — modified.
- `test/integration/coverage-account-users-auth-misc.integration.spec.js` — modified.
- `test/integration/transactions-ledger-seams.integration.spec.js` — modified.
- `test/integration/scenario-what-if-01-values.integration.spec.js` — added.
- `test/integration/scenario-what-if-02-retries.integration.spec.js` — added.
- `test/integration/scenario-what-if-03-history.integration.spec.js` — added.
- `test/integration/scenario-what-if-04-calendar-races.integration.spec.js` — added.
- `test/integration/scenario-what-if-05-csv.integration.spec.js` — added.
- `test/integration/scenario-what-if-06-boundaries.integration.spec.js` — added.
- `docs/README.md` — modified.
- `docs/ledger/ledger-conventions.md` — modified.
- `docs/ledger/payments.md` — modified.
- `docs/ledger/retainers-and-prepayments.md` — modified.
- `docs/ledger/write-offs-and-adjustments.md` — modified.
- `docs/platform/accounts-users-auth.md` — modified.
- `docs/scenarios/COVERAGE-PASS2.md` — added.
- `docs/scenarios/README.md` — modified.
- `docs/scenarios/RESULTS-PASS2.md` — added.
- `docs/scenarios/what-if-and-mistakes.md` — added.
- `docs/work/transactions.md` — modified.

- `docs/scenarios/evidence/pass2/` — red/green logs, final per-suite JSON reports, counts, app-only V8 profiles, refusal/catch inventories, protected-data/drift evidence, source diff and file hashes.

The scenario environment and reset helper were reused unchanged. The runner change adds discovery of `scenario-what-if*.integration.spec.js` while keeping one-file-at-a-time execution.
