# Run H7 — full API, scenario and regression pass

2026-09-26. Local implementation and verification of the owner's test requirement. **Local acceptance is complete.** [PASS5](../scenarios/RESULTS-PASS5.md) is the detailed evidence record; [combined oracle](../scenarios/H7-combined-lifecycle.md) and [218-contract matrix](../scenarios/round2-path-matrix.md) define the arithmetic and API cases.

H7 adds a complete two-business lifecycle and API request-shape, historical-date, retry-target, state-transition and concurrent-operator cases. It preserves all H0–H6 coverage. Defect-first tests exposed malformed-input handling, invalid calendar/UTC cutoffs, backdated corrections, wrong-target retry success, lost cash attribution through rebill, duplicated supporting fee cohorts and customer-form submission/error gaps. Fixes preserve actual ledger balances, original issued records and old valid retries. Reports now retain mixed funding lineage across repeated rebills and assign source fee/effort/cost to the surviving cohort once.

No routes, screens, tables, migrations or backfills are added. The existing New Customer form now prevents concurrent submits, displays server/transport errors and retains the draft; lost confirmation directs the operator to check the client list before explicitly retrying. Six backend runtime files, one frontend runtime file and nine test/helper files are in the [source inventory](evidence/run-H7/source-changes.json). Next migration remains 047. Existing adjustment routes use `requireAdmin`; any admin or Super Admin acts alone. Managers/employees cannot mutate adjustments, while ordinary entries and read permissions stay unchanged. No approval workflow or period close.

The combined oracle independently verifies Create Invoice, Account Audit, AR and original obligations by business after posting; it preserves original PDF bytes and the audit chain. Before the bounce: net billed 380, collected 290, cash received 350, cash returned 30, labor 52, margin 328 and debt 100. After bouncing the complete 250 receipt: A220/B130 with original ages; new cash settles 350 without touching the 50 retainer balance. 

H7 has zero intended account-1 effects. Counts are compared with retained reference census; the reference database stays unconnected. Local backend restart completed through the managed request/done mechanism. Offline Graphify:554 code files, 2,295 nodes, 3,180 edges, 348 communities, 2,643 notes and zero model calls. Documentation/rollout rules are updated; production deployment remains a separate operator action.

## Accepted validation and protected data

Unit **1,227**; integration **3,392 / 98 files**; standalone scenarios **2,234 / 57 files**; clean-room **18**; Lambda **17**; Jest **498 / 80 suites**; CI build passed; full remote Playwright **260 passed**.

All **106 required commands have accepted exit-0 results**, with zero final failures, skipped, pending or flaky tests. Accepted rechecks of eight command groups replace earlier results without double-counting. Scenario and clean-room totals overlap integration. The nine targeted browser repetitions are additional evidence, not added to the full-suite count. Read-only drift is **0 across 1,014 client/business comparisons**, with aggregate difference 0.

All seven required source counts match the retained reference census, all 12 captured table counts/digests are unchanged, and the **207,272-event** audit chain verifies. The reference database was never connected. H7 has **zero intended migration/backfill effects and zero observed account-1 changes**. Next migration remains 047.

| Protected account-1 table | Before = after = retained reference count |
|---|---:|
| `customers` | 338 |
| `customer_transactions` | 39,052 |
| `customer_payments` | 1,005 |
| `customer_writeoffs` | 657 |
| `customer_invoices` | 2,253 |
| `timesheet_entries` | 28,255 |
| `users` | 23 |

The initial full browser run had one Chromium `ERR_NETWORK_IO_SUSPENDED` during client setup after the client committed. The trace and audit evidence remain in PASS5. Customer transport/double-submit defects were reproduced independently and fixed; the unchanged retainer case and new customer case each passed three consecutive runs before final full acceptance. A later browser fixture used UTC tomorrow instead of the displayed Phoenix date; it now uses the screen date without changing any assertion or application policy. The separate fixture failure is retained in PASS5. No test was removed or weakened.

[Accepted manifest](evidence/run-H7/acceptance/final-acceptance.json), [protected verification](evidence/run-H7/account1-verification.json), [final backend restart](evidence/run-H7/backend-restart-final.json), [Graphify refresh](evidence/run-H7/graphify-refresh.log). Deploy backend and frontend through the operator process after existing migration 046 prerequisites; no data repair is needed. No production deployment, Git operation, AWS/reference-database access or real email occurred. Documentation, workspace MEMORY and Obsidian are synchronized. No owner decision blocks H7.
