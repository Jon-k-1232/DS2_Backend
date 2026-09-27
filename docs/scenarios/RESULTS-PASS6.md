# PASS6 — H8 full browser and user-mistake acceptance

Status: **accepted locally, 2026-09-27**. All **51 required commands** have accepted exit-0 results: **5,724 unique tests**, plus the required second complete 340-test browser pass. Zero final failures, skipped, pending, flaky or retried tests. The two full browser passes were consecutive, with all **954 tracked source/test/schema files unchanged**. Protected-data, drift, graph and documentation verification are complete.

## Required validation

All test processes run serially. Integration files run one at a time, with `.env.local` for ordinary integration, `.env.scenarios` for scenario/path matrices and `.env.clean` for clean-room. The browser connects to the managed server at `ws://127.0.0.1:3334/`, with one worker and retries zero. Application servers are managed externally; H8 only uses the supplied backend restart request protocol.

| Required command family | Passed | Scope |
|---|---:|---|
| Backend unit | 1,238 | Exact brief command, excluding integration |
| Ordinary integration | 1,163 | 42 files, each a separate Mocha process |
| `npm run -s test:scenarios` | 2,342 | 60 files, serial scenario/path-matrix runner |
| `npm run -s test:cleanroom` | 18 | Complete synthetic clean-room lifecycle |
| **All integration** | **3,523** | **103 files; includes the preceding scenario and clean-room counts** |
| Payment-image Lambda pytest | 17 | Local mocked external services |
| Frontend Jest | 606 | 91 suites, CI mode |
| `CI=true npm run build` | Passed | Production frontend build |
| Read-only drift | 0 | 1,014 client/business comparisons, 338 clients |
| Full Playwright, first pass | 340 | 1,438.01 seconds; retries 0; no failed, skipped or flaky tests |
| Full Playwright, second consecutive pass | 340 | 1,429.39 seconds; retries 0; no failed, skipped or flaky tests |

`DS2_Backend/docs/decisions/evidence/run-H8/validation-commands.json` records every exact command, environment, working directory, duration, exit code and log filename. `final-acceptance.json` selects the accepted attempts, rejects skipped/pending/flaky/retried results and records both browser statistics. Focused repetitions and initial red tests are excluded from the unique-test total. Scenario and clean-room counts are not counted twice.

## Coverage and observed behavior

[H8 hand oracles and workflow mapping](H8-browser-and-help.md) cover all 39 sidebar destinations, all nine client-profile tabs, invoice/receipt details and every supported workflow in the reorganized UI. [H8 results](../decisions/2026-09-26-run-H8-results.md) describe the implementation and link before/after screenshots.

- The shared information button opens with the keyboard, has the accessible name **About this page**, explains the selected page in five bullets, closes with Escape or Close, and returns focus. Delayed grids cannot steal that focus. Every navigation/help entry is checked, and the generated Obsidian help document matches its source bytes.
- A refused network/server payment adds nothing. Retrying after the server committed but its response was lost returns the original $50 receipt, without another cash entry or audit event. The retained oldest-first case applies one $1,000 check as $300 + $450 + $250 and preserves the original ages, leaving $150 owed.
- Two actual browser tabs review a $5 memo on a finalized $22.50 invoice. The first leaves $17.50 owed; the second gets 409 and writes nothing. Back/reload retains $17.50 and the exact original invoice row. Existing correction tests retain refunds, void/rebill, reversals, immutable artifacts, wrong businesses/clients and admin-only application.
- Receipt corrections wait for both required reads. Failed open-invoice and correction-register reads expose recovery without stale actions. Account Audit blocks an old selection during loading/error and ignores older search responses. Create invoices and report controls wait for real data.
- All three Payment imports lists expose failed reads with a reload action and explanatory empty states. A late month response cannot replace the selection, and loading page two preserves that page. Browser tests verify that read errors, recovery, month changes and paging add no audit events or money.
- AR uses clear business columns, collapsed historical controls, correctly placed estimate badges and neutral zero totals. Memo records show names/status and unbroken document numbers/dates. Ordinary grids show business labels instead of internal keys. Catalog/job creators and quote client/service labels are account-scoped and readable.
- H9 lookup, compact-response and lazy-route cases remain. H10 tests compare complete original/current calculations and require actual rows/totals and ready controls within the original budgets. No threshold or financial assertion is weakened to obtain a pass.

For all changed presentation readers, injected query failures preserve every committed table, including audit and queue metadata. Existing role, tenant, validation, not-found, finalized and storage-error matrices remain. A quote-list fault injection now targets `getLabeledQuotes`, the actual GET reader; post-mutation refresh continues to use its original reader. Historical HTTP-500 versus HTTP-200/error-envelope conventions remain explicit in the tests.

## Repeated browser performance

H10's existing budgets remain unchanged. Each run navigates from a loaded workspace, excludes one warmup, and takes the median of three samples against read-only account-1 GETs. Values below are **first rows / all controls ready**, in milliseconds. This is not cold-start or full Audit-job time. H9's login response remains **175,160 bytes**; save-refresh and bounded-lookup checks pass. The API suite retains **2,070 original-reader comparisons**.

| Page | Budget (ms) | First full run (ms) | Second full run (ms) |
|---|---:|---:|---:|
| Create invoices | 1,000 | 825 / 832 | 840 / 846 |
| Accounts receivable | 1,000 | 818 / 818 | 799 / 799 |
| Account Audit list | 1,500 | 222 / 222 | 223 / 223 |
| Billing performance | 2,000 | 955 / 955 | 966 / 966 |
| Client rates | 2,000 | 898 / 898 | 908 / 908 |
| Time allocation | 2,000 | 890 / 890 | 901 / 901 |
| WIP / Unbilled | 2,000 | 852 / 852 | 859 / 859 |
| Job budgets | 2,000 | 812 / 812 | 810 / 810 |
| Tax season capacity | 2,000 | 826 / 826 | 827 / 827 |

Each complete run preserves its own performance JSON in `evidence/run-H8/measurements-browser-1` or `measurements-browser-2`. All five earlier H9/H10 measurement files were restored byte-for-byte after the second run; `historical-measurements-restored.json` records the verified hashes.

## Protected account 1

The final census directly matches the read-only reference for all seven tables. All twelve protected source/audit row digests equal the initial census, and the **207,272-event audit chain is valid**. H8 changed **zero account-1 rows**.

| Table in ds2_local | Account 1 rows | Read-only reference |
|---|---:|---:|
| customers | 338 | 338 |
| customer_transactions | 39,052 | 39,052 |
| customer_payments | 1,005 | 1,005 |
| customer_writeoffs | 657 | 657 |
| customer_invoices | 2,253 | 2,253 |
| timesheet_entries | 28,255 | 28,255 |
| users | 23 | 23 |

H8 introduces **no migration, backfill or intended account-1 row change**. The seven required counts use `default_transaction_read_only=on` for both local and reference connections, as expressly authorized by the owner’s H8 clarification. Twelve before/after row-content digests cover those tables plus audit events, audit head, recurring plans, retainers and jobs. Final evidence is `account1-before.json`, `account1-after.json` and `account1-audit.json` in run-H8. All test writes use fixture account 9001 or disposable scenario/clean databases.

## Handoff

There are no new endpoint contracts (221 remain), no new table or write path, and no new SQL rollout step. Existing migrations 002–049 remain the 48 forward files; 050 is free. Deploy the matched backend/frontend after the already documented 049 prerequisite, under the normal separate deployment authorization.

Page help, affected feature rules, integrated design, README/index, operation notes, scenario docs, FINAL_REPORT and workspace MEMORY are maintained with this pass. Offline Graphify is complete: **585 source files, 2,381 nodes, 3,282 edges, 354 communities and 2,735 generated notes**, with zero model tokens. The existing Obsidian synchronization mirrors **142 documentation notes**, the report, workspace memory and H8 screenshots. H8 screenshots are included in the vault so the before/after links work; raw test logs and JSON remain in the backend evidence directory. Earlier H9/H10 measurement bytes have been restored after keeping separate H8 measurements.

No Git command, production/AWS connection, deployment, real email, bank integration, period close or approval workflow was introduced. Finalize remains sent and locked; only admins/super admins apply adjustments, each acting alone. The original balance-forward model, H2 cutover rule, audit evidence and printed interest line remain intact. No owner policy question blocks the local handoff.
