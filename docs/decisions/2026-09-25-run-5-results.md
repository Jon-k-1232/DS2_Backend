# DS2 owner decisions — run 5 readable Audit Record

Implemented locally on 2026-09-25. **Drafts remain editable; finalize means sent and locked.** Jon's confirmed rule and the run-4 capture, account chain, immutable guards and rolling financial replay remain unchanged.

## Built

- **Client record**, the default print option, and **Full evidence record** on the existing Admin/Super Admin client-profile Audit Record tab. The chosen type appears in immutable metadata, PDF title and printed-record list. Existing stored PDFs retain their exact bytes and are classified as full evidence.
- A server presentation shared by the tab and PDFs: business postings, original actor names, human record labels and field names, before/after changes, reasons, receipt/check numbers, retainer activity, issuance, bounced-check reversals and duplicate removal. The ledger groups whole database transactions and aligns money headings exactly with their right-aligned values.
- USD `$1,234.56`, signed credits `-$1,234.56`, positive Debit/Credit magnitudes and positive available retainer funds in the client view. No financial pricing, rounding or balance calculation changed. Full evidence retains stored signed values with human field names.
- One human entry for each captured row change, grouped by posting, with explicit coverage of displayed business fields and omitted supporting fields. Snapshots are short business descriptions. Technical identifiers, storage paths, request IDs and structured payloads stay out of the client view.
- A separate immutable JSON source archive for **each new print**, including exact source events, before/after values, field changes, metadata and reconstruction data. Full evidence prints type, byte length, SHA-256 and precise JSON Pointer for structured/large values. Both PDFs contain the source-archive digest and authenticated retrieval route.

Migration **027.audit_record_presentations.sql** was applied by hand with `psql -X -1 -v ON_ERROR_STOP=1 -f` to ds2_local, ds2_clean and ds2_scenarios at 127.0.0.1:5433. It adds record type and source-archive identity/digest/length with constraints and a unique index. No business data or event-hash rewrite. The numbered-migration count is 26 (002–027), with a new migration spec. Scenario and clean-room resets automatically include it. [Application log](evidence/run-5/acceptance/migration-027-apply.log).

## API and storage

Existing audit routes remain, with new presentation/coverage on history, type/archive metadata on listing, `recordType` on printing and archive integrity on verification. The single new route is:

`GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/evidence`

It returns the exact saved JSON bytes only after key identity, SHA-256, length, account chain and retained anchor verification. It has the same Admin/Super Admin and tenant guards, private/no-store caching, and `X-Evidence-SHA256`. It writes nothing. A legacy record without an archive returns 404, while its existing PDF still verifies and reopens.

PDF and JSON use unique UUID keys and conditional create-only writes. Failure publishes no record metadata or financial changes; failed upload/metadata creation can leave an unreferenced unique object, as documented. Reopening never regenerates either artifact. Future production rollout, archive retention and smoke tests are documented in operations.md and FINAL_REPORT section 6; no production rollout occurred.

## Evidence and acceptance

Tests ran one process at a time. All 65 integration files ran separately; scenario files used .env.scenarios, clean-room used .env.clean, and the remaining suites used the instructed .env.local fixture scope (provisioning is redirected to ds2_clean by the existing test guard).

| Check | Final result |
|---|---|
| Backend unit | **1,067 passing, 0 failing, 0 pending** |
| Every integration file, serial | **2,052 passing / 65 files, 0 failing, 0 pending** |
| Dedicated scenarios | **895 passing / 24 files, 0 failing, 0 pending** |
| Dedicated clean-room | **18 passing, 0 failing** |
| Drift | **0 differences**; Audit/engine 319 customers; engine/AR 320 including inactive |
| Frontend Jest | **184 tests / 40 suites passing** |
| Frontend CI build | **Compiled successfully** |
| Final SQL integrity | **All account chains valid in all three allowed databases; 33 capture tables each; immutable record guard enabled** |

The dedicated scenario and clean-room runs repeat integration coverage; these are not additional unique tests. Final evidence: [counts](evidence/run-5/acceptance/suite-counts.json), [unit](evidence/run-5/acceptance/unit.log), [scenarios](evidence/run-5/acceptance/scenarios.log), [clean-room](evidence/run-5/acceptance/cleanroom.log), [drift](evidence/run-5/acceptance/drift-summary.json), [frontend Jest](evidence/run-5/acceptance/frontend-jest.log), [build](evidence/run-5/acceptance/frontend-build.log), [database integrity](evidence/run-5/acceptance/final-database-integrity.json).

### Final sample documents and visual review

- [Client record](evidence/run-5/client-record.pdf): **6 pages**, all **22 postings / 89 captured changes / 906 source-field changes** accounted for. 237 business values are displayed; 669 supporting fields are explicitly retained in the evidence archive. PDF text includes every human entry and displayed field, with no raw JSON or internal table names. [Metadata](evidence/run-5/client-record.json), [exact source archive](evidence/run-5/client-record.evidence.json).
- [Full evidence record](evidence/run-5/full-evidence-record.pdf): **13 pages**, compact technical evidence with human field names, actor IDs, per-change money effects and structured-payload retrieval descriptors. Its later snapshot additionally records printing/reopening/profile-change proof: **27 postings / 94 changes / 943 fields**. [Metadata](evidence/run-5/full-evidence-record.json), [exact source archive](evidence/run-5/full-evidence-record.evidence.json).

Every page of both final PDFs was rendered with Poppler and visually inspected. Headings align over values; text and hashes flow within margins; closing position/verification are readable; all page numbers are present. Exact PDF/source hashes and page checks are in [visual review](evidence/run-5/acceptance/pdf-visual-review.json). Source and PDF byte-identical reopening, source digest headers and local create-only refusal (HTTP 412) are tested. Samples are retained before disposable database resets; their sample API IDs may no longer exist after a later reset. Normal application records are never reset or rerendered.

Visual QA caught and fixed a monetary-format classifier matching “rate” inside “generated”; actor IDs now remain plain numbers, with a regression covering both generated-by and total-minute fields. The final complete validation ran after that fix. The older run-4 sample PDF/metadata is replaced by these two samples; historical acceptance logs remain.

### Protected account 1

Live ds2_local account-1 row counts match both the run-start counts and the **retained ds2_ref_20260922 reference counts**. The reference database was never connected to during run 5. This is an explicit comparison with recorded reference evidence, not a fresh reference query. There are **0 account-1 audit events**. [Comparison evidence](evidence/run-5/acceptance/protected-account-counts.json).

| Table | Live / recorded reference | Unchanged |
|---|---:|---|
| customers | 338 / 338 | Yes |
| customer_transactions | 39,052 / 39,052 | Yes |
| customer_payments | 1,005 / 1,005 | Yes |
| customer_writeoffs | 657 / 657 | Yes |
| customer_invoices | 2,253 / 2,253 | Yes |
| timesheet_entries | 28,255 / 28,255 | Yes |
| users | 23 / 23 | Yes |


## Behavior changes and retained coverage

Run-4 raw table/column/payload presentation is replaced by business descriptions. Prior raw PDF/UI assertions now assert human fields; all original capture, actor, chain, rollback, tenant, role, financial lifecycle, PDF digest and byte-identical reopening tests remain. New tests cover every event/field against database evidence, PDF completeness, no raw JSON/internal table names, the six-page client target, both print options, payload retrieval, write-once source storage, archive tampering and legacy archive absence. Long descriptions have a pagination regression.

The scenario's hand oracle remains work100→120; funded work50/draw50 leaves120 debt/50 available; write-off20 leaves100; refund10/adjustment+5 leaves45 available; finalized100 then check30 gives70; finalized bounced-check reversal restores100; duplicate10+10 minus removed10 leaves **110 debt = 100 billed + 10 unbilled**, and **45 retainer available**. Issuance never charges a second time.

## Boundaries and open questions

No open business decision was introduced. The record can show only historical names/edits that were captured; pre-logging evidence is explicitly reconstructed. Database owners can still disable guards, so the existing production role/retention requirements remain. Local fixture samples use synthetic customers.

No git command, commit, AWS/production connection or local-server start/stop was performed. ds2_ref_20260922 remains unconnected; the requested comparison uses its retained reference-count evidence. The validation exercises the checkout directly. Existing long-running servers were not refreshed or certified as running these changes.

## Per-file integration results

| File | Passing | Failing | Pending |
|---|---:|---:|---:|
| [analytics.integration.spec.js](evidence/run-5/acceptance/analytics.integration.spec.log) | 11 | 0 | 0 |
| [billing-regression.integration.spec.js](evidence/run-5/acceptance/billing-regression.integration.spec.log) | 2 | 0 | 0 |
| [cascade-edit-recompute.integration.spec.js](evidence/run-5/acceptance/cascade-edit-recompute.integration.spec.log) | 11 | 0 | 0 |
| [clean-room-regression.integration.spec.js](evidence/run-5/acceptance/clean-room-regression.integration.spec.log) | 18 | 0 | 0 |
| [coverage-account-users-auth-misc.integration.spec.js](evidence/run-5/acceptance/coverage-account-users-auth-misc.integration.spec.log) | 200 | 0 | 0 |
| [coverage-billing-review.integration.spec.js](evidence/run-5/acceptance/coverage-billing-review.integration.spec.log) | 31 | 0 | 0 |
| [coverage-downloads-authz.integration.spec.js](evidence/run-5/acceptance/coverage-downloads-authz.integration.spec.log) | 36 | 0 | 0 |
| [coverage-invoices-audit-ar-analytics.integration.spec.js](evidence/run-5/acceptance/coverage-invoices-audit-ar-analytics.integration.spec.log) | 131 | 0 | 0 |
| [coverage-jobs-masterdata.integration.spec.js](evidence/run-5/acceptance/coverage-jobs-masterdata.integration.spec.log) | 124 | 0 | 0 |
| [coverage-payments-pending.integration.spec.js](evidence/run-5/acceptance/coverage-payments-pending.integration.spec.log) | 102 | 0 | 0 |
| [coverage-pending-payments-authz.integration.spec.js](evidence/run-5/acceptance/coverage-pending-payments-authz.integration.spec.log) | 10 | 0 | 0 |
| [coverage-timetracking-timesheets.integration.spec.js](evidence/run-5/acceptance/coverage-timetracking-timesheets.integration.spec.log) | 106 | 0 | 0 |
| [coverage-transactions-retainers-writeoffs.integration.spec.js](evidence/run-5/acceptance/coverage-transactions-retainers-writeoffs.integration.spec.log) | 84 | 0 | 0 |
| [finalize-engine.integration.spec.js](evidence/run-5/acceptance/finalize-engine.integration.spec.log) | 15 | 0 | 0 |
| [finalize-snapshot.integration.spec.js](evidence/run-5/acceptance/finalize-snapshot.integration.spec.log) | 9 | 0 | 0 |
| [month-end-lifecycle.integration.spec.js](evidence/run-5/acceptance/month-end-lifecycle.integration.spec.log) | 19 | 0 | 0 |
| [orchestrator.integration.spec.js](evidence/run-5/acceptance/orchestrator.integration.spec.log) | 7 | 0 | 0 |
| [payment-reversal.integration.spec.js](evidence/run-5/acceptance/payment-reversal.integration.spec.log) | 49 | 0 | 0 |
| [pii-leak.integration.spec.js](evidence/run-5/acceptance/pii-leak.integration.spec.log) | 2 | 0 | 0 |
| [review-account-atomicity.integration.spec.js](evidence/run-5/acceptance/review-account-atomicity.integration.spec.log) | 4 | 0 | 0 |
| [review-analytics-identities.integration.spec.js](evidence/run-5/acceptance/review-analytics-identities.integration.spec.log) | 2 | 0 | 0 |
| [review-audit-download.integration.spec.js](evidence/run-5/acceptance/review-audit-download.integration.spec.log) | 4 | 0 | 0 |
| [review-audit-filter.integration.spec.js](evidence/run-5/acceptance/review-audit-filter.integration.spec.log) | 3 | 0 | 0 |
| [review-customer-delete.integration.spec.js](evidence/run-5/acceptance/review-customer-delete.integration.spec.log) | 4 | 0 | 0 |
| [review-customer-recurring.integration.spec.js](evidence/run-5/acceptance/review-customer-recurring.integration.spec.log) | 8 | 0 | 0 |
| [review-customer-response.integration.spec.js](evidence/run-5/acceptance/review-customer-response.integration.spec.log) | 2 | 0 | 0 |
| [review-initial-data-roles.integration.spec.js](evidence/run-5/acceptance/review-initial-data-roles.integration.spec.log) | 18 | 0 | 0 |
| [review-invoice-outcomes.integration.spec.js](evidence/run-5/acceptance/review-invoice-outcomes.integration.spec.log) | 4 | 0 | 0 |
| [review-job-family.integration.spec.js](evidence/run-5/acceptance/review-job-family.integration.spec.log) | 4 | 0 | 0 |
| [review-job-selection.integration.spec.js](evidence/run-5/acceptance/review-job-selection.integration.spec.log) | 2 | 0 | 0 |
| [review-pending-files.integration.spec.js](evidence/run-5/acceptance/review-pending-files.integration.spec.log) | 7 | 0 | 0 |
| [review-rate-agreements.integration.spec.js](evidence/run-5/acceptance/review-rate-agreements.integration.spec.log) | 10 | 0 | 0 |
| [review-related-ids.integration.spec.js](evidence/run-5/acceptance/review-related-ids.integration.spec.log) | 24 | 0 | 0 |
| [review-retainer-dates.integration.spec.js](evidence/run-5/acceptance/review-retainer-dates.integration.spec.log) | 1 | 0 | 0 |
| [review-statement-snapshot.integration.spec.js](evidence/run-5/acceptance/review-statement-snapshot.integration.spec.log) | 1 | 0 | 0 |
| [review-template-storage.integration.spec.js](evidence/run-5/acceptance/review-template-storage.integration.spec.log) | 1 | 0 | 0 |
| [review-tracker-outcome.integration.spec.js](evidence/run-5/acceptance/review-tracker-outcome.integration.spec.log) | 1 | 0 | 0 |
| [review-transaction-policy.integration.spec.js](evidence/run-5/acceptance/review-transaction-policy.integration.spec.log) | 22 | 0 | 0 |
| [review-user-guards.integration.spec.js](evidence/run-5/acceptance/review-user-guards.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-01-work.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-01-work.integration.spec.log) | 13 | 0 | 0 |
| [scenario-lifecycle-02-retainers.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-02-retainers.integration.spec.log) | 9 | 0 | 0 |
| [scenario-lifecycle-03-payments.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-03-payments.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-04-writeoffs.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-04-writeoffs.integration.spec.log) | 6 | 0 | 0 |
| [scenario-lifecycle-05-monthend.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-05-monthend.integration.spec.log) | 7 | 0 | 0 |
| [scenario-lifecycle-06-cascade.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-06-cascade.integration.spec.log) | 9 | 0 | 0 |
| [scenario-lifecycle-07-refusals.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-07-refusals.integration.spec.log) | 122 | 0 | 0 |
| [scenario-lifecycle-08-failures.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-08-failures.integration.spec.log) | 24 | 0 | 0 |
| [scenario-lifecycle-09-state-boundaries.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-09-state-boundaries.integration.spec.log) | 21 | 0 | 0 |
| [scenario-lifecycle-10-integrity.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-10-integrity.integration.spec.log) | 22 | 0 | 0 |
| [scenario-lifecycle-11-finalize-races.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-11-finalize-races.integration.spec.log) | 15 | 0 | 0 |
| [scenario-lifecycle-12-sent-exceptions.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-12-sent-exceptions.integration.spec.log) | 72 | 0 | 0 |
| [scenario-lifecycle-13-retainer-events.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-13-retainer-events.integration.spec.log) | 24 | 0 | 0 |
| [scenario-lifecycle-14-duplicates.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-14-duplicates.integration.spec.log) | 23 | 0 | 0 |
| [scenario-lifecycle-15-credit-statements.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-15-credit-statements.integration.spec.log) | 11 | 0 | 0 |
| [scenario-lifecycle-16-owner-combined.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-16-owner-combined.integration.spec.log) | 4 | 0 | 0 |
| [scenario-lifecycle-17-time-boundaries.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-17-time-boundaries.integration.spec.log) | 10 | 0 | 0 |
| [scenario-lifecycle-18-audit-record.integration.spec.js](evidence/run-5/acceptance/scenario-lifecycle-18-audit-record.integration.spec.log) | 32 | 0 | 0 |
| [scenario-what-if-01-values.integration.spec.js](evidence/run-5/acceptance/scenario-what-if-01-values.integration.spec.log) | 308 | 0 | 0 |
| [scenario-what-if-02-retries.integration.spec.js](evidence/run-5/acceptance/scenario-what-if-02-retries.integration.spec.log) | 23 | 0 | 0 |
| [scenario-what-if-03-history.integration.spec.js](evidence/run-5/acceptance/scenario-what-if-03-history.integration.spec.log) | 25 | 0 | 0 |
| [scenario-what-if-04-calendar-races.integration.spec.js](evidence/run-5/acceptance/scenario-what-if-04-calendar-races.integration.spec.log) | 13 | 0 | 0 |
| [scenario-what-if-05-csv.integration.spec.js](evidence/run-5/acceptance/scenario-what-if-05-csv.integration.spec.log) | 13 | 0 | 0 |
| [scenario-what-if-06-boundaries.integration.spec.js](evidence/run-5/acceptance/scenario-what-if-06-boundaries.integration.spec.log) | 82 | 0 | 0 |
| [tracker-excel-end-to-end.integration.spec.js](evidence/run-5/acceptance/tracker-excel-end-to-end.integration.spec.log) | 33 | 0 | 0 |
| [transactions-ledger-seams.integration.spec.js](evidence/run-5/acceptance/transactions-ledger-seams.integration.spec.log) | 28 | 0 | 0 |

## Run 6 follow-up

[Run 6](2026-09-25-run-6-results.md) keeps this implementation and its archived evidence. The client PDF and tab now summarize statement copies with exact coverage counts and give plain verification instructions. Full evidence keeps its itemization and API paths. No migration, route handler, capture, digest protocol, storage or financial behavior changes. The run-6 report records the new samples, every-page visual review and complete sequential validation.
