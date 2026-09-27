# Analytics

**H6 navigation:** Reports groups billing performance, client rates, time allocation, WIP/unbilled, job budgets, tax capacity and Account audit; all retain Super Admin access. [Route/permission and bookmark rules](../platform/workspace-navigation.md).

H5 implements definition version **2**. “Billed” now means newly issued statement charges, with corrections; work entered is its own measure. Margins use preserved labor-cost evidence. This supersedes the transaction-sum/current-rate definitions retained in earlier assessment and run reports. [Integrated design](../decisions/2026-09-26-owner-requests-2.md#6-h5--reporting-and-historical-labor-cost), [hand oracles](../scenarios/H5-honest-analytics.md), [H5 results](../decisions/2026-09-26-run-H5-results.md).

## 1. Purpose and UI

| Screen | Route | Measures |
|---|---|---|
| Billing Performance | `/reports/billing-performance`; compatibility `/reports/billing-performance` | Work, WIP, billed, applied receipts, cash, corrections, realizations, cohort margin, business totals and provenance |
| Client Rates | `/reports/client-rates` | Issued cohort hours/rates, work entered, realization, estimated/unknown cost and margins |
| Time Allocation | `/reports/time-allocation` | Actual service hours and standard work value, separately labeled net issued amounts, raw tracker categories |
| WIP / Unbilled | `/reports/wip-aging` | Eligible unissued work at cutoff, held/unresolved work and future work separately |
| Job Budgets | `/reports/job-budgets` | Budget consumption by billable work entered through cutoff, including WIP |
| Tax Season Capacity | `/reports/tax-capacity` | January 1–April 15 hours, current/prior year, including inactive staff |

All six screens support all businesses or one business, including inactive businesses. Work filters mean **worked for**; revenue/cash filters mean **billed by**. Billing Performance displays both in its attribution grid. The other five pages explain their basis and link to that detail. H6 retains the wider navigation/legacy redirects.

The shared customer exclusion picker is keyed by account (`ds2_analytics_exclude_ACCOUNT`). It never imports the old global key or another account's choice. Stored choices, including an explicit empty array, win over the server defaults. Defaults identify the firm's internal customers; server reporting applies only requested exclusions. Failed option loading uses that account's stored selection or none. Account changes block reporting until that account's options resolve. Screens suppress obsolete request results and retain controls after recoverable errors.

## 2. Access and writes

Every analytics route, export and rate-agreement write requires authenticated **super admin**, matched case-insensitively against the current database role. The URL account must match the session account, including for super admins. `userID` is a compatibility path parameter, not a grant of authority. Ordinary admin/manager/employee roles receive 403. No analytics permission expansion or approval workflow was introduced.

The only analytics mutation remains the customer/year rate agreement. It verifies and locks the owned customer and records the authenticated actor. Reports and CSV/PDF/ZIP downloads are read-only; they neither save financial records nor contact object storage or email. Transaction employee changes elsewhere require a reason and are audited; already-issued work remains locked. Admin-only financial corrections are governed by [H3](../ledger/invoice-corrections.md).

## 3. API reference

All paths begin `/analytics`; `A=:accountID`, `U=:userID`.

| Method | Path | Response / behavior |
|---|---|---|
| GET | `/billingPerformance/A/U` | `{status:200,billingPerformance:{version:2,period,definitions,totals,byEntity,unattributed_legacy_work,cohorts,attribution,work,events}}` |
| GET | `/billingPerformance/A/U/export` | CSV by default; `format=pdf` for PDF. Other formats 400. |
| GET | `/clientRates/A/U` | `{clientRates:{version:2,definitions,clients,years,firm},status:200}`; `yearsBack=1..15`, default 6 |
| GET | `/clientRates/A/U/export` | Customer/year CSV, including net issued, cohort hours, work entered, margin, cost basis and unknown-cost count |
| GET | `/timeAllocation/A/U` | `{timeAllocation:{version:2,definitions,year,availableYears,summary,byWorkDescription,byCustomer,monthly,trackerByCategory},status:200}` |
| GET | `/timeAllocation/A/U/export` | Matching sections; top 20 customers by actual hours |
| GET | `/wipAging/A/U` | `{wipAging:[customer due/future/held amounts, hours, aging buckets],status:200}` |
| GET | `/jobBudgets/A/U` | `{jobBudgets:[root job budget,actual,work_entered_value,wip,remaining,consumed_pct,is_complete],status:200}` |
| GET | `/taxSeasonCapacity/A/U` | `{taxSeasonCapacity:{version:2,year,current,prior,basis},status:200}`; stable user IDs and activity labels |
| GET | `/yearEndPacket/A/U` | ZIP described below; default previous year |
| GET | `/exclusions/A/U` | Active customers plus inactive default-exclusion matches, and default IDs |
| POST | `/rateAgreement/A/U` | `{customerId,year,agreedRate,notes}`; returns saved agreement; no invoice repricing |

Report query inputs: `entityId` positive ID or `all`/omitted for aggregate; `exclude` comma-separated customer IDs; `year` integer 1900–2100; optional ISO `start`, `end`, `asOf` date and `recordedThrough` UTC timestamp. `start>end`, invalid calendar dates/cutoffs, malformed entity/year or invalid yearsBack fail 400. Missing/foreign business is 404, wrong session account 403, no login 401, unexpected database/export failure 500. Empty periods/businesses are successful zero reports with null denominator-based rates. No locked/stale/double-submit states exist for these reads.

Billing Performance defaults to the requested/current calendar year, with As of the earlier of its end or today. Time Allocation and Capacity default to selected year-end; Time Allocation opens the prior year and Capacity opens the current year. WIP defaults to the billing calendar's today; job budgets are cumulative through As of. Client Rates uses a multi-year window ending in `year`; standalone UI defaults to the current year. WIP/budgets expose As of and Recorded through in their screens. Billing Performance exposes all dates. Historical service/issue/application distinctions remain in report definitions and exports.

The existing rate-agreement POST retains its legacy JSON status envelope. It validates positive integer customer, year 2000–2100, positive finite two-decimal rate at most 99,999,999.99 and same-account customer ownership. Upsert preserves original creator/time; omission of notes clears them. It has no delete/history endpoint and makes no billing or cash change.

The customer-exclusion help tooltip is informational and does not capture pointer events, so an open hint cannot block customer options. The selection stays scoped to the current account across all analytics pages.

## 4. Definitions and reconciliation

Amounts allocate in integer cents. `total_billed` is a compatibility alias for **net_billed**, a deliberate response change in v2. Use `work_entered_value` for the old work-value concept; it includes separately identified billable and nonbillable work.

| Measure | Definition |
|---|---|
| Work entered | Posted work's standard value and actual hours by service date. Charges never invent hours. Unprocessed held tracker work is separate; source and posted copy count once. |
| WIP | Eligible billable work not represented by an issued document at As of. Future, incomplete/jobless and unresolved work are separate. Invoice links alone do not prove issuance. |
| Gross billed | Billable new charge components on unique issued parent documents by statement issue date. Drafts, balance forward and child copies contribute zero new revenue. |
| Net billed | Gross less prebill concessions, less effective credit memos/voided new charge components, plus memo reversals/replacement issues once. Bad debt is a separate measure. |
| Collected | Net receipt-backed applications by effective date, including later use of held cash and receipt-backed retainer draws. Reversals are negative. Noncash memo/retainer adjustments are separate. |
| Cash | Manual receipt headers, original standalone payment sources and original retainer deposits count once. Derived headers, allocations and transfers are not extra cash. Reversals and cash returned are separate. |
| Credits/corrections | Bad-debt write-offs, prebill concessions, memos, voids, noncash applications, held receipt and statement credit, retainer use and refunds retain explicit source kinds. |
| Billing realization | Issued cohort net charges through cutoff / standard value of that same supporting work. No positive standard denominator → null/N/A. |
| Collection realization | Net receipt-backed applications to the selected issue cohort / cohort net billed after bad-debt write-offs. No positive collectible denominator → null/N/A. Period cash divided by period bills is not used. |
| Margin | Cohort net billed less supporting actual-hours labor at stored cost rates. Unknown supporting cost makes labor total/margin null; known labor, estimated counts/amounts and unknown affected value remain visible. |

A cohort is statements issued in the selected period, with corrections and applications through As of. Period net billed can therefore differ from cohort net billed when this period corrects an earlier bill. Billing Performance labels both. Void/rebill reuses original work identity; labor and hours belong once to the surviving replacement cohort. Recurring covered effort is matched to its client/business service period. Fee allocation uses proportional standard value and does not count both the fee and covered standard value as denominators.

Legacy compatibility payments count as collections only with an exact issued-invoice link or a documented new-subledger application. Unlinked cash remains cash, not fabricated collection. Retainer funding is consumed oldest funding event first; restored draws preserve their original cash/noncash mix; transfers preserve that mix and create no cash. These are source-derived reporting rules, not ledger rewrites.

## 5. Cost and business provenance

Migration `045.work_cost_snapshots.sql` adds rate, source (`recorded|estimated|unknown`), capture timestamp, actual minutes/duration source, billing-rate and standard-value snapshots to transactions and tracker rows, and a unique source tracker link. New tracker capture resolves the named/matched employee; the uploader does not determine labor cost. Manual work uses logged-for staff. Migration046 completes review corrections: actual manual minutes are captured when provided; held-review, manual-move and AI-rerun corrections update audited source minutes before posting, and a known-employee change requires a reason and captures that selected staff rate. Ordinary approval copies source cost/minutes; changing staff rates cannot rewrite prior work. Quantity-only hours are explicitly estimated even when the cost rate was recorded.

A duration edit retains the captured rate. Changing a transaction's employee before issue requires `costChangeReason` (1–2000 characters), captures the chosen employee's rate, and records the actor/reason. Issued rows and original payloads remain immutable. Missing cost is never silently represented as reliable zero. Charge-only rows have no labor cost requirement.

Historical source rows are untouched. `legacy_work_cost_estimates` captures the migration-time known rate once, explicitly estimated; unavailable rate is unknown. The sidecar has insert audit capture and update/delete/truncate guards, and appears in Audit Record. Original tracker links are accepted only when existing training provenance resolves uniquely; no matching by coincident names/dates/amounts is invented.

H2's immutable `legacy_billing_scopes.reporting_entity_id/reporting_basis` supplies historical worked-for attribution. Unique tracker entity gets `legacy attribution: tracker entity`; absent/ambiguous source gets `unattributed legacy work`. Revenue remains with the issued document's billed-by business; the allocation detail shows both. Original default-business B/U/P, held credit, statements and AR are unchanged. Aggregate work equals attributed business work plus the explicit unattributed remainder.

## 6. Historical cutoff and exports

`recordedThrough` is an explicit knowledge boundary. Mutable audited source tables rewind from their first change after that boundary; later insertions disappear and deleted/edited records use prior audited values. Immutable effective events and issuance evidence obey the same knowledge cutoff. Work uses service date; bills use statement issue date; corrections/applications use effective date. Pre-audit changes cannot be reconstructed and legacy cost/attribution remains labeled; no report claims otherwise. WIP includes then-unissued work even if it was invoiced later.

Standalone Billing Performance CSV includes totals, all business totals, unattributed work, issued cohorts, worked-for/billed-by allocations, work cost provenance and effective events. PDF contains matching headline/business totals, dates, definitions and estimate/unknown labels; detailed rows are in the companion CSV. Exports use the displayed knowledge cutoff. CSV formula-leading text is escaped while signed numeric values remain numeric.

The year-end ZIP contains:

- `client_rates_YEAR.csv`, six-year window ending in the requested year;
- `time_allocation_YEAR.csv`;
- `wip_unbilled_aging.csv` and `accounts_receivable_aging.csv` at the requested As of;
- `billing_performance_YEAR.csv` and `.pdf`;
- `reporting_basis.json` with v2 definitions, business and both cutoffs.

Reporting components use one repeatable-read snapshot. AR deliberately uses its independent reconciliation service with the same effective/knowledge cutoffs; it does not call the analytics total function. AR export is capped at 10,000 rows. ZIP failures before streaming return an error with attachment headers removed; errors after streaming terminate the response rather than presenting a complete download. No export writes ledger or storage records.

## 7. Tests and operational boundary

[H5 hand oracles](../scenarios/H5-honest-analytics.md) and `scenario-H5-analytics`, `path-matrix-H5-analytics`, `migration-H5`, reporting-model and existing analytics/identity/path-matrix specs establish definitions, refusal atomicity, cost capture, attribution and export parity. Every changed analytics screen has Jest and real-server Playwright coverage, including empty/inactive business filters and invalid/failed requests. Existing coverage is updated to assert unissued work is not billed, rather than removed. See [H5 results](../decisions/2026-09-26-run-H5-results.md) for exact acceptance counts and limitations.

Source owners: `src/endpoints/analytics/{analytics-router,analytics-service,reporting-model,reporting-export}.js`; `src/endpoints/transactions/sharedTransactionFunctions.js`; migrations045/046; the six frontend analytics pages. **12 owned endpoint contracts**. No interest, banking, online-payment, collections, period-close or approval feature is added.

The final browser pass exposed and repaired transaction-editor initialization before shared reference lists arrived. The form waits for those lists, retains in-progress edits on later list refreshes, validates required selections and permits only one in-flight save. Jest covers delayed loading and repeat submit; Playwright covers actual employee reassignment and saved cost.

## H7 lineage and cohort corrections

A void/rebill can release a legacy pending payment or retainer draw into a statement-credit lot. Reporting follows its immutable `rebill/<void>/application/<id>` source through later applications/reversals and repeated replacements. It preserves the original cash/noncash ratio; retainer use also follows this lineage. Cumulative cent allocation and compensating reversals preserve fractional-cent conservation. Pure memo credit remains noncash, and release/reapplication creates no new cash receipt.

Fixed/recurring fee measures describe source fees supporting the surviving issue cohort. They use the same single ownership as effort/cost; a voided source and its replacement cannot each add the source fee. Actual replacement revenue still comes from the issued replacement charges. The combined oracle has 585 gross issues, 380 net billed, 290 collected, 350 gross cash, 30 returned, 40 retainer use, 125 recurring source fee, 52 labor and 328 margin. Impossible UTC clock/calendar components and unsupported year zero now return 400 across reports, credits and AR; valid year-one/leap-day timestamps and microseconds remain unchanged. [H7 oracle](../scenarios/H7-combined-lifecycle.md), [PASS5](../scenarios/RESULTS-PASS5.md).

## H9 evening deposit date correction

Explicit payment, receipt and correction dates retain their existing meaning. Retainer roots have a recorded timestamp instead of a separate deposit date; analytics converts that UTC instant to the configured billing calendar (Phoenix by default). For example, a deposit at January1 02:00 UTC belongs to December31 in Phoenix, while 07:00 UTC belongs to January1. Date-only legacy evidence is preserved as a date. UTC recorded-through boundaries remain unchanged. This fixes missing same-day gross cash after 17:00 Phoenix without changing balances, source rows or issued documents. The H7 combined lifecycle still expects $350 gross cash; H9 adds year-end boundary tests.

## H10 reporting performance

The model encodes selected evidence-sidecar/job columns with `row_to_json`, retaining the original JSON numeric/date types and every input used by reporting. Mutable financial sources and their historical audit rewind remain complete. Work is grouped by document once; Client Rates indexes the already-read rows by customer for its year comparisons. These indexes live only inside that request's prepared snapshot; there is no application or cross-request cache.

The year-end packet loads one reporting snapshot, then applies each worksheet's original period options to that prepared data. It retains the independent AR reconciliation and the same cutoffs. Definitions, CSV/PDF content, cost provenance, financial events and all six public response shapes remain identical. Ordered reports are compared byte-for-byte against frozen pre-H10 readers for each account-1 business, all businesses and synthetic corrections/receipts/recurring activity. [H10 budgets and results](../decisions/2026-09-26-run-H10-results.md).

## H8 report controls

Billing performance, WIP and Job budgets keep historical saved-through filtering under **Advanced: reproduce an earlier report**. The field is labeled **Include records saved through** and still sends the exact optional `recordedThrough` timestamp. The billing report uses **Work and cost details** for its provenance table. Definitions, calculations, date bases and export behavior are unchanged. Each report's shared help explains the distinction between work, issued revenue, applied receipts and cash.
