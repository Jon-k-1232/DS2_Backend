# Consolidated source-review findings

Reviewed 2026-09-24 against the local backend, cited frontend and payment-image Lambda source. This pass used source inspection only. It did not run reproductions, integration tests, application services, database writes or cloud operations. A confirmed finding means the cited code supports the failure path; it does not mean a production incident was observed.

The original failure analyses are retained below as review evidence. Each **Status: FIXED** note records the later remediation and regression tests; the feature guides describe current behavior.

P1 means data loss or unauthorized disclosure. P2 means a wrong result or state. P3 means a smaller behavior or presentation defect. Findings are ordered by severity, then by impact within each severity. Paths are relative to DS2_Backend; `../DS2_Frontend/` and `../DS2_Lambdas/` identify sibling repositories.

## Disposition

The four original files contain 47 notes. Eight overlapping notes were merged into 39 findings. No original finding was dropped as false: source review supported each distinct failure path. Original files are retained unchanged as historical evidence; their area endpoint counts overlap and are superseded by the [README inventory](../README.md#endpoint-index).

| Original notes | Consolidated finding | Why merged |
|---|---|---|
| W02, PLAT-01 | [F3](#f3) | Same initial-data role bypass. |
| LEDGER-02, PLAT-09 | [F5](#f5) | Same batch rollback and continued archival. |
| LEDGER-03, PLAT-10 | [F6](#f6) | Same swallowed archive error before deletion. |
| INV-01, LEDGER-01 | [F8](#f8) | Same hidden invoice/job write-off counted twice. |
| INV-03, LEDGER-09 | [F9](#f9) | Same exact-job recomputation instead of family total. |
| LEDGER-04, PLAT-11 | [F18](#f18) | Same synthetic source name losing physical file identity. |
| INV-06, PLAT-12 | [F33](#f33) | Same duplicate ZIP member names. |
| LEDGER-07, INV-08 | [F37](#f37) | Same backend Owner versus frontend role mismatch. |

## Finding index

| ID | Severity | Finding |
|---|---|---|
| [F1](#f1) | P1 | Customer-update response reads an arbitrary body account |
| [F2](#f2) | P1 | Caller-supplied related IDs cross tenant boundaries in joined reads |
| [F3](#f3) | P1 | Initial blob bypasses financial and contact role gates |
| [F4](#f4) | P1 | Generic invoice download bypasses the audit-PDF role gate |
| [F5](#f5) | P1 | One rejected extraction row rolls back earlier good rows |
| [F6](#f6) | P1 | Archive upload failure still permits source deletion |
| [F7](#f7) | P1 | Two template uploads in one second overwrite the same version key |
| [F8](#f8) | P2 | Hiding write-offs can apply an invoice-linked credit twice |
| [F9](#f9) | P2 | Billing Review recomputes one job version instead of the job family |
| [F10](#f10) | P2 | A new job-total snapshot can restore stale metadata |
| [F11](#f11) | P2 | Direct transaction API accepts internally inconsistent prices |
| [F12](#f12) | P2 | Direct entry bypasses internal-customer billability policy |
| [F13](#f13) | P2 | Customer profile counts retainer payments twice in its payment display |
| [F14](#f14) | P2 | Future-dated work is excluded from due WIP but finalized today |
| [F15](#f15) | P2 | A failed combined download reports failure after invoices have committed |
| [F16](#f16) | P2 | Soft-delete can hide a concurrently approved payment |
| [F17](#f17) | P2 | File deletion leaves archived evidence accessible |
| [F18](#f18) | P2 | Duplicate-preserving source suffix breaks file identity |
| [F19](#f19) | P2 | Rejected automation update deletes recipients and can widen email delivery |
| [F20](#f20) | P2 | Failed account-address creation leaves an orphan account |
| [F21](#f21) | P2 | Customer and recurring saves can partially commit |
| [F22](#f22) | P2 | Ending a recurring record leaves the customer recurring flag true |
| [F23](#f23) | P2 | Joined timestamps prevent selecting the latest customer-job version |
| [F24](#f24) | P2 | Permitted customer hard-delete leaves contact data behind |
| [F25](#f25) | P2 | Customer deletion races ledger/job creation |
| [F26](#f26) | P2 | Job-type update/delete detach a rejecting response refresh |
| [F27](#f27) | P2 | Customer statement PDF can combine different ledger states |
| [F28](#f28) | P2 | Tracker upload can return 500 after successfully saving |
| [F29](#f29) | P2 | String boolean bypasses self/last-Super-Admin deactivation guards |
| [F30](#f30) | P2 | Historical migration chain removes columns still required by runtime |
| [F31](#f31) | P2 | Global invoice note disappears unless an individual note is present |
| [F32](#f32) | P2 | Rate agreements trust unscoped customer and forged actor IDs |
| [F33](#f33) | P2 | Same-name customers collide inside the combined invoice ZIP |
| [F34](#f34) | P2 | Invoice detail omits retainers created during the statement's ending day |
| [F35](#f35) | P2 | Time reports merge distinct customers or employees sharing a display name |
| [F36](#f36) | P2 | Accepted uppercase PDF extension misses configured trigger |
| [F37](#f37) | P3 | Backend owner role cannot reach ledger UI |
| [F38](#f38) | P3 | Account Audit accepts ar_60 but does not apply it |
| [F39](#f39) | P3 | PDF “Original Amount” repeats the remaining balance |

<a id="f1"></a>

## F1 — P1 — Customer-update response reads an arbitrary body account

**Status: FIXED** — `test/integration/review-customer-response.integration.spec.js`: `refreshes customers and recurring rows only from the verified URL account`; failed updates return no lists. Red: 1 failed / 1 passed; green: 2 passed.

Original notes: [W01](findings-work.md).

**Evidence:** `src/endpoints/customer/customer-router.js:245`, `src/endpoints/customer/customer-router.js:251`, `src/endpoints/customer/customer-router.js:276`, `src/endpoints/customer/customer-service.js:1`, `src/endpoints/recurringCustomer/recurringCustomer-service.js:3`.

**What happens:** PUT updateCustomer scopes its writes to the verified URL account, but refreshes customer and recurring lists using accountID destructured from the body. An account A privileged user can receive account B's active customer/contact and recurring billing information. The URL account guard does not protect this second source of account identity.

**Reproduction idea:** With A and B fixtures, authenticate as A manager. Send a complete valid update for A's customer/contact to A's URL, but set customer.accountID=B. Assert the response contains B's display names/contact details/subscriptions. Use a benign full update so validation does not mask the readback leak.

**Suggested fix:** Use trustedAccountId for both response queries, remove body account from read decisions, and add a regression asserting no B data appears in successful or failed A updates.

<a id="f2"></a>

## F2 — P1 — Caller-supplied related IDs cross tenant boundaries in joined reads

**Status: FIXED** — `test/integration/review-related-ids.integration.spec.js` covers related-ID refusals on create/update, creator attribution and malformed historical joins (22 failures before; final expanded suite: 24 passing). Focused transaction/job/recurring units: 122 passing. Read-only relationship audit saved in the run output; historical data was not repaired.

Original notes: [W03](findings-work.md).

**Evidence:** `src/endpoints/transactions/transactionsObjects.js:37`, `src/endpoints/transactions/sharedTransactionFunctions.js:596`, `src/endpoints/transactions/transactions-service.js:1`, `src/endpoints/job/job-router.js:59`, `src/endpoints/job/job-service.js:22`, `src/endpoints/jobType/jobTypeObjects.js:1`, `src/endpoints/jobType/jobType-service.js:18`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:26`, `src/endpoints/recurringCustomer/recurringCustomer-service.js:3`, `migrations/schema-snapshot-2026-09-22.sql:1934`, `migrations/schema-snapshot-2026-09-22.sql:2094`.

**What happens:** Scoping the base row does not validate all related rows. Direct transaction CRUD checks customer/job/retainer but not logged-for employee or general work description account. Joined lists reveal the foreign employee/description label. Job CRUD accepts another account's job type/creator; refreshed jobs select type.* and creator name without related-account predicates. Job-type CRUD accepts another account's category and returns its label. Recurring create accepts a foreign customer ID, ignores the zero-row customer flag update, inserts an own-account recurring row, and returns the foreign customer's display name. The reference FKs enforce individual IDs, not account correspondence; recurring has no customer FK.

**Reproduction idea:** Use A/B tenants. As A manager, create a transaction on A's customer/job using B's user and description IDs; inspect A's list for B's labels. Separately create A's job with B's type, an A type with B's category, and A's recurring row with B's customer ID; inspect each success/initial-blob response. These requests need existing globally valid IDs, not a forged URL account.

**Suggested fix:** Resolve every submitted relation in the trusted account before writes and enforce customer/job consistency wherever applicable. Scope joined tables as defense in depth; use composite account+ID FKs where practical. Audit pre-existing mismatches. Derive creator from session and preserve it on edit.

**Related integrity paths:** Quote mappers accept customer/job/creator IDs without ownership or customer/job correspondence checks. Category/type/general-description/job/recurring creator fields can spoof attribution; several updates overwrite creator. Quote list itself has no joined customer leakage, but these links can corrupt ownership semantics (`src/endpoints/quotes/quotesObjects.js:1`, `src/endpoints/jobCategories/jobCategoriesObjects.js:1`, `src/endpoints/workDescriptions/workDescriptionsObjects.js:1`, `src/endpoints/job/jobObjects.js:18`, `src/endpoints/recurringCustomer/recurringCustomerObjects.js:31`).

<a id="f3"></a>

## F3 — P1 — Initial blob bypasses financial and contact role gates

**Status: FIXED** — `test/integration/review-initial-data-roles.integration.spec.js` verifies empty staff lists/grids/counts, self-only user fields, no protected-table reads, and User/Manager/Admin/Super Admin/Owner projections. Red: 8 failed / 10 passed; green: 18 passed.

Original notes: [W02](findings-work.md), [PLAT-01](findings-platform.md).

**Evidence:** `src/app.js:123`, `src/app.js:147`, `src/endpoints/initialData/initialData-router.js:43`, `src/endpoints/initialData/initialData-router.js:65`, `src/endpoints/initialData/initialData-router.js:190`, `test/endpoints/initialData/initialDataUserFields.integration.spec.js:75`.

**What happens:** Plain User employees cannot call manager-only customer/transaction/invoice/payment APIs, but can fetch their account's same financial/contact data through initialBlob. The only role redaction removes cost_rate, billing_rate and email from the users roster. Customer contacts, job amounts, all retainers and first pages of other ledgers remain. Transaction unit_cost can also expose employee billing rates despite roster redaction. Existing tests retain the shell's top-level keys without checking minimal contents.

**Reproduction idea:** Authenticate as plain User. Confirm GET transactions returns403, then GET initialBlob with the same account returns customer contact fields, transaction quantities/rates/totals, invoices and retainers. Seed identifiable records in the first20 where applicable.

**Suggested fix:** Define explicit per-role projections. Ordinary staff should receive only the selectors/own data needed by upload/history; keep any required shell keys with safe contents. Test each protected field/list, not only the roster or top-level shape.

<a id="f4"></a>

## F4 — P1 — Generic invoice download bypasses the audit-PDF role gate

**Status: FIXED** — `test/integration/review-audit-download.integration.spec.js`: the same saved object is refused through both surfaces for Manager/Admin/Owner and served only by the dedicated Super Admin audit endpoint. Red: 4 failed; green: 4 passed. Generic invoice downloads no longer accept the audit namespace.

Original notes: [PLAT-02](findings-platform.md).

**Source:** `src/app.js:138`; `src/endpoints/accountAudit/account-audit-router.js:37`, `src/endpoints/accountAudit/account-audit-router.js:382`; `src/endpoints/invoice/invoice-router.js:398`; `src/utils/downloadAuthorization.js:40`.

**What happens:** The audit router requires Super Admin, but the generic invoice downloader accepts own-account `account_audits/<accountID>/` keys for Manager/Admin/Owner as well. A caller who knows a valid own-account audit object key can obtain the audit PDF through the broader route. Knowing the key is required; no claim of directory enumeration is made.

**Reproduction idea:** Create a fixture saved audit with an S3 object. As a Manager, request its audit-PDF endpoint (403), then request `/invoices/downloadFile/<account>/<user>?fileLocation=<same audit key>` and compare returned bytes.

**Suggested fix:** Keep audit objects out of the generic invoice prefix list, or apply the same Super Admin gate when authorizing an audit key. Test the same sensitive object through every download surface.

<a id="f5"></a>

## F5 — P1 — One rejected extraction row rolls back earlier good rows

**Status: FIXED** — `test/lambda/payment-durability.spec.js`, `F5Cases`: bad middle row aborts the complete batch; pipeline retains sources; committed counts/retries, commit failure, and missing DB configuration are checked. Red: 5 failed; green: 5 passed. Atomic batch semantics preserve existing dedup behavior without adding schema.

Original notes: [LEDGER-02](findings-ledger.md), [PLAT-09](findings-platform.md).

- **Source:** `../DS2_Lambdas/Process_Payment_Images/database.py:138`, especially rollback at line 175 and final commit at line 177; downstream archive at `../DS2_Lambdas/Process_Payment_Images/pipeline.py:255` and `../DS2_Lambdas/Process_Payment_Images/pipeline.py:267`.
- **What happens:** All inserts share a transaction. On any row failure, `conn.rollback()` removes all successful inserts since the last rollback. The loop continues and commits later rows. The insertion counter still includes rows that were rolled back. The caller receives no failure manifest and proceeds to archive/delete source files.
- **Concrete reproduction:** Process valid row A, invalid-date row B, then valid row C in one batch. A is inserted into the open transaction; B throws and rolls A back; C commits. The queue contains only C, while the counter can report two inserted rows and the file can leave the pending prefix.
- **Earlier-pass helper evidence (not rerun):** A read-only AST-extracted invocation of the real writer with a fake transaction-aware connection produced committed rows `['good-C']` and reported inserted count 2. No PostgreSQL connection was made. Existing Lambda tests at `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:141` do not establish rollback isolation.
- **Suggested fix:** Choose and implement explicit import semantics: either validate/commit the entire file and propagate any failure, or use a savepoint per row and retain a durable rejected-row record. Report only committed rows. Archive/remove the pending source only after the selected durability condition is met.

<a id="f6"></a>

## F6 — P1 — Archive upload failure still permits source deletion

**Status: FIXED** — `test/lambda/payment-durability.spec.js`, `F6Cases`: upload/HEAD/size/missing-bucket failures retain sources, retries preserve committed rows, mixed batches and redacted PDF/image inputs are covered, and Lambda rethrows for async retry. Red: 8 failed; green: 8 passed (13 including F5).

Original notes: [LEDGER-03](findings-ledger.md), [PLAT-10](findings-platform.md).

- **Source:** `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:28`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:84`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:267`.
- **What happens:** `upload_to_s3` catches the archive upload exception and returns normally. `move_to_processed` does not expose success/failure. Outside local stage, the caller then deletes the pending source object. A failed archive can leave no copy under either expected prefix, losing the original payment evidence.
- **Concrete reproduction:** In a non-local run, let extraction/DB handling return normally, make `upload_file` raise, and let `delete_object` succeed. The archive object is absent and the original pending key is deleted. The same archive/delete sequence applies after PDF redaction and to supported batch inputs.
- **Earlier-pass helper evidence (not rerun):** A read-only fake-dependency invocation of the actual pipeline/upload functions made archive upload fail and still observed deletion requested for `deposit.csv`. No S3 calls or filesystem changes were made by the harness.
- **Suggested fix:** Propagate upload errors or require an explicit successful archive result. Verify the intended archived object before source removal. Keep the pending source and record a retryable failure when archiving fails.

<a id="f7"></a>

## F7 — P1 — Two template uploads in one second overwrite the same version key

**Status: FIXED** — `test/endpoints/timeTracking/template-versions.spec.js`: simultaneous frozen-clock uploads preserve separate keys/bytes/history; a forced key collision is refused without overwrite. Red: 2 failed; green: 2 passed. Keys include UUIDs and template puts use `If-None-Match: *`.

Original notes: [PLAT-06](findings-platform.md).

**Source:** `src/endpoints/timeTracking/timeTracking-router.js:1350`; timestamp helper `src/endpoints/timeTracking/timeTracking-router.js:54`.

**What happens:** Template key is `timeTracker_<second-resolution timestamp><extension>` with no UUID/milliseconds/conditional put. Two accepted uploads of the same extension in one second write the same S3 key. History lists one object and the earlier template bytes are replaced at that key. Recovery from bucket versioning is not determined from the code.

**Reproduction idea:** Freeze the clock and upload two distinct valid-sized .xlsx buffers as owner-account Super Admin. Both receive201 and identical storedKey; fetch returns the second buffer and list contains only that key.

**Suggested fix:** Add a unique version identifier, as regular tracker uploads already do, and prevent unintended overwrites. Test simultaneous template uploads with a frozen clock.

<a id="f8"></a>

## F8 — P2 — Hiding write-offs can apply an invoice-linked credit twice

**Status: FIXED** — Same-job invoice credits are excluded from hidden job netting. Test: `test/endpoints/invoice/review-writeoff.spec.js`; red 2 failed, green 2 passed (current and absorbed chains).

Original notes: [INV-01](findings-invoicing.md), [LEDGER-01](findings-ledger.md).

**Evidence:** `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:52`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:74`, `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`. The write-off creation path explicitly permits a job link on an invoice-linked write-off: `src/endpoints/writeOffs/writeOffs-logic.js:85`, `src/endpoints/writeOffs/writeOffs-logic.js:125`.

**What happens:** In hidden mode, every pending write-off is grouped by job, including invoice-linked ones. A job with unbilled transactions starts with the sum of all those write-offs. A current-chain write-off has already reduced the beginning balance, and the separate write-off calculator correctly excludes it from new credits. The job calculation nevertheless deducts it again. For an older-chain link, it can instead be deducted in both job total and separate write-off total.

**Reproduction:** Supply a current outstanding snapshot of $90 after a -$10 invoice-linked write-off, plus $50 of unbilled work on the same job. Give the write-off the current linked_chain_invoice_date. The code yields $130 with showWriteOffs=false and $140 with true; the earlier note records the same result from a pure-helper check, which this pass did not rerun. Expected new balance is $140. Existing `test/endpoints/invoice/engine-units.spec.js:206` uses a different write-off job and misses this case.

**Suggested fix:** Exclude invoice-linked rows before all hidden-mode job netting, not just adjustment-only groups. Add same-job current-chain and absorbed-chain cases asserting shown/hidden totals agree.

<a id="f9"></a>

## F9 — P2 — Billing Review recomputes one job version instead of the job family

**Status: FIXED** — Billing Review appends the shared family total under the customer lock, summing after save with delta zero. `test/integration/review-job-family.integration.spec.js` F9: red 3 failed; green 3 passed (repricing and same/cross-family moves).

Original notes: [INV-03](findings-invoicing.md), [LEDGER-09](findings-ledger.md).

**Evidence:** `src/endpoints/billingReview/cascadeEdit.js:281`, `src/endpoints/billingReview/cascadeEdit.js:691`. The normal creator/update path uses all family IDs and appends a new job history row: `src/endpoints/transactions/sharedTransactionFunctions.js:461`.

**What happens:** Cascade editing sums transactions only where customer_job_id equals the edited version and updates that version's current_job_total in place. Job history can have transactions spread across root and children, while the visible latest job remains unchanged. This contradicts the family total maintained by other transaction operations.

**Reproduction:** Root J1 has a $100 transaction; child J2 has $50; latest version J3 displays $150. Use Billing Review to change J1's transaction to $120. J1 becomes $120 and latest J3 remains $150, rather than family total $170. Also check moving work between versions/families.

**Suggested fix:** Reuse a shared, lock-aware family-total operation with correct after-edit semantics and append/update the authoritative latest history consistently. Do not apply the monetary delta twice if summing after the transaction update.

<a id="f10"></a>

## F10 — P2 — A new job-total snapshot can restore stale metadata

**Status: FIXED** — Snapshots copy the latest owned family metadata, ordered by created_at then ID. `test/integration/review-job-family.integration.spec.js` F10: red 1 failed; green 1 passed; combined suite 4 passed.

Original notes: [W07](findings-work.md).

**Evidence:** `src/endpoints/job/job-service.js:106`, `src/endpoints/transactions/sharedTransactionFunctions.js:461`, `src/endpoints/transactions/sharedTransactionFunctions.js:478`, `src/endpoints/job/job-router.js:185`.

**What happens:** getRecentJob filters the exact supplied job ID, although transaction family totals include all versions. Updating notes/agreed amount on the current version affects that named row only. Later repricing a transaction attached to an older row copies that older row's metadata into the newest snapshot, making the latest version's notes/agreed amount revert.

**Reproduction idea:** Create a root and transaction, then a generated version. Edit that version's notes/agreed amount. Change the amount of the transaction still pointing to the root. Check the newest inserted job row: total is recomputed correctly but notes/agreed amount come from the root.

**Suggested fix:** Define which fields are family-wide and resolve the latest owned family metadata before snapshot insertion. Preserve the correct current metadata while summing transactions across the family. Add a regression combining metadata edit and repricing an older-linked entry.

<a id="f11"></a>

## F11 — P2 — Direct transaction API accepts internally inconsistent prices

**Status: FIXED** — Shared create/update validation enforces finite nonnegative two-decimal inputs, duration agreement after six-minute rounding when minutes are supplied, and rounded quantity × rate; zero quantity survives updates. Direct decimal-hour Time entries without supplied minutes remain valid. The [regression repair](regression-repair.md) removed the overly broad blanket 0.1-hour check, preserving the existing 0.25-hour / $18.75 / NULL-note assertions through finalization. Initial `review-transaction-policy.integration.spec.js` F11: red 15 failed / 2 passed, green 17 passed. `transactionPricing.spec.js`: red 1 failed, green 1 passed for integer-cent half-cent rounding. Billing Review retains its documented explicit correction override.

Original notes: [W08](findings-work.md).

**Evidence:** `src/endpoints/transactions/transactionsObjects.js:51`, `src/endpoints/transactions/transactionsObjects.js:78`, `src/endpoints/transactions/sharedTransactionFunctions.js:590`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:541`.

**What happens:** Direct create/update number-coerce quantity/rate and trust independent absolute totalTransaction. They do not recompute price, require finite/nonnegative values, or enforce six-minute Time increments. Job/invoice totals use totalTransaction while detail quantity/rate can imply a different amount. Update also maps quantity0 to1. Tracker ingestion computes its own consistent rounded price, so entry paths differ.

**Reproduction idea:** POST a valid Time entry with quantity1, unitCost100, totalTransaction1, billable=true. Verify stored detail says one hour at100 while job/invoice contribution is1. Submit quantity0.11 to show direct Time entries need not use 0.1-hour increments. No database experiment was run for this review.

**Suggested fix:** Centralize finite numeric validation and pricing in the shared core, with an explicitly authorized rate/amount override policy if required. Derive Time quantity from duration in six-minute increments and verify Charge arithmetic. Add direct HTTP tests, not only ingestion calculator tests.

<a id="f12"></a>

## F12 — P2 — Direct entry bypasses internal-customer billability policy

**Status: FIXED** — Shared create/update applies internal-customer and customer is_billable policy under the ledger lock before funding; no retainer draw for forced nonbillable work. `test/integration/review-transaction-policy.integration.spec.js` F12: red 4 failed, green 4 passed (combined 21 passed). Tracker ingestion uses the same core.

Original notes: [W09](findings-work.md).

**Evidence:** `src/endpoints/timesheets/internal-customers.js:75`, `src/endpoints/timesheets/timesheets-router.js:310`, `src/endpoints/billingReview/billingReview-service.js:314`, `src/endpoints/transactions/sharedTransactionFunctions.js:590`, `src/endpoints/transactions/sharedTransactionFunctions.js:603`.

**What happens:** Tracker approval/ingestion makes internal work non-billable. Direct Time/Charge create/update uses only the submitted flag and does not check the internal resolver or customer-level is_billable. It can add internal billable debt and draw a retainer, despite the policy applied by the other entry paths.

**Reproduction idea:** Configure an owned customer in INTERNAL_CUSTOMER_IDS. Apply a tracker row for it and observe false billability. Then direct-POST equivalent work with isTransactionBillable=true; it remains true and contributes to billing. Repeat update on previously non-billable work.

**Suggested fix:** Apply the internal/customer billability policy in the shared core used by all paths, or define an explicit privileged override with audit evidence. Test create and update across both direct and tracker routes.

<a id="f13"></a>

## F13 — P2 — Customer profile counts retainer payments twice in its payment display

**Status: FIXED** — Customer profile displays paymentsReceivedTotal (all marker-qualified receipts) once, with a matching tooltip. Frontend `CustomerProfile.payments.test.js`: red 1 failed, green 1 passed, including cash, retainer and tagged receipts.

Original notes: [W13](findings-work.md).

**Evidence:** `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:11`, `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:22`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:10`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:238`.

**What happens:** paymentTotal already includes all eligible uninvoiced payments, including Retainer/Prepayment. retainerAppliedToInvoice is a subset of paymentTotal. The profile renders their sum as Payments Since Last Bill, doubling that subset. It also excludes invoice-tagged receipts although the backend separately calculates paymentsReceivedTotal for all listed receipts. Amount due uses the correct paymentTotal once; the profile breakdown is inconsistent.

**Reproduction idea:** Give invoice preview a −$50 eligible payment total containing a −$20 retainer payment. Backend returns paymentTotal−50 and retainerAppliedToInvoice−20. Profile label shows−70; due math credits only50. Add a tagged payment to demonstrate the difference from all receipts.

**Suggested fix:** Choose the label's meaning: show paymentsReceivedTotal for all receipts since the statement, or paymentTotal for unapplied credits with a matching label. Never add the retainer subset again. Add a component assertion with both cash and retainer payments.

<a id="f14"></a>

## F14 — P2 — Future-dated work is excluded from due WIP but finalized today

**Status: FIXED** — Preview, eligibility, WIP and finalization share the server billing date, excluding future work while recovering old unbilled work. `test/integration/review-invoice-outcomes.integration.spec.js` F14: both cutoff and fixed-calendar tests failed before the fixes and pass afterward. Audit current-balance parity is covered by `test/endpoints/accountAudit/review-future.spec.js` (red 1 failed, green 1 passed); lifetime diagnostics retain future work.

Original notes: [INV-11](findings-invoicing.md).

**Evidence:** `src/endpoints/analytics/analytics-service.js:377` separates future billable work from due WIP and its aging buckets. `src/endpoints/invoice/invoice-service.js:263` selects every uninvoiced transaction without a date upper bound; `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:83` adds every billable selected amount. Finalize stamps all selected transaction IDs: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:113`.

**What happens:** A reviewer can see $0 due WIP and a separate future-dated warning, yet Create Invoice bills that future amount now and stamps it as invoiced. The removal of the old last-bill lower bound correctly recovers stale work, but it also has no billing-date upper bound. This is especially significant for the future-date typos acknowledged in `src/endpoints/analytics/analytics-service.js:308`.

**Reproduction:** Give an account-owned customer a valid job and one unbilled billable $100 transaction dated 2058-01-01. WIP reports due amount $0, future amount $100; today's engine reports $100 new charges, and finalized billing links the transaction to today's invoice.

**Suggested fix:** Keep recovery of old unbilled rows, but define and enforce the billing-date upper bound. If advance billing is intentional, make it an explicit reviewed option and ensure preview/WIP explain that selection. Test stale past work and future work separately.

<a id="f15"></a>

## F15 — P2 — A failed combined download reports failure after invoices have committed

**Status: FIXED** — Postcommit export/readback failures return status 200, committed=true, committed invoice IDs/numbers/individual ZIP paths, and warnings. Frontend preserves existing lists if refresh is absent. `test/integration/review-invoice-outcomes.integration.spec.js` F15: red 2 failed, green 2 passed; individual files downloaded successfully; final combined F14/F15 suite 4 passed.

Original notes: [INV-02](findings-invoicing.md).

**Evidence:** `src/endpoints/invoice/invoice-router.js:355`, `src/endpoints/invoice/invoice-router.js:389`; commit is inside `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:70`. The frontend returns early for a body status other than 200: `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:85`.

**What happens:** dataInsertionOrchestrator commits parents, absorption and transaction/payment stamps. The route then creates/uploads the batch ZIP and rereads the invoice list. Failure of either later step returns the generic body status:500 with no committed result. Individual invoice ZIPs and ledger changes already exist. A user can reasonably treat the run as failed and attempt a same-day rebill override.

**Reproduction:** In an isolated fixture, allow per-customer ZIP uploads and the database transaction, but fail only the final_invoices S3 upload. Confirm persisted invoice/stamped rows despite the error response. Separately fail the postcommit getInvoices query.

**Suggested fix:** Distinguish committed billing from export/readback failure. Return the committed invoice identities and an artifact warning, retain accessible individual ZIPs and provide retryable export generation. Persist a billing run if durable retries are introduced; do not report the ledger as uncommitted.

<a id="f16"></a>

## F16 — P2 — Soft-delete can hide a concurrently approved payment

**Status: FIXED** — Soft-delete conditions its write on unprocessed, nondeleted state and returns 409 if approval won. `test/integration/review-pending-files.integration.spec.js` F16: red 1 failed; green 1 passed with a real approval committed between delete read and write.

Original notes: [LEDGER-05](findings-ledger.md).

- **Source:** `src/endpoints/pendingPayments/pendingPayments-router.js:112`, `src/endpoints/pendingPayments/pendingPayments-service.js:101`; compare approval lock/update at `src/endpoints/pendingPayments/pendingPayments-router.js:170`.
- **What happens:** Single-row deletion checks state with an unlocked read, then updates only by account/ID. Approval uses `FOR UPDATE`, but deletion does not recheck state after waiting for that lock. A processed row can end with `deleted=true`, disappearing from normal lists/counts while its posted money remains.
- **Concrete reproduction:** Pause deletion after it reads a new row. Approve and commit that row in a second request. Resume deletion. Its unconditional update sets `deleted=true` on the now-processed row and returns success. The normal `new/processed/all` lists exclude it.
- **Evidence:** Source-level interleaving; no concurrent database test was run. Ordinary processed/deleted refusals are tested at `test/integration/coverage-payments-pending.integration.spec.js:988`, not this stale-read interleaving.
- **Suggested fix:** Take the same row lock and validate in a transaction, or condition the update on `is_payment_processed=false AND deleted=false` and check affected count. Return a state conflict if approval won. Coordinate file deletion with approval too; its processed check and S3 deletion are separate from its conditional row update.

<a id="f17"></a>

## F17 — P2 — File deletion leaves archived evidence accessible

**Status: FIXED** — File deletion locks extracted rows against approval, removes matching archive and pending objects, propagates storage failure before queue flags commit, and preview requires nondeleted evidence. `test/integration/review-pending-files.integration.spec.js` F17: red 2 failed / 1 passed; green 3 passed (combined 4). S3 deletion is idempotently retryable, not transactionally reversible.

Original notes: [LEDGER-06](findings-ledger.md).

- **Source:** `src/endpoints/pendingPayments/pendingPayments-router.js:351`, `src/endpoints/pendingPayments/pendingPayments-router.js:404`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`.
- **What happens:** DELETE file says the file and associated payments were deleted, and a comment says both locations are handled. The only S3 deletion is the pending-prefix key. Normally extracted files are already archived. The archive survives, and file preview still authorizes via soft-deleted rows. S3 delete failure is also suppressed while returning success.
- **Concrete reproduction:** Extract a PDF so it is in `processed_payments/<month>/`, but do not approve its rows. DELETE its filename. Expect HTTP 200 and hidden queue rows. GET file-preview with the same filename still finds and returns the archived PDF because deleted rows remain ownership evidence.
- **Evidence:** Source-level path comparison. `test/integration/coverage-pending-payments-authz.integration.spec.js:264` checks an owned object deletion, not removal of an archived object and subsequent preview denial.
- **Suggested fix:** Decide whether this action means retained-evidence dismissal or actual file deletion. If deletion, resolve/persist the canonical archive key and delete it with explicit failure handling, then enforce intended preview state. If retention is intended, make the UI/API message and allowed preview contract say so instead of claiming removal.

<a id="f18"></a>

## F18 — P2 — Duplicate-preserving source suffix breaks file identity

**Status: FIXED** — Canonical physical identity strips the reserved receipt suffix in file grouping, ownership, preview, locking and deletion; original source_file remains the dedup token and list rows expose source_reference. Existing suffixed rows work without historical rewrites or schema changes. `test/integration/review-pending-files.integration.spec.js` F18: red 3 failed; green 3 passed (combined 7).

Original notes: [LEDGER-04](findings-ledger.md), [PLAT-11](findings-platform.md).

- **Source:** `../DS2_Lambdas/Process_Payment_Images/database.py:113`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:25`; exact-name consumers at `src/endpoints/pendingPayments/pendingPayments-service.js:150`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`, `src/endpoints/pendingPayments/pendingPayments-router.js:337`, `src/endpoints/pendingPayments/pendingPayments-router.js:412`.
- **What happens:** The second same-payer/same-amount row is stored with a synthetic source like `deposit.pdf#dup2-ref102`. S3 stores only `deposit.pdf`. The second row becomes a separate file-list group; preview tries nonexistent suffixed keys, and file-level state/deletion checks see only rows with the selected exact string. One physical deposit file can appear to be several unrelated files.
- **Concrete reproduction:** One PDF contains two $100 checks from the same payer, references 101 and 102. Fingerprint dedup preserves them because references differ. DB writer inserts sources `deposit.pdf` and `deposit.pdf#dup2-ref102`. Preview the second row: ownership passes but both S3 lookups miss. Approve only the suffixed row, then inspect/delete the unsuffixed file group: its processed check does not see the approved sibling.
- **Evidence:** Source-level dataflow; the suffix behavior is asserted by `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:174`. No HTTP/S3 reproduction was run.
- **Suggested fix:** Store canonical source object identity separately from a per-payment dedup identifier. Include date/reference or a stable extraction receipt ID in dedup without altering source filename. Use that shared file identity for preview, grouping, ownership and all file-level approval/deletion checks; migrate existing suffixed rows deliberately.

<a id="f19"></a>

## F19 — P2 — Rejected automation update deletes recipients and can widen email delivery

**Status: FIXED** — Enabled state and recipient replacement commit in one transaction under an account lock; recipient validation precedes deletion. `test/integration/review-account-atomicity.integration.spec.js` F19: red 2 failed; green 2 passed (foreign-user rejection and injected late write failure preserve old recipients/enabled state). No mail sent.

Original notes: [PLAT-03](findings-platform.md).

**Source:** `src/endpoints/account/automation-settings-service.js:56`, `src/endpoints/account/automation-settings-service.js:71`, `src/endpoints/account/automation-settings-service.js:112`; `src/automations/automationScripts/timeTrackerReminders.js:24`.

**What happens:** Recipient replacement deletes current recipients before checking whether new IDs are active own-account users. A foreign/inactive ID triggers 400 after deletion. If isEnabled was supplied, that upsert already committed too. Reminder selection treats an empty recipient list as all active users with email, so failed validation can broaden recipients.

**Reproduction idea:** Configure one recipient, PUT the same automation with an invalid foreign user ID and isEnabled=true, expect 400, then read stored settings/recipients. Recipient list is empty and enabled may have changed. Invoke only a stubbed recipient-selection function to prove the resulting all-users selection without sending mail.

**Suggested fix:** Validate all requested IDs before any mutation, then write enabled and complete recipient replacement in one transaction. Preserve old settings on every rejected request.

<a id="f20"></a>

## F20 — P2 — Failed account-address creation leaves an orphan account

**Status: FIXED** — Account text lengths are validated before writes; account/slug and address share an encompassing transaction. `test/integration/review-account-atomicity.integration.spec.js` F20: red 2 failed; green 2 passed (invalid address, forced address failure, successful retry); combined 4 passed. Disposable new accounts were removed.

Original notes: [PLAT-04](findings-platform.md).

**Source:** `src/endpoints/account/account-router.js:125`, `src/endpoints/account/account-router.js:133`; `src/endpoints/account/account-service.js:41`, `src/endpoints/account/account-service.js:70`; `migrations/schema-snapshot-2026-09-22.sql:160`.

**What happens:** The account/slug creation commits before the independent account_information insert. A valid account body with an overlength address field can fail the second insert, return 500, and retain the account and reserved slug. Account readers inner-join information and then cannot find the new account.

**Reproduction idea:** As fixture Super Admin create an otherwise valid account with account_state='Arizona' (schema varchar(2)). After 500, read accounts by the unique test name and account_information by its generated ID; the former exists and latter does not.

**Suggested fix:** Validate field constraints and create account, slug and address in one encompassing transaction. Return a validation status before any row is committed.

<a id="f21"></a>

## F21 — P2 — Customer and recurring saves can partially commit

**Status: FIXED** — Customer/contact/recurring updates and dedicated recurring creation now share transactions under the customer ledger lock; missing contact writes are refused. `test/integration/review-customer-recurring.integration.spec.js` F21: red 4 failed; green 4 passed (contact SQL failure, missing contact, recurring SQL failure and injected dedicated insertion failure all roll back). The [regression repair](regression-repair.md) restores dedicated creation's documented HTTP 422 for missing/foreign customers by validating ownership before acquiring the ledger lock in the same transaction; the lock still rechecks existence before writes.

Original notes: [W04](findings-work.md).

**Evidence:** `src/endpoints/customer/customer-router.js:259`, `src/endpoints/customer/customer-router.js:264`, `src/endpoints/customer/customer-service.js:124`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:33`.

**What happens:** Customer update commits the customer row, then contact, then recurring changes independently. A later error returns failure after earlier changes persist; zero-row contact updates are also ignored. Dedicated recurring create sets customers.is_recurring first and can fail insertion afterward, leaving the flag true without a subscription.

**Reproduction idea:** Update an existing customer's name and submit a contact state longer than the schema's two-character limit. Expect body status500 but the new name persists. Alternatively enable recurring with invalid billingCycle; customer/contact writes survive the recurring failure. For standalone recurring create, fail the insert after its flag update.

**Suggested fix:** Validate first; perform the full save in one transaction with owned-row existence/affected-count checks. Coordinate customer state with the ledger lock when the policy requires serialization. Add rollback assertions for each later write failure.

<a id="f22"></a>

## F22 — P2 — Ending a recurring record leaves the customer recurring flag true

**Status: FIXED** — Every recurring mutation reconciles customers.is_recurring from remaining active owned subscriptions in the same locked transaction, including embedded edits. Explicit active flags retain existing precedence over dates. `test/integration/review-customer-recurring.integration.spec.js` F22: red 4 failed; green 4 passed (last removal, multiple subscriptions, inactive create/reactivation); combined 8 passed.

Original notes: [W05](findings-work.md).

**Evidence:** `src/endpoints/recurringCustomer/recurringCustomer-router.js:135`, `src/endpoints/customer/customer-service.js:120`, `../DS2_Frontend/src/Pages/RecurringCustomer/RecurringCustomerForms/AddCustomer/FormSubComponents/RecurringOptions.js:43`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.js:7`.

**What happens:** Dedicated DELETE deactivates the subscription and stamps end_date, but never clears customers.is_recurring. Dedicated PUT isActive=false has the same mismatch. The add-recurring selector excludes customers marked recurring, while transaction defaults continue treating their work as covered by a monthly charge.

**Reproduction idea:** Create the only active recurring row for a customer, delete it through the dedicated API, reload initial data, and inspect customers.is_recurring. Then inspect add-recurring options and the Time form's non-additional billable default.

**Suggested fix:** In a transaction, reconcile the flag from remaining active subscriptions after create/update/delete. Decide whether dates also define active subscription status. Test the last-subscription and multiple-subscription cases.

<a id="f23"></a>

## F23 — P2 — Joined timestamps prevent selecting the latest customer-job version

**Status: FIXED** — Job joins preserve job metadata; customer selectors and profile totals select the same latest family row by SQL timestamp then ID. `test/integration/review-job-selection.integration.spec.js`: red 2 failed; green 2 passed (multiple versions, timestamp ties, backdated higher ID, creator preservation).


Original notes: [W06](findings-work.md).

**Evidence:** `src/endpoints/job/job-service.js:41`, `src/endpoints/job/job-router.js:247`, `src/endpoints/job/job-service.js:22`, `src/endpoints/customer/customer-router.js:171`.

**What happens:** getActiveCustomerJobs uses SELECT * across jobs, types and categories, which have overlapping created_at/account/creator columns. Later duplicate fields replace job fields in a normal object result. The reducer replaces a root only when a candidate's exposed created_at is strictly later; versions sharing category/type therefore compare equal and the original root can remain. Account jobs similarly selects types.* after jobs.*, replacing job metadata. Customer-profile tree totals instead choose greatest child ID, so these views can disagree.

**Reproduction idea:** Create a root job with current total0, add a $100 transaction to create a later version using the same type/category, and GET getActiveCustomerJobs. Compare its selected total/version with raw jobs and customer-profile tree. Inspect returned created_at against the category/type timestamp.

**Suggested fix:** Select jobs.* plus explicitly aliased related labels only. Choose latest family version by job created_at and job ID with deterministic tie-breaking. Add a root+multiple-version HTTP test; the existing simple customer-jobs case does not exercise this (`test/integration/coverage-jobs-masterdata.integration.spec.js:376`).

<a id="f24"></a>

## F24 — P2 — Permitted customer hard-delete leaves contact data behind

**Status: FIXED** — Unused-customer deletion removes all owned contacts atomically; quote history blocks hard deletion and directs callers to deactivate. `test/integration/review-customer-delete.integration.spec.js` F24: red 2 failed; green 2 passed.


Original notes: [W10](findings-work.md).

**Evidence:** `src/endpoints/customer/customer-router.js:331`, `src/endpoints/customer/customer-router.js:356`, `src/endpoints/customer/customer-service.js:132`, `migrations/schema-snapshot-2026-09-22.sql:404`, `migrations/schema-snapshot-2026-09-22.sql:1862`.

**What happens:** A newly created unused customer has a customer_information row. Delete guards do not consider it; delete removes only customers. The reference schema has account/creator FKs on information but no customer FK, so its contact/PII row remains orphaned. Quotes likewise lack a customer FK and are absent from the explicit guards.

**Reproduction idea:** Create a nonrecurring customer with contact details and no ledger/job records. Delete it, then query customer_information by the deleted customer ID in a sandbox. Expect the contact row still present though normal joined views no longer show it.

**Suggested fix:** Decide retention requirements, then atomically delete dependent contact rows or soft-deactivate the customer. Add appropriate FK behavior and explicitly account for quotes/other unguarded relationships. Test resulting related rows, not only removal from the active list.

<a id="f25"></a>

## F25 — P2 — Customer deletion races ledger/job creation

**Status: FIXED** — Deletion holds the shared customer FOR NO KEY UPDATE lock through raw history checks and contact/customer deletion. `test/integration/review-customer-delete.integration.spec.js` F25: red 2 failed; green 2 passed (real two-request lock race and malformed historical job join); combined 4 passed.


Original notes: [W11](findings-work.md).

**Evidence:** `src/endpoints/customer/customer-router.js:324`, `src/endpoints/customer/customer-router.js:331`, `src/endpoints/customer/customer-router.js:356`, `src/endpoints/payments/ledger-helpers.js:62`, `src/endpoints/job/job-router.js:67`, `migrations/schema-snapshot-2026-09-22.sql:1942`.

**What happens:** Customer delete performs checks and DELETE outside a transaction and without acquiring the customer lock used by job/financial writers. A job can be committed after checks finish but before DELETE. The schema has no customer FK on jobs (nor on core transactions), so delete can succeed and orphan newly committed history. Later INNER JOIN reads hide orphaned work.

**Reproduction idea:** Start with a customer with no related history. Pause DELETE after its last guard read. Create a job for that customer through the normal locked job API and let it commit. Resume DELETE; verify customer gone and job retained. This uses two concurrent sandbox requests with a test hook; it was not run here.

**Suggested fix:** Acquire the same owned customer FOR NO KEY UPDATE lock before all guard reads and hold it through deletion in one transaction. Use raw relation existence queries and appropriate FKs as a second layer. Add a two-connection race regression.

<a id="f26"></a>

## F26 — P2 — Job-type update/delete detach a rejecting response refresh

**Status: FIXED** — Job-type update/delete await refresh so rejection reaches the existing error envelope after the committed mutation. `test/endpoints/jobType/review-refresh.spec.js`: red 2 failed; green 2 passed in isolated strict-unhandled-rejection Node processes.


Original notes: [W12](findings-work.md).

**Evidence:** `src/endpoints/jobType/jobType-router.js:76`, `src/endpoints/jobType/jobType-router.js:100`, `src/endpoints/jobType/jobType-router.js:112`, `src/app.js:7`.

**What happens:** PUT and DELETE call the async response-refresh helper without await or return. If the post-write query rejects, the surrounding catch and Express async-error wrapper cannot observe that detached promise. The write has committed, the request has no handled response, and the rejection can terminate a Node process using default unhandled-rejection behavior. Create already awaits this helper.

**Reproduction idea:** Stub getActiveJobTypes to reject only after a successful job-type update/delete. Observe that the route does not send its documented error envelope and an unhandled rejection is emitted. Use an isolated process for a regression so the test runner is not terminated.

**Suggested fix:** Await the refresh inside the existing try/catch, and test a failed refresh after successful mutation. Report that the mutation may already have committed.

<a id="f27"></a>

## F27 — P2 — Customer statement PDF can combine different ledger states

**Status: FIXED** — Customer, five ledger datasets and account header are read in one REPEATABLE READ READ ONLY transaction. `test/integration/review-statement-snapshot.integration.spec.js`: red 1 failed with -100 instead of 0; green 1 passed across a controlled concurrent atomic charge/payment commit.


Original notes: [W14](findings-work.md).

**Evidence:** `src/endpoints/customer/customer-statement.js:18`, `src/endpoints/accountAudit/account-audit-service.js:19`, `src/endpoints/customer/customer-statement.js:26`, `src/endpoints/invoice/createInvoice/billingSnapshot.js:27`.

**What happens:** The PDF builder independently reads five tables through the ordinary db connection and then calculates running/current balances. It does not use the consistent read snapshot used by invoice preview. A transaction/payment pair committed between those reads can appear only on one side of the generated statement, showing a balance that never existed as a committed ledger state.

**Reproduction idea:** In a two-connection test, allow the PDF's transaction read to finish, delay its payment read, commit an atomic $100 retainer-funded entry plus −$100 auto payment, then resume payment read. The generated data contains the credit but not the new charge. Reverse read timing for the opposite mismatch. Compare against before/after committed states.

**Suggested fix:** Run customer, ledger and header reads inside one REPEATABLE READ READ ONLY transaction, following the existing billing snapshot pattern. Add a controlled concurrent-commit regression verifying both halves are from the same snapshot.

<a id="f28"></a>

## F28 — P2 — Tracker upload can return 500 after successfully saving

**Status: FIXED** — Postcommit staff-recipient lookup and delivery are best effort; successful uploads retain 201 and storedKey. `test/integration/review-tracker-outcome.integration.spec.js`: red 1 failed; green 1 passed, verifying saved MinIO bytes, entry/owner records and duplicate retry; no email or AI calls.


Original notes: [PLAT-05](findings-platform.md).

**Source:** `src/endpoints/timeTracking/timeTracking-router.js:617`, `src/endpoints/timeTracking/timeTracking-router.js:658`, `src/endpoints/timeTracking/timeTracking-router.js:670`, `src/endpoints/timeTracking/timeTracking-router.js:766`.

**What happens:** File, entries and ownership commit before the staff-recipient lookup. That lookup is outside the success-email catch. A later staff DB failure reaches the outer 500 handler even though upload and possible AI scheduling succeeded. Retrying the workbook then produces duplicate 409, contradicting the original failure message.

**Reproduction idea:** Stub only `listActiveEmailsByAccount` to reject after a valid upload transaction commits; confirm HTTP500 while original S3 bytes, entries and owner row exist, then retry and expect duplicate409.

**Suggested fix:** Make postcommit recipient lookup/sending independently best effort or queue it durably, preserving a successful upload response once persistence commits. Keep a distinct upload identifier for reconciliation.

<a id="f29"></a>

## F29 — P2 — String boolean bypasses self/last-Super-Admin deactivation guards

**Status: FIXED** — Update active flags accept only literal booleans (or omission); update/delete serialize last-Super-Admin checks and mutations under an account lock. `test/integration/review-user-guards.integration.spec.js`: red 6 failed / 1 passed; green 7 passed, including concurrent self-demotions.


Original notes: [PLAT-07](findings-platform.md).

**Source:** `src/endpoints/user/userObjects.js:41`; `src/endpoints/user/user-router.js:86`, `src/endpoints/user/user-router.js:99`; `src/endpoints/user/user-service.js:15`.

**What happens:** Update forwards raw isUserActive to PostgreSQL but detects deactivation only with `=== false`. With accessLevel='Super Admin' and isUserActive='false', willDeactivate and willLoseSuperAdmin are false; PostgreSQL can cast the text to boolean false. Even the only active Super Admin can deactivate themselves despite both guards. Separately, count-and-mutate is not serialized against concurrent admin updates.

**Reproduction idea:** On a disposable account with one active Super Admin, PUT their own userID, accessLevel='Super Admin', isUserActive='false'. Confirm stored active=false and next protected request401. Also race two distinct super admins demoting themselves in an isolated test to exercise the count/mutation gap.

**Suggested fix:** Accept only a literal boolean when active status is supplied, use the validated normalized value in both guard and update, and serialize last-admin checks/mutations under an account lock and transaction.

<a id="f30"></a>

## F30 — P2 — Historical migration chain removes columns still required by runtime

**Status: FIXED** — Added additive migration 022 to restore the three runtime suggestion columns and customer FK without changing existing values. `test/scripts/migration-022.spec.js`: red 1 failed / 1 passed; green 2 passed (historical 005 gap, supported snapshot baseline through pending migrations, runtime-shaped upsert/read, idempotent rerun). Tested only in disposable ds2_mig_test databases; no historical data repair.


Original notes: [PLAT-08](findings-platform.md).

**Source:** `migrations/002.add_ai_time_tracker_transaction_suggestions.sql:1`, `migrations/005.drop_ai_customer_suggestion_columns.sql:1`; `migrations/schema-snapshot-2026-09-22.sql:335`; `src/endpoints/timesheets/auto-ingest-orchestrator.js:420`; `src/endpoints/timesheets/timesheets-router.js:470`.

**What happens:** 005 drops suggested_entity, suggested_customer_id and suggested_customer_display_name. Current runtime writes/selects them, and the authoritative snapshot includes them. No numbered migration 006–021 restores those columns. Therefore replaying the historical migration chain does not reproduce the runtime schema; the test harness's snapshot bootstrap can conceal this gap. This does not assert those columns are missing in the current production database.

**Reproduction idea:** Use a disposable snapshot database, apply 005, then inspect the columns and execute the suggestion select/upsert query with stubs or fixture data. Alternatively construct a dedicated migration-chain test from the declared historical baseline without replaying destructive files on any real dataset.

**Suggested fix:** Add a reviewed forward migration restoring the required schema, document the actual baseline/version lineage, and test a clean build from the supported baseline through all pending migrations.

<a id="f31"></a>

## F31 — P2 — Global invoice note disappears unless an individual note is present

**Status: FIXED** — Both notes normalize to strings and the Notes section renders when either is populated. `test/pdfCreator/review-notes.spec.js`: red 2 failed / 2 passed; green 4 passed (global only, individual only, both, neither).


Original notes: [INV-04](findings-invoicing.md).

**Evidence:** `src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js:72`, `src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js:82`; both notes pass through without defaults: `src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:107`. The global-note UI is `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:194`.

**What happens:** Rendering globalInvoiceNote is nested inside if(invoiceNote). A global note supplied for all customers silently disappears on customers with blank individual notes. Conversely, an API request with an individual note but no global note reaches undefined.length and aborts PDF generation.

**Reproduction:** Generate a draft with invoiceCreationSettings.globalInvoiceNote='Please use the new remittance address' and no per-customer invoiceNote. Inspect the PDF: the message is absent. Then supply invoiceNote but omit globalInvoiceNote and observe renderer failure. The earlier pass reported an in-memory document stub reproducing both (not rerun here): global-only printed no text; individual-only threw an undefined.length TypeError. No database or PDF output was involved.

**Suggested fix:** Normalize both notes to strings; render the Notes block when either is nonempty, independently drawing each populated value. Test global-only, individual-only, both and neither.

<a id="f32"></a>

## F32 — P2 — Rate agreements trust unscoped customer and forged actor IDs

**Status: FIXED** — Rate agreements validate positive integer customer/year and finite positive two-decimal rate within numeric(10,2), lock/verify the owned customer, and derive creator from session while preserving it on edits. `test/integration/review-rate-agreements.integration.spec.js`: red 3 failed / 7 passed; green 10 passed.


Original notes: [INV-05](findings-invoicing.md).

**Evidence:** `src/endpoints/analytics/analytics-router.js:203`, `src/endpoints/analytics/analytics-router.js:214`, `src/endpoints/analytics/analytics-service.js:351`. Schema has separate account/customer/user foreign keys, not tenant-composite references: `migrations/schema-snapshot-2026-09-22.sql:2026`.

**What happens:** Path accountID is guarded, but body customerId is not checked against that account. An existing customer from another account can be linked to a new agreement under the caller's account. URL userID becomes created_by_user_id without checking it against req.user or account. This creates invalid tenant associations and false creator attribution. No cross-account read disclosure or overwrite of the other account's own rate row was demonstrated, so this is classified P2.

**Reproduction:** As account A's super admin, POST rateAgreement using account A in the URL, an existing customer from B, and another existing user's ID in the userID segment. Use a valid year/rate. The SQL foreign keys allow those independent references and RETURNING exposes the incorrect created row.

**Suggested fix:** Resolve customer by both account_id and customer_id and refuse mismatches; take actor from req.user.user_id. Add positive-integer/finite/range validation and body-reference tenancy/actor tests.

<a id="f33"></a>

## F33 — P2 — Same-name customers collide inside the combined invoice ZIP

**Status: FIXED** — PDF archive members include customer IDs and safe display names, with a case-insensitive collision fallback. `test/pdfCreator/review-zip-names.spec.js`: red 2 failed; green 2 passed (draft/final archives, same names, normalized path names, distinct bytes).


Original notes: [INV-06](findings-invoicing.md), [PLAT-12](findings-platform.md).

**Evidence:** `src/utils/createAndSavePDFs.js:8`, `src/pdfCreator/zipOrchestrator.js:56`, `src/endpoints/invoice/invoice-router.js:349`.

**What happens:** Per-customer S3 keys contain customer IDs, but archive member names are only displayName.type. Two selected customers with the same display name create two members named identically. Typical extraction tools overwrite one or ask to replace it; a batch can appear to contain fewer statements than billed.

**Reproduction:** Supply two PDF buffers with different customerID metadata and identical displayName. Inspect the generated archive directory or extract it into an empty folder: both entries have the same filename. This affects draft and final combined archives.

**Suggested fix:** Include customer ID and/or invoice number in every PDF member name, or give each customer a unique directory. Preserve a human-readable name and test collisions after name normalization.

<a id="f34"></a>

## F34 — P2 — Invoice detail omits retainers created during the statement's ending day

**Status: FIXED** — Invoice retainer history uses inclusive business dates: created_at >= start_date and < end_date + 1 day. `test/integration/review-retainer-dates.integration.spec.js`: red 1 failed; green 1 passed (midnight/noon/final microsecond included, adjacent days and other customer excluded).


Original notes: [INV-07](findings-invoicing.md).

**Evidence:** `src/endpoints/invoice/invoice-router.js:487`, `src/endpoints/retainer/retainer-service.js:20`; finalize stores date-only end_date: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:288`.

**What happens:** The Retainers tab uses created_at <= end_date. PostgreSQL compares the timestamp against midnight at the beginning of the end date. A retainer created at noon on that billing date is omitted even though the billing engine reads all retainer history and can print its balance.

**Reproduction:** Create a retainer snapshot at 2026-09-24 12:00, finalize later that day with end_date=2026-09-24, then read invoice details. The engine/PDF can include it while invoiceRetainers excludes it.

**Suggested fix:** Define whether this tab means history during inclusive business dates or balance as of issuance. For inclusive dates use created_at < end_date + interval '1 day'; for issuance membership use a documented statement timestamp and latest-chain logic. Test the midnight/noon/end-day boundary.

<a id="f35"></a>

## F35 — P2 — Time reports merge distinct customers or employees sharing a display name

**Status: FIXED** — Time allocation and capacity group and return stable customer/user IDs; CSV and UI retain those IDs and distinguish same-name rows/cards. `review-analytics-identities.integration.spec.js`: red 2 failed; green 2 passed. Frontend `TaxSeasonCapacityPage.identities.test.js`: red 1 failed; green 1 passed.


Original notes: [INV-12](findings-invoicing.md).

**Evidence:** Customer time allocation groups only c.display_name at `src/endpoints/analytics/analytics-service.js:256`; tax-season capacity groups only u.display_name and week at `src/endpoints/analytics/analytics-service.js:487`. Client-rate and WIP reports instead retain customer IDs: `src/endpoints/analytics/analytics-service.js:59`, `src/endpoints/analytics/analytics-service.js:382`.

**What happens:** Two separate customers with the same display name become one top-20 customer row with combined hours/dollars. Two employees sharing a name become one weekly capacity row. Totals may still add up, but the individual client/staff attribution is wrong and can differ from ID-based reports.

**Reproduction:** Add two same-name customers with 1 and 2 time hours in the selected year: byCustomer returns one 3-hour row. Give two same-name employees 4 and 6 hours in the same tax-season week: capacity returns one 10-hour row.

**Suggested fix:** Group by stable customer_id/user_id plus display name and return the ID. Keep distinct identities through CSV/UI rendering, with a secondary disambiguating label where needed. Test duplicate names.

<a id="f36"></a>

## F36 — P2 — Accepted uppercase PDF extension misses configured trigger

**Status: FIXED** — Accepted PDF extensions are stored and returned as lowercase .pdf to match the checked-in S3 notification. `test/endpoints/pendingPayments/review-upload-extension.spec.js`: red 2 failed / 1 passed; green 3 passed (.pdf, .PDF, .PdF). Router/trigger contract uses in-memory storage with fixture account 9001; no cloud configuration changed.


Original notes: [LEDGER-08](findings-ledger.md).

- **Source:** `src/endpoints/pendingPayments/pendingPayments-router.js:251`, `src/endpoints/pendingPayments/pendingPayments-router.js:278`; `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:248`.
- **What happens:** Upload lowercases the extension for validation but preserves the original filename in the S3 key. Checked-in S3 notification configuration has suffix `.pdf`. An accepted `receipt.PDF` key does not end in that configured suffix, so this notification does not invoke the processor. Upload created no DB row, so it also does not appear in the DB-derived file list.
- **Concrete reproduction:** In an environment using the checked-in notification, upload valid bytes as `receipt.PDF` from account 1. Upload succeeds and writes the uppercase key. Compare with `receipt.pdf`: only the lowercase key matches the notification suffix. The uppercase upload has no extraction queue/file-list row unless another process handles it.
- **Evidence:** Static validation/key/trigger comparison. Actual deployed notification settings were not queried; whether another deployed trigger exists is **not determined from the code**.
- **Suggested fix:** Normalize the stored extension/name and return that canonical identity, or configure a prefix-only notification and retain extension filtering in the handler. Add an upload-to-trigger contract check for `.pdf`, `.PDF` and mixed case.

<a id="f37"></a>

## F37 — P3 — Backend owner role cannot reach ledger UI

**Status: FIXED** — The frontend manager gate now admits legacy Owner like the backend; Admin-only and Super-Admin-only gates retain their existing roles. Frontend `ManagerAndAdminProtectedAccess.test.js`: red 2 failed / 8 passed; green 10 passed (role matrix and higher-privilege exclusions).


Original notes: [LEDGER-07](findings-ledger.md), [INV-08](findings-invoicing.md).

- **Source:** `src/endpoints/auth/jwt-auth.js:94`, `src/app.js:143`, `src/app.js:145`, `src/app.js:155`; `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.
- **What happens:** Backend `requireManagerOrAdmin` admits `owner` alongside manager/admin/super admin. The frontend protected route only admits the latter three. An otherwise valid owner is denied the pages for APIs they are authorized to call.
- **Concrete reproduction:** With an active `owner` account session, call the same-account payment list, then navigate to `/transactions/customerPayments`. The API passes the role gate; the frontend returns its unauthorized view.
- **Evidence:** Source-level role-set comparison; no account/session was created.
- **Suggested fix:** Confirm the intended owner role and make frontend/backend role sets consistent. Add a role-matrix assertion for all four allowed backend roles and a denied ordinary employee.

<a id="f38"></a>

## F38 — P3 — Account Audit accepts ar_60 but does not apply it

**Status: FIXED** — Account Audit explicitly returns HTTP 400 for unsupported ar_60 instead of silently ignoring it; supported filters and ordinary listing remain. `test/integration/review-audit-filter.integration.spec.js`: red 2 failed / 1 passed; green 3 passed (10-day and 80-day statements plus normal listing).


Original notes: [INV-09](findings-invoicing.md).

**Evidence:** `src/endpoints/accountAudit/account-audit-router.js:60` accepts ar_60. Service quick filters at `src/endpoints/accountAudit/account-audit-service.js:106` and audit-match filters at `src/endpoints/accountAudit/account-audit-service.js:169` implement no ar_60 branch.

**What happens:** A caller asking for filter=ar_60 gets the ordinary eligible customer set, including accounts whose statements are not 60 days old. The accepted parameter silently has no effect.

**Reproduction:** Use eligible customers with 10-day and 80-day latest statements. Compare customers?filter=ar_60 with the same request without a filter; both queries have the same predicates.

**Suggested fix:** Either implement a precisely defined statement-age predicate using current chain semantics, or remove/refuse the unsupported parameter and update the API/UI contract. Test both matching and nonmatching accounts.

<a id="f39"></a>

## F39 — P3 — PDF “Original Amount” repeats the remaining balance

**Status: FIXED** — Removed the duplicate/misleading Original Amount column; Beginning Balance prints the selected outstanding balance once. No original issued amount is inferred from mutable invoice totals. `test/pdfCreator/review-outstanding-column.spec.js`: red 2 failed; green 2 passed on rendered PDFs; with existing pagination regressions 14 passed.


Original notes: [INV-10](findings-invoicing.md).

**Evidence:** `src/pdfCreator/templateOne/templateFunctions/templateOneOutstandingCharges.js:18`.

**What happens:** Beginning Balance's Original Amount and Outstanding columns both read remaining_balance_on_invoice. A partially paid invoice no longer displays its original charge, although the heading says it does.

**Reproduction:** Render a statement with an outstanding invoice issued for $100 and currently remaining $60. Both columns print 60.00.

**Suggested fix:** Carry an explicit original issued amount from the root if that is the intended column, or remove/rename the redundant column. Do not substitute a snapshot total without defining what “original” means after adjustments.

## Output summary

Checked and updated **25 feature documents**. Reviewed **4 original findings files**, retained unchanged. Indexed **143 endpoint contracts** in [README.md](../README.md). Confirmed **39 distinct findings: 7 P1, 29 P2 and 3 P3**. Eight duplicate notes were merged; none was rejected as false. Suggested reproductions and fixes were not executed.
