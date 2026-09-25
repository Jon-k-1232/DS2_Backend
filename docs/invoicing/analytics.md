# Analytics

## 1. Purpose and UI

Analytics compares client rates, staff time allocation, unbilled work, job budgets and tax-season hours. UI routes/pages:

| Route | Page |
|---|---|
| /analytics/clientRates | ../DS2_Frontend/src/Pages/Analytics/ClientRatesPage.js |
| /analytics/timeAllocation | ../DS2_Frontend/src/Pages/Analytics/TimeAllocationPage.js |
| /analytics/wipAging | ../DS2_Frontend/src/Pages/Analytics/WipAgingPage.js |
| /analytics/jobBudgets | ../DS2_Frontend/src/Pages/Analytics/JobBudgetsPage.js |
| /analytics/taxSeasonCapacity | ../DS2_Frontend/src/Pages/Analytics/TaxSeasonCapacityPage.js |

Source: `../DS2_Frontend/src/Routes/GroupedRoutes/AnalyticsRoutes/AnalyticsRoutes.js:21`. API calls: `../DS2_Frontend/src/Services/ApiCalls/AnalyticsCalls.js:31`.

The shared exclusion picker uses sessionStorage key ds2_analytics_exclude, stored selection first and server-recommended defaults on first load. It is not account-keyed. Failed option loading leaves stored selection or no exclusions. Server queries do not automatically apply those defaults; the UI sends exclude IDs. Source: `../DS2_Frontend/src/Pages/Analytics/useExcludedCustomers.js:6`, `../DS2_Frontend/src/Pages/Analytics/useExcludedCustomers.js:39`.

## 2. Access rules

All /analytics endpoints require authenticated **super admin**, including CSV/ZIP exports and rate-agreement writes. The current database role is used. enforceAccountId requires the URL account to match session account_id even for super admin. No self-or-privileged userID check is installed. Sources: `src/app.js:170`, `src/endpoints/analytics/analytics-router.js:1`, `src/endpoints/auth/jwt-auth.js:91`, `src/endpoints/auth/account-scope.js:7`.

rateAgreement incorrectly takes created_by_user_id from URL userID and does not validate customer ownership; see [F32](../_review/findings.md#f32). This exception must not be described as authenticated attribution. Source: `src/endpoints/analytics/analytics-router.js:214`.

## 3. API reference

Unexpected database failure in the role middleware can return HTTP 500 through the global handler. Source: `src/endpoints/auth/jwt-auth.js:77`, `src/app.js:178`.

Shared middleware failures: HTTP 401 missing/invalid/expired/unresolvable login; 403 wrong role/account; 429 general 300/minute limiter; malformed JSON 400 and JSON >1 MB 413. Sources: `src/app.js:70`, `src/app.js:100`, `src/app.js:170`.

Except for exports, route-caught validation/query errors use **HTTP 200 with body status:500**, not HTTP 500. CSV/ZIP failures use HTTP 500 when headers have not already been sent. Sources: `src/endpoints/analytics/analytics-router.js:146`, `src/endpoints/analytics/analytics-router.js:251`.

Common exclude query is optional comma-separated positive integer IDs. Invalid elements are discarded; service also discards IDs >=2147483647. There is no paging or user-configurable sorting on these endpoints. year is Number(value) or server current year, except the packet defaults to the prior year; no strict integer/range validator is provided. yearsBack is Number(value) or 6, clamped to 1..15 without rounding to an integer. Sources: `src/endpoints/analytics/analytics-router.js:14`, `src/endpoints/analytics/analytics-service.js:26`, `src/endpoints/analytics/analytics-service.js:51`, `src/endpoints/analytics/analytics-service.js:220`.

### GET /analytics/clientRates/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/clientRates/:accountID/:userID` |
| Inputs | Required scoped accountID, userID placeholder; optional yearsBack and exclude. |
| Success | HTTP 200 {clientRates:{clients,years,firm},message,status:200}; full shapes below. |
| Errors | Shared middleware errors; query/invalid date-window failures HTTP 200/body status:500. |
| Evidence | `src/endpoints/analytics/analytics-router.js:146`. |

### GET /analytics/clientRates/:accountID/:userID/export

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/clientRates/:accountID/:userID/export` |
| Inputs | Same yearsBack/exclude; no paging. |
| Success | HTTP 200 text/csv, attachment client_rates_YYYYMMDD_HHmmss.csv. |
| Errors | Shared middleware errors; HTTP 500 query/CSV failure. |
| Evidence | `src/endpoints/analytics/analytics-router.js:159`. |

### GET /analytics/timeAllocation/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/timeAllocation/:accountID/:userID` |
| Inputs | Optional year, exclude. |
| Success | HTTP 200 {timeAllocation:{year,availableYears,summary,byWorkDescription,byCustomer,monthly,trackerByCategory},message,status:200}. |
| Errors | Shared middleware errors; invalid year/query failure HTTP 200/body status:500. |
| Evidence | `src/endpoints/analytics/analytics-router.js:174`. |

### GET /analytics/timeAllocation/:accountID/:userID/export

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/timeAllocation/:accountID/:userID/export` |
| Inputs | Optional year, exclude. |
| Success | HTTP 200 text/csv, attachment time_allocation_YEAR_YYYYMMDD_HHmmss.csv. |
| Errors | Shared middleware errors; HTTP 500 query/CSV failure. |
| Evidence | `src/endpoints/analytics/analytics-router.js:186`. |

### POST /analytics/rateAgreement/:accountID/:userID

| Item | Contract |
|---|---|
| Method | POST |
| Path | `/analytics/rateAgreement/:accountID/:userID` |
| Body | Required customerId, year, agreedRate; optional notes. Number(customerId) must be truthy; Number(year) must be truthy and 2000..2100; Number(agreedRate)>0. No positive/integer customer check, integer year check, finite/range/decimal-place rate check or note length/type validation. |
| Success | HTTP 200 {agreement:<stored row>,message,status:200}. Upserts account/customer/year key. |
| Errors | Shared middleware errors; failed validation, invalid foreign key, SQL conversion/overflow/other write errors return HTTP 200/body status:500. |
| Evidence | `src/endpoints/analytics/analytics-router.js:199`, `src/endpoints/analytics/analytics-service.js:351`. |

### GET /analytics/wipAging/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/wipAging/:accountID/:userID` |
| Inputs | Optional exclude; year not consumed. Current snapshot only. |
| Success | HTTP 200 {wipAging:[customer rows],message,status:200}; row fields below. |
| Errors | Shared middleware errors; query failure HTTP 200/body status:500. |
| Evidence | `src/endpoints/analytics/analytics-router.js:224`. |

### GET /analytics/jobBudgets/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/jobBudgets/:accountID/:userID` |
| Inputs | Optional exclude; no year/status/page filter. |
| Success | HTTP 200 {jobBudgets:[{customer_job_id,customer_id,customer_name,job_description,budget,actual,consumed_pct,remaining,is_complete}],message,status:200}. |
| Errors | Shared middleware errors; query failure HTTP 200/body status:500. |
| Evidence | `src/endpoints/analytics/analytics-router.js:237`, `src/endpoints/analytics/analytics-service.js:460`. |

### GET /analytics/yearEndPacket/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/yearEndPacket/:accountID/:userID` |
| Inputs | Optional year defaults previous server year; optional exclude. |
| Success | HTTP 200 application/zip attachment year_end_packet_YEAR.zip; four CSV members listed below. |
| Errors | Shared middleware errors; HTTP 500 on query/archive errors before headers. After streaming starts, an archive failure cannot become a clean JSON response. |
| Evidence | `src/endpoints/analytics/analytics-router.js:251`. |

### GET /analytics/taxSeasonCapacity/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/taxSeasonCapacity/:accountID/:userID` |
| Inputs | Optional year defaults current server year; exclude. |
| Success | HTTP 200 {taxSeasonCapacity:{year,current:[{employee,week,hours}],prior:[...]},message,status:200}. |
| Errors | Shared middleware errors; invalid year/query failure HTTP 200/body status:500. |
| Evidence | `src/endpoints/analytics/analytics-router.js:290`, `src/endpoints/analytics/analytics-service.js:481`. |

### GET /analytics/exclusions/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/analytics/exclusions/:accountID/:userID` |
| Inputs | No query/body consumed. |
| Success | HTTP 200 {exclusions:{customers:[{customer_id,display_name}],defaultExcludedIds},message,status:200}. |
| Errors | Shared middleware errors; query failure HTTP 200/body status:500. |
| Evidence | `src/endpoints/analytics/analytics-router.js:303`. |

## 4. Data model

| Table | Fields/use |
|---|---|
| customer_transactions | Account/customer/employee/job/work-description/invoice IDs, transaction_date/type, quantity, total_transaction, billable flag. 'Time' comparison is case-insensitive; null/other types are non-time charges. |
| users | Current cost_rate for labor estimates; display_name for capacity. Historical cost rates are not stored/reconstructed by these queries. |
| customers | IDs, display_name, commercial/active flags. Most reports include inactive customers with qualifying activity. |
| customer_writeoffs | ABS(writeoff_amount), writeoff_date/customer/account for rate-report adjustments. Negative credit storage becomes a positive deduction. |
| customer_rate_agreements | Account/customer/year unique key; NUMERIC(10,2) agreed_rate, notes, created_at, created_by_user_id. Only analytics write. |
| customer_general_work_descriptions | Labels for time allocation. |
| timesheet_entries | date, duration in minutes, category and deleted flag for raw tracker comparison. |
| customer_jobs/customer_job_types | Root job budget, complete flag, parent relationship and description; stored current_job_total is not used for analytics actuals. |
| customer_invoices/customer_payments | AR service reads for the packet, described in [accounts-receivable.md](accounts-receivable.md). |
| Evidence | `src/endpoints/analytics/analytics-service.js:17`, `src/endpoints/analytics/analytics-service.js:55`, `src/endpoints/analytics/analytics-service.js:220`, `src/endpoints/analytics/analytics-service.js:429`, `migrations/schema-snapshot-2026-09-22.sql:692`. |

No analytics marker is stored in notes. A rate agreement is an analytic comparison value; it does not set an employee billing rate or re-price customer work. Source: `src/endpoints/analytics/analytics-service.js:351`.

## 5. Read logic

### Client rates

startYear=currentYear-clamp(yearsBack,1,15)+1. Read account billable transactions dated >= January 1 startYear, excluding requested customers; **no invoice-link requirement and no upper date bound**. Group customer and transaction calendar year. Left join logged-for employee for current cost_rate. Aggregate write-offs separately by their own calendar year, then left join to transaction-bearing customer/year rows; a write-off-only year does not produce a row. Join customer labels and order display_name then year. Fetch account agreements year>=startYear concurrently. Source: `src/endpoints/analytics/analytics-service.js:51`.

Thus fields named time_billed, charges_billed, total_billed and realization describe **billable recorded work**, including unbilled work. They are not receipt-based realization or issued-invoice revenue. Future-dated rows may appear in a client's years map beyond the returned startYear..currentYear column list. Source: `src/endpoints/analytics/analytics-service.js:70`.

### Time allocation

Six account-scoped queries run concurrently, not in a repeatable-read snapshot:

| View | Query/order |
|---|---|
| Summary | All transactions in inclusive Jan 1..Dec 31; time hours split by billable, all billable dollars and all entry count. |
| byWorkDescription | Inner join work description; group by description text, order hours DESC then billed_amount DESC. Missing lookup rows disappear. |
| byCustomer | Inner join customers; group by display_name text, order hours DESC, LIMIT 20. Equal display names merge. |
| monthly | Group month number, order ascending; absent months are not filled with zeros. |
| trackerByCategory | Nondeleted tracker entries in year, processed or held; category trimmed with '(uncategorized)' fallback; duration/60 rounded to cents; order hours DESC. **Customer exclusions do not apply to this raw tracker query.** |
| availableYears | Distinct transaction years after customer exclusions, descending, then discard values beyond server current year+1 from the picker. Direct year queries still reach them. |

Source: `src/endpoints/analytics/analytics-service.js:220`, `src/endpoints/analytics/analytics-service.js:308`. There is no employee breakdown in this time-allocation response; the separate capacity report has one.

### WIP

Read account transactions with invoice ID NULL, inner customer join, exclude requested IDs. Due work is billable and date<=database CURRENT_DATE; future work is billable and date>CURRENT_DATE. Group customer, including inactive customers. Keep rows whose due amount sum>0 or future count>0. Sort oldest due date ASC NULLS LAST, customer ID ASC. No job join: WIP can include jobless work that invoice creation drops. Source: `src/endpoints/analytics/analytics-service.js:377`.

### Job budgets

Read account NULL-parent jobs with agreed_job_amount>0, join customer and left job type. LATERAL-sum billable transactions on the root or its **direct children**, account scoped, regardless of date or invoice link. No completed-job filter; no stored current_job_total use. Sort customer display_name then job description. Source: `src/endpoints/analytics/analytics-service.js:429`.

### Capacity and exclusions

Capacity compares inclusive Jan 1..Apr 15 for requested year and prior year. Join logged-for users, group by **employee display_name and ISO week number**, sum Time quantities, regardless of billable/invoice status. Order name/week. Same-name employees merge. Source: `src/endpoints/analytics/analytics-service.js:481`.

Exclusion options are active account customers plus inactive customers matching default display-name ILIKE patterns: LTDFH%, James F%Kimmel%Associate%, Kimmel Financial Partner%, Jim Kimmel Insurance Agenc%. Order options by display_name; default IDs come from those patterns across all account customers. Source: `src/endpoints/analytics/analytics-service.js:36`, `src/endpoints/analytics/analytics-service.js:509`.

## 6. Calculations

### Client-year and firm metrics

round2 uses Math.round((Number(n)+Number.EPSILON)*100)/100. Time quantities are stored hours, not newly rounded six-minute units. For each customer/year:

1. hours = rounded sum of billable Time quantity.
2. time_billed = rounded billable Time total; charges_billed = other/null-type billable total; total_billed = both.
3. labor_cost = rounded sum of Time quantity × employee's **current** cost_rate, missing cost=0.
4. writeoffs = rounded sum ABS(writeoff_amount) in that calendar year.
5. effective_rate = round2(time_billed/hours) when hours>0, else null.
6. margin = round2(total_billed-writeoffs-labor_cost).
7. realization_pct = round2((total_billed-writeoffs)/total_billed×100), and margin_pct = round2(margin/total_billed×100), only when total_billed>0.
8. agreed_rate comes from that customer/year agreement; rate_variance=effective_rate-agreed_rate, rounded, else null.

Sources: `src/endpoints/analytics/analytics-service.js:55`, `src/endpoints/analytics/analytics-service.js:121`.

Example: 10 billable time hours/$1,500, $200 fixed charges, $100 write-offs and $50/hour current labor cost => effective rate $150; labor $500; margin $1,100; realization 94.12%; margin 64.71%. A $140 agreement yields $10 variance. The calculation does not read actual payments.

Firm yearly rate statistics include only clients with at least 1 time hour and a nonnull rate. Average is unweighted across client rates; median sorts them, taking center or rounded mean of two centers. Percentile=round(number of rates strictly lower/sample count×100). Equal rates tie; maximum need not be 100. Source: `src/endpoints/analytics/analytics-service.js:148`.

Year-over-year growth compares last full year against its prior year for clients with truthy rates and prior>0, without the one-hour threshold. Median growth defaults 0 if none. For an even number of growth ratios, the shared median rounds the ratio to two decimals **before multiplying by 100**. Client yoy_pct is round2((last-prior)/prior×100). suggested_rate=round2(last full-year rate×(1+firm median growth)); no last rate yields null. Source: `src/endpoints/analytics/analytics-service.js:173`.

clientRates includes each client's IDs/name/active/commercial, years map with those metrics plus entries and optional firm_percentile; last_full_year_rate/current_year_rate/yoy_pct/suggested_rate; years array; firm.years with clients/median_rate/avg_rate, median_yoy_pct, last_full_year and formula text. Agreement notes are fetched but not returned in the yearly metrics. Source: `src/endpoints/analytics/analytics-service.js:102`, `src/endpoints/analytics/analytics-service.js:202`.

### Time, WIP and budgets

Time summary includes total_hours, billable_hours, nonbillable_hours, billed_amount, entries and billable_pct=100×billable_hours/total_hours, rounded or null. Non-time charge quantities never become hours, but billable charge dollars enter billed_amount. Raw tracker duration/60 is not ingestion's ceil(minutes/6) billing quantity, so the views can legitimately differ. Source: `src/endpoints/analytics/analytics-service.js:229`, `src/endpoints/analytics/analytics-service.js:304`.

WIP uses transaction age: dates today through today-30 inclusive; older than 30 through 60; older than 60 through 90; older than 90. Future amounts/counts are separate and do not enter due buckets, hours, entries or oldest_date. Output includes customer_id/name/is_active, unbilled_amount/hours, entries, oldest_date, days_old, four buckets and future_dated_count/amount. days_old is floor((JavaScript Date.now()-oldest_date)/86400000), while buckets use database CURRENT_DATE. Source: `src/endpoints/analytics/analytics-service.js:377`.

Job budget=round2(agreed amount); actual=round2(billable family charges); consumed_pct=round2(actual/budget×100); remaining=round2(budget-actual). No cap at 100% and no flooring remaining at zero. Example $1,000 budget and $1,200 billable work => 120%, -$200 remaining. Source: `src/endpoints/analytics/analytics-service.js:460`.

### CSV and packet contents

| Export | Columns/sections |
|---|---|
| Client rates | Customer; each returned year Hours, Billed (total), Rate, Agreed, Margin; Last Full-Year Rate, YoY %, Suggested Rate. Other JSON metrics are omitted. |
| Time allocation | Summary; by work description with entries; top 20 customer names; monthly; raw tracker categories including held/unprocessed entries. No full-customer or employee table. |
| Packet WIP | Customer, due dollars/hours/count, oldest date/days, four buckets, future count/amount. |
| Packet AR | Customer, four buckets, total owed, latest invoice date, last payment date, oldest open charge date/days, active flag. Fewer columns than standalone AR CSV. |
| Evidence | `src/endpoints/analytics/analytics-router.js:27`, `src/endpoints/analytics/analytics-router.js:54`, `src/endpoints/analytics/analytics-router.js:80`, `src/endpoints/analytics/analytics-router.js:108`. |

The year-end ZIP has client_rates_YEAR.csv, time_allocation_YEAR.csv, wip_unbilled_aging.csv and accounts_receivable_aging.csv. Only time allocation is selected-year-specific. Client rates always uses the latest six-year window; WIP and AR are **current**, not year-end historical snapshots. AR is limited to 10,000 rows. Reads run concurrently without a shared snapshot. Source: `src/endpoints/analytics/analytics-router.js:255`.

CSV cells handle null/undefined as empty, booleans literally, Date as ISO, finite numbers unchanged, nonfinite numbers empty. Formula-leading text (=,+,-,@,tab,CR) gets an apostrophe unless a valid numeric string. Comma/quote/newline cells are quoted and quotes doubled; rows join with LF. Source: `src/endpoints/analytics/csv-util.js:25`.

## 7. Create, edit and delete

rateAgreement INSERTs account/customer/year/rate/notes/URL userID. ON CONFLICT(account_id,customer_id,agreement_year) updates rate and notes only, preserving original creator/created_at. Missing/falsy notes becomes null, so resaving without notes clears them. It is one SQL statement; no customer ledger lock, invoice update, transaction repricing, S3 write or notification. No agreement delete/history API exists. Source: `src/endpoints/analytics/analytics-service.js:351`.

Customer and user foreign keys are independent, not composite with account_id. A same-account super admin can submit another account's valid customer ID or a forged existing userID in the URL; the route does not verify those references ([F32](../_review/findings.md#f32)). Source: `src/endpoints/analytics/analytics-router.js:203`, `migrations/schema-snapshot-2026-09-22.sql:2026`.

All other endpoints read data and stream CSV/ZIP in memory. They do not save exports, audits or year-end snapshots. Editing already-billed work elsewhere changes historical analytics on the next read; changing employee cost_rate also changes old labor-cost/margin calculations. Source: `src/endpoints/analytics/analytics-service.js:66`, `src/endpoints/analytics/analytics-router.js:270`.

## 8. Invariants and tests

| Existing spec | Assertions |
|---|---|
| test/integration/analytics.integration.spec.js | Case-insensitive Time, effective rates, exclusions, future WIP separation, billable job-family budgets, AR/FIFO and cross-view behavior. |
| test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js | All ten HTTP contracts, super-admin/account access, rate validation/upsert, CSV/ZIP response types. |
| test/endpoints/analytics/csv-util.spec.js | Formula injection, signed numeric preservation, quoting and dates. |

No tests or exports were executed. Role/account path tests do not prove ownership of body customerId or URL creator attribution ([F32](../_review/findings.md#f32)).

## 9. Known limitations and open decisions

Labels “billed,” “realization” and margin are transaction-based metrics with current labor costs; they do not measure cash receipts or preserve historic cost snapshots. The year-end packet mixes periods, and client/customer or employee name grouping may combine distinct identities. [F35](../_review/findings.md#f35) records the identity-merging issue; [F14](../_review/findings.md#f14) records the future-work mismatch with finalization. The accountant's intended revenue/cost methodology beyond the implemented formulas is **not determined from the code**. Sources: `src/endpoints/analytics/analytics-service.js:55`, `src/endpoints/analytics/analytics-service.js:256`, `src/endpoints/analytics/analytics-service.js:487`, `src/endpoints/analytics/analytics-router.js:255`.

FINAL_REPORT section 3 calls for review of stale WIP, internal customers and stale job totals. Internal exclusion picker defaults are not a replacement for INTERNAL_CUSTOMER_IDS billability enforcement. Section 6 covers that setting and the migration/deployment sequence. Production rollout completion is **not determined from the code**. Sources: `scripts/review-2026-09/FINAL_REPORT.md:52`, `scripts/review-2026-09/FINAL_REPORT.md:54`, `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **10 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
