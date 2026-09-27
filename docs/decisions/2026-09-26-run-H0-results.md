# H0 results — integrated design and email/automation switches

Date: 2026-09-26. **H0 is complete locally. All 89 required validation commands exited successfully, with zero failures, skipped or pending tests.** No deployment, AWS call, real email, Git command or commit. Exact commands, environments, timestamps and per-command counts are in [validation-results.json](evidence/run-H0/acceptance/validation-results.json); aggregate counts are in [suite-counts.json](evidence/run-H0/acceptance/suite-counts.json).

## Delivered scope

- [Integrated design](2026-09-26-owner-requests-2.md): exact behavior/schema/API/UI/locks/audit/rolling balance/PDF/cutover/testing for entities, original obligations/receipt allocation/credit, corrections, recurring plans, reporting/cost snapshots and H6 navigation with old-to-new redirects. Planned H1–H8 routes/migrations are explicitly separate from implemented behavior. Settled owner decisions and excluded features remain intact.
- Two independent exact-string switches: production on unless false, all other environments off unless true. Shared `environmentSwitches.js` supplies policy. The actual sender gates before SES construction and missing-FROM_EMAIL validation; app startup and the orchestrator gate scheduled registration.
- Structured suppression log with subject, to/cc/bcc and UTC timestamp; optional EMAIL_OUTBOX_DIR creates unique private JSON files with body/HTML and attachment metadata only. Outbox errors warn and still resolve suppressed. Enabled SES payload/result/error behavior remains.
- All eight email paths retain the shared sender. Completion logs distinguish suppression/attempts from delivery. `.env.local` explicitly has false/false; `.env.example` documents switches/outbox. General test setup forces both off.

## Reviewable file inventory

Runtime: `src/utils/environmentSwitches.js`, `src/utils/email/sendEmail.js`, `src/app.js`, `src/automations/automationOrchestrator.js`, `src/automations/automationScripts/timeTrackerReminders.js`, `src/utils/email/sendSuccessEmail.js`, `src/utils/email/failureMessages.js`, and notification completion logs in `src/endpoints/timeTracking/timeTracking-router.js`.

Configuration: `.env.example` plus the local-only `.env.local`. Tests: `test/setup.js`, `test/automations.spec.js`, new `test/email-switches.spec.js`, `test/integration/path-matrix-07-tracker-storage.integration.spec.js`, `test/integration/path-matrix-15-defensive-faults.integration.spec.js`, `test/integration/tracker-excel-end-to-end.integration.spec.js`. No frontend application or Lambda source change. `DS2_Frontend/e2e/playwright.config.js` now uses text and JSON reporting after the installed HTML reporter overflowed twice after successful assertions; all tests, source locations and attachments remain enabled. The optional HTML format is not part of accepted output.

Acceptance commands/log summaries live under `docs/decisions/evidence/run-H0/acceptance`; `run-validation.py` executes every requested command serially, all 81 integration files individually with the required environment selection, then full scenario/clean-room/drift/Lambda/Jest/build/Playwright. Raw logs are locally retained and ignored. Code-only Graphify writes the existing graphify-out and Obsidian Graph outputs; source docs are mirrored with the existing sync script.

## Migrations, routes, screens and protected data

**No H0 migration, backfill or schema change. 028 remains free.** No new/removed route; existing 160 contracts and screens remain. The tracker-upload route's only H0 edit is log wording. No financial arithmetic, PDF, issued lock or audit-ledger mutation behavior changes. The outbox is an operational local file, not a financial posting or HTTP endpoint.

The final read-only account-1 census at `2026-09-26T08:05:21.838Z` matches both the H0 baseline and retained `ds2_ref_20260922` counts. The reference database was never connected to or touched; its comparison comes from retained run-6 evidence. [Final protected-data evidence](evidence/run-H0/acceptance/protected-account-counts.json):

| Table | Before / after / retained reference |
|---|---:|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

Account-1 audit events remain **0**. H0 intended migration effects on account-1 rows: **none, zero rows**. Historical migrations 019–027 and their previously recorded effects are pre-existing and unchanged by H0. All synthetic testing used the two disposable databases or fixture account 9001.

## Test changes and observed first-pass issue

`test/email-switches.spec.js` adds 72 tests, plus the existing automation schedule test: focused run 73/73. It covers every caller off/on with the actual sender and stubbed SES, production defaults/overrides, app/orchestrator gating, recipient/timestamp logging, absent sender configuration, concurrent private outbox files, I/O failures, enabled SES rejection and disabling a cached sender. The no-write suppression integration case brings H0's net additions to 73 tests.

The first full pass exposed three existing SES-failure injection tests in path-matrix07: email was now suppressed before reaching their injected send failure. They now explicitly opt into email **after installing their existing SES stub**, and restore the switch/stub together. Their rollback and committed-upload assertions are unchanged; the rerun passed29/29. The path-matrix15 missing-sender test explicitly uses on-mode, and an added off-mode case proves normal suppression with every DB table/audit event unchanged. The tracker Excel end-to-end notice-payload assertion needed the same explicit opt-in after its SES stub is installed; that original assertion remains. First attempts are retained in `first-pass-results.json`, `second-pass-results.json` and local ignored failure logs. After these adaptations and final truthful upload-log wording, the full acceptance was restarted on final code. No coverage was removed or silently skipped.

## Playwright report generation recovery

The first complete browser execution passed **114 tests,0 skipped,0 unexpected,0 flaky**, but the process exited1 afterward with `RangeError: Invalid string length` while building its HTML report. JSON results retained the passing test stats and top-level report error; no HTML index was created. This is not recorded as accepted command success. Evidence: [report failure](evidence/run-H0/acceptance/playwright-report-failure.json) and `validation-before-report-fix.json`.

The installed Playwright 1.63.0 HTML reporter's `noSnippets` option passed a one-test report smoke, but the next full 114-test execution still failed at HTML generation after every test passed ([second report failure](evidence/run-H0/acceptance/playwright-report-second-failure.json)). That option was removed. The final configuration uses the standard list and JSON reporters, retaining all test assertions, source locations and attachment files/paths. No report-rendering exception is ignored or converted to success. HTML export remains a tooling limitation, documented here rather than represented as working. The final full-suite run passed **114/114 with exit 0, no report errors and zero skipped, unexpected or flaky tests**; see [accepted browser summary](evidence/run-H0/acceptance/playwright-summary.json). The two earlier failed processes remain visible in the evidence and are not counted as accepted success.

## Runtime and documentation

The managed backend restart returned a newer `ok` acknowledgement; [request](evidence/run-H0/acceptance/restart-request.json) and [completion](evidence/run-H0/acceptance/restart-done.json) preserve timestamps. Backend health returned `{"status":"ok"}`. Both local switches remain false; no server was started/stopped directly.

Updated the assessment follow-up, operations, architecture, root README, docs README/endpoint-index note, time tracking/reminders, account-automation docs, scenario expectations/index, FINAL_REPORT production rollout note, e2e reporting instructions and the integrated design. Graphify code-only refresh: **484 source files, 1,990 nodes, 2,663 edges, 322 communities, 2,312 Obsidian notes; 0 model tokens**; local code extraction only. Workspace `DS2/MEMORY.md` records the verified H0 state separately from planned H1–H8 work. The existing sync script mirrors the documentation, final report and change log into `DS2_Notes`.

## Acceptance results

| Required validation | Final accepted result |
|---|---|
| Backend unit | **1,145 passed** |
| Integration, each file in its own process | **2,760 passed across 81 files** |
| Dedicated scenarios | **1,603 passed across 40 files** |
| Clean-room | **18 passed** |
| Read-only drift | **0 mismatches across 320 customers**, both engine/Audit and AR comparisons |
| Payment-image Lambda | **17 passed** |
| Frontend Jest | **264 tests in 49 suites passed** |
| Frontend production build | **Passed** |
| Full Playwright, external browser, 1 worker | **114 passed; exit 0; 0 report errors** |

Every accepted test command has **0 failures, 0 skipped and 0 pending**; Playwright also has **0 flaky** tests. Scenario and clean-room commands repeat integration coverage, so these counts must not be added as unique tests. The backend was restarted on final runtime code before acceptance; the only later configuration change was replacing the failed optional HTML reporter, followed by another full browser run. Final documentation-only edits do not alter the tested code.

H0 has no unresolved application defect or owner-only decision blocking completion. Optional Playwright HTML export remains a documented tooling limitation; text and JSON reports are working. Future entity/legacy mapping and recurring cutover choices have explicit defaults in the integrated design and remain work for the later runs. Nothing was deployed.
