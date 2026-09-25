# Ledger documentation review findings

Reviewed 2026-09-24. Application code was read only. No git commands, integration tests, database writes or cloud operations were run. Paths are relative to `DS2_Backend`. Findings distinguish pure/mock reproductions from source-level reproduction ideas. Severity follows the requested scale: P1 data loss/leak, P2 wrong result, P3 minor.

## LEDGER-01 — P2 wrong result: hidden write-offs can credit an invoice/job row twice

- **Source:** `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:52`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:72`; compare `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`. The API allows a write-off carrying both invoice and job: `src/endpoints/writeOffs/writeOffs-logic.js:85`.
- **What happens:** With Show Write Offs off, `groupWriteOffsByJob` includes invoice-linked rows. When that job also has unbilled work, job initialization adds the credit without excluding its invoice link. A current-chain credit has already reduced outstanding balance, so the bill credits it a second time. The adjustment-only-group path correctly excludes invoice-linked rows, but the existing-work path does not.
- **Concrete reproduction:** A current statement started at $100. A -$20 write-off linked to its child and job 7 leaves $80. Add $100 unbilled work to job 7. Supply those records to `calculateInvoices`, with linked chain date equal to the last bill date. `showWriteOffs:false` returns outstanding $80, transaction total $80, write-off contribution $0, due **$160**. `true` returns $80 + $100 + $0 = **$180**.
- **Evidence:** Reproduced with the existing pure Node calculator using in-memory objects. No database or files were changed. `test/endpoints/payments/payment-integrity.spec.js:23` covers the single-count rule but not this mixed invoice/job/work shape.
- **Suggested fix:** Exclude invoice-linked rows from the hidden job-credit contribution. Keep their eligible contribution exclusively in `writeOffCalculations`. Add a regression using both current and absorbed linked-chain dates, with same-job work present, and assert that the display option cannot change amount due.

## LEDGER-02 — P1 data loss: one rejected extraction row rolls back earlier good rows

- **Source:** `../DS2_Lambdas/Process_Payment_Images/database.py:138`, especially rollback at line 175 and final commit at line 177; downstream archive at `../DS2_Lambdas/Process_Payment_Images/pipeline.py:255` and `../DS2_Lambdas/Process_Payment_Images/pipeline.py:267`.
- **What happens:** All inserts share a transaction. On any row failure, `conn.rollback()` removes all successful inserts since the last rollback. The loop continues and commits later rows. The insertion counter still includes rows that were rolled back. The caller receives no failure manifest and proceeds to archive/delete source files.
- **Concrete reproduction:** Process valid row A, invalid-date row B, then valid row C in one batch. A is inserted into the open transaction; B throws and rolls A back; C commits. The queue contains only C, while the counter can report two inserted rows and the file can leave the pending prefix.
- **Evidence:** A read-only AST-extracted invocation of the real writer with a fake transaction-aware connection produced committed rows `['good-C']` and reported inserted count 2. No PostgreSQL connection was made. Existing Lambda tests at `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:141` do not establish rollback isolation.
- **Suggested fix:** Choose and implement explicit import semantics: either validate/commit the entire file and propagate any failure, or use a savepoint per row and retain a durable rejected-row record. Report only committed rows. Archive/remove the pending source only after the selected durability condition is met.

## LEDGER-03 — P1 data loss: archive upload failure still permits source deletion

- **Source:** `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:28`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:84`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:267`.
- **What happens:** `upload_to_s3` catches the archive upload exception and returns normally. `move_to_processed` does not expose success/failure. Outside local stage, the caller then deletes the pending source object. A failed archive can leave no copy under either expected prefix, losing the original payment evidence.
- **Concrete reproduction:** In a non-local run, let extraction/DB handling return normally, make `upload_file` raise, and let `delete_object` succeed. The archive object is absent and the original pending key is deleted. The same archive/delete sequence applies after PDF redaction and to supported batch inputs.
- **Evidence:** A read-only fake-dependency invocation of the actual pipeline/upload functions made archive upload fail and still observed deletion requested for `deposit.csv`. No S3 calls or filesystem changes were made by the harness.
- **Suggested fix:** Propagate upload errors or require an explicit successful archive result. Verify the intended archived object before source removal. Keep the pending source and record a retryable failure when archiving fails.

## LEDGER-04 — P2 wrong result: duplicate-preserving source suffix breaks file identity

- **Source:** `../DS2_Lambdas/Process_Payment_Images/database.py:113`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:25`; exact-name consumers at `src/endpoints/pendingPayments/pendingPayments-service.js:150`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`, `src/endpoints/pendingPayments/pendingPayments-router.js:337`, `src/endpoints/pendingPayments/pendingPayments-router.js:412`.
- **What happens:** The second same-payer/same-amount row is stored with a synthetic source like `deposit.pdf#dup2-ref102`. S3 stores only `deposit.pdf`. The second row becomes a separate file-list group; preview tries nonexistent suffixed keys, and file-level state/deletion checks see only rows with the selected exact string. One physical deposit file can appear to be several unrelated files.
- **Concrete reproduction:** One PDF contains two $100 checks from the same payer, references 101 and 102. Fingerprint dedup preserves them because references differ. DB writer inserts sources `deposit.pdf` and `deposit.pdf#dup2-ref102`. Preview the second row: ownership passes but both S3 lookups miss. Approve only the suffixed row, then inspect/delete the unsuffixed file group: its processed check does not see the approved sibling.
- **Evidence:** Source-level dataflow; the suffix behavior is asserted by `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:174`. No HTTP/S3 reproduction was run.
- **Suggested fix:** Store canonical source object identity separately from a per-payment dedup identifier. Include date/reference or a stable extraction receipt ID in dedup without altering source filename. Use that shared file identity for preview, grouping, ownership and all file-level approval/deletion checks; migrate existing suffixed rows deliberately.

## LEDGER-05 — P2 wrong result: soft-delete can hide a concurrently approved payment

- **Source:** `src/endpoints/pendingPayments/pendingPayments-router.js:112`, `src/endpoints/pendingPayments/pendingPayments-service.js:101`; compare approval lock/update at `src/endpoints/pendingPayments/pendingPayments-router.js:170`.
- **What happens:** Single-row deletion checks state with an unlocked read, then updates only by account/ID. Approval uses `FOR UPDATE`, but deletion does not recheck state after waiting for that lock. A processed row can end with `deleted=true`, disappearing from normal lists/counts while its posted money remains.
- **Concrete reproduction:** Pause deletion after it reads a new row. Approve and commit that row in a second request. Resume deletion. Its unconditional update sets `deleted=true` on the now-processed row and returns success. The normal `new/processed/all` lists exclude it.
- **Evidence:** Source-level interleaving; no concurrent database test was run. Ordinary processed/deleted refusals are tested at `test/integration/coverage-payments-pending.integration.spec.js:988`, not this stale-read interleaving.
- **Suggested fix:** Take the same row lock and validate in a transaction, or condition the update on `is_payment_processed=false AND deleted=false` and check affected count. Return a state conflict if approval won. Coordinate file deletion with approval too; its processed check and S3 deletion are separate from its conditional row update.

## LEDGER-06 — P2 wrong result: file deletion leaves archived evidence accessible

- **Source:** `src/endpoints/pendingPayments/pendingPayments-router.js:351`, `src/endpoints/pendingPayments/pendingPayments-router.js:404`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`.
- **What happens:** DELETE file says the file and associated payments were deleted, and a comment says both locations are handled. The only S3 deletion is the pending-prefix key. Normally extracted files are already archived. The archive survives, and file preview still authorizes via soft-deleted rows. S3 delete failure is also suppressed while returning success.
- **Concrete reproduction:** Extract a PDF so it is in `processed_payments/<month>/`, but do not approve its rows. DELETE its filename. Expect HTTP 200 and hidden queue rows. GET file-preview with the same filename still finds and returns the archived PDF because deleted rows remain ownership evidence.
- **Evidence:** Source-level path comparison. `test/integration/coverage-pending-payments-authz.integration.spec.js:264` checks an owned object deletion, not removal of an archived object and subsequent preview denial.
- **Suggested fix:** Decide whether this action means retained-evidence dismissal or actual file deletion. If deletion, resolve/persist the canonical archive key and delete it with explicit failure handling, then enforce intended preview state. If retention is intended, make the UI/API message and allowed preview contract say so instead of claiming removal.

## LEDGER-07 — P3 minor: backend owner role cannot reach ledger UI

- **Source:** `src/endpoints/auth/jwt-auth.js:94`, `src/app.js:143`, `src/app.js:145`, `src/app.js:155`; `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.
- **What happens:** Backend `requireManagerOrAdmin` admits `owner` alongside manager/admin/super admin. The frontend protected route only admits the latter three. An otherwise valid owner is denied the pages for APIs they are authorized to call.
- **Concrete reproduction:** With an active `owner` account session, call the same-account payment list, then navigate to `/transactions/customerPayments`. The API passes the role gate; the frontend returns its unauthorized view.
- **Evidence:** Source-level role-set comparison; no account/session was created.
- **Suggested fix:** Confirm the intended owner role and make frontend/backend role sets consistent. Add a role-matrix assertion for all four allowed backend roles and a denied ordinary employee.

## LEDGER-08 — P2 wrong result: accepted uppercase PDF extension misses configured trigger

- **Source:** `src/endpoints/pendingPayments/pendingPayments-router.js:251`, `src/endpoints/pendingPayments/pendingPayments-router.js:278`; `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:248`.
- **What happens:** Upload lowercases the extension for validation but preserves the original filename in the S3 key. Checked-in S3 notification configuration has suffix `.pdf`. An accepted `receipt.PDF` key does not end in that configured suffix, so this notification does not invoke the processor. Upload created no DB row, so it also does not appear in the DB-derived file list.
- **Concrete reproduction:** In an environment using the checked-in notification, upload valid bytes as `receipt.PDF` from account 1. Upload succeeds and writes the uppercase key. Compare with `receipt.pdf`: only the lowercase key matches the notification suffix. The uppercase upload has no extraction queue/file-list row unless another process handles it.
- **Evidence:** Static validation/key/trigger comparison. Actual deployed notification settings were not queried; whether another deployed trigger exists is **not determined from the code**.
- **Suggested fix:** Normalize the stored extension/name and return that canonical identity, or configure a prefix-only notification and retain extension filtering in the handler. Add an upload-to-trigger contract check for `.pdf`, `.PDF` and mixed case.

## LEDGER-09 — P2 wrong result: billing-review edits leave job-family totals stale or partial

- **Source:** `src/endpoints/billingReview/cascadeEdit.js:281`, called at `src/endpoints/billingReview/cascadeEdit.js:691`; compare ordinary family aggregation at `src/endpoints/transactions/sharedTransactionFunctions.js:461` and family ID lookup at `src/endpoints/job/job-service.js:77`. Customer profile takes the latest child's stored total at `src/endpoints/customer/customer-router.js:165`.
- **What happens:** Cascade edits sum transactions for only the exact old/new job ID and update that exact row. Jobs are version families; work can remain attached to earlier versions. Editing earlier-version work leaves the latest displayed family total unchanged. Editing the latest version can overwrite its total with only the transactions attached to that version, omitting older work.
- **Concrete reproduction:** Job root 10 has $100 work; latest child 11 has $200 work and stored family total $300. Use billing review to change the root-linked work to $150. Cascade recomputation writes $150 on root 10 but leaves child 11 at $300. The customer profile still displays $300; the actual family is $350. A latest-child edit can instead drop the root's contribution.
- **Evidence:** Executed the exact exported helper definition extracted from source with an in-memory query stub: `rootStored=150`, `latestStored=300`, `expectedFamilyTotal=350`. No DB was used. The inspected fixture at `test/integration/cascade-edit-recompute.integration.spec.js:102` creates a single job row; it does not establish multi-version aggregation.
- **Suggested fix:** Recompute by resolved job family and update/create the authoritative latest version consistently with the ordinary transaction workflow, under existing customer locks. Because cascade recomputes after the work update, avoid applying the amount delta twice. Cover edits/moves across earlier/latest versions and within/across families.

## Completion summary

Files written: the five feature documents in `docs/ledger/` and this findings file. Endpoints covered: **27** (26 routes in the four assigned routers plus the supporting billing-review transaction adjustment route). Findings: **9** — **2 P1**, **6 P2**, **1 P3**. No application code or database was changed.
