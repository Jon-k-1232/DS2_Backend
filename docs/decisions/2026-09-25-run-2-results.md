# Owner billing decisions — run 2 results

Implemented decisions **1 (manual retainer refunds/adjustments)** and **4 (duplicate flagging/review/removal)**, following the [owner design record](2026-09-24-owner-decisions.md). Run 1's finalized = sent lock and bounced-payment exceptions remain in force. Decisions 2 and 6 are left for run 3.

## What was built

- Customer retainer page: choose a root receipt, record a refund or increase/decrease adjustment, enter amount/date/method/reference/reason, review predicted credit, confirm and inspect immutable event history. Exhausted chains can receive increases. Funds already applied cannot be refunded or removed; cancelled bounced-payment chains cannot be revived. Recording a refund documents money returned by the operator; it does not initiate a bank transfer.
- Each event atomically appends a balance snapshot and immutable journal row with actual session actor, reason, effective date, server timestamp and available credit before/after. Event-bearing history cannot be rewritten even before invoicing. Existing sent rows and original PDFs remain unchanged.
- Pending refund/adjustment events appear on the next invoice/statement, including full refunds that leave zero credit. Event-only zero-dollar customers remain selectable. Finalize fingerprints include events, so a concurrent refund invalidates stale pricing. Invoice details retain the frozen event payload. Audit lists informational activity and separates drawn funds from refunded/adjusted funds; AR billed debt is unchanged.
- Manual transactions, payments, write-offs and retainer receipts detect possible duplicates atomically. Matching requires account/customer/kind, amount, a three-calendar-day window and normalized supporting details, documented in [duplicates](../ledger/duplicates.md). Known tracker work, automatic excess/snapshot rows and ineligible payments are excluded. Matches create advisory flags, never automatic deletion.
- Grids show Possible duplicate badges. The Possible duplicates page provides both records, scan/manual flag, not-a-duplicate dismissal, confirmed removal, sent-invoice guidance and history. Removal rechecks current source, locks and existing financial dependencies, then uses the existing deletion core and captures affected before/after ledger rows. Changed candidates require a fresh explicit review; prior history survives. Scans do not reopen resolved reviews.
- Every new mutation uses existing transaction/customer-lock helpers with session actor and reason. Manual creation establishes attribution before posting. Feature journals prepare for decision 6; they are not yet the account-wide audit ledger.

## Migration, routes and screens

[024.retainer_events_duplicates.sql](../../migrations/024.retainer_events_duplicates.sql) was applied **by hand** with `psql -X -1 -v ON_ERROR_STOP=1 -f` to **ds2_local, ds2_clean and ds2_scenarios** on 127.0.0.1:5433, then rerun to verify idempotence. It adds `retainer_events`, `duplicate_flags`, `duplicate_history`, indexes, immutable journal/snapshot guards and event statement membership. It does not backfill existing ledger rows. Plain SQL; no top-level BEGIN/COMMIT. Migration count is 23 numbered files (002–024), with a new two-test migration spec. Scenario reset includes 024.

Application and rerun logs are in [evidence/run-2](evidence/run-2). Future production rollout steps are recorded in [operations](../platform/operations.md#owner-decisions-1-and-4-migration-024-rollout) and [FINAL_REPORT section 6](../../scripts/review-2026-09/FINAL_REPORT.md#6-migration-and-rollout-notes). No production rollout occurred.

| Method | New route | Purpose |
|---|---|---|
| GET | `/retainers/:retainerID/events/:accountID/:userID` | Available credit, root/latest records and event history |
| POST | `/retainers/:retainerID/events/:accountID/:userID` | Record refund or adjustment with reason |
| GET | `/duplicates/:accountID/:userID` | Open/all reviews, source records, locks and history |
| POST | `/duplicates/:accountID/:userID` | Manual flag or explicit fresh review of an edited resolved candidate |
| POST | `/duplicates/scan/:accountID/:userID` | Account/customer scan with reason |
| POST | `/duplicates/:duplicateID/resolve/:accountID/:userID` | Dismiss or remove with reason |

Routes require authenticated manager/admin/owner access and exact account scope; actor identity comes from the session, never the URL. Validation, missing/foreign IDs, sent/dependency/stale conflicts and database errors return HTTP 400/401/403/404/409/500 with transactional rollback. These six routes do not use object storage; statement generation's storage-failure path is covered separately. Existing four manual creation routes gain atomic detection; direct event-chain edit/delete refuses; grid/initial/profile/detail readers expose the new flags/events.

Screens: Customer → Retainers; Transactions → Possible duplicates (`/transactions/possibleDuplicates`); shared financial grid badges; Create Invoice event-count/zero-value selection; frozen invoice retainer detail. Frontend component tests cover success/refusal, confirmation, refresh, stale customer selection, exhausted balances, validation and locked/missing records. API scenarios use the real local database and MinIO. No new browser click-through session was performed and no running local server was restarted.

## Executed validation

All commands ran serially, with every integration file in a separate process. **0 failures and 0 pending/skipped tests in the final results.** Scenario and clean-room counts below repeat tests also counted in the all-integration run; do not add them as unique cases.

| Check | Final observed result |
|---|---:|
| Backend unit command | 1,027 passing |
| All integration files, one at a time | 1,995 passing across 61 files |
| Dedicated `npm run -s test:scenarios` | 838 passing |
| Dedicated `npm run -s test:cleanroom` | 18 passing |
| Drift: engine vs Account Audit | 0 differences across 319 active customers |
| Drift: billed engine vs AR | 0 differences across 320 customers, including inactive AR debt |
| Frontend Jest | 148 passing across 34 suites |
| Frontend production build | Passed (`Compiled successfully`) |
| New retainer-event integration file | 24 passing |
| New duplicate integration file | 23 passing |
| PDF visual verification | 2-page Letter customer statement and 2-page A3 invoice, maximum-length reason, all pages inspected |

Commands were the owner's specified forms. Unit and ordinary integrations use `.env.local`; scenario files use `.env.scenarios` to satisfy their sandbox guard, and clean-room uses `.env.clean`. The two account-provisioning files are explicitly forced to `DATABASE_NAME=ds2_clean` in both the runner and test bootstrap. Frontend Jest adds `--runInBand` to keep workers serial. Final per-command arguments, environment overrides, exit codes and exact counts are in [acceptance/results.json](evidence/run-2/acceptance/results.json), with matching logs beside it. [Drift summary](evidence/run-2/drift-summary.json) omits customer names; the full requested output remains `/tmp/drift.json`.

The [hand oracle](../scenarios/10-owner-retainers-duplicates.md) follows a $500 retainer, $120 draw, $80 refund, $50 increase and $30 decrease: **$320 available, $120 drawn, $0 debt**. Full refund prints at zero availability; two racing $40 refunds against $50 yield one success and $10 remaining. A draw/refund race cannot consume the same funds twice. Duplicate work falls $200→$100; issued $1,000 debt less two $100 receipts goes $800→$900 when the duplicate receipt is removed; duplicate $20 write-offs go next debt $860→$880; two $200 retainers become one without changing debt. Tests compare Create Invoice, Account Audit, AR and available credit after each relevant step.

Refusal tests hash financial and evidence tables before/after. Fault injection covers rejected and suppressed snapshot/journal/flag/history writes, source deletion, reopening/resolution and all four creation hooks. Original archived bytes and issued rows are compared unchanged. A refund during invoice upload rejects stale finalize without posting an invoice; retry prints the event. PDF text checks and visual page inspection verify full reasons, continuation headers, one printed event amount and final totals. Test logs include expected injected failures; they are not suite failures. Frontend logs also retain React test/deprecation warnings and a Node toolchain deprecation warning. PDF artifact hashes/page counts are recorded in [pdf-qa.json](evidence/run-2/pdf-qa.json). The final documentation link check found [zero broken relative paths](evidence/run-2/document-links.json).

## Deliberate behavior changes

- Direct retainer edit/delete can no longer rewrite a chain with event evidence. Correct it through a new refund/adjustment event. Legacy unissued chains without events retain their existing edit rules; sent locks remain unchanged.
- Duplicate detection adds advisory state to successful manual creation. If saving audit evidence fails, the entire creation rolls back. Scan/dismiss do not change money. Removing a duplicate respects normal chronology/dependency rules and can refuse even when the source itself is unsent.
- A review cannot delete a source edited since detection. Dismiss and explicitly reflag the current entry; an edited resolved candidate can reopen the review with another immutable history entry. Repeated unchanged reviews and repeated resolutions still refuse.
- Event-only zero-dollar statements remain visible/eligible, including after a full refund. This does not implement decision 2's optional negative-statement processing.
- Existing tests were updated, not dropped: retainer result shape includes `events`; finalize fingerprint expects six tables; scenario snapshots/maintenance include the new journals; selection tests preserve event-only rows. The added tests retain prior lock, CRUD, arithmetic, race and failure coverage. Minutes and six-minute ingestion rounding are unchanged.

## Local data boundary and corrected test-runner mistake

All database/storage access stayed on local PostgreSQL :5433 and MinIO :9000; no AWS/production connections, git commands, commits or server start/stop actions occurred. The reference database was used only for the explicitly requested SELECT count comparison, with `default_transaction_read_only=on`.

**A run2 acceptance-runner mistake violated the narrower account-9001 write allowance:** `coverage-account-users-auth-misc` and `review-account-atomicity` initially ran against ds2_local and provisioned temporary accounts outside 9001. Their normal teardown removed those accounts. The runner was stopped when the omission was identified; test/setup.js now forces both specs to ds2_clean, even with the owner's ordinary .env.local command, and rejects a non-loopback/non-5433 host. Both files passed there on rerun. The final read-only check found **no accounts other than 1 and 9001** in ds2_local. Account ID sequences were consumed and were not rewound. This was local temporary account creation, not production access or an account-1 business-data write.

The seven required account-1 row counts match the pre-acceptance snapshot and ds2_ref_20260922 exactly; the new journals have zero account-1 rows. Evidence: [account-1-final.json](evidence/run-2/account-1-final.json).

| Account-1 table | Before = after = reference |
|---|---:|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

## Remaining scope

No unresolved business question blocks decisions 1/4. Decision 2 (optional credit invoices) and decision 6 (account-wide who/what/when/before/after ledger plus printable immutable record) remain for run 3. Sent duplicate work/write-offs/retainers cannot be deleted; the current exception workflow supports selected bounced payments only. Additional correction conditions need a separately defined workflow. Production rollout and historical archive reconciliation remain operator work, not performed here.

## Integration file counts

Every row below passed with zero failures and zero pending tests; each file ran alone. Full logs are linked by filename.

| Integration spec | Passing |
|---|---:|
| [analytics.integration.spec.js](evidence/run-2/acceptance/analytics.integration.spec.log) | 11 |
| [billing-regression.integration.spec.js](evidence/run-2/acceptance/billing-regression.integration.spec.log) | 2 |
| [cascade-edit-recompute.integration.spec.js](evidence/run-2/acceptance/cascade-edit-recompute.integration.spec.log) | 11 |
| [clean-room-regression.integration.spec.js](evidence/run-2/acceptance/clean-room-regression.integration.spec.log) | 18 |
| [coverage-account-users-auth-misc.integration.spec.js](evidence/run-2/acceptance/coverage-account-users-auth-misc.integration.spec.log) | 200 |
| [coverage-billing-review.integration.spec.js](evidence/run-2/acceptance/coverage-billing-review.integration.spec.log) | 31 |
| [coverage-downloads-authz.integration.spec.js](evidence/run-2/acceptance/coverage-downloads-authz.integration.spec.log) | 36 |
| [coverage-invoices-audit-ar-analytics.integration.spec.js](evidence/run-2/acceptance/coverage-invoices-audit-ar-analytics.integration.spec.log) | 131 |
| [coverage-jobs-masterdata.integration.spec.js](evidence/run-2/acceptance/coverage-jobs-masterdata.integration.spec.log) | 124 |
| [coverage-payments-pending.integration.spec.js](evidence/run-2/acceptance/coverage-payments-pending.integration.spec.log) | 102 |
| [coverage-pending-payments-authz.integration.spec.js](evidence/run-2/acceptance/coverage-pending-payments-authz.integration.spec.log) | 10 |
| [coverage-timetracking-timesheets.integration.spec.js](evidence/run-2/acceptance/coverage-timetracking-timesheets.integration.spec.log) | 106 |
| [coverage-transactions-retainers-writeoffs.integration.spec.js](evidence/run-2/acceptance/coverage-transactions-retainers-writeoffs.integration.spec.log) | 84 |
| [finalize-engine.integration.spec.js](evidence/run-2/acceptance/finalize-engine.integration.spec.log) | 15 |
| [finalize-snapshot.integration.spec.js](evidence/run-2/acceptance/finalize-snapshot.integration.spec.log) | 9 |
| [month-end-lifecycle.integration.spec.js](evidence/run-2/acceptance/month-end-lifecycle.integration.spec.log) | 19 |
| [orchestrator.integration.spec.js](evidence/run-2/acceptance/orchestrator.integration.spec.log) | 7 |
| [payment-reversal.integration.spec.js](evidence/run-2/acceptance/payment-reversal.integration.spec.log) | 49 |
| [pii-leak.integration.spec.js](evidence/run-2/acceptance/pii-leak.integration.spec.log) | 2 |
| [review-account-atomicity.integration.spec.js](evidence/run-2/acceptance/review-account-atomicity.integration.spec.log) | 4 |
| [review-analytics-identities.integration.spec.js](evidence/run-2/acceptance/review-analytics-identities.integration.spec.log) | 2 |
| [review-audit-download.integration.spec.js](evidence/run-2/acceptance/review-audit-download.integration.spec.log) | 4 |
| [review-audit-filter.integration.spec.js](evidence/run-2/acceptance/review-audit-filter.integration.spec.log) | 3 |
| [review-customer-delete.integration.spec.js](evidence/run-2/acceptance/review-customer-delete.integration.spec.log) | 4 |
| [review-customer-recurring.integration.spec.js](evidence/run-2/acceptance/review-customer-recurring.integration.spec.log) | 8 |
| [review-customer-response.integration.spec.js](evidence/run-2/acceptance/review-customer-response.integration.spec.log) | 2 |
| [review-initial-data-roles.integration.spec.js](evidence/run-2/acceptance/review-initial-data-roles.integration.spec.log) | 18 |
| [review-invoice-outcomes.integration.spec.js](evidence/run-2/acceptance/review-invoice-outcomes.integration.spec.log) | 4 |
| [review-job-family.integration.spec.js](evidence/run-2/acceptance/review-job-family.integration.spec.log) | 4 |
| [review-job-selection.integration.spec.js](evidence/run-2/acceptance/review-job-selection.integration.spec.log) | 2 |
| [review-pending-files.integration.spec.js](evidence/run-2/acceptance/review-pending-files.integration.spec.log) | 7 |
| [review-rate-agreements.integration.spec.js](evidence/run-2/acceptance/review-rate-agreements.integration.spec.log) | 10 |
| [review-related-ids.integration.spec.js](evidence/run-2/acceptance/review-related-ids.integration.spec.log) | 24 |
| [review-retainer-dates.integration.spec.js](evidence/run-2/acceptance/review-retainer-dates.integration.spec.log) | 1 |
| [review-statement-snapshot.integration.spec.js](evidence/run-2/acceptance/review-statement-snapshot.integration.spec.log) | 1 |
| [review-template-storage.integration.spec.js](evidence/run-2/acceptance/review-template-storage.integration.spec.log) | 1 |
| [review-tracker-outcome.integration.spec.js](evidence/run-2/acceptance/review-tracker-outcome.integration.spec.log) | 1 |
| [review-transaction-policy.integration.spec.js](evidence/run-2/acceptance/review-transaction-policy.integration.spec.log) | 22 |
| [review-user-guards.integration.spec.js](evidence/run-2/acceptance/review-user-guards.integration.spec.log) | 7 |
| [scenario-lifecycle-01-work.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-01-work.integration.spec.log) | 13 |
| [scenario-lifecycle-02-retainers.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-02-retainers.integration.spec.log) | 9 |
| [scenario-lifecycle-03-payments.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-03-payments.integration.spec.log) | 7 |
| [scenario-lifecycle-04-writeoffs.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-04-writeoffs.integration.spec.log) | 6 |
| [scenario-lifecycle-05-monthend.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-05-monthend.integration.spec.log) | 7 |
| [scenario-lifecycle-06-cascade.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-06-cascade.integration.spec.log) | 9 |
| [scenario-lifecycle-07-refusals.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-07-refusals.integration.spec.log) | 122 |
| [scenario-lifecycle-08-failures.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-08-failures.integration.spec.log) | 24 |
| [scenario-lifecycle-09-state-boundaries.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-09-state-boundaries.integration.spec.log) | 21 |
| [scenario-lifecycle-10-integrity.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-10-integrity.integration.spec.log) | 22 |
| [scenario-lifecycle-11-finalize-races.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-11-finalize-races.integration.spec.log) | 15 |
| [scenario-lifecycle-12-sent-exceptions.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-12-sent-exceptions.integration.spec.log) | 72 |
| [scenario-lifecycle-13-retainer-events.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-13-retainer-events.integration.spec.log) | 24 |
| [scenario-lifecycle-14-duplicates.integration.spec.js](evidence/run-2/acceptance/scenario-lifecycle-14-duplicates.integration.spec.log) | 23 |
| [scenario-what-if-01-values.integration.spec.js](evidence/run-2/acceptance/scenario-what-if-01-values.integration.spec.log) | 308 |
| [scenario-what-if-02-retries.integration.spec.js](evidence/run-2/acceptance/scenario-what-if-02-retries.integration.spec.log) | 23 |
| [scenario-what-if-03-history.integration.spec.js](evidence/run-2/acceptance/scenario-what-if-03-history.integration.spec.log) | 25 |
| [scenario-what-if-04-calendar-races.integration.spec.js](evidence/run-2/acceptance/scenario-what-if-04-calendar-races.integration.spec.log) | 13 |
| [scenario-what-if-05-csv.integration.spec.js](evidence/run-2/acceptance/scenario-what-if-05-csv.integration.spec.log) | 13 |
| [scenario-what-if-06-boundaries.integration.spec.js](evidence/run-2/acceptance/scenario-what-if-06-boundaries.integration.spec.log) | 82 |
| [tracker-excel-end-to-end.integration.spec.js](evidence/run-2/acceptance/tracker-excel-end-to-end.integration.spec.log) | 33 |
| [transactions-ledger-seams.integration.spec.js](evidence/run-2/acceptance/transactions-ledger-seams.integration.spec.log) | 28 |
