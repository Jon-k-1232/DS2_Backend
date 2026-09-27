# H10 — account-wide calculation performance (2026-09-26)

Status: **accepted locally**. All specified loaded-workspace readiness budgets and required validation passed; the residual cold/profile/background costs are disclosed below. No deployment, Git, production/AWS, real email or reference-database access.

## Scope and invariants

H10 batches invoice evidence and AR reporting reads, narrows eligibility/reporting projections, removes repeated in-request reporting scans, and loads the year-end financial snapshot once. No cross-request cache. The calculation, statement timestamp gates, finalize fingerprints, stale refusal, balance-forward absorption, obligations/credits, locks, audit capture, entity precedence, admin-only corrections and printed interest line retain their contracts. Account Audit remains independently computed; it does not call the invoice engine or batched AR reader.

No route was added, removed or renamed: the endpoint inventory remains **221**. Optimized existing reads include `GET /invoices/createInvoice/AccountsWithBalance/:accountID/:userID`, invoice preview inputs, `GET /accountsReceivable/aging/:accountID/:userID`, the six analytics reports and `GET /analytics/yearEndPacket/:accountID/:userID`. Existing screens consume unchanged response shapes; no production frontend source changed. Nine new Playwright budgets measure real data readiness on those screens, alongside all existing Jest and UI behavior tests.

## Measurement method

`scripts/review-2026-09/measure-H10.js` captures phases, each query family and its count, complete HTTP-body bytes, and protected source hashes. It connects only to ds2_local at127.0.0.1:5433, with database-enforced read-only transactions, account1 (338 clients, three businesses,39,052 work rows). The default business has310 eligible clients. HTTP before/after numbers are medians of three complete responses. Phase times are individual instrumented calls; concurrent query durations include pool queuing and must not be added as elapsed wall time.

The account-scale API and browser budget tests each discard one warmup then take the median of three samples. Browser timers start at ordinary navigation from an already loaded workspace and stop only after actual rows/totals and controls are ready. They do not stop at a heading or skeleton. Cold-page H9 measurements are reported separately. Real account1 GETs are used; the recurring preparation POST is replaced by its read-only due-preview response so this protected account is never billed by a performance test. Eight synthetic recurring plans exercise real preparation in ds2_scenarios.

The original read-only Audit phase measurement computes raw ledger results for all338 clients. A supplemental replay also measures the complete per-client read phase, including the engine cross-check/savepoint and receivables section. Both exclude saved audits, AI narrative, PDF storage and notification effects. Preview additionally renders310 PDFs and a CSV in memory, using only the local MinIO logo; it does not upload or finalize. Profile measurement includes the largest full client-history response; its unchanged payload is a separate residual cost.

## Before and after

Complete HTTP responses, default business, median of three samples (milliseconds):

| Read path | Before | After | After bytes |
|---|---:|---:|---:|
| Create invoices balances | 3,984.8 | 609.6 | 492,969 |
| Recurring due preview | 9.0 | 7.5 | 24,173 |
| Accounts receivable | 5,041.5 | 130.6 | 37,190 |
| Account Audit list | 351.8 | 365.7 | 6,552 |
| Largest full client profile history | 1,569.6 | 1,381.1 | 67,184,170 |
| Billing performance | 1,991.3 | 788.3 | 4,498,278 |
| Client rates | 3,228.1 | 765.5 | 905,419 |
| Time allocation | 1,976.2 | 781.8 | 16,187 |
| WIP aging | 1,941.1 | 752.5 | 55,995 |
| Job budgets | 1,912.5 | 720.1 | 78 |
| Tax capacity | 1,901.6 | 736.7 | 5,549 |
| Year-end packet | 14,331.0 | 1,063.2 | 160,595 |

Instrumented read/compute phases (milliseconds and business-query counts, excluding context-setting statements):

| Phase | Before ms | After ms | Queries before → after |
|---|---:|---:|---:|
| Recurring due/read | 15.3 | 16.1 | 4 → 4 |
| Invoice eligibility | 1,128.3 | 260.6 | 8 → 8 |
| Invoice input evidence,310 clients | 3,592.8 | 341.2 | 2,494 → 22 |
| Pure invoice arithmetic | 10.6 | 9.4 | 0 → 0 |
| Full preview snapshot and fingerprints | 3,328.8 | 1,084.3 | 2,510 → 38 |
| Audit list service, default options | 15.4 | 22.6 | 2 → 2 |
| Audit independent calculation,338 clients | 3,116.8 | 2,784.1 | 3,042 → 3,042 |
| AR all-client calculation | 4,767.5 | 132.0 | 5,749 → 15 |
| BillingPerformance | 2,030.0 | 790.4 | 40 → 40 |
| ClientRates | 3,280.3 | 819.1 | 41 → 41 |
| TimeAllocation | 2,057.5 | 782.5 | 40 → 40 |
| WipAging | 2,001.9 | 771.2 | 40 → 40 |
| JobBudgets | 2,005.4 | 767.3 | 40 → 40 |
| TaxSeasonCapacity | 2,011.5 | 739.5 | 40 → 40 |

Audit service/default options and the HTTP list are different workloads; compare each only within its own row. Audit calculation above excludes saved results, narrative and storage. The account-wide arithmetic is unchanged.

Supplemental profile calculation replay on the unchanged largest client, original readers/views versus current readers (not a pre-change browser recording):

| Profile calculation | Original ms | Current ms | Query events original → current |
|---|---:|---:|---:|
| All-business profile balances | 433.6 | 167.0 | 90 → 90 |
| Selected-business invoice calculation | 2,419.2 | 2,413.8 | 105 → 105 |
| Complete Audit read phase,338 clients (one sample) | 41,250.1 | 40,292.1 | 53,302 → 53,302 |

Original and current calculation data are equal; only Audit generated_at (the execution timestamp) is excluded in this supplementary replay. Complete Audit reads include its independent raw ledger, per-client engine cross-check/savepoint and receivables section; narrative/PDF/persistence remain excluded. Supplemental counts are observed Knex query events, including transaction/context plumbing, so compare counts within each row, not against the phase instrument above. This isolates balances from the unchanged67MB client-history transfer; it sends no profile preparation/finalization POST.

Actual browser data readiness after navigation in an already loaded workspace, median of three measured runs after one warmup:

| Page | First correct data ms | All balances/controls ms | Target ms |
|---|---:|---:|---:|
| create | 854 | 860 | 1,000 first /1,500 complete |
| ar | 443 | 443 | 1,000 |
| audit | 127 | 127 | 1,500 |
| billingPerformance | 967 | 967 | 2,000 |
| clientRates | 888 | 888 | 2,000 |
| timeAllocation | 886 | 886 | 2,000 |
| wipAging | 829 | 829 | 2,000 |
| jobBudgets | 816 | 816 | 2,000 |
| taxSeasonCapacity | 823 | 823 | 2,000 |

Separate cold-page comparison from the unchanged H9 browser test: actual Create Invoice rows and enabled controls **5,103 → 1,314ms**. This includes document/bootstrap/chunk startup and is not the loaded-workspace budget above. Cold startup remains visible; no skeleton timing is substituted for balance readiness.

EXPLAIN ANALYZE, database execution milliseconds:

| Equivalent query | Original function view | Joined reporting view |
|---|---:|---:|
| Eligible work | 307.091 | 25.556 |
| Jobs | 443.870 | 20.326 |

Preview output: 310 clients; detail assembly 91.0ms; CSV 1.2ms (12,483 bytes); 310 PDFs rendered in memory in 1,275.9ms (1,763,245 bytes). No upload/finalize or external storage call.

Real recurring preparation on eight synthetic plans: generate eight fees: 59.5ms, 8 generated; already prepared: 14.5ms, 0 generated. Protected account1 uses the due preview only.

Raw samples, individual query families, source digests and complete plans are retained in [H10 evidence](evidence/run-H10/README.md). No cross-request cache is used.

## Dominant costs and implementation

- Invoice evidence previously made eight additional reads per eligible client (credit lots/events, four correction streams and receipts). Statement inputs used2,494 queries; the batched path uses22, with the same microsecond timestamp gates and empty-customer entries. Pure invoice arithmetic is about10ms and remains unchanged.
- AR previously called the command ledger reader for every client, including full finalize/receipt fingerprints unnecessary for a report:5,749 queries. The independent reporting projection uses15 queries, retaining legacy opening reconstruction and historical cutoffs. The command ledger reader/fingerprint is unchanged.
- Entity attribution on high-volume work/jobs previously executed the same stable SQL function per row. Unique account-qualified sidecar joins permit set-based planning. EXPLAIN ANALYZE evidence compares both implementations; existing unique sidecar indexes are sufficient, so H10 adds no index.
- Analytics previously encoded unused wide provenance data and repeatedly scanned account-wide arrays for each client/year. Narrow immutable sidecar/catalog projections, row-to-JSON encoding, document grouping and a lazy customer index inside one prepared snapshot remove that cost. Mutable source rows and audit rewind remain complete. The packet reuses one snapshot inside its existing repeatable-read transaction; AR still computes independently.
- Account Audit retains its independent per-client read path. Raw ledger calculation is2.78s for338 clients, but the complete background read phase, including engine and receivables cross-checks, is**40.29s** (41.25s original replay). The list is127ms in the browser and the batch runs asynchronously with progress. No claim is made that the entire Audit job finishes in3s; narrative/PDF/persistence add further time. The largest selected-client balance calculation remains**2.41s** and its unchanged67,184,170-byte history response takes**1.38s**; all-business balance calculation improves434→167ms. These residuals have no numerical target in H10. They preserve the existing independent checks and response contracts; they are not declared impossible to improve.

## Runtime files and screens

Changed backend runtime files: invoice `createInvoiceQueries.js`, new `statementExtras.js`, `invoiceEligibility.js`; payments `receipt-ledger.js`, `legacy-obligations.js`, new `receipt-balances.js`; AR `obligation-aging.js`; analytics `reporting-model.js`, `analytics-service.js`, `analytics-router.js`; query context `utils/auditContext.js`. The original invoice-service gates, Account Audit service, AR outer service and correction command service remain byte-for-byte equal to the frozen baseline.

There are no new or changed product screens. Existing Create invoices, AR, Audit list and six analytics screens have new Playwright budget assertions; all existing Jest/browser behaviors remain required. No route, response contract, navigation label or role control is removed.

## Migrations and protected data

Manually applied **048 and049** individually to ds2_local, ds2_clean and ds2_scenarios with `psql -X -1 -v ON_ERROR_STOP=1 -f`. Migration048 introduced joined work/job views. Regression exposed that joined views reject row locking; forward migration049 creates those two projections in `billing_reads` and restores the original single-base-table definitions in `billing_scope`. Nonlocking reads select `billing_reads, billing_scope, public`; all four row-lock modes select the original scoped views, and writes still select public. No applied migration was edited.

The pair changes view definitions and adds one schema/two views only. **Zero business rows, audit rows or backfills**, including account1. No new financial table, write path or audit exemption. Scenario reset discovers both. Inventory **48 forward files,002–049; next free050**. Six migration tests verify plain SQL/idempotence, column/value preservation and physical row-lock contention. Production requires048 immediately followed by049 in a maintenance window before the matching backend; never leave writers on048 alone. See [operations](../platform/operations.md).

Final post-browser verification: **all12 captured source/audit table counts and hashes unchanged**, all seven required counts match the retained reference census, and the **207,272-event audit chain verifies**. H10 never connected to ds2_ref_20260922. The eight-table pre/post-H10 measurement digests also match exactly.

| Protected account1 table | Current count | Retained reference count |
|---|---:|---:|
| customers | 338 | 338 |
| customer_transactions | 39,052 | 39,052 |
| customer_payments | 1,005 | 1,005 |
| customer_writeoffs | 657 | 657 |
| customer_invoices | 2,253 | 2,253 |
| timesheet_entries | 28,255 | 28,255 |
| users | 23 | 23 |

Every intended H10 account1 migration effect: **none on rows or fields; zero backfill, zero audit events**. Only schema/view definitions change. [Verification](evidence/run-H10/account1-verification.json).

## Equivalence and mistake coverage

Frozen pre-H10 readers and SHA-256 manifest are in `test/fixtures/h10-baseline`; `h10-original.js` loads them with their original dependencies. Every account1 client/business and both write-off display settings are compared (2,028 invoice outputs plus full inputs/eligibility). All six reports are compared in every business and all-business scope. Current/historical AR, complete view rows and scenario receipt states are also compared.

SQL record sets without ORDER BY had unstable order even in repeated original-reader calls. Their complete values/types/records are canonicalized to deterministic JSON bytes before equality; no monetary rounding or field omission is allowed. Ordered AR/analytics response JSON must also be byte-identical without normalization. ZIP archive timestamps/metadata are not a deterministic byte contract; report contents and calculations are compared. Independent drift checks remain required.

[H10 hand oracle](../scenarios/H10-batched-calculations.md) covers two-business work/issue, receipt excess, next-bill credit, admin memo and recurring preparation. Four injected read failures and wrong-account/business/role refusals compare every synthetic business table and audit evidence before/after. Existing finalize, stale/double-submit, locked-row, admin-only adjustment and storage-failure coverage remains in the full regression suite.

## Accepted validation

All50 top-level validation commands have accepted exit-0 results. The scenario runner launches each integration file separately and sequentially. No two test processes ran together; full Playwright used the managed ws3334 browser with one worker. All accepted suites have **zero failed, skipped, pending or flaky tests**.

| Required validation | Accepted result |
|---|---:|
| Backend unit | 1,238 passed |
| Ordinary integration,42 files | 1,163 passed |
| Scenario/path integration,59 files (`npm run -s test:scenarios`) | 2,334 passed |
| Clean-room (`npm run -s test:cleanroom`) | 18 passed |
| All integration,102 files (includes scenarios/clean-room) | 3,515 passed |
| Lambda pytest | 17 passed |
| Frontend Jest,84 suites | 527 passed |
| Frontend CI production build | passed |
| Full Playwright | 278 passed in20.1min |
| Read-only drift | 0 /1,014 comparisons; aggregate difference0 |

Total **5,575 unique test cases**. Scenario/clean-room counts overlap all-integration and are not added twice. Nineteen account-scale tests include2070 equivalence comparisons and nine API budgets; nine browser tests enforce the visible-data budgets. Frozen-original invoice inputs, ordered AR/analytics results, synthetic ledger states and views all agree. [Exact accepted commands/counts](evidence/run-H10/final-acceptance.json), [all attempts](evidence/run-H10/validation-commands.json). Earlier failing/interrupted attempts and focused repetitions are retained but excluded from accepted totals. The drift artifact is also available at `/tmp/drift.json`.

Backend reloads used only the managed request/done files. Final backend acknowledgement was `ok 2026-09-26 22:01:59` Phoenix, after the05:01:55.727694UTC request. Ports8003/3334 remained available. Historical H9 budget/browser artifacts were saved before regression and restored byte-for-byte; current H10 rechecks live under this run's evidence.

Offline Graphify: **574 source files, 2,353 nodes, 3,254 edges, 345 communities and 2,698 graph notes, with zero model calls**. Workspace MEMORY.md, feature/rule/operation/scenario documentation and the Obsidian documentation mirror are synchronized. No owner decision blocks this local handoff. Production deployment remains a future operator action; apply048 then049 together before the matching backend.

## Retained exploratory/failing evidence

An initial attempt to batch legacy statement gate joins was slower and was discarded; invoice-service.js retains the pre-H10 gates byte-for-byte. Initial browser-budget navigation assertions assumed a Jobs heading/expanded parent menu; corrected locators wait for the actual list/navigation. A synthetic500 assertion was aligned with the existing sanitized error message. Full regression found PostgreSQL's nullable-join row-lock refusal after048;049 and four physical-contention tests correct it. The first new lock tests had no transaction fixture; an explicit synthetic seed now prevents vacuous testing. All retained attempts are distinguished from final accepted command results.
