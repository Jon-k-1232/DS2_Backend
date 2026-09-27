# PASS5 — H7 full API, scenario and regression pass

2026-09-26. Local-only acceptance for both rounds of owner decisions. **Accepted: all required command groups pass.** No deployment is performed.

## Scope and evidence

- [Hand-computed combined lifecycle](H7-combined-lifecycle.md): one client across two businesses, actual-minute pricing, draft edits, duplicate flag/dismiss/remove, concessions, retainer draws/refunds/adjustments, one receipt with held credit and transfer, recurring/covered/excess work, optional credit statement, memo/refund/void/rebill, full bounced check, original aging, final collection and immutable Audit Record.
- [Round-two path matrix](round2-path-matrix.md): all 58 new contracts, complementing the retained 160-contract matrix, plus changed existing adjustment/reporting paths. Guard inventory executes actual Express routes. No endpoint is added by H7.
- New API mistakes and state-machine cases verify every public table's row count/digest on refusal, including audit, artifacts metadata and financial request records. Same/different-key races assert exactly one commit. Existing permission, rollback, storage, stale, locked, not-found and tenant tests remain.
- Complete sequential command logs and structured results: [acceptance directory](../decisions/evidence/run-H7/acceptance/). Targeted red/green evidence: [pass5 evidence](evidence/pass5/).

## Defects reproduced before fixing

| Defect | Observed failure | Fix and proof |
|---|---|---|
| Malformed record identity and line shapes | Array IDs posted money; null allocation/memo/rebill rows returned 500 | Scalar ID and line-object validation; HTTP 400 and full-table preservation in H7 boundaries |
| Invalid calendar/cutoff | February 30/April 31 reached SQL 500; hour 24 silently selected another day; year zero returned SQL 500 or a misleading empty report | Shared calendar/clock validation before reads/writes, retaining six microsecond digits and valid year one; four read paths and cash entry tested |
| Backdated application correction | Reversal/replacement could precede the receipt or original application | Reject 400 before posting; destination date rule retained |
| Retry aimed at another URL record | Saved successful cancellation/correction returned for another receipt/application | Compare immutable saved response identity and original input; wrong target 409, exact old retry still replays |
| Cash attribution lost through void/rebill | Combined report showed 250 collections instead of 290 after a 40 cash retainer draw was released/reapplied as statement credit | Trace original application funding, including mixed sources, repeated rebills, partial cents and reversals; report 290, retainer use 40 |
| Supporting fee counted twice | Voided original and replacement both added recurring/fixed source fee | Fee measures follow the existing surviving work-cohort ownership; recurring 125 once in combined oracle |
| Customer submission had no pending/error safeguard | Rapid clicks sent two requests; transport/server rejections produced no visible error | One in-flight call, disabled Saving button, retained draft and explicit lost-confirmation guidance; four Jest tests and browser abort/delay/retry proof |

The initial isolated boundary red run has 6 passing/19 failing; its 25 cases pass after fixes. The later year-zero extension reproduced nine more failures in `year-zero-red-isolated.log`; all 34 boundary cases then passed. The first genuine combined accounting failure is retained in `combined-fourth.log` and `combined-analytics-red.json`. Focused lineage/fee regressions fail in `analytics-lineage-red-isolated.log`; cent-reversal red/green and final lineage green logs are retained. Customer submission starts at 3 failed/1 passed Jest tests and finishes at 4 passed. Earlier combined-fixture setup/assertion errors and the first year-zero test's syntax error are diagnostic scaffolding attempts, not additional product defects. No failing assertion was removed to obtain acceptance.

The first full browser run finished at 258 passed/1 failed. Its retained trace reports `net::ERR_NETWORK_IO_SUSPENDED` during customer setup, before the retainer test's assertions; audit event 432891 proves the synthetic customer had committed before confirmation was lost. The UI lacked error recovery, independently reproduced by the new Jest tests above. The unchanged retainer test and new customer abort/delay/retry test each passed three consecutive runs. The final full suite passes after these changes; initial JSON, trace, screenshot, server request and diagnosis remain in [initial browser evidence](evidence/pass5/initial-browser-failure/). No automatic test retry or automatic customer resubmission conceals the failure.

The first full rerun found a separate test-fixture error after UTC midnight: the concurrent-payment API fixture used September 27 while the screen and Phoenix business date were September 26. The API correctly returned 400 for a future receipt. The fixture now uses the screen's Payment date and retains every stale-409, no-write, preserved-check and refreshed-balance assertion. The corrected case passed three consecutive runs before the final full-suite rerun. [Date-fixture evidence](evidence/pass5/browser-business-date-failure/) retains the failure; this changes test data, not application date policy.

## Financial acceptance

The combined pre-bounce report reconciles **585 gross issued, 20 concessions, 35 memos, 150 voided charges = 380 net billed**; **290 collected**, **350 gross cash**, **30 returned**, **52 labor**, **328 margin**, **125 recurring source fees**, **295 fixed source fees**, **40 retainer use**. Issued debt is A = 10/B = 90. The complete 250 bounced check restores A = 220/B = 130, including A's 180 at its original 31–60-day age. Fresh cash of 220/130 settles both; B's retainer remains 50. A saved pre-bounce knowledge cutoff reproduces A = 10/B = 90. Every captured original invoice row and PDF is unchanged, and archived Audit Record verification succeeds.

The H2 default-business opening and historical tracker-only reporting attribution remain intact. No period close, approval workflow, online payment, collection automation or interest calculation is introduced. Only admin/Super Admin can adjust money; ordinary receipt/time/invoice permissions stay as decided. Email/scheduler remain disabled locally.

## Validation and protected data

All **106 required commands have accepted exit-0 results**, with zero final failures, skipped, pending or flaky tests. Accepted rechecks of eight command groups replace earlier results without double-counting. Scenario and clean-room totals overlap integration. The nine targeted browser repetitions are additional evidence, not added to the full-suite count.

| Command group | Accepted result |
|---|---|
| Backend unit | 1,227 |
| Integration | 3,392 across 98 files |
| Standalone scenarios | 2,234 across 57 files |
| Clean-room | 18 |
| Payment-image Lambda | 17 |
| Frontend Jest | 498 across 80 suites |
| Frontend CI build | Passed |
| Full remote Playwright | 260 |
| Read-only drift | 0 across 1,014 client/business comparisons; aggregate difference 0 |

[Accepted command manifest](../decisions/evidence/run-H7/acceptance/final-acceptance.json), [full browser JSON](../decisions/evidence/run-H7/acceptance/playwright-results.json), [protected verification](../decisions/evidence/run-H7/account1-verification.json) and [drift evidence](../decisions/evidence/run-H7/drift.json).

All seven required source counts match the retained reference census, all 12 captured table counts/digests are unchanged, and the **207,272-event** audit chain verifies. The reference database was never connected. H7 has **zero intended migration/backfill effects and zero observed account-1 changes**. Next migration remains 047. The final read-only verification ran after the last full browser run.

| Protected account-1 table | Before = after = retained reference count |
|---|---:|
| `customers` | 338 |
| `customer_transactions` | 39,052 |
| `customer_payments` | 1,005 |
| `customer_writeoffs` | 657 |
| `customer_invoices` | 2,253 |
| `timesheet_entries` | 28,255 |
| `users` | 23 |

## Handoff

Six backend runtime files, one frontend runtime file and nine test/helper files changed or were added. The existing New Customer form gains safeguards; API contracts and schema are unchanged. [Source inventory](../decisions/evidence/run-H7/source-changes.json). The [final managed backend restart](../decisions/evidence/run-H7/backend-restart-final.json) completed before the last browser acceptance. Production rollout deploys the backend and frontend after existing migration 046 prerequisites; no stored-request or financial-data rewrite is required. [Operations](../platform/operations.md), [design](../decisions/2026-09-26-owner-requests-2.md), [H7 results](../decisions/2026-09-26-run-H7-results.md).

Offline Graphify processed 554 code files into 2,295 nodes, 3,180 edges, 348 communities and 2,643 notes, with zero model calls. Documentation, workspace MEMORY and the Obsidian mirror are synchronized. No Git, production, AWS, reference-database, real-email or deployment action is authorized or performed by this run. No owner question blocks the implementation defaults.
