# Pass 1 execution report

**Current owner-rule update (2026-09-25):** this is a retained dated scenario report/catalogue. The original five decisions are now implemented; optional credit selection, sent locks/corrections, retainer events and duplicate review are governed by the [owner record](../decisions/2026-09-24-owner-decisions.md). See [run3 results](../decisions/2026-09-25-run-3-results.md) and [the combined lifecycle](16-owner-combined.md) for current verification. Decision6 is implemented in [run4](../decisions/2026-09-25-run-4-results.md), with its own [audit history oracle](18-audit-record.md).

Historical pass evidence below predates the owner decisions. Current behavior and complete rerun counts are in [owner run1 results](../decisions/2026-09-24-run-1-results.md); changed oracles are documented in [the design record](../decisions/2026-09-24-owner-decisions.md).

Verified locally: 2026-09-24T22:42:17.220315-07:00. **2,417 passing; 0 failing; 0 pending.** This includes **254 scenario tests across 11 files**, 1,006 unit tests, 1,139 existing integration tests and 18 clean-room tests. Every integration file ran in its own process, one at a time. No git commands or commits were used.

The dedicated scenario database, repeatable reset, catalogue and `npm run test:scenarios` are implemented. Five application defects were reproduced before fixing them. All issued scenario statements were checked through authenticated HTTP, PostgreSQL, local MinIO ZIP/PDF download and `pdftotext`. The checks assert beginning balance, charges, signed payments/write-offs, held retainers, amount due, remaining balance, paid flag, invoice number, CSV fields, PDF lines and amounts, AR aging and saved Account Audit results.

## Scope and scenarios

Expected numbers were written in the [catalogue](README.md) before the corresponding scenarios ran. Later expectation corrections are explicit below and in each group. Each financial transition reconciles Create Invoice next total with saved Account Audit; their billed outstanding component must equal AR. Unbilled work and unused retainers are not AR debt.

| Group | What was exercised | Scenario tests |
|---|---|---:|
| Clients/jobs/work | CRUD, duplicate and ownership refusal, 7/60/61-minute rounding, flat and nonbillable work, internal clients, multiple job families, billed locks | 13 |
| Retainers | Receipt before work, exact draws, excess carried, insufficient funds, reductions before/after use, unused deletion, used/child refusal | 9 |
| Payments | Prepayment, partial/exact/excess receipts, edit/delete, NSF and undo, spent excess, old-statement remapping, manual retainer draws | 7 |
| Write-offs | Job and general credits, shown/hidden statements, linked credits, credit-only and over-credit conditions, billed locks | 6 |
| Month-end | Partial selection, sequential numbers, same-day skip and opt-in rebill, credit skip, rolling balance, all aging buckets, deletion rules | 7 |
| Billing Review | Financial and metadata correction, quantity/rate and explicit override, family/customer moves, paid/absorbed/retainer locks, internal billability | 8 |
| Refusals | Environment guard, authentication/role/tenant matrix, required fields/types/precision/ranges, malformed/missing/foreign identities | 122 |
| Failure injection | PostgreSQL rollback, read errors, precommit storage failure, postcommit export warning, stale snapshot and competing receipts | 24 |
| State boundaries | Older-payment/credit locks, marker injection, ownership moves, one-cent boundary, invalid finalization selections, contact/sequence failures | 21 |
| Legacy integrity | Damaged retainer links, duplicate claims, corrupt ownership, missing roots, cancellation repair guards, queued delete/move races | 22 |
| Finalization races | Job credit/payment dependency guards, invoice-delete races, duplicate finalization/number conflicts, stale work, suppressed database writes | 15 |

## Defects reproduced and fixed

| Defect | Smallest correction | Failing-first and passing regression evidence |
|---|---|---|
| ID-only work deletion incorrectly required full create/update pricing | Delete uses the locked stored row and supplied identity; caller prices cannot reprice an undo. Explicit invalid transaction types still refuse. | W08 in `scenario-lifecycle-01-work`; stale-price control in `07-refusals`; existing 84-test transaction/retainer/write-off suite remains unchanged and passes. |
| Billing Review could turn internal/nonbillable-customer work into billable work | Reuse direct-entry policy under customer locks for customer moves and billability toggles; recompute the final plan after policy. | C08 in `06-cascade` tests both toggles and moves for internal and nonbillable clients. Ordinary metadata edits retain their prior behavior. |
| Malformed Billing Review transaction IDs reached PostgreSQL and returned a database error | Reject nonpositive, malformed and unsafe IDs with `transaction_not_found` before the query. | `07-refusals` malformed, absent and foreign cascade identities; HTTP404 asserted. |
| Retainer updates accepted subcent amounts that rounded to zero | Validate the normalized rounded amount, matching create semantics. | `07-refusals` update40 to0.001 refuses; `09-state-boundaries` accepts0.01, refuses0, and restores40. |
| A client-supplied reversal identity marker survived note/reason sanitization | Include `reversal of payment #N` in fixed-point reserved-link stripping. | `09-state-boundaries`: marker-only reason refuses; create/edit notes lose ordinary and nested forged markers; foreign receipt unchanged; genuine NSF/undo remains covered by payments and the 49-test reversal regression. |

Application edits are captured in [production-fixes.diff](evidence/production-fixes.diff). The Billing Review unit mock gained `groupBy`/`countDistinct` support for the reused policy query. No unit assertion was relaxed. The first broad run exposed that mock limitation (30 failures) and one optional-type delete-contract mismatch; both were corrected before the final full run.

## Expectations corrected, with reasons

- Work replacement leaves five transaction rows, not six: deleting and re-entering the flat charge replaces it. The $385 expectation never changed.
- Valid pending retainer draws intentionally produce the documented `unlinked_payments` diagnostic. Tests now require its exact count, amount and severity, and require it to disappear after stamping; balance difference must remain zero.
- Direct work/job routes are Manager/Admin gated. The initial staff-permission assumption was corrected from the app mounts before the permission cases ran.
- The delete contract retains refusal for an explicitly invalid transaction type while accepting identity-only deletion and ignoring stale prices. The existing invalid-type test remains unchanged.
- An already-applied $20 credit may still appear as `Total Revisions: -20.00 (reflected in invoice balance)` even when its new-statement contribution is zero. The PDF assertion now requires that exact informative line; beginning150 plus new50 still equals200.
- `invoice_missing` is an internal Billing Review reason. Its public response is HTTP409, `invoice_locked`, plus the missing-statement message. The test now asserts those public fields, including unchanged financial rows.
- Error-message assertions follow the first applicable documented guard: an older reversed payment can first fail latest-child ordering; billed receipt edits report attachment to a statement. No money assertion changed to accommodate application output.

## Refusal and failure coverage

The negative matrix covers missing/expired/unknown identity, role denial, account mismatch, absent and foreign rows, wrong-customer relationships, malformed and overprecision money, funded-work conflicts, statement history, storage and database faults. Refusals hash all rows of eight customer/financial tables before and after. Deliberate concurrency is checked against the allowed committed outcome rather than falsely demanding that the competing successful request disappear. Audit records created by reconciliation are excluded from that financial hash.

A V8 review inspected explicit `throw` sites in 11 central lifecycle modules: **181 of 199 sites executed** across the final acceptance/scenario runs. The 18 remaining sites are internal-contract or earlier-guard duplicates; [COVERAGE.md](COVERAGE.md) explains each. This is not a claim of 100% JavaScript branch coverage or proof over every possible input combination. No known reachable refusal in that reviewed inventory remains without a test. Auth/middleware responses and catch handlers are additionally exercised by HTTP suites.

## OPEN business decisions

1. **Refund/reversal of used retainers:** reducing a root preserves applied draws but records no cash-refund event. Decide between an explicit linked refund ledger, an accountant-managed external refund with audited correction, or forbidding financial root edits after issue.
2. **Negative customer balances:** drafts show credit; finalize skips. Decide whether to issue credit statements/memos, maintain an explicit carry-forward credit ledger, or keep pending credits until later work.
3. **Issued PDFs after Billing Review:** live balances change while the original PDF stays unchanged. Decide between immutable original plus adjustment document, versioned regeneration, or prohibiting post-issue financial edits.
4. **Repeated manual submission:** locks serialize requests but there is no idempotency key. Decide whether identical submissions are new events, retriable requests with keys, or a duplicate-review workflow.
5. **NSF on retainer-funded work after billing:** direct reversal is refused and billed draws are locked. Define an accountant-approved reversal/refund workflow; no guessed compensation was added.

## Data isolation and protected-data result

New scenario fixtures exist only in `ds2_scenarios` at `127.0.0.1:5433`, with local MinIO at `127.0.0.1:9000` (`ds2-clean` bucket, unique run keys). The baseline is the schema snapshot through018, migrations019–022 via `psql -X -1 -v ON_ERROR_STOP=1 -f`, and the synthetic clean-room seed. Each scenario file resets that database. The reset helper uses `postgres` only to check/create its validated scenario database. No production or AWS resource was contacted; optional AI was disabled and scenario TCP access rejects non-loopback destinations.

Existing acceptance tests used the authorized local fixture account9001 in `ds2_local`; the established clean-room command used `ds2_clean`. Account1 in `ds2_local` and all of `ds2_ref_20260922` were read only. No local running server was started or stopped by this task. The supplied branch name was not independently queried because git use was prohibited.

| Account-1 table | Before tests | After tests (`ds2_local`) | Reference (`ds2_ref_20260922`) |
|---|---:|---:|---:|
| customers | 338 | 338 | 338 |
| customer_transactions | 39,052 | 39,052 | 39,052 |
| customer_payments | 1,005 | 1,005 | 1,005 |
| customer_writeoffs | 657 | 657 | 657 |
| customer_invoices | 2,253 | 2,253 | 2,253 |
| timesheet_entries | 28,255 | 28,255 | 28,255 |
| users | 23 | 23 | 23 |

**All seven counts are unchanged and equal the reference.** The final verification connections enforced `default_transaction_read_only=on`. The drift check reports **0 engine/audit differences across319 active customers** and **0 engine/AR differences across320 customers** (39 AR rows, including one inactive customer). See [protected-counts.json](evidence/final/protected-counts.json) and [drift-summary.log](evidence/final/drift-summary.log). The detailed read-only snapshot stays at `/tmp/drift.json`.

## Exact final suite counts

Every row below has zero failing and zero pending. The clean-room file is counted once, through the requested npm command. [Machine-readable totals](evidence/final/summary.json), [acceptance counts](evidence/final/counts.json) and [scenario counts](evidence/final/scenario-counts.json) accompany the raw logs.

| Suite | Passing |
|---|---:|
| unit | 1006 |
| analytics.integration.spec | 11 |
| billing-regression.integration.spec | 2 |
| cascade-edit-recompute.integration.spec | 11 |
| coverage-account-users-auth-misc.integration.spec | 200 |
| coverage-billing-review.integration.spec | 31 |
| coverage-downloads-authz.integration.spec | 36 |
| coverage-invoices-audit-ar-analytics.integration.spec | 131 |
| coverage-jobs-masterdata.integration.spec | 124 |
| coverage-payments-pending.integration.spec | 102 |
| coverage-pending-payments-authz.integration.spec | 10 |
| coverage-timetracking-timesheets.integration.spec | 106 |
| coverage-transactions-retainers-writeoffs.integration.spec | 84 |
| finalize-engine.integration.spec | 15 |
| finalize-snapshot.integration.spec | 9 |
| month-end-lifecycle.integration.spec | 19 |
| orchestrator.integration.spec | 7 |
| payment-reversal.integration.spec | 49 |
| pii-leak.integration.spec | 2 |
| review-account-atomicity.integration.spec | 4 |
| review-analytics-identities.integration.spec | 2 |
| review-audit-download.integration.spec | 4 |
| review-audit-filter.integration.spec | 3 |
| review-customer-delete.integration.spec | 4 |
| review-customer-recurring.integration.spec | 8 |
| review-customer-response.integration.spec | 2 |
| review-initial-data-roles.integration.spec | 18 |
| review-invoice-outcomes.integration.spec | 4 |
| review-job-family.integration.spec | 4 |
| review-job-selection.integration.spec | 2 |
| review-pending-files.integration.spec | 7 |
| review-rate-agreements.integration.spec | 10 |
| review-related-ids.integration.spec | 24 |
| review-retainer-dates.integration.spec | 1 |
| review-statement-snapshot.integration.spec | 1 |
| review-template-storage.integration.spec | 1 |
| review-tracker-outcome.integration.spec | 1 |
| review-transaction-policy.integration.spec | 22 |
| review-user-guards.integration.spec | 7 |
| tracker-excel-end-to-end.integration.spec | 33 |
| transactions-ledger-seams.integration.spec | 28 |
| clean-room-regression.integration.spec | 18 |
| scenario-lifecycle-01-work.integration.spec | 13 |
| scenario-lifecycle-02-retainers.integration.spec | 9 |
| scenario-lifecycle-03-payments.integration.spec | 7 |
| scenario-lifecycle-04-writeoffs.integration.spec | 6 |
| scenario-lifecycle-05-monthend.integration.spec | 7 |
| scenario-lifecycle-06-cascade.integration.spec | 8 |
| scenario-lifecycle-07-refusals.integration.spec | 122 |
| scenario-lifecycle-08-failures.integration.spec | 24 |
| scenario-lifecycle-09-state-boundaries.integration.spec | 21 |
| scenario-lifecycle-10-integrity.integration.spec | 22 |
| scenario-lifecycle-11-finalize-races.integration.spec | 15 |
| **Total (53 suites)** | **2,417** |

Commands used:

```sh
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js --recursive --exclude 'test/integration/**' test
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js test/integration/<existing-file> --exit --timeout 180000
npm run -s test:cleanroom
npm run -s test:scenarios
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js /tmp/drift.json
```

The acceptance runs also supplied dummy AWS credentials, disabled instance metadata and set the SDK fallback endpoint to loopback port9; application S3 explicitly used local MinIO. V8 coverage collection did not change the test assertions.

## Files changed

- Application: `src/endpoints/transactions/sharedTransactionFunctions.js`, `src/endpoints/billingReview/cascadeEdit.js`, `src/endpoints/retainer/retainer-logic.js`, `src/endpoints/payments/ledger-helpers.js`.
- Existing test support: `test/endpoints/billingReview/_stubDb.js`.
- Environment/runner: `.env.scenarios`, `scripts/scenarios/guard.js`, `scripts/scenarios/reset.js`, `scripts/scenarios/run.js`, and npm scripts in `package.json`.
- New automated tests: `test/integration/_scenario.js` and the11 `scenario-lifecycle-*.integration.spec.js` files listed above.
- Updated contracts: `docs/README.md`, `docs/work/transactions.md`, `docs/invoicing/billing-review.md`, `docs/ledger/retainers-and-prepayments.md`, `docs/ledger/payments.md`, `docs/ledger/ledger-conventions.md`.
- Catalogue/output: `docs/scenarios/README.md`, group files01–08, this report, `COVERAGE.md`, and evidence logs/JSON/diff/manifest under `docs/scenarios/evidence/`.

## Verification limits

This is local API-level Pass1 evidence. UI/browser behavior, the payment-image Lambda, production readiness and the five OPEN policy decisions are not certified here. The scenario guard deliberately disables optional AI narrative generation while the real audit arithmetic, save/poll/read routes and error outcomes are tested. A postcommit combined-export failure leaves a valid committed statement with an explicit warning and retrievable individual PDF; a precommit failure leaves no new ledger statement.
