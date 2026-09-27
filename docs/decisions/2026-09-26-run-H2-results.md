# H2 results — corrected legacy opening, true aging and Receive payment

2026-09-26. Local implementation and acceptance evidence for Jon's second-round item 2 and the prerequisite correction of H1. No production deployment, Git command, commit, AWS connection or real email. The reference database was not accessed. Final accepted counts and protected-data reconciliation are below.

## Delivered behavior

Receive payment records one check/cash receipt, displays original open invoices oldest first with remaining amounts, proposes FIFO, permits reasoned allocation changes, and holds any excess as credit for that client and business. Preview proposes credit use; finalization posts it once. Receipt history/detail and existing payment-tab links retain a correction path for an individual unissued application. Original receipt headers and issued records remain immutable.

Original-obligation dates drive AR aging across statement rollovers. Effective date and recorded-through UTC timestamp reproduce a historical report. Positive age buckets, issued statement credit and held receipt credit are separate. Create Invoice, Account Audit, customer summaries, statements and Audit Record distinguish raw next-statement balance from proposed credit use/payable amount. Balance-forward parents, latest children, absorption markers and original artifact paths remain intact. The printed interest line is unchanged.

Any admin or super admin alone can correct an unissued application, cancel a complete unissued entry mistake, transfer unused receipt credit, and flag/reverse/resolve a bounced check. Managers/employees cannot apply these corrections. The complete-receipt bounce follows transferred and subsequently used credit across businesses, restores all applications, and cancels the remaining funds. Partial reversal is refused. Storage failure during revision preserves the complete reversal and leaves resolution retryable. No period close or approval workflow was built.

Money is calculated in cents. Transactions use account/customer locks, current ledger fingerprints, UUID request keys, append-only events and a deferred receipt-conservation constraint. Cross-client/business/tenant applications, negative/zero lines, over-application, changed retries, stale screens and finalized edits refuse atomically. Receipt-level duplicate checks compare gross cash once; a reasoned acknowledgement retains the duplicate flag. Every new table is audited with the authenticated actor/reason or a system source/reason.

## H1 correction and protected account 1

The supported amendment planner/poster produced a superseding cutover manifest and immutable reasoned system events before billing resumed. It did not rewrite H1 evidence or original financial/tracker rows. Legacy tracker attribution is reporting-only. Only post-cutover work needs an entity assignment; unmatched new work is held. An admin may explicitly move identified unbilled legacy work with a source hash and reason. Nothing moves automatically.

| Opening scope | B | U | P | N | Held retainers/prepayments |
|---|---:|---:|---:|---:|---:|
| Original single scope | 41,015.00 | 1,513,217.50 | −1,493,344.00 | 60,888.50 | 5,472.00 |
| Corrected default, James F. Kimmel & Associates | 41,015.00 | 1,513,217.50 | −1,493,344.00 | 60,888.50 | 5,472.00 |
| Kimmel Financial Advisors | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Jim Kimmel Insurance Agency, Inc. | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

The [protected-data report](evidence/run-H2/cutover/account1-cutover-report.json) has **zero per-client differences** and zero held legacy work. Original values are recomputed from hash-verified unchanged physical rows, rather than represented as a captured pre-migration engine run. Both the total and every client's default B/U/P/N/held funds agree to the cent. Other businesses are zero.

The [read-only candidate report](evidence/run-H2/cutover/candidate-report.json) contains **1,302 items, $23,274.75**, whose tracker business differs and whose work date follows the client's last issued statement. It reports three unmatched legacy tracker rows. These are candidates for human review, not evidence that money should automatically move. No candidate was moved in account 1.

| Protected source table | Retained reference / before / after |
|---|---:|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

Additional unchanged tables: retainers 3, recurring plans 8, quotes 0, jobs 49,555. Per-row SHA-256 comparisons across all 11 source tables find **zero changes, insertions or deletions**. Counts match the retained reference census in FINAL_REPORT; `ds2_ref_20260922` was never connected. No original amount/date/identity/contact/number/physical business column/artifact path was changed by H2. Remote original PDF bytes were not fetched; this is verification of original rows/paths, not a claim to have rechecked AWS object bytes.

Exact intended account-1 H2 effects:

| Append-only evidence | Rows added |
|---|---:|
| Superseding `billing_cutovers` manifest | 1 |
| `billing_cutover_amendments` | 1 |
| `legacy_billing_scopes`: 39,052 transactions + 28,255 trackers | 67,307 |
| Amendment `financial_requests` retry record | 1 |
| `ar_derivations` | 307 |
| `ar_obligations` | 53 |
| Derived `payment_receipts`: 1,004 standalone payments + 2 original retainer deposits | 1,006 |
| H2 audit events: amendment 67,310 + derivation 1,366 | 68,676 |

The account audit chain verifies **139,949 events**, including the preserved 71,273 H1 events. H2 creates zero account-1 applications, credit lots/events, receipt correction events, carrier links, issued invoices or transfers. Existing 20,146 review rows remain immutable historical evidence; corrected scopes release their legacy billing hold.

## Legacy obligation derivation

The reviewed [derivation manifest](evidence/run-H2/legacy-aging/account1-manifest.json) has SHA-256 `dca503adceb7f74e24955d7963ea8f0528b677ecbbfc988eb825a4fc20392a28`. All **307 source scopes** use default business 2. **53 original obligations total $41,015.00**; unresolved/unknown-age residual and opening issued credit are zero. Derivation considers 2,253 invoice snapshots, 1,005 payments and two original retainer roots. Exact independently linked reductions are $318,032.54; remaining estimated historical reductions are $459,924.54. These are reconstruction evidence, not newly received cash.

Standalone historical payments become separately labeled derived headers; check-reference equality does not prove one check. Existing retainer funds are not minted again as credit. A destination root created by a business transfer is explicitly excluded from cash reconstruction. The [same-manifest rerun](evidence/run-H2/legacy-aging/account1-idempotence.json.applied.json) inserts **zero rows** and reconciles the same B. The CLI is guarded to the three authorized local databases; production rollout uses the reviewed operator process, not an unreviewed private repair script.

## Migrations, routes and screens

**037–041** were manually applied with `psql -X -1 -v ON_ERROR_STOP=1 -f` to **ds2_local, ds2_clean and ds2_scenarios**. File hashes and all 15 successful application logs are in [cutover evidence](evidence/run-H2/cutover). Applied migrations were not edited. There are **40 runnable migrations, 002–041; 042 is next free**. Scenario reset discovers the complete chain; migration-count/idempotence/guard specs cover it.

| Migration | Purpose |
|---|---|
| 037 | Superseding cutover manifests, legacy opening scope and reporting attribution |
| 038 | Obligations, receipts, applications, credits, carriers, derivations and immutable audited guards |
| 039 | Statement membership for the subledger; retained legacy source IDs survive permitted source deletion |
| 040 | Reviewed opening-allocation obligation roots and deferred receipt conservation |
| 041 | Same-client origin lineage and exact credit/application reversal relationships |

There are **15 new contracts**, bringing the implemented endpoint index to **192**: amendment GET/POST and candidate GET; nine receipt routes; credit read and transfer GET/POST. [Receipt API contract](../ledger/receipts-and-obligations.md#api-contracts-all-scoped-to-the-authenticated-account) and [README index](../README.md) give every path/input/permission. Existing application edit/delete/reverse routes protect receipt-backed rows with HTTP409. Existing bounced-check routes are admin-only; the remaining owner-addendum retrofit for write-offs/retainer events/duplicate removal belongs to H3.

New screens: `/payments/receive`, `/payments/receipts`, `/payments/receipts/:receiptId`; `/receivables/aging` aliases the updated AR view. Changed screens include payment forms/tabs, receipt-credit transfer controls/history, receipt duplicate detail/link controls, cutover candidates, AR date/knowledge filters and credit columns, customer balances, Account Audit print view, Audit Record closing position, and admin-only invoice exception controls. Jest and real-server Playwright cover these changes. The legacy payment form remains accessible for compatibility records.

## Oracles, regressions and validation

[Hand-computed H2 scenarios](../scenarios/H2-receipts-and-aging.md) prove $1,000 allocated 300/450/250 leaves 150; $1,500 pays 1,150 and holds 350; the next 500 statement uses 350 and bills 150; original debt ages through two rollovers; full bounce restores direct and used/transferred credit applications. Cutover oracles prove legacy U/P cancellation, explicit movement of a genuinely unbilled recent 200 item, and mandatory post-cutover business selection.

No existing coverage was silently removed. Old assertions that rollovers reset debt age now assert original-obligation buckets; Audit Record membership/coverage includes the new archived subledger rows. Fixture-only time travel and cleanup include the append-only sidecars in disposable databases, without weakening live immutability. Refusal matrices compare digests of every committed table, including the audit ledger, before and after attempted writes.

Regression found and fixed: scope-clock precision that could omit a just-created application; full-receipt exception lookup across a destination business; already-paid obligations losing their carrier on rollover; same-business reselection leaving Receive payment in a loading state; new subledger tables omitted from locked statement membership; partial-patch write-off dates; transferred retainer roots being counted as cash; original-date formatting in combined statements; Audit Record summaries treating subledger archives as unnamed items; explicit zero/null partial-reversal selectors; cutover resumption guards covering receipt-only credit activity; and review queues counting retained evidence whose source was deleted. Active review counts and pagination now exclude missing sources while retaining their audit evidence.

The [source comparison inventory](evidence/run-H2/source-change-manifest.json) records SHA-256 changes against the retained H1 inventory without Git; previously uninventoried files are labeled explicitly.

Acceptance commands and exact final counts are recorded in `evidence/run-H2/acceptance/suite-counts.json`. Historical failed/interrupted diagnostic logs remain separately named and do not count as accepted runs. One prematurely launched Playwright diagnostic was interrupted while the unit process was exiting; the accepted browser run was then executed serially. Every integration file is executed independently; disposable scenario and path-matrix files use `.env.scenarios`, clean-room uses `.env.clean`, and other integration files use `.env.local`.

All **95 required command invocations** have accepted exit-0 results, with **zero failed, skipped or pending tests**. Scenario and clean-room counts overlap integration and are not additional unique tests. The accepted full browser suite uses one worker and no retries.

| Check | Final accepted result |
|---|---|
| Backend unit | 1,184 passing |
| Integration, all files separately | 2,894 passing / 87 files |
| Dedicated scenarios | 1,737 passing / 46 files |
| Clean-room | 18 passing |
| Lambda pytest | 17 passing |
| Frontend Jest | 301 passing / 54 suites |
| CI production build | Passed, exit 0 |
| Full Playwright through browser port 3334 | 143 passing; 0 flaky; no report errors |
| Read-only three-view drift | 0 across 1,014 client/business comparisons; aggregate difference 0 |

PDF amounts are text-asserted and rendered for visual inspection. Retained examples include the one-page receipt/credit statement, two-page separate-business statement, two-page client record, four-page browser full-evidence record, five-page held-credit Audit Record, and 15-page financial-lifecycle full-evidence record; browser evidence shows Receive payment and original aging. Graphify is refreshed from 522 code files: 2,148 nodes, 2,918 edges, 336 communities and 2,484 Obsidian graph notes, with zero model tokens, and documentation/MEMORY are mirrored to `DS2_Notes` by the existing script.

## Deliberate compatibility boundary and later runs

The existing single-payment, explicit-retainer and payment-image approval interfaces retain their old entry contracts and retainer excess handling. Once derived, their debt changes synchronize with obligations. They were not rewritten to create the new multi-invoice cash request. H2's new Receive payment workflow owns its immutable cash headers and held-credit lots; derived headers remain source-labeled and direct corrections back to the source. This is an explicit amendment to H0's initial “new cash only here” aspiration, documented in the integrated design. H5 must combine source kinds deliberately and must not count allocations/transfers as additional cash.

H3 retains credit memos, void-and-rebill, client-credit refunds and its remaining existing-action permission retrofit. H4/H5 retain recurring automation and analytics/cost-rate corrections. No accounting period close, second-person approval, collections, online payments, bank/QuickBooks integration or interest change was introduced. Production rollout remains a separately reviewed operator action: pause writers, apply the full migration chain, review/amend the legacy default before billing resumes, derive/reconcile obligations, then deploy matching readers/writers and verify drift before resuming. See [operations](../platform/operations.md) and [FINAL_REPORT](../../scripts/review-2026-09/FINAL_REPORT.md).
