# H5 — honest analytics scenario oracles

The synthetic lifecycle runs in `ds2_scenarios` through real services/routes in `test/integration/scenario-H5-analytics.integration.spec.js`. No synthetic rows enter account 1 of `ds2_local`. All amounts below are USD. The service date, issue date and application date are deliberately distinct concepts; the scenario uses the same local business day unless it supplies a historical cutoff.

## 1. Work, issue, partial receipt and corrections

An employee records 120 actual tracker minutes. Standard billing rate is $100/hour; captured labor rate is $30/hour. Standard work value is $200 and labor cost is $60. A draft produces no bill: eligible WIP remains $200.

A $20 prebill concession gives a finalized statement of $180. Gross issued charges are $200, prebill concessions $20, net billed $180. Billing realization is $180 / $200 = 90%. Margin is $180 − $60 = $120, or 66.67%. The concession is not deducted again as bad debt.

The employee's rate changes to $50 and another hour/$100 is recorded. Work entered is now $300/3 hours; WIP is $100. Issued revenue remains $180 and the issued cohort's cost remains $60. Marking the employee inactive does not remove their work or cost. This API oracle supplies quantity only, so the new hour has a recorded cost rate but estimated duration. Forms that supply actual minutes retain those minutes.

A $120 receipt is applied to the statement, a $10 bad-debt write-off is posted, and a $20 credit memo reduces the price:

| Measure | Expected |
|---|---:|
| Work entered standard value / hours | $300 / 3 |
| Unbilled WIP | $100 |
| Gross issued charges | $200 |
| Prebill concessions | $20 |
| Credit memos | $20 |
| Net billed | $160 |
| Gross cash received / applied receipts | $120 / $120 |
| Bad-debt write-offs | $10 |
| Noncash obligation reductions | $30 |
| Cohort standard value / labor cost | $200 / $60 |
| Billing realization | $160 / $200 = 80% |
| Collection realization | $120 / ($160 − $10) = 80% |
| Margin / margin percent | $100 / 62.50% |
| Remaining issued balance B | $30 |
| Next statement N, before billing WIP | $130 |

The saved knowledge cutoff immediately after the first issue replays $180 billed, no collections/write-offs/memos and no later $100 work. CSV/PDF output matches the report; `oracle-report.*` in H5 evidence retains the executed oracle.

## 2. Cost provenance and user mistakes

- Manual entry: 68 actual minutes at $30 cost $34 while billing rounds to 1.2 hours/$120. A description-only edit preserves that evidence.
- Reviewer correction: change a 120-minute tracker from staff cost $30 to staff cost $40 and 90 actual minutes. Missing reason refuses without any committed changes. With a reason, labor is 90/60 × $40 = $60. Manual apply and AI rerun capture the same facts, and a repeated apply refuses. Injected transaction-insert failure rolls back the tracker claim, minute/staff correction and audit events together.
- Held tracker: 68 actual minutes captured at $30 remain $34 labor even if the employee's current rate becomes $70 before approval. Billing rounds up to 1.2 hours/$120. The source and posted copy contribute effort once.
- Manual duration edit: 1 to 2 hours retains the original captured $30 rate. Reassigning to an employee whose rate is $40 requires a reason; absent reason returns 400 and leaves every table unchanged. Successful reassignment records the session actor/reason and $40 rate.
- Unknown historical cost: later filling in a staff cost does not turn unknown into historical fact. `labor_cost`, margin and margin percent are null; count and affected standard value remain visible.
- Legacy estimate: migration captures the known $30 rate once in an immutable sidecar; a later $80 current rate cannot change the estimate. Source fields remain untouched.
- Tracker source: a second posting, different employee, foreign/missing source or wrong business is refused atomically. Exact aliases acquired after upload are accepted by the same unique-resolution rule used by ingestion. Ambiguous aliases are not guessed.
- Empty period/business returns zero activity and N/A realizations. Invalid/reversed dates return 400. An inactive business can be selected for historical reporting; inactive staff remain included.

## 3. Cash lineage and recurring effort

The model specs separately prove: a $100 held receipt contributes $100 cash but $0 collection until $60 is applied, leaving $40 held; application of a $20 memo credit is noncash. Receipt reversals are negative collections. A $100 cash retainer plus $50 noncash adjustment used for a $150 draw contributes $100 collections and $50 noncash. Reversing the draw restores that original mix. Transferring $50 of the restored mixed funds creates no cash receipt and a later draw reports its preserved $33.33 cash/$16.67 noncash mix. A $25 refund is cash returned, never negative billing revenue.

A recurring $300 fee supported by two covered hours at $100 standard value/hour and $30 cost/hour has standard cohort value $200, cost $60, margin $240 and 150% billing realization. The fee is allocated across covered work proportional to standard value; the fee line is not counted again in the denominator. A void of $200 and replacement bill of $240 reports $440 gross issues, $200 voided charges, $240 net billed, one two-hour/$60 cost cohort and one $100 receipt/application.

## 4. Historical business attribution

A legacy two-hour/$200 work row traced uniquely to Advisory can remain billed by Tax at $180. Total work is $200; Advisory has $200 worked-for value and Tax has $180 billed-by revenue. The allocation drilldown shows both businesses with `legacy attribution: tracker entity`. Missing or ambiguous provenance is `unattributed legacy work`. No ledger balance moves. Raw tracker categories and held work use this same reporting attribution, and service-date cutoffs exclude later tracker work. Capacity keeps inactive staff but excludes service after As of.

## 5. API and browser evidence

`path-matrix-H5-analytics.integration.spec.js` covers all ten new/changed read/export contracts: success, anonymous/employee/manager/admin refusals, tenant mismatch, foreign/missing business, invalid years/dates/export format, database failure and read-only fingerprints. Exports use memory, so no storage write exists to fail. Existing report path matrices retain ZIP failure-before/after-stream coverage. Locked, stale and double-submit money paths remain in transaction/correction matrices; H5 reports introduce no money mutation.

`analytics-H5.spec.js` exercises the actual Billing Performance screen and downloads, all six pages' empty/inactive business filters and return to totals, invalid/empty periods, failed report/export recovery, the year-end ZIP, and employee reassignment before issue. Jest covers each changed analytics screen, race-safe results, cost labels, cutoff arguments and account-scoped exclusions. The [H5 result](../decisions/2026-09-26-run-H5-results.md) records the final full-suite counts.

## H7 extension: released source funding and surviving fee cohort

The [combined two-business oracle](H7-combined-lifecycle.md) exposed40 of actual retainer cash being labeled noncash after void/rebill. The replacement must still report 290 total collections, including 40 retainer use. A focused mixed-funding oracle releases 150 (100 cash +50 noncash), reapplies 60, reverses that application and reapplies 60 through a second rebill: final collections 40, noncash 20, retainer use 60 and gross cash 100. A one-cent correction/reapplication preserves its rounded cash cent. A 300 recurring source fee voided and rebilled 320 retains 300 as the supporting source fee once, 320 net revenue and one two-hour/60-cost cohort. H7 records both failures before their fixes.
