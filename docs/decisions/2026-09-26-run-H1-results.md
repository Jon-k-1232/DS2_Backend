# H1 results — business entities

2026-09-26. Local implementation, migrations and sequential acceptance are complete. No Git command, commit, deployment, AWS call, production connection or real email was performed. The reference database was not accessed.

> H2 superseded the original H1 financial cutover described below. The correction section at the end preserves the old numbers as history and records the deployed-local replacement: all legacy opening items stay together in the default business, with no legacy hold. See [H2 results](2026-09-26-run-H2-results.md).

## Delivered behavior

One account can administer multiple billing businesses. Customers and staff remain shared; work, money, plans, statement dates, carry-forward, held funds and invoice numbers are scoped to their business. Manual entry requires an active choice. Changing the business clears incompatible job, invoice and retainer selections. Inactive historical records remain readable. Admins can reassign only unissued, unfunded work with a reason and current source hash. Finalized records cannot change business.

Settings supports names, legal/contact details, address, logo, default, activity, invoice prefix and exact tracker aliases. Unknown or ambiguous tracker business text is held before financial processing; a reasoned admin assignment preserves the raw source. Prefixes and logos are frozen into issued evidence. Each issuer has a locked yearly number sequence. PDFs retain the existing interest line. A combined client statement prints a separate section for each business rather than combining payable invoices.

Create Invoice, AR, Account Audit, Audit Record, customer summaries and analytics accept business scope. Existing financial grids/forms, CSVs and profile tabs expose the business. The three financial views retain the rolling model: latest child snapshots, newest statement gates and absorption markers. Compare billed B between all three views, and next-statement N between Create Invoice and Account Audit; held funds remain separate.

Reasoned **credit transfers** move available retainer/prepayment funds between businesses for the same client. They require an admin or super admin, current source snapshot, available amount and UUID key. They append paired evidence and no cash receipt. Retry returns the committed response; stale/changed requests refuse atomically. Audit reporting does not mislabel an outgoing transfer as work drawn or an incoming transfer as a new receipt. H2 must extend this operation to its future credit lots. Issued statement credits are not silently converted into held cash.

Jon's addendum is recorded in the integrated design: any one admin can apply adjustments, no second approver and no period-close workflow. H1 enforces it on transfers. H3 remains responsible for the explicitly assigned retrofit of existing write-off, retainer-event, bounced-check and duplicate-removal actions. Their unchanged pre-H3 permissions are not represented as implemented here.

## Routes and screens

There are **17 new session-account contracts** under `/billing-entities`, bringing the documented total to **177**. The [endpoint index](../README.md#h1-business-entity-endpoint-index-additions) and [feature contract](../platform/billing-entities.md#api) list every method/path, permission and input. They cover list/create, detail/edit, balances, alias add/remove, verified logo read/upload, review/read/resolve, transfer history/posting, unissued-work reassignment and legacy opening read/apply. Financial write guards also enforce entity ownership on existing routes; tenant/role checks remain in place.

New pages: `/settings/entities`, `/settings/entities/new`, `/settings/entities/:entityId`, `/settings/entities/cutover`, `/work/review/entities` and `/payments/transfers`. Business pickers and filters extend existing pages; old routes remain until H6. Work reassignment retains its job: a business-specific job must first be changed to a suitable shared job through the existing edit flow. No job totals move outside that flow.

## Migrations and cutover

**028–036** were applied manually, individually and transactionally to **ds2_local, ds2_clean and ds2_scenarios**, using `psql -X -1 -v ON_ERROR_STOP=1 -f`. There are **35 runnable migrations (002–036); 037 is next free**. All new tables/write paths have audit capture; immutable evidence has append-only guards. Actor/reason comes from the authenticated session, and migrations record a system source. Scenario reset and clean-room restoration discover the forward chain; migration tests cover rerun preservation and direct SQL guards. The dedicated runner now discovers every scenario- and path-matrix- integration file, including H1, rather than only lifecycle/what-if scenario names.

| Migration | Change |
|---|---|
| 028 | Businesses, aliases, numbering, cutover/attribution/review evidence and effective read views |
| 029 | Mandatory entity relationships, opening positions, consumption links, requests and transfers |
| 030 | Exact tracker attribution, audit company metadata, sequence identity, default/prefix safeguards |
| 031 | Initial pending-payment choice and unused-account default teardown |
| 032 | Reviewed signed opening slices and separate business projections |
| 033 | Generic trigger handles rows without invoice-parent fields |
| 034 | Saved Account Audit business scope |
| 035 | Freeze original default opening sources as well as split sources |
| 036 | Let ordinary mutable invoice updates pass NEW through that guard |

The [migration manifest](evidence/run-H1/migration-manifest.json) records every file hash and its three local application logs. No applied migration was rewritten. 035's intermediate ordinary-update behavior was corrected immediately by 036 before application tests resumed. Apply the complete sequence before writers run. Opening slices replace, never add to, the source chain; payment/write-off children and first-statement absorption consume each slice once. Both default and split oracles prove original sources remain unchanged.

Future production rollout is an operator step, **not performed**: see [operations](../platform/operations.md#h1-business-cutover) and FINAL_REPORT section 14. Pause writers; back up/rehearse; preserve source/artifact inventories; apply 028→036; deploy matching backend/frontend; review opening routing and held work; reconcile B/U/P/N/funds and audit integrity; then resume. There is no safe return to an old writer against these guards.

## Exact protected-data effects

[Account 1 report](evidence/run-H1/account1-cutover-report.json) compares every original field by per-row SHA-256 against the retained [pre-H1 inventory](evidence/run-H1/account1-before.json). All **11 source tables** have no changed, added or removed original rows. The seven requested counts match the retained reference census in FINAL_REPORT; no live comparison connected to ds2_ref_20260922.

| Required table | Before / after / retained reference |
|---|---:|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

Additional unchanged counts: retainers 3, recurring plans 8, quotes 0, jobs 49,555. New nullable business columns leave historical physical values null; effective attribution comes from sidecars. No historical amount, date, name, invoice number, contact, user or original artifact path changed.

Every intended account 1 insertion is enumerated in the CSVs under [evidence/run-H1](evidence/run-H1):

| New evidence | Rows |
|---|---:|
| Businesses: James F. Kimmel & Associates (default INV), Kimmel Financial Advisors, Jim Kimmel Insurance Agency, Inc. | 3 |
| Cutover manifest | 1 |
| Legacy attributions: transactions 18,906; payments 1,005; write-offs 657; retainers 3; invoices 2,253; recurring 8; trackers 28,252 | 51,084 |
| Unresolved-work review rows | 20,146 |
| Default opening positions, total $41,015.00 | 39 |
| Audit events with migration028/029/030 sources | 71,273 |

The account 1 audit chain has 71,273 verified events and one chain head. There are **zero** aliases, reviewed resolutions, custom opening allocations, consumption links, credit transfers, invoice-sequence reservations or financial request rows in account 1. Real-estate businesses were not invented. The snapshot has three unmatched legacy tracker rows, differing from the brief's four; the raw inventory records the observed strings.

## Financial reconciliation

The report writes per-client original-scope values, per-client/business after values, and held-work CSVs. Original-scope values are **recomputed from hash-verified unchanged physical rows**, not claimed as a captured pre-migration engine run. Holding unresolved work changes eligible U/N; include separately held eligible work when reconciling conservation.

| Scope | B billed | U eligible work | P pending adjustments | N next statement | Held funds |
|---|---:|---:|---:|---:|---:|
| Original scope, recomputed | 41,015.00 | 1,513,217.50 | −1,493,344.00 | 60,888.50 | 5,472.00 |
| Default tax business | 41,015.00 | 213,318.25 | −1,493,344.00 | −1,239,010.75 | 5,472.00 |
| Financial advisors | 0.00 | 291,171.50 | 0.00 | 291,171.50 | 0.00 |
| Insurance agency | 0.00 | 1,487.50 | 0.00 | 1,487.50 | 0.00 |
| All resolved businesses | 41,015.00 | 505,977.25 | −1,493,344.00 | −946,351.75 | 5,472.00 |

Held eligible work is **1,007,240.25**. Adding it to after U/N yields the original totals exactly. Total unresolved work is 1,007,598.25, including 358.00 not currently eligible. Reconciliation differences are **0** for B, U including held work, P, N including held work and held funds. The large pre-existing pending adjustments are preserved for accountant review; H1 does not repair them, issue a refund or write a balancing entry. An unrelated resolved business can still bill. Accountants must resolve held work before that work can be billed.

A [source hash inventory](evidence/run-H1/source-change-manifest.json) records changes against the saved H1-start coverage; previously uninventoried helpers are explicitly distinguished from proven modifications.

Original remote PDF bytes were not fetched because AWS access is forbidden. The report verifies original database rows and paths, not an independently observed remote object digest. Synthetic issuer PDFs and combined statements were generated locally, text-checked, rendered and visually inspected; entity administration, AR and transfer screenshots were also visually inspected in [UI evidence](evidence/run-H1/ui); [PDF samples](evidence/run-H1/pdf) show separated amounts/letterheads. The original interest-template source hash is unchanged.

## Tests and fixes found during regression

The [hand-computed oracles](../scenarios/H1-business-entities.md) cover 100/250 separate statements, tax-only carry-forward 140, funds 80 transferred 30 with total 80 preserved, a 90 opening split 60/30 with payments/write-off and one-time absorption, an unsplit 90 opening paid 5 then carried 85, unknown tracker review, and unissued reassignment refused after finalization. H1 route tests exercise role/tenant/validation/not-found/conflict/stale/retry and injected database/storage failures, comparing whole-database state on refused operations.

Regression exposed and fixed: an eligibility URL segment bypassing business context; saved audit badges keyed only by client; immutable default opening sources being treated as mutable parents; shared-job reassignment affecting an unsupported job move; late AR responses overwriting a newer business filter; transaction CSV scope; transfer receipts/draw reporting; blank optional letterhead lines; and a combined statement renderer referencing an absent PDF dependency. Combined PDFs now use the installed PDFKit renderer. Earlier invoice/payment/lock assertions remain meaningful.

The first full browser run passed 109 and failed 11. Three failures were old Account-versus-Settings navigation expectations, seven were a customer-grid refresh stealing focus into Search while a name was entered, and one measured invoice-grid columns before search rows arrived. The product focus bug is fixed and has a deterministic delayed-refresh Jest/Playwright regression. Navigation and virtual-grid waits were updated without dropping assertions. All 30 focused browser regression checks then passed. The next complete run passed 123 and failed one: unrelated firm-wide numbering events filling a client's first Audit Record page; supporting company events are now included only for that client's atomic postings. The full account chain still verifies, and a 30-event regression proves the client page is unchanged. New H1 browser tests exercise admin settings, separate manual entries/finalizations, AR filtering, invalid selections, deactivation refusal, denied controls, one-time transfers, tracker resolution and opening allocation. Failure summaries are retained separately from accepted results. The first CI build also caught a React hook cleanup lint error in AR; a stable cancellation callback preserves the stale-response guard, and all frontend Jest tests were rerun after that fix.

## Acceptance

All **91 required commands exited 0**, with **zero failures, skipped or pending tests**; Playwright had zero flaky tests and no report errors. Integration files ran one at a time, and no test processes overlapped.

| Required check | Accepted result |
|---|---:|
| Backend unit | 1,158 passed |
| Integration, all 83 files | 2,797 passed |
| Dedicated scenarios, all 42 files | 1,640 passed |
| Clean-room | 18 passed |
| Lambda pytest | 17 passed |
| Frontend Jest | 277 tests / 52 suites passed |
| CI production build | Passed |
| Full Playwright, one worker, managed browser server | 124 passed |
| Three-view drift | 0 across 1,014 client/business comparisons; aggregate difference 0 |

Exact commands, environment overrides, times and per-file counts are retained in [validation-results.json](evidence/run-H1/acceptance/validation-results.json), with [Jest evidence](evidence/run-H1/acceptance/frontend-jest-result.json), [machine-readable totals](evidence/run-H1/acceptance/suite-counts.json), [browser summary](evidence/run-H1/acceptance/playwright-summary.json) and [drift detail](evidence/run-H1/acceptance/drift.json). Scenario and clean-room counts overlap integration; they are not additional unique tests. Browser retries are disabled.

After the last client-audit history fix, H1 and Audit Record integration files, the complete backend unit suite, all scenarios, read-only drift and full Playwright were rerun. Other accepted commands were retained because their source did not change. Earlier failed attempts remain separate evidence, not accepted passes. Final account 1 verification ran after Playwright.

## Runtime, documentation and handoff

The managed backend restart returned a newer `ok` at 04:01:03 Phoenix after the final audit-history fix. Local-file outbound/scheduler switches are false, matching the supplied managed-server configuration. The health endpoint verifies database connectivity; it does not expose runtime environment variables. No server was started, stopped or killed directly. Browser validation connects only to the externally managed 3334 server.

Updated the integrated design, endpoint README, all affected work/ledger/invoicing/platform feature docs, scenarios, migration guide, operations, assessment follow-up, FINAL_REPORT and workspace MEMORY. Code-only Graphify refreshed 504 files into 2,065 nodes, 2,771 edges, 328 communities and 2,393 Obsidian graph notes, using zero model tokens. The documentation/report/MEMORY mirror is synchronized with the repository source files. H2 begins at 037 and must preserve business context, noncash transfer lineage, opening projections and the append-only actor/reason rules. H2/H3/H4/H5/H6 features remain assigned to their later runs.


## H2 correction — legacy opening default

The original financial reconciliation above is retained as history and is **not the approved deployment default**. The owner rejected separating legacy U from offsetting P and holding roughly$1M for business review. H2 applied the supported superseding manifest with reasoned system audit events. It restored every pre-cutover open item to James F. Kimmel & Associates, retaining tracker business only as reporting attribution. No original source row was edited.

Default business now has B41,015.00,U1,513,217.50,P−1,493,344.00,N60,888.50 and held funds5,472.00. Every other business starts0. Every client's default B/U/P/N/funds equals its original single-scope values; held pre-cutover work0. The amendment adds67,307 immutable scopes (39,052 transactions and28,255 tracker rows), one superseding cutover and one amendment. Old manifests,51,084 attributions and20,146 historical review records remain immutable evidence, but no longer route or hold legacy money. Three unmatched trackers remain reporting-only.

GET `/billing-entities/cutover/candidates` reports likely genuinely unbilled newer tracker-different work without moving it. An admin may explicitly reassign selected unissued work with a reason. Post-cutover work still requires its business. See [H2 results](2026-09-26-run-H2-results.md), [correction evidence](evidence/run-H2/cutover/account1-cutover-report.json), and [H2 oracles](../scenarios/H2-receipts-and-aging.md). H2 derives original obligations only after this correction; its legacy billed total reconciles to41,015.00 with no unresolved/unknown-age residual.
