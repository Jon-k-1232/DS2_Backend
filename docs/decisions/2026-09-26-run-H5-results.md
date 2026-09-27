# Run H5 — honest analytics

2026-09-26. Local implementation of owner request 8, continuing the interrupted H5 attempt. Production deployment is outside this run. [Design](2026-09-26-owner-requests-2.md), [report/API rules](../invoicing/analytics.md), [hand-computed scenarios](../scenarios/H5-honest-analytics.md).

## Delivered behavior

Reporting definition version 2 separates work entered, eligible unbilled WIP, gross/net issued charges, applied receipt collections, cash received, write-offs, prebill concessions, credit memos, void/rebill, refunds and held credit. Balance forward, drafts and child snapshots create no new revenue. Realizations use the same issued cohort for their numerator/denominator. Margin uses supporting actual minutes and preserved staff cost. Zero denominators yield N/A; unknown supporting cost makes margin unavailable. Charges do not invent labor hours.

All six analytics screens and the year-end packet support one business or totals. Historical effort uses immutable H2 tracker reporting attribution; unknown/ambiguous work is explicitly unattributed. Worked-for and billed-by are displayed together without moving balances, credits or issued records. Inactive staff/businesses remain reportable. Service dates, issue/effective dates, As of and Recorded through remain distinct; repeatable-read exports carry the same definitions/cutoffs. Pre-audit history cannot be reconstructed and is labeled accordingly.

New work captures the logged-for staff's cost at first recording. Tracker upload uses its validated owner rather than the uploader or a potentially ambiguous display name. Approval retains that cost through later staff-rate changes. Quantity-only duration remains estimated; manual forms preserve their supplied actual minutes. Held-review/manual-move/AI-rerun corrections record corrected actual minutes and require a reason for known employee reassignment. Failures roll back source corrections, financial writes and audit events together. Issued work remains locked. Existing read/ordinary entry permissions and H3 admin-only adjustments are unchanged; no period-close or approval workflow was added.

## Routes and screens

- New reads: `GET /analytics/billingPerformance/:accountID/:userID` and `GET /analytics/billingPerformance/:accountID/:userID/export` (CSV/PDF). Analytics owns 12 endpoint contracts; the README index contains 218 total contracts.
- Existing client-rates, time-allocation, WIP, job-budgets, tax-capacity, CSV and year-end ZIP contracts now use reconciled definitions and business/cutoff filters. Analytics remains session-account-scoped and Super Admin only. Existing rate agreements retain their own audited write contract.
- New `/reports/billing-performance`, with `/analytics/billingPerformance` compatibility. The page uses the shared paginated grid, business totals, cohort/work attribution, provenance and exports. Five existing analytics pages carry the matching labels/filters and a detail link.
- Customer exclusions persist per account and suppress stale account loads. Work edit and held-review forms request employee-change reasons and preserve inputs after errors. Business settings retain a new draft through delayed list loading. Transaction PUT failures use meaningful HTTP statuses; unchanged create endpoints retain their legacy status envelopes.

## Migrations and exact protected-data effects

045 was already applied by the interrupted attempt. Its saved logs and live function were inspected before continuation. It was not rewritten. Forward migration 046 repairs reviewed staff/minutes and actual manual duration by replacing only the capture function. Both files are plain idempotent SQL, manually applied to ds2_local, ds2_clean and ds2_scenarios at 127.0.0.1:5433 with `psql -X -1 -v ON_ERROR_STOP=1 -f`. Scenario reset discovers both; migration specs cover idempotence, original-row preservation, reasoned reassignment, unknown rates and audit guards. Inventory: 45 runnable migrations, 002–046; next free 047.

045 adds nullable cost/source/timestamp, actual-duration/source, billing-rate and standard-value columns to work/tracker tables, a unique source tracker FK and the immutable audited `legacy_work_cost_estimates` sidecar. No original historical field was backfilled. Account 1 effects:

| Effect | Exact count |
|---|---:|
| Transaction estimate sidecars | 39,052 |
| Of those, exact source-tracker actual durations | 15,422 |
| Of those, estimated quantity durations | 23,630 |
| Tracker estimate sidecars with actual durations | 28,255 |
| Total immutable estimate sidecars | 67,307 |
| Matching system audit insert events | 67,307 |
| Original fields/rows changed | 0 |
| Historical rows with nonnull new provenance columns | 0 |
| Additional row changes by 046 | 0 |

All account-1 sidecar rates are known migration-time rates labeled **estimated**. Migration source is `migration/045.work_cost_snapshots`, actor is system, and the exact reason is “Snapshot known labor rates once as estimates; preserve historical work and issued records”. The original 139,965 audit events are unchanged and the resulting 207,272-event chain verifies. Original digests for ten business tables remain unchanged.

| Protected source table | Before / after / retained reference |
|---|---:|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

Reference matching uses the retained H2–H4 census; ds2_ref_20260922 was never connected. [Read-only verification](evidence/run-H5/account1-verification.json), [before](evidence/run-H5/account1-before.json), [after](evidence/run-H5/account1-after.json). Future rollout must pause source writers, apply 045 then 046 after H1–H4, deploy matching code and verify before resuming: [operations](../platform/operations.md#h5-rollout--honest-analytics-and-cost-provenance), [final report](../../scripts/review-2026-09/FINAL_REPORT.md#18-h5--honest-analytics-and-cost-provenance-2026-09-26-local-implementation).

## Scenario evidence and continuation repairs

The primary oracle is $300 work entered, $100 WIP, $200 gross billed less $20 prebill concession and $20 memo = $160 net billed; receipt application $120, bad debt $10, cost $60, margin $100/62.5%, billing and collection realization 80%. A staff rate change affects only new work. Empty periods and unused entities have zero amounts/N/A rates. 68 actual minutes at $30 cost $34 while billing 1.2 hours; a reasoned correction to 90 minutes at $40 costs $60. [JSON](evidence/run-H5/oracle-report.json), [CSV](evidence/run-H5/oracle-report.csv), [PDF](evidence/run-H5/oracle-report.pdf).

The continuation inspected the prior run log tail and existing design/evidence before editing. It completed exact-alias tracker validation, account-scoped exclusions, legacy raw-tracker attribution/cutoffs, inactive capacity reporting, validated upload-owner capture, review/source minute and employee corrections, and actual manual duration. It repaired fixture teardown ordering for the new FK and updated obsolete error-status/hour assertions while retaining their refusal and full no-write checks. Real defects and superseded expectations were fixed; no test coverage was dropped.

The diagnostic browser pass exposed transaction-editor initialization before shared reference lists arrived. The form now waits for those lists, retains in-progress edits on later list refreshes, validates required selections and permits only one in-flight save. Jest covers delayed loading and repeat submit; Playwright covers actual employee reassignment and saved cost.

An earlier failed teardown also left one active duplicate-name synthetic employee (user 91473, account 9001, fixture `MUIPSGUGCYXK`). Later UI tests selected its different billing rate. That exact orphan was deactivated with an audit source/reason; no production-copy user was touched. The teardown now removes source-linked transactions before tracker entries. [Recovery evidence](evidence/run-H5/fixture-recovery.log).

The sidebar navigation regression now waits for the MUI group expansion to finish before clicking a child. The diagnostic trace showed a click during clipping/animation landing on the following group. All route, heading, permission and console-error assertions remain; there is no forced click or direct-navigation substitution.

The next full browser pass exposed an existing business-settings race: the initial list response could clear a new draft after the user began typing. New-route initialization now happens before input, and list responses only populate the list. A deferred-response Jest test and a browser test verify all entered fields/reason survive and a double click creates exactly one business. Existing business-change permissions and APIs are unchanged.

A later uninterrupted browser run passed its first 182 cases, then the Playwright Node runner exhausted its default 4 GB heap before the final two cases. That aborted runtime is preserved under `diagnostics/third-browser-heap-limit`. The full command now sets `NODE_OPTIONS=--max-old-space-size=8192` for the test client and its workers. Application/browser servers, tests, assertions, trace policy and reporters are unchanged. Acceptance still requires all 184 cases and a successful command exit; the aborted run is not counted as accepted.

The next run reproduced an exclusion tooltip intercepting a customer-option click. The informational tooltip is now non-interactive, so it cannot capture pointer input. Jest verifies its help text, pointer behavior and selection; the existing Playwright case deliberately opens the tooltip before selecting an excluded customer. The diagnostic is retained under `diagnostics/fourth-browser-tooltip`.

## Full acceptance

Commands run strictly one at a time; integration files run individually with the requested environment. The final rechecks replace earlier results in these totals and are not counted twice. Standalone scenario and clean-room totals overlap the integration suite.

| Required validation | Accepted result |
|---|---:|
| Backend unit | 1,225 passed |
| Integration, 94 files | 3,192 passed |
| Standalone scenarios, 53 files | 2,034 passed |
| Clean-room | 18 passed |
| Payment-image Lambda | 17 passed |
| Frontend Jest, 67 suites | 381 passed |
| CI production build | Passed |
| Read-only drift | 0 across 1,014 client/business comparisons |
| Full remote Playwright, 1 worker, no retries | 184 passed |

All **102 required commands have accepted exit-0 results**, with **zero failures, skipped, pending or flaky tests**. Nine targeted rechecks cover the later fixes and replace earlier results without double-counting. The [consolidated acceptance manifest](evidence/run-H5/acceptance/final-acceptance.json) retains exact commands, environments, timestamps, exit codes, per-file counts and the selected evidence log for each result. The complete browser run passed all 184 cases in 19.5 minutes with no reporter errors: [Playwright JSON](evidence/run-H5/acceptance/playwright-results.json).

Raw runs remain available: [required matrix](evidence/run-H5/acceptance/validation-results.json), [five initial rechecks](evidence/run-H5/acceptance/final-rechecks/validation-results.json), [two business-form rechecks](evidence/run-H5/acceptance/final-ui-rechecks/validation-results.json), [two final tooltip rechecks](evidence/run-H5/acceptance/final-tooltip-rechecks/validation-results.json). Earlier failed/aborted browser diagnostics remain under `evidence/run-H5/diagnostics` and are excluded from accepted totals. No test or assertion was dropped.

H5-specific evidence includes 17 hand-oracle scenarios, 92 route cases, seven browser cases, migration/idempotence tests, model tests and the changed-screen Jest suites. Reports cover tenant/role/parameter refusals, missing and inactive entities, invalid cutoffs, empty periods and injected database/export failure without writes. Cost paths cover actual versus rounded duration, rate changes, unknown historical cost, source mismatch, reassignment reasons, duplicate/repeated posting, rollback and issued locks.

The managed backend restart acknowledgment postdates the final backend source change. Browser validation uses the externally managed Chromium server at `ws://127.0.0.1:3334/`; no local browser/server was started or stopped. All tests use the authorized local databases and fixture account. Email and scheduled automations are off.

The final read-only protected-data verification ran after the complete browser suite, at **2026-09-26 20:27:02 UTC**. All seven required account-1 counts match the retained reference census, all ten original business-table digests are unchanged, and the original audit prefix plus complete 207,272-event chain verify. The only intended additions remain the 67,307 estimates and 67,307 system audit events described above.

## Documentation and handoff

Feature rules, scenario oracles, the integrated design, endpoint index, migration inventory, operations rollout, architecture, audit/provenance docs, FINAL_REPORT and workspace MEMORY are updated. The source manifest compares retained pre-H5 hashes directly, without Git: [62 changed/new code, test and support paths](evidence/run-H5/source-changes.json). The browser-suite README also documents the test-client heap requirement.

Offline Graphify processed **547 code files**, producing **2,276 nodes, 3,154 edges, 349 communities and 2,625 Obsidian graph notes**, with zero model calls/tokens. See [refresh log](evidence/run-H5/graphify.log). All three rendered oracle PDF pages were visually checked for arithmetic, labels, wrapping, cutoffs and page numbers. The [browser screenshot](evidence/run-H5/billing-performance.png) verifies readable report controls, totals, attribution and provenance. The shared global header title overlaps the expanded sidebar; this cosmetic shell issue is recorded under H6 navigation in the design record. The report's own title and controls are visible. [Visual review](evidence/run-H5/visual-review.json).

The documentation, sample PDFs, FINAL_REPORT and workspace MEMORY are synchronized to the Obsidian vault and hash-verified: [mirror evidence](evidence/run-H5/mirror-verification.json). Raw logs, JSON, screenshots and traces remain in the repository evidence folder. [Documentation link check](evidence/run-H5/document-links.json) records no missing local targets in the affected documents.

Known reporting limits are explicit: historical labor rates are estimates, missing cost keeps margin unavailable, and pre-audit history cannot be reconstructed. Production rollout remains a separate operator action. No owner decision is blocking this local implementation.
