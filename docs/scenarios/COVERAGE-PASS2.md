# Pass 2 refusal and failure coverage

Historical pass evidence below predates the owner decisions. Current behavior and complete rerun counts are in [owner run1 results](../decisions/2026-09-24-run-1-results.md); changed oracles are documented in [the design record](../decisions/2026-09-24-owner-decisions.md).

The final unit, integration and scenario processes collected V8 execution data. This pass rechecked the eleven Pass 1 lifecycle modules and the changed routers/helpers. **188/216 explicit refusal sites** executed; the remaining 28 are repeated mandatory checks or internal contracts explained below. **27/27 catch handlers in the nine changed application modules** executed. All ten new input-validation gates and their shared throw executed (11/11 sites); all six explicit user-router throws executed.

Execution counts are supporting evidence, not an assertion that every possible input or every JavaScript branch in the repository has been proved correct. The correctness evidence is the literal monetary oracle, actual HTTP result, full financial-row comparison on refusal, stored ownership/attribution checks, and real PostgreSQL/MinIO/PDF output. The [464-case index](what-if-and-mistakes.md#individual-executed-case-index) describes each input and outcome.

Raw app-only profiles are in [coverage/](evidence/pass2/final/coverage/). The [refusal-site inventory](evidence/pass2/final/refusal-sites.json) and [catch inventory](evidence/pass2/final/catch-sites.json) record source lines and executing suites. Offsets are JavaScript UTF-16 offsets matched to the innermost V8 range and unioned across test processes; this avoids treating a module load as execution of an uncalled function.

| Reviewed module | Executed refusal sites | Total |
|---|---:|---:|
| `src/endpoints/transactions/sharedTransactionFunctions.js` | 28 | 28 |
| `src/endpoints/transactions/transactionPricing.js` | 4 | 4 |
| `src/endpoints/payments/payment-logic.js` | 38 | 43 |
| `src/endpoints/payments/ledger-helpers.js` | 8 | 9 |
| `src/endpoints/retainer/retainer-logic.js` | 13 | 16 |
| `src/endpoints/writeOffs/writeOffs-logic.js` | 13 | 17 |
| `src/endpoints/billingReview/cascadeEdit.js` | 30 | 31 |
| `src/endpoints/customer/customer-router.js` | 5 | 8 |
| `src/endpoints/job/job-router.js` | 9 | 10 |
| `src/endpoints/invoice/invoice-router.js` | 15 | 16 |
| `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js` | 8 | 17 |
| `src/utils/ledgerInput.js` | 11 | 11 |
| `src/utils/committedResponse.js` | 0 | 0 |
| `src/endpoints/user/user-router.js` | 6 | 6 |
| `src/endpoints/retainer/retainer-router.js` | 0 | 0 |
| `src/endpoints/payments/payments-router.js` | 0 | 0 |
| `src/endpoints/writeOffs/writeOffs-router.js` | 0 | 0 |
| `src/endpoints/transactions/transactions-router.js` | 0 | 0 |
| **Total** | **188** | **216** |

## Unexecuted repeated validation

The new route validator runs on both raw and sanitized input before calling the ledger cores. These ten later guards are now unreachable from those HTTP requests because the equivalent earlier gate returns HTTP 400 first. Their malformed-input cases were retained and strengthened to require the earlier clean refusal and unchanged financial state.

| Later core guard | Mandatory earlier gate and evidence |
|---|---|
| `payment-logic.js:436,439,923` — create amount/date, edit amount | `validateLedgerInput` positive rounded magnitude and real date checks; V01/V05 create/edit matrix, including explicit null/NaN edits. |
| `retainer-logic.js:65,66,105` — create amount/hold type, edit amount | V01/V06 create/edit matrix; required nonblank type, zero/subcent and nonnumeric amount checks before mapping. Metadata-only omission preserves the amount. |
| `writeOffs-logic.js:79,81,82,158` — create amount/reason/date, edit amount | V01/V05/V06 create/edit matrix, including null-primary spelling alias and post-sanitization varchar boundaries. |

The other eighteen internal-contract/repeated sites are unchanged in reachability from the [Pass 1 analysis](COVERAGE.md#remaining-sites-and-reachability): payment draw resolver and authenticated reversal actor; hard-coded billed-gate table; already-locked Billing Review customer; insert return contracts; already-locked job family; S3 Buffer contract; and orchestrator arguments, IDs, numbers, totals and parent-row contracts. The current line numbers and final-run evidence are in the JSON inventory. Guards were retained; no application branch was removed to increase coverage.

## HTTP success/refusal matrix

| Surface | Successful path | Validation / state / ownership / permission refusal | Failure and race evidence |
|---|---|---|---|
| Payment/write-off/retainer inputs | Signed cent cases, leap dates, optional selection/metadata, Unicode and exact limits | Amount/type/range/date/text/ID matrices; foreign/missing/deleted targets; billed and latest-child locks | Real database trigger failures; create/edit/delete response-refresh failures; unchanged state after each refusal |
| Direct work | Zero and half-cent multiplication, ordinary work and retainer funding | Negative/overprecision/inconsistent prices; billed amount/job/customer edits; wrong jobs/users | Database rollback, finalize snapshot races, queued deletion/foreign-key refusal; inherited lifecycle failure suites |
| User update/deletion | Unused user update and deletion | Self, malformed/missing/deleted/foreign update/delete target, last administrator, uploader/matched employee and created/logged-for work | Injected UPDATE/DELETE failures leave the complete user unchanged; work insertion queued behind user deletion refuses |
| Finalization | Literal 100 and 120 statements, eight Phoenix date/PDF cases, future-work eligibility | Same-day retry skip, absorbed/settled invoice controls, existing selection/contact/number/state refusals | Two simultaneous finalizations; payment/edit during rendering; precommit local storage fault; existing finalize races |
| CSV and reads | Text/numeric round-trip, active-retainer and employee reports | Formula-prefix escaping; tenant/role/session denial; malformed JSON and body limit | Export/read query failures and recovery with no committed-write flag or database changes |
| Sessions | Valid admin mutation and staff self-read | Missing, malformed, expired, revoked or foreign identity; employee on privileged routes | Full existing auth/user regression suite and unchanged users/time/financial checks |

V8 review prompted the final active-retainer read-failure test. It passed without an application change. Duplicate submissions are **OPEN policy characterization**, not claimed retry protection. Used-retainer financial edits are likewise not described as cash refunds. Existing business-rule routes can still return HTTP 200 with a JSON failure status; this pass asserts that existing envelope explicitly, while new input validation uses actual HTTP 400.
