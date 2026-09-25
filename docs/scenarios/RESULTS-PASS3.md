# Pass 3 results — API happy/unhappy path matrix

Verified locally on 2026-09-25. **The API matrix is proved; live-browser acceptance remains OPEN because Chromium could not launch in the macOS sandbox.** All backend tests and frontend component tests passed. No owner business decision is pending from this pass.

Finalize remains the sent/lock boundary. Drafts remain editable and write nothing to the ledger. The owner's 2026-09-25 confirmation is preserved; no billing formula or lock boundary was changed.

## Scope and matrix totals

- **160 routes / 30 mounts**, including every one of the 135 historical entries in `test/COVERAGE_MATRIX.md` and 25 newer mounted routes. There are **158 observed successful contracts and 2 intentional 410 contracts**.
- **898 explicit failure sites**: **793 reachable sites proved**, **76 unreachable defensive sites**, and **29 startup, scheduled-only or unused helper sites outside HTTP scope**. Each excluded site has an individual explanation. **0 reachable sites remain unproved** under this source-site inventory.
- **202 reachable sites newly proved**, plus per-route authentication/tenant/role checks; **707 new API/service tests in 16 files**. Existing coverage, review, lifecycle and what-if tests are reused and named.
- [Full route matrix, failure catalog and exact test names](path-matrix.md); [hand-written expectations and corrections](path-matrix-expectations.md); [machine-readable source inventory](evidence/pass3/route-inventory.json); [test-to-branch mapping](evidence/pass3/path-matrix-map.json).

A site is an explicit throw, error response, validation-result emission, catch body or promise rejection callback. A catch and its response count separately. This count is not the number of distinct user journeys or all possible input combinations. Named assertions establish the business outcomes; execution attribution establishes which source site those passing tests reached. Library-level JSON parsing, size limits, rate limits and async forwarding have additional named assertions in the matrix.

The matrix covers CRUD and dependent-row conflicts; permissions, self and tenant scope; malformed/missing/foreign records; concurrent/stale writes; pending-payment approval; tracker template/upload/ingestion/storage; invoice preview/finalize/download; Audit and AR; sent locks and bounced-payment exceptions; retainer adjustments/refunds; duplicates; optional credit statements; six-minute time boundaries; and immutable Audit Record printing, reopening, verification and refused tampering.

New refusals compare every public scenario table using sorted row counts/digests, including audit and queue metadata. Consumed PostgreSQL sequence values are not committed business rows. Intentionally requested failed audit reports, optional-service fallbacks and confirmed postcommit outcomes are asserted as such, rather than incorrectly requiring them to leave no requested result.

## Defects found and fixed

Failing tests preceded each application-code correction. Archived red runs include both real defects and fixture/expectation corrections; only the following are application defects.

| Defect | Correct behavior and fix | Proving tests / original failure evidence |
|---|---|---|
| A committed CRUD operation could return a failure if refreshing its response tables failed, inviting a duplicate retry. | Use the existing committed-response pattern consistently across eight CRUD areas, pending-payment actions and allowed unissued invoice deletion. Report HTTP/JSON 200, `committed: true`, and a reload/do-not-resubmit warning. Exactly the requested mutation remains committed. The warning also appears in `message` for existing forms; shared category/type/job messages accurately say changes were saved. | `path-matrix-03` (24 cases), the three postcommit cases in `path-matrix-06`, and `DELETE invoice \| postcommit refresh failure reports exactly one saved deletion` in `path-matrix-09`; [CRUD red](evidence/pass3/commits-red-confirmed.log), [pending red](evidence/pass3/pending-red-confirmed.log), [invoice red](evidence/pass3/ledger-red-confirmed.log). The two older job-type unit expectations now assert this saved outcome. An additional [24-case message red run](evidence/pass3/form-message-red.log) and [green run](evidence/pass3/form-message-green.log) prove the form-visible guidance. The additional [job-message red run](evidence/pass3/job-message-red.log) proves the correction of the shared job response. |
| The asynchronous sent-lock/duplicate-status decorator could report 500 after work or issuance had committed. | Remember the committed outcome through response middleware and return a safe success warning if decoration fails. Omit ledger rows whose lock state could not be loaded; preserve download location, skipped-customer identities and committed invoice IDs. A read-only failure still returns 500 with no writes. | `path-matrix-14`: failed read/root lookup, one $10 charge over $100, one finalized/sent $110 invoice, and a partial batch with exactly one new $50 invoice. [Original red](evidence/pass3/response-decoration-red.log); [metadata regression red](evidence/pass3/response-metadata-red.log); [focused green](evidence/pass3/response-metadata-green.log). |
| Account Audit PDF errors could be returned with PDF/attachment headers even though the body was a JSON error. | Set PDF headers only after valid PDF bytes exist. Invalid stored report or rendering failure returns JSON 500 and preserves all rows. | `path-matrix-08`: `GET audit PDF \| malformed report returns JSON 500 without writes or PDF headers` and `GET audit PDF \| renderer failure returns JSON 500 without writes`; [red](evidence/pass3/reports-red.log), [green](evidence/pass3/reports-green.log). |
| A year-end ZIP failure could leave a hanging or incomplete response. | Abort/unpipe the archive; before headers, return JSON 500 without attachment headers; after streaming starts, terminate the response. A truncated ZIP must not be reported as a completed download. | `path-matrix-08`: archive event and synchronous throw before bytes, plus late failure after initial bytes. The late-failure assertion distinguishes server termination from a client timeout; [red](evidence/pass3/reports-red.log), [green](evidence/pass3/reports-green.log). |

The source changes are confined to response/error handling and its callers. Existing invoice arithmetic, sent-lock triggers, actor attribution, immutable evidence and the owner decisions retain their prior behavior.

## Expectations corrected, with reasons

1. Tracker upload uses a fixed generic unexpected-error message. The original fault test expected injected diagnostic text; it now asserts the actual documented generic 500 plus unchanged rows.
2. The reviewer-note redaction helper catches Comprehend failure internally and performs deterministic redaction. The corrected email fixture expects exactly `Contact [REDACTED_EMAIL]`, no original training notes, and the requested ledger edit. Expecting a null from an outer catch was wrong.
3. Some legacy stale/missing ledger operations deliberately return HTTP 200 with JSON status 500. Tests now assert both values, the exact refusal message and no writes. They are not counted as happy outcomes.
4. Background ingestion is accepted with 202. Invoice preview only renders a PDF when the draft option is selected. Tests were corrected to exercise those contracts, without changing the application.
5. The 6-minute ingestion fixture stores `duration_minutes = 6` in training and `quantity = 0.1` at $100/hour in the transaction: exactly $10. A nonexistent `transaction.minutes` field was not an appropriate assertion.
6. Revision fixtures must include the required issued-invoice linkage and schema fields; corrupt legacy fixtures are created explicitly when corruption is the condition under test. Binary workbook downloads are parsed as bytes, and audit unexpected errors use their documented generic message.
7. Full-table snapshot rows are sorted by table name because PostgreSQL may run UNION arms in parallel. The row digests/counts remain exact; only nondeterministic result ordering was corrected.

## Exact final validation

Every backend integration file ran in its own process, serially. Files first instrumented before the inventory included dynamically selected error statuses were repeated to complete precise attribution; the table counts only the last result for each file. No test processes ran concurrently. These final runs follow the last application change; redundant npm command runs intentionally overlap the same tests and are not added to the unique total.

| Run | Files/suites | Passing | Failing | Pending/not run |
|---|---:|---:|---:|---:|
| Backend unit command | 262 suites | 1067 | 0 | 0 |
| Every `test/integration/*.integration.spec.js`, one process each | 81 files | 2759 | 0 | 0 |
| Backend unit + integration, without repeated command runs | 82 suite results | 3826 | 0 | 0 |
| `npm run -s test:cleanroom` (repeat) | 1 file | 18 | 0 | 0 |
| `npm run -s test:scenarios` (repeat) | 40 files | 1602 | 0 | 0 |
| Frontend component tests | 40 suites | 184 | 0 | 0 |
| New real-browser owner-decision checks | 5 tests | 0 | 1 launch failure | 4 not run |

Commands used:

```sh
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js --recursive --exclude 'test/integration/**' test
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js test/integration/<file> --exit --timeout 180000
npm run -s test:cleanroom
npm run -s test:scenarios
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local PGOPTIONS='-c default_transaction_read_only=on' node scripts/drift-check.js /tmp/drift.json
```

For individual scenario/path-matrix files, `DS2_ENV_FILE=.env.scenarios`; the clean-room file uses `.env.clean`. The final per-file pass adds a local Mocha reporter to capture exact test names, observed HTTP contracts and V8 source-site execution. It does not change test inputs/assertions. [Structured per-suite results](evidence/pass3/final/summary.json), [clean-room command log](evidence/pass3/cleanroom-command.log), [scenario command log](evidence/pass3/scenarios-command.log), and [frontend results](evidence/pass3/frontend-unit.json) are retained.

### Every integration file

| File | Environment | Passed | Failed | Pending |
|---|---|---:|---:|---:|
| [analytics.integration.spec.js](../../test/integration/analytics.integration.spec.js) | `.env.local` | 11 | 0 | 0 |
| [billing-regression.integration.spec.js](../../test/integration/billing-regression.integration.spec.js) | `.env.local` | 2 | 0 | 0 |
| [cascade-edit-recompute.integration.spec.js](../../test/integration/cascade-edit-recompute.integration.spec.js) | `.env.local` | 11 | 0 | 0 |
| [clean-room-regression.integration.spec.js](../../test/integration/clean-room-regression.integration.spec.js) | `.env.clean` | 18 | 0 | 0 |
| [coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js) | `.env.local` | 200 | 0 | 0 |
| [coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js) | `.env.local` | 31 | 0 | 0 |
| [coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js) | `.env.local` | 36 | 0 | 0 |
| [coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js) | `.env.local` | 131 | 0 | 0 |
| [coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js) | `.env.local` | 124 | 0 | 0 |
| [coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js) | `.env.local` | 102 | 0 | 0 |
| [coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js) | `.env.local` | 10 | 0 | 0 |
| [coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js) | `.env.local` | 106 | 0 | 0 |
| [coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js) | `.env.local` | 84 | 0 | 0 |
| [finalize-engine.integration.spec.js](../../test/integration/finalize-engine.integration.spec.js) | `.env.local` | 15 | 0 | 0 |
| [finalize-snapshot.integration.spec.js](../../test/integration/finalize-snapshot.integration.spec.js) | `.env.local` | 9 | 0 | 0 |
| [month-end-lifecycle.integration.spec.js](../../test/integration/month-end-lifecycle.integration.spec.js) | `.env.local` | 19 | 0 | 0 |
| [orchestrator.integration.spec.js](../../test/integration/orchestrator.integration.spec.js) | `.env.local` | 7 | 0 | 0 |
| [path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js) | `.env.scenarios` | 437 | 0 | 0 |
| [path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js) | `.env.scenarios` | 43 | 0 | 0 |
| [path-matrix-03-commit-outcomes.integration.spec.js](../../test/integration/path-matrix-03-commit-outcomes.integration.spec.js) | `.env.scenarios` | 24 | 0 | 0 |
| [path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js) | `.env.scenarios` | 29 | 0 | 0 |
| [path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js) | `.env.scenarios` | 27 | 0 | 0 |
| [path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js) | `.env.scenarios` | 12 | 0 | 0 |
| [path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js) | `.env.scenarios` | 29 | 0 | 0 |
| [path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js) | `.env.scenarios` | 11 | 0 | 0 |
| [path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js) | `.env.scenarios` | 17 | 0 | 0 |
| [path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js) | `.env.scenarios` | 14 | 0 | 0 |
| [path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js) | `.env.scenarios` | 20 | 0 | 0 |
| [path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js) | `.env.scenarios` | 7 | 0 | 0 |
| [path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js) | `.env.scenarios` | 9 | 0 | 0 |
| [path-matrix-14-response-decoration.integration.spec.js](../../test/integration/path-matrix-14-response-decoration.integration.spec.js) | `.env.scenarios` | 5 | 0 | 0 |
| [path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js) | `.env.scenarios` | 13 | 0 | 0 |
| [path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js) | `.env.scenarios` | 10 | 0 | 0 |
| [payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js) | `.env.local` | 49 | 0 | 0 |
| [pii-leak.integration.spec.js](../../test/integration/pii-leak.integration.spec.js) | `.env.local` | 2 | 0 | 0 |
| [review-account-atomicity.integration.spec.js](../../test/integration/review-account-atomicity.integration.spec.js) | `.env.local` | 4 | 0 | 0 |
| [review-analytics-identities.integration.spec.js](../../test/integration/review-analytics-identities.integration.spec.js) | `.env.local` | 2 | 0 | 0 |
| [review-audit-download.integration.spec.js](../../test/integration/review-audit-download.integration.spec.js) | `.env.local` | 4 | 0 | 0 |
| [review-audit-filter.integration.spec.js](../../test/integration/review-audit-filter.integration.spec.js) | `.env.local` | 3 | 0 | 0 |
| [review-customer-delete.integration.spec.js](../../test/integration/review-customer-delete.integration.spec.js) | `.env.local` | 4 | 0 | 0 |
| [review-customer-recurring.integration.spec.js](../../test/integration/review-customer-recurring.integration.spec.js) | `.env.local` | 8 | 0 | 0 |
| [review-customer-response.integration.spec.js](../../test/integration/review-customer-response.integration.spec.js) | `.env.local` | 2 | 0 | 0 |
| [review-initial-data-roles.integration.spec.js](../../test/integration/review-initial-data-roles.integration.spec.js) | `.env.local` | 18 | 0 | 0 |
| [review-invoice-outcomes.integration.spec.js](../../test/integration/review-invoice-outcomes.integration.spec.js) | `.env.local` | 4 | 0 | 0 |
| [review-job-family.integration.spec.js](../../test/integration/review-job-family.integration.spec.js) | `.env.local` | 4 | 0 | 0 |
| [review-job-selection.integration.spec.js](../../test/integration/review-job-selection.integration.spec.js) | `.env.local` | 2 | 0 | 0 |
| [review-pending-files.integration.spec.js](../../test/integration/review-pending-files.integration.spec.js) | `.env.local` | 7 | 0 | 0 |
| [review-rate-agreements.integration.spec.js](../../test/integration/review-rate-agreements.integration.spec.js) | `.env.local` | 10 | 0 | 0 |
| [review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js) | `.env.local` | 24 | 0 | 0 |
| [review-retainer-dates.integration.spec.js](../../test/integration/review-retainer-dates.integration.spec.js) | `.env.local` | 1 | 0 | 0 |
| [review-statement-snapshot.integration.spec.js](../../test/integration/review-statement-snapshot.integration.spec.js) | `.env.local` | 1 | 0 | 0 |
| [review-template-storage.integration.spec.js](../../test/integration/review-template-storage.integration.spec.js) | `.env.local` | 1 | 0 | 0 |
| [review-tracker-outcome.integration.spec.js](../../test/integration/review-tracker-outcome.integration.spec.js) | `.env.local` | 1 | 0 | 0 |
| [review-transaction-policy.integration.spec.js](../../test/integration/review-transaction-policy.integration.spec.js) | `.env.local` | 22 | 0 | 0 |
| [review-user-guards.integration.spec.js](../../test/integration/review-user-guards.integration.spec.js) | `.env.local` | 7 | 0 | 0 |
| [scenario-lifecycle-01-work.integration.spec.js](../../test/integration/scenario-lifecycle-01-work.integration.spec.js) | `.env.scenarios` | 13 | 0 | 0 |
| [scenario-lifecycle-02-retainers.integration.spec.js](../../test/integration/scenario-lifecycle-02-retainers.integration.spec.js) | `.env.scenarios` | 9 | 0 | 0 |
| [scenario-lifecycle-03-payments.integration.spec.js](../../test/integration/scenario-lifecycle-03-payments.integration.spec.js) | `.env.scenarios` | 7 | 0 | 0 |
| [scenario-lifecycle-04-writeoffs.integration.spec.js](../../test/integration/scenario-lifecycle-04-writeoffs.integration.spec.js) | `.env.scenarios` | 6 | 0 | 0 |
| [scenario-lifecycle-05-monthend.integration.spec.js](../../test/integration/scenario-lifecycle-05-monthend.integration.spec.js) | `.env.scenarios` | 7 | 0 | 0 |
| [scenario-lifecycle-06-cascade.integration.spec.js](../../test/integration/scenario-lifecycle-06-cascade.integration.spec.js) | `.env.scenarios` | 9 | 0 | 0 |
| [scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js) | `.env.scenarios` | 122 | 0 | 0 |
| [scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js) | `.env.scenarios` | 24 | 0 | 0 |
| [scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js) | `.env.scenarios` | 21 | 0 | 0 |
| [scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js) | `.env.scenarios` | 22 | 0 | 0 |
| [scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js) | `.env.scenarios` | 15 | 0 | 0 |
| [scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js) | `.env.scenarios` | 72 | 0 | 0 |
| [scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js) | `.env.scenarios` | 24 | 0 | 0 |
| [scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js) | `.env.scenarios` | 23 | 0 | 0 |
| [scenario-lifecycle-15-credit-statements.integration.spec.js](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js) | `.env.scenarios` | 11 | 0 | 0 |
| [scenario-lifecycle-16-owner-combined.integration.spec.js](../../test/integration/scenario-lifecycle-16-owner-combined.integration.spec.js) | `.env.scenarios` | 4 | 0 | 0 |
| [scenario-lifecycle-17-time-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js) | `.env.scenarios` | 10 | 0 | 0 |
| [scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js) | `.env.scenarios` | 32 | 0 | 0 |
| [scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js) | `.env.scenarios` | 308 | 0 | 0 |
| [scenario-what-if-02-retries.integration.spec.js](../../test/integration/scenario-what-if-02-retries.integration.spec.js) | `.env.scenarios` | 23 | 0 | 0 |
| [scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js) | `.env.scenarios` | 25 | 0 | 0 |
| [scenario-what-if-04-calendar-races.integration.spec.js](../../test/integration/scenario-what-if-04-calendar-races.integration.spec.js) | `.env.scenarios` | 13 | 0 | 0 |
| [scenario-what-if-05-csv.integration.spec.js](../../test/integration/scenario-what-if-05-csv.integration.spec.js) | `.env.scenarios` | 13 | 0 | 0 |
| [scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js) | `.env.scenarios` | 82 | 0 | 0 |
| [tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js) | `.env.local` | 33 | 0 | 0 |
| [transactions-ledger-seams.integration.spec.js](../../test/integration/transactions-ledger-seams.integration.spec.js) | `.env.local` | 28 | 0 | 0 |

## Data protection and drift

New API/service suites load the scenario guard before the application and rebuild only `ds2_scenarios`. The idempotent reset reuses the clean schema, migrations 019–027 and synthetic seed. `.env.scenarios` and the reset existed from the earlier passes and were reused. Only loopback PostgreSQL port 5433 with a `ds2_scenarios*` name and local MinIO port 9000 are admitted; external TCP is refused. Optional provider failures use local SDK/service stubs. The new UI file has a separate loopback/account-9001 guard.

Existing integration suites ran in their prescribed `.env.local` fixture account 9001 or `.env.clean`. No running backend/frontend server was started, stopped or restarted. No git command, commit, production/AWS connection or production mutation was performed. The only reads of the protected databases for final verification used PostgreSQL read-only sessions.

Drift: **319 engine-versus-Audit comparisons, 0 differences; 320 engine-versus-AR comparisons, 0 differences**. [Drift result](evidence/pass3/drift.json).

Account-1 row counts below are identical before and after, and match `ds2_ref_20260922`. [Before](evidence/pass3/protected-before.json), [after](evidence/pass3/protected-after.json).

| Table | ds2_local before | ds2_local after | Reference after |
|---|---:|---:|---:|
| `customers` | 338 | 338 | 338 |
| `customer_transactions` | 39,052 | 39,052 | 39,052 |
| `customer_payments` | 1,005 | 1,005 | 1,005 |
| `customer_writeoffs` | 657 | 657 | 657 |
| `customer_invoices` | 2,253 | 2,253 | 2,253 |
| `timesheet_entries` | 28,255 | 28,255 | 28,255 |
| `users` | 23 | 23 | 23 |

## OPEN items

**Business decisions: none introduced by this pass.** The recorded owner decisions remain authoritative, including finalize = sent.

**OPEN — live-browser execution.** Chromium exited before the first test body with `bootstrap_check_in ... Permission denied (1100)`. The managed environment does not permit escalation. Five guarded checks have been added for draft/finalize/lock/reprint, retainer refund/refusal, locked duplicate removal refusal, immutable Audit Record print/reopen and employee isolation. Their observed outcome is one infrastructure failure and four not run; they are not claimed as passing. [Launch log](evidence/pass3/browser-blocked.log). Existing component coverage passed for those screens, credit-statement controls and time boundaries; this is not a substitute for a completed live-browser run.

When Chromium is allowed to launch in the local development environment, with the existing local servers still running, execute from `DS2_Frontend/e2e`:

```sh
npm test -- tests/path-matrix-owner-decisions.spec.js --workers=1
```

Do not close this operational item until all five bodies have actually passed.

## Files changed

Compared by SHA-256 to the pre-pass snapshot; no git was used. Updated existing files:

- [docs/invoicing/account-audit.md](../../docs/invoicing/account-audit.md)
- [docs/invoicing/analytics.md](../../docs/invoicing/analytics.md)
- [docs/invoicing/invoices.md](../../docs/invoicing/invoices.md)
- [docs/ledger/pending-payments.md](../../docs/ledger/pending-payments.md)
- [docs/platform/accounts-users-auth.md](../../docs/platform/accounts-users-auth.md)
- [docs/scenarios/README.md](../../docs/scenarios/README.md)
- [docs/work/customers.md](../../docs/work/customers.md)
- [docs/work/job-categories-and-types.md](../../docs/work/job-categories-and-types.md)
- [docs/work/jobs.md](../../docs/work/jobs.md)
- [docs/work/quotes.md](../../docs/work/quotes.md)
- [docs/work/work-descriptions.md](../../docs/work/work-descriptions.md)
- [scripts/scenarios/run.js](../../scripts/scenarios/run.js)
- [src/endpoints/accountAudit/account-audit-router.js](../../src/endpoints/accountAudit/account-audit-router.js)
- [src/endpoints/analytics/analytics-router.js](../../src/endpoints/analytics/analytics-router.js)
- [src/endpoints/customer/customer-router.js](../../src/endpoints/customer/customer-router.js)
- [src/endpoints/invoice/invoice-router.js](../../src/endpoints/invoice/invoice-router.js)
- [src/endpoints/invoice/sentInvoiceLocks.js](../../src/endpoints/invoice/sentInvoiceLocks.js)
- [src/endpoints/job/job-router.js](../../src/endpoints/job/job-router.js)
- [src/endpoints/jobCategories/jobCategories-router.js](../../src/endpoints/jobCategories/jobCategories-router.js)
- [src/endpoints/jobType/jobType-router.js](../../src/endpoints/jobType/jobType-router.js)
- [src/endpoints/pendingPayments/pendingPayments-router.js](../../src/endpoints/pendingPayments/pendingPayments-router.js)
- [src/endpoints/quotes/quotes-router.js](../../src/endpoints/quotes/quotes-router.js)
- [src/endpoints/recurringCustomer/recurringCustomer-router.js](../../src/endpoints/recurringCustomer/recurringCustomer-router.js)
- [src/endpoints/user/user-router.js](../../src/endpoints/user/user-router.js)
- [src/endpoints/workDescriptions/workDescriptions-router.js](../../src/endpoints/workDescriptions/workDescriptions-router.js)
- [src/utils/committedResponse.js](../../src/utils/committedResponse.js)
- [test/COVERAGE_MATRIX.md](../../test/COVERAGE_MATRIX.md)
- [test/endpoints/jobType/review-refresh.spec.js](../../test/endpoints/jobType/review-refresh.spec.js)

New implementation/test/report files:

- [../DS2_Frontend/e2e/tests/path-matrix-owner-decisions.spec.js](../../../DS2_Frontend/e2e/tests/path-matrix-owner-decisions.spec.js)
- [docs/scenarios/RESULTS-PASS3.md](../../docs/scenarios/RESULTS-PASS3.md)
- [docs/scenarios/path-matrix-expectations.md](../../docs/scenarios/path-matrix-expectations.md)
- [docs/scenarios/path-matrix.md](../../docs/scenarios/path-matrix.md)
- [test/fixtures/path-matrix-routes.json](../../test/fixtures/path-matrix-routes.json)
- [test/integration/_path-matrix.js](../../test/integration/_path-matrix.js)
- [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)
- [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)
- [test/integration/path-matrix-03-commit-outcomes.integration.spec.js](../../test/integration/path-matrix-03-commit-outcomes.integration.spec.js)
- [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)
- [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)
- [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)
- [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)
- [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)
- [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)
- [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)
- [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)
- [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)
- [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)
- [test/integration/path-matrix-14-response-decoration.integration.spec.js](../../test/integration/path-matrix-14-response-decoration.integration.spec.js)
- [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)
- [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

Evidence artifacts are under [`docs/scenarios/evidence/pass3/`](evidence/pass3/), including each final spec log and structured report, preserved red/green runs, inventory, mappings, source hashes, drift and protected counts. The existing scenario-18 suite also refreshed its synthetic run-5 acceptance artifacts as designed. No dependency or migration was added in this pass.
