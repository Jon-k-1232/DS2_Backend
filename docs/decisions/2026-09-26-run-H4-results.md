# H4 results — recurring billing automation

2026-09-26. Owner item 7 is implemented and verified locally. All 100 required acceptance commands passed, and the five affected backend checks passed again on the final code. Counts, protected-data verification and artifacts are retained below. No Git command/commit, production deployment, AWS access, real email or reference-database connection is part of this run.

## Delivered behavior

Plans use the existing `recurring_customers` table with an explicit business, optional owned open job or description, positive fee, monthly/quarterly/semiannual/annual cadence, day1–31, inclusive start/end, activity and version. Calendar cadence stays anchored across years; short months clamp the due day. Fees are full-period amounts without proration. Canonical saves require a reason and UUID retry key; updates require the current version.

Create Invoice prepares due fees before loading balances, even with automations disabled. GET/preview remains read-only. Finalize prepares before pricing and rechecks readiness inside the ledger lock; when it adds a fee, it returns409 with its generated-period detail and requires refresh, with no invoice created. Preparation is intentionally committed in that one documented refresh case. Every other rejected H4 write preserves the committed database. Preparation is capped at12 due periods per plan/request and exposes exact remaining/skipped periods; explicit catch-up generates/skips a selected next batch. Excluded pre-cutover periods require deliberate review and confirmation.

Generated fees are quantity-one billable Charges, not excess work, with no fictional staff time. Pending fees can be edited or permanently skipped with a reason/current version. Skips retain the row, nonbillable, and the unique occurrence; finalize freezes issued occurrences/events. A plan edit affects only ungenerated periods; history locks business/calendar changes. Deactivation leaves already generated charges visible for disposition. Ordinary transaction controls link to recurring controls; a valid ordinary delete API request records a skip rather than removing history.

System generation carries its source in the append-only audit ledger. Human actions retain session attribution and reasons. Supported description-only fees participate in Create Invoice, independent Account Audit, AR, PDF and audit replay without changing rolling balance/absorption rules. PDF prints the period and fee, with a blank job cell when none exists; the printed interest line is untouched. Ordinary malformed relation filtering is preserved. Covered/excess defaults use selected client/business/date and preserve an independent billable choice, including when hours change or an existing transaction opens.

No period close or approval workflow. H3's admin-only issued adjustments remain unchanged. Manager/admin/super admin may manage ordinary unissued plans/fees; employees are refused. No bank, QuickBooks, collections or online-payment integration.

## Migration and protected account

**043/044**, applied individually to ds2_local, ds2_clean and ds2_scenarios with `psql -X -1 -v ON_ERROR_STOP=1 -f`. 043 adds plan metadata, `recurring_plan_cutovers`, `recurring_charge_occurrences`, `recurring_occurrence_events`, audit/scope/immutability guards, supported staffless-fee validation, an extended entity view and statement membership. 044 permits physical materialization of the already effective recurring-plan business, without relaxing actual reclassification permissions.

On a populated legacy database, **044 must be the preflight before043**, then044 is safe again. The first local043 attempt was refused atomically; the preflight fixed that boundary without editing an applied migration. Fresh empty-schema numeric order remains043→044. The post-migration clean-room seed is explicitly cut over with043. Historical migration specs replay each migration at its own schema boundary, preserving idempotence coverage without attempting to shrink a later extended view. Current inventory43 files, next free045.

Intended account-1 changes: update eight existing plans with physical default business and H4 metadata; insert eight immutable original-plan cutovers; append sixteen system migration audit events. Keep original fees, dates, activity, client and creator. First automatic period is **2026-10-01** for all eight day1 Monthly plans after the Sep26 Phoenix cutover. The migration creates no fee/invoice and changes no original ledger amount. Earlier periods remain excluded. Existing monthly fees total **$3,520.54**, only payable when a qualifying period is actually generated.

A separate local fixture cleanup removed381 orphaned recurring rows in account9001 whose customers had already been removed by older tests. No account-1 row was deleted. The production rollout does not include this fixture cleanup. Migration logs and cleanup IDs are retained in `evidence/run-H4/`. [Operations](../platform/operations.md#h4-rollout--recurring-billing) and [FINAL_REPORT](../../scripts/review-2026-09/FINAL_REPORT.md) give the future operator steps; no deployment was performed.

| Protected table | Verified local count = retained reference |
|---|---:|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

**Protected-data verification passed.** Ten untouched tables retain identical counts and sorted whole-row digests. The other two captured tables have only the expected plan/audit differences. The seven required counts above still match the retained reference census. The check read only ds2_local; it never connected to ds2_ref_20260922. [Before](evidence/run-H4/account1-before.json), [after](evidence/run-H4/account1-after.json), [exact field differences and audit additions](evidence/run-H4/account1-verification.json), [read-only verifier](evidence/run-H4/verify-protected-data.cjs).

The complete account-1 migration effects are:

- Plans **1–8**, for clients **53, 59, 62, 67, 72, 73, 230 and 298**: physical billing_entity_id changes from null to already-effective default business **2**. New fields contain description “Recurring services”, job_id null, anchor_start_date equal to the original start date, first_automated_period **2026-10-01**, version **1**, review_status **ready**, and cutover_date **2026-09-26**. Original fees, frequencies, bill days, dates, activity, client and creator are unchanged.
- **Eight** recurring_plan_cutovers retain the original plans. **Sixteen** system audit events record these inserts and the plan updates, with source migration/043.recurring_billing and the cutover reason. The original **139,949** audit events retain their digest; the complete **139,965-event** chain verifies.
- **Zero** account-1 occurrences or occurrence events, zero generated fees and zero new invoices. Migration 044 has no data backfill. All other captured account-1 rows are unchanged.

## Routes, screens and deliberate compatibility

Nine canonical routes, all documented in [recurring billing](../work/recurring-billing.md#api-contracts) and [README](../README.md#h4-endpoint-index-additions), bring the implemented contract count to216. List/editor routes are `/billing/recurring` and `/billing/recurring/:planId` (`new` creates a plan). The current sidebar links from Customers; H6 may consolidate Billing navigation. The old recurring bookmark redirects. Create Invoice embeds ready fees and catch-up controls; ordinary charge screens link to period controls.

Existing embedded customer/legacy recurring payloads and response shapes remain compatible. They validate supported cadence/cents/dates/boolean values, set H4 anchor/entity/description fields and increment versions. A legacy change after generation is refused in favor of canonical reasoned/versioned controls; an unchanged plan permits unrelated customer-detail updates. The profile selects one active plan summary deterministically, while the canonical screen lists every plan. The legacy customer form now offers Monthly, Quarterly, Semiannual and Annual. The customer recurring flag is reconciled across businesses.

The cap is per preparation, as the design specifies: another explicit Generate action, page open or daily backstop can process another capped batch. Every response reports its result; explicit Review catch-up also supports permanent skips and reviewed pre-cutover periods. Excluded legacy periods do not block ordinary current billing. These implementation details are recorded in the integrated design and feature guide.

## Validation and evidence

All required commands run one process at a time, integration files individually. The runner retains exact commands/env/counts and stops on the first failure. Fixes found during this run include the supported-only relation exception, blank job PDF cell, customer-profile multi-plan summary, independent billable choice, legacy frequency fixtures and post-seed cutover. Existing financial oracles and tenant/role assertions remain intact. Initial failing diagnostic logs are retained separately from final accepted results.

| Required validation | Final result |
|---|---:|
| Backend unit | **1,208 passed** |
| Individual integration files | **3,082 passed / 92 files** |
| Standalone scenarios | **1,925 passed / 51 files** |
| Clean-room regression | **18 passed** |
| Payment-image Lambda | **17 passed** |
| Frontend Jest | **346 passed / 60 suites** |
| CI production build | **Passed** |
| Full remote Playwright, one worker | **176 passed** |
| Read-only financial drift | **0 / 1,014 client-business comparisons** |

All **100 required commands exited 0**, with **zero failures, skipped, pending or flaky tests**. Scenario and clean-room totals overlap the individual integration runs. The final backend recheck repeated unit (1,208), transaction/retainer/write-off regression (84), related-ID ownership (24), H4 route matrix (63) and H4 scenarios (17); those results replace earlier accepted rows rather than inflating the totals.

[Command/env/count ledger](evidence/run-H4/acceptance/validation-results.json), [summary](evidence/run-H4/acceptance/summary.json), [full browser result](evidence/run-H4/acceptance/playwright-results.json), [drift summary](evidence/run-H4/acceptance/drift-summary.json) and per-command logs are retained. Drift preserves the default-business next balance **$60,888.50** and outstanding balance **$41,015.00**; the other businesses remain zero.

The focused H4 suites cover all listed calendars, $375→$225→$265 reconciliation, source attribution, empty/same/stale/double requests, cutover exclusion and explicit confirmation, optional scheduler races, job-only/description-only fees, locked state, wrong IDs/business/tenant/role and injected DB failures. Browser coverage includes plan validation, pending edit/skip, exact cap/skip behavior, independent excess/billable work, legacy annual creation, finalization, default-off scheduling, links, versions, failure recovery and manager/super-admin/employee behavior. Route refusals compare every committed table, including audit/request metadata.

The final browser-produced [recurring invoice](evidence/run-H4/pdfs/recurring-invoice.pdf) was rendered and visually inspected: one readable page, September 1–30 period, $125.00 fee and balance, blank optional job cell, and the exact existing interest line. [PDF verification](evidence/run-H4/pdfs/verification.json) retains its SHA-256 and the source archive. The [Create Invoice screenshot](evidence/run-H4/ui/recurring-ready.png) shows the ready fee, business, period, due date and edit/skip actions. The earlier PDF containing a literal null job label is retained only as a diagnostic; the final output fixes that label.

Offline Graphify refreshed **542 code files → 2,246 nodes, 3,087 edges, 344 communities and 2,590 Obsidian graph notes**, using **zero model tokens**. The [source inventory](evidence/run-H4/source-change-manifest.json) records **66 source/test/script files**, with retained H3 hashes where available and explicit limits on the comparison. No Git was used. The integrated design, endpoint index, feature rules, hand oracles, rollout, FINAL_REPORT, workspace MEMORY and Obsidian documentation mirror are updated. H5 starts at migration **045**.

No owner-only decision is required for this local implementation. Production activation and review of excluded historical periods remain separate operator decisions.
