# Owner decisions — run 3 results (2026-09-25)

Implemented optional credit statements and the time-increment audit across backend, frontend, database, PDFs and documentation. The owner's confirmed boundary remains: **drafts stay editable and write nothing to the ledger; finalize means sent and locked**. All five decisions pass the [combined lifecycle](../scenarios/16-owner-combined.md). Decision 6, the universal account history ledger, belongs to the next run.

## What was built

- Create Invoice identifies negative totals as **Credit — no payment due**. Bulk selection excludes credits; an individual choice opts a credit customer in. Refreshing a selected debit into a credit never silently authorizes it. Skipped customers retain pending work, receipts, write-offs and retainer events.
- Selected credit statements issue an immutable signed balance that carries forward exactly once. Engine, independent Account Audit and Accounts Receivable retain the latest signed balance for each current chain. Zero is settled; a negative balance is credit.
- Original credit PDFs show **CREDIT STATEMENT**, signed **Credit balance** and **No payment due** instead of a payment-due date. Bounced-payment revision PDFs also distinguish credit from debt. Invoice details distinguish original issued amounts from current balances; AR displays credit explicitly.
- The existing manual rule is now shared across duration-based billing: round each duration up to six minutes (0.1 hour). Manual timer boundaries, raw-minute preservation, edit initialization, spinner increments and cent pricing are aligned. Tracker ingestion and held review use the same backend helper. Actual-time analytics remain separate from billed quantities.
- Finalization, held-entry application and Billing Review corrections establish the acting session user and reason through existing transaction helpers. Credit selection is captured in immutable issuance evidence for attribution by decision 6.

The authoritative [design record](2026-09-24-owner-decisions.md) contains the full behavior, data/API contracts, lock rules, time-path inventory, hand calculations and deliberate regression changes. Affected feature, endpoint-index, operations and scenario documents are updated; their local links were checked. The owner's confirmation remains in all three required documents.

## Migration and rollout

**025.credit_statement_selection.sql** adds nullable `invoice_issues.credit_selection_reason`, constrained to nonblank text of at most 2,000 characters and protected by the existing immutable-issue trigger. Older records are not backfilled. The exact payload, issuer, issue time, artifact and history already capture the remaining evidence.

Applied by hand using `psql -X -1 -v ON_ERROR_STOP=1 -f` to **ds2_local, ds2_clean and ds2_scenarios**, all on `127.0.0.1:5433`. The SQL is idempotent and contains no top-level BEGIN/COMMIT. Migration count is **24 runnable files, 002–025**; the migration spec and scenario reset include 025. Its presence in all three databases was independently rechecked after testing: [schema evidence](evidence/run-3/acceptance/migration-025-presence.json).

Future production rollout is documented in [operations](../platform/operations.md#owner-run-3-rollout--migration025-and-signed-credits) and `scripts/review-2026-09/FINAL_REPORT.md`, section 6: backup/rehearsal, pause financial writers, migrations through 025, paired backend/frontend, owner-workflow checks and three-view reconciliation. No deployment was performed. Code that drops negative balances must not replace signed carry-forward code after credit statements have been issued.

## Routes and screens

No new routes were needed. Changed behavior is covered through these existing interfaces:

| Interface | Final behavior |
|---|---|
| POST `/invoices/createInvoice/:accountID/:userID` | Strict per-customer `includeCreditStatement` boolean and optional bounded `issueReason`; authoritative pricing; default skip or selected signed issuance. Invalid configuration/settings/IDs return 400, missing or foreign customers 404, billing conflicts 409, and unexpected failures 500. Existing successful skips and committed export warnings remain 200. |
| GET `/invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID` | Signed totals and `is_credit_statement`; pricing failures return 500 instead of a misleading zero. |
| Account Audit customer/run/detail/PDF and AR aging/CSV routes | Signed latest-chain balances and credit visibility; independent reconciliation retained. |
| Transaction create/edit, tracker ingestion/manual apply and Billing Review apply/correction routes | Shared six-minute duration and cent pricing; existing role, tenant and sent-lock guards remain enforced. |
| Existing bounced-exception revision resolution | Revision PDF labels signed credit correctly and says no payment due when the revised total remains negative. |

Screens changed: Create Invoice selection and finalization confirmation, Invoice Details, Accounts Receivable, manual Time/Edit Transaction and shared TimeOptions. No delivery status or separate “mark sent” step was introduced.

## Verification

All test processes ran sequentially, with integration files executed one at a time. Final results have **zero failures and zero pending tests**. Scenario and clean-room results overlap the integration population; these counts must not be added as unique tests.

| Check | Exact result | Evidence |
|---|---:|---|
| Backend unit suite | **1,045 passing** | [Unit log](evidence/run-3/acceptance/unit.log) |
| Every integration file, individually | **64 files; 2,020 passing** | [Per-file counts](evidence/run-3/acceptance/integration-counts.json), table below |
| `npm run -s test:scenarios` | **863 passing** | [Scenario log](evidence/run-3/acceptance/scenarios.log) |
| `npm run -s test:cleanroom` | **18 passing** | [Clean-room log](evidence/run-3/acceptance/cleanroom.log) |
| Drift: engine versus Account Audit | **319 checked; 0 differences** | [Drift summary](evidence/run-3/acceptance/drift-summary.json) |
| Drift: engine billed component versus AR | **320 checked; 0 differences** | Same summary; 39 AR rows, including 1 inactive customer |
| Frontend Jest | **38 suites; 165 tests passing** | [Jest log](evidence/run-3/acceptance/frontend-jest.log) |
| `CI=true npm run build` | **Compiled successfully** | [Build log](evidence/run-3/acceptance/frontend-build.log) |

Commands used the requested Mocha setup/exclusions/timeouts and frontend CI settings. The ordinary unit/integration target was `.env.local`; scenario files used `.env.scenarios`, clean-room files used `.env.clean`, and the existing provisioning guard redirected its two account-creation specs to ds2_clean. No test process targeted production. [Machine-readable suite results](evidence/run-3/acceptance/suite-counts.json).

New lifecycle evidence:

- [Scenario 15 — credit statements](../scenarios/15-credit-statements.md): **11 passing**, including skip/selection, immutable evidence, signed carry-forward, crossing zero, malformed input, role/tenant/missing records, database/storage rollback and failed pricing. Bounced-receipt hand oracles cover −$10 → $10 debt and −$50 → −$30 credit. The final focused rerun also verifies that null output settings return 400 without writes.
- [Scenario 16 — all five decisions](../scenarios/16-owner-combined.md): **4 passing**. Work and retainer funding issue $300; duplicate removal leaves $340 next due; a $100 receipt plus new work issues $240; its bounced reversal restores $340; refunding $40 leaves $60 retainer available without changing debt; a $400 credit is first skipped, then issued at −$60; later $80 work produces $20 due.
- [Scenario 17 — time boundaries](../scenarios/17-time-boundaries.md): **10 passing**. At $137.50/hour, minutes 1/6/7/14/15/16/59/60/61 bill 0.1/0.1/0.2/0.3/0.3/0.3/1.0/1.0/1.1 hours. One set totals 4.4 billed hours/$605; manual plus held-review sets total 8.8 hours/$1,210. Raw tracker time remains 239 minutes/3.98 displayed actual hours.

The [credit statement](evidence/run-3/credit-statement.pdf) and [credit revision](evidence/run-3/credit-revision.pdf) were rendered and visually inspected for legibility and layout; scenario assertions also inspect their text and archived original bytes. The [time source scan](evidence/run-3/time-increment-source-scan.txt) supports the path-by-path design audit.

Initial failures were fixed and rerun: intended conflict status changes, a JSX delimiter, a nonexistent fixture-query column and a duplicate synthetic customer name. Coverage was retained. `integration-first-pass-counts.json` is diagnostic history; `integration-counts.json` and the table below are the final results.

## Protected account 1

After all testing, read-only queries confirmed that ds2_local account 1 matches both its before-run counts and ds2_ref_20260922 in all seven required tables. The reference database was read only for this explicitly requested count comparison, with `default_transaction_read_only=on`.

| Table | Before | Final ds2_local | Reference |
|---|---:|---:|---:|
| customers | 338 | 338 | 338 |
| customer_transactions | 39,052 | 39,052 | 39,052 |
| customer_payments | 1,005 | 1,005 | 1,005 |
| customer_writeoffs | 657 | 657 | 657 |
| customer_invoices | 2,253 | 2,253 | 2,253 |
| timesheet_entries | 28,255 | 28,255 | 28,255 |
| users | 23 | 23 | 23 |

[Protected-count evidence](evidence/run-3/acceptance/protected-account-counts.json). Business writes stayed within ds2_scenarios, ds2_clean or fixture account 9001 in ds2_local. Storage used local MinIO at `127.0.0.1:9000`. No production/AWS connection, git command, commit, deployment or running-server start/stop was performed.

## Changes to prior rules and open questions

- Negative finalization is optional instead of categorically refused. Zero means settled; negative means credit. Final invoice totals round to cents before classification, avoiding floating-point residue.
- Billing conflicts now use HTTP 409 and invalid/missing selection uses 400/404 instead of the old generic 500 envelope. Three race assertions were updated while preserving all rollback/concurrency checks. Default credit-skip coverage remains.
- Raw minutes are preserved: 63 minutes stays 63 and bills 1.1 hours, instead of being overwritten with 66. The hours spinner steps by 0.1. A timer ending exactly on a six-minute boundary no longer gains an extra minute. Display and submission agree on half-cent pricing, including 0.3 × $1.15 = $0.35.
- Explicit decimal-hour quantities submitted **without a duration** retain the existing stored-quantity contract, including historical 0.25-hour entries. Opening an old entry does not rewrite it. Billing Review explicit dollar overrides remain a separate correction path and are refused after finalize. Actual-time analytics are not billed-hour rounding.

No unanswered business question blocks run 3. Decision 6 will add universal who/what/when/before/after history and a printable immutable account record; this run provides actor/reason and feature-level evidence without claiming that ledger is complete.

## Individual integration results

Every file below exited successfully with zero failures and zero pending tests. The log link is the final standalone execution for that file; the credit suite was rerun after its final PDF and validation refinements.

| Integration file | Passing |
|---|---:|
| [analytics.integration.spec.js](evidence/run-3/acceptance/analytics.integration.spec.log) | 11 |
| [billing-regression.integration.spec.js](evidence/run-3/acceptance/billing-regression.integration.spec.log) | 2 |
| [cascade-edit-recompute.integration.spec.js](evidence/run-3/acceptance/cascade-edit-recompute.integration.spec.log) | 11 |
| [clean-room-regression.integration.spec.js](evidence/run-3/acceptance/clean-room-regression.integration.spec.log) | 18 |
| [coverage-account-users-auth-misc.integration.spec.js](evidence/run-3/acceptance/coverage-account-users-auth-misc.integration.spec.log) | 200 |
| [coverage-billing-review.integration.spec.js](evidence/run-3/acceptance/coverage-billing-review.integration.spec.log) | 31 |
| [coverage-downloads-authz.integration.spec.js](evidence/run-3/acceptance/coverage-downloads-authz.integration.spec.log) | 36 |
| [coverage-invoices-audit-ar-analytics.integration.spec.js](evidence/run-3/acceptance/coverage-invoices-audit-ar-analytics.integration.spec.log) | 131 |
| [coverage-jobs-masterdata.integration.spec.js](evidence/run-3/acceptance/coverage-jobs-masterdata.integration.spec.log) | 124 |
| [coverage-payments-pending.integration.spec.js](evidence/run-3/acceptance/coverage-payments-pending.integration.spec.log) | 102 |
| [coverage-pending-payments-authz.integration.spec.js](evidence/run-3/acceptance/coverage-pending-payments-authz.integration.spec.log) | 10 |
| [coverage-timetracking-timesheets.integration.spec.js](evidence/run-3/acceptance/coverage-timetracking-timesheets.integration.spec.log) | 106 |
| [coverage-transactions-retainers-writeoffs.integration.spec.js](evidence/run-3/acceptance/coverage-transactions-retainers-writeoffs.integration.spec.log) | 84 |
| [finalize-engine.integration.spec.js](evidence/run-3/acceptance/finalize-engine.integration.spec.log) | 15 |
| [finalize-snapshot.integration.spec.js](evidence/run-3/acceptance/finalize-snapshot.integration.spec.log) | 9 |
| [month-end-lifecycle.integration.spec.js](evidence/run-3/acceptance/month-end-lifecycle.integration.spec.log) | 19 |
| [orchestrator.integration.spec.js](evidence/run-3/acceptance/orchestrator.integration.spec.log) | 7 |
| [payment-reversal.integration.spec.js](evidence/run-3/acceptance/payment-reversal.integration.spec.log) | 49 |
| [pii-leak.integration.spec.js](evidence/run-3/acceptance/pii-leak.integration.spec.log) | 2 |
| [review-account-atomicity.integration.spec.js](evidence/run-3/acceptance/review-account-atomicity.integration.spec.log) | 4 |
| [review-analytics-identities.integration.spec.js](evidence/run-3/acceptance/review-analytics-identities.integration.spec.log) | 2 |
| [review-audit-download.integration.spec.js](evidence/run-3/acceptance/review-audit-download.integration.spec.log) | 4 |
| [review-audit-filter.integration.spec.js](evidence/run-3/acceptance/review-audit-filter.integration.spec.log) | 3 |
| [review-customer-delete.integration.spec.js](evidence/run-3/acceptance/review-customer-delete.integration.spec.log) | 4 |
| [review-customer-recurring.integration.spec.js](evidence/run-3/acceptance/review-customer-recurring.integration.spec.log) | 8 |
| [review-customer-response.integration.spec.js](evidence/run-3/acceptance/review-customer-response.integration.spec.log) | 2 |
| [review-initial-data-roles.integration.spec.js](evidence/run-3/acceptance/review-initial-data-roles.integration.spec.log) | 18 |
| [review-invoice-outcomes.integration.spec.js](evidence/run-3/acceptance/review-invoice-outcomes.integration.spec.log) | 4 |
| [review-job-family.integration.spec.js](evidence/run-3/acceptance/review-job-family.integration.spec.log) | 4 |
| [review-job-selection.integration.spec.js](evidence/run-3/acceptance/review-job-selection.integration.spec.log) | 2 |
| [review-pending-files.integration.spec.js](evidence/run-3/acceptance/review-pending-files.integration.spec.log) | 7 |
| [review-rate-agreements.integration.spec.js](evidence/run-3/acceptance/review-rate-agreements.integration.spec.log) | 10 |
| [review-related-ids.integration.spec.js](evidence/run-3/acceptance/review-related-ids.integration.spec.log) | 24 |
| [review-retainer-dates.integration.spec.js](evidence/run-3/acceptance/review-retainer-dates.integration.spec.log) | 1 |
| [review-statement-snapshot.integration.spec.js](evidence/run-3/acceptance/review-statement-snapshot.integration.spec.log) | 1 |
| [review-template-storage.integration.spec.js](evidence/run-3/acceptance/review-template-storage.integration.spec.log) | 1 |
| [review-tracker-outcome.integration.spec.js](evidence/run-3/acceptance/review-tracker-outcome.integration.spec.log) | 1 |
| [review-transaction-policy.integration.spec.js](evidence/run-3/acceptance/review-transaction-policy.integration.spec.log) | 22 |
| [review-user-guards.integration.spec.js](evidence/run-3/acceptance/review-user-guards.integration.spec.log) | 7 |
| [scenario-lifecycle-01-work.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-01-work.integration.spec.log) | 13 |
| [scenario-lifecycle-02-retainers.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-02-retainers.integration.spec.log) | 9 |
| [scenario-lifecycle-03-payments.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-03-payments.integration.spec.log) | 7 |
| [scenario-lifecycle-04-writeoffs.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-04-writeoffs.integration.spec.log) | 6 |
| [scenario-lifecycle-05-monthend.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-05-monthend.integration.spec.log) | 7 |
| [scenario-lifecycle-06-cascade.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-06-cascade.integration.spec.log) | 9 |
| [scenario-lifecycle-07-refusals.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-07-refusals.integration.spec.log) | 122 |
| [scenario-lifecycle-08-failures.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-08-failures.integration.spec.log) | 24 |
| [scenario-lifecycle-09-state-boundaries.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-09-state-boundaries.integration.spec.log) | 21 |
| [scenario-lifecycle-10-integrity.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-10-integrity.integration.spec.log) | 22 |
| [scenario-lifecycle-11-finalize-races.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-11-finalize-races.integration.spec.log) | 15 |
| [scenario-lifecycle-12-sent-exceptions.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-12-sent-exceptions.integration.spec.log) | 72 |
| [scenario-lifecycle-13-retainer-events.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-13-retainer-events.integration.spec.log) | 24 |
| [scenario-lifecycle-14-duplicates.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-14-duplicates.integration.spec.log) | 23 |
| [scenario-lifecycle-15-credit-statements.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-15-credit-statements.integration.spec.log) | 11 |
| [scenario-lifecycle-16-owner-combined.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-16-owner-combined.integration.spec.log) | 4 |
| [scenario-lifecycle-17-time-boundaries.integration.spec.js](evidence/run-3/acceptance/scenario-lifecycle-17-time-boundaries.integration.spec.log) | 10 |
| [scenario-what-if-01-values.integration.spec.js](evidence/run-3/acceptance/scenario-what-if-01-values.integration.spec.log) | 308 |
| [scenario-what-if-02-retries.integration.spec.js](evidence/run-3/acceptance/scenario-what-if-02-retries.integration.spec.log) | 23 |
| [scenario-what-if-03-history.integration.spec.js](evidence/run-3/acceptance/scenario-what-if-03-history.integration.spec.log) | 25 |
| [scenario-what-if-04-calendar-races.integration.spec.js](evidence/run-3/acceptance/scenario-what-if-04-calendar-races.integration.spec.log) | 13 |
| [scenario-what-if-05-csv.integration.spec.js](evidence/run-3/acceptance/scenario-what-if-05-csv.integration.spec.log) | 13 |
| [scenario-what-if-06-boundaries.integration.spec.js](evidence/run-3/acceptance/scenario-what-if-06-boundaries.integration.spec.log) | 82 |
| [tracker-excel-end-to-end.integration.spec.js](evidence/run-3/acceptance/tracker-excel-end-to-end.integration.spec.log) | 33 |
| [transactions-ledger-seams.integration.spec.js](evidence/run-3/acceptance/transactions-ledger-seams.integration.spec.log) | 28 |
| **Total: 64 files** | **2,020** |
