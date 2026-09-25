# Pass 2: what-if situations and careless-user mistakes

**Current owner-rule update (2026-09-25):** this is a retained dated scenario report/catalogue. The original five decisions are now implemented; optional credit selection, sent locks/corrections, retainer events and duplicate review are governed by the [owner record](../decisions/2026-09-24-owner-decisions.md). See [run3 results](../decisions/2026-09-25-run-3-results.md) and [the combined lifecycle](16-owner-combined.md) for current verification. Decision6 is implemented in [run4](../decisions/2026-09-25-run-4-results.md), with its own [audit history oracle](18-audit-record.md).

Owner run1 update (2026-09-25): History X01 and calendar T02 now preserve original parent balances (100) while a closing child carries0/absorption. Settled/current selection uses latest child, never immutable parent as a live balance cache. Sent edits/reversals follow the owner409/exception rule; unissued mistake/retry coverage remains.

## Hand-written expectations — recorded before execution

Specification: the ledger, work, invoicing and platform guides linked from
[README](../README.md). These are independent, literal accounting oracles; the
application's calculator is never used to manufacture an expected amount.
Execution observations and defect evidence are appended after the runs.

All new cases use `ds2_scenarios` on loopback PostgreSQL port 5433 and MinIO
port 9000, through the existing guarded reset and HTTP harness. Each file starts
from the clean baseline. A refusal must leave every customer/financial row
unchanged, including the other customer and tenant. User and time-entry rows
are additionally compared in the user scenarios. Existing legacy routes use
HTTP 200 with a failure envelope; new input validation should return HTTP 400.
Infrastructure errors are 500. State locks may be 409/423 or the documented
legacy failure envelope. Both transport and envelope are asserted explicitly.

| Cases | Input | Expected safe outcome, by hand | Observed outcome |
|---|---|---|---|
| V01 amounts, create and edit | Payment, write-off and retainer: zero, null, empty/whitespace, nonnumeric text, Infinity text, boolean, array, object, and 100000000 | Explicit invalid values refuse with an amount message; no writes. An omitted retainer-edit amount may preserve the stored amount for a metadata-only edit. Other money fields are required. Maximum representable magnitude is99999999.99. | PASS: explicit invalid values return HTTP 400 without writes; metadata-only omission and the maximum valid retainer succeed. |
| V02 signs | Enter +10 or -10 as receipt, credit or funds held | Both represent10 of credit and store-10. Negative charge/rate/quantity is refused. A negative receipt is not an NSF reversal. | PASS: both signs store credit magnitudes as negatives; negative work inputs refuse. |
| V03 rounding | Ledger amounts0.005,1.005,1.015,2.675,12.345, either sign, on create and edit | Round the positive magnitude to cents, then apply the credit sign: -0.01,-1.01,-1.02,-2.68,-12.35. No cent can disappear merely because a retainer stores negatives. | PASS after correcting retainer rounding; all listed literal cents match on create and edit. |
| V04 work price | Zero work; quantity0.01 × rate0.50; supplied total0.01 versus0; overprecision0.005 in an input field | Zero charge is allowed. Half-cent product rounds to0.01; supplied0 refuses. Quantity/rate/total inputs must themselves have at most two decimals. Huge, negative, null, nonnumeric values refuse. | PASS: zero work and the 0.01 product succeed; inconsistent total, invalid amounts and overprecision refuse without writes. |
| V05 dates and optional updates | 2024-02-29; 2025-02-29; 2026-02-30; invalid text, null and empty date; omitted date on edit | Real leap day succeeds; nonexistent dates and explicit invalid edits refuse without partially saving accompanying notes. Omitted optional date keeps the stored date. Date-only and supported ISO timestamp inputs must identify real calendar dates. | PASS: real leap days and supported timestamps succeed; invalid calendars/edits refuse; omitted edit date preserves the stored date. |
| V06 required strings and field sizes | Empty/whitespace write-off reason or hold type; overlong varchar fields; unicode and long text notes | Required text must contain non-whitespace content. Reject oversized bounded fields before SQL. Text notes within the1MB request limit round-trip, including unicode; optional empty note clears it. Explicit invalid updates must not report success while ignoring the field. | PASS after raw and sanitized validation; long Unicode notes preserve all text, including final newlines. |
| V07 optional selections | Invalid job/invoice/retainer IDs: text, fraction, boolean, arrays, objects, negative, unsafe integer; valid blank optional selection | Malformed nonempty selection refuses; it must never silently become an unlinked credit or prepayment. Missing/null/empty optional selection retains documented no-selection behavior. Positive numeric/string IDs undergo account/customer validation. | PASS after validation: malformed IDs return HTTP 400; blank optional IDs retain no-selection behavior. |
| X01 cross-customer/tenant | Receipt for A with B's invoice/job/retainer; account700 IDs; missing and deleted records | Refuse without altering either customer. Valid A receipt10 against100 leaves90. Selecting an absorbed A invoice remaps to A's live chain and is annotated; the absorbed chain stays zero. | PASS: wrong targets and settled chains refuse unchanged; an absorbed invoice safely remaps to its live customer chain. |
| D01 repeated create | Two identical manual payments10 against100, write-offs10 against100, retainers10, or charges10, started within one second | OPEN: no documented request identity exists. Desired retry protection is one event, but identical genuine events can be valid. Characterize existing behavior precisely: two receipts/credits leave80; two retainers hold20; two charges total20. Do not invent a temporal deduplication rule. | CONFIRMED OPEN: all four kinds create two events. Receipts/credits leave 80; holds total 20; work raises the fixture balance from 100 to 120. |
| D02 repeated finalize | Sequential double click; two simultaneous finalizations of the same customer | Exactly one parent and one set of stamped work; total100. Sequential retry skips already-billed customer; simultaneous stale run refuses. No duplicate invoice numbers. | PASS: one parent statement for sequential or concurrent submissions; the overlapping stale run explicitly refuses. |
| D03 failure/retry | Database fault during receipt, credit, retainer or charge posting; S3 fault before finalize; response-refresh failure after successful posting | Precommit failure has no partial writes; retry posts exactly one event. A postcommit refresh failure must identify committed success so a user is not told to retry a payment that already exists. | PASS: precommit failures roll back; committed writes report success plus reload warning; read failures remain errors; retries have exact expected totals. |
| L01 deletion in use | Customer with debt100; job with work100; retainer100 with draw30; payment on next statement; invoice after receipt; user owning time | Refuse each destructive request and preserve all linked history. Unused customer/job/retainer and unused user may be deleted. Their stale IDs then refuse. | PASS after user-history/404 fixes: linked history stays intact; unused records delete; stale IDs refuse. |
| L02 after-the-fact edits | Billed work amount/job/customer; billed receipt amount; write-off after next statement | Direct edits refuse with no financial change. Existing explicit Billing Review correction workflow is covered separately in Pass1. | PASS: all direct billed edits and deletions refuse with unchanged ledger state. |
| L03 used retainer | Hold100, draw30, edit starting funds to120, then20 | Existing rule allows120 and preserves draw30, leaving90; reducing to20 refuses because30 is already used. Deletion refuses. Whether financial edits after draws should require a refund ledger remains OPEN. | CONFIRMED existing rule: draw 30 stays applied, increase to 120 leaves 90, reduction to 20 and deletion refuse. Refund policy remains OPEN. |
| T01 races | Payment10 or work edit100→110 while finalize renders; queued mutation after finalize locks | Finalize uses one coherent snapshot: competing precommit mutation invalidates stale finalize; its committed change survives. A mutation queued after finalized work must reread and refuse billed editing. Existing race suites also cover delete/reassign/number conflicts. | PASS: competing payment/edit survives, stale finalize refuses, and simultaneous finalizations produce one parent. |
| T02 Phoenix calendar | 2026-12-01T06:59Z vs 07:00Z; 2027-01-01T06:59Z vs07:00Z; leap-day2024-02-29 boundaries | Local dates are Nov 30/Dec 1, Dec 31/Jan 1, and Feb28/Feb29/Mar1 at UTC07:00. Invoice date, number year and due date(+16 calendar days) use the same Phoenix day. Server TZ must not change the result. | PASS: eight exact clock cases, PDF text, same-day retries and the 100 + 20 midnight carry match literal dates and cents. |
| T03 future work | Work10 dated tomorrow and20 on next year's date | Initial docs-derived expectation30 was incorrect. The existing source already has an upper billing-date cutoff. Correct safe oracle:0 today,10 tomorrow, then30 including the10 carried forward next year; future rows remain unstamped until eligible. | PASS with corrected oracle: 0 today, 10 on the first work date, 30 on the second; only eligible work is stamped. |
| C01 CSV notes | Descriptions beginning =,+,-,@, tab, CR; commas, quotes, newline, unicode; numeric amount columns | Export displays user text as text; no spreadsheet formula execution. Quotes/newlines preserve cell boundaries; numeric money remains numeric. Transaction descriptions are exported; payment/retainer/write-off notes have no direct CSV export. | PASS: risky prefixes are escaped; text cell boundaries and numeric columns survive; tenant/auth/read/body failures refuse unchanged. |
| A01 roles/sessions | Employee on manager/admin routes; another account's user; absent/expired/malformed session; revoked user; valid manager/admin/Super Admin | 401 for invalid sessions,403 for insufficient role/account. No mutation. Authorized operation succeeds. Privileged role never bypasses tenant boundaries. | PASS: invalid sessions return 401, unauthorized role/account returns 403, and valid admin receipt reduces the remaining balance to 60. |

## Business decisions that this pass must not guess

1. **OPEN — duplicate manual receipts/credits/work/retainers:** choose persisted
   request-id replay protection, duplicate-review confirmation, or treating every
   submission as a new event. Time-window suppression alone can discard real work.
2. **OPEN — retainer changes after draws:** existing chain repricing preserves
   applied draws but does not record cash refunds. Define the refund/audit flow.

## Execution observations

First values run:23 passing,285 failing. Many failures are the same missing
validation/HTTP 400 contract exercised with different inputs. The run also
reproduced retainer half-cent loss and successful edits that silently ignored
nonnumeric amounts or invalid dates. Raw evidence: `evidence/pass2/values-red.log`.

Expectation corrected: the long-note test initially trimmed the expected final
newline. The documented text round-trip preserves it; the assertion now requires
the entire original note, including that newline. No money oracle changed.

Calendar expectation corrected: the guide said all unbilled work regardless of
date, but the starting checkout's `invoice-service.getTransactionsByCustomerID`
already restricts transaction_date to the firm's billing date. Deferring future
work is the safe behavior. The test now requires0 before either service date,
10 on the first date, and30 after the second date including carried debt, and
checks invoice linkage at every step. The application was not changed to force
the outdated documentation's30-today expectation.

History test setup corrections: supplied the required timesheet date/duration/
notes columns before probing deletion. Message assertions now use the existing
public wording "attached to an invoice" and "Access denied for this user".
These corrections changed neither the expected refusal nor the unchanged-state
assertions. Confirmed history run:23 passing,2 failing (matched-user attribution
loss and false-success deletion of missing users).

Boundary extensions V07/L01 were tested with malformed customer IDs (undefined, null, empty, booleans, arrays, objects, nonnumeric, zero, negative, fractional, unsafe integer); all must refuse400 before coercion. Exact-limit Unicode text and99999999.99 succeed. User deletion is404 for malformed/missing/foreign IDs,409 for work/time attribution, and500 with unchanged state for an injected database failure. During a queued deletion, a concurrent work insert must fail rather than refer to a deleted employee; the existing foreign key provides that protection. The race test initially watched only queries mentioning users, missing the blocked transaction INSERT. Corrected the observation to any lock waiter in the scenario database; the financial expectation did not change.

The postcommit-response implementation briefly also affected a read-only employee report that shared its response builder. A regression test reproduced the incorrect committed-success response; the read path now retains its error response. This was an implementation regression caught during this pass, not a pre-existing app defect.

An existing acceptance test explicitly required the old missing-user deletion bug (200, marked GAP). It now requires404, the exact `User not found.` message, and unchanged account user rows. This strengthens the assertion for the corrected API contract.

Additional boundary oracles before execution: a null primary write-off reason
uses a supplied nonnull alias, matching the existing mapper. A bounded string
that grows beyond50 characters after XSS escaping must refuse400 before SQL.
Deleting the session's own Super Admin refuses400 with all user rows intact.
After100 is billed, rebilled and paid in full, both a payment and write-off
referencing the absorbed first statement refuse; the current balance stays0.

The boundary review added9 cases to the initial452-case Pass2 inventory. It caught two edges in the new validation: preserving the existing null-primary reason alias, and checking bounded text after XSS expansion on both create and update. The new validation now preserves the alias and rejects expanded overlong fields with400 before SQL. All11 input-validation refusal sites were exercised; the final inventory also explicitly exercises self-deletion and remapping to a zero-balance current invoice.

Final refusal review, oracle before execution: the active-retainer selection
read must return its legacy HTTP 200/body 500 failure when its database query
fails, never claim a committed mutation, and leave every financial row unchanged.
After restoring the read, a customer with work100 and one hold10 must return
that one hold and still have invoice preview100, billed balance0 and held funds10.

The final retainer-read failure and recovery case passed. This brings Pass 2 to **464 passing tests**, with no failed or pending cases. Full verification totals and the two OPEN policies are in [RESULTS-PASS2.md](RESULTS-PASS2.md).

## Final wrong-user update oracle — written before execution

X01: an update target that is missing, deleted, foreign, or malformed must return
HTTP 404 `User not found.` and preserve every user and financial row. Explicit
IDs exercised: omitted, null, empty, true, false, [], [1], {}, bogus, 0, -1, 1.5,
9007199254740992, missing 999999 and foreign 70001. Arrays and booleans must not
be coerced into another employee's ID.

L01: create a synthetic unused employee with billing rate 2; a valid update to
3 succeeds. An injected database UPDATE failure must return 500 and preserve
the complete user and ledger. After removing the fault, updating to 4 succeeds.
Deleting the unused employee succeeds, and a stale update then returns 404
without recreating that employee or changing anyone else.

The wrong-user update probe reproduced false success for missing and deleted
targets (80 passing / 2 failing), then passed all 82 boundary cases after the
scoped 404 fix. Its malformed-ID matrix also refuses before SQL. The initial
fault setup used the financial-only helper with the users table; that helper
correctly rejected the unsupported target. A local users UPDATE trigger now
injects the intended failure explicitly. The expected rollback was unchanged.
The old acceptance test marked GAP now requires 404 and unchanged users for
update as well as delete.

The existing concurrent-retainer acceptance test had a transport reset during
a full rerun. Its scoped HTTP listener now stays open until both requests
finish. One draw of 60 from 100 must leave 40; the other request must refuse,
with exactly one work/payment pair. No financial expectation changed. The
failed transport log and final rerun are retained in the Pass 2 evidence.

## Individual executed case index

The expected column below expands the hand-written oracle families above and the literal values embedded before each run. It does not use application calculations to generate expected amounts. The observed column comes from the final Mocha results; OPEN characterization cases demonstrate existing behavior without resolving policy. One test can include multiple HTTP requests and refusal checks.


### scenario-what-if-01-values.integration.spec.js

[Automated cases](../../test/integration/scenario-what-if-01-values.integration.spec.js) · 308 passing.

| Case | Input / sequence | Expected safe outcome or explicit OPEN characterization | Observed |
|---|---|---|---|
| P2-001 | V01 payment create refuses amount 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-002 | V01 payment create refuses amount 0.001 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-003 | V01 payment create refuses amount null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-004 | V01 payment create refuses amount "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-005 | V01 payment create refuses amount "  " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-006 | V01 payment create refuses amount "not-money" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-007 | V01 payment create refuses amount "Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-008 | V01 payment create refuses amount "-Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-009 | V01 payment create refuses amount "NaN" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-010 | V01 payment create refuses amount true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-011 | V01 payment create refuses amount false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-012 | V01 payment create refuses amount [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-013 | V01 payment create refuses amount [10] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-014 | V01 payment create refuses amount {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-015 | V01 payment create refuses amount 100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-016 | V01 payment create refuses amount -100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-017 | V01 payment create refuses amount 99999999.995 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-018 | V07 payment create refuses selectedInvoiceID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-019 | V07 payment create refuses selectedJobID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-020 | V07 payment create refuses selectedRetainerID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-021 | V07 payment create refuses selectedInvoiceID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-022 | V07 payment create refuses selectedJobID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-023 | V07 payment create refuses selectedRetainerID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-024 | V07 payment create refuses selectedInvoiceID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-025 | V07 payment create refuses selectedJobID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-026 | V07 payment create refuses selectedRetainerID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-027 | V07 payment create refuses selectedInvoiceID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-028 | V07 payment create refuses selectedJobID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-029 | V07 payment create refuses selectedRetainerID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-030 | V07 payment create refuses selectedInvoiceID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-031 | V07 payment create refuses selectedJobID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-032 | V07 payment create refuses selectedRetainerID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-033 | V07 payment create refuses selectedInvoiceID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-034 | V07 payment create refuses selectedJobID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-035 | V07 payment create refuses selectedRetainerID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-036 | V07 payment create refuses selectedInvoiceID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-037 | V07 payment create refuses selectedJobID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-038 | V07 payment create refuses selectedRetainerID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-039 | V06 payment create refuses formOfPayment longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-040 | V06 payment create refuses paymentReferenceNumber longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-041 | V06 payment create refuses invalid note true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-042 | V06 payment create refuses invalid note [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-043 | V06 payment create refuses invalid note {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-044 | V06 payment create refuses invalid note "\u0000" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-045 | V01 payment edit refuses amount 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-046 | V01 payment edit refuses amount 0.001 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-047 | V01 payment edit refuses amount null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-048 | V01 payment edit refuses amount "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-049 | V01 payment edit refuses amount "  " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-050 | V01 payment edit refuses amount "not-money" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-051 | V01 payment edit refuses amount "Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-052 | V01 payment edit refuses amount "-Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-053 | V01 payment edit refuses amount "NaN" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-054 | V01 payment edit refuses amount true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-055 | V01 payment edit refuses amount false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-056 | V01 payment edit refuses amount [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-057 | V01 payment edit refuses amount [10] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-058 | V01 payment edit refuses amount {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-059 | V01 payment edit refuses amount 100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-060 | V01 payment edit refuses amount -100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-061 | V01 payment edit refuses amount 99999999.995 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-062 | V07 payment edit refuses selectedInvoiceID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-063 | V07 payment edit refuses selectedJobID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-064 | V07 payment edit refuses selectedRetainerID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-065 | V07 payment edit refuses selectedInvoiceID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-066 | V07 payment edit refuses selectedJobID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-067 | V07 payment edit refuses selectedRetainerID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-068 | V07 payment edit refuses selectedInvoiceID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-069 | V07 payment edit refuses selectedJobID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-070 | V07 payment edit refuses selectedRetainerID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-071 | V07 payment edit refuses selectedInvoiceID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-072 | V07 payment edit refuses selectedJobID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-073 | V07 payment edit refuses selectedRetainerID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-074 | V07 payment edit refuses selectedInvoiceID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-075 | V07 payment edit refuses selectedJobID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-076 | V07 payment edit refuses selectedRetainerID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-077 | V07 payment edit refuses selectedInvoiceID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-078 | V07 payment edit refuses selectedJobID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-079 | V07 payment edit refuses selectedRetainerID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-080 | V07 payment edit refuses selectedInvoiceID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-081 | V07 payment edit refuses selectedJobID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-082 | V07 payment edit refuses selectedRetainerID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-083 | V06 payment edit refuses formOfPayment longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-084 | V06 payment edit refuses paymentReferenceNumber longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-085 | V06 payment edit refuses invalid note true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-086 | V06 payment edit refuses invalid note [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-087 | V06 payment edit refuses invalid note {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-088 | V06 payment edit refuses invalid note "\u0000" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-089 | V01 writeoff create refuses amount 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-090 | V01 writeoff create refuses amount 0.001 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-091 | V01 writeoff create refuses amount null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-092 | V01 writeoff create refuses amount "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-093 | V01 writeoff create refuses amount "  " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-094 | V01 writeoff create refuses amount "not-money" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-095 | V01 writeoff create refuses amount "Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-096 | V01 writeoff create refuses amount "-Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-097 | V01 writeoff create refuses amount "NaN" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-098 | V01 writeoff create refuses amount true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-099 | V01 writeoff create refuses amount false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-100 | V01 writeoff create refuses amount [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-101 | V01 writeoff create refuses amount [10] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-102 | V01 writeoff create refuses amount {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-103 | V01 writeoff create refuses amount 100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-104 | V01 writeoff create refuses amount -100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-105 | V01 writeoff create refuses amount 99999999.995 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-106 | V07 writeoff create refuses customerInvoiceID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-107 | V07 writeoff create refuses selectedJobID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-108 | V07 writeoff create refuses customerInvoiceID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-109 | V07 writeoff create refuses selectedJobID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-110 | V07 writeoff create refuses customerInvoiceID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-111 | V07 writeoff create refuses selectedJobID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-112 | V07 writeoff create refuses customerInvoiceID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-113 | V07 writeoff create refuses selectedJobID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-114 | V07 writeoff create refuses customerInvoiceID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-115 | V07 writeoff create refuses selectedJobID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-116 | V07 writeoff create refuses customerInvoiceID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-117 | V07 writeoff create refuses selectedJobID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-118 | V07 writeoff create refuses customerInvoiceID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-119 | V07 writeoff create refuses selectedJobID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-120 | V06 writeoff create refuses writeoffReason longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-121 | V06 writeoff create refuses invalid note true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-122 | V06 writeoff create refuses invalid note [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-123 | V06 writeoff create refuses invalid note {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-124 | V06 writeoff create refuses invalid note "\u0000" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-125 | V01 writeoff edit refuses amount 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-126 | V01 writeoff edit refuses amount 0.001 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-127 | V01 writeoff edit refuses amount null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-128 | V01 writeoff edit refuses amount "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-129 | V01 writeoff edit refuses amount "  " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-130 | V01 writeoff edit refuses amount "not-money" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-131 | V01 writeoff edit refuses amount "Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-132 | V01 writeoff edit refuses amount "-Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-133 | V01 writeoff edit refuses amount "NaN" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-134 | V01 writeoff edit refuses amount true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-135 | V01 writeoff edit refuses amount false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-136 | V01 writeoff edit refuses amount [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-137 | V01 writeoff edit refuses amount [10] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-138 | V01 writeoff edit refuses amount {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-139 | V01 writeoff edit refuses amount 100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-140 | V01 writeoff edit refuses amount -100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-141 | V01 writeoff edit refuses amount 99999999.995 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-142 | V07 writeoff edit refuses customerInvoiceID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-143 | V07 writeoff edit refuses selectedJobID=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-144 | V07 writeoff edit refuses customerInvoiceID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-145 | V07 writeoff edit refuses selectedJobID=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-146 | V07 writeoff edit refuses customerInvoiceID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-147 | V07 writeoff edit refuses selectedJobID={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-148 | V07 writeoff edit refuses customerInvoiceID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-149 | V07 writeoff edit refuses selectedJobID="text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-150 | V07 writeoff edit refuses customerInvoiceID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-151 | V07 writeoff edit refuses selectedJobID=-1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-152 | V07 writeoff edit refuses customerInvoiceID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-153 | V07 writeoff edit refuses selectedJobID=1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-154 | V07 writeoff edit refuses customerInvoiceID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-155 | V07 writeoff edit refuses selectedJobID="9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-156 | V06 writeoff edit refuses writeoffReason longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-157 | V06 writeoff edit refuses invalid note true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-158 | V06 writeoff edit refuses invalid note [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-159 | V06 writeoff edit refuses invalid note {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-160 | V06 writeoff edit refuses invalid note "\u0000" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-161 | V01 retainer create refuses amount 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-162 | V01 retainer create refuses amount 0.001 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-163 | V01 retainer create refuses amount null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-164 | V01 retainer create refuses amount "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-165 | V01 retainer create refuses amount "  " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-166 | V01 retainer create refuses amount "not-money" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-167 | V01 retainer create refuses amount "Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-168 | V01 retainer create refuses amount "-Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-169 | V01 retainer create refuses amount "NaN" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-170 | V01 retainer create refuses amount true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-171 | V01 retainer create refuses amount false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-172 | V01 retainer create refuses amount [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-173 | V01 retainer create refuses amount [10] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-174 | V01 retainer create refuses amount {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-175 | V01 retainer create refuses amount 100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-176 | V01 retainer create refuses amount -100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-177 | V01 retainer create refuses amount 99999999.995 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-178 | V06 retainer create refuses formOfPayment longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-179 | V06 retainer create refuses paymentReferenceNumber longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-180 | V06 retainer create refuses displayName longer than 100 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-181 | V06 retainer create refuses typeOfHold longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-182 | V06 retainer create refuses invalid note true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-183 | V06 retainer create refuses invalid note [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-184 | V06 retainer create refuses invalid note {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-185 | V06 retainer create refuses invalid note "\u0000" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-186 | V01 retainer edit refuses amount 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-187 | V01 retainer edit refuses amount 0.001 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-188 | V01 retainer edit refuses amount null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-189 | V01 retainer edit refuses amount "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-190 | V01 retainer edit refuses amount "  " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-191 | V01 retainer edit refuses amount "not-money" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-192 | V01 retainer edit refuses amount "Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-193 | V01 retainer edit refuses amount "-Infinity" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-194 | V01 retainer edit refuses amount "NaN" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-195 | V01 retainer edit refuses amount true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-196 | V01 retainer edit refuses amount false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-197 | V01 retainer edit refuses amount [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-198 | V01 retainer edit refuses amount [10] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-199 | V01 retainer edit refuses amount {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-200 | V01 retainer edit refuses amount 100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-201 | V01 retainer edit refuses amount -100000000 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-202 | V01 retainer edit refuses amount 99999999.995 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-203 | V06 retainer edit refuses formOfPayment longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-204 | V06 retainer edit refuses paymentReferenceNumber longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-205 | V06 retainer edit refuses displayName longer than 100 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-206 | V06 retainer edit refuses typeOfHold longer than 50 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-207 | V06 retainer edit refuses invalid note true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-208 | V06 retainer edit refuses invalid note [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-209 | V06 retainer edit refuses invalid note {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-210 | V06 retainer edit refuses invalid note "\u0000" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-211 | V05 payment create refuses date null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-212 | V05 payment create refuses date "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-213 | V05 payment create refuses date "no-date" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-214 | V05 payment create refuses date "2025-02-29" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-215 | V05 payment create refuses date "2026-02-30" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-216 | V05 payment create refuses date "2026-13-01" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-217 | V05 payment create refuses date "2026-01-32" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-218 | V05 payment create refuses date true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-219 | V05 payment create refuses date [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-220 | V05 payment create refuses date {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-221 | V05 payment edit refuses date null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-222 | V05 payment edit refuses date "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-223 | V05 payment edit refuses date "no-date" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-224 | V05 payment edit refuses date "2025-02-29" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-225 | V05 payment edit refuses date "2026-02-30" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-226 | V05 payment edit refuses date "2026-13-01" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-227 | V05 payment edit refuses date "2026-01-32" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-228 | V05 payment edit refuses date true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-229 | V05 payment edit refuses date [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-230 | V05 payment edit refuses date {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-231 | V05 writeoff create refuses date null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-232 | V05 writeoff create refuses date "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-233 | V05 writeoff create refuses date "no-date" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-234 | V05 writeoff create refuses date "2025-02-29" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-235 | V05 writeoff create refuses date "2026-02-30" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-236 | V05 writeoff create refuses date "2026-13-01" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-237 | V05 writeoff create refuses date "2026-01-32" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-238 | V05 writeoff create refuses date true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-239 | V05 writeoff create refuses date [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-240 | V05 writeoff create refuses date {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-241 | V05 writeoff edit refuses date null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-242 | V05 writeoff edit refuses date "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-243 | V05 writeoff edit refuses date "no-date" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-244 | V05 writeoff edit refuses date "2025-02-29" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-245 | V05 writeoff edit refuses date "2026-02-30" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-246 | V05 writeoff edit refuses date "2026-13-01" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-247 | V05 writeoff edit refuses date "2026-01-32" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-248 | V05 writeoff edit refuses date true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-249 | V05 writeoff edit refuses date [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-250 | V05 writeoff edit refuses date {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-251 | V06 writeoff create refuses required writeoffReason="" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-252 | V06 writeoff create refuses required writeoffReason="   " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-253 | V06 writeoff create refuses required writeoffReason=null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-254 | V06 writeoff create refuses required writeoffReason=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-255 | V06 writeoff create refuses required writeoffReason=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-256 | V06 writeoff create refuses required writeoffReason={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-257 | V06 writeoff edit refuses required writeoffReason="" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-258 | V06 writeoff edit refuses required writeoffReason="   " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-259 | V06 writeoff edit refuses required writeoffReason=null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-260 | V06 writeoff edit refuses required writeoffReason=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-261 | V06 writeoff edit refuses required writeoffReason=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-262 | V06 writeoff edit refuses required writeoffReason={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-263 | V06 retainer create refuses required typeOfHold="" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-264 | V06 retainer create refuses required typeOfHold="   " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-265 | V06 retainer create refuses required typeOfHold=null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-266 | V06 retainer create refuses required typeOfHold=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-267 | V06 retainer create refuses required typeOfHold=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-268 | V06 retainer create refuses required typeOfHold={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-269 | V06 retainer edit refuses required typeOfHold="" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-270 | V06 retainer edit refuses required typeOfHold="   " | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-271 | V06 retainer edit refuses required typeOfHold=null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-272 | V06 retainer edit refuses required typeOfHold=true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-273 | V06 retainer edit refuses required typeOfHold=[] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-274 | V06 retainer edit refuses required typeOfHold={} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-275 | V02/V03 payment create and edit 10 stores -10.00 | Create and edit store -10.00 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-276 | V02/V03 payment create and edit -10 stores -10.00 | Create and edit store -10.00 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-277 | V02/V03 payment create and edit 0.005 stores -0.01 | Create and edit store -0.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-278 | V02/V03 payment create and edit -0.005 stores -0.01 | Create and edit store -0.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-279 | V02/V03 payment create and edit 1.005 stores -1.01 | Create and edit store -1.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-280 | V02/V03 payment create and edit -1.005 stores -1.01 | Create and edit store -1.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-281 | V02/V03 payment create and edit 1.015 stores -1.02 | Create and edit store -1.02 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-282 | V02/V03 payment create and edit 2.675 stores -2.68 | Create and edit store -2.68 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-283 | V02/V03 payment create and edit 12.345 stores -12.35 | Create and edit store -12.35 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-284 | V02/V03 writeoff create and edit 10 stores -10.00 | Create and edit store -10.00 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-285 | V02/V03 writeoff create and edit -10 stores -10.00 | Create and edit store -10.00 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-286 | V02/V03 writeoff create and edit 0.005 stores -0.01 | Create and edit store -0.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-287 | V02/V03 writeoff create and edit -0.005 stores -0.01 | Create and edit store -0.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-288 | V02/V03 writeoff create and edit 1.005 stores -1.01 | Create and edit store -1.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-289 | V02/V03 writeoff create and edit -1.005 stores -1.01 | Create and edit store -1.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-290 | V02/V03 writeoff create and edit 1.015 stores -1.02 | Create and edit store -1.02 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-291 | V02/V03 writeoff create and edit 2.675 stores -2.68 | Create and edit store -2.68 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-292 | V02/V03 writeoff create and edit 12.345 stores -12.35 | Create and edit store -12.35 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-293 | V02/V03 retainer create and edit 10 stores -10.00 | Create and edit store -10.00 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-294 | V02/V03 retainer create and edit -10 stores -10.00 | Create and edit store -10.00 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-295 | V02/V03 retainer create and edit 0.005 stores -0.01 | Create and edit store -0.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-296 | V02/V03 retainer create and edit -0.005 stores -0.01 | Create and edit store -0.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-297 | V02/V03 retainer create and edit 1.005 stores -1.01 | Create and edit store -1.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-298 | V02/V03 retainer create and edit -1.005 stores -1.01 | Create and edit store -1.01 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-299 | V02/V03 retainer create and edit 1.015 stores -1.02 | Create and edit store -1.02 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-300 | V02/V03 retainer create and edit 2.675 stores -2.68 | Create and edit store -2.68 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-301 | V02/V03 retainer create and edit 12.345 stores -12.35 | Create and edit store -12.35 exactly; round the positive magnitude before applying the credit sign. | Matched (PASS) |
| P2-302 | V06 payment long unicode note round-trips with no financial edit | Preserve the complete 5,000-repeat Unicode note and final newline; store -10.00 for receipt/credit or -100.00 for hold. | Matched (PASS) |
| P2-303 | V06 writeoff long unicode note round-trips with no financial edit | Preserve the complete 5,000-repeat Unicode note and final newline; store -10.00 for receipt/credit or -100.00 for hold. | Matched (PASS) |
| P2-304 | V06 retainer long unicode note round-trips with no financial edit | Preserve the complete 5,000-repeat Unicode note and final newline; store -10.00 for receipt/credit or -100.00 for hold. | Matched (PASS) |
| P2-305 | V01 omitted retainer amount allows metadata update but explicit NaN cannot do so | Omission preserves starting/current amount and saves the note; explicit NaN refuses 400 with no partial note. | Matched (PASS) |
| P2-306 | V05 payment leap-day create and omitted date edit preserve February29 | Create on 2024-02-29; omitting the edit date preserves that exact stored date. | Matched (PASS) |
| P2-307 | V05 writeoff leap-day create and omitted date edit preserve February29 | Create on 2024-02-29; omitting the edit date preserves that exact stored date. | Matched (PASS) |
| P2-308 | V04 zero work and half-cent multiplication use literal expected cents | Zero succeeds; 0.01 × 0.50 rounds to 0.01. Supplied total 0 refuses. Each quantity/rate/total value -1, 0.005, null, empty, NaN text or 100000000 refuses unchanged. | Matched (PASS) |

### scenario-what-if-02-retries.integration.spec.js

[Automated cases](../../test/integration/scenario-what-if-02-retries.integration.spec.js) · 23 passing.

| Case | Input / sequence | Expected safe outcome or explicit OPEN characterization | Observed |
|---|---|---|---|
| P2-309 | D01 OPEN policy: two identical payment submissions are two events | OPEN policy characterization: two distinct -10.00 receipt rows; invoice/preview 100 → 80. | Confirmed; policy OPEN |
| P2-310 | D01 OPEN policy: two identical writeoff submissions are two events | OPEN policy characterization: two distinct -10.00 credits; preview 100 → 80, billed 0. | Confirmed; policy OPEN |
| P2-311 | D01 OPEN policy: two identical retainer submissions are two events | OPEN policy characterization: two -10.00 holds; held funds 20, preview 100, billed 0. | Confirmed; policy OPEN |
| P2-312 | D01 OPEN policy: two identical transaction submissions are two events | OPEN policy characterization: two 10.00 charges; preview 100 → 120, billed 0. | Confirmed; policy OPEN |
| P2-313 | D03 payment database failure rolls back and retry posts exactly once | Injected insert failure changes no financial row; retry creates exactly one 10.00 event, preview/billed 90. | Matched (PASS) |
| P2-314 | D03 writeoff database failure rolls back and retry posts exactly once | Injected insert failure changes no financial row; retry creates exactly one 10.00 event, preview 90, billed 0. | Matched (PASS) |
| P2-315 | D03 retainer database failure rolls back and retry posts exactly once | Injected insert failure changes no financial row; retry creates exactly one 10.00 event, preview 100, billed 0, held 10. | Matched (PASS) |
| P2-316 | D03 transaction database failure rolls back and retry posts exactly once | Injected insert failure changes no financial row; retry creates exactly one 10.00 event, preview 110, billed 0. | Matched (PASS) |
| P2-317 | D03 payment create refresh failure reports committed success | Success with committed=true and one reload warning; create occurs once, preview/billed 80. Do not instruct a retry. | Matched (PASS) |
| P2-318 | D03 payment edit refresh failure reports committed success | Success with committed=true and one reload warning; edit occurs once, preview/billed 80. Do not instruct a retry. | Matched (PASS) |
| P2-319 | D03 payment delete refresh failure reports committed success | Success with committed=true and one reload warning; delete occurs once, preview/billed 100. Do not instruct a retry. | Matched (PASS) |
| P2-320 | D03 writeoff create refresh failure reports committed success | Success with committed=true and one reload warning; create occurs once, preview 80, billed 0. Do not instruct a retry. | Matched (PASS) |
| P2-321 | D03 writeoff edit refresh failure reports committed success | Success with committed=true and one reload warning; edit occurs once, preview 80, billed 0. Do not instruct a retry. | Matched (PASS) |
| P2-322 | D03 writeoff delete refresh failure reports committed success | Success with committed=true and one reload warning; delete occurs once, preview 100, billed 0. Do not instruct a retry. | Matched (PASS) |
| P2-323 | D03 retainer create refresh failure reports committed success | Success with committed=true and one reload warning; create occurs once, preview 100, billed 0, held 20. Do not instruct a retry. | Matched (PASS) |
| P2-324 | D03 retainer edit refresh failure reports committed success | Success with committed=true and one reload warning; edit occurs once, preview 100, billed 0, held 20. Do not instruct a retry. | Matched (PASS) |
| P2-325 | D03 retainer delete refresh failure reports committed success | Success with committed=true and one reload warning; delete occurs once, preview 100, billed 0, held 0. Do not instruct a retry. | Matched (PASS) |
| P2-326 | D03 transaction create refresh failure reports committed success | Success with committed=true and one reload warning; create occurs once, preview 120, billed 0. Do not instruct a retry. | Matched (PASS) |
| P2-327 | D03 transaction edit refresh failure reports committed success | Success with committed=true and one reload warning; edit occurs once, preview 120, billed 0. Do not instruct a retry. | Matched (PASS) |
| P2-328 | D03 transaction delete refresh failure reports committed success | Success with committed=true and one reload warning; delete occurs once, preview 100, billed 0. Do not instruct a retry. | Matched (PASS) |
| P2-329 | D02/D03 storage failure then retry and double-click finalize issue one $100 statement | Storage failure leaves the ledger unchanged; retry finalizes one 100.00 statement; repeated click skips with no new writes. | Matched (PASS) |
| P2-330 | D03 read-only employee report refresh failure is500 and never claims committed success | Read failure returns legacy failure status 500, no committed flag, no writes; restored read succeeds. | Matched (PASS) |
| P2-331 | D03 active-retainer read failure is500 without writes; retry returns the saved hold | Legacy HTTP 200/body 500, no committed flag or writes; retry returns the one hold, preview 100/billed 0/held 10. | Matched (PASS) |

### scenario-what-if-03-history.integration.spec.js

[Automated cases](../../test/integration/scenario-what-if-03-history.integration.spec.js) · 25 passing.

| Case | Input / sequence | Expected safe outcome or explicit OPEN characterization | Observed |
|---|---|---|---|
| P2-332 | X01 receipt refuses different customer invoice and preserves both customers | Refuse wrong target; every financial row stays unchanged, A preview/billed 80, B preview 100/billed 0/held 100. | Matched (PASS) |
| P2-333 | X01 receipt refuses different customer job and preserves both customers | Refuse wrong target; every financial row stays unchanged, A preview/billed 80, B preview 100/billed 0/held 100. | Matched (PASS) |
| P2-334 | X01 receipt refuses different customer retainer and preserves both customers | Refuse wrong target; every financial row stays unchanged, A preview/billed 80, B preview 100/billed 0/held 100. | Matched (PASS) |
| P2-335 | X01 receipt refuses foreign customer and preserves both customers | Refuse wrong target; every financial row stays unchanged, A preview/billed 80, B preview 100/billed 0/held 100. | Matched (PASS) |
| P2-336 | X01 receipt refuses foreign job and preserves both customers | Refuse wrong target; every financial row stays unchanged, A preview/billed 80, B preview 100/billed 0/held 100. | Matched (PASS) |
| P2-337 | X01 receipt refuses missing invoice and preserves both customers | Refuse wrong target; every financial row stays unchanged, A preview/billed 80, B preview 100/billed 0/held 100. | Matched (PASS) |
| P2-338 | X01 receipt refuses missing retainer and preserves both customers | Refuse wrong target; every financial row stays unchanged, A preview/billed 80, B preview 100/billed 0/held 100. | Matched (PASS) |
| P2-339 | X01 absent/foreign 70001 cannot mutate any ledger | Payment/credit/retainer update and delete, plus work delete, each refuse not-found without changing either tenant. | Matched (PASS) |
| P2-340 | X01 absent/foreign 999999 cannot mutate any ledger | Payment/credit/retainer update and delete, plus work delete, each refuse not-found without changing either tenant. | Matched (PASS) |
| P2-341 | L01 customer with debt, job with work and invoice with payment cannot be deleted | Customer, linked job and paid invoice each refuse deletion; all links remain and preview/billed balance stays 80. | Matched (PASS) |
| P2-342 | L02 billed transaction amount edit refuses | Refuse each direct billed edit/delete without partial writes; customer A preview and billed balance stay 80. | Matched (PASS) |
| P2-343 | L02 billed transaction job edit refuses | Refuse each direct billed edit/delete without partial writes; customer A preview and billed balance stay 80. | Matched (PASS) |
| P2-344 | L02 billed transaction customer edit refuses | Refuse each direct billed edit/delete without partial writes; customer A preview and billed balance stay 80. | Matched (PASS) |
| P2-345 | L02 next statement locks its payment and writeoff against editing and deletion | Refuse each direct billed edit/delete without partial writes; customer A preview and billed balance stay 80. | Matched (PASS) |
| P2-346 | X01 stale absorbed invoice is remapped to the live chain, once | Receipt 10 remaps once: original absorbed root stays 0, current preview/billed 80 → 70; annotation names the remapping. | Matched (PASS) |
| P2-347 | L03 drawn retainer preserves $30 draw when increased; lower-than-drawn and deletion refuse | Starting hold 100/draw 30 leaves 70; edit to 120 leaves 90 with draw 30 intact; edit to 20 and delete refuse unchanged. Refund policy OPEN. | Matched; refund policy OPEN |
| P2-348 | L01 unused records delete successfully and stale IDs refuse | Unused hold/job/customer delete successfully; repeated delete and payment using deleted customer refuse without writes. | Matched (PASS) |
| P2-349 | L01 user who owns a time entry cannot be deleted or lose attribution | Refuse deletion and retain the full user/time/work attribution. Deactivation is the safe operation; no partial writes. | Matched (PASS) |
| P2-350 | L01 user matched to another uploader time entry cannot lose employee attribution | Refuse deletion and retain the full user/time/work attribution. Deactivation is the safe operation; no partial writes. | Matched (PASS) |
| P2-351 | L01 unused user deletion succeeds; missing, deleted and foreign targets are404 | Delete unused user once; deleted, missing and foreign IDs each return 404 and preserve all remaining users/time rows. | Matched (PASS) |
| P2-352 | A01 employee denied payment | HTTP 403; unchanged users, time entries and financial rows. | Matched (PASS) |
| P2-353 | A01 employee denied account settings | HTTP 403; unchanged users, time entries and financial rows. | Matched (PASS) |
| P2-354 | A01 employee denied user deletion | HTTP 403; unchanged users, time entries and financial rows. | Matched (PASS) |
| P2-355 | A01 employee denied employee foreign self read | HTTP 403; unchanged users, time entries and financial rows. | Matched (PASS) |
| P2-356 | A01 missing, expired, malformed, foreign and revoked sessions cannot write | Missing/expired/malformed/revoked sessions 401; foreign tenant 403; staff self-read/admin read succeed; valid admin receipt leaves A preview/billed 60. | Matched (PASS) |

### scenario-what-if-04-calendar-races.integration.spec.js

[Automated cases](../../test/integration/scenario-what-if-04-calendar-races.integration.spec.js) · 13 passing.

| Case | Input / sequence | Expected safe outcome or explicit OPEN characterization | Observed |
|---|---|---|---|
| P2-357 | T02 2024-02-29T06:59:00Z issues 2024-02-28, INV-2024-00001, due 2024-03-15 | 2024-02-28, INV-2024-00001, due 2024-03-15, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-358 | T02 2024-02-29T07:00:00Z issues 2024-02-29, INV-2024-00002, due 2024-03-16 | 2024-02-29, INV-2024-00002, due 2024-03-16, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-359 | T02 2024-03-01T06:59:00Z issues 2024-02-29, INV-2024-00003, due 2024-03-16 | 2024-02-29, INV-2024-00003, due 2024-03-16, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-360 | T02 2024-03-01T07:00:00Z issues 2024-03-01, INV-2024-00004, due 2024-03-17 | 2024-03-01, INV-2024-00004, due 2024-03-17, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-361 | T02 2026-12-01T06:59:00Z issues 2026-11-30, INV-2026-00001, due 2026-12-16 | 2026-11-30, INV-2026-00001, due 2026-12-16, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-362 | T02 2026-12-01T07:00:00Z issues 2026-12-01, INV-2026-00002, due 2026-12-17 | 2026-12-01, INV-2026-00002, due 2026-12-17, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-363 | T02 2027-01-01T06:59:00Z issues 2026-12-31, INV-2026-00003, due 2027-01-16 | 2026-12-31, INV-2026-00003, due 2027-01-16, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-364 | T02 2027-01-01T07:00:00Z issues 2027-01-01, INV-2027-00001, due 2027-01-17 | 2027-01-01, INV-2027-00001, due 2027-01-17, total 100.00; saved row and real PDF agree; same-day retry skips unchanged. | Matched (PASS) |
| P2-365 | T02 midnight allows the next calendar statement and carries $100 plus $20 once | Jan 31 statement total 100 becomes remaining 0; Feb 1 statement contains 100 carry + 20 work = 120, remaining 120. | Matched (PASS) |
| P2-366 | T03 future work stays unbilled until its date: $0, then $10, then $30 carried forward | Preview 0 before service dates, 10 tomorrow, then 30 including carry next year; future work keeps null invoice ID until eligible. | Matched (PASS) |
| P2-367 | T01 payment during rendering preserves $90 and refuses stale $100 rebill | Competing receipt persists: one original parent, preview/billed 90; stale 100 rebill refuses. | Matched (PASS) |
| P2-368 | T01 edit during rendering preserves $110 unbilled and refuses stale $100 invoice | Competing edit persists: unbilled work/preview 110, billed 0, no invoices; stale 100 finalize refuses. | Matched (PASS) |
| P2-369 | D02/T01 simultaneous finalizations produce one parent and one explicit conflict | Exactly one 100.00 parent and one explicit conflict envelope; no duplicate stamps; preview/billed 100. | Matched (PASS) |

### scenario-what-if-05-csv.integration.spec.js

[Automated cases](../../test/integration/scenario-what-if-05-csv.integration.spec.js) · 13 passing.

| Case | Input / sequence | Expected safe outcome or explicit OPEN characterization | Observed |
|---|---|---|---|
| P2-370 | C01 export safely round-trips "=1+1" as one text cell | Prefix an apostrophe to "=1+1" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-371 | C01 export safely round-trips "+1+1" as one text cell | Prefix an apostrophe to "+1+1" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-372 | C01 export safely round-trips "-1+1" as one text cell | Prefix an apostrophe to "-1+1" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-373 | C01 export safely round-trips "@SUM(1,1)" as one text cell | Prefix an apostrophe to "@SUM(1,1)" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-374 | C01 export safely round-trips "\t=1+1" as one text cell | Prefix an apostrophe to "\t=1+1" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-375 | C01 export safely round-trips "\r=1+1" as one text cell | Prefix an apostrophe to "\r=1+1" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-376 | C01 export safely round-trips "Résumé 日本語 🙂" as one text cell | Preserve "Résumé 日本語 🙂" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-377 | C01 export safely round-trips "A, \"quoted\"\nsecond line" as one text cell | Preserve "A, \"quoted\"\nsecond line" as one parsed cell; stored note/description unchanged, numeric amount/rate 10.00. | Matched (PASS) |
| P2-378 | C01 CSV exports are read-only and exclude the other tenant | Successful CSV excludes foreign transaction 70001; all database state unchanged. | Matched (PASS) |
| P2-379 | C01 export denies absent, employee and foreign sessions | Missing session 401; employee and foreign account 403; no database changes. | Matched (PASS) |
| P2-380 | C01 database export failure is explicit500, unchanged, and retry succeeds | HTTP 500 with explicit export error, no writes; restoring the query yields a successful CSV. | Matched (PASS) |
| P2-381 | C01 a long note over the application body limit refuses413 before any write | HTTP 413 before any write for a note longer than 1 MiB. | Matched (PASS) |
| P2-382 | C01 malformed JSON refuses400 before any write; valid empty note succeeds | HTTP 400 and unchanged ledger for malformed JSON; valid empty note creates work with null note. | Matched (PASS) |

### scenario-what-if-06-boundaries.integration.spec.js

[Automated cases](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js) · 82 passing.

| Case | Input / sequence | Expected safe outcome or explicit OPEN characterization | Observed |
|---|---|---|---|
| P2-383 | V01 payment refuses nonobject body undefined | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-384 | V01 payment refuses nonobject body null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-385 | V01 payment refuses nonobject body [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-386 | V01 payment refuses nonobject body true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-387 | V01 payment refuses nonobject body "text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-388 | V07 payment refuses malformed customerID undefined | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-389 | V07 payment refuses malformed customerID null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-390 | V07 payment refuses malformed customerID "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-391 | V07 payment refuses malformed customerID true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-392 | V07 payment refuses malformed customerID false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-393 | V07 payment refuses malformed customerID [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-394 | V07 payment refuses malformed customerID [1] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-395 | V07 payment refuses malformed customerID {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-396 | V07 payment refuses malformed customerID "bogus" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-397 | V07 payment refuses malformed customerID 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-398 | V07 payment refuses malformed customerID -1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-399 | V07 payment refuses malformed customerID 1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-400 | V07 payment refuses malformed customerID "9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-401 | V01 writeoff refuses nonobject body undefined | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-402 | V01 writeoff refuses nonobject body null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-403 | V01 writeoff refuses nonobject body [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-404 | V01 writeoff refuses nonobject body true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-405 | V01 writeoff refuses nonobject body "text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-406 | V07 writeoff refuses malformed customerID undefined | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-407 | V07 writeoff refuses malformed customerID null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-408 | V07 writeoff refuses malformed customerID "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-409 | V07 writeoff refuses malformed customerID true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-410 | V07 writeoff refuses malformed customerID false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-411 | V07 writeoff refuses malformed customerID [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-412 | V07 writeoff refuses malformed customerID [1] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-413 | V07 writeoff refuses malformed customerID {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-414 | V07 writeoff refuses malformed customerID "bogus" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-415 | V07 writeoff refuses malformed customerID 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-416 | V07 writeoff refuses malformed customerID -1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-417 | V07 writeoff refuses malformed customerID 1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-418 | V07 writeoff refuses malformed customerID "9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-419 | V01 retainer refuses nonobject body undefined | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-420 | V01 retainer refuses nonobject body null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-421 | V01 retainer refuses nonobject body [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-422 | V01 retainer refuses nonobject body true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-423 | V01 retainer refuses nonobject body "text" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-424 | V07 retainer refuses malformed customerID undefined | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-425 | V07 retainer refuses malformed customerID null | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-426 | V07 retainer refuses malformed customerID "" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-427 | V07 retainer refuses malformed customerID true | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-428 | V07 retainer refuses malformed customerID false | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-429 | V07 retainer refuses malformed customerID [] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-430 | V07 retainer refuses malformed customerID [1] | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-431 | V07 retainer refuses malformed customerID {} | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-432 | V07 retainer refuses malformed customerID "bogus" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-433 | V07 retainer refuses malformed customerID 0 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-434 | V07 retainer refuses malformed customerID -1 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-435 | V07 retainer refuses malformed customerID 1.5 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-436 | V07 retainer refuses malformed customerID "9007199254740992" | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-437 | V05 real calendar value 2000-02-29 is accepted | Accept the real calendar date; preserve its YYYY-MM-DD portion in the DATE column. | Matched (PASS) |
| P2-438 | V05 real calendar value 2024-02-29T23:59:59.999Z is accepted | Accept the real calendar date; preserve its YYYY-MM-DD portion in the DATE column. | Matched (PASS) |
| P2-439 | V05 real calendar value 2026-12-31T23:59:59-07:00 is accepted | Accept the real calendar date; preserve its YYYY-MM-DD portion in the DATE column. | Matched (PASS) |
| P2-440 | V05 invalid calendar value 0000-01-01 refuses | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-441 | V05 invalid calendar value 1900-02-29 refuses | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-442 | V05 invalid calendar value 2100-02-29 refuses | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-443 | V05 invalid calendar value 2026-01-01T99:00:00Z refuses | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-444 | V06 string limits count Unicode characters; exactly100 and50 fit | 100 Unicode display-name characters and 50 characters in each bounded payment/hold field store exactly. | Matched (PASS) |
| P2-445 | V01 largest representable retainer99999999.99 succeeds and can be deleted | Store -99999999.99 exactly; deletion of this unused root succeeds. | Matched (PASS) |
| P2-446 | V06 optional blank selections and write-off reason alias preserve their contracts | Undefined/null/empty selections remain null; each valid alias saves Alias reason and a null note. | Matched (PASS) |
| P2-447 | V06 null primary reason still uses the documented nonnull spelling alias | Use the supplied nonnull writeOffReason alias and store Fallback reason once. | Matched (PASS) |
| P2-448 | V06 payment text that exceeds its limit after XSS escaping refuses400 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-449 | V06 writeoff text that exceeds its limit after XSS escaping refuses400 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-450 | V06 retainer text that exceeds its limit after XSS escaping refuses400 | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-451 | V06 payment edit also checks length after escaping and preserves its previous note | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-452 | V06 writeoff edit also checks length after escaping and preserves its previous note | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-453 | V06 retainer edit also checks length after escaping and preserves its previous note | HTTP 400 with a clear field error; no partial write, financial rows/totals and other customers unchanged. | Matched (PASS) |
| P2-454 | L01 Super Admin cannot delete the current session user | HTTP 400 own-account refusal; all users and financial rows remain identical. | Matched (PASS) |
| P2-455 | X01 a stale invoice reference cannot revive a fully paid current chain | After 100 is billed, rebilled and fully paid, receipt and credit against the old ID both refuse; current balance stays 0. | Matched (PASS) |
| P2-456 | L01 work logged for an employee prevents deleting the employee | Refuse deletion and retain the full user/time/work attribution. Deactivation is the safe operation; no partial writes. | Matched (PASS) |
| P2-457 | L01 malformed deletion ID bogus gives404 | HTTP 404 User not found.; financial state unchanged. | Matched (PASS) |
| P2-458 | L01 malformed deletion ID 0 gives404 | HTTP 404 User not found.; financial state unchanged. | Matched (PASS) |
| P2-459 | L01 malformed deletion ID -1 gives404 | HTTP 404 User not found.; financial state unchanged. | Matched (PASS) |
| P2-460 | L01 malformed deletion ID 9007199254740992 gives404 | HTTP 404 User not found.; financial state unchanged. | Matched (PASS) |
| P2-461 | L01 database deletion failure leaves user and ledger unchanged; retry deletes unused user | Injected DELETE failure returns 500 and preserves the complete user row and ledger; retry deletes the unused user. | Matched (PASS) |
| P2-462 | L01 work arriving during user deletion must not acquire a deleted employee identity | User deletion succeeds; concurrent work insert refuses at the FK after the lock releases; no work references the deleted employee. | Matched (PASS) |
| P2-463 | X01 user update targets: omitted, null, empty, true, false, [], [1], {}, bogus, 0, -1, 1.5, 9007199254740992, missing 999999 and foreign 70001 | HTTP 404 User not found.; no coercion into another employee, no changed users or financial rows. | Matched (PASS) |
| P2-464 | L01 unused employee rate 2 → 3; injected UPDATE failure attempting 4; retry 4; delete and stale edit 5 | Valid edits persist rates 3 then 4. Database fault returns 500 and preserves every user/financial row; stale edit returns 404 and does not recreate the employee. | Matched (PASS) |
