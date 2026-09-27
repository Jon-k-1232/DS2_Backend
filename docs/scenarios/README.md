# Pass 1: client lifecycle and billing arithmetic

Round2 H0 adds [email and automation switch expectations](H0-email-and-automations.md). No money oracle changes in H0; entity/aging/payment/correction/recurring/analytics oracles for H1–H8 are specified in the [integrated design](../decisions/2026-09-26-owner-requests-2.md) with H0–H6 implemented and H7 full regression evidence in [PASS5](RESULTS-PASS5.md). H8 browser, help and mistake acceptance follows H9/H10: [oracles](H8-browser-and-help.md), [PASS6](RESULTS-PASS6.md), and [H8 results](../decisions/2026-09-26-run-H8-results.md).

Expected results authored on 2026-09-24 **before the first scenario execution**. These are arithmetic oracles, not values copied from a response or calculated with application helpers. Execution results, defects, corrected expectations and exact counts belong in [RESULTS.md](RESULTS.md).

Run `npm run test:scenarios`. Each file starts by rebuilding only `ds2_scenarios` from the immutable schema snapshot, migrations 019–049 via `psql -X -1 -v ON_ERROR_STOP=1 -f`, and the clean-room seed. `npm run scenarios:reset` is idempotent. Seeds are synthetic, including account 1 in this dedicated database; account 1 in `ds2_local` is never scenario data. Existing clean-room customers remain unused; scenarios create named clients through HTTP. No running server is restarted.

Every new executable entry point loads `scripts/scenarios/guard.js` first. It refuses non-loopback databases, ports other than 5433, names outside `ds2_scenarios*`, production/URL overrides and nonlocal storage. Only local MinIO on port 9000 is allowed. Optional AI calls are disabled and external TCP destinations are refused. The reset helper's sole maintenance-database operation is checking/creating the validated scenario database.

## Oracles and evidence

- `N` means next invoice total: billed balance + unbilled billable charges + eligible signed payments and write-offs. `B` means billed outstanding. Account Audit must equal `N`; its outstanding component and AR must equal `B`. AR excludes zero balances, includes signed credit balances, and does not include unbilled work or unused retainers.
- `R` is signed remaining held money, informational rather than an automatic deduction. Funding work creates a separate negative payment. No money may be deducted twice.
- Statement tuples are `(beginning balance, charges, payments, write-offs, retainers, amount due)`. Every issued statement checks all six fields, remaining, paid status, sequential invoice number, PDF amounts/lines using `pdftotext`, AR bucket and saved HTTP audit. Money below is in dollars.
- Customer/job/work/payment/retainer/write-off actions use real authenticated Express routes with the real database. SQL is limited to baseline reset, reading evidence, controlled clock shifts, foreign-tenant fixtures and deliberate corruption/failure injection. Preview and saved audit are also real HTTP routes.
- After each successful action or refused ledger action, compare the three views to the literal expected state. Refusals also preserve the pre-action financial rows. Tests never run concurrently. Concurrent HTTP requests inside a lock test are deliberate actions within one test process.
- Calendar advancement moves fixture dates back by a stated integer day count (as the existing clean-room suite does); it does not mock the application calculation. H2 ages original obligations across statement rollovers, with separate effective and recorded-through cutoffs; legacy reconstruction and unknown dates remain labeled.

## Groups

1. [Clients, jobs and work](01-work.md)
2. [Retainers and prepayments](02-retainers.md)
3. [Payments and reversals](03-payments.md)
4. [Write-offs](04-writeoffs.md)
5. [Month-end and aging](05-month-end.md)
6. [Billing Review corrections](06-cascade.md)
7. [Refusals and failures](07-refusals.md)
8. [Legacy integrity and lock races](08-integrity-and-races.md)
9. [Owner sent locks and exceptions](09-owner-sent-exceptions.md)

## Owner decisions recorded

The owner settled all five questions. The [design record](../decisions/2026-09-24-owner-decisions.md) is authoritative. Run 1 implements immutable sent statements and selected bounced-payment exceptions (decisions 3 and 5); Run 2 implements manual retainer adjustments/refunds and duplicate review (1 and 4). Run 3 implements optional credit statements (2), the six-minute time audit and the combined lifecycle. Run 4 implements the deterministic account history ledger (6), the admin profile tab, stored PDFs and verification. See [run 2 hand oracle](10-owner-retainers-duplicates.md). See the [new hand oracle](09-owner-sent-exceptions.md) and [run results](../decisions/2026-09-24-run-1-results.md).

Old post-issue edit/delete/mirror assertions intentionally changed: sent Billing Review edits and empty issued invoice deletion now return409; issued parents remain original; current/absorbed balance lives on new children. Tests retain unissued CRUD/cascade behavior. Calendar/corruption tests alone use a database/account-guarded transaction-local trigger bypass; production/application routes cannot use it.

## Pass 2

[What-if situations and careless-user mistakes](what-if-and-mistakes.md) records the independent input/outcome oracles and execution observations. The same `npm run -s test:scenarios` now includes both lifecycle and what-if suites, one file per process. Final counts and the changed-file list are in [RESULTS-PASS2.md](RESULTS-PASS2.md).

## Owner run 3

- [15 — optional credit statements](15-credit-statements.md): skip/include, signed carry-forward, zero crossing, credit-to-debt NSF, permission/validation/fault refusals.
- [16 — all five decisions together](16-owner-combined.md): work, retainer, sent locks, duplicate removal, bounced reversal/roll-forward, refund and skipped/chosen credit.
- [17 — time boundaries](17-time-boundaries.md): manual create/edit, held review, analytics, PDF and three-view arithmetic.

Scenario reset now includes migrations019–026. Finalize means sent and locked; drafts stay editable and write nothing to the ledger. Exact executed results are in [run3 results](../decisions/2026-09-25-run-3-results.md).


## Owner run 4

- [18 — hard Audit Record](18-audit-record.md): actor-attributed lifecycle, deterministic running balances, immutable printed snapshots, tamper evidence and role/tenant/failure paths.

Full serial acceptance counts are in [run 4 results](../decisions/2026-09-25-run-4-results.md). Shared HTTP helpers also assert the authenticated actor on captured events across the existing write-route suites.

Run 5 extends [scenario 18](18-audit-record.md) with Client/Full evidence printing, complete human change coverage, six-page client layout and verified immutable source archives. See [run-5 acceptance](../decisions/2026-09-25-run-5-results.md).

## Pass 3

[The route path matrix](path-matrix.md) covers every mounted API route and links each explicit error/fallback site to named tests or a reason it is unreachable. [Hand-written expectations](path-matrix-expectations.md) precede execution; [results](RESULTS-PASS3.md) record fixes, exact suite counts, protected-data checks and the live-browser launch blocker. `npm run -s test:scenarios` now runs the lifecycle, what-if and path-matrix files serially against the guarded scenario database.

## H1 business entities

[H1 hand-computed scenarios](H1-business-entities.md) cover two-business statements, separate carry-forward, explicit admin credit transfer, held tracker text, default and reviewed split cutover, scoped payment/write-off snapshots and no-write refusals. [H1 results](../decisions/2026-09-26-run-H1-results.md) records the fresh full regression; earlier counts above remain historical evidence.


H2 aging update: current billed balance remains the same signed B oracle, but carried debt keeps its original obligation age. Old helpers that assumed all B was current now assert bucket conservation; dedicated [H2 oracles](H2-receipts-and-aging.md) independently assert each original-age bucket, both cutoffs, two rollovers, receipt credit and full reversal. No monetary or refusal coverage was removed.


## H3 update — 2026-09-26

H3 adds correction lifecycle and refusal/authority matrices. See [H3 oracles](H3-corrections.md) and [results](../decisions/2026-09-26-run-H3-results.md) for credit memos, void/rebill, refunds, admin-only adjustment coverage and exact final acceptance counts.


## H4 recurring acceptance

[Recurring hand oracles](H4-recurring.md) cover month/year boundaries, leap days, plan changes, skips, cap/review, idempotency, off-scheduler invoice entry, system attribution and immutable finalization. `scenario-H4-recurring.integration.spec.js` and `path-matrix-H4-recurring.integration.spec.js` run individually in ds2_scenarios. Migrations043/044 are included by the reset script's sorted migration discovery. [Run results](../decisions/2026-09-26-run-H4-results.md).

H5 adds [honest analytics oracles](H5-honest-analytics.md): separate WIP/issued/applied/correction measures, a midyear staff-cost change, historical estimates, recurring effort, void/rebill identity, entity attribution and empty/invalid/inactive mistakes. `scenario-H5-analytics.integration.spec.js` and `path-matrix-H5-analytics.integration.spec.js` run in ds2_scenarios and are automatically included by the scenario runner.

## H6 navigation

[H6 browser scenarios](H6-navigation.md) cover every category/leaf, historical redirect, stable detail identity, role visibility, keyboard/focus and responsive navigation while preserving the existing financial oracles.

## H7 / PASS5

[Both owner rounds in one two-business lifecycle](H7-combined-lifecycle.md) checks hand-calculated obligations, applications, credits, corrections, recurring fees, aging, cost and collections. [Round-two path matrix](round2-path-matrix.md) extends the historical 160 contracts to 218. API mistake suites compare every public table on refusal. [PASS5](RESULTS-PASS5.md) records red/green defects, all required command counts and protected account-1 evidence.

## H9 loading regression

[Bounded-loading oracles](H9-bounded-loading.md), [current results](../decisions/2026-09-26-run-H9-results.md), `path-matrix-H9-loading.integration.spec.js` and the account-scale read-only performance suite extend the existing financial/path tests. The three new read routes bring the inventory to221; the earlier160/218 matrices remain historical coverage subsets.

## H10 account-wide reads

[Batch-read hand oracle](H10-batched-calculations.md), [results](../decisions/2026-09-26-run-H10-results.md), `scenario-H10-equivalence.integration.spec.js`, `performance-H10.integration.spec.js` and `e2e/tests/performance-H10.spec.js` add original-reader equality, protected account-scale budgets, synthetic recurring preparation and no-write refusals. Migrations048/049 are discovered by scenario reset. Independent drift remains mandatory; no accounting oracle was weakened.
