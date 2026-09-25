# Owner billing decisions — run 1 results

Implementation: decisions 3 and 5. The complete five-decision design was written first in [the owner record](2026-09-24-owner-decisions.md). Decisions 1 (retainer refunds/adjustments), 2 (optional credit statements) and 4 (duplicate flags/removal) remain planned for later runs.

## Built

- Finalize is the explicit sent boundary because DS2 has no independent sent/emailed/mailed state. Issuance atomically archives rendering input, original artifact reference, ledger membership and revision 0/history. Drafts remain unissued.
- Server preflight plus database triggers refuse mutation/deletion of issued invoice rows, stamped work, statement receipts/write-offs/retainers, indirect Billing Review changes, customer deletion, job reassignment and import/upsert writes. HTTP409 identifies the owning invoice. New activity uses fresh snapshots/unbilled work.
- Exception state machine: flag selected bounced receipts with reason/actor/time; reverse exactly those receipts once; issue an immutable numbered revision or roll forward once. Cancellation is allowed before reversal. Original records/PDFs remain unchanged. Unused bounced excess credit is cancelled with a new locked snapshot; already-used excess refuses atomically.
- Every revision ZIP contains a marked correction PDF and the exact original PDF for reprint/resend together. The application does not claim physical/mail/email delivery. Current balance remains separate from revised issued amount.
- Invoice history, lock indicators, guarded edit/delete/reversal forms, selected-payment exception controls, archived downloads and latest-snapshot payment dropdowns are implemented in the frontend.

## Migration and routes

`023.sent_invoice_locks.sql` was manually applied with `psql -X -1 -v ON_ERROR_STOP=1 -f` to ds2_local, ds2_clean and ds2_scenarios on 127.0.0.1:5433. It is additive/idempotent, includes seven tables and eleven triggers, and rewrites no existing business rows. Scenario reset includes 023; migrate count and migration specs are updated. Production rollout instructions are in [operations](../platform/operations.md) and FINAL_REPORT section 6; no production rollout was performed.

New account-authorized routes:

| Method | Route |
|---|---|
| GET | `/invoices/:invoiceID/history/:accountID/:userID` |
| POST | `/invoices/:invoiceID/exceptions/:accountID/:userID` |
| POST | `/invoices/:invoiceID/exceptions/:exceptionID/reverse/:accountID/:userID` |
| POST | `/invoices/:invoiceID/exceptions/:exceptionID/resolve/:accountID/:userID` |

All routes use session attribution, scoped IDs, validation/state checks and transactional failures. Existing invoice/ledger/Billing Review/customer/job mutation contracts now return409 for sent dependencies. See [complete API contracts](../invoicing/invoices.md#3-api-reference).

## Validation

All required commands completed serially. **0 failures; 0 pending/skipped tests.** Counts below include the explicitly requested repeated scenario/clean-room executions; they are not a claim of unique tests across commands.

| Check | Observed result |
|---|---|
| Backend unit command | 1,008 passing |
| All integration files, one file per process | 1,948 passing across 59 files |
| Dedicated `npm run -s test:scenarios` | 791 passing |
| Dedicated `npm run -s test:cleanroom` | 18 passing |
| Drift (`/tmp/drift.json`) | 0 differences across 319 account 1 customers, both engine/Audit and billed/AR |
| Frontend jest | 127 passing across 31 suites |
| `CI=true npm run build` | passed |
| New lock/exception integration suite | 72 passing |
| Revision PDF render | 1 Letter page, visually inspected; original archived bytes separately verified |

Commands follow the owner's supplied forms. Unit used `.env.local`. Each integration file ran alone: ordinary files use `.env.local`; scenario files use `.env.scenarios` to satisfy their strict sandbox guard; clean-room uses `.env.clean`; the two account-creation integration files use `DATABASE_NAME=ds2_clean` so no account outside 9001 is created in ds2_local. The migration/review-tool tests also reuse only ds2_clean. Dedicated scenarios/clean-room and the requested drift command then ran, followed by frontend jest/build. Nothing restarted the running local servers; API tests load the changed backend in their test process.

Machine-readable per-file counts and log locations: [validation.json](evidence/run-1/validation.json). Raw logs remain under `/tmp/ds2-owner-final/`. Migration application logs and the rendered synthetic revision example are in the same evidence directory. Hand-computed monetary cases and the fault matrix are in [the owner scenario oracle](../scenarios/09-owner-sent-exceptions.md). Documentation local-link validation found 0 broken paths.

## Changes to old rules

Issued parents no longer mirror live balances, payment/write-off totals or paid flags. Current debt lives on latest children; absorption appends a zero closing child with the existing marker. Empty issued invoices cannot be deleted. Sent Billing Review edits (including notes/no-op/job/customer moves) now refuse; unissued cascade success and rollback tests remain. Direct reversals and retainer edits cannot bypass the sent lock. Detail tabs preserve issue-time inputs and payment selectors resolve current snapshots. Scenario dates/corruption/teardown use a guarded fixture-only bypass; application code has none.

The old suite expectations were replaced explicitly, preserving unissued CRUD and numerical coverage. Two admin-guard tests now isolate/restore pre-existing account 9001 fixture roles rather than assuming a fresh admin population. Test-created stale tracker fixtures from an interrupted teardown were cleaned only within account 9001.

## Data boundary and open items

Only local PostgreSQL and MinIO were used. No git commands, commits, production/AWS connections or server restarts occurred. Account 1 counts match the pre-run values and ds2_ref_20260922 exactly. Reference access was only the requested SELECT comparison, with `default_transaction_read_only=on`; it was never modified.


| Account 1 table | Before = after = reference |
|---|---|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

No new owner business question is open for decisions 3/5. Before production rollout, reconcile historical issuance/archive evidence, including missing artifacts and any totals edited before this lock existed; this run does not infer or reconstruct them. A historical revision with incomplete renderer input encloses its archived original. A storage upload followed by DB failure can leave an unreferenced unique blob; referenced originals are never overwritten. Decisions 1/2/4 and any additional exception conditions beyond bounced checks belong to later runs.
