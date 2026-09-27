# Recurring billing

**H6 navigation:** Billing → Recurring plans: `/billing/recurring` and `/:planId`; prepared charges remain in Create invoices `/billing/create`. [Route/permission and bookmark rules](../platform/workspace-navigation.md).

H4 implements owner item 7. Financial operators (manager, admin and super admin) manage plans and unissued fees; employees cannot mutate or open these screens. This is ordinary charge entry, not an adjustment to an issued invoice. Issued corrections still require an admin through H3. No approval or period close is added.

## Workflow and calendar

Open **Recurring plans** from the Customers navigation group, or `/billing/recurring`. The list combines client, business, active status and text filters. Open a plan or create one with a client, business, optional open job, description, positive fee with cents, frequency, bill-on day, inclusive start/end and active flag. A job must belong to the client and business; a shared job is allowed. A description can be used without a job. Every canonical plan save needs a reason and a UUID retry key; edits also need the current version.

Monthly, quarterly, semiannual and annual advance 1, 3, 6 and 12 calendar months from the starting month. Day 31 clamps to the last day of shorter months; days 29–31 clamp in February. The due date must be on/after start and on/before end. There is no proration, weekend shift, interest change or fake employee time. A start after the month's bill day waits until the next anchored due month. End mid-period does not reduce a fee whose due date already qualifies.

Opening Create Invoice first POSTs preparation for its selected business, then GETs the outstanding balances. Scheduling may remain disabled. Preview/GET never generates money. Finalize also prepares before pricing; if it creates a fee, it commits that preparation and returns **409, refresh and review** without creating an invoice. This is the intentional exception to the ordinary rule that a refusal writes nothing: its response lists the newly prepared periods. Finalize checks readiness again inside the ledger lock.

Preparation creates at most **12 missing due periods per plan per request**, oldest first, and returns each generated, skipped and outstanding period. A subsequent preparation is another capped batch, including another explicit Generate click or reopening Create Invoice; every response shows what remains. **Review catch-up** allows 1–12 selected periods to be generated or permanently skipped with a reason. Billing the selected business stops while due periods remain or an active plan is held for review. Legacy periods excluded at cutover are separately visible and do not block ordinary current billing. They require explicit selection and confirmation before any catch-up. No historical period is silently discarded.

Generated fees are ordinary quantity-one billable Charges, `is_excess_to_subscription=false`, with no logged-for employee or work-description catalog ID. Their text includes the covered period. Account Audit, AR and Create Invoice recognize supported description-only recurring charges and keep the existing balance-forward/absorption model. Unsupported legacy jobless work is not reinterpreted by H4.

Edit/skip controls show the client, business, period, due date, fee and current status. Edit amount/description or skip with a reason and current occurrence version. Skip keeps the charge row nonbillable and the occurrence forever; reopening or double-clicking cannot regenerate it. Ordinary transaction edit/delete screens link to these period controls. The ordinary delete API translates a valid versioned, reasoned request to skip. Issuing marks the occurrence locked and freezes it and its events with the statement. Use H3 for a correction after issue.

Plan rate/description/job changes affect only ungenerated periods. Prepared charges retain their original plan snapshot; edits are separate audited events. Changing business or cadence after any occurrence is refused: end/deactivate that plan and create a new one. Deactivation stops new generation and leaves prepared fees visible for explicit edit/skip. Plan-level activity is independent of already prepared charges. The customer recurring flag is reconciled from active plans across all businesses.

## API contracts

All nine routes are authenticated and manager/admin guarded. Each response includes `status:200`. Every write requires `Idempotency-Key: UUID`; the same key and input return the original result, and changing input under that key is 409. Identity comes from the session, not body account/creator fields. Money uses integer cents for validation and numeric(10,2) storage.

| Method | Path under `/recurringCustomer` | Input and successful result |
|---|---|---|
| GET | `/plans` | Optional `entityId`, `customerId`, `billingDate`; `{billingDate,plans}` with periods, occurrences and readiness. |
| POST | `/plans` | `customerId,entityId,description` or `jobId`, `amount,frequency,billDay,startDate,endDate?,active,reason`; `{plan,message}`. |
| GET | `/plans/:planID` | Scoped identity and optional filters; `{plan,events}`. |
| PATCH | `/plans/:planID` | Full plan fields plus `expectedVersion,reason`; immutable customer, history-protected business/calendar; `{plan,message}`. |
| GET | `/due` | Same read-only selection/result as `/plans`. |
| POST | `/prepare` | Optional `entityId,customerId,planId,customerIds,billingDate`; `{plans,generated,generatedPeriods,skipped,remaining,catchUpRequired}`. |
| POST | `/:planID/catch-up` | `action:generate|skip,reason,expectedVersion,billingDate?,periods?:[YYYY-MM-01],confirmHistorical?`; oldest next batch if periods omitted; `{plans,generated,skipped,message}`. |
| PATCH | `/occurrences/:occurrenceID` | `amount,description,reason,expectedVersion,entityId?`; `{occurrence,message}`. |
| POST | `/occurrences/:occurrenceID/skip` | `reason,expectedVersion,entityId?`; `{occurrence,message}`. |

Errors: 400 invalid IDs/dates/cents/frequency/day/boolean/reason/version/key/selection; 401 no session; 403 nonoperator or unauthorized financial reclassification; 404 missing/foreign client, business, job, plan or occurrence; 409 inactive client/business, closed job, stale version, retry conflict, handled period, history/calendar change or locked occurrence; 500 database failure with rollback. New recurring writes require no storage or email; finalize's existing local storage failure coverage still applies. Failed canonical writes leave no request, business, audit or event row. Sequencers may advance after a rollback, as in the existing ledger.

Legacy create/update/delete and embedded customer settings remain compatibility endpoints, owned by [customers](customers.md). They validate the calendar, positive fees and explicit boolean flags, populate the new anchor/description/entity fields, and increment plan version on real edits. Once there is occurrence history, legacy plan changes refuse with instructions to use the versioned, reasoned canonical controls; saving unchanged plan fields with unrelated customer details is allowed. Existing response envelopes are preserved. They do not offer occurrence editing or historical catch-up. The old recurring bookmark redirects to the canonical page.

## Persistence, concurrency and attribution

Migration 043 extends `recurring_customers`; it does not create a second plan table. It adds `recurring_plan_cutovers`, unique `recurring_charge_occurrences(plan_id,period_start)` and append-only `recurring_occurrence_events`. Every new table has audit capture, account/client/business ownership and truncate protection. Occurrence identity/snapshots are immutable; only generated state/version may change through the service. Generated transaction guards forbid deletion and ordinary edits. Deferred validation lets only an occurrence-backed fee omit staff/catalog fields. Statement membership includes issued occurrences and events. Audit Record presents and replays these sources.

An account advisory lock followed by client ledger locks serializes prepare, catch-up and finalize. UUID financial requests make retries safe. Generated rows/events use `system`, source `automation/recurring/prepare`, `.../finalize`, `.../catch-up` or `.../scheduler`; a human catch-up decision is also retained in its request/reason. Human edits/skips/finalize retain the session actor. The daily backstop receives the app's existing database connection and runs only when `RUN_SCHEDULED_AUTOMATIONS=true`; it does not send email. Existing real-email and scheduler guards remain separate and default off locally.

Covered staff work still records real time and cost, defaults nonbillable, and can explicitly be marked excess. `is_excess_to_subscription` still means outside the subscription; the independent billable choice remains available and survives changing hours or opening saved work. Switching a new work item to an uncovered business restores the ordinary billable default. Coverage is resolved for the selected client, business and service date against active plans, rather than the customer's global flag. The fee is never reduced by the value of covered work and old time is never changed.

## Cutover and evidence

Apply the **044 guard preflight before 043** on a populated legacy database, then 044 normally/idempotently. See [operations](../platform/operations.md#h4-rollout--recurring-billing). 044 permits only materializing a plan's already effective default business, retaining the admin gate for actual changes. 043 records the old plan in immutable cutover evidence and sets the first automated due period on/after the Phoenix rollout date. Eight local account-1 monthly plans retain their original fees/start/end/active values and begin automatic generation on **2026-10-01** after the recorded 2026-09-26 cutover. The migration generates no charge/invoice and changes no pre-cutover financial balance. Earlier periods are visible, excluded by default and require review before catch-up.

[Hand-computed oracles](../scenarios/H4-recurring.md), [run results](../decisions/2026-09-26-run-H4-results.md), `scenario-H4-recurring.integration.spec.js`, `path-matrix-H4-recurring.integration.spec.js`, calendar/migration unit tests, recurring/invoice Jest tests and `e2e/tests/recurring-billing.spec.js` prove these behaviors. The full regression result is recorded only after execution in the run report.

## H5 reporting

Recurring fee dollars are issued revenue only after finalization. Covered time remains nonbillable work entered and supplies the actual-hours/captured-cost cohort for its client/business period. Fee allocations are proportional to supporting standard value; the generated charge and covered effort are not both counted in the realization denominator. See [analytics](../invoicing/analytics.md) and the [$300 recurring/$60 labor oracle](../scenarios/H5-honest-analytics.md#3-cash-lineage-and-recurring-effort).

## H9 loading update

Plan create/edit and filters use compact local customer identities up to1000 clients, otherwise server type-ahead. Optional jobs load/search only for the selected client/business and preserve an explicitly selected historical version. Latest job versions remain selectable even when their parent version is outside the page.

See [bounded loading and save responses](../platform/performance.md) for the current wire contract and [H9 results](../decisions/2026-09-26-run-H9-results.md) for full regression evidence. These details supersede older full-list/grid response descriptions in this guide. Committed refresh warnings still mean saved: reload, do not resubmit.

## H10 preparation measurement

Preparation still completes before Create invoices reads balances. Account-1 profiling uses the real read-only due preview; it never prepares protected clients. A separate eight-plan synthetic scenario measures actual generation and a second preparation, proving eight charges once and zero repeated charges. H10 changes invoice data fetching after preparation, not its calendar, locking, idempotency, audit attribution or finalize-review gate. [H10 hand oracle](../scenarios/H10-batched-calculations.md).
