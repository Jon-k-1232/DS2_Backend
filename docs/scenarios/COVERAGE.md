# Pass 1 refusal-site review

Historical pass evidence below predates the owner decisions. Current behavior and complete rerun counts are in [owner run1 results](../decisions/2026-09-24-run-1-results.md); changed oracles are documented in [the design record](../decisions/2026-09-24-owner-decisions.md).

The final unit/integration/scenario processes collected V8 execution data. The inventory below examines literal `throw` sites in11 central lifecycle modules. For each site, its UTF-16 source offset is looked up in the innermost V8 range, then execution is unioned across test processes. Raw app-only profiles are under `evidence/final/coverage/`; [refusal-sites.json](evidence/final/refusal-sites.json) records the source line and suites reaching each site.

This instrumentation was used to locate missing tests. It led to the legacy-integrity and finalization-race suites. Passing a source line is supporting evidence; correctness still comes from the hand-written monetary oracles, response assertions and before/after row checks. This inventory is not a whole-repository branch-coverage percentage.

| Module | Executed throw sites | Total throw sites |
|---|---:|---:|
| `src/endpoints/transactions/sharedTransactionFunctions.js` | 28 | 28 |
| `src/endpoints/transactions/transactionPricing.js` | 4 | 4 |
| `src/endpoints/payments/payment-logic.js` | 41 | 43 |
| `src/endpoints/payments/ledger-helpers.js` | 8 | 9 |
| `src/endpoints/retainer/retainer-logic.js` | 16 | 16 |
| `src/endpoints/writeOffs/writeOffs-logic.js` | 17 | 17 |
| `src/endpoints/billingReview/cascadeEdit.js` | 30 | 31 |
| `src/endpoints/customer/customer-router.js` | 5 | 8 |
| `src/endpoints/job/job-router.js` | 9 | 10 |
| `src/endpoints/invoice/invoice-router.js` | 15 | 16 |
| `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js` | 8 | 17 |
| **Total** | **181** | **199** |

## Remaining sites and reachability

No unexecuted site below takes an unchecked value directly from a normal authenticated lifecycle request. They defend internal service contracts or repeat an earlier mandatory refusal. The earlier gates, successful paths and failure rollback are tested. These guards were retained; no production code was removed to raise a coverage number.

| Site | Why the HTTP route cannot reach this later guard under its service contract | Related executed evidence |
|---|---|---|
| `payments/payment-logic.js:589` | `assertRetainerDrawAdjustable` is only called for a truthy retainer ID; its resolver returns a valid draw or throws `RETAINER_DRAW_NOT_FOUND/MISMATCH/AMBIGUOUS`. It cannot return a null draw on this path. | I manual missing legacy snapshot; existing exact/legacy draw-resolution regressions. |
| `payments/payment-logic.js:1018` | The reversal actor comes from the authenticated stored user, not URL/body input. Normal user creation allocates a positive integer ID; absent/invalid identities fail authentication first. | X missing/expired/unknown identity and forged account tests; reversal records authenticated actor in existing coverage. |
| `payments/ledger-helpers.js:144` | The billed-gate anchor table is a hard-coded internal ledger table, not a request field. Callers supply one of its allowed table keys. | All billed work/payment/write-off/retainer refusal paths. |
| `billingReview/cascadeEdit.js:461` | Before `_validateReferences`, the destination customer has already been found and locked in this account. Missing/foreign customers fail `_lockLedgers` first; API writers cannot remove that locked customer in between. | X foreign/absent customer; I actual cancelled database lock query and locked reread races. |
| `customer/customer-router.js:66,77,85` | Successful `INSERT ... RETURNING *` yields a row containing schema columns, never an empty object. A failed insert throws; suppressing an insert produces no row rather than `{}`. The empty-object branches require a service implementation/test double violating that return contract. | F PostgreSQL contact-insert failure; existing atomic recurring/customer regressions; J suppressed customer update. |
| `job/job-router.js:219` | The job was reread successfully under its customer ledger lock. Its family query must include that row (root ID or its parent ID); a missing job is refused earlier. | X/S missing/foreign job, family dependency and concurrent job regressions. |
| `invoice/invoice-router.js:447` | The S3 helper returns `body: await streamToBuffer(...)`; this returns a Buffer or throws. It cannot successfully return a non-Buffer body. | Local S3 failures, absent-key/download-auth regressions, F pre/postcommit export cases. |
| `invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:34` | The route constructs calculation/account/PDF arguments and supplies its authenticated user before calling the orchestrator. | Real full finalize and precommit storage failure. |
| Same module `:48,49` | The route rejects invalid customer IDs and duplicates before reading the snapshot. | S invalid batch selections, including noninteger, unsafe, absent and foreign IDs. |
| Same module `:52,53,264` | The route only finalizes finite, nonnegative calculated totals. Credit/nonfinite calculations are filtered or rejected earlier. The second finite check repeats the first. | O credit-only and excess pending credits; X malformed monetary values. |
| Same module `:58` | Account identity is enforced by authentication/account middleware and the account row supplies the calculation scope. | X mismatched/foreign/malformed account paths. |
| Same module `:67` | The trusted detail builder assigns a different sequence number to every selected customer; neither caller nor ledger data supplies these planned numbers. Sequence exhaustion is rejected before this point. | M sequences/subsets; S overflow; J competing runs execute the separate taken-number guard. |
| Same module `:106` | Each planned customer has a validated parent insertion returning that same customer. A failed insertion throws and rolls back before lookup. Missing/mutated return identity would violate the insert service contract. | F parent/stamp rollback; J suppressed work/payment stamps. |

## HTTP branch matrix

| Surface | Happy path | Validation, ownership and state refusal | Infrastructure/concurrency |
|---|---|---|---|
| Customer/job CRUD | W01/W09/W13; existing coverage jobs/customer suites | X/S/J; duplicate, absent, foreign, linked work/payment/credit, wrong contact | F customer/job insert rollback; J suppressed customer update; existing account atomicity/customer deletion/recurring/job-family regressions |
| Work entry and correction | W02–W10; R funded work; C cascade | X pricing/type/duration/reference matrix; W billed lock; R insufficient funds; I damaged draws | F partial-write rollback; I queued delete/move/edit; J stale snapshot changes |
| Retainers/prepayments | R and P07 | R/X/S used/child/cancelled/root ownership and cent boundary | F retainer database faults; I conflicting exact/legacy links |
| Payments/NSF | P and S | X/S latest-child, billed, reversed, cross-customer/invoice, excess and retainer limits | F concurrent receipts; I concurrent deletion, cancelled-root restoration, corrupt links |
| Write-offs | O and S | X/S pending/linked amount limits, billed/owner/latest-child | F rollback; I corrupt link and legacy parent-link refusal |
| Invoice calculation/finalize/delete/download | M, all `statement` checks, existing clean-room/PDF suites | X/S selection/contact/number/history/credit guards, download scope | F local S3 failures and stale snapshot; J invoice-delete races, two finalize conflicts, stamp suppression |
| Audit/AR | Every `check` invocation and existing analytics/audit/AR suites | X role and account boundaries; nonexistent/foreign saved audit and invoice controls | F read failures; existing audit download/filter/failure regressions |

Conditions demanding new business policy are OPEN in [RESULTS.md](RESULTS.md). They are not silently treated as successful workflows. Existing API refusals are asserted while those decisions remain unresolved.


## Owner run 2 — retainers and duplicate review

Owner run 2 adds `scenario-lifecycle-13-retainer-events.integration.spec.js` and `scenario-lifecycle-14-duplicates.integration.spec.js`: new-route validation/auth/tenant/not-found/conflict/DB failures with full ledger/evidence hashes, four creation-hook rollbacks, customer-lock races, sent-record refusal, hand arithmetic and real MinIO PDF assertions. See [oracle](10-owner-retainers-duplicates.md) and [run 2 results](../decisions/2026-09-25-run-2-results.md) for executed counts.
