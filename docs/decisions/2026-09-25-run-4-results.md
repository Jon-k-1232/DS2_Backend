# DS2 owner decision 6 — run 4 implementation and acceptance

Completed locally on 2026-09-25. Evidence refreshed 2026-09-25T10:53:46.035426+00:00. The [owner design record](2026-09-24-owner-decisions.md) remains authoritative. **Drafts stay editable and write nothing to the ledger; finalize means sent and locked.** The owner's confirmation is preserved.

## Built

- Append-only, per-account SHA-256 audit chains capture INSERT/UPDATE/DELETE on 33 customer, work, financial, invoice, retainer, duplicate, import and evidence tables. UTC event time, original actor name/ID, tenant/customer, before/after fields, reason, source and request correlation are retained. SQL scripts/imports also trigger capture; absent request actors are recorded as system with their source.
- One central PostgreSQL/Knex execution boundary supplies transaction-local authenticated context, including legacy one-statement writes. Concurrent actors stay isolated. Account audit locks precede business-row locks; read-only snapshots remain nonblocking and savepoint rollback reacquires released locks. Automatic tracker ingestion uses its system source. Business changes and evidence roll back together.
- Admin/Super Admin **Audit Record** tab at the client profile's `auditRecord` route, next to and separate from **AI Audit**. It displays debit/credit activity, retainer changes, issued invoice totals, running balance, actors and before/after changes; date filtering and independent history/printed-record pagination are included. Its route guard is documented; every API independently enforces role and tenant scope.
- Deterministic history replays complete database transactions using the established rolling-balance arithmetic. Pre-activation evidence is reconstructed from existing rows with explicit limitations and unknown actors where not recorded. Deleted customer evidence remains accessible through its scoped API identity.
- **Account history and audit record** PDF: firm/customer/range/generator/Phoenix time, ledger, invoices, full change log, record UUID, digest and chain anchor. Each new print creates unique immutable metadata and a conditional create-only storage key. Reopening returns the same stored bytes after later account changes. Verification checks both document hashes and the retained chain anchor. Invoice archive downloads now also log reprint actions.

No model supplies this record, its calculations or its PDF.

## Migration and route inventory

**026.audit_ledger.sql** was applied by hand with `psql -X -1 -v ON_ERROR_STOP=1 -f` to **ds2_local, ds2_clean and ds2_scenarios**, all at 127.0.0.1:5433. It adds audit_events, audit_chain_heads, audit_policy, audit_records and audit_actions, history indexes, capture functions and immutable guards. There is no business-row backfill; reruns preserve activation and evidence. Migration runner count is 25 numbered files (002–026); the scenario reset includes 026. Clean-room reset rebuilds only its disposable schema instead of truncating protected evidence. See [migration output](evidence/run-4/acceptance/migration-026-apply.log) and [final database integrity](evidence/run-4/acceptance/final-database-integrity.json).

Base: `/auditRecord/customer/:customerID/:accountID/:userID`.

| Method | Suffix | Result |
|---|---|---|
| GET | base | Verified, filtered, paginated history and running balances |
| GET | /verify | Account-chain verification after customer ownership check |
| GET | /records | Immutable printed-record metadata for this customer |
| POST | /records | New full-range PDF snapshot, HTTP 201 |
| GET | /records/:recordID/pdf | Verified exact stored PDF bytes; logged reopening |
| GET | /records/:recordID/verify | Full-file digest, embedded digest, chain and anchor validity |

The existing GET `/invoices/downloadFile/:accountID/:userID` records issued-invoice reopening after storage read and before returning bytes. Failure to record that action returns 500 with no bytes or partial audit actions. Draft exports remain nonposting.

All new routes cover authentication, role/tenant, invalid input, missing/foreign records and database failures. Relevant routes also cover render/storage failures, integrity conflicts, forged storage identity, mismatched anchors and immutable metadata. Refusal assertions compare business rows, evidence, heads and record metadata before/after. A failed post-upload metadata insert can leave an unreferenced unique object; no financial row or published metadata is committed.

## Exact acceptance results

Tests ran one process at a time; all 65 integration files ran separately. Scenario files use .env.scenarios and clean-room uses .env.clean; the remainder use the instructed .env.local fixture scope (account provisioning is redirected by test/setup.js to ds2_clean). These guarded environment selections prevent scenario/clean-room resets against the production-copy database. Concurrent HTTP requests occur only inside explicit race tests.

| Check | Result |
|---|---|
| Backend unit, all test/ except integration | **1,056 passing, 0 failing, 0 pending** |
| Every integration file, serial | **2,048 passing across 65 files, 0 failing, 0 pending** |
| Dedicated `npm run -s test:scenarios` | **891 passing across 24 files, 0 failing, 0 pending** |
| Dedicated `npm run -s test:cleanroom` | **18 passing, 0 failing** |
| Drift | **0 differences**: Account Audit/engine 319 customers; engine/AR 320 including inactive |
| Frontend Jest, CI=true | **183 tests / 40 suites passing**, no failures |
| Frontend `CI=true npm run build` | **Compiled successfully** |
| Final SQL evidence verification | **All retained chains valid in all three allowed databases; 33 capture tables each** |

Migration026 contributes 10 unit tests, the genesis-anchor PDF regression contributes one unit test, and the hard-audit lifecycle contributes 28 integration cases. They are included in the totals above. The dedicated scenario and clean-room runs repeat their integration coverage; do not add them as unique tests. [Machine-readable counts](evidence/run-4/acceptance/suite-counts.json), [unit log](evidence/run-4/acceptance/unit.log), [scenario log](evidence/run-4/acceptance/scenarios.log), [clean-room log](evidence/run-4/acceptance/cleanroom.log), [drift log](evidence/run-4/acceptance/drift.log), [frontend Jest log](evidence/run-4/acceptance/frontend-jest.log), [build log](evidence/run-4/acceptance/frontend-build.log).

The scenario's hand oracle is work100→120; funded work50/draw50 leaves120 debt and50 available; write-off20 leaves100 debt; refund10/adjustment+5 leaves45 available. Finalize locks100; check30 leaves70; finalized bounced-check reversal restores100. Duplicate10+10 then removal10 leaves **110 debt = 100 billed + 10 unbilled**, with **45 retainer available**. Drafts/import queues do not post money. The same PDF reopens byte-identically after later profile changes, and local MinIO refuses overwriting its archived key with HTTP412. See [scenario18](../scenarios/18-audit-record.md).

The run-4 sample was superseded by the run-5 [Client record](evidence/run-5/client-record.pdf) and [Full evidence record](evidence/run-5/full-evidence-record.pdf), with retained source archives and metadata. The earlier 32-page layout is historical; run-5 acceptance and page-by-page visual verification are recorded in [run 5 results](2026-09-25-run-5-results.md).

### Integration files

| File / execution log | Passing | Failing | Pending |
|---|---:|---:|---:|
| [analytics.integration.spec.js](evidence/run-4/acceptance/analytics.integration.spec.log) | 11 | 0 | 0 |
| [billing-regression.integration.spec.js](evidence/run-4/acceptance/billing-regression.integration.spec.log) | 2 | 0 | 0 |
| [cascade-edit-recompute.integration.spec.js](evidence/run-4/acceptance/cascade-edit-recompute.integration.spec.log) | 11 | 0 | 0 |
| [clean-room-regression.integration.spec.js](evidence/run-4/acceptance/clean-room-regression.integration.spec.log) | 18 | 0 | 0 |
| [coverage-account-users-auth-misc.integration.spec.js](evidence/run-4/acceptance/coverage-account-users-auth-misc.integration.spec.log) | 200 | 0 | 0 |
| [coverage-billing-review.integration.spec.js](evidence/run-4/acceptance/coverage-billing-review.integration.spec.log) | 31 | 0 | 0 |
| [coverage-downloads-authz.integration.spec.js](evidence/run-4/acceptance/coverage-downloads-authz.integration.spec.log) | 36 | 0 | 0 |
| [coverage-invoices-audit-ar-analytics.integration.spec.js](evidence/run-4/acceptance/coverage-invoices-audit-ar-analytics.integration.spec.log) | 131 | 0 | 0 |
| [coverage-jobs-masterdata.integration.spec.js](evidence/run-4/acceptance/coverage-jobs-masterdata.integration.spec.log) | 124 | 0 | 0 |
| [coverage-payments-pending.integration.spec.js](evidence/run-4/acceptance/coverage-payments-pending.integration.spec.log) | 102 | 0 | 0 |
| [coverage-pending-payments-authz.integration.spec.js](evidence/run-4/acceptance/coverage-pending-payments-authz.integration.spec.log) | 10 | 0 | 0 |
| [coverage-timetracking-timesheets.integration.spec.js](evidence/run-4/acceptance/coverage-timetracking-timesheets.integration.spec.log) | 106 | 0 | 0 |
| [coverage-transactions-retainers-writeoffs.integration.spec.js](evidence/run-4/acceptance/coverage-transactions-retainers-writeoffs.integration.spec.log) | 84 | 0 | 0 |
| [finalize-engine.integration.spec.js](evidence/run-4/acceptance/finalize-engine.integration.spec.log) | 15 | 0 | 0 |
| [finalize-snapshot.integration.spec.js](evidence/run-4/acceptance/finalize-snapshot.integration.spec.log) | 9 | 0 | 0 |
| [month-end-lifecycle.integration.spec.js](evidence/run-4/acceptance/month-end-lifecycle.integration.spec.log) | 19 | 0 | 0 |
| [orchestrator.integration.spec.js](evidence/run-4/acceptance/orchestrator.integration.spec.log) | 7 | 0 | 0 |
| [payment-reversal.integration.spec.js](evidence/run-4/acceptance/payment-reversal.integration.spec.log) | 49 | 0 | 0 |
| [pii-leak.integration.spec.js](evidence/run-4/acceptance/pii-leak.integration.spec.log) | 2 | 0 | 0 |
| [review-account-atomicity.integration.spec.js](evidence/run-4/acceptance/review-account-atomicity.integration.spec.log) | 4 | 0 | 0 |
| [review-analytics-identities.integration.spec.js](evidence/run-4/acceptance/review-analytics-identities.integration.spec.log) | 2 | 0 | 0 |
| [review-audit-download.integration.spec.js](evidence/run-4/acceptance/review-audit-download.integration.spec.log) | 4 | 0 | 0 |
| [review-audit-filter.integration.spec.js](evidence/run-4/acceptance/review-audit-filter.integration.spec.log) | 3 | 0 | 0 |
| [review-customer-delete.integration.spec.js](evidence/run-4/acceptance/review-customer-delete.integration.spec.log) | 4 | 0 | 0 |
| [review-customer-recurring.integration.spec.js](evidence/run-4/acceptance/review-customer-recurring.integration.spec.log) | 8 | 0 | 0 |
| [review-customer-response.integration.spec.js](evidence/run-4/acceptance/review-customer-response.integration.spec.log) | 2 | 0 | 0 |
| [review-initial-data-roles.integration.spec.js](evidence/run-4/acceptance/review-initial-data-roles.integration.spec.log) | 18 | 0 | 0 |
| [review-invoice-outcomes.integration.spec.js](evidence/run-4/acceptance/review-invoice-outcomes.integration.spec.log) | 4 | 0 | 0 |
| [review-job-family.integration.spec.js](evidence/run-4/acceptance/review-job-family.integration.spec.log) | 4 | 0 | 0 |
| [review-job-selection.integration.spec.js](evidence/run-4/acceptance/review-job-selection.integration.spec.log) | 2 | 0 | 0 |
| [review-pending-files.integration.spec.js](evidence/run-4/acceptance/review-pending-files.integration.spec.log) | 7 | 0 | 0 |
| [review-rate-agreements.integration.spec.js](evidence/run-4/acceptance/review-rate-agreements.integration.spec.log) | 10 | 0 | 0 |
| [review-related-ids.integration.spec.js](evidence/run-4/acceptance/review-related-ids.integration.spec.log) | 24 | 0 | 0 |
| [review-retainer-dates.integration.spec.js](evidence/run-4/acceptance/review-retainer-dates.integration.spec.log) | 1 | 0 | 0 |
| [review-statement-snapshot.integration.spec.js](evidence/run-4/acceptance/review-statement-snapshot.integration.spec.log) | 1 | 0 | 0 |
| [review-template-storage.integration.spec.js](evidence/run-4/acceptance/review-template-storage.integration.spec.log) | 1 | 0 | 0 |
| [review-tracker-outcome.integration.spec.js](evidence/run-4/acceptance/review-tracker-outcome.integration.spec.log) | 1 | 0 | 0 |
| [review-transaction-policy.integration.spec.js](evidence/run-4/acceptance/review-transaction-policy.integration.spec.log) | 22 | 0 | 0 |
| [review-user-guards.integration.spec.js](evidence/run-4/acceptance/review-user-guards.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-01-work.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-01-work.integration.spec.log) | 13 | 0 | 0 |
| [scenario-lifecycle-02-retainers.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-02-retainers.integration.spec.log) | 9 | 0 | 0 |
| [scenario-lifecycle-03-payments.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-03-payments.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-04-writeoffs.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-04-writeoffs.integration.spec.log) | 6 | 0 | 0 |
| [scenario-lifecycle-05-monthend.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-05-monthend.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-06-cascade.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-06-cascade.integration.spec.log) | 9 | 0 | 0 |
| [scenario-lifecycle-07-refusals.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-07-refusals.integration.spec.log) | 122 | 0 | 0 |
| [scenario-lifecycle-08-failures.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-08-failures.integration.spec.log) | 24 | 0 | 0 |
| [scenario-lifecycle-09-state-boundaries.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-09-state-boundaries.integration.spec.log) | 21 | 0 | 0 |
| [scenario-lifecycle-10-integrity.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-10-integrity.integration.spec.log) | 22 | 0 | 0 |
| [scenario-lifecycle-11-finalize-races.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-11-finalize-races.integration.spec.log) | 15 | 0 | 0 |
| [scenario-lifecycle-12-sent-exceptions.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-12-sent-exceptions.integration.spec.log) | 72 | 0 | 0 |
| [scenario-lifecycle-13-retainer-events.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-13-retainer-events.integration.spec.log) | 24 | 0 | 0 |
| [scenario-lifecycle-14-duplicates.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-14-duplicates.integration.spec.log) | 23 | 0 | 0 |
| [scenario-lifecycle-15-credit-statements.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-15-credit-statements.integration.spec.log) | 11 | 0 | 0 |
| [scenario-lifecycle-16-owner-combined.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-16-owner-combined.integration.spec.log) | 4 | 0 | 0 |
| [scenario-lifecycle-17-time-boundaries.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-17-time-boundaries.integration.spec.log) | 10 | 0 | 0 |
| [scenario-lifecycle-18-audit-record.integration.spec.js](evidence/run-4/acceptance/scenario-lifecycle-18-audit-record.integration.spec.log) | 28 | 0 | 0 |
| [scenario-what-if-01-values.integration.spec.js](evidence/run-4/acceptance/scenario-what-if-01-values.integration.spec.log) | 308 | 0 | 0 |
| [scenario-what-if-02-retries.integration.spec.js](evidence/run-4/acceptance/scenario-what-if-02-retries.integration.spec.log) | 23 | 0 | 0 |
| [scenario-what-if-03-history.integration.spec.js](evidence/run-4/acceptance/scenario-what-if-03-history.integration.spec.log) | 25 | 0 | 0 |
| [scenario-what-if-04-calendar-races.integration.spec.js](evidence/run-4/acceptance/scenario-what-if-04-calendar-races.integration.spec.log) | 13 | 0 | 0 |
| [scenario-what-if-05-csv.integration.spec.js](evidence/run-4/acceptance/scenario-what-if-05-csv.integration.spec.log) | 13 | 0 | 0 |
| [scenario-what-if-06-boundaries.integration.spec.js](evidence/run-4/acceptance/scenario-what-if-06-boundaries.integration.spec.log) | 82 | 0 | 0 |
| [tracker-excel-end-to-end.integration.spec.js](evidence/run-4/acceptance/tracker-excel-end-to-end.integration.spec.log) | 33 | 0 | 0 |
| [transactions-ledger-seams.integration.spec.js](evidence/run-4/acceptance/transactions-ledger-seams.integration.spec.log) | 28 | 0 | 0 |

## Protected account 1 and data boundaries

Live account-1 counts in ds2_local match both the run-start counts and the **recorded ds2_ref_20260922 counts** retained by run3. **Run4 never connected to ds2_ref_20260922**, honoring the absolute no-touch instruction; this is not a fresh reference-database query. There are **0 audit events for ds2_local account1**. [Comparison evidence](evidence/run-4/acceptance/protected-account-counts.json).

| Table | ds2_local account1 | Recorded reference | Unchanged |
|---|---:|---:|---|
| customers | 338 | 338 | Yes |
| customer_transactions | 39,052 | 39,052 | Yes |
| customer_payments | 1,005 | 1,005 | Yes |
| customer_writeoffs | 657 | 657 | Yes |
| customer_invoices | 2,253 | 2,253 | Yes |
| timesheet_entries | 28,255 | 28,255 | Yes |
| users | 23 | 23 | Yes |

Only loopback PostgreSQL5433 and MinIO9000 were used. Fixture writes on ds2_local were limited to account9001; clean-room/scenario account1 is synthetic and belongs to those separate databases. No production/AWS connection, git command, commit or server start/stop occurred. Test applications load the checkout directly; existing long-running local servers were not refreshed or certified as running the new code. Frontend verification is Jest plus the CI build, not a claim of a new live browser deployment.

## Changes to old behavior and preserved coverage

- Every audited write now adds immutable evidence; TRUNCATE of those tables is refused. Normal financial edits still follow their existing roles, sent locks and narrow exception rules. Archived statements/PDFs are never overwritten.
- Issued-invoice and audit-record reopen actions now require a successful audit write before bytes are returned. A failure produces no response document.
- The repeated scenario run found a real lock-order deadlock between employee deletion and arriving work. The central helper now takes the account chain lock first. Snapshot/raw-blocker tests were aligned with that order and retain all balance, survivor and refusal assertions. Customer deletion and concurrent Super Admin demotion tests recognize the earlier advisory-lock wait.
- Scenario10's deletion queued after a customer move now reports “Transaction was not found,” because its initial customer-scoped lookup runs after the account lock. Both customers' expected balances and the subsequent authorized deletion remain tested.
- A record-specific PDF digest marker fixes first printing for an account with no captured events: its all-zero genesis anchor is no longer confused with the digest placeholder. The regression also includes zero values in reconstructed content.
- Savepoint rollback clears the helper's cached lock state; its regression proves reacquisition before subsequent work and atomic rollback of attributed events. Actor deletion retains the acting user's name from the deleted row/session snapshot.
- The clean-room test resets its authorized disposable schema instead of trying to truncate the new append-only records. No test coverage was removed. Existing decisions1–5, six-minute pricing/rounding and the owner's finalize=sent confirmation remain unchanged.

## Implementation and documentation

Backend: `migrations/026.audit_ledger.sql`, `src/utils/auditContext.js`, `src/utils/db.js`, `src/app.js`, `src/endpoints/auditRecord/`, `src/endpoints/invoice/invoice-router.js`, `src/endpoints/invoice/sentInvoiceLocks.js`, `src/endpoints/timesheets/auto-ingest-runner.js`, `src/utils/s3.js`.

Frontend: `CustomerProfileAuditRecord.js`, `AuditRecordProtectedAccess.js`, `AuditRecordCalls.js`, and `CustomerProfileSubRoutes.js`; their Jest coverage includes placement, role guard, filters, dates, pagination, printing, exact reopening, verification/error states and stale fetches.

Test support: migration026 spec and runner count, scenario reset, clean-room reset, shared HTTP actor assertions, scenario18 and the adjusted concurrency fixtures. The [audit ledger contract](../platform/audit-ledger.md), [README endpoint index](../README.md#endpoint-index), affected ledger/work/invoicing/platform guides and scenarios are updated. Future production rollout is recorded in [operations](../platform/operations.md) and [FINAL_REPORT section6](../../scripts/review-2026-09/FINAL_REPORT.md).

## Open questions and operational limits

No owner business decision remains open within this run's scope. Production rollout is a separate authorized operation: use a non-owner/non-superuser runtime role, preserve triggers and anchors, and enforce storage retention outside runtime deletion authority. Those production controls were documented, not deployed or tested against AWS.

Pre-logging records cannot prove unrecorded edits, historical names or exact past balances; the reconstruction is labelled accordingly. The PDF explicitly uses a digest-field-zeroed embedded hash because a literal full-file hash cannot self-contain itself; the immutable row/API/UI store the actual final-file SHA-256 and verification checks both. A database superuser could disable guards and rewrite all retained anchors, so independent retention/backups remain necessary. Failed archive publication can leave an unreferenced unique object for later reviewed retention/cleanup; referenced evidence is never deleted.

## Run 5 presentation follow-up

Run 5 preserves capture, chain verification, issued locks, rolling balances and immutable reopening, while replacing the unreadable PDF and tab presentation. It adds two record types, human business postings/field changes, compact payload descriptors and an immutable verified source archive. See [run-5 implementation and full acceptance](2026-09-25-run-5-results.md).
