# Platform findings

Read-only source review, 2026-09-24. These are specific source-level defects, not claims of observed production incidents. Reproduction ideas below are for a separately authorized isolated test environment. No database/S3 mutation or integration test was performed during this task. Backend-relative paths unless prefixed with the Lambda repository.

Severity: P1 = data loss/leak; P2 = wrong result; P3 = minor. Findings are numbered once even when several guides refer to them.

## PLAT-01 — P1: ordinary users receive privileged financial collections in initialBlob

**Source:** `src/app.js:131`, `src/app.js:138`, `src/app.js:147`; `src/endpoints/initialData/initialData-router.js:22`, `src/endpoints/initialData/initialData-router.js:56`, `src/endpoints/initialData/initialData-router.js:79`, `src/endpoints/initialData/initialData-router.js:190`.

**What happens:** Direct financial routers require Manager/Admin/Super Admin/Owner, but initialBlob only requires authentication and own account. It strips employee rates/email for a User and still returns customer records, transactions, invoice balances, payments, write-offs, jobs and retainers. Thus the direct-route role barrier does not protect equivalent financial data obtained at bootstrap. This is an intra-account role leak, not a cross-account claim.

**Reproduction idea:** Authenticate as a User in a fixture account with one payment/invoice/transaction. Confirm a direct protected ledger read returns 403. Request `/initialData/initialBlob/<own account>/<own user>` and inspect financial arrays/grids for the same records.

**Suggested fix:** Build the bootstrap payload by authenticated role, with a minimal employee directory/template payload for ordinary users. Exercise all JSON branches/grids in a negative-role test, not only users.cost_rate/billing_rate/email.

## PLAT-02 — P1: generic invoice download bypasses the audit-PDF role gate

**Source:** `src/app.js:138`; `src/endpoints/accountAudit/account-audit-router.js:37`, `src/endpoints/accountAudit/account-audit-router.js:382`; `src/endpoints/invoice/invoice-router.js:398`; `src/utils/downloadAuthorization.js:40`.

**What happens:** The audit router requires Super Admin, but the generic invoice downloader accepts own-account `account_audits/<accountID>/` keys for Manager/Admin/Owner as well. A caller who knows a valid own-account audit object key can obtain the audit PDF through the broader route. Knowing the key is required; no claim of directory enumeration is made.

**Reproduction idea:** Create a fixture saved audit with an S3 object. As a Manager, request its audit-PDF endpoint (403), then request `/invoices/downloadFile/<account>/<user>?fileLocation=<same audit key>` and compare returned bytes.

**Suggested fix:** Keep audit objects out of the generic invoice prefix list, or apply the same Super Admin gate when authorizing an audit key. Test the same sensitive object through every download surface.

## PLAT-03 — P2: rejected automation update deletes recipients and can widen email delivery

**Source:** `src/endpoints/account/automation-settings-service.js:56`, `src/endpoints/account/automation-settings-service.js:71`, `src/endpoints/account/automation-settings-service.js:112`; `src/automations/automationScripts/timeTrackerReminders.js:24`.

**What happens:** Recipient replacement deletes current recipients before checking whether new IDs are active own-account users. A foreign/inactive ID triggers 400 after deletion. If isEnabled was supplied, that upsert already committed too. Reminder selection treats an empty recipient list as all active users with email, so failed validation can broaden recipients.

**Reproduction idea:** Configure one recipient, PUT the same automation with an invalid foreign user ID and isEnabled=true, expect 400, then read stored settings/recipients. Recipient list is empty and enabled may have changed. Invoke only a stubbed recipient-selection function to prove the resulting all-users selection without sending mail.

**Suggested fix:** Validate all requested IDs before any mutation, then write enabled and complete recipient replacement in one transaction. Preserve old settings on every rejected request.

## PLAT-04 — P2: failed account-address creation leaves an orphan account

**Source:** `src/endpoints/account/account-router.js:125`, `src/endpoints/account/account-router.js:133`; `src/endpoints/account/account-service.js:41`, `src/endpoints/account/account-service.js:70`; `migrations/schema-snapshot-2026-09-22.sql:160`.

**What happens:** The account/slug creation commits before the independent account_information insert. A valid account body with an overlength address field can fail the second insert, return 500, and retain the account and reserved slug. Account readers inner-join information and then cannot find the new account.

**Reproduction idea:** As fixture Super Admin create an otherwise valid account with account_state='Arizona' (schema varchar(2)). After 500, read accounts by the unique test name and account_information by its generated ID; the former exists and latter does not.

**Suggested fix:** Validate field constraints and create account, slug and address in one encompassing transaction. Return a validation status before any row is committed.

## PLAT-05 — P2: tracker upload can return 500 after successfully saving

**Source:** `src/endpoints/timeTracking/timeTracking-router.js:617`, `src/endpoints/timeTracking/timeTracking-router.js:658`, `src/endpoints/timeTracking/timeTracking-router.js:670`, `src/endpoints/timeTracking/timeTracking-router.js:766`.

**What happens:** File, entries and ownership commit before the staff-recipient lookup. That lookup is outside the success-email catch. A later staff DB failure reaches the outer 500 handler even though upload and possible AI scheduling succeeded. Retrying the workbook then produces duplicate 409, contradicting the original failure message.

**Reproduction idea:** Stub only `listActiveEmailsByAccount` to reject after a valid upload transaction commits; confirm HTTP500 while original S3 bytes, entries and owner row exist, then retry and expect duplicate409.

**Suggested fix:** Make postcommit recipient lookup/sending independently best effort or queue it durably, preserving a successful upload response once persistence commits. Keep a distinct upload identifier for reconciliation.

## PLAT-06 — P1: two template uploads in one second overwrite the same version key

**Source:** `src/endpoints/timeTracking/timeTracking-router.js:1350`; timestamp helper `src/endpoints/timeTracking/timeTracking-router.js:54`.

**What happens:** Template key is `timeTracker_<second-resolution timestamp><extension>` with no UUID/milliseconds/conditional put. Two accepted uploads of the same extension in one second write the same S3 key. History lists one object and the earlier template bytes are replaced at that key. Recovery from bucket versioning is not determined from the code.

**Reproduction idea:** Freeze the clock and upload two distinct valid-sized .xlsx buffers as owner-account Super Admin. Both receive201 and identical storedKey; fetch returns the second buffer and list contains only that key.

**Suggested fix:** Add a unique version identifier, as regular tracker uploads already do, and prevent unintended overwrites. Test simultaneous template uploads with a frozen clock.

## PLAT-07 — P2: string boolean bypasses self/last-Super-Admin deactivation guards

**Source:** `src/endpoints/user/userObjects.js:41`; `src/endpoints/user/user-router.js:86`, `src/endpoints/user/user-router.js:99`; `src/endpoints/user/user-service.js:15`.

**What happens:** Update forwards raw isUserActive to PostgreSQL but detects deactivation only with `=== false`. With accessLevel='Super Admin' and isUserActive='false', willDeactivate and willLoseSuperAdmin are false; PostgreSQL can cast the text to boolean false. Even the only active Super Admin can deactivate themselves despite both guards. Separately, count-and-mutate is not serialized against concurrent admin updates.

**Reproduction idea:** On a disposable account with one active Super Admin, PUT their own userID, accessLevel='Super Admin', isUserActive='false'. Confirm stored active=false and next protected request401. Also race two distinct super admins demoting themselves in an isolated test to exercise the count/mutation gap.

**Suggested fix:** Accept only a literal boolean when active status is supplied, use the validated normalized value in both guard and update, and serialize last-admin checks/mutations under an account lock and transaction.

## PLAT-08 — P2: historical migration chain removes columns still required by runtime

**Source:** `migrations/002.add_ai_time_tracker_transaction_suggestions.sql:1`, `migrations/005.drop_ai_customer_suggestion_columns.sql:1`; `migrations/schema-snapshot-2026-09-22.sql:335`; `src/endpoints/timesheets/auto-ingest-orchestrator.js:420`; `src/endpoints/timesheets/timesheets-router.js:470`.

**What happens:** 005 drops suggested_entity, suggested_customer_id and suggested_customer_display_name. Current runtime writes/selects them, and the authoritative snapshot includes them. No numbered migration 006–021 restores those columns. Therefore replaying the historical migration chain does not reproduce the runtime schema; the test harness's snapshot bootstrap can conceal this gap. This does not assert those columns are missing in the current production database.

**Reproduction idea:** Use a disposable snapshot database, apply 005, then inspect the columns and execute the suggestion select/upsert query with stubs or fixture data. Alternatively construct a dedicated migration-chain test from the declared historical baseline without replaying destructive files on any real dataset.

**Suggested fix:** Add a reviewed forward migration restoring the required schema, document the actual baseline/version lineage, and test a clean build from the supported baseline through all pending migrations.

## PLAT-09 — P1: one failed Lambda insert rolls back earlier payments, then processing continues

**Source:** `../DS2_Lambdas/Process_Payment_Images/database.py:86`, `../DS2_Lambdas/Process_Payment_Images/database.py:138`, `../DS2_Lambdas/Process_Payment_Images/database.py:173`; `../DS2_Lambdas/Process_Payment_Images/pipeline.py:263`.

**What happens:** All payment inserts share one uncommitted connection. Any row error calls conn.rollback(), erasing earlier successful inserts, then continues and finally commits later rows. The inserted counter still includes rolled-back rows. Pipeline proceeds to archive/delete input because write_to_rds returned normally, so payments can disappear from the review queue without a failed pipeline signal.

**Reproduction idea:** Batch A valid, B invalid payment_date causing SQL failure, C valid. In isolated Postgres confirm only C persists although success count includes A and C. Stub archive/delete and verify the caller proceeds after write_to_rds.

**Suggested fix:** Prefer all-or-nothing file transaction with exception propagation and retained input; if per-row partial acceptance is intended, use savepoints, explicit rejected-row records and accurate committed counts, and prohibit source deletion until every row's disposition is durable.

## PLAT-10 — P1: failed Lambda archive upload can still delete the pending source

**Source:** `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:28`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:84`; `../DS2_Lambdas/Process_Payment_Images/pipeline.py:267`.

**What happens:** upload_to_s3 catches upload errors and returns normally. move_to_processed forwards that result. In non-local stage, pipeline then deletes pending regardless, even if archive upload failed. The pending object can be removed with no archived replacement. Local temporary files are cleaned up afterward. Bucket recovery/versioning is not determined from the code.

**Reproduction idea:** Stub S3 upload_file to throw, pending delete_object to succeed, STAGE=prod, and process one fixture file. Assert deletion is attempted despite no successful archive. No real cloud calls are needed.

**Suggested fix:** Propagate archive failure; delete input only after confirmed durable archive upload (and completed DB disposition). Keep retryable failure state and verify destination identity/checksum before source deletion if required by the retention design.

## PLAT-11 — P2: Lambda's dedup source suffix breaks payment file preview/grouping

**Source:** `../DS2_Lambdas/Process_Payment_Images/database.py:101`; `src/endpoints/pendingPayments/pendingPayments-service.js:150`; `src/endpoints/pendingPayments/pendingPayments-router.js:404`.

**What happens:** Distinct same-name/same-amount checks in one source receive synthetic source_file names such as `deposit.pdf#dup2-ref102`. S3 contains only deposit.pdf. File list groups synthetic names as separate files; preview searches for exactly that synthetic basename and returns404. Processed/deletion checks group by the modified name rather than all payments originating from the physical source.

**Reproduction idea:** Ingest one PDF with two equal-value checks from the same payer but different references. Confirm both rows survive, then list files and request preview for the second source_file; no S3 object exists at its synthetic name.

**Suggested fix:** Preserve immutable physical source identity in its own column and use a separate deterministic payment occurrence/reference key for dedup. Migrate synthetic names deliberately, and group/authorize source operations by physical source ID.

## PLAT-12 — P2: invoice batch ZIP has duplicate member names for same-named customers

**Source:** `src/utils/createAndSavePDFs.js:8`; `src/pdfCreator/zipOrchestrator.js:56`; `src/endpoints/invoice/invoice-router.js:349`.

**What happens:** S3 ZIP keys include run/customer IDs, but members inside the combined ZIP use only customer display name and extension. Two selected customers sharing display name yield duplicate `Name.pdf` members. Common extraction workflows overwrite one or ask which to keep; the batch's filenames cannot reliably identify both invoices. This is distinct from already-fixed S3 key collisions.

**Reproduction idea:** Generate a draft batch for two fixture customers with the same display name and different invoice content. Inspect the ZIP central directory for duplicate paths, then extract into one folder and compare retained PDFs.

**Suggested fix:** Include customer ID and/or invoice number in every PDF member name, preserve display name as a readable prefix, and test duplicate display names in a combined batch.

## Documentation output summary

Files written: five guides in `docs/platform/` plus this findings file. **55 endpoint contracts** documented, counting the deprecated wildcard once and health aliases separately. **12 findings: 5 P1, 7 P2, 0 P3.** Only Markdown was written. Suggested reproductions and fixes were not executed.
