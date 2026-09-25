# F1–F39 regression repair — 2026-09-24

## Scope and evidence

Local backend checkout at `DS2_Backend`; no git commands, commits, production connections, or running-server lifecycle changes. `.env.local` resolves to `127.0.0.1:5433/ds2_local`; storage resolves to local MinIO at `127.0.0.1:9000`. Test processes run serially. Logs and machine-readable verification are under `/tmp/ds2-regression-repair-20260924/`.

Before any test, a read-only repeatable-read transaction recorded account-1 row counts for all 33 public tables with an `account_id` column. The baseline is `account-1-before.json`. Source/test/document hashes were also captured before changes in `starting-hashes.json` to identify changed files without git.

## Decisions for every reported failure

| File / failing case | Decision | Evidence and retained proof |
| --- | --- | --- |
| `coverage-account-users-auth-misc`: empty account body | **Update test; F20 behavior is correct.** | Observed HTTP 400 instead of the old expected 500. Assert the exact account-name validation error and unchanged account/address rows. |
| Same file: missing recurring `customerID` | **Fix code; F21 introduced an unintended HTTP 500.** | The new ledger lock throws a rule error with `statusCode`, while the global handler reads `status`. Run the existing owned-customer validator before the lock, inside the same transaction, restoring documented HTTP 422 and the original error text. The lock still verifies existence before writes. Retain the original status/message assertions and add full fixture customer/recurring-row comparisons. See `fixes-F8-F22.md` F21 and `docs/work/customers.md`. |
| Same file: nonexistent customer update | **Update test; the locked ownership check is correct.** | Only the message changed from `Customer not found in this account.` to `Customer not found for this account.` Keep HTTP 200/body status 500 and absence of both response lists; add unchanged customer/contact assertions. |
| `coverage-transactions-retainers-writeoffs`: quarter-hour happy path | **Fix code; F11's blanket increment restriction was too broad.** | Observed `Time quantity must use six-minute (0.1 hour) increments.` The established direct-entry contract accepts two-decimal hours; duration-based UI/tracker calculations round up to six minutes. Restrict the duration agreement rule to supplied minutes. Preserve every original 0.25-hour, $75-rate, $18.75-total, normalized-type, and job-total assertion. Finite/nonnegative/two-decimal/arithmetic checks remain. See `fixes-F8-F22.md` F11 and `docs/work/transactions.md`. |
| Same file: negative-rate CSV export | **Update historical fixture; F11's rejection of new negative-rate work is correct.** | The rejected create left no transaction, causing an undefined `transaction_id`. Assert successful creation with positive consistent pricing, then change only that owned fixture row's rate to its historical negative value. The real CSV endpoint must still return the exact header and unquoted `-18.75` numeric cell. |
| `finalize-engine`: setup 1a and downstream cascade | **Same F11 code fix; leave this file unchanged.** | Setup stopped at its quarter-hour entry. The initial run had 3 passing / 12 failing. After the fix all 15 pass with the original amounts, hours, NULL notes, write-offs, statement chains, and engine/audit/AR assertions unchanged. No fixture repricing or expected-amount changes. |
| `tracker-excel-end-to-end`: ZIP/PDF test 6b | **Update test; F33's collision-safe member naming is correct.** | Actual members include `_customer_<ID>` and sanitized names. Assert each exact new name plus unique ZIP member names. Retain all PDF invoice-number, Bill To, individual-job, total, balance, due-date, and excluded-charge/customer assertions. |
| `transactions-ledger-seams`: failed create rollback | **Update failure injection; F2's early reference validation is correct.** | Old bad work-description input is now rejected before writes. Send valid input; at the transaction insert service, first inspect the real transaction's intermediate job/draw state, then inject the bad FK into the SQL insert. Assert the real FK error and exact restoration of all transaction/payment/retainer/job rows. |
| Same file: failed update rollback | **Update failure injection; preserve atomicity proof.** | Keep valid IDs/pricing and submit an invalid SQL date. Assert successful job-total and draw-reprice SQL responses occurred before PostgreSQL rejects the actual transaction UPDATE, then compare all four ledger tables with their baseline. An added test completes transaction repricing and payment sync, verifies the intermediate $80 transaction, −$420 draw balance, −$80 payment and $80 job total, then forces a real PostgreSQL division-by-zero; all four tables must roll back exactly. Every stub/listener is restored in `finally`. |

The F11 regression file now checks an inconsistent supplied duration instead of treating every decimal-hour quantity as invalid. New HTTP coverage proves direct decimal-hour create **and update**, including cents, notes and the resulting job total. Two unit tests distinguish absent-duration quarter-hours from supplied-duration six-minute rounding. No original finalize-engine assertion was edited.

## Reproduction and focused verification

| Run | Before: pass / fail | After: pass / fail |
| --- | ---: | ---: |
| Account/users/auth: the three reported cases, filtered while fixture authorization is pending | 0 / 3 | 3 / 0 |
| Transactions/retainers/write-offs full file | 82 / 2 | 84 / 0 |
| Finalize-engine full file | 3 / 12 | 15 / 0 |
| Tracker Excel end-to-end full file | 32 / 1 | 33 / 0 |
| Transaction ledger seams full file | 25 / 2 | 28 / 0 |
| F11/F12 transaction-policy full file | Not rerun before editing; original failing quarter-hour cases above establish red | 22 / 0 |
| F21/F22 customer-recurring full file | Original missing-customer case above establishes red | 8 / 0 |

All focused runs had zero pending tests. Before logs are `before-*.log`; focused repaired logs are `after-*.log` and `focused-results.json`. These are not added to final totals.

## Final verification

Completed verification: **1,006 unit + 935 integration = 1,941 passing, 0 failing, 0 pending** in the completed final runs. The unit command includes **158 test/scripts cases** (848 other cases); they are not added again. The integration count covers **38 complete files**. Focused reruns are excluded.

**Not yet fully verified:** three inventory files remain pending clarification of the instruction “fixture account 9001 only.” The existing account-provisioning tests create/delete temporary account IDs beyond 9001, and the clean-room file uses account 1 exclusively in its separate `ds2_clean` database. Neither account-provisioning suite nor the clean-room reset was run while that clarification was unanswered. The three originally failing account cases were individually reproduced and repaired, with 3/3 passing afterward. No tests were disabled or weakened to get the completed totals.

**Drift: 0 differences.** Engine versus audit: 319 customers, 0 mismatches. Engine versus AR: 320 compared, 39 AR rows (1 inactive), 0 mismatches. Exit 0; evidence: `final-drift.log`, `/tmp/drift.json`, and the copied `drift.json` in the evidence directory.

**Account 1 in ds2_local: unchanged row counts in all 33 checked tables.** Baseline at `2026-09-25T04:07:50.528Z`; after completed verification at `2026-09-25T04:19:45.394Z`. Exact counts and comparison are in `account-1-before.json`, `account-1-after.json`, and `account-1-comparison.json` (empty differences). These are read-only comparisons; the clean-room database was not reset.

### Per-file integration results

All completed files ran in separate processes with `.env.local`, with zero failures and zero pending tests. The clean-room file must instead use the explicit `npm run -s test:cleanroom` command; its database guard refuses `ds2_local`.

| Integration file | Passing | Status |
| --- | ---: | --- |
| `analytics.integration.spec.js` | 11 | Passed |
| `billing-regression.integration.spec.js` | 2 | Passed |
| `cascade-edit-recompute.integration.spec.js` | 11 | Passed |
| `clean-room-regression.integration.spec.js` | — | Pending separate ds2_clean fixture clarification |
| `coverage-account-users-auth-misc.integration.spec.js` | — | Pending fixture clarification; repaired targeted cases 3/3 pass |
| `coverage-billing-review.integration.spec.js` | 31 | Passed |
| `coverage-downloads-authz.integration.spec.js` | 36 | Passed |
| `coverage-invoices-audit-ar-analytics.integration.spec.js` | 131 | Passed |
| `coverage-jobs-masterdata.integration.spec.js` | 124 | Passed |
| `coverage-payments-pending.integration.spec.js` | 102 | Passed |
| `coverage-pending-payments-authz.integration.spec.js` | 10 | Passed |
| `coverage-timetracking-timesheets.integration.spec.js` | 106 | Passed |
| `coverage-transactions-retainers-writeoffs.integration.spec.js` | 84 | Passed |
| `finalize-engine.integration.spec.js` | 15 | Passed |
| `finalize-snapshot.integration.spec.js` | 9 | Passed |
| `month-end-lifecycle.integration.spec.js` | 19 | Passed |
| `orchestrator.integration.spec.js` | 7 | Passed |
| `payment-reversal.integration.spec.js` | 49 | Passed |
| `pii-leak.integration.spec.js` | 2 | Passed |
| `review-account-atomicity.integration.spec.js` | — | Pending temporary-account fixture clarification |
| `review-analytics-identities.integration.spec.js` | 2 | Passed |
| `review-audit-download.integration.spec.js` | 4 | Passed |
| `review-audit-filter.integration.spec.js` | 3 | Passed |
| `review-customer-delete.integration.spec.js` | 4 | Passed |
| `review-customer-recurring.integration.spec.js` | 8 | Passed |
| `review-customer-response.integration.spec.js` | 2 | Passed |
| `review-initial-data-roles.integration.spec.js` | 18 | Passed |
| `review-invoice-outcomes.integration.spec.js` | 4 | Passed |
| `review-job-family.integration.spec.js` | 4 | Passed |
| `review-job-selection.integration.spec.js` | 2 | Passed |
| `review-pending-files.integration.spec.js` | 7 | Passed |
| `review-rate-agreements.integration.spec.js` | 10 | Passed |
| `review-related-ids.integration.spec.js` | 24 | Passed |
| `review-retainer-dates.integration.spec.js` | 1 | Passed |
| `review-statement-snapshot.integration.spec.js` | 1 | Passed |
| `review-template-storage.integration.spec.js` | 1 | Passed |
| `review-tracker-outcome.integration.spec.js` | 1 | Passed |
| `review-transaction-policy.integration.spec.js` | 22 | Passed |
| `review-user-guards.integration.spec.js` | 7 | Passed |
| `tracker-excel-end-to-end.integration.spec.js` | 33 | Passed |
| `transactions-ledger-seams.integration.spec.js` | 28 | Passed |
| **Completed full-file total** | **935** | **38 files passed; 3 await clarification** |

Machine-readable results: `final-integration-results.json`; full logs: `final-<file stem>.log`; unit log: `final-unit.log`. The 41-file inventory is `integration-inventory.txt`.

### Files changed

13 files changed, identified from starting content hashes: 2 implementation files, 6 test files and 5 documentation files. `finalize-engine.integration.spec.js` is byte-for-byte unchanged.

- [docs/_review/findings.md](findings.md)
- [docs/_review/fixes-F8-F22.md](fixes-F8-F22.md)
- [docs/_review/regression-repair.md](regression-repair.md)
- [docs/work/customers.md](../work/customers.md)
- [docs/work/transactions.md](../work/transactions.md)
- [src/endpoints/recurringCustomer/recurringCustomer-router.js](../../src/endpoints/recurringCustomer/recurringCustomer-router.js)
- [src/endpoints/transactions/transactionPricing.js](../../src/endpoints/transactions/transactionPricing.js)
- [test/endpoints/transactions/transactionPricing.spec.js](../../test/endpoints/transactions/transactionPricing.spec.js)
- [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)
- [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)
- [test/integration/review-transaction-policy.integration.spec.js](../../test/integration/review-transaction-policy.integration.spec.js)
- [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)
- [test/integration/transactions-ledger-seams.integration.spec.js](../../test/integration/transactions-ledger-seams.integration.spec.js)

Commands from the backend directory:

```sh
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js --recursive --exclude 'test/integration/**' test
# Separate process for each local integration file, never simultaneous:
DS2_ENV_FILE=.env.local node_modules/.bin/mocha --require test/setup.js test/integration/<file> --exit --timeout 180000
# The clean-room file refuses ds2_local; run it separately on ds2_clean:
npm run -s test:cleanroom
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/drift-check.js /tmp/drift.json
```
