# H9 — bounded data loading and lazy routes

**Implemented and verified locally; not deployed.** All accepted checks pass: **5,531 distinct tests**, zero final failures, skipped, pending or flaky tests. Login JSON fell **99.81%**, from 89.4 MiB to 171 KiB. The production main JavaScript is 62.25% smaller raw and 58.18% smaller gzipped. The account-scale job budget passes for all 12 measured combinations. Full command logs, query plans and raw samples are retained in [evidence/run-H9](evidence/run-H9/).

## Behavior, routes and screens

- Bootstrap keeps compact client identities and small reference catalogs. Its compatibility jobs key is empty; it never queries the account-wide job history or builds grid/tree duplicates. Ledger first pages contain at most 20 rows.
- New reads: `GET /jobs/getJobs/:accountID/:userID`, `GET /customer/lookup/:accountID/:userID`, and `GET /retainers/getRetainers/:accountID/:userID`. The current README inventory is **221 contracts**. Jobs and retainers page/search by business; jobs use stable, allowlisted server sorting. Their export/print menus explicitly operate on the current page. Retainer root/draw snapshots remain visible as separate history rows; the client profile retains its tree.
- `GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID` now searches/pages at most 100 choices. Normal choices use the latest family version. Optional `currentCycle=true` preserves the write-off picker's exact job-version grouping and sums only billable, unbilled, non-retainer work, including zero-valued historical groups. It never substitutes the lifetime job total. Client/business changes discard obsolete results and clear the old visible/search term, including switching away and back. The same reset applies to recurring plans and inline billing review.
- Client pickers retain an instant compact directory through **1,000 active clients**; above that threshold they search with a 200 ms debounce and at most 50 choices. Selected inactive/historical identities hydrate directly. Loading, failure and stale-response behavior is explicit. The 1,001-client backend fixture and browser remote-directory mode both pass.
- Customer, job, transaction, payment, write-off and retainer create/edit/delete responses identify changed records or deleted IDs and refresh only the first 20 affected rows. The `committed:true`, saved/reload/do-not-resubmit contract survives response-hydration failure. Customer updates patch only compact identities and that client's recurring plans. A paginated grid never overwrites shared references.
- Bootstrap and core save responses carry each row once; their grid/tree views are derived on demand in the browser. Selected job records hydrate labels/rates and bounded dependency previews across the whole family, including payment-only links; catalog delete previews are bounded by type/category.
- The existing client profile route accepts `section=invoices`, `payments` or `retainers` for entry forms. Active payment create/edit, write-off and pending-payment selectors request only invoice snapshots; editors hydrate exact job/retainer references separately. Retainer deletion checks the complete client payment history, not a grid page, without fetching unrelated jobs/work. Credit transfers request retainer history only. Actual client profile/tree views remain per-client. The projection preserves the existing profile error envelope and role/business guards.
- Inline processed-work review uses client type-ahead in either directory mode, keeps the selected client for inline job creation, and scopes job choices to the transaction business. Changing client clears the old job/search and requires a new job. Lookup/save failures preserve the work; a synthetic browser oracle moves exactly $22.50 only after a successful retry.
- Workspace pages and record forms use `React.lazy`/`Suspense` with a consistent accessible loading state. After successful bootstrap, idle prefetch covers Enter time/Transactions and Create invoices for permitted roles. Router transitions retain the outgoing virtual grid until the next chunk is ready. Billing Review waits for suggested references before its one-time form prefill.

Affected screen coverage includes time/charge entry and edits/deletes, legacy and received payments, write-offs, retainers, client/job records, job/category/type deletion, billing/pending-payment review, recurring plans, credit transfers, and all routed pages. Existing tests retain their financial, role, tenant, lock, double-submit, stale-selection, storage/database failure and audit assertions. Save tests now locate changed records independently of the first page.

## Payload and API measurements

| Measurement | Before | After |
|---|---:|---:|
| Login JSON bytes | 93,746,515 | 175,160 |
| Login gzip bytes | Approximately 2.9 MB through Nginx (owner baseline) | 16,737 using local Node gzip |
| Local HTTP round-trip plus full response body | 1392.39 ms | 198.71 ms |
| Production main JS raw | 1,944,462 bytes | 734,043 bytes |
| Production main JS gzip | 549,176 bytes | 229,676 bytes |

The owner's earlier internal query/stringify/parse observations were approximately 270/200/100 ms. Those are separate phases, not the same measurement as an HTTP request. The final in-process API budget run measured 213.40 ms end-to-end and the server access log reported 203.519 ms. JSON alone must stay below **1,000,000 bytes**. No post-change browser heap claim is made.

A transaction save previously built approximately 92 MB according to the owner's baseline. Protected account 1 was never saved to measure a response. Instead, its read-only refresh builders were measured below; synthetic API scenarios independently verify actual changed-record envelopes and money outcomes. These byte counts exclude the small changed-record/message envelope.

| Affected save refresh | Account-scale builder bytes |
|---|---:|
| Transaction | 31,488 |
| Job | 11,589 |
| Payment | 28,845 |
| Writeoff | 27,256 |
| Retainer | 1,535 |
| Customer | 11,710 |

Seven HTTP samples per client, with all samples retained, give these medians. The separate executable budget warms once then takes seven samples, covering normal/current-cycle choices both with and without business scope. All 12 medians pass **<50 ms**; the largest accepted median is 43.73 ms.

| Client ID | Historical job rows | Normal, all businesses (ms) | Normal, default business (ms) | Current cycle, default business (ms) |
|---|---:|---:|---:|---:|
| 6 | 20,595 | 22.26 | 22.48 | 39.67 |
| 5 | 18,563 | 20.02 | 22.92 | 38.18 |
| 298 | 397 | 8.13 | 8.17 | 13.90 |

## Query plans and indexes

The latest-job query scopes account/client before family ranking. It applies the jobs view's equivalent raw shared-or-selected-business predicate and resolves effective attribution only for returned rows. This removed approximately 200 ms per SQL query of repeated attribution work in the first scoped implementation. Current-cycle totals use unique-key, account-qualified joins in the exact existing precedence: explicit entity, amended legacy billing scope, original attribution, then reviewed resolution. A read-only equivalence test compares all eligible rows/counts and amounts with the original business-scoped transaction view across all businesses for the three largest histories. That correction reduced the first current-cycle HTTP implementation from approximately 172/162 ms to the values above.

`EXPLAIN (ANALYZE, BUFFERS)` execution times in ms follow; pairs are count/data queries. Instrumentation `set_config` calls are omitted from this table, retained in the raw JSON.

| Query | Execution time (ms) |
|---|---:|
| clientJobs | 8.336 / 9.612 |
| selectiveClientJobs | 0.199 / 0.260 |
| businessClientJobs | 8.391 / 9.737 |
| businessCurrentCycleJobs | 16.288 / 25.497 |
| businessJobsRegister | 14.644 / 16.376 |
| clientSearch | 0.034 |
| businessRetainers | 0.123 / 0.231 |
| businessClientInvoices | 1.287 |
| businessClientPayments | 0.759 |
| businessClientRetainers | 0.174 |

The new job/client/retainer indexes and existing invoice/payment/transaction/evidence indexes support these paths. PostgreSQL may choose a cheap sequential scan for a small catalog. No additional index was justified by the measured plans. [Raw plans and index definitions](evidence/run-H9/api-after.json).

## Browser readiness and route chunks

These are local development-server measurements, not production Web Vitals. The comparable before/after measure is **visible page shell plus network idle**; it is a limited time-to-interactive proxy. The readonly identity blocks automatic recurring preparation, so the Create invoices shell measurement does not prove balance readiness. The before recorder captured XHR; the after recorder captures XHR and fetch. Request inventories are retained in both JSON files.

| Screen | Before shell/network-idle (ms) | After shell/network-idle (ms) |
|---|---:|---:|
| Create invoices | 2,632 | 1,500 |
| Enter time | 2,792 | 1,498 |
| Receive payment | 2,608 | 1,475 |
| Jobs | 2,757 | 1,537 |

A separate final test renders real account-scale Create invoices balance rows and enabled controls in **5,103 ms**. It substitutes only the automatic preparation POST with the real read-only due preview; the balance GET/grid are real. It performs no account-1 preparation or invoice issuance. There is no equivalent pre-change financial-data readiness sample, so no before/after improvement is claimed for that calculation. Account-wide financial calculations remain the main residual wait on this screen. All five page budgets are below 12 seconds.

The final build has **101 JavaScript files**, including one eager main entry and 100 deferred/shared chunks. All-route totals are **2,876,456 raw / 924,034 gzipped bytes**; they are larger than the entry bundle and are downloaded as routes are visited or prefetched. The historical artifact captured only the old monolithic main, so it is not an audited all-asset total. Idle prefetch is additional traffic, not required first-screen code. Gzip comparisons use the same Node default compression. Largest deferred/shared chunks:

| Chunk | Raw bytes | Gzip bytes |
|---|---:|---:|
| `6300.4da437db.chunk.js` | 289,157 | 84,017 |
| `1671.103edcbf.chunk.js` | 128,574 | 38,645 |
| `3245.637e824e.chunk.js` | 73,468 | 18,816 |
| `6651.19e38b7b.chunk.js` | 69,051 | 17,409 |
| `6953.c2f31f4a.chunk.js` | 51,240 | 14,317 |
| `2429.3bb10d09.chunk.js` | 47,750 | 13,511 |

[Every chunk and initial entrypoint](evidence/run-H9/bundle-after.json), [before browser samples](evidence/run-H9/browser-before.json), [after browser samples](evidence/run-H9/browser-after.json).

## Financial regression repairs

An evening run exposed two existing calendar-boundary errors. Legacy aging now compares snapshot eligibility using the existing Phoenix billing calendar, while `recordedThrough` remains a UTC instant. A child balance recorded after midnight UTC but still on the same local billing date is no longer treated as tomorrow. Retainer cash analytics uses the same calendar for recorded deposit timestamps, including December 31 after midnight UTC. Date-only evidence stays a date. Four explicit unit boundary oracles and the unchanged H7 combined $350 cash oracle pass. No stored financial or audit row is rewritten.

The H9 synthetic money oracle remains charge 40 → issued 40 → received payment 5 → unbilled write-off 2: billed due 35 and next invoice 33; a separate held retainer of 10 remains available, not subtracted twice. Current-cycle choices distinguish business A's unbilled 40 from business B's 33 and exclude billed/nonbillable/retainer-funded amounts. [Hand calculations](../scenarios/H9-bounded-loading.md).

## Accepted validation

| Required group | Accepted result |
|---|---:|
| Backend unit command | 1,232 passed |
| Ordinary integration files, sequential | 1,144 passed / 41 files |
| `npm run -s test:scenarios` | 2,324 passed / 58 files |
| `npm run -s test:cleanroom` | 18 passed / 1 file |
| All unique integration files | **3,486 passed / 100 files** |
| Lambda `python3 -m pytest -q tests` | 17 passed |
| Frontend Jest | 527 passed / 84 suites |
| `CI=true npm run build` | Exit 0 |
| Full externally connected Chromium Playwright | **269 passed**, 0 unexpected, 0 flaky, 0 skipped |
| Read-only drift command | Exit 0; drift 0 |
| Protected source census/digests and audit chain | Passed |

All accepted groups have **zero failures, skips or pending tests**. Scenario and clean-room results are part of the integration total, not additional tests. Focused rechecks are retained but not double-counted. Integration files and every test process ran sequentially. Browser execution used the provided WebSocket server with one worker; no browser was launched inside the sandbox, and the managed frontend/backend servers were not started or killed by this run. Managed backend restarts used the requested control file and were confirmed by later `ok` acknowledgments.

[Exact commands, environments, exits and timings](evidence/run-H9/final-command-results.json), [per-file integration results](evidence/run-H9/integration-counts.json), [Playwright summary](evidence/run-H9/playwright-summary.json), [drift](evidence/run-H9/drift.json).

Earlier failing evidence is retained: the initial full browser run found a prefilled selector helper, an outgoing MUI virtual-grid scroll during lazy navigation, and an obsolete retainer tree locator; all were repaired with their assertions retained.

A later CSV test used a search term absent from the real dataset; it now derives a real term and requires nonempty results. The current-cycle oracle initially attempted to assign work to another business's explicit job version and correctly refused; its shared-job fixture was corrected.

Two early intermediate browser runs were intentionally interrupted: one to finish projection changes, and one after a delayed-business test passed its draft/save assertions but its route cleanup raced a handled request. That interceptor now falls through to the existing context guard and stays registered for its fresh context lifetime, allowing save refetches and idle chunks to finish without a routing-table change. Three consecutive focused repetitions pass. Neither interrupted run is an acceptance result.

A subsequent full 268-case run caught an obsolete exact-URL error interceptor after the retainer form switched to a payments-only query. The interceptor now targets that projection and proves it blocked the read, preserving the disabled-delete and unchanged-money assertions.

A final consumer inventory found an additional inline Billing Review dropdown that still depended on the small local directory. Its in-progress browser rerun was stopped for correction. Inline review now uses remote client type-ahead, keeps the selected client for inline job creation, scopes jobs to the transaction business and clears the old job/search when the client changes. A synthetic browser oracle proves lookup failure, missing-job refusal and save failure leave both clients unchanged, then a retry moves exactly $22.50. Fresh frontend Jest, production build, focused checks and the full browser regression followed.

A later complete browser run exposed an ambiguous lock-text locator while lazy navigation retained the outgoing invoice grid. The helper now awaits the selected invoice’s lock alert by invoice number, preserving every reversal amount, revision amount and original-PDF hash assertion. Three focused repetitions and the final full suite verify it. Calendar and query-plan failures remain documented rather than hidden by skipped tests.

## Migration and protected data

**047.bounded_lookup_indexes.sql** adds five idempotent indexes: account/client/date/ID and account/family/date/ID on jobs, account/active/name/ID on customers, and account/date/ID plus account/client on retainers. It is plain SQL with no BEGIN/COMMIT. Applied individually with `psql -X -1 -v ON_ERROR_STOP=1 -f` to **ds2_local, ds2_clean and ds2_scenarios at 127.0.0.1:5433**. Migration logs are retained. Scenario reset discovers 047; `migrate.spec` expects 46 forward files (002–047); `migration-H9.spec` verifies rerun and source/audit preservation. **048 is next free.**

**Exact intended account-1 effects: five indexes; zero business rows inserted, updated or deleted; zero audit events; zero backfill.** All 12 captured source table counts/digests remain unchanged, and the **207,272-event** audit chain verifies. The seven required counts match the retained reference census:

| Account-1 table | ds2_local after | Captured reference count |
|---|---:|---:|
| `customers` | 338 | 338 |
| `customer_transactions` | 39,052 | 39,052 |
| `customer_payments` | 1,005 | 1,005 |
| `customer_writeoffs` | 657 | 657 |
| `customer_invoices` | 2,253 | 2,253 |
| `timesheet_entries` | 28,255 | 28,255 |
| `users` | 23 | 23 |

[Protected verification](evidence/run-H9/account1-verification.json). Synthetic writes were confined to fixture account 9001 in ds2_local and disposable ds2_clean/ds2_scenarios. Performance queries use read-only connections; account-1 browser mutations are blocked.

**Boundary deviation:** the initial measurement script made a read-only connection to `ds2_ref_20260922` to count the seven required tables, contrary to the instruction to leave it untouched. No writes occurred. This was reported to Jon, and the script was blocked from rerunning. Final verification connects only to ds2_local and uses already captured reference counts and retained H7 hashes. No further reference connection was made.

## Documentation and rollout

README's endpoint index, architecture, initial data, customer/job/catalog/transaction/recurring guides, payments/write-offs/retainers/pending review, billing review, business/credit transfer, analytics, navigation, scenario oracles, integrated decisions, migration instructions, operations and FINAL_REPORT are updated. Workspace MEMORY.md records this handoff. Offline Graphify covers **565 source files, 2,327 nodes, 3,226 edges, 341 communities and 2,668 Obsidian graph notes**, with zero model calls. The documentation mirror is synchronized.

Future operator rollout: apply 047 after 046 during an ordinary-index lock window; deploy backend/frontend together; restart the backend and refresh existing browser sessions because bootstrap/save shapes changed. Recheck lookup budgets, record hydration, current-page exports, committed warnings and drift 0. Existing admin-only adjustments, immutable issued records, audit actors/reasons, balance-forward statements, default-business opening, interest printing and email/automation settings remain in force. No period close or approval workflow was added.

No Git, production/AWS action, deployment, real email or external publication was performed. No owner question blocks the local handoff. Per-client history/tree views and account-wide financial calculations retain their existing scope; small master catalogs remain reference lists.
