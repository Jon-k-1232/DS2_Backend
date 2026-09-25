# Pass 4: mistakes through the actual screens

## Hand-written expectations before execution

All browser mutations use the existing local account 9001 on PostgreSQL 127.0.0.1:5433 (`ds2_local`) and MinIO 127.0.0.1:9000. API scenario tests use `ds2_scenarios*`. Account 1 and `ds2_ref_20260922` are read-only. Browser execution connects to the existing Playwright server at 127.0.0.1:3334, with one worker. No application/browser server is restarted.

The owner-confirmed boundary is fixed: drafts stay editable and write nothing to the ledger; finalize is sent and locks the invoice and its issued items.

The first five existing owner-decision cases have these independent expectations: 0.3 hours at $75/hour is $22.50; a draft produces no invoice or audit posting; finalize creates exactly one $22.50 issued invoice. A $25 retainer with a $5 refund leaves $20 available and does not change that $22.50 debt; $26 is refused. A sent charge cannot be removed as a duplicate. A reversed Audit Record date range creates no printed record; printing and reopening returns identical verified bytes without changing money. An employee cannot read that record through either the screen or API.

Additional planned oracles:

| Case | Expected saved state and visible result |
| --- | --- |
| Double submit payment/write-off/retainer/transaction/finalize | One operation while a request is pending; disabled progress control or success message. Starting with $22.50 debt, a $5 payment leaves $17.50; a $2 write-off then leaves $15.50. A separate $25 retainer is $25 available, not a second payment. A $20 transaction adds exactly $20. |
| Empty, negative, garbage and overlong input | Required/invalid values get an actionable field/error message; no invalid financial row. Negative payment/write-off/retainer receipts must not silently become valid opposite-signed postings. Valid long text must either round-trip exactly or be explicitly refused at the supported limit. |
| Cancel/mid-edit navigation/back after success | Unsaved edits do not persist; returning after one successful submit does not replay it. |
| Stale page after another session changes a record | Sent/deleted/changed records are refused where applicable with a useful message; immutable rows and audit evidence remain unchanged. |
| Month boundary and date range | Selected calendar dates survive without a timezone shift; inclusive date filters include the boundary exactly once. Reversed or impossible ranges are refused. |
| Filter/pagination | No-match shows an empty state; changing filters resets out-of-range pagination; clearing recovers the original rows without changed totals. |
| Employee manager pages | Clear Unauthorized page; API independently refuses; no ledger change. |
| Exceptions/reprints | A reason and eligible receipt are required. Only the narrow flagged exception permits its authorized reversal; original issued rows/PDF stay unchanged. Resolve requires a reprint/resend choice and preserves the original artifact. |
| Retainer adjustment/refund and duplicate flags | Required fields, available-credit limit and sent locks are enforced. Adjustment changes available credit only. Dismissal retains the record; allowed unbilled removal removes only the selected duplicate. |
| Optional credit and time increments | Credit starts unselected and needs explicit choice at finalize; six-minute increments remain 0.1 hour. |
| Audit Record client/full evidence | Both print types create separately listed immutable records, reopen byte-identically and verify. The client tab has business language, no raw JSON/internal table names. Client PDF has one archive summary per invoice/posting, plain verification instructions and no verification API path. Full evidence retains itemization. |
| Audit refusals/failures | Admin/super admin only, same tenant/customer; invalid IDs/ranges/types and missing records fail without metadata or money changes. Tampering is refused. Database/storage failures are visible, leave no financial changes and do not claim success. |

Execution results, corrected expectations, defects and remaining business questions are recorded in [RESULTS-PASS4.md](RESULTS-PASS4.md). Existing backend scenario/path-matrix suites provide the real database/storage fault injection coverage; browser cases will be mapped to those complementary branches rather than claiming mocked failures are end-to-end evidence.

### Expectation correction from the specification, before value-case execution

The initial negative-receipt refusal expectation above was too strict. The payment, write-off and retainer contracts explicitly accept either sign and store the negative magnitude. Therefore entering `-5` must create exactly one **$5 credit**, never a positive debt/reversal. Zero, nonfinite/garbage and out-of-range values still refuse. Charge quantities/rates must remain nonnegative. No accounting rule is changed to fit a test.

The duplicate contract also preserves a resolved, unchanged review: flagging the same pair again must return409 and retain the existing history. Removal is tested on a separate unbilled charge. A dismissed pair can reopen only after its candidate changes; that condition is covered by the backend duplicate scenarios.

Three older browser assertions predated the owner's sent-lock decision. They expected a fresh sent detail page to expose Delete, later receipts to rewrite issued invoice totals/membership, and the parent balance to change after an NSF reversal. The corrected expectations keep the issued parent at $22.50, show later $5 receipt / $2 write-off as current debt $15.50, and append the +$5 reversal to a live snapshot at $20.50. The original invoice's Payments/Write Offs tabs remain empty because those receipts arrived after its issue. Fresh sent pages show the lock; a separately tested stale, already-open delete must be refused by the server. These are specification corrections, not relaxed accounting assertions.

Two test sequencing corrections wait for the duplicate-removal response before inspecting the database (the earlier matcher accidentally matched its confirmation warning), and select Adjustment again after a successful retainer event reloads the profile's fresh form. Neither requires a product change.

### Additional exact oracles

- 26 independent charges at quantity2 × $10 produce $520 of unbilled work. Transactions page1 has20 rows; page2 has6. A no-match filter returns zero and resets pagination. Audit pagination retains the same $520 current balance.
- $22.50 work and a $50 unbilled write-off produce an optional **-$27.50** credit statement. With only this credit visible, bulk selection is disabled. Explicit row selection can finalize it. No payment or retainer is fabricated.
- $25 retainer + $5 increase − $10 decrease leaves $20. A different browser still showing $25 must receive a refusal when attempting a $25 refund, with exactly two successful journal events and no debt change.
- $22.50 issued debt − $5 new receipt − $2 new write-off is $15.50 on the next statement. A separate $25 retainer remains $25 available. Finalize locks the work, receipt, write-off and retainer; the first issued parent remains $22.50.
- A $5 receipt on a $22.50 debt is issued on the next statement at $17.50. An authorized bounced-check exception adds exactly one +$5 reversal, then a revision at $22.50. The original $17.50 parent and original PDF bytes remain unchanged; cancellation before reversal changes no money.
- The simple $22.50 Audit Record statement has one invoice balance and one work item: exactly **two statement copies in one archive summary** in the Client record. Full evidence retains both individual copies. Prints/reopens add nonfinancial audit actions, not additional charges.

### Additional delete-failure oracles, before execution

For an unissued $20 charge, $5 receipt, $2 write-off or $25 retainer, cancelling deletion or losing the delete request must leave every financial row unchanged and display a useful error. Retrying after the network recovers must remove exactly that eligible record; a deleted pending receipt/write-off restores the live $22.50 debt while the issued parent remains $22.50. A retainer whose linked-payment check fails must keep Delete disabled, explain the failed check and allow a page reload to retry. A failed check is never evidence that no payments are linked. These cases supplement the sent-lock refusals and successful deletion cases already specified above.

A $25 retainer funding $20 of work creates one $20 charge, one −$20 automatic payment and one new −$5 retainer snapshot; the original −$25 receipt remains. Deleting that used root must refuse with an explanation that its draws must first be undone. The automatic payment retains the root ID and marks its exact draw in its note. The root screen must therefore show the linked payment and disable Delete; deleting the draw snapshot must receive the server's originating-entry refusal. Both attempts preserve every financial row and leave customer debt $0 and available retainer credit $5. This closes the earlier browser suite's documented used-retainer deletion gap.

## Browser and backend refusal coverage

Browser actions use the real running app. Request-delay checks hold and release real HTTP requests; no success response is fabricated. Browser network-failure cases explicitly abort a request before sending it and are labeled as transport tests. Actual database/storage rollback faults are exercised by the real application in the scenario suites below, without stopping a shared server.

| Feature | Real browser proof | Complementary real backend proof |
| --- | --- | --- |
| Payment/write-off/retainer/time/charge forms | `user-mistakes-financial`: pending doubles, empty/zero/negative/garbage/excessive values, cancel/back, network failure/retry, long text and date boundary; exact local DB rows | Lifecycle01–04,07–10; what-if01–06; path-matrix03,09,10,14,15. Raw shape/date/amount/text validation, permissions/tenant/not-found/dependencies, locks and DB/storage/postcommit failures |
| Financial deletion errors | `user-mistakes-delete`: cancelled/network-failed deletion preserves all money; eligible retry deletes exactly one entry; failed retainer dependency check disables Delete until reload | Lifecycle01–04,07–10; path-matrix03,09,10,14,15. Server refusals, dependency checks, tenant/role, missing/stale IDs and rollback failures |
| Sent boundary and exceptions | Original five path-matrix checks; `user-mistakes-decisions`: double finalize, two-session stale delete/payment, four locked financial screens, flag/cancel/reverse/revision/original-byte preservation | Lifecycle12 and16; path-matrix03,09,10,15. Every exception state, condition, eligible receipt, missing/foreign IDs, role/tenant, used excess, retainer-funded refusal, revisions, raw import locks and storage rollback |
| Retainer events | Original refund/overdraft check; `user-mistakes-navigation`: invalid preview, both adjustment directions and stale refund refusal | Lifecycle13 and16; path-matrix09,10,15. Exhaustion, roots, ranges, fields, role/tenant/not-found, serialized draw/refund, DB/storage rollback |
| Duplicate flags | Original sent-removal lock; `user-mistakes-decisions`: missing record, reason, dismissal, repeat conflict and separate unbilled removal | Lifecycle14 and16; path-matrix09,10,15. Scan/manual/automatic matches, resolved/changed candidates, canonical/tenant/role/lock conflicts, removal and fault rollback |
| Credit statements/time increments | `user-mistakes-decisions`: credit bulk exclusion and explicit -$27.50 issue; `user-mistakes-financial`: 0.25h rounds to0.3h × $75=$22.50 | Lifecycle15–17 plus frontend credit selection/time tests. Stale selected debit becoming credit, zero boundary, mixed batch, strict options and selection IDs, date/minute boundaries, DB/storage failures |
| Audit Record | `user-mistakes-audit`: both print types/list/reopen/hash/verify, plain text and archive summary, dates, invalid API inputs, missing/foreign records, tampering route refusal, employee isolation and read-only super-admin access | Lifecycle18, path-matrix16 and migration026/027 tests. Every route's auth/role/tenant/not-found/DB failure, metadata/log tamper triggers, both PDF/evidence storage failures, renderer errors, corrupted archive/PDF/identity/chain/anchor, actor attribution, concurrent snapshots and rollback |
| Pagination/filters | 26 real UI charges, page2→no-match→page1; Audit history page/range reset with unchanged$520 | Existing frontend grid/AuditRecord Jest plus backend pagination/range cases |

The earlier [path matrix](path-matrix.md) supplies the source-site inventory and individual test links; this pass reruns those suites. Its original browser-launch limitation is resolved by the supplied external Playwright server. Neither its historical count nor this table substitutes for the fresh per-suite results in `RESULTS-PASS4.md`.

## PDF visual review

The two-page Client record and four-page Full evidence record from the browser were rendered with Poppler and every page inspected. Text and amounts remain within margins, ledger columns align, summaries/itemization remain readable and verification text is complete. Local evidence is in `evidence/pass4/pdf/`. Client copy: two statement items, one archive summary, no API path; full evidence: both individual copies and verified source retrieval information. No PDF renderer change was needed.

### Used-retainer identity correction

The first added used-retainer browser assertion incorrectly equated the work row's `retainer_id` with the payment's `retainer_id`. The documented contract in `ledger/payments.md` and `buildAutoRetainerPayment` instead keeps the payment's chain root and uses `[retainer_draw:N]` for its exact draw. The test now asserts both IDs and that exact marker, preserving the original $25 → $5 arithmetic. Accordingly, the root screen displays its linked-payment guard; the child screen receives the server refusal directing correction through the originating payment/work. This is an expectation correction, not an accounting change.
